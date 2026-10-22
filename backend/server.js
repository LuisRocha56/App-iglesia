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

app.get('/api/health', (_req, res) => {
    res.json({ success: true });
});

app.post('/api/register', async (req, res, next) => {
    const { nombre, telefono, email, password } = req.body || {};
    const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';

    if (typeof nombre !== 'string' || nombre.trim().length < 2 || nombre.trim().length > 150
        || typeof telefono !== 'string' || telefono.trim().length < 7 || telefono.trim().length > 30
        || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)
        || normalizedEmail.length > 255
        || typeof password !== 'string' || password.length < 8 || password.length > 72) {
        res.status(400).json({
            success: false,
            message: 'Verifica los datos. La contraseña debe tener al menos 8 caracteres.'
        });
        return;
    }

    try {
        const passwordHash = await bcrypt.hash(password, 12);
        const result = await pool.query(
            `INSERT INTO users (nombre, telefono, email, password_hash, area)
             VALUES ($1, $2, $3, $4, 6)
             RETURNING id, nombre`,
            [nombre.trim(), telefono.trim(), normalizedEmail, passwordHash]
        );
        const user = result.rows[0];

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
            'SELECT id, nombre, password_hash FROM users WHERE email = $1',
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
            user: { id: user.id, nombre: user.nombre }
        });
    } catch (error) {
        next(error);
    }
});

app.get('/api/auth/me', getAuthenticatedUser, async (req, res, next) => {
    try {
        const result = await pool.query(
            'SELECT id, nombre FROM users WHERE id = $1',
            [req.auth.sub]
        );

        if (!result.rows[0]) {
            res.status(401).json({ success: false, message: 'La cuenta ya no está disponible.' });
            return;
        }

        res.json({ success: true, user: result.rows[0] });
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
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);

    app.listen(port, () => {
        console.log(`API de Mi Iglesia disponible en el puerto ${port}.`);
    });
}

startServer().catch((error) => {
    console.error('No se pudo iniciar la API:', error);
    process.exit(1);
});
