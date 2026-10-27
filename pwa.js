(() => {
    const installButton = document.createElement('button');
    let installPrompt = null;

    installButton.type = 'button';
    installButton.className = 'pwa-install-button';
    installButton.textContent = 'Instalar app';
    installButton.setAttribute('aria-label', 'Instalar Mi Iglesia en este dispositivo');
    document.body.appendChild(installButton);

    const isStandalone = window.matchMedia('(display-mode: standalone)').matches
        || navigator.standalone === true;

    if (isStandalone) {
        installButton.hidden = true;
    }

    window.addEventListener('beforeinstallprompt', (event) => {
        event.preventDefault();
        installPrompt = event;
    });

    window.addEventListener('appinstalled', () => {
        installPrompt = null;
        installButton.hidden = true;
    });

    installButton.addEventListener('click', async () => {
        if (installPrompt) {
            await installPrompt.prompt();
            const choice = await installPrompt.userChoice;
            if (choice.outcome === 'accepted') installButton.hidden = true;
            installPrompt = null;
            return;
        }

        const isAppleMobile = /iPhone|iPad|iPod/.test(navigator.userAgent)
            || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
        const instructions = isAppleMobile
            ? 'Para instalar Mi Iglesia, toca Compartir en Safari y elige “Agregar a pantalla de inicio”.'
            : 'Abre el menú de tu navegador y elige “Instalar aplicación” o “Agregar a pantalla de inicio”.';
        window.alert(instructions);
    });

    if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('./service-worker.js')
            .catch((error) => console.error('No se pudo registrar la aplicación instalable:', error));
    }

    const pushToggle = document.getElementById('pushToggle');
    const pushStatus = document.getElementById('pushStatus');
    if (!pushToggle || !pushStatus || !window.MiIglesia) return;

    const pushSupported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
    const isAppleMobile = /iPhone|iPad|iPod/.test(navigator.userAgent)
        || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

    function urlBase64ToUint8Array(value) {
        const padding = '='.repeat((4 - (value.length % 4)) % 4);
        const raw = atob((value + padding).replace(/-/g, '+').replace(/_/g, '/'));
        return Uint8Array.from(raw, (character) => character.charCodeAt(0));
    }

    async function getSubscription() {
        const registration = await navigator.serviceWorker.ready;
        return registration.pushManager.getSubscription();
    }

    async function refreshPushButton() {
        if (!pushSupported) {
            pushToggle.hidden = true;
            pushStatus.textContent = isAppleMobile
                ? 'En iPhone o iPad, instala la app desde Safari con “Agregar a pantalla de inicio” y ábrela desde el icono para activar las notificaciones.'
                : 'Este navegador no admite notificaciones.';
            return;
        }
        if (Notification.permission === 'denied') {
            pushToggle.disabled = true;
            pushStatus.textContent = 'Las notificaciones están bloqueadas en este dispositivo. Actívalas desde la configuración del navegador.';
            return;
        }
        const subscription = await getSubscription();
        pushToggle.textContent = subscription ? 'Desactivar notificaciones' : 'Activar notificaciones';
        pushStatus.textContent = subscription
            ? 'Este dispositivo recibirá un aviso cuando se te asigne un puesto.'
            : 'Recibe un aviso en este dispositivo cuando se te asigne un puesto.';
    }

    pushToggle.addEventListener('click', async () => {
        pushToggle.disabled = true;
        try {
            const existing = await getSubscription();
            if (existing) {
                await MiIglesia.request('/api/push/unsubscribe', {
                    method: 'POST',
                    body: JSON.stringify({ endpoint: existing.endpoint })
                });
                await existing.unsubscribe();
            } else {
                const { enabled, publicKey } = await MiIglesia.request('/api/push/public-key');
                if (!enabled) throw new Error('Las notificaciones aún no están configuradas en el servidor.');
                const permission = await Notification.requestPermission();
                if (permission !== 'granted') throw new Error('No se concedió el permiso para mostrar notificaciones.');
                const registration = await navigator.serviceWorker.ready;
                const subscription = await registration.pushManager.subscribe({
                    userVisibleOnly: true,
                    applicationServerKey: urlBase64ToUint8Array(publicKey)
                });
                await MiIglesia.request('/api/push/subscribe', {
                    method: 'POST',
                    body: JSON.stringify({ subscription: subscription.toJSON() })
                });
            }
            await refreshPushButton();
        } catch (error) {
            pushStatus.textContent = error.message || 'No se pudo cambiar la configuración de notificaciones.';
        } finally {
            pushToggle.disabled = Notification.permission === 'denied';
        }
    });

    refreshPushButton().catch(() => {
        pushStatus.textContent = 'No se pudo comprobar el estado de las notificaciones.';
    });
})();
