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

## Instalar en el celular

La aplicación se puede instalar como PWA desde el dominio HTTPS de Vercel. En Android, abre el sitio en Chrome y toca **Instalar app** (o elige **Instalar aplicación** en el menú). En iPhone o iPad, abre el sitio en Safari, toca **Compartir** y selecciona **Agregar a pantalla de inicio**. La PWA usa el mismo inicio de sesión y datos que la versión web. Para consultar o enviar información se requiere conexión a Internet; todavía no está publicada en App Store ni Google Play.

Cuando se guarda un equipo de culto, cada persona asignada recibe una notificación en los dispositivos donde la activó desde **Mi perfil → Activar notificaciones**. En iPhone/iPad funciona desde iOS 16.4, y solo si la app se instaló en la pantalla de inicio y se abre desde su icono. Además, cada asignación se guarda como aviso dentro de la app: aparece al iniciar sesión o abrir la página (también en iPhone sin instalar) y se actualiza cada 30 segundos mientras la app está abierta. Si la app está cerrada en iOS sin instalar, no puede llegar una notificación; eso requiere instalarla en la pantalla de inicio o una app nativa con licencia de Apple. Los avisos por WhatsApp se mantienen como canal adicional.

Las asignaciones solo se muestran a usuarios con roles de equipo, coordinación o Master; los miembros ven el calendario sin el roster. Para asignar, se muestran las personas que tengan al menos un rol de Músico, Coordinador, Multimedia, Sonido o Master, sin importar cuál de esos roles tenga la persona ni el puesto seleccionado; las cuentas cuyo único rol sea Miembro no aparecen. Cada persona puede tener un puesto operativo por culto y Dirección puede añadirse además. Las personas asignadas pueden confirmar asistencia durante el día del evento. Las asignaciones se eliminan después de terminar el día del evento en la zona horaria `America/Mexico_City`; la limpieza corre al iniciar el API, periódicamente y antes de servir el programa.

Master y Coordinación pueden preparar varias asignaciones para un evento; la lista es un borrador y no modifica el programa hasta pulsar **Terminar asignación de equipo**. Al finalizar, el API valida y guarda el lote completo en una transacción. Después intenta notificar por WhatsApp; un fallo de WhatsApp no deshace las asignaciones guardadas. Solo se envían avisos a personas que aceptaron recibirlos desde su perfil. Mientras `WHATSAPP_TEST_RECIPIENT` tenga un valor, todos esos avisos se dirigen exclusivamente a ese número de prueba (no a los teléfonos de los miembros). Además, el botón **Abrir chat de coordinación en WhatsApp** abre la conversación con `8182012236`, copia al portapapeles un resumen del equipo asignado y prepara el mismo texto en WhatsApp para que Coordinación lo revise y lo envíe manualmente.

Las peticiones de oración quedan pendientes hasta que Master o Coordinación las aprueben. El menú de Coordinación muestra el total pendiente y, al entrar, abre una ventana informativa con las peticiones; la aprobación se realiza desde la lista de coordinación. Después, la comunidad puede acompañarlas. Multimedia y Coordinación programan cantos por evento. El repertorio de “Cantos Getse” (título, autor y secuencia) se importa idempotentemente desde `backend/cantos-getse.json`; la última vez tocado se calcula con los eventos pasados que incluyan ese canto.

El perfil exige calle, colonia y número de casa para desbloquear el resto del menú. El directorio de Coordinación se divide en Grupo de alabanza (roles Master, Músico, Coordinador, Sonido o Multimedia) e Iglesia general, con búsqueda por nombre.

Las imágenes de anuncios y de eventos se guardan en PostgreSQL. Los anuncios requieren una fecha de fin; siguen visibles durante ese día y se eliminan junto con su imagen a partir del día siguiente (zona horaria `America/Monterrey`). La limpieza corre al iniciar el API, cada hora y antes de listar anuncios.

