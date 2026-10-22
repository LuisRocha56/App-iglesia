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
    1: 'Musico',
    2: 'Coordinador',
    3: 'Multimedia',
    4: 'Sonido',
    5: 'Master',
    6: 'Miembro'
};

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
    pool.query('SELECT area FROM users WHERE id = $1', [req.auth.sub])
        .then((result) => {
            if (!result.rows[0]) {
                res.status(401).json({ success: false, message: 'La cuenta ya no está disponible.' });
                return;
            }

            if (Number(result.rows[0].area) !== 5) {
                res.status(403).json({ success: false, message: 'No tienes permisos de administrador.' });
                return;
            }

            next();
        })
        .catch(next);
}

app.get('/api/health', (_req, res) => {
    res.json({ success: true });
});

app.post('/api/register', async (req, res, next) => {
    const { nombre, telefono, email, password, category } = req.body || {};
    const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
    const normalizedCategory = category === 'worship' ? 'worship' : category === 'congregation' ? 'congregation' : '';

    if (typeof nombre !== 'string' || nombre.trim().length < 2 || nombre.trim().length > 150
        || typeof telefono !== 'string' || telefono.trim().length < 7 || telefono.trim().length > 30
        || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)
        || normalizedEmail.length > 255
        || !normalizedCategory
        || typeof password !== 'string' || password.length < 8 || password.length > 72) {
        res.status(400).json({
            success: false,
            message: 'Verifica los datos, elige un apartado y usa una contraseña de al menos 8 caracteres.'
        });
        return;
    }

    try {
        const passwordHash = await bcrypt.hash(password, 12);
        const result = await pool.query(
            `INSERT INTO users (nombre, telefono, email, password_hash, area, category)
             VALUES ($1, $2, $3, $4, 6, $5)
             RETURNING id, nombre, area, category`,
            [nombre.trim(), telefono.trim(), normalizedEmail, passwordHash, normalizedCategory]
        );
        const user = { ...result.rows[0], role: roleNames[result.rows[0].area] };

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
            'SELECT id, nombre, area, category, password_hash FROM users WHERE email = $1',
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
                category: user.category,
                role: roleNames[user.area]
            }
        });
    } catch (error) {
        next(error);
    }
});

app.get('/api/auth/me', getAuthenticatedUser, async (req, res, next) => {
    try {
        const result = await pool.query(
            'SELECT id, nombre, area, category FROM users WHERE id = $1',
            [req.auth.sub]
        );

        if (!result.rows[0]) {
            res.status(401).json({ success: false, message: 'La cuenta ya no está disponible.' });
            return;
        }

        res.json({
            success: true,
            user: { ...result.rows[0], role: roleNames[result.rows[0].area] }
        });
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

app.get('/api/admin/users', getAuthenticatedUser, requireMaster, async (_req, res, next) => {
    try {
        const result = await pool.query(
            `SELECT id, nombre, email, telefono, area, category, created_at
             FROM users
             ORDER BY nombre, id`
        );
        res.json({
            success: true,
            users: result.rows.map((user) => ({ ...user, role: roleNames[user.area] }))
        });
    } catch (error) {
        next(error);
    }
});

app.patch('/api/admin/users/:id/role', getAuthenticatedUser, requireMaster, async (req, res, next) => {
    const userId = req.params.id;
    const area = Number(req.body?.area);

    if (!/^[1-9]\d*$/.test(userId) || !Number.isInteger(area) || !roleNames[area]) {
        res.status(400).json({ success: false, message: 'Selecciona una cuenta y un rol válido.' });
        return;
    }

    if (userId === String(req.auth.sub)) {
        res.status(400).json({ success: false, message: 'No puedes cambiar tu propio rol.' });
        return;
    }

    try {
        const result = await pool.query(
            'UPDATE users SET area = $1 WHERE id = $2 RETURNING id, nombre, area',
            [area, userId]
        );

        if (!result.rows[0]) {
            res.status(404).json({ success: false, message: 'No se encontró esa cuenta.' });
            return;
        }

        res.json({
            success: true,
            user: { ...result.rows[0], role: roleNames[result.rows[0].area] }
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
            category VARCHAR(20) NOT NULL DEFAULT 'congregation',
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);
    await pool.query(`
        ALTER TABLE users
        ADD COLUMN IF NOT EXISTS category VARCHAR(20) NOT NULL DEFAULT 'congregation'
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
                    'UPDATE users SET area = 5 WHERE email = $1 RETURNING id',
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
