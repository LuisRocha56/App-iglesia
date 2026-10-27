self.addEventListener('install', (event) => {
    event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
    event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
    let data = {};
    try {
        data = event.data ? event.data.json() : {};
    } catch {
        data = { body: event.data?.text() };
    }
    event.waitUntil(self.registration.showNotification(data.title || 'Mi Iglesia', {
        body: data.body || '',
        icon: '/src/images/Logo/app-icon-192.png',
        badge: '/src/images/Logo/app-icon-192.png',
        tag: data.tag,
        data: { url: data.url || '/Inicio.html' }
    }));
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    const target = new URL(event.notification.data?.url || '/Inicio.html', self.location.origin).href;
    event.waitUntil((async () => {
        const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        const existing = windows.find((client) => client.url.startsWith(self.location.origin));
        if (existing) {
            await existing.focus();
            if ('navigate' in existing) await existing.navigate(target);
            return;
        }
        await self.clients.openWindow(target);
    })());
});
