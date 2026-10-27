require('dotenv').config();

const bcrypt = require('bcryptjs');
const cors = require('cors');
const { createHash } = require('node:crypto');
const express = require('express');
const jwt = require('jsonwebtoken');
const { google } = require('googleapis');
const multer = require('multer');
const { Pool } = require('pg');
const webpush = require('web-push');
const seedSongs = require('./cantos-getse.json');

const app = express();
const port = Number(process.env.PORT) || 3000;
const jwtSecret = process.env.JWT_SECRET;
const databaseUrl = process.env.DATABASE_URL;
const masterEmail = process.env.MASTER_EMAIL?.trim().toLowerCase();
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 10 * 1024 * 1024, files: 1 },
    fileFilter(_req, file, callback) {
        const allowedTypes = new Set([
            'image/jpeg', 'image/png', 'image/gif', 'image/webp',
            'application/pdf',
            'application/msword',
            'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
            'application/vnd.ms-powerpoint',
            'application/vnd.openxmlformats-officedocument.presentationml.presentation'
        ]);
        if (allowedTypes.has(file.mimetype)) {
            callback(null, true);
        } else {
            callback(new Error('Tipo de archivo no permitido.'));
        }
    }
});
const roleNames = {
    1: 'Músico',
    2: 'Coordinador',
    3: 'Multimedia',
    4: 'Sonido',
    5: 'Master',
    6: 'Miembro'
};
const servicePositions = new Set([
    'Batería',
    'Corista',
    'Bajo',
    'Guitarra acústica',
    'Guitarra eléctrica',
    'Multimedia - transmisión',
    'Multimedia - letras',
    'Sonido - local',
    'Sonido - transmisión',
    'Cámara 2 - abajo',
    'Dirección'
]);

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

const vapidPublicKey = process.env.VAPID_PUBLIC_KEY?.trim();
const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY?.trim();
const pushEnabled = Boolean(vapidPublicKey && vapidPrivateKey);
if (pushEnabled) {
    webpush.setVapidDetails(
        process.env.VAPID_SUBJECT?.trim() || 'mailto:admin@example.com',
        vapidPublicKey,
        vapidPrivateKey
    );
}

const pool = new Pool({
    connectionString: databaseUrl,
    ssl: process.env.NODE_ENV === 'production'
        ? { rejectUnauthorized: false }
        : undefined
});
let driveClient;

function getDriveClient() {
    if (driveClient) return driveClient;
    if (!process.env.GOOGLE_SERVICE_ACCOUNT_JSON) {
        const error = new Error('La cuenta de servicio de Google Drive no está configurada en el servidor.');
        error.status = 503;
        throw error;
    }
    let credentials;
    try {
        credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON);
    } catch (cause) {
        const error = new Error('La configuración privada de Google Drive no es JSON válido.');
        error.status = 503;
        error.cause = cause;
        throw error;
    }
    const auth = new google.auth.GoogleAuth({
        credentials,
        scopes: ['https://www.googleapis.com/auth/drive']
    });
    driveClient = google.drive({ version: 'v3', auth });
    return driveClient;
}

