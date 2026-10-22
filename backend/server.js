require('dotenv').config();

const bcrypt = require('bcryptjs');
const cors = require('cors');
const express = require('express');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');

const app = express();
const port = Number(process.env.PORT) || 3000;
const jwtSecret = process.env.JWT_SECRET;
const databaseUrl = process.env.DATABASE_URL;
const masterEmail = process.env.MASTER_EMAIL?.trim().toLowerCase();
const roleNames = {
    1: 'Músico',
    2: 'Coordinador',
    3: 'Multimedia',
    4: 'Sonido',
    5: 'Master',
    6: 'Miembro'
};
const servicePositions = {
    'Batería': [1],
    'Corista': [1],
    'Bajo': [1],
    'Guitarra acústica': [1],
    'Guitarra eléctrica': [1],
    'Multimedia - transmisión': [3],
    'Multimedia - letras': [3],
    'Sonido - local': [4],
    'Sonido - transmisión': [4],
    'Cámara 2 - abajo': [3],
    'Dirección': [1, 2, 3, 4, 5, 6]
};

function getUserRoles(user) {
    const areas = Array.isArray(user.role_ids) && user.role_ids.length
        ? user.role_ids.map(Number)
        : [Number(user.area)];
    const roles = areas.map((area) => roleNames[area]).filter(Boolean);
    return { areas, roles, role: roles.join(', ') };
}

if (!jwtSecret) {
    throw new Error('Falta configurar la variable de entorno JWT_SECRET.');
}

if (!databaseUrl) {
    throw new Error('Falta configurar la variable de entorno DATABASE_URL.');
}

const allowedOrigins = (process.env.FRONTEND_ORIGIN || '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

const pool = new Pool({
    connectionString: databaseUrl,
    ssl: process.env.NODE_ENV === 'production'
        ? { rejectUnauthorized: false }
        : undefined
});

app.use(cors({
    origin(origin, callback) {
        const isLocalDevelopment = process.env.NODE_ENV !== 'production'
            && (!origin
                || origin === 'null'
                || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin));

        if (isLocalDevelopment || allowedOrigins.includes(origin)) {
            callback(null, true);
            return;
        }

        callback(new Error('Origen no permitido por la política CORS.'));
    }
}));
app.use(express.json({ limit: '10kb' }));

function createToken(user) {
    return jwt.sign(
        { sub: String(user.id), nombre: user.nombre },
        jwtSecret,
        { expiresIn: '8h' }
    );
}

function getAuthenticatedUser(req, res, next) {
    const authorization = req.get('authorization');
    const token = authorization?.startsWith('Bearer ')
        ? authorization.slice('Bearer '.length)
        : '';

    if (!token) {
        res.status(401).json({ success: false, message: 'Inicia sesión para continuar.' });
        return;
    }

    try {
        req.auth = jwt.verify(token, jwtSecret);
        next();
    } catch {
        res.status(401).json({ success: false, message: 'Tu sesión venció. Inicia sesión de nuevo.' });
    }
}

function requireMaster(req, res, next) {
    pool.query('SELECT area, role_ids FROM users WHERE id = $1', [req.auth.sub])
        .then((result) => {
            if (!result.rows[0]) {
                res.status(401).json({ success: false, message: 'La cuenta ya no está disponible.' });
                return;
            }

            const { areas } = getUserRoles(result.rows[0]);
            if (!areas.includes(5)) {
                res.status(403).json({ success: false, message: 'No tienes permisos de administrador.' });
                return;
            }

            next();
        })
        .catch(next);
}

function requireCoordinator(req, res, next) {
    pool.query('SELECT role_ids, area FROM users WHERE id = $1', [req.auth.sub])
        .then((result) => {
            if (!result.rows[0]) {
                res.status(401).json({ success: false, message: 'La cuenta ya no está disponible.' });
                return;
            }

            const { areas } = getUserRoles(result.rows[0]);
            if (!areas.includes(5) && !areas.includes(2)) {
                res.status(403).json({ success: false, message: 'No tienes permisos para gestionar cultos.' });
                return;
            }

            req.isMaster = areas.includes(5);
            next();
        })
        .catch(next);
}

app.get('/api/health', (_req, res) => {
    res.json({ success: true });
});

