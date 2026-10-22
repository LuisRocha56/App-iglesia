# Mi Iglesia

El frontend son páginas HTML estáticas y puede publicarse en Vercel o servirse con Live Server. El API Express y PostgreSQL se ejecutan por separado.

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

5. Abre el `index.html` de la raíz con Live Server. La configuración inicial apunta al API en `http://localhost:3000`.

El API crea la tabla `users` al iniciar. Para proteger las cuentas, las contraseñas se guardan como hashes y no como texto plano.
La base de datos PostgreSQL inicia vacía; las cuentas y contraseñas que existan en el SQL Server local no se migran automáticamente y deberán registrarse de nuevo.

## Publicar

### Render (API y PostgreSQL)

1. Crea una base PostgreSQL en Render y un servicio **Web Service** conectado a este repositorio.
2. Configura `backend` como **Root Directory**, `npm install` como comando de compilación y `npm start` como comando de inicio.
3. Configura `DATABASE_URL` con la URL interna de la base de datos de Render, `JWT_SECRET` con un secreto aleatorio largo y `NODE_ENV=production`.
4. Cuando Vercel proporcione el dominio del sitio, configúralo en `FRONTEND_ORIGIN` del servicio de Render. Para varios dominios, sepáralos con comas.

### Vercel (frontend estático)

1. Importa el mismo repositorio en Vercel con la raíz del proyecto como directorio; no se requiere comando de compilación. El sitio estático está en la raíz, separado del API.
2. En `api-config.js`, reemplaza `http://localhost:3000` por la URL pública del Web Service de Render, sin una barra final.
3. Publica o vuelve a desplegar el frontend.

Después de desplegar, verifica `https://TU-API.onrender.com/api/health`. No publiques `.env` ni credenciales de la base de datos.
