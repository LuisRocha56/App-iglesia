(() => {
    const script = document.currentScript;
    const base = new URL('.', script.src).href;
    const media = window.matchMedia('(max-width: 1024px)');

    const icons = {
        home: '<path d="M3 11.5 12 4l9 7.5"/><path d="M5.5 10v9.5h13V10"/><path d="M10 19.5v-5h4v5"/>',
        events: '<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
        prayer: '<path d="M12 20.5s-7.5-4.6-7.5-10.2A4.3 4.3 0 0 1 12 7.6a4.3 4.3 0 0 1 7.5 2.7c0 5.6-7.5 10.2-7.5 10.2Z"/>',
        more: '<path d="M12 5v14M5 12h14"/>',
        account: '<circle cx="12" cy="8.5" r="3.7"/><path d="M4.5 20c.9-3.6 3.8-5.5 7.5-5.5s6.6 1.9 7.5 5.5"/>',
        coord: '<circle cx="9" cy="8.5" r="3.2"/><path d="M3 19.5c.6-3.2 3-4.8 6-4.8s5.4 1.6 6 4.8"/><path d="M16.5 5.6a3.2 3.2 0 0 1 0 5.8M18 14.9c1.7.5 2.8 1.9 3.2 4.1"/>',
        music: '<path d="M9 18.5V6l10-2v12.5"/><circle cx="6.5" cy="18.5" r="2.5"/><circle cx="16.5" cy="16.5" r="2.5"/>',
        media: '<rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="m10 9.5 5 2.5-5 2.5Z"/>',
        sound: '<path d="M4 9.5v5h3.5l5 4v-13l-5 4Z"/><path d="M16 9a4.2 4.2 0 0 1 0 6M18.6 6.4a8 8 0 0 1 0 11.2"/>',
        admin: '<path d="M12 3.5 4.5 6.5v5.2c0 4.3 3 7.4 7.5 8.8 4.5-1.4 7.5-4.5 7.5-8.8V6.5Z"/><path d="m9 12 2.2 2.2L15.5 10"/>',
        logout: '<path d="M10 4.5H6.5a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2H10"/><path d="M15 8l4 4-4 4M19 12H9.5"/>'
    };

    const main = [
        { id: 'home', label: 'Inicio', icon: 'home', href: 'Inicio.html' },
        { id: 'events', label: 'Eventos y cultos', short: 'Eventos', icon: 'events', href: 'frontend/Eventos/Eventos.html' },
        { id: 'prayer', label: 'Peticiones de oración', short: 'Peticiones', icon: 'prayer', href: 'frontend/Peticiones/Peticiones.html' }
    ];
    const more = [
        { label: 'Mi cuenta', icon: 'account', href: 'frontend/Cuenta/Cuenta.html' },
        { label: 'Coordinación', icon: 'coord', href: 'frontend/Coordinacion/Coordinacion.html', areas: [2, 5] },
        { label: 'Repertorio', icon: 'music', href: 'frontend/Repertorio/Repertorio.html', areas: [1, 2, 3, 5] },
        { label: 'Multimedia', icon: 'media', href: 'frontend/Multimedia/Multimedia.html', areas: [2, 3, 5] },
        { label: 'Sonido', icon: 'sound', href: 'frontend/Sonido/Sonido.html', areas: [2, 4, 5] },
        { label: 'Administración', icon: 'admin', href: 'frontend/Administracion/Administracion.html', areas: [5] }
    ];

    const svg = (name) => `<svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">${icons[name]}</svg>`;
    const abs = (href) => new URL(href, base).pathname.toLowerCase();
    const here = location.pathname.toLowerCase();
    const isHere = (item) => abs(item.href) === here || (item.id === 'home' && (here === '/' || here.endsWith('/inicio')));

    const style = document.createElement('style');
    style.textContent = `
.mi-bottomnav, .mi-more-sheet, .mi-more-backdrop { display: none; }
@media (max-width: 1024px) {
    body.mi-has-bottomnav { padding-bottom: calc(74px + env(safe-area-inset-bottom)); }
    body.mi-has-bottomnav .mobile-menu-toggle,
    body.mi-has-bottomnav .app-menu,
    body.mi-has-bottomnav .mobile-menu-backdrop,
    body.mi-has-bottomnav .module-nav,
    body.mi-has-bottomnav .repertoire-module-menu { display: none !important; }
    body.mi-has-bottomnav .pwa-install-button { bottom: calc(86px + env(safe-area-inset-bottom)); }
    .mi-bottomnav {
        position: fixed; left: 0; right: 0; bottom: 0; z-index: 40;
        display: grid; grid-template-columns: repeat(4, 1fr); align-items: stretch;
        padding: 6px 8px calc(6px + env(safe-area-inset-bottom));
        background: rgba(7, 24, 47, .96); backdrop-filter: blur(14px);
        border-top: 1px solid rgba(255, 255, 255, .1);
        box-shadow: 0 -8px 24px rgba(0, 10, 30, .28);
    }
    .mi-bottomnav a, .mi-bottomnav button {
        display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px;
        min-height: 56px; margin: 0; padding: 4px 2px; border: 0; border-radius: 14px;
        background: none; color: rgba(226, 238, 255, .72); font: inherit; font-size: 11px; font-weight: 700;
        text-decoration: none; cursor: pointer; -webkit-tap-highlight-color: transparent;
    }
    .mi-bottomnav svg { width: 25px; height: 25px; }
    .mi-bottomnav [aria-current="page"] { color: #fff; background: rgba(74, 168, 231, .22); }
    .mi-bottomnav [aria-current="page"] svg { color: #6cc2ff; }
    .mi-more-backdrop {
        position: fixed; inset: 0; z-index: 41; display: block; border: 0; background: rgba(0, 8, 24, .55);
        opacity: 0; pointer-events: none; transition: opacity .2s;
    }
    .mi-more-sheet {
        position: fixed; left: 50%; bottom: 0; z-index: 42; display: block; width: min(100%, 560px);
        max-height: 80vh; overflow-y: auto; padding: 10px 16px calc(18px + env(safe-area-inset-bottom));
        border-radius: 22px 22px 0 0; background: #fff; color: #0b2447;
        transform: translate(-50%, 105%); transition: transform .25s ease; box-shadow: 0 -12px 40px rgba(0, 10, 30, .35);
    }
    body.mi-more-open .mi-more-backdrop { opacity: 1; pointer-events: auto; }
    body.mi-more-open .mi-more-sheet { transform: translate(-50%, 0); }
    body.mi-more-open { overflow: hidden; }
    .mi-more-grip { width: 42px; height: 4px; margin: 0 auto 12px; border-radius: 4px; background: #cfd9e8; }
    .mi-more-title { margin: 0 4px 12px; font-size: 18px; font-weight: 800; }
    .mi-more-grid { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; }
    .mi-more-grid a, .mi-more-grid button {
        display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 7px;
        min-height: 88px; padding: 10px 6px; border: 1px solid #dbe5f3; border-radius: 16px;
        background: #f5f9ff; color: #0b2447; font: inherit; font-size: 13px; font-weight: 700; text-align: center;
        text-decoration: none; cursor: pointer;
    }
    .mi-more-grid svg { width: 28px; height: 28px; color: #1686d9; }
    .mi-more-grid [aria-current="page"] { border-color: #4aa8e7; background: #e3f3ff; }
    .mi-more-grid .mi-logout { color: #b3261e; }
    .mi-more-grid .mi-logout svg { color: #b3261e; }
}
@media (min-width: 640px) and (max-width: 1024px) { .mi-more-grid { grid-template-columns: repeat(4, 1fr); } }
`;
    document.head.appendChild(style);

    const nav = document.createElement('nav');
    nav.className = 'mi-bottomnav';
    nav.setAttribute('aria-label', 'Navegación principal');
    nav.innerHTML = main.map((item) => `<a href="${abs(item.href)}" aria-label="${item.label}"${isHere(item) ? ' aria-current="page"' : ''}>${svg(item.icon)}<span>${item.short || item.label}</span></a>`).join('')
        + `<button type="button" id="miMoreBtn" aria-haspopup="dialog" aria-expanded="false" aria-label="Más opciones">${svg('more')}<span>Más</span></button>`;

    const backdrop = document.createElement('button');
    backdrop.type = 'button';
    backdrop.className = 'mi-more-backdrop';
    backdrop.setAttribute('aria-label', 'Cerrar');
    backdrop.tabIndex = -1;

    const sheet = document.createElement('div');
    sheet.className = 'mi-more-sheet';
    sheet.setAttribute('role', 'dialog');
    sheet.setAttribute('aria-label', 'Más opciones');

    const moreBtn = nav.querySelector('#miMoreBtn');
    const setOpen = (open) => {
        document.body.classList.toggle('mi-more-open', open);
        moreBtn.setAttribute('aria-expanded', String(open));
    };

    function renderSheet(areas) {
        const items = more.filter((item) => !item.areas || item.areas.some((area) => areas.includes(area)));
        sheet.innerHTML = '<div class="mi-more-grip"></div><h2 class="mi-more-title">Más opciones</h2><div class="mi-more-grid">'
            + items.map((item) => `<a href="${abs(item.href)}"${isHere(item) ? ' aria-current="page"' : ''}>${svg(item.icon)}<span>${item.label}</span></a>`).join('')
            + `<button type="button" class="mi-logout" data-logout>${svg('logout')}<span>Cerrar sesión</span></button></div>`;
        if (items.some(isHere)) moreBtn.setAttribute('aria-current', 'page');
    }

    renderSheet([]);
    moreBtn.addEventListener('click', () => setOpen(!document.body.classList.contains('mi-more-open')));
    backdrop.addEventListener('click', () => setOpen(false));
    document.addEventListener('keydown', (event) => { if (event.key === 'Escape') setOpen(false); });
    sheet.addEventListener('click', (event) => {
        if (event.target.closest('[data-logout]')) {
            window.MiIglesia?.clearToken();
            window.location.replace(new URL('index.html', base).href);
        }
    });
    media.addEventListener('change', () => setOpen(false));

    document.body.append(nav, backdrop, sheet);
    document.body.classList.add('mi-has-bottomnav');

    if (window.MiIglesia?.hasToken()) {
        window.MiIglesia.request('/api/auth/me').then(({ user }) => {
            renderSheet((user?.areas || user?.roles || []).map((area) => Number(area.id ?? area)));
        }).catch(() => {});
    }
})();