app.post('/api/register', async (req, res, next) => {
    const { nombre, telefono, email, password } = req.body || {};
    const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
    const normalizedCategory = 'congregation';

    if (typeof nombre !== 'string' || nombre.trim().length < 2 || nombre.trim().length > 150
        || typeof telefono !== 'string' || telefono.trim().length < 7 || telefono.trim().length > 30
        || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)
        || normalizedEmail.length > 255
        || typeof password !== 'string' || password.length < 8 || password.length > 72) {
        res.status(400).json({
            success: false,
            message: 'Verifica tus datos y usa una contraseña de al menos 8 caracteres.'
        });
        return;
    }

    try {
        const passwordHash = await bcrypt.hash(password, 12);
        const result = await pool.query(
            `INSERT INTO users (nombre, telefono, email, password_hash, area, category)
             VALUES ($1, $2, $3, $4, 6, $5)
             RETURNING id, nombre, area, role_ids, category`,
            [nombre.trim(), telefono.trim(), normalizedEmail, passwordHash, normalizedCategory]
        );
        const user = { ...result.rows[0], ...getUserRoles(result.rows[0]) };

        res.status(201).json({
            success: true,
            message: 'Usuario registrado correctamente.',
            token: createToken(user),
            user
        });
    } catch (error) {
        if (error.code === '23505') {
            res.status(409).json({ success: false, message: 'Ya existe una cuenta con ese correo.' });
            return;
        }
        next(error);
    }
});

app.post('/api/login', async (req, res, next) => {
    const { email, password } = req.body || {};
    const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';

    if (!normalizedEmail || typeof password !== 'string' || !password) {
        res.status(400).json({ success: false, message: 'Ingresa tu correo y contraseña.' });
        return;
    }

    try {
        const result = await pool.query(
            'SELECT id, nombre, area, role_ids, category, password_hash FROM users WHERE email = $1',
            [normalizedEmail]
        );
        const user = result.rows[0];

        if (!user || !(await bcrypt.compare(password, user.password_hash))) {
            res.status(401).json({ success: false, message: 'Correo o contraseña incorrectos.' });
            return;
        }

        res.json({
            success: true,
            message: 'Inicio de sesión correcto.',
            token: createToken(user),
            user: {
                id: user.id,
                nombre: user.nombre,
                area: user.area,
                ...getUserRoles(user),
                category: user.category
            }
        });
    } catch (error) {
        next(error);
    }
});

app.get('/api/auth/me', getAuthenticatedUser, async (req, res, next) => {
    try {
        const result = await pool.query(
            'SELECT id, nombre, telefono, email, area, role_ids, category FROM users WHERE id = $1',
            [req.auth.sub]
        );

        if (!result.rows[0]) {
            res.status(401).json({ success: false, message: 'La cuenta ya no está disponible.' });
            return;
        }

        res.json({
            success: true,
            user: { ...result.rows[0], ...getUserRoles(result.rows[0]) }
        });
    } catch (error) {
        next(error);
    }
});

app.patch('/api/profile', getAuthenticatedUser, async (req, res, next) => {
    const { nombre, telefono, email } = req.body || {};
    const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
    if (typeof nombre !== 'string' || nombre.trim().length < 2 || nombre.trim().length > 150
        || typeof telefono !== 'string' || telefono.trim().length < 7 || telefono.trim().length > 30
        || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)
        || normalizedEmail.length > 255) {
        res.status(400).json({ success: false, message: 'Revisa tu nombre, teléfono y correo.' });
        return;
    }

    try {
        const result = await pool.query(
            `UPDATE users SET nombre = $1, telefono = $2, email = $3
             WHERE id = $4
             RETURNING id, nombre, telefono, email, area, role_ids, category`,
            [nombre.trim(), telefono.trim(), normalizedEmail, req.auth.sub]
        );
        if (!result.rows[0]) {
            res.status(401).json({ success: false, message: 'La cuenta ya no está disponible.' });
            return;
        }
        await pool.query(
            `INSERT INTO audit_logs (actor_id, action, target_type, target_id, details)
             VALUES ($1, 'user.profile.updated', 'user', $1, '{}'::JSONB)`,
            [req.auth.sub]
        );
        res.json({ success: true, user: { ...result.rows[0], ...getUserRoles(result.rows[0]) } });
    } catch (error) {
        if (error.code === '23505') {
            res.status(409).json({ success: false, message: 'Ese correo ya está asociado a otra cuenta.' });
            return;
        }
        next(error);
    }
});

