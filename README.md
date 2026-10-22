# Mi Iglesia

El frontend es estático y se publica en Vercel. La API Express corre en Render y usa PostgreSQL de Neon. La página inicial tiene una única pantalla adaptable de registro/inicio de sesión inspirada en la referencia visual. Las cuentas pueden elegir Congregación o Miembros de alabanza; todas comienzan con el rol Miembro. El perfil Master puede asignar Músico, Coordinador, Multimedia, Sonido o Miembro. Master es un rol único y no se asigna desde la administración normal.

## Desarrollo local

1. Instala Node.js 20 o posterior y PostgreSQL.
2. Crea una base de datos llamada `mi_iglesia`.
3. Desde `backend/`, copia `.env.example` a `.env` y configura `DATABASE_URL` y un valor aleatorio largo para `JWT_SECRET`.
4. Instala dependencias y arranca el API:

   ```powershell
   cd backend
   npm install
   npm start
   ```

5. Sirve la raíz del proyecto con Live Server. Para desarrollo local, cambia temporalmente la URL de API de `api-config.js` a `http://localhost:3000`.

El API crea y actualiza las tablas requeridas al iniciar. Las contraseñas se guardan como hashes, no como texto plano. Las cuentas existentes conservan su rol y reciben la categoría Congregación por defecto.

## Publicación

### Render (API)

Configura el servicio Web en la rama `main`:

- **Root Directory:** `backend`
- **Build Command:** `npm install`
- **Start Command:** `npm start`

Agrega estas variables de entorno en el servicio:

- `DATABASE_URL`: connection string de PostgreSQL en Neon.
- `JWT_SECRET`: secreto aleatorio largo.
- `NODE_ENV`: `production`.
- `FRONTEND_ORIGIN`: dominio exacto de Vercel, sin barra final.
- `MASTER_EMAIL`: correo de la cuenta que debe recibir el rol Master. La cuenta debe estar registrada antes de activar esta variable. El backend promueve esa cuenta una sola vez; la marca de inicialización se guarda en `app_settings`. No permite asignar Master a otras cuentas.

El rol Master autoriza las rutas administrativas en el servidor. Solo permite asignar roles a otras cuentas; el endpoint rechaza cambios al propio rol.

### Vercel (frontend)

Conecta la raíz del repositorio, deja el framework como `Other`, no configures comandos de compilación y usa la raíz `./`. `api-config.js` apunta a la URL pública del API de Render. El archivo `Registrarme.html` redirige al formulario de registro unificado de `index.html`.

Verifica la API en `https://TU-API.onrender.com/api/health`. No publiques `.env`, connection strings ni secretos.
