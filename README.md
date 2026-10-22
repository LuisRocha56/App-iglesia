# Mi Iglesia

El frontend es estático y se publica en Vercel. La API Express corre en Render y usa PostgreSQL de Neon. La página inicial tiene una única pantalla adaptable de registro/inicio de sesión inspirada en la referencia visual. Las cuentas nuevas se guardan en Congregación con el rol Miembro. El perfil Master puede asignar uno o varios de estos roles a cada cuenta: Músico, Coordinador, Multimedia, Sonido y Miembro. Master es un rol único y no se asigna desde la administración normal.

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

El API crea y actualiza las tablas requeridas al iniciar. Las contraseñas se guardan como hashes, no como texto plano. Las cuentas existentes conservan sus roles actuales y reciben la categoría Congregación por defecto. Los roles se migran a una lista para permitir asignar varios a cada persona. Miembro es el rol base; las personas con roles adicionales también ven los apartados de sus equipos.

El inicio muestra anuncios y próximos eventos. El menú despliega las funciones permitidas por rol. Master y Coordinador pueden programar eventos y equipos, publicar anuncios, aprobar o rechazar peticiones de oración y consultar el directorio. Solo Master puede crear usuarios, cambiar roles y restablecer credenciales, consultar auditorías y cambiar el nombre global de la iglesia. También puede verificar la conectividad de API y base de datos; los secretos técnicos permanecen en las variables de entorno.

Las asignaciones solo se muestran a usuarios con roles de equipo, coordinación o Master; los miembros ven el calendario sin el roster. Los puestos de música, multimedia y sonido requieren el rol correspondiente; cada persona puede tener un puesto operativo por culto y Dirección puede añadirse además. Las personas asignadas pueden confirmar asistencia durante el día del evento. Las asignaciones se eliminan después de terminar el día del evento en la zona horaria `America/Mexico_City`; la limpieza corre al iniciar el API, periódicamente y antes de servir el programa.

Las peticiones de oración quedan pendientes hasta que Master o Coordinación las aprueben. El menú de Coordinación muestra el total pendiente y, al entrar, abre una ventana informativa con las peticiones; la aprobación se realiza desde la lista de coordinación. Después, la comunidad puede acompañarlas. Multimedia y Coordinación programan cantos por evento. El repertorio de “Cantos Getse” (título, autor y secuencia) se importa idempotentemente desde `backend/cantos-getse.json`; la última vez tocado se calcula con los eventos pasados que incluyan ese canto.

El perfil exige calle, colonia y número de casa para desbloquear el resto del menú. El directorio de Coordinación se divide en Grupo de alabanza (roles Master, Músico, Coordinador, Sonido o Multimedia) e Iglesia general, con búsqueda por nombre.

Las imágenes de anuncios y Multimedia, así como los manuales de Sonido, se suben a las carpetas de Drive configuradas y tienen un límite de 10 MB. Para habilitar las subidas, configura `GOOGLE_SERVICE_ACCOUNT_JSON` como secreto de entorno en Render con el JSON de una cuenta de servicio. Comparte ambas carpetas de Drive con el correo de esa cuenta y dale permiso de editor. Carpetas: Multimedia `1RNFmBpMc4SUgvNJnIAZeMdRhZxtGD2kh`; Sonido `1JdDAz1TJxXGaAo7z5adcjabBbOZVjqyP`. Nunca agregues las credenciales de la cuenta de servicio al repositorio.

Cada persona puede actualizar sus propios datos y cambiar su contraseña confirmando la contraseña actual. La API no entrega contraseñas ni secretos técnicos.

Al abrir `index.html`, si el navegador conserva un token de sesión válido, la página lo comprueba con el API y abre `Inicio.html` automáticamente. Si el token venció, se elimina y se solicita iniciar sesión otra vez. Si el API no responde, el token se conserva. Las sesiones actuales duran 8 horas; borrar los datos del navegador también cierra la sesión.

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

El rol Master autoriza las rutas administrativas en el servidor. Permite asignar varios roles a otras cuentas; el endpoint rechaza cambios al propio rol y no permite asignar Master.

### Vercel (frontend)

Conecta la raíz del repositorio, deja el framework como `Other`, no configures comandos de compilación y usa la raíz `./`. `api-config.js` apunta a la URL pública del API de Render. El archivo `Registrarme.html` redirige al formulario de registro unificado de `index.html`.

Verifica la API en `https://TU-API.onrender.com/api/health`. No publiques `.env`, connection strings ni secretos.