app.patch('/api/profile/password', getAuthenticatedUser, async (req, res, next) => {
    const { currentPassword, newPassword } = req.body || {};
    if (typeof currentPassword !== 'string' || !currentPassword
        || typeof newPassword !== 'string' || newPassword.length < 8 || newPassword.length > 72) {
        res.status(400).json({ success: false, message: 'Ingresa tu contraseña actual y una nueva de 8 a 72 caracteres.' });
        return;
    }

    try {
        const result = await pool.query('SELECT password_hash FROM users WHERE id = $1', [req.auth.sub]);
        if (!result.rows[0] || !(await bcrypt.compare(currentPassword, result.rows[0].password_hash))) {
            res.status(401).json({ success: false, message: 'La contraseña actual no es correcta.' });
            return;
        }
        const passwordHash = await bcrypt.hash(newPassword, 12);
        await pool.query('UPDATE users SET password_hash = $1 WHERE id = $2', [passwordHash, req.auth.sub]);
        await pool.query(
            `INSERT INTO audit_logs (actor_id, action, target_type, target_id, details)
             VALUES ($1, 'user.password.updated', 'user', $1, '{}'::JSONB)`,
            [req.auth.sub]
        );
        res.json({ success: true, message: 'Contraseña actualizada.' });
    } catch (error) {
        next(error);
    }
});

app.get('/api/dashboard', getAuthenticatedUser, async (_req, res, next) => {
    try {
        const result = await pool.query('SELECT COUNT(*)::int AS member_count FROM users');
        res.json({ success: true, memberCount: result.rows[0].member_count });
    } catch (error) {
        next(error);
    }
});

app.get('/api/team/directory', getAuthenticatedUser, requireCoordinator, async (_req, res, next) => {
    try {
        const result = await pool.query(
            `SELECT id, nombre, email, telefono, role_ids, area
             FROM users
             ORDER BY nombre, id`
        );
        res.json({
            success: true,
            users: result.rows.map((user) => ({ ...user, ...getUserRoles(user) }))
        });
    } catch (error) {
        next(error);
    }
});

app.get('/api/services', getAuthenticatedUser, async (_req, res, next) => {
    try {
        const result = await pool.query(
            `SELECT e.id, e.title, e.event_type, e.starts_at, e.details, e.created_by,
                    COALESCE(
                        json_agg(
                            json_build_object(
                                'id', a.id,
                                'position', a.position,
                                'userId', u.id,
                                'name', u.nombre
                            ) ORDER BY a.position, u.nombre
                        ) FILTER (WHERE a.id IS NOT NULL),
                        '[]'::json
                    ) AS assignments
             FROM service_events e
             LEFT JOIN service_assignments a ON a.event_id = e.id
             LEFT JOIN users u ON u.id = a.user_id
             WHERE e.starts_at >= NOW() - INTERVAL '30 days'
             GROUP BY e.id
             ORDER BY e.starts_at
             LIMIT 100`
        );
        res.json({ success: true, services: result.rows });
    } catch (error) {
        next(error);
    }
});

app.post('/api/services', getAuthenticatedUser, requireCoordinator, async (req, res, next) => {
    const { title, eventType, startsAt, details = '' } = req.body || {};
    const startDate = typeof startsAt === 'string' ? new Date(startsAt) : null;
    const validTypes = ['Culto', 'Ensayo', 'Evento especial'];
    if (typeof title !== 'string' || title.trim().length < 2 || title.trim().length > 120
        || !validTypes.includes(eventType)
        || !startDate || Number.isNaN(startDate.getTime())
        || typeof details !== 'string' || details.length > 2000) {
        res.status(400).json({ success: false, message: 'Revisa el nombre, tipo, fecha y detalles del evento.' });
        return;
    }

    try {
        const result = await pool.query(
            `INSERT INTO service_events (title, event_type, starts_at, details, created_by)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING id, title, event_type, starts_at, details`,
            [title.trim(), eventType, startDate.toISOString(), details.trim(), req.auth.sub]
        );
        await pool.query(
            `INSERT INTO audit_logs (actor_id, action, target_type, target_id, details)
             VALUES ($1, 'service.created', 'service_event', $2, $3)`,
            [req.auth.sub, result.rows[0].id, JSON.stringify({ title: result.rows[0].title })]
        );
        res.status(201).json({ success: true, service: { ...result.rows[0], assignments: [] } });
    } catch (error) {
        next(error);
    }
});