function hasValidFileSignature(file) {
    const bytes = file.buffer;
    const startsWith = (signature) => signature.every((byte, index) => bytes[index] === byte);
    switch (file.mimetype) {
        case 'image/jpeg':
            return startsWith([0xff, 0xd8, 0xff]);
        case 'image/png':
            return startsWith([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
        case 'image/gif':
            return bytes.subarray(0, 6).toString('ascii').match(/^GIF8[79]a$/) !== null;
        case 'image/webp':
            return bytes.subarray(0, 4).toString('ascii') === 'RIFF'
                && bytes.subarray(8, 12).toString('ascii') === 'WEBP';
        case 'application/pdf':
            return bytes.subarray(0, 5).toString('ascii') === '%PDF-';
        case 'application/msword':
        case 'application/vnd.ms-powerpoint':
            return startsWith([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
        case 'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
        case 'application/vnd.openxmlformats-officedocument.presentationml.presentation':
            return startsWith([0x50, 0x4b, 0x03, 0x04]);
        default:
            return false;
    }
}

async function deleteDriveFile(fileId) {
    if (!fileId) return;
    await getDriveClient().files.delete({ fileId });
}

function isDriveConfigured() {
    return Boolean(process.env.GOOGLE_SERVICE_ACCOUNT_JSON?.trim());
}

function sendPrivateFile(res, file) {
    if (!file?.file_data) {
        res.status(404).json({ success: false, message: 'No se encontró el archivo.' });
        return;
    }
    res.set('Content-Type', file.mime_type)
        .set('Cache-Control', 'private, max-age=3600')
        .send(file.file_data);
}

function parseSongIds(value) {
    if (Array.isArray(value)) return value;
    if (typeof value !== 'string') return value;
    try {
        return JSON.parse(value);
    } catch {
        return null;
    }
}

function isValidDateOnly(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const date = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function getMexicoDateString() {
    return new Intl.DateTimeFormat('en-CA', {
        timeZone: 'America/Monterrey',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit'
    }).format(new Date());
}

async function deleteExpiredAnnouncements() {
    const expired = await pool.query(
        `DELETE FROM announcements
         WHERE expires_on IS NOT NULL
           AND expires_on < (NOW() AT TIME ZONE 'America/Monterrey')::date
         RETURNING id, image_drive_file_id`
    );
    for (const announcement of expired.rows) {
        if (announcement.image_drive_file_id && isDriveConfigured()) {
            try {
                await deleteDriveFile(announcement.image_drive_file_id);
            } catch (error) {
                console.error(`No se pudo borrar de Drive la imagen del anuncio vencido ${announcement.id}:`, error.message);
            }
        } else if (announcement.image_drive_file_id) {
            console.warn(`El anuncio vencido ${announcement.id} tenía una imagen anterior en Drive; no hay credenciales para eliminarla.`);
        }
    }
}

function parseUpload(middleware) {
    return (req, res, next) => {
        middleware(req, res, (error) => {
            if (!error) {
                next();
                return;
            }
            const message = error.code === 'LIMIT_FILE_SIZE'
                ? 'El archivo supera el límite de 10 MB.'
                : error.message;
            res.status(
                error instanceof multer.MulterError || error.message === 'Tipo de archivo no permitido.'
                    ? 400
                    : 500
            )
                .json({ success: false, message });
        });
    };
}

async function validateSongIds(songIds) {
    if (!Array.isArray(songIds) || songIds.length > 40
        || songIds.some((id) => typeof id !== 'string' || !/^[1-9]\d*$/.test(id))
        || new Set(songIds).size !== songIds.length) {
        const error = new Error('Selecciona una lista válida de cantos para el evento.');
        error.status = 400;
        throw error;
    }
    if (!songIds.length) return;
    const result = await pool.query('SELECT id FROM songs WHERE id = ANY($1::bigint[])', [songIds]);
    if (result.rowCount !== songIds.length) {
        const error = new Error('Uno o más cantos seleccionados ya no existen.');
        error.status = 400;
        throw error;
    }
}

async function saveServiceSongs(eventId, songIds) {
    await pool.query('DELETE FROM service_songs WHERE event_id = $1', [eventId]);
    if (songIds.length) {
        await pool.query(
            `INSERT INTO service_songs (event_id, song_id)
             SELECT $1, unnest($2::bigint[])`,
            [eventId, songIds]
        );
    }
}

function sendRouteError(error, res, next) {
    if (error.status) {
        res.status(error.status).json({ success: false, message: error.message });
        return;
    }
    next(error);
}

function normalizeWhatsAppPhone(value) {
    let digits = typeof value === 'string' ? value.replace(/\D/g, '') : '';
    if (digits.startsWith('00')) digits = digits.slice(2);
    if (digits.length === 10) digits = `52${digits}`;
    return digits.length >= 8 && digits.length <= 15 ? digits : null;
}

async function sendAssignmentWhatsApp(assignment, service) {
    const testRecipient = process.env.WHATSAPP_TEST_RECIPIENT?.trim();
    if (!testRecipient && !assignment.whatsapp_opt_in) {
        return { status: 'skipped', reason: 'La persona no aceptó recibir avisos por WhatsApp.' };
    }

    const recipient = normalizeWhatsAppPhone(testRecipient || assignment.telefono);
    if (!recipient) {
        return {
            status: 'failed',
            reason: testRecipient
                ? 'El destinatario de prueba no es un número válido.'
                : 'El teléfono de la cuenta no tiene un formato válido.'
        };
    }

    const {
        WHATSAPP_ACCESS_TOKEN: accessToken,
        WHATSAPP_PHONE_NUMBER_ID: phoneNumberId,
        WHATSAPP_API_VERSION: apiVersion,
        WHATSAPP_TEMPLATE_NAME: templateName
    } = process.env;
    if (!accessToken || !phoneNumberId || !/^v\d+\.\d+$/.test(apiVersion || '') || !templateName) {
        return { status: 'failed', reason: 'Falta configurar WhatsApp Cloud API en el servidor.' };
    }

    const date = new Intl.DateTimeFormat('es-MX', {
        dateStyle: 'full',
        timeStyle: 'short',
        timeZone: 'America/Mexico_City'
    }).format(new Date(service.starts_at));
    try {
        const response = await fetch(
            `https://graph.facebook.com/${apiVersion}/${encodeURIComponent(phoneNumberId)}/messages`,
            {
                method: 'POST',
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    messaging_product: 'whatsapp',
                    recipient_type: 'individual',
                    to: recipient,
                    type: 'template',
                    template: {
                        name: templateName,
                        language: { code: process.env.WHATSAPP_TEMPLATE_LANGUAGE || 'es_MX' },
                        components: [{
                            type: 'body',
                            parameters: [
                                { type: 'text', text: assignment.nombre },
                                { type: 'text', text: assignment.position },
                                { type: 'text', text: service.title },
                                { type: 'text', text: date }
                            ]
                        }]
                    }
                }),
                signal: AbortSignal.timeout(10000)
            }
        );
        if (!response.ok) {
            const result = await response.json().catch(() => ({}));
            console.error('WhatsApp rechazó una notificación de asignación.', {
                status: response.status,
                code: result.error?.code
            });
            return { status: 'failed', reason: `WhatsApp rechazó la plantilla (HTTP ${response.status}).` };
        }
        return { status: 'sent' };
    } catch (error) {
        console.error('No se pudo enviar una notificación de asignación por WhatsApp:', error.message);
        return { status: 'failed', reason: 'No se pudo conectar con WhatsApp Cloud API.' };
    }
}

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

async function saveAssignmentNotifications(assignments, service) {
    if (!assignments.length) return;
    const date = new Intl.DateTimeFormat('es-MX', {
        dateStyle: 'full',
        timeStyle: 'short',
        timeZone: 'America/Mexico_City'
    }).format(new Date(service.starts_at));
    try {
        await pool.query(
            `INSERT INTO user_notifications (user_id, title, body)
             SELECT user_id, 'Se te asignó un puesto', body
             FROM json_to_recordset($1::json) AS n(user_id BIGINT, body TEXT)`,
            [JSON.stringify(assignments.map(({ user_id, position }) => ({
                user_id,
                body: `${position} en ${service.title}. ${date}`
            })))]
        );
    } catch (error) {
        console.error('No se pudieron guardar los avisos de asignación:', error.message);
    }
}

async function sendAssignmentPush(assignments, service) {
    await saveAssignmentNotifications(assignments, service);
    if (!pushEnabled || !assignments.length) return { sent: 0, failed: 0 };

    const positionsByUser = new Map();
    assignments.forEach(({ user_id, position }) => {
        const key = String(user_id);
        positionsByUser.set(key, [...(positionsByUser.get(key) || []), position]);
    });

    let subscriptions;
    try {
        const result = await pool.query(
            'SELECT id, user_id, endpoint, p256dh, auth FROM push_subscriptions WHERE user_id = ANY($1::bigint[])',
            [[...positionsByUser.keys()]]
        );
        subscriptions = result.rows;
    } catch (error) {
        console.error('No se pudieron consultar las suscripciones de notificaciones:', error.message);
        return { sent: 0, failed: 0 };
    }

    const date = new Intl.DateTimeFormat('es-MX', {
        dateStyle: 'full',
        timeStyle: 'short',
        timeZone: 'America/Mexico_City'
    }).format(new Date(service.starts_at));
    const expiredIds = [];
    let sent = 0;
    let failed = 0;

    await Promise.all(subscriptions.map(async (subscription) => {
        const positions = positionsByUser.get(String(subscription.user_id));
        const payload = JSON.stringify({
            title: 'Se te asignó un puesto',
            body: `${positions.join(', ')} en ${service.title}. ${date}`,
            url: '/Inicio.html',
            tag: `assignment-${service.id}`
        });
        try {
            await webpush.sendNotification(
                { endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } },
                payload,
                { TTL: 60 * 60 * 24 }
            );
            sent += 1;
        } catch (error) {
            if (error.statusCode === 404 || error.statusCode === 410) expiredIds.push(subscription.id);
            else console.error('No se pudo enviar una notificación push:', error.statusCode || error.message);
            failed += 1;
        }
    }));

    if (expiredIds.length) {
        await pool.query('DELETE FROM push_subscriptions WHERE id = ANY($1::bigint[])', [expiredIds])
            .catch((error) => console.error('No se pudieron limpiar suscripciones vencidas:', error.message));
    }
    return { sent, failed };
}

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

app.get('/api/push/public-key', getAuthenticatedUser, (_req, res) => {
    res.json({ success: true, enabled: pushEnabled, publicKey: pushEnabled ? vapidPublicKey : null });
});

app.post('/api/push/subscribe', getAuthenticatedUser, async (req, res, next) => {
    const { endpoint, keys } = req.body?.subscription || {};
    if (!pushEnabled) {
        res.status(503).json({ success: false, message: 'Las notificaciones no están configuradas en el servidor.' });
        return;
    }
    if (typeof endpoint !== 'string' || endpoint.length > 2000 || !endpoint.startsWith('https://')
        || typeof keys?.p256dh !== 'string' || keys.p256dh.length > 200
        || typeof keys?.auth !== 'string' || keys.auth.length > 100) {
        res.status(400).json({ success: false, message: 'La suscripción de notificaciones no es válida.' });
        return;
    }
    try {
        await pool.query(
            `INSERT INTO push_subscriptions (user_id, endpoint, p256dh, auth)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (endpoint)
             DO UPDATE SET user_id = EXCLUDED.user_id, p256dh = EXCLUDED.p256dh, auth = EXCLUDED.auth`,
            [req.auth.sub, endpoint, keys.p256dh, keys.auth]
        );
        res.status(201).json({ success: true });
    } catch (error) {
        next(error);
    }
});

app.get('/api/notifications', getAuthenticatedUser, async (req, res, next) => {
    try {
        const result = await pool.query(
            `SELECT id, title, body, created_at
             FROM user_notifications
             WHERE user_id = $1 AND read_at IS NULL
             ORDER BY created_at DESC
             LIMIT 20`,
            [req.auth.sub]
        );
        res.json({ success: true, notifications: result.rows });
    } catch (error) {
        next(error);
    }
});

app.post('/api/notifications/read', getAuthenticatedUser, async (req, res, next) => {
    const ids = req.body?.ids;
    if (!Array.isArray(ids) || ids.length > 50 || ids.some((id) => !/^[1-9]\d*$/.test(String(id)))) {
        res.status(400).json({ success: false, message: 'Los avisos no son válidos.' });
        return;
    }
    try {
        await pool.query(
            `UPDATE user_notifications SET read_at = NOW()
             WHERE user_id = $1 AND read_at IS NULL AND id = ANY($2::bigint[])`,
            [req.auth.sub, ids.map(String)]
        );
        res.json({ success: true });
    } catch (error) {
        next(error);
    }
});

app.post('/api/push/unsubscribe', getAuthenticatedUser, async (req, res, next) => {
    const endpoint = req.body?.endpoint;
    if (typeof endpoint !== 'string' || endpoint.length > 2000) {
        res.status(400).json({ success: false, message: 'La suscripción de notificaciones no es válida.' });
        return;
    }
    try {
        await pool.query(
            'DELETE FROM push_subscriptions WHERE endpoint = $1 AND user_id = $2',
            [endpoint, req.auth.sub]
        );
        res.json({ success: true });
    } catch (error) {
        next(error);
    }
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
                    address_street, address_neighborhood, house_number,
                   whatsapp_opt_in,
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
    const {
        nombre, telefono, email, addressStreet, addressNeighborhood, houseNumber, whatsappOptIn
    } = req.body || {};
    const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
    if (typeof nombre !== 'string' || nombre.trim().length < 2 || nombre.trim().length > 150
        || typeof telefono !== 'string' || telefono.trim().length < 7 || telefono.trim().length > 30
        || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)
        || normalizedEmail.length > 255
        || typeof addressStreet !== 'string' || !addressStreet.trim() || addressStreet.trim().length > 200
        || typeof addressNeighborhood !== 'string' || !addressNeighborhood.trim() || addressNeighborhood.trim().length > 150
        || typeof houseNumber !== 'string' || !houseNumber.trim() || houseNumber.trim().length > 30
        || (whatsappOptIn !== undefined && typeof whatsappOptIn !== 'boolean')) {
        res.status(400).json({ success: false, message: 'Completa tu nombre, teléfono, correo y domicilio.' });
        return;
    }

    try {
        const result = await pool.query(
            `UPDATE users
             SET nombre = $1, telefono = $2, email = $3,
                 address_street = $4, address_neighborhood = $5, house_number = $6,
                 whatsapp_opt_in = COALESCE($7, whatsapp_opt_in)
             WHERE id = $8
             RETURNING id, nombre, telefono, email, area, role_ids, category,
                       address_street, address_neighborhood, house_number, whatsapp_opt_in`,
            [
                nombre.trim(), telefono.trim(), normalizedEmail,
                addressStreet.trim(), addressNeighborhood.trim(), houseNumber.trim(),
                typeof whatsappOptIn === 'boolean' ? whatsappOptIn : null,
                req.auth.sub
            ]
        );
        if (!result.rows[0]) {
            res.status(401).json({ success: false, message: 'La cuenta ya no está disponible.' });
            return;
        }
        await pool.query(
            `INSERT INTO audit_logs (actor_id, action, target_type, target_id, details)
             VALUES ($1, 'user.profile.updated', 'user', $1, $2::JSONB)`,
            [req.auth.sub, JSON.stringify(typeof whatsappOptIn === 'boolean' ? { whatsappOptIn } : {})]
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
            `SELECT id, nombre, email, telefono, role_ids, area, category
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
        const canSeeProgram = Boolean(canSeeTeam);
        await pool.query(
            `DELETE FROM service_assignments a
             USING service_events e
             WHERE a.event_id = e.id
               AND (e.starts_at AT TIME ZONE 'America/Mexico_City')::date
                   < (NOW() AT TIME ZONE 'America/Mexico_City')::date`
        );
        const result = await pool.query(
            `SELECT e.id, e.title, e.event_type, e.starts_at, e.details, e.image_url,
                    (e.image_data IS NOT NULL OR e.image_url IS NOT NULL) AS has_image,
                    e.created_by,
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
                    ) AS assignments,
                    (
                        SELECT COALESCE(
                            json_agg(
                                json_build_object(
                                    'id', s.id,
                                    'title', s.title,
                                    'author', COALESCE(NULLIF(s.author, ''), s.artist)
                                ) ORDER BY ss.id
                            ),
                            '[]'::json
                        )
                        FROM service_songs ss
                        JOIN songs s ON s.id = ss.song_id
                        WHERE ss.event_id = e.id AND $2::boolean
                    ) AS songs
             FROM service_events e
             LEFT JOIN service_assignments a ON a.event_id = e.id AND $1::boolean
             LEFT JOIN users u ON u.id = a.user_id
             WHERE (e.starts_at AT TIME ZONE 'America/Mexico_City')::date
                   >= (NOW() AT TIME ZONE 'America/Mexico_City')::date
             GROUP BY e.id
             ORDER BY e.starts_at
             LIMIT 100`,
            [Boolean(canSeeTeam), canSeeProgram]
        );
        res.json({ success: true, services: result.rows });
    } catch (error) {
        next(error);
    }
});

app.get('/api/services/:id/image', getAuthenticatedUser, async (req, res, next) => {
    if (!/^[1-9]\d*$/.test(req.params.id)) {
        res.status(400).json({ success: false, message: 'El evento no es válido.' });
        return;
    }
    try {
        const result = await pool.query(
            'SELECT image_data AS file_data, image_mime_type AS mime_type FROM service_events WHERE id = $1',
            [req.params.id]
        );
        sendPrivateFile(res, result.rows[0]);
    } catch (error) {
        next(error);
    }
});

app.post('/api/services', getAuthenticatedUser, requireCoordinator, parseUpload(upload.single('image')), async (req, res, next) => {
    const { title, eventType, startsAt, details = '' } = req.body || {};
    const songIds = parseSongIds(req.body?.songIds ?? []);
    const startDate = typeof startsAt === 'string' ? new Date(startsAt) : null;
    const validTypes = ['Culto', 'Ensayo', 'Evento especial'];
    if (typeof title !== 'string' || title.trim().length < 2 || title.trim().length > 120
        || !validTypes.includes(eventType)
        || !startDate || Number.isNaN(startDate.getTime())
        || typeof details !== 'string' || details.length > 2000
        || !Array.isArray(songIds)
        || (req.file && (!req.file.mimetype.startsWith('image/') || !hasValidFileSignature(req.file)))) {
        res.status(400).json({ success: false, message: 'Revisa el nombre, tipo, fecha, detalles, cantos e imagen del evento.' });
        return;
    }

    try {
        await validateSongIds(songIds);
        const result = await pool.query(
            `INSERT INTO service_events (
                 title, event_type, starts_at, details, image_data, image_mime_type, created_by
             )
             VALUES ($1, $2, $3, $4, $5, $6, $7)
             RETURNING id, title, event_type, starts_at, details`,
            [
                title.trim(), eventType, startDate.toISOString(), details.trim(),
                req.file?.buffer || null, req.file?.mimetype || null,
                req.auth.sub
            ]
        );
        await saveServiceSongs(result.rows[0].id, songIds);
        await pool.query(
            `INSERT INTO audit_logs (actor_id, action, target_type, target_id, details)
             VALUES ($1, 'service.created', 'service_event', $2, $3)`,
            [req.auth.sub, result.rows[0].id, JSON.stringify({ title: result.rows[0].title })]
        );
        res.status(201).json({ success: true, service: { ...result.rows[0], assignments: [] } });
    } catch (error) {
        sendRouteError(error, res, next);
    }
});

app.patch('/api/services/:id', getAuthenticatedUser, requireCoordinator, parseUpload(upload.single('image')), async (req, res, next) => {
    const serviceId = req.params.id;
    const { title, eventType, startsAt, details = '' } = req.body || {};
    const songIds = parseSongIds(req.body?.songIds ?? []);
    const startDate = typeof startsAt === 'string' ? new Date(startsAt) : null;
    const validTypes = ['Culto', 'Ensayo', 'Evento especial'];
    if (!/^[1-9]\d*$/.test(serviceId)
        || typeof title !== 'string' || title.trim().length < 2 || title.trim().length > 120
        || !validTypes.includes(eventType)
        || !startDate || Number.isNaN(startDate.getTime())
        || typeof details !== 'string' || details.length > 2000
        || !Array.isArray(songIds)
        || (req.file && (!req.file.mimetype.startsWith('image/') || !hasValidFileSignature(req.file)))) {
        res.status(400).json({ success: false, message: 'Revisa el nombre, tipo, fecha, detalles, cantos e imagen del evento.' });
        return;
    }

    try {
        await validateSongIds(songIds);
        const result = await pool.query(
            `UPDATE service_events
             SET title = $1, event_type = $2, starts_at = $3, details = $4,
                 image_data = COALESCE($5, image_data),
                 image_mime_type = COALESCE($6, image_mime_type),
                 image_url = CASE WHEN $5::BYTEA IS NOT NULL THEN NULL ELSE image_url END
             WHERE id = $7
             RETURNING id, title, event_type, starts_at, details`,
            [
                title.trim(), eventType, startDate.toISOString(), details.trim(),
                req.file?.buffer || null, req.file?.mimetype || null,
                serviceId
            ]
        );
        if (!result.rows[0]) {
            res.status(404).json({ success: false, message: 'No se encontró ese culto o evento.' });
            return;
        }
        await saveServiceSongs(serviceId, songIds);
        await pool.query(
            `INSERT INTO audit_logs (actor_id, action, target_type, target_id, details)
             VALUES ($1, 'service.updated', 'service_event', $2, $3)`,
            [req.auth.sub, serviceId, JSON.stringify({ title: result.rows[0].title })]
        );
        res.json({ success: true, service: result.rows[0] });
    } catch (error) {
        sendRouteError(error, res, next);
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
        || !servicePositions.has(position)) {
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
        if (!areas.some((area) => [1, 2, 3, 4, 5].includes(area))) {
            res.status(403).json({ success: false, message: 'Solo se pueden asignar integrantes con un rol de equipo.' });
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
        const service = await pool.query('SELECT id, title, starts_at FROM service_events WHERE id = $1', [serviceId]);
        const push = await sendAssignmentPush(result.rows, service.rows[0]);
        res.status(201).json({ success: true, assignment: { ...result.rows[0], name: user.nombre }, push });
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

app.post('/api/services/:serviceId/assignments/batch', getAuthenticatedUser, requireCoordinator, async (req, res, next) => {
    const serviceId = req.params.serviceId;
    const rawAssignments = req.body?.assignments;
    if (!/^[1-9]\d*$/.test(serviceId) || !Array.isArray(rawAssignments)
        || rawAssignments.length < 1 || rawAssignments.length > 40) {
        res.status(400).json({ success: false, message: 'Agrega entre 1 y 40 asignaciones válidas.' });
        return;
    }

    const assignments = rawAssignments.map((item) => ({
        userId: String(item?.userId || ''),
        position: item?.position
    }));
    if (assignments.some(({ userId, position }) =>
        !/^[1-9]\d*$/.test(userId) || !servicePositions.has(position))) {
        res.status(400).json({ success: false, message: 'Hay una persona o puesto inválido en la lista.' });
        return;
    }
    const userIds = [...new Set(assignments.map(({ userId }) => userId))];
    const exactAssignments = new Set();
    const operationalUsers = new Set();
    for (const assignment of assignments) {
        const key = `${assignment.userId}:${assignment.position}`;
        if (exactAssignments.has(key)
            || (assignment.position !== 'Dirección' && operationalUsers.has(assignment.userId))) {
            res.status(409).json({
                success: false,
                message: 'La lista contiene puestos repetidos o más de un puesto operativo para una persona.'
            });
            return;
        }
        exactAssignments.add(key);
        if (assignment.position !== 'Dirección') operationalUsers.add(assignment.userId);
    }

    let client;
    try {
        client = await pool.connect();
        await client.query('BEGIN');
        const serviceResult = await client.query(
            'SELECT id, title, starts_at FROM service_events WHERE id = $1 FOR UPDATE',
            [serviceId]
        );
        const service = serviceResult.rows[0];
        if (!service) {
            const error = new Error('No se encontró ese culto o evento.');
            error.status = 404;
            throw error;
        }

        const usersResult = await client.query(
            'SELECT id, nombre, telefono, whatsapp_opt_in, role_ids, area FROM users WHERE id = ANY($1::bigint[])',
            [userIds]
        );
        const users = new Map(usersResult.rows.map((user) => [String(user.id), user]));
        if (users.size !== userIds.length) {
            const error = new Error('No se encontró una o más cuentas de la lista.');
            error.status = 404;
            throw error;
        }
        const existingResult = await client.query(
            'SELECT user_id, position FROM service_assignments WHERE event_id = $1',
            [serviceId]
        );
        const existingByUser = new Map();
        existingResult.rows.forEach(({ user_id, position }) => {
            const userKey = String(user_id);
            if (!existingByUser.has(userKey)) existingByUser.set(userKey, []);
            existingByUser.get(userKey).push(position);
        });
        const nextByUser = new Map();
        for (const assignment of assignments) {
            const user = users.get(assignment.userId);
            const { areas } = getUserRoles(user);
            if (!areas.some((area) => [1, 2, 3, 4, 5].includes(area))) {
                const error = new Error(`${user.nombre} no tiene un rol de equipo y no puede recibir asignaciones.`);
                error.status = 403;
                throw error;
            }

            const existingPositions = existingByUser.get(assignment.userId) || [];
            const pendingPositions = nextByUser.get(assignment.userId) || [];
            if (existingPositions.includes(assignment.position)
                || pendingPositions.includes(assignment.position)
                || (assignment.position !== 'Dirección'
                    && [...existingPositions, ...pendingPositions].some((position) => position !== 'Dirección'))) {
                const error = new Error(`${user.nombre} ya tiene un puesto operativo o este puesto en el evento.`);
                error.status = 409;
                throw error;
            }
            nextByUser.set(assignment.userId, [...pendingPositions, assignment.position]);
        }

        const savedAssignments = [];
        for (const assignment of assignments) {
            const result = await client.query(
                `INSERT INTO service_assignments (event_id, user_id, position, assigned_by)
                 VALUES ($1, $2, $3, $4)
                 RETURNING id, event_id, user_id, position`,
                [serviceId, assignment.userId, assignment.position, req.auth.sub]
            );
            const user = users.get(assignment.userId);
            savedAssignments.push({
                ...result.rows[0],
                nombre: user.nombre,
                telefono: user.telefono,
                whatsapp_opt_in: user.whatsapp_opt_in
            });
            await client.query(
                `INSERT INTO audit_logs (actor_id, action, target_type, target_id, details)
                 VALUES ($1, 'service.assignment.created', 'service_assignment', $2, $3::JSONB)`,
                [req.auth.sub, result.rows[0].id, JSON.stringify({ serviceId, userId: assignment.userId, position: assignment.position })]
            );
        }
        await client.query('COMMIT');
        client.release();
        client = null;

        const notificationResults = await Promise.all(
            savedAssignments.map(async (assignment) => ({
                name: assignment.nombre,
                ...(await sendAssignmentWhatsApp(assignment, service))
            }))
        );
        const push = await sendAssignmentPush(savedAssignments, service);
        const notifications = {
            push,
            sent: notificationResults.filter((result) => result.status === 'sent').map(({ name }) => name),
            failed: notificationResults.filter((result) => result.status === 'failed')
                .map(({ name, reason }) => ({ name, reason })),
            skipped: notificationResults.filter((result) => result.status === 'skipped')
                .map(({ name, reason }) => ({ name, reason }))
        };
        res.status(201).json({
            success: true,
            assignments: savedAssignments.map(({ id, event_id, user_id, position, nombre }) => ({
                id, event_id, user_id, position, name: nombre
            })),
            notifications
        });
    } catch (error) {
        if (client) {
            try {
                await client.query('ROLLBACK');
            } catch (rollbackError) {
                console.error('No se pudo revertir el lote de asignaciones:', rollbackError.message);
            }
            client.release();
        }
        if (error.code === '23505') {
            res.status(409).json({
                success: false,
                message: 'Una persona ya tiene un puesto operativo o ya está asignada a ese puesto.'
            });
            return;
        }
        if (error.code === '23503') {
            res.status(404).json({ success: false, message: 'No se encontró el culto o una cuenta de la lista.' });
            return;
        }
        if (error.status) {
            res.status(error.status).json({ success: false, message: error.message });
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
        await deleteExpiredAnnouncements();
        const result = await pool.query(
            `SELECT id, title, body, image_url,
                    (image_data IS NOT NULL OR image_url IS NOT NULL) AS has_image,
                    expires_on, created_at
             FROM announcements
             WHERE published = TRUE
               AND (expires_on IS NULL
                    OR expires_on >= (NOW() AT TIME ZONE 'America/Monterrey')::date)
             ORDER BY created_at DESC
             LIMIT 100`
        );
        res.json({ success: true, announcements: result.rows });
    } catch (error) {
        next(error);
    }
});

app.get('/api/announcements/:id/image', getAuthenticatedUser, async (req, res, next) => {
    if (!/^[1-9]\d*$/.test(req.params.id)) {
        res.status(400).json({ success: false, message: 'El anuncio no es válido.' });
        return;
    }
    try {
        const result = await pool.query(
            `SELECT image_data AS file_data, image_mime_type AS mime_type
             FROM announcements
             WHERE id = $1 AND published = TRUE
               AND (expires_on IS NULL
                    OR expires_on >= (NOW() AT TIME ZONE 'America/Monterrey')::date)`,
            [req.params.id]
        );
        sendPrivateFile(res, result.rows[0]);
    } catch (error) {
        next(error);
    }
});

app.post('/api/announcements', getAuthenticatedUser, requireCoordinator, parseUpload(upload.single('image')), async (req, res, next) => {
    const { title, body, expiresOn } = req.body || {};
    if (typeof title !== 'string' || title.trim().length < 2 || title.trim().length > 160
        || typeof body !== 'string' || !body.trim() || body.trim().length > 4000
        || !isValidDateOnly(expiresOn) || expiresOn < getMexicoDateString()
        || (req.file && (!req.file.mimetype.startsWith('image/') || !hasValidFileSignature(req.file)))) {
        res.status(400).json({ success: false, message: 'Revisa el título, contenido, fecha de fin e imagen del anuncio.' });
        return;
    }
    try {
        const result = await pool.query(
            `INSERT INTO announcements (
                 title, body, image_data, image_mime_type, expires_on, created_by
             )
             VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING id, title, body, expires_on, created_at`,
            [
                title.trim(), body.trim(), req.file?.buffer || null, req.file?.mimetype || null,
                expiresOn, req.auth.sub
            ]
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

app.patch('/api/announcements/:id', getAuthenticatedUser, requireCoordinator, parseUpload(upload.single('image')), async (req, res, next) => {
    const { title, body, expiresOn } = req.body || {};
    if (!/^[1-9]\d*$/.test(req.params.id)
        || typeof title !== 'string' || title.trim().length < 2 || title.trim().length > 160
        || typeof body !== 'string' || !body.trim() || body.trim().length > 4000
        || !isValidDateOnly(expiresOn) || expiresOn < getMexicoDateString()
        || (req.file && (!req.file.mimetype.startsWith('image/') || !hasValidFileSignature(req.file)))) {
        res.status(400).json({ success: false, message: 'Revisa el título, contenido, fecha de fin e imagen del anuncio.' });
        return;
    }
    try {
        const previous = await pool.query(
            'SELECT image_drive_file_id FROM announcements WHERE id = $1',
            [req.params.id]
        );
        if (!previous.rowCount) {
            res.status(404).json({ success: false, message: 'No se encontró ese anuncio.' });
            return;
        }
        const result = await pool.query(
            `UPDATE announcements
             SET title = $1, body = $2,
                  image_url = CASE WHEN $3::BYTEA IS NOT NULL THEN NULL ELSE image_url END,
                  image_data = COALESCE($3, image_data),
                  image_mime_type = COALESCE($4, image_mime_type),
                  image_drive_file_id = CASE WHEN $3::BYTEA IS NOT NULL THEN NULL ELSE image_drive_file_id END,
                  expires_on = $5
             WHERE id = $6
             RETURNING id`,
            [
                 title.trim(), body.trim(), req.file?.buffer || null, req.file?.mimetype || null,
                 expiresOn, req.params.id
            ]
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
        if (req.file && previous.rows[0].image_drive_file_id) {
            try {
                await deleteDriveFile(previous.rows[0].image_drive_file_id);
            } catch (cleanupError) {
                console.error('No se pudo eliminar la imagen anterior del anuncio:', cleanupError);
            }
        }
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
        const existing = await pool.query(
            'SELECT image_drive_file_id FROM announcements WHERE id = $1',
            [req.params.id]
        );
        if (!existing.rowCount) {
            res.status(404).json({ success: false, message: 'No se encontró ese anuncio.' });
            return;
        }
        if (existing.rows[0].image_drive_file_id && isDriveConfigured()) {
            await deleteDriveFile(existing.rows[0].image_drive_file_id);
        } else if (existing.rows[0].image_drive_file_id) {
            console.warn(`El anuncio ${req.params.id} tenía una imagen anterior en Drive; no hay credenciales para eliminarla.`);
        }
        const result = await pool.query(
            'DELETE FROM announcements WHERE id = $1 RETURNING id',
            [req.params.id]
        );
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

app.get('/api/songs', getAuthenticatedUser, requireAreas([1, 2, 3, 5]), async (_req, res, next) => {
    try {
        const result = await pool.query(
            `SELECT s.id, s.title,
                    COALESCE(NULLIF(s.author, ''), s.artist) AS author,
                    s.has_sequence, s.lyrics, s.chords, s.chords_url, s.sheet_url,
                    s.created_at, s.updated_at,
                    MAX(e.starts_at) FILTER (WHERE e.starts_at <= NOW()) AS last_played_at
             FROM songs s
             LEFT JOIN service_songs ss ON ss.song_id = s.id
             LEFT JOIN service_events e ON e.id = ss.event_id
             GROUP BY s.id
             ORDER BY s.title
             LIMIT 500`
        );
        res.json({ success: true, songs: result.rows });
    } catch (error) {
        next(error);
    }
});

app.post('/api/songs', getAuthenticatedUser, requireAreas([1, 2, 3, 5]), async (req, res, next) => {
    const {
        title, author = '', artist = '', hasSequence = false,
        lyrics = '', chords = '', chordsUrl = '', sheetUrl = ''
    } = req.body || {};
    if (typeof title !== 'string' || title.trim().length < 2 || title.trim().length > 160
        || typeof author !== 'string' || author.length > 160
        || typeof artist !== 'string' || artist.length > 160
        || typeof hasSequence !== 'boolean'
        || typeof lyrics !== 'string' || lyrics.length > 12000
        || typeof chords !== 'string' || chords.length > 12000
        || (chordsUrl && !validHttpUrl(chordsUrl)) || (sheetUrl && !validHttpUrl(sheetUrl))) {
        res.status(400).json({ success: false, message: 'Revisa los datos y enlaces de la canción.' });
        return;
    }
    try {
        const result = await pool.query(
            `INSERT INTO songs (title, author, artist, has_sequence, lyrics, chords, chords_url, sheet_url, created_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
             RETURNING id, title, author, has_sequence, lyrics, chords, chords_url, sheet_url, created_at, updated_at`,
            [
                title.trim(), author.trim() || artist.trim(), artist.trim(), hasSequence,
                lyrics.trim(), chords.trim(), chordsUrl || null, sheetUrl || null, req.auth.sub
            ]
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

app.patch('/api/songs/:id', getAuthenticatedUser, requireAreas([1, 2, 3, 5]), async (req, res, next) => {
    if (!/^[1-9]\d*$/.test(req.params.id)) {
        res.status(400).json({ success: false, message: 'La canción no es válida.' });
        return;
    }
    const {
        title, author = '', artist = '', hasSequence = false,
        lyrics = '', chords = '', chordsUrl = '', sheetUrl = ''
    } = req.body || {};
    if (typeof title !== 'string' || title.trim().length < 2 || title.trim().length > 160
        || typeof author !== 'string' || author.length > 160
        || typeof artist !== 'string' || artist.length > 160
        || typeof hasSequence !== 'boolean'
        || typeof lyrics !== 'string' || lyrics.length > 12000
        || typeof chords !== 'string' || chords.length > 12000
        || (chordsUrl && !validHttpUrl(chordsUrl)) || (sheetUrl && !validHttpUrl(sheetUrl))) {
        res.status(400).json({ success: false, message: 'Revisa los datos y enlaces de la canción.' });
        return;
    }
    try {
        const result = await pool.query(
            `UPDATE songs
             SET title = $1, author = $2, artist = $3, has_sequence = $4,
                 lyrics = $5, chords = $6, chords_url = $7, sheet_url = $8, updated_at = NOW()
             WHERE id = $9
             RETURNING id, title, author, has_sequence, lyrics, chords, chords_url, sheet_url, created_at, updated_at`,
            [
                title.trim(), author.trim() || artist.trim(), artist.trim(), hasSequence,
                lyrics.trim(), chords.trim(), chordsUrl || null, sheetUrl || null, req.params.id
            ]
        );
        if (!result.rowCount) {
            res.status(404).json({ success: false, message: 'No se encontró esa canción.' });
            return;
        }
        await pool.query(
            `INSERT INTO audit_logs (actor_id, action, target_type, target_id)
             VALUES ($1, 'song.updated', 'song', $2)`,
            [req.auth.sub, req.params.id]
        );
        res.json({ success: true, song: result.rows[0] });
    } catch (error) {
        next(error);
    }
});

app.delete('/api/songs/:id', getAuthenticatedUser, requireAreas([1, 2, 3, 5]), async (req, res, next) => {
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
            `SELECT id, title, category, url, drive_file_id, description,
                    (file_data IS NOT NULL) AS has_file_data
             FROM media_resources
             ORDER BY category, title
             LIMIT 200`
        );
        res.json({ success: true, resources: result.rows });
    } catch (error) {
        next(error);
    }
});

app.get('/api/resources/:id/content', getAuthenticatedUser, requireAreas([2, 3, 5]), async (req, res, next) => {
    if (!/^[1-9]\d*$/.test(req.params.id)) {
        res.status(400).json({ success: false, message: 'El recurso no es válido.' });
        return;
    }
    try {
        const result = await pool.query(
            'SELECT file_data, mime_type FROM media_resources WHERE id = $1',
            [req.params.id]
        );
        sendPrivateFile(res, result.rows[0]);
    } catch (error) {
        next(error);
    }
});

app.post('/api/resources', getAuthenticatedUser, requireAreas([2, 3, 5]), parseUpload(upload.single('file')), async (req, res, next) => {
    const { title, category, description = '' } = req.body || {};
    if (typeof title !== 'string' || title.trim().length < 2 || title.trim().length > 160
        || typeof category !== 'string' || !['Imagen', 'Video', 'Logo', 'Banner', 'Otro'].includes(category)
        || !req.file || !req.file.mimetype.startsWith('image/') || !hasValidFileSignature(req.file)
        || typeof description !== 'string' || description.length > 500) {
        res.status(400).json({ success: false, message: 'Selecciona una imagen e ingresa un nombre y categoría válidos.' });
        return;
    }
    try {
        const result = await pool.query(
            `INSERT INTO media_resources (
                 title, category, url, drive_file_id, file_data, mime_type, description, created_by
             )
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
             RETURNING id, title, category, url, description`,
            [
                title.trim(), category, '', null, req.file.buffer, req.file.mimetype,
                description.trim(), req.auth.sub
            ]
        );
        await pool.query(
            `INSERT INTO audit_logs (actor_id, action, target_type, target_id)
             VALUES ($1, 'resource.created', 'media_resource', $2)`,
            [req.auth.sub, result.rows[0].id]
        );
        res.status(201).json({
            success: true,
            storage: 'database',
            resource: result.rows[0]
        });
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
        const existing = await pool.query(
            'SELECT drive_file_id FROM media_resources WHERE id = $1',
            [req.params.id]
        );
        if (!existing.rowCount) {
            res.status(404).json({ success: false, message: 'No se encontró ese recurso.' });
            return;
        }
        if (existing.rows[0].drive_file_id && isDriveConfigured()) {
            await deleteDriveFile(existing.rows[0].drive_file_id);
        } else if (existing.rows[0].drive_file_id) {
            console.warn(`El recurso ${req.params.id} tenía un archivo anterior en Drive; no hay credenciales para eliminarlo.`);
        }
        const result = await pool.query('DELETE FROM media_resources WHERE id = $1 RETURNING id', [req.params.id]);
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

app.get('/api/sound-files', getAuthenticatedUser, requireAreas([2, 4, 5]), async (_req, res, next) => {
    try {
        const result = await pool.query(
            `SELECT f.id, f.title, f.url, f.mime_type, f.created_at, u.nombre AS uploader,
                    (f.file_data IS NOT NULL) AS has_file_data
             FROM sound_files f
             JOIN users u ON u.id = f.uploaded_by
             ORDER BY f.created_at DESC
             LIMIT 100`
        );
        res.json({ success: true, files: result.rows });
    } catch (error) {
        next(error);
    }
});

app.get('/api/sound-files/:id/content', getAuthenticatedUser, requireAreas([2, 4, 5]), async (req, res, next) => {
    if (!/^[1-9]\d*$/.test(req.params.id)) {
        res.status(400).json({ success: false, message: 'El archivo no es válido.' });
        return;
    }
    try {
        const result = await pool.query(
            'SELECT file_data, mime_type FROM sound_files WHERE id = $1',
            [req.params.id]
        );
        sendPrivateFile(res, result.rows[0]);
    } catch (error) {
        next(error);
    }
});

app.post('/api/sound-files', getAuthenticatedUser, requireAreas([2, 4, 5]), parseUpload(upload.single('file')), async (req, res, next) => {
    const title = req.body?.title;
    if (typeof title !== 'string' || title.trim().length < 2 || title.trim().length > 160
        || !req.file || req.file.mimetype.startsWith('image/') || !hasValidFileSignature(req.file)) {
        res.status(400).json({ success: false, message: 'Selecciona un manual PDF, Word o PowerPoint y escribe su nombre.' });
        return;
    }
    try {
        const result = await pool.query(
            `INSERT INTO sound_files (title, drive_file_id, url, mime_type, file_data, uploaded_by)
             VALUES ($1, $2, $3, $4, $5, $6)
             RETURNING id, title, drive_file_id, url, mime_type, created_at`,
            [
                title.trim(), null, '', req.file.mimetype, req.file.buffer, req.auth.sub
            ]
        );
        await pool.query(
            `INSERT INTO audit_logs (actor_id, action, target_type, target_id)
             VALUES ($1, 'sound.manual.uploaded', 'sound_file', $2)`,
            [req.auth.sub, result.rows[0].id]
        );
        res.status(201).json({
            success: true,
            storage: 'database',
            file: result.rows[0]
        });
    } catch (error) {
        next(error);
    }
});

app.delete('/api/sound-files/:id', getAuthenticatedUser, requireAreas([2, 4, 5]), async (req, res, next) => {
    if (!/^[1-9]\d*$/.test(req.params.id)) {
        res.status(400).json({ success: false, message: 'El archivo no es válido.' });
        return;
    }
    try {
        const existing = await pool.query('SELECT drive_file_id FROM sound_files WHERE id = $1', [req.params.id]);
        if (!existing.rowCount) {
            res.status(404).json({ success: false, message: 'No se encontró ese archivo.' });
            return;
        }
        if (existing.rows[0].drive_file_id && isDriveConfigured()) {
            await deleteDriveFile(existing.rows[0].drive_file_id);
        } else if (existing.rows[0].drive_file_id) {
            console.warn(`El archivo ${req.params.id} tenía un manual anterior en Drive; no hay credenciales para eliminarlo.`);
        }
        await pool.query('DELETE FROM sound_files WHERE id = $1', [req.params.id]);
        await pool.query(
            `INSERT INTO audit_logs (actor_id, action, target_type, target_id)
             VALUES ($1, 'sound.manual.deleted', 'sound_file', $2)`,
            [req.auth.sub, req.params.id]
        );
        res.json({ success: true });
    } catch (error) {
        next(error);
    }
});

app.get('/api/admin/audit-logs', getAuthenticatedUser, requireMaster, async (req, res, next) => {
    const page = Number(req.query.page || 1);
    if (!Number.isSafeInteger(page) || page < 1 || page > 1000000) {
        res.status(400).json({ success: false, message: 'La página de auditoría no es válida.' });
        return;
    }
    try {
        const [result, countResult] = await Promise.all([
            pool.query(
            `SELECT l.id, l.action, l.target_type, l.target_id, l.details, l.created_at,
                    u.nombre AS actor_name
             FROM audit_logs l
             LEFT JOIN users u ON u.id = l.actor_id
             ORDER BY l.created_at DESC, l.id DESC
             LIMIT 10 OFFSET $1`,
            [(page - 1) * 10]
            ),
            pool.query('SELECT COUNT(*)::int AS total FROM audit_logs')
        ]);
        const total = countResult.rows[0].total;
        res.json({
            success: true,
            logs: result.rows,
            page,
            pageSize: 10,
            total,
            pageCount: Math.ceil(total / 10)
        });
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
    const status = error.status === 403 ? 503 : error.status || 500;
    const message = status < 500 || status === 503
        ? error.message
        : 'Ocurrió un error en el servidor.';
    res.status(status).json({ success: false, message });
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
            address_street VARCHAR(200) NOT NULL DEFAULT '',
            address_neighborhood VARCHAR(150) NOT NULL DEFAULT '',
            house_number VARCHAR(30) NOT NULL DEFAULT '',
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
        ALTER TABLE users
        ADD COLUMN IF NOT EXISTS address_street VARCHAR(200) NOT NULL DEFAULT '',
        ADD COLUMN IF NOT EXISTS address_neighborhood VARCHAR(150) NOT NULL DEFAULT '',
        ADD COLUMN IF NOT EXISTS house_number VARCHAR(30) NOT NULL DEFAULT ''
    `);
    await pool.query(`
        ALTER TABLE users
        ADD COLUMN IF NOT EXISTS whatsapp_opt_in BOOLEAN NOT NULL DEFAULT FALSE
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
            image_url TEXT,
            image_data BYTEA,
            image_mime_type VARCHAR(100),
            created_by BIGINT NOT NULL REFERENCES users(id),
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);
    await pool.query(`
        ALTER TABLE service_events
        ADD COLUMN IF NOT EXISTS image_url TEXT,
        ADD COLUMN IF NOT EXISTS image_data BYTEA,
        ADD COLUMN IF NOT EXISTS image_mime_type VARCHAR(100)
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
            image_url TEXT,
            image_drive_file_id VARCHAR(100),
            image_data BYTEA,
            image_mime_type VARCHAR(100),
            expires_on DATE,
            published BOOLEAN NOT NULL DEFAULT TRUE,
            created_by BIGINT NOT NULL REFERENCES users(id),
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);
    await pool.query(`
        ALTER TABLE announcements
        ADD COLUMN IF NOT EXISTS image_url TEXT,
        ADD COLUMN IF NOT EXISTS image_drive_file_id VARCHAR(100),
        ADD COLUMN IF NOT EXISTS image_data BYTEA,
        ADD COLUMN IF NOT EXISTS image_mime_type VARCHAR(100),
        ADD COLUMN IF NOT EXISTS expires_on DATE
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
            author VARCHAR(160) NOT NULL DEFAULT '',
            has_sequence BOOLEAN NOT NULL DEFAULT FALSE,
            lyrics TEXT NOT NULL DEFAULT '',
            chords TEXT NOT NULL DEFAULT '',
            chords_url TEXT,
            sheet_url TEXT,
            created_by BIGINT REFERENCES users(id),
            catalog_key VARCHAR(64),
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);
    await pool.query(`
        ALTER TABLE songs
        ADD COLUMN IF NOT EXISTS author VARCHAR(160) NOT NULL DEFAULT '',
        ADD COLUMN IF NOT EXISTS has_sequence BOOLEAN NOT NULL DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS chords TEXT NOT NULL DEFAULT '',
        ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        ADD COLUMN IF NOT EXISTS catalog_key VARCHAR(64)
    `);
    await pool.query(`
        ALTER TABLE songs
        ALTER COLUMN created_by DROP NOT NULL
    `);
    await pool.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS songs_catalog_key_unique
        ON songs (catalog_key)
    `);
    const songCatalog = seedSongs.map((song) => ({
        title: song.title,
        author: song.author,
        hasSequence: song.hasSequence,
        catalog_key: createHash('sha256')
            .update(`${song.title.normalize('NFKC').trim().toLocaleLowerCase('es-MX')}\u0000${song.author.normalize('NFKC').trim().toLocaleLowerCase('es-MX')}`)
            .digest('hex')
    }));
    await pool.query(
        `INSERT INTO songs (title, author, artist, has_sequence, catalog_key)
         SELECT title, author, author, "hasSequence", catalog_key
         FROM json_to_recordset($1::json)
             AS catalog(title TEXT, author TEXT, "hasSequence" BOOLEAN, catalog_key TEXT)
         ON CONFLICT (catalog_key) DO NOTHING`,
        [JSON.stringify(songCatalog)]
    );
    await pool.query(`
        CREATE TABLE IF NOT EXISTS service_songs (
            id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
            event_id BIGINT NOT NULL REFERENCES service_events(id) ON DELETE CASCADE,
            song_id BIGINT NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
            UNIQUE (event_id, song_id)
        )
    `);
    await pool.query(`
        CREATE TABLE IF NOT EXISTS media_resources (
            id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
            title VARCHAR(160) NOT NULL,
            category VARCHAR(20) NOT NULL,
            url TEXT NOT NULL,
            drive_file_id VARCHAR(100),
            file_data BYTEA,
            mime_type VARCHAR(100),
            description VARCHAR(500) NOT NULL DEFAULT '',
            created_by BIGINT NOT NULL REFERENCES users(id),
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);
    await pool.query(`
        ALTER TABLE media_resources
        ADD COLUMN IF NOT EXISTS drive_file_id VARCHAR(100),
        ADD COLUMN IF NOT EXISTS file_data BYTEA,
        ADD COLUMN IF NOT EXISTS mime_type VARCHAR(100)
    `);
    await pool.query(`
        CREATE TABLE IF NOT EXISTS sound_files (
            id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
            title VARCHAR(160) NOT NULL,
            drive_file_id VARCHAR(100) NOT NULL,
            url TEXT NOT NULL,
            mime_type VARCHAR(150) NOT NULL,
            file_data BYTEA,
            uploaded_by BIGINT NOT NULL REFERENCES users(id),
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);
    await pool.query(`
        ALTER TABLE sound_files
        ALTER COLUMN drive_file_id DROP NOT NULL,
        ADD COLUMN IF NOT EXISTS file_data BYTEA
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

    await pool.query(`
        CREATE TABLE IF NOT EXISTS user_notifications (
            id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
            user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            title VARCHAR(160) NOT NULL,
            body TEXT NOT NULL,
            read_at TIMESTAMPTZ,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);
    await pool.query(`
        CREATE INDEX IF NOT EXISTS user_notifications_unread
        ON user_notifications (user_id, created_at DESC) WHERE read_at IS NULL
    `);
    await pool.query(`
        CREATE TABLE IF NOT EXISTS push_subscriptions (
            id BIGINT GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
            user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            endpoint TEXT NOT NULL UNIQUE,
            p256dh TEXT NOT NULL,
            auth TEXT NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
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
    await deleteExpiredAnnouncements();
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
    const announcementCleanup = setInterval(() => {
        deleteExpiredAnnouncements().catch((error) =>
            console.error('No se pudieron limpiar anuncios vencidos:', error)
        );
    }, 60 * 60 * 1000);
    announcementCleanup.unref();

    app.listen(port, () => {
        console.log(`API de Mi Iglesia disponible en el puerto ${port}.`);
    });
}

startServer().catch((error) => {
    console.error('No se pudo iniciar la API:', error);
    process.exit(1);
});
