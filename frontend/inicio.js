(() => {
    const roleLabels = { 1: 'Músico', 2: 'Coordinador', 3: 'Multimedia', 4: 'Sonido', 5: 'Master', 6: 'Miembro' };
    const areasOf = (user) => (user?.areas || user?.roles || []).map((area) => Number(area.id ?? area));
    const date = (value) => new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));

    function renderAnnouncements(announcements) {
        const list = document.getElementById('announcementHomeList');
        list.replaceChildren();
        if (!announcements.length) { list.innerHTML = '<p class="empty-state">No hay anuncios publicados.</p>'; return; }
        announcements.slice(0, 5).forEach((announcement) => {
            const item = document.createElement('article');
            item.className = 'feed-card';
            const title = document.createElement('h3'); title.textContent = announcement.title;
            const body = document.createElement('p'); body.textContent = announcement.body;
            const meta = document.createElement('div'); meta.className = 'feed-meta'; meta.textContent = `Publicado ${date(announcement.created_at)}`;
            item.append(title, meta, body); list.append(item);
        });
    }

    function renderServices(services, canSeeTeam) {
        const list = document.getElementById('homeServiceList');
        list.replaceChildren();
        if (!services.length) { list.innerHTML = '<p class="empty-state">Aún no hay próximos eventos programados.</p>'; return; }
        services.forEach((service) => {
            const item = document.createElement('article'); item.className = 'service-card';
            const title = document.createElement('h3'); title.textContent = `${service.event_type}: ${service.title}`;
            const meta = document.createElement('div'); meta.className = 'service-date'; meta.textContent = date(service.starts_at);
            const details = document.createElement('p'); details.className = 'service-details'; details.textContent = service.details || 'Sin detalles adicionales.';
            item.append(title, meta, details);
            if (canSeeTeam && service.songs?.length) { const songs = document.createElement('p'); songs.className = 'service-details'; songs.textContent = `Cantos: ${service.songs.map((song) => song.title).join(', ')}`; item.append(songs); }
            if (canSeeTeam && service.assignments?.length) { const team = document.createElement('p'); team.className = 'service-details'; team.textContent = `Equipo: ${service.assignments.map((assignment) => `${assignment.position}: ${assignment.name}`).join(' · ')}`; item.append(team); }
            list.append(item);
        });
    }

    async function load() {
        if (!MiIglesia.hasToken()) { window.location.replace('index.html'); return; }
        try {
            const [{ user }, { announcements }, { services }] = await Promise.all([
                MiIglesia.request('/api/auth/me'),
                MiIglesia.request('/api/announcements'),
                MiIglesia.request('/api/services')
            ]);
            const areas = areasOf(user);
            const name = user.nombre || user.email || 'Usuario';
            document.getElementById('userName').textContent = name;
            document.getElementById('welcomeName').textContent = name;
            document.getElementById('roleBadge').textContent = areas.map((area) => roleLabels[area]).filter(Boolean).join(' · ') || roleLabels[6];
            document.querySelectorAll('[data-required-area], [data-required-areas]').forEach((element) => {
                const required = (element.dataset.requiredAreas || element.dataset.requiredArea || '').split(',').map(Number).filter(Boolean);
                element.hidden = required.length ? !required.some((area) => areas.includes(area)) : false;
            });
            renderAnnouncements(announcements);
            renderServices(services, areas.some((area) => [1, 2, 3, 5].includes(area)));
        } catch (error) {
            if (error.status === 401) { MiIglesia.clearToken(); window.location.replace('index.html'); return; }
            document.getElementById('homeServiceList').textContent = error.message;
        }
    }

    document.getElementById('logoutBtn').addEventListener('click', () => { MiIglesia.clearToken(); window.location.replace('index.html'); });
    const menu = document.getElementById('appMenu');
    const closeMenu = () => { menu.dataset.open = 'false'; document.body.classList.remove('mobile-menu-open'); document.getElementById('mobileMenuBackdrop').hidden = true; };
    document.getElementById('mobileMenuToggle').addEventListener('click', () => { const open = menu.dataset.open === 'true'; menu.dataset.open = String(!open); document.body.classList.toggle('mobile-menu-open', !open); document.getElementById('mobileMenuBackdrop').hidden = open; });
    document.getElementById('mobileMenuClose').addEventListener('click', closeMenu);
    document.getElementById('mobileMenuBackdrop').addEventListener('click', closeMenu);
    load();
})();