app.patch('/api/services/:id', getAuthenticatedUser, requireCoordinator, async (req, res, next) => {
    const serviceId = req.params.id;
    const { title, eventType, startsAt, details = '' } = req.body || {};
    const startDate = typeof startsAt === 'string' ? new Date(startsAt) : null;
    const validTypes = ['Culto', 'Ensayo', 'Evento especial'];
    if (!/^[1-9]\d*$/.test(serviceId)
        || typeof title !== 'string' || title.trim().length < 2 || title.trim().length > 120
        || !validTypes.includes(eventType)
        || !startDate || Number.isNaN(startDate.getTime())
        || typeof details !== 'string' || details.length > 2000) {
        res.status(400).json({ success: false, message: 'Revisa el nombre, tipo, fecha y detalles del evento.' });
        return;
    }

    try {
        const result = await pool.query(
            `UPDATE service_events
             SET title = $1, event_type = $2, starts_at = $3, details = $4
             WHERE id = $5
             RETURNING id, title, event_type, starts_at, details`,
            [title.trim(), eventType, startDate.toISOString(), details.trim(), serviceId]
        );
        if (!result.rows[0]) {
            res.status(404).json({ success: false, message: 'No se encontró ese culto o evento.' });
            return;
        }
        await pool.query(
            `INSERT INTO audit_logs (actor_id, action, target_type, target_id, details)
             VALUES ($1, 'service.updated', 'service_event', $2, $3)`,
            [req.auth.sub, serviceId, JSON.stringify({ title: result.rows[0].title })]
        );
        res.json({ success: true, service: result.rows[0] });
    } catch (error) {
        next(error);
    }
});

app.delete('/api/services/:id', getAuthenticatedUser, requireCoordinator, async (req, res, next) => {
    if (!/^[1-9]\d*$/.test(req.params.id)) {
        res.status(400).json({ success: false, message: 'El culto o evento no es válido.' });
        return;
    }
    try {
        const result = await pool.query(
            'DELETE FROM service_events WHERE id = $1 RETURNING id, title',
            [req.params.id]
        );
        if (!result.rows[0]) {
            res.status(404).json({ success: false, message: 'No se encontró ese culto o evento.' });
            return;
        }
        await pool.query(
            `INSERT INTO audit_logs (actor_id, action, target_type, target_id, details)
             VALUES ($1, 'service.deleted', 'service_event', $2, $3)`,
            [req.auth.sub, result.rows[0].id, JSON.stringify({ title: result.rows[0].title })]
        );
        res.json({ success: true });
    } catch (error) {
        next(error);
    }
});

app.post('/api/services/:id/assignments', getAuthenticatedUser, requireCoordinator, async (req, res, next) => {
    const serviceId = req.params.id;
    const userId = String(req.body?.userId || '');
    const position = req.body?.position;

    if (!/^[1-9]\d*$/.test(serviceId) || !/^[1-9]\d*$/.test(userId)
        || !Object.hasOwn(servicePositions, position)) {
        res.status(400).json({ success: false, message: 'Selecciona un culto, una persona y un puesto válidos.' });
        return;
    }

    try {
        const userResult = await pool.query(
            'SELECT id, nombre, role_ids, area FROM users WHERE id = $1',
            [userId]
        );
        const user = userResult.rows[0];
        if (!user) {
            res.status(404).json({ success: false, message: 'No se encontró esa cuenta.' });
            return;
        }

        const { areas } = getUserRoles(user);
        if (!servicePositions[position].some((area) => areas.includes(area))) {
            res.status(403).json({ success: false, message: 'La persona no tiene el rol requerido para ese puesto.' });
            return;
        }

        const result = await pool.query(
            `INSERT INTO service_assignments (event_id, user_id, position, assigned_by)
             VALUES ($1, $2, $3, $4)
             RETURNING id, event_id, user_id, position`,
            [serviceId, userId, position, req.auth.sub]
        );
        await pool.query(
            `INSERT INTO audit_logs (actor_id, action, target_type, target_id, details)
             VALUES ($1, 'service.assignment.created', 'service_assignment', $2, $3)`,
            [req.auth.sub, result.rows[0].id, JSON.stringify({ serviceId, userId, position })]
        );
        res.status(201).json({ success: true, assignment: { ...result.rows[0], name: user.nombre } });
    } catch (error) {
        if (error.code === '23505') {
            res.status(409).json({
                success: false,
                message: 'Esa persona ya tiene un puesto operativo en este culto, o ya está asignada a ese puesto.'
            });
            return;
        }
        if (error.code === '23503') {
            res.status(404).json({ success: false, message: 'No se encontró ese culto.' });
            return;
        }
        next(error);
    }
});