Multimedia y Sonido usan Google Drive cuando `GOOGLE_SERVICE_ACCOUNT_JSON` está configurada; si no lo está, la carga se guarda en PostgreSQL como alternativa para que no quede bloqueada. Los archivos tienen un límite de 10 MB y se borran de su almacenamiento al eliminarlos desde la app. Para habilitar Drive, configura `GOOGLE_SERVICE_ACCOUNT_JSON` como secreto de entorno en Render con el JSON de una cuenta de servicio. Comparte ambas carpetas de Drive con el correo de esa cuenta y dale permiso de editor. Carpetas: Multimedia `1RNFmBpMc4SUgvNJnIAZeMdRhZxtGD2kh`; Sonido `1JdDAz1TJxXGaAo7z5adcjabBbOZVjqyP`. Nunca agregues las credenciales de la cuenta de servicio al repositorio. Los registros de auditoría de Administración se muestran paginados, diez por página.

El repertorio incluye un compositor de letra y acordes: se puede pegar una canción completa en bloques de dos renglones y la interfaz detecta y separa automáticamente los acordes de la letra. Las líneas se pueden ajustar, se puede copiar la letra sin acordes y hay sugerencias para las notas Do, Re, Mi, Fa, Sol, La y Si; los sostenidos, bemoles y variaciones quedan a criterio de la persona de música. Multimedia puede agregar y actualizar letras; los roles de Músico, Coordinación y Master también pueden completar los acordes. La sección de actividad reciente muestra las canciones nuevas y las actualizadas.

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
- `WHATSAPP_ACCESS_TOKEN`: token de WhatsApp Cloud API; guárdalo como secreto y nunca en Git.
- `WHATSAPP_PHONE_NUMBER_ID`: identificador del número de WhatsApp Cloud API emisor.
- `WHATSAPP_API_VERSION`: versión Graph API vigente y compatible, por ejemplo `v23.0`.
- `WHATSAPP_TEMPLATE_NAME` y `WHATSAPP_TEMPLATE_LANGUAGE`: plantilla aprobada por Meta y su idioma. La plantilla debe tener cuatro variables de cuerpo, en este orden: nombre, puesto, evento y fecha/hora.
- Texto sugerido para la plantilla: `Hola {{1}}, te asignaron el puesto {{2}} en {{3}}. Fecha y hora: {{4}}. Si tienes dudas, contacta a coordinación.`
- `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` y `VAPID_SUBJECT`: claves para las notificaciones de la app instalada. Genéralas una vez con `npx web-push generate-vapid-keys` dentro de `backend/`, guarda la privada solo como secreto en Render y usa un `mailto:` real en `VAPID_SUBJECT`.
- `WHATSAPP_TEST_RECIPIENT`: configura `8182012236` en Render durante las pruebas; `.env.example` ya incluye ese valor para desarrollo local. El API agrega el prefijo `52` cuando se da un número mexicano de 10 dígitos. Antes de producción, borra esta variable o déjala vacía; de otro modo, todos los avisos seguirán llegando únicamente al destinatario de pruebas. La persona que recibe avisos reales debe haber activado el consentimiento de WhatsApp en su perfil.

El rol Master autoriza las rutas administrativas en el servidor. Permite asignar varios roles a otras cuentas; el endpoint rechaza cambios al propio rol y no permite asignar Master.

Las nuevas imágenes de anuncios, eventos y recursos, así como los manuales de Sonido, se guardan en PostgreSQL. El límite de carga es de 10 MB por archivo. Los archivos que ya estén en Drive permanecen vinculados a sus registros anteriores; las nuevas cargas no dependen de Drive.

### Vercel (frontend)

Conecta la raíz del repositorio, deja el framework como `Other`, no configures comandos de compilación y usa la raíz `./`. `api-config.js` apunta a la URL pública del API de Render. El archivo `Registrarme.html` redirige al formulario de registro unificado de `index.html`.

Verifica la API en `https://TU-API.onrender.com/api/health`. No publiques `.env`, connection strings ni secretos.
