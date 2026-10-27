(() => {
    const roleLabels = {
        1: 'Músico',
        2: 'Coordinador',
        3: 'Multimedia',
        4: 'Sonido',
        5: 'Master',
        6: 'Miembro'
    };

    function areasFromUser(user) {
        return (user?.areas || user?.roles || []).map((area) => Number(area.id ?? area));
    }

    async function start({ allowedAreas = [] } = {}) {
        if (!window.MiIglesia?.hasToken()) {
            window.location.replace('../../index.html');
            return null;
        }

        let user;
        try {
            ({ user } = await MiIglesia.request('/api/auth/me'));
        } catch (error) {
            MiIglesia.clearToken();
            window.location.replace('../../index.html');
            return null;
        }

        const areas = areasFromUser(user);
        if (allowedAreas.length && !areas.some((area) => allowedAreas.includes(area))) {
            window.location.replace('../../Inicio.html');
            return null;
        }

        const name = user.nombre || user.name || user.email || 'Usuario';
        document.querySelectorAll('[data-module-user]').forEach((element) => {
            element.textContent = name;
        });
        const roleText = areas.map((area) => roleLabels[area]).filter(Boolean).join(' · ');
        document.querySelectorAll('[data-module-role]').forEach((element) => {
            element.textContent = roleText || roleLabels[6];
        });

        document.querySelectorAll('[data-module-logout]').forEach((button) => {
            button.addEventListener('click', () => {
                MiIglesia.clearToken();
                window.location.replace('../../index.html');
            });
        });

        document.querySelectorAll('[data-required-area], [data-required-areas]').forEach((element) => {
            const required = (element.dataset.requiredAreas || element.dataset.requiredArea || '')
                .split(',')
                .map(Number)
                .filter(Boolean);
            element.hidden = !required.some((area) => areas.includes(area));
        });
        return { user, areas };
    }

    window.ModuleShell = { start, roleLabels };
})();