app.delete('/api/services/:serviceId/assignments/:assignmentId', getAuthenticatedUser, requireCoordinator, async (req, res, next) => {
    if (!/^[1-9]\d*$/.test(req.params.serviceId) || !/^[1-9]\d*$/.test(req.params.assignmentId)) {
        res.status(400).json({ success: false, message: 'La asignación no es válida.' });
        return;
    }

    try {
        const result = await pool.query(
            `DELETE FROM service_assignments
             WHERE id = $1 AND event_id = $2
             RETURNING id, event_id, user_id, position`,
            [req.params.assignmentId, req.params.serviceId]
        );
        if (!result.rows[0]) {
            res.status(404).json({ success: false, message: 'No se encontró esa asignación.' });
            return;
        }
        await pool.query(
            `INSERT INTO audit_logs (actor_id, action, target_type, target_id, details)
             VALUES ($1, 'service.assignment.deleted', 'service_assignment', $2, $3)`,
            [req.auth.sub, result.rows[0].id, JSON.stringify(result.rows[0])]
        );
        res.json({ success: true });
    } catch (error) {
        next(error);
    }
});

app.get('/api/admin/audit-logs', getAuthenticatedUser, requireMaster, async (_req, res, next) => {
    try {
        const result = await pool.query(
            `SELECT l.id, l.action, l.target_type, l.target_id, l.details, l.created_at,
                    u.nombre AS actor_name
             FROM audit_logs l
             LEFT JOIN users u ON u.id = l.actor_id
             ORDER BY l.created_at DESC
             LIMIT 100`
        );
        res.json({ success: true, logs: result.rows });
    } catch (error) {
        next(error);
    }
});

app.get('/api/admin/users', getAuthenticatedUser, requireMaster, async (_req, res, next) => {
    try {
        const result = await pool.query(
            `SELECT id, nombre, email, telefono, area, role_ids, category, created_at
             FROM users
             ORDER BY nombre, id`
        );
        res.json({
            success: true,
            users: result.rows.map((user) => ({ ...user, ...getUserRoles(user) }))
        });
    } catch (error) {
        next(error);
    }
});

app.patch('/api/admin/users/:id/role', getAuthenticatedUser, requireMaster, async (req, res, next) => {
    const userId = req.params.id;
    const areas = req.body?.areas;

    if (!/^[1-9]\d*$/.test(userId)
        || !Array.isArray(areas)
        || areas.length === 0
        || areas.some((area) => !Number.isInteger(area) || !roleNames[area] || area === 5)
        || new Set(areas).size !== areas.length) {
        res.status(400).json({ success: false, message: 'Selecciona una cuenta y uno o más roles válidos.' });
        return;
    }

    if (userId === String(req.auth.sub)) {
        res.status(400).json({ success: false, message: 'No puedes cambiar tu propio rol.' });
        return;
    }

    try {
        const result = await pool.query(
            'UPDATE users SET area = $1, role_ids = $2 WHERE id = $3 RETURNING id, nombre, area, role_ids',
            [areas[0], areas, userId]
        );

        if (!result.rows[0]) {
            res.status(404).json({ success: false, message: 'No se encontró esa cuenta.' });
            return;
        }

        await pool.query(
            `INSERT INTO audit_logs (actor_id, action, target_type, target_id, details)
             VALUES ($1, 'user.roles.updated', 'user', $2, $3)`,
            [req.auth.sub, result.rows[0].id, JSON.stringify({ areas })]
        );
        res.json({
            success: true,
            user: { ...result.rows[0], ...getUserRoles(result.rows[0]) }
        });
    } catch (error) {
        next(error);
    }
});

