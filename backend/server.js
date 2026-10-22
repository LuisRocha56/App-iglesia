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
app.use(express.json({ limit: '64kb' }));

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

function requireAreas(allowedAreas) {
    return (req, res, next) => {
        pool.query('SELECT role_ids, area FROM users WHERE id = $1', [req.auth.sub])
            .then((result) => {
                if (!result.rows[0]) {
                    res.status(401).json({ success: false, message: 'La cuenta ya no está disponible.' });
                    return;
                }
                const { areas } = getUserRoles(result.rows[0]);
                if (!allowedAreas.some((area) => areas.includes(area))) {
                    res.status(403).json({ success: false, message: 'No tienes permisos para esta función.' });
                    return;
                }
                next();
            })
            .catch(next);
    };
}

function validHttpUrl(value) {
    if (typeof value !== 'string' || value.length > 1000) return false;
    try {
        const url = new URL(value);
        return url.protocol === 'https:' || url.protocol === 'http:';
    } catch {
        return false;
    }
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
            `SELECT id, nombre, telefono, email, area, role_ids, category,
                    (SELECT value FROM app_settings WHERE key = 'church_name') AS church_name
             FROM users WHERE id = $1`,
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

app.get('/api/services', getAuthenticatedUser, async (req, res, next) => {
    try {
        const userResult = await pool.query(
            'SELECT role_ids, area FROM users WHERE id = $1',
            [req.auth.sub]
        );
        if (!userResult.rows[0]) {
            res.status(401).json({ success: false, message: 'La cuenta ya no está disponible.' });
            return;
        }
        const canSeeTeam = userResult.rows[0]
            && getUserRoles(userResult.rows[0]).areas.some((area) => [1, 2, 3, 4, 5].includes(area));
        await pool.query(
            `DELETE FROM service_assignments a
             USING service_events e
             WHERE a.event_id = e.id
               AND (e.starts_at AT TIME ZONE 'America/Mexico_City')::date
                   < (NOW() AT TIME ZONE 'America/Mexico_City')::date`
        );
        const result = await pool.query(
            `SELECT e.id, e.title, e.event_type, e.starts_at, e.details, e.created_by,
                    COALESCE(
                        json_agg(
                            json_build_object(
                                'id', a.id,
                                'position', a.position,
                                'userId', u.id,
                                'name', u.nombre,
                                'attendance', a.attendance
                            ) ORDER BY a.position, u.nombre
                        ) FILTER (WHERE a.id IS NOT NULL),
                        '[]'::json
                    ) AS assignments
             FROM service_events e
             LEFT JOIN service_assignments a ON a.event_id = e.id AND $1::boolean
             LEFT JOIN users u ON u.id = a.user_id
             WHERE (e.starts_at AT TIME ZONE 'America/Mexico_City')::date
                   >= (NOW() AT TIME ZONE 'America/Mexico_City')::date
             GROUP BY e.id
             ORDER BY e.starts_at
             LIMIT 100`,
            [Boolean(canSeeTeam)]
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

app.patch('/api/services/:serviceId/attendance', getAuthenticatedUser, async (req, res, next) => {
    const { serviceId } = req.params;
    const attended = req.body?.attended;
    if (!/^[1-9]\d*$/.test(serviceId) || typeof attended !== 'boolean') {
        res.status(400).json({ success: false, message: 'Confirma una asistencia válida.' });
        return;
    }
    try {
        const result = await pool.query(
            `UPDATE service_assignments a
             SET attendance = $1
             FROM service_events e
             WHERE a.event_id = e.id AND a.event_id = $2 AND a.user_id = $3
               AND e.starts_at <= NOW()
               AND e.starts_at > NOW() - INTERVAL '1 day'
             RETURNING a.id`,
            [attended, serviceId, req.auth.sub]
        );
        if (!result.rowCount) {
            res.status(404).json({
                success: false,
                message: 'Solo puedes confirmar asistencia a un culto asignado durante el día del evento.'
            });
            return;
        }
        await pool.query(
            `INSERT INTO audit_logs (actor_id, action, target_type, target_id, details)
             VALUES ($1, 'service.attendance.updated', 'service_event', $2, $3)`,
            [req.auth.sub, serviceId, JSON.stringify({ attended })]
        );
        res.json({ success: true });
    } catch (error) {
        next(error);
    }
});

app.get('/api/announcements', getAuthenticatedUser, async (_req, res, next) => {
    try {
        const result = await pool.query(
            `SELECT id, title, body, created_at
             FROM announcements
             WHERE published = TRUE
             ORDER BY created_at DESC
             LIMIT 100`
        );
        res.json({ success: true, announcements: result.rows });
    } catch (error) {
        next(error);
    }
});

app.post('/api/announcements', getAuthenticatedUser, requireCoordinator, async (req, res, next) => {
    const { title, body } = req.body || {};
    if (typeof title !== 'string' || title.trim().length < 2 || title.trim().length > 160
        || typeof body !== 'string' || !body.trim() || body.trim().length > 4000) {
        res.status(400).json({ success: false, message: 'Revisa el título y el contenido del anuncio.' });
        return;
    }
    try {
        const result = await pool.query(
            `INSERT INTO announcements (title, body, created_by)
             VALUES ($1, $2, $3)
             RETURNING id, title, body, created_at`,
            [title.trim(), body.trim(), req.auth.sub]
        );
        await pool.query(
            `INSERT INTO audit_logs (actor_id, action, target_type, target_id)
             VALUES ($1, 'announcement.created', 'announcement', $2)`,
            [req.auth.sub, result.rows[0].id]
        );
        res.status(201).json({ success: true, announcement: result.rows[0] });
    } catch (error) {
        next(error);
    }
});

app.patch('/api/announcements/:id', getAuthenticatedUser, requireCoordinator, async (req, res, next) => {
    const { title, body } = req.body || {};
    if (!/^[1-9]\d*$/.test(req.params.id)
        || typeof title !== 'string' || title.trim().length < 2 || title.trim().length > 160
        || typeof body !== 'string' || !body.trim() || body.trim().length > 4000) {
        res.status(400).json({ success: false, message: 'Revisa el título y el contenido del anuncio.' });
        return;
    }
    try {
        const result = await pool.query(
            `UPDATE announcements SET title = $1, body = $2
             WHERE id = $3
             RETURNING id`,
            [title.trim(), body.trim(), req.params.id]
        );
        if (!result.rowCount) {
            res.status(404).json({ success: false, message: 'No se encontró ese anuncio.' });
            return;
        }
        await pool.query(
            `INSERT INTO audit_logs (actor_id, action, target_type, target_id)
             VALUES ($1, 'announcement.updated', 'announcement', $2)`,
            [req.auth.sub, req.params.id]
        );
        res.json({ success: true });
    } catch (error) {
        next(error);
    }
});

app.delete('/api/announcements/:id', getAuthenticatedUser, requireCoordinator, async (req, res, next) => {
    if (!/^[1-9]\d*$/.test(req.params.id)) {
        res.status(400).json({ success: false, message: 'El anuncio no es válido.' });
        return;
    }
    try {
        const result = await pool.query(
            'DELETE FROM announcements WHERE id = $1 RETURNING id',
            [req.params.id]
        );
        if (!result.rowCount) {
            res.status(404).json({ success: false, message: 'No se encontró ese anuncio.' });
            return;
        }
        await pool.query(
            `INSERT INTO audit_logs (actor_id, action, target_type, target_id)
             VALUES ($1, 'announcement.deleted', 'announcement', $2)`,
            [req.auth.sub, req.params.id]
        );
        res.json({ success: true });
    } catch (error) {
        next(error);
    }
});

app.get('/api/prayers', getAuthenticatedUser, async (req, res, next) => {
    try {
        const roleResult = await pool.query(
            'SELECT role_ids, area FROM users WHERE id = $1',
            [req.auth.sub]
        );
        const canModerate = roleResult.rows[0]
            && getUserRoles(roleResult.rows[0]).areas.some((area) => [2, 5].includes(area));
        const result = await pool.query(
            `SELECT p.id, p.body, p.status, p.created_at, p.author_id,
                    CASE WHEN p.author_id = $1 OR $2::boolean
                         THEN u.nombre ELSE 'Miembro de la comunidad' END AS author_name,
                    EXISTS (
                        SELECT 1 FROM prayer_support s
                        WHERE s.prayer_id = p.id AND s.user_id = $1
                    ) AS supported,
                    (SELECT COUNT(*)::int FROM prayer_support s WHERE s.prayer_id = p.id) AS support_count
             FROM prayer_requests p
             JOIN users u ON u.id = p.author_id
             WHERE p.status = 'approved' OR p.author_id = $1
                   OR ($2::boolean AND p.status = 'pending')
             ORDER BY p.created_at DESC
             LIMIT 100`,
            [req.auth.sub, Boolean(canModerate)]
        );
        res.json({ success: true, prayers: result.rows });
    } catch (error) {
        next(error);
    }
});

app.post('/api/prayers', getAuthenticatedUser, async (req, res, next) => {
    const body = req.body?.body;
    if (typeof body !== 'string' || body.trim().length < 4 || body.trim().length > 2000) {
        res.status(400).json({ success: false, message: 'Escribe una petición de 4 a 2,000 caracteres.' });
        return;
    }
    try {
        const result = await pool.query(
            `INSERT INTO prayer_requests (author_id, body)
             VALUES ($1, $2)
             RETURNING id, body, status, created_at, author_id`,
            [req.auth.sub, body.trim()]
        );
        await pool.query(
            `INSERT INTO audit_logs (actor_id, action, target_type, target_id)
             VALUES ($1, 'prayer.submitted', 'prayer_request', $2)`,
            [req.auth.sub, result.rows[0].id]
        );
        res.status(201).json({ success: true, prayer: result.rows[0] });
    } catch (error) {
        next(error);
    }
});

app.patch('/api/prayers/:id/moderation', getAuthenticatedUser, requireCoordinator, async (req, res, next) => {
    const { status } = req.body || {};
    if (!/^[1-9]\d*$/.test(req.params.id) || !['approved', 'rejected'].includes(status)) {
        res.status(400).json({ success: false, message: 'La decisión de moderación no es válida.' });
        return;
    }
    try {
        const result = await pool.query(
            `UPDATE prayer_requests SET status = $1, moderated_by = $2, moderated_at = NOW()
             WHERE id = $3 AND status = 'pending'
             RETURNING id`,
            [status, req.auth.sub, req.params.id]
        );
        if (!result.rowCount) {
            res.status(404).json({ success: false, message: 'No se encontró una petición pendiente.' });
            return;
        }
        await pool.query(
            `INSERT INTO audit_logs (actor_id, action, target_type, target_id, details)
             VALUES ($1, 'prayer.moderated', 'prayer_request', $2, $3)`,
            [req.auth.sub, req.params.id, JSON.stringify({ status })]
        );
        res.json({ success: true });
    } catch (error) {
        next(error);
    }
});

app.post('/api/prayers/:id/support', getAuthenticatedUser, async (req, res, next) => {
    if (!/^[1-9]\d*$/.test(req.params.id)) {
        res.status(400).json({ success: false, message: 'La petición no es válida.' });
        return;
    }
    try {
        const result = await pool.query(
            `INSERT INTO prayer_support (prayer_id, user_id)
             SELECT id, $2 FROM prayer_requests WHERE id = $1 AND status = 'approved'
             ON CONFLICT (prayer_id, user_id) DO NOTHING
             RETURNING prayer_id`,
            [req.params.id, req.auth.sub]
        );
        if (!result.rowCount) {
            const prayer = await pool.query(
                'SELECT id FROM prayer_requests WHERE id = $1 AND status = $2',
                [req.params.id, 'approved']
            );
            if (!prayer.rowCount) {
                res.status(404).json({ success: false, message: 'No se encontró una petición aprobada.' });
                return;
            }
        }
        res.json({ success: true });
    } catch (error) {
        next(error);
    }
});

app.delete('/api/prayers/:id/support', getAuthenticatedUser, async (req, res, next) => {
    if (!/^[1-9]\d*$/.test(req.params.id)) {
        res.status(400).json({ success: false, message: 'La petición no es válida.' });
        return;
    }
    try {
        await pool.query(
            'DELETE FROM prayer_support WHERE prayer_id = $1 AND user_id = $2',
            [req.params.id, req.auth.sub]
        );
        res.json({ success: true });
    } catch (error) {
        next(error);
    }
});

app.get('/api/songs', getAuthenticatedUser, requireAreas([1, 2, 5]), async (_req, res, next) => {
    try {
        const result = await pool.query(
            'SELECT id, title, artist, lyrics, chords_url, sheet_url FROM songs ORDER BY title LIMIT 200'
        );
        res.json({ success: true, songs: result.rows });
    } catch (error) {
        next(error);
    }
});

app.post('/api/songs', getAuthenticatedUser, requireAreas([1, 2, 5]), async (req, res, next) => {
    const { title, artist = '', lyrics = '', chordsUrl = '', sheetUrl = '' } = req.body || {};
    if (typeof title !== 'string' || title.trim().length < 2 || title.trim().length > 160
        || typeof artist !== 'string' || artist.length > 160
        || typeof lyrics !== 'string' || lyrics.length > 12000
        || (chordsUrl && !validHttpUrl(chordsUrl)) || (sheetUrl && !validHttpUrl(sheetUrl))) {
        res.status(400).json({ success: false, message: 'Revisa los datos y enlaces de la canción.' });
        return;
    }
    try {
        const result = await pool.query(
            `INSERT INTO songs (title, artist, lyrics, chords_url, sheet_url, created_by)
             VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING id, title, artist, lyrics, chords_url, sheet_url`,
            [title.trim(), artist.trim(), lyrics.trim(), chordsUrl || null, sheetUrl || null, req.auth.sub]
        );
        await pool.query(
            `INSERT INTO audit_logs (actor_id, action, target_type, target_id)
             VALUES ($1, 'song.created', 'song', $2)`,
            [req.auth.sub, result.rows[0].id]
        );
        res.status(201).json({ success: true, song: result.rows[0] });
    } catch (error) {
        next(error);
    }
});

app.delete('/api/songs/:id', getAuthenticatedUser, requireAreas([1, 2, 5]), async (req, res, next) => {
    if (!/^[1-9]\d*$/.test(req.params.id)) {
        res.status(400).json({ success: false, message: 'La canción no es válida.' });
        return;
    }
    try {
        const result = await pool.query('DELETE FROM songs WHERE id = $1 RETURNING id', [req.params.id]);
        if (!result.rowCount) {
            res.status(404).json({ success: false, message: 'No se encontró esa canción.' });
            return;
        }
        await pool.query(
            `INSERT INTO audit_logs (actor_id, action, target_type, target_id)
             VALUES ($1, 'song.deleted', 'song', $2)`,
            [req.auth.sub, req.params.id]
        );
        res.json({ success: true });
    } catch (error) {
        next(error);
    }
});

app.get('/api/resources', getAuthenticatedUser, requireAreas([2, 3, 5]), async (_req, res, next) => {
    try {
        const result = await pool.query(
            'SELECT id, title, category, url, description FROM media_resources ORDER BY category, title LIMIT 200'
        );
        res.json({ success: true, resources: result.rows });
    } catch (error) {
        next(error);
    }
});

app.post('/api/resources', getAuthenticatedUser, requireAreas([2, 3, 5]), async (req, res, next) => {
    const { title, category, url, description = '' } = req.body || {};
    if (typeof title !== 'string' || title.trim().length < 2 || title.trim().length > 160
        || typeof category !== 'string' || !['Imagen', 'Video', 'Logo', 'Banner', 'Otro'].includes(category)
        || !validHttpUrl(url)
        || typeof description !== 'string' || description.length > 500) {
        res.status(400).json({ success: false, message: 'Revisa el nombre, categoría y enlace del recurso.' });
        return;
    }
    try {
        const result = await pool.query(
            `INSERT INTO media_resources (title, category, url, description, created_by)
             VALUES ($1, $2, $3, $4, $5)
             RETURNING id, title, category, url, description`,
            [title.trim(), category, url.trim(), description.trim(), req.auth.sub]
        );
        await pool.query(
            `INSERT INTO audit_logs (actor_id, action, target_type, target_id)
             VALUES ($1, 'resource.created', 'media_resource', $2)`,
            [req.auth.sub, result.rows[0].id]
        );
        res.status(201).json({ success: true, resource: result.rows[0] });
    } catch (error) {
        next(error);
    }
});

app.delete('/api/resources/:id', getAuthenticatedUser, requireAreas([2, 3, 5]), async (req, res, next) => {
    if (!/^[1-9]\d*$/.test(req.params.id)) {
        res.status(400).json({ success: false, message: 'El recurso no es válido.' });
        return;
    }
    try {
        const result = await pool.query('DELETE FROM media_resources WHERE id = $1 RETURNING id', [req.params.id]);
        if (!result.rowCount) {
            res.status(404).json({ success: false, message: 'No se encontró ese recurso.' });
            return;
        }
        await pool.query(
            `INSERT INTO audit_logs (actor_id, action, target_type, target_id)
             VALUES ($1, 'resource.deleted', 'media_resource', $2)`,
            [req.auth.sub, req.params.id]
        );
        res.json({ success: true });
    } catch (error) {
        next(error);
    }
});

app.get('/api/monitor-notes', getAuthenticatedUser, requireAreas([2, 4, 5]), async (_req, res, next) => {
    try {
        const result = await pool.query(
            `SELECT id, musician_name, monitor_type, notes, updated_at
             FROM monitor_notes ORDER BY musician_name LIMIT 100`
        );
        res.json({ success: true, notes: result.rows });
    } catch (error) {
        next(error);
    }
});

app.post('/api/monitor-notes', getAuthenticatedUser, requireAreas([2, 4, 5]), async (req, res, next) => {
    const { musicianName, monitorType, notes } = req.body || {};
    if (typeof musicianName !== 'string' || musicianName.trim().length < 2 || musicianName.trim().length > 150
        || !['In-ear', 'Piso'].includes(monitorType)
        || typeof notes !== 'string' || !notes.trim() || notes.trim().length > 2000) {
        res.status(400).json({ success: false, message: 'Revisa el músico, tipo de monitor y notas.' });
        return;
    }
    try {
        const result = await pool.query(
            `INSERT INTO monitor_notes (musician_name, monitor_type, notes, updated_by)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (musician_name, monitor_type)
             DO UPDATE SET notes = EXCLUDED.notes, updated_by = EXCLUDED.updated_by, updated_at = NOW()
             RETURNING id, musician_name, monitor_type, notes, updated_at`,
            [musicianName.trim(), monitorType, notes.trim(), req.auth.sub]
        );
        await pool.query(
            `INSERT INTO audit_logs (actor_id, action, target_type, target_id, details)
             VALUES ($1, 'monitor.note.updated', 'monitor_note', $2, $3)`,
            [
                req.auth.sub,
                result.rows[0].id,
                JSON.stringify({ musicianName: result.rows[0].musician_name, monitorType })
            ]
        );
        res.status(201).json({ success: true, note: result.rows[0] });
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

app.get('/api/admin/system-status', getAuthenticatedUser, requireMaster, async (_req, res, next) => {
    try {
        await pool.query('SELECT 1');
        res.json({
            success: true,
            api: 'connected',
            database: 'connected',
            checkedAt: new Date().toISOString()
        });
    } catch (error) {
        next(error);
    }
});

app.get('/api/admin/settings', getAuthenticatedUser, requireMaster, async (_req, res, next) => {
    try {
        const result = await pool.query(
            `SELECT value FROM app_settings WHERE key = 'church_name'`
        );
        res.json({
            success: true,
            churchName: result.rows[0]?.value || 'Mi Iglesia'
        });
    } catch (error) {
        next(error);
    }
});

app.put('/api/admin/settings', getAuthenticatedUser, requireMaster, async (req, res, next) => {
    const churchName = req.body?.churchName;
    if (typeof churchName !== 'string' || churchName.trim().length < 2 || churchName.trim().length > 120) {
        res.status(400).json({ success: false, message: 'El nombre de la iglesia debe tener de 2 a 120 caracteres.' });
        return;
    }
    try {
        const result = await pool.query(
            `INSERT INTO app_settings (key, value)
             VALUES ('church_name', $1)
             ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value
             RETURNING value`,
            [churchName.trim()]
        );
        await pool.query(
            `INSERT INTO audit_logs (actor_id, action, target_type, details)
             VALUES ($1, 'system.settings.updated', 'app_setting', $2)`,
            [req.auth.sub, JSON.stringify({ key: 'church_name' })]
        );
        res.json({ success: true, churchName: result.rows[0].value });
    } catch (error) {
        next(error);
    }
});

app.post('/api/admin/users', getAuthenticatedUser, requireMaster, async (req, res, next) => {
    const { nombre, telefono, email, password } = req.body || {};
    const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
    const areas = Object.hasOwn(req.body || {}, 'areas') ? req.body.areas : [6];
    if (typeof nombre !== 'string' || nombre.trim().length < 2 || nombre.trim().length > 150
        || typeof telefono !== 'string' || telefono.trim().length < 7 || telefono.trim().length > 30
        || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail) || normalizedEmail.length > 255
        || typeof password !== 'string' || password.length < 8 || password.length > 72
        || !Array.isArray(areas) || areas.length === 0
        || areas.some((area) => !Number.isInteger(area) || ![1, 2, 3, 4, 6].includes(area))
        || new Set(areas).size !== areas.length) {
        res.status(400).json({ success: false, message: 'Revisa los datos, roles y contraseña del usuario.' });
        return;
    }
    try {
        const passwordHash = await bcrypt.hash(password, 12);
        const result = await pool.query(
            `INSERT INTO users (nombre, telefono, email, password_hash, area, role_ids, category)
             VALUES ($1, $2, $3, $4, $5, $6, 'congregation')
             RETURNING id, nombre, telefono, email, area, role_ids, category, created_at`,
            [nombre.trim(), telefono.trim(), normalizedEmail, passwordHash, areas[0], areas]
        );
        await pool.query(
            `INSERT INTO audit_logs (actor_id, action, target_type, target_id, details)
             VALUES ($1, 'user.created', 'user', $2, $3)`,
            [req.auth.sub, result.rows[0].id, JSON.stringify({ areas })]
        );
        res.status(201).json({
            success: true,
            user: { ...result.rows[0], ...getUserRoles(result.rows[0]) }
        });
    } catch (error) {
        if (error.code === '23505') {
            res.status(409).json({ success: false, message: 'Ya existe una cuenta con ese correo.' });
            return;
        }
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

app.patch('/api/admin/users/:id/password', getAuthenticatedUser, requireMaster, async (req, res, next) => {
    const { password } = req.body || {};
    if (!/^[1-9]\d*$/.test(req.params.id) || typeof password !== 'string'
        || password.length < 8 || password.length > 72) {
        res.status(400).json({ success: false, message: 'La contraseña debe tener de 8 a 72 caracteres.' });
        return;
    }
    if (req.params.id === String(req.auth.sub)) {
        res.status(400).json({ success: false, message: 'Usa Mi perfil para cambiar tu propia contraseña.' });
        return;
    }
    try {
        const passwordHash = await bcrypt.hash(password, 12);
        const result = await pool.query(
            'UPDATE users SET password_hash = $1 WHERE id = $2 RETURNING id',
            [passwordHash, req.params.id]
        );
        if (!result.rowCount) {
            res.status(404).json({ success: false, message: 'No se encontró esa cuenta.' });
            return;
        }
        await pool.query(
            `INSERT INTO audit_logs (actor_id, action, target_type, target_id)
             VALUES ($1, 'user.password.reset', 'user', $2)`,
            [req.auth.sub, req.params.id]
        );
        res.json({ success: true });
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
        ALTER TABLE service_assignments
        ADD COLUMN IF NOT EXISTS attendance BOOLEAN
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
    await pool.query(`
        CREATE TABLE IF NOT EXISTS announcements (
            id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
            title VARCHAR(160) NOT NULL,
            body TEXT NOT NULL,
            published BOOLEAN NOT NULL DEFAULT TRUE,
            created_by BIGINT NOT NULL REFERENCES users(id),
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);
    await pool.query(`
        CREATE TABLE IF NOT EXISTS prayer_requests (
            id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
            author_id BIGINT NOT NULL REFERENCES users(id),
            body TEXT NOT NULL,
            status VARCHAR(20) NOT NULL DEFAULT 'pending'
                CHECK (status IN ('pending', 'approved', 'rejected')),
            moderated_by BIGINT REFERENCES users(id),
            moderated_at TIMESTAMPTZ,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);
    await pool.query(`
        CREATE TABLE IF NOT EXISTS prayer_support (
            prayer_id BIGINT NOT NULL REFERENCES prayer_requests(id) ON DELETE CASCADE,
            user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            PRIMARY KEY (prayer_id, user_id)
        )
    `);
    await pool.query(`
        CREATE TABLE IF NOT EXISTS songs (
            id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
            title VARCHAR(160) NOT NULL,
            artist VARCHAR(160) NOT NULL DEFAULT '',
            lyrics TEXT NOT NULL DEFAULT '',
            chords_url TEXT,
            sheet_url TEXT,
            created_by BIGINT NOT NULL REFERENCES users(id),
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);
    await pool.query(`
        CREATE TABLE IF NOT EXISTS media_resources (
            id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
            title VARCHAR(160) NOT NULL,
            category VARCHAR(20) NOT NULL,
            url TEXT NOT NULL,
            description VARCHAR(500) NOT NULL DEFAULT '',
            created_by BIGINT NOT NULL REFERENCES users(id),
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);
    await pool.query(`
        CREATE TABLE IF NOT EXISTS monitor_notes (
            id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
            musician_name VARCHAR(150) NOT NULL,
            monitor_type VARCHAR(20) NOT NULL CHECK (monitor_type IN ('In-ear', 'Piso')),
            notes TEXT NOT NULL,
            updated_by BIGINT NOT NULL REFERENCES users(id),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            UNIQUE (musician_name, monitor_type)
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

    await pool.query(
        `DELETE FROM service_assignments a
         USING service_events e
         WHERE a.event_id = e.id
           AND (e.starts_at AT TIME ZONE 'America/Mexico_City')::date
               < (NOW() AT TIME ZONE 'America/Mexico_City')::date`
    );
    const assignmentCleanup = setInterval(() => {
        pool.query(
            `DELETE FROM service_assignments a
             USING service_events e
             WHERE a.event_id = e.id
               AND (e.starts_at AT TIME ZONE 'America/Mexico_City')::date
                   < (NOW() AT TIME ZONE 'America/Mexico_City')::date`
        ).catch((error) => console.error('No se pudieron limpiar asignaciones vencidas:', error));
    }, 15 * 60 * 1000);
    assignmentCleanup.unref();

    app.listen(port, () => {
        console.log(`API de Mi Iglesia disponible en el puerto ${port}.`);
    });
}

startServer().catch((error) => {
    console.error('No se pudo iniciar la API:', error);
    process.exit(1);
});