app.use((error, _req, res, _next) => {
    console.error('Error en el servidor:', error);
    res.status(500).json({ success: false, message: 'Ocurrió un error en el servidor.' });
});

async function startServer() {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS users (
            id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
            nombre VARCHAR(150) NOT NULL,
            telefono VARCHAR(30) NOT NULL,
            email VARCHAR(255) NOT NULL UNIQUE,
            password_hash TEXT NOT NULL,
            area INTEGER NOT NULL DEFAULT 6,
            role_ids INTEGER[] NOT NULL DEFAULT ARRAY[6]::INTEGER[],
            category VARCHAR(20) NOT NULL DEFAULT 'congregation',
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);
    await pool.query(`
        ALTER TABLE users
        ADD COLUMN IF NOT EXISTS category VARCHAR(20) NOT NULL DEFAULT 'congregation'
    `);
    await pool.query(`
        ALTER TABLE users
        ADD COLUMN IF NOT EXISTS role_ids INTEGER[]
    `);
    await pool.query(`
        UPDATE users SET role_ids = ARRAY[area]::INTEGER[] WHERE role_ids IS NULL
    `);
    await pool.query(`
        ALTER TABLE users
        ALTER COLUMN role_ids SET DEFAULT ARRAY[6]::INTEGER[],
        ALTER COLUMN role_ids SET NOT NULL
    `);
    await pool.query(`
        CREATE TABLE IF NOT EXISTS service_events (
            id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
            title VARCHAR(120) NOT NULL,
            event_type VARCHAR(30) NOT NULL,
            starts_at TIMESTAMPTZ NOT NULL,
            details TEXT NOT NULL DEFAULT '',
            created_by BIGINT NOT NULL REFERENCES users(id),
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);
    await pool.query(`
        CREATE TABLE IF NOT EXISTS service_assignments (
            id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
            event_id BIGINT NOT NULL REFERENCES service_events(id) ON DELETE CASCADE,
            user_id BIGINT NOT NULL REFERENCES users(id),
            position VARCHAR(80) NOT NULL,
            assigned_by BIGINT NOT NULL REFERENCES users(id),
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            UNIQUE (event_id, user_id, position)
        )
    `);
    await pool.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS one_operational_position_per_service_user
        ON service_assignments (event_id, user_id)
        WHERE position <> 'Dirección'
    `);
    await pool.query(`
        CREATE TABLE IF NOT EXISTS audit_logs (
            id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
            actor_id BIGINT REFERENCES users(id),
            action VARCHAR(100) NOT NULL,
            target_type VARCHAR(100) NOT NULL,
            target_id BIGINT,
            details JSONB NOT NULL DEFAULT '{}'::JSONB,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);
    await pool.query(`
        CREATE TABLE IF NOT EXISTS app_settings (
            key VARCHAR(100) PRIMARY KEY,
            value TEXT NOT NULL
        )
    `);

    if (masterEmail) {
        const client = await pool.connect();
        try {
            await client.query('BEGIN');
            await client.query(
                `INSERT INTO app_settings (key, value)
                 VALUES ('master_account_bootstrapped', 'false')
                 ON CONFLICT (key) DO NOTHING`
            );
            const setting = await client.query(
                `SELECT value FROM app_settings
                 WHERE key = 'master_account_bootstrapped'
                 FOR UPDATE`
            );

            if (setting.rows[0].value !== 'true') {
                const master = await client.query(
                    'UPDATE users SET area = 5, role_ids = ARRAY[5]::INTEGER[] WHERE email = $1 RETURNING id',
                    [masterEmail]
                );
                if (!master.rows[0]) {
                    throw new Error('MASTER_EMAIL no coincide con una cuenta registrada.');
                }
                await client.query(
                    `UPDATE app_settings
                     SET value = 'true'
                     WHERE key = 'master_account_bootstrapped'`
                );
            }
            await client.query('COMMIT');
        } catch (error) {
            await client.query('ROLLBACK');
            throw error;
        } finally {
            client.release();
        }
    }

    app.listen(port, () => {
        console.log(`API de Mi Iglesia disponible en el puerto ${port}.`);
    });
}

startServer().catch((error) => {
    console.error('No se pudo iniciar la API:', error);
    process.exit(1);
});
