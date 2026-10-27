(() => {
    const pending = document.getElementById('pendingList');
    const worshipList = document.getElementById('worshipDirectoryList');
    const generalList = document.getElementById('generalDirectoryList');
    const search = document.getElementById('directorySearch');
    const status = document.getElementById('announcementStatus');
    let directoryUsers = [];

    function renderPending(prayers) {
        pending.replaceChildren();
        const items = prayers.filter((prayer) => prayer.status === 'pending');
        if (!items.length) {
            pending.innerHTML = '<p class="module-empty">No hay peticiones pendientes.</p>';
            return;
        }
        items.forEach((prayer) => {
            const item = document.createElement('article');
            item.className = 'module-item';
            item.innerHTML = '<h3></h3><p></p><div class="module-item-actions"></div>';
            item.querySelector('h3').textContent = prayer.author_name || 'Petición';
            item.querySelector('p').textContent = prayer.body;
            ['approved', 'rejected'].forEach((decision) => {
                const button = document.createElement('button');
                button.className = `module-button ${decision === 'rejected' ? 'danger' : ''}`;
                button.type = 'button';
                button.textContent = decision === 'approved' ? 'Aprobar' : 'Rechazar';
                button.addEventListener('click', async () => {
                    try {
                        await MiIglesia.request(`/api/prayers/${prayer.id}/moderation`, {
                            method: 'PATCH',
                            body: JSON.stringify({ status: decision })
                        });
                        await load();
                    } catch (error) {
                        status.textContent = error.message;
                    }
                });
                item.querySelector('.module-item-actions').append(button);
            });
            pending.append(item);
        });
    }

    function renderDirectory() {
        const query = search.value.trim().toLocaleLowerCase('es-MX');
        const users = directoryUsers.filter((user) =>
            user.nombre.toLocaleLowerCase('es-MX').includes(query)
        );
        const worship = users.filter((user) => (user.areas || []).some((area) => [1, 2, 3, 4].includes(Number(area))));
        const general = users.filter((user) => {
            const areas = (user.areas || []).map(Number);
            return areas.length === 1 && areas[0] === 6;
        });

        const renderGroup = (target, group) => {
            target.replaceChildren();
            if (!group.length) {
                target.innerHTML = '<p class="module-empty">No hay coincidencias.</p>';
                return;
            }
            group.forEach((user) => {
                const item = document.createElement('article');
                item.className = 'module-item';
                const roles = (user.roles || []).join(', ');
                item.innerHTML = '<h3></h3><p></p>';
                item.querySelector('h3').textContent = user.nombre;
                item.querySelector('p').textContent = [roles, user.telefono, user.email].filter(Boolean).join(' · ');
                target.append(item);
            });
        };
        renderGroup(worshipList, worship);
        renderGroup(generalList, general);
    }

    async function load() {
        try {
            const [{ prayers }, { users }] = await Promise.all([
                MiIglesia.request('/api/prayers'),
                MiIglesia.request('/api/team/directory')
            ]);
            directoryUsers = users;
            renderPending(prayers);
            renderDirectory();
        } catch (error) {
            status.textContent = error.message;
        }
    }

    document.getElementById('announcementForm').addEventListener('submit', async (event) => {
        event.preventDefault();
        try {
            await MiIglesia.request('/api/announcements', {
                method: 'POST',
                body: new FormData(event.currentTarget)
            });
            event.currentTarget.reset();
            status.textContent = 'Anuncio publicado.';
        } catch (error) {
            status.textContent = error.message;
        }
    });
    search.addEventListener('input', renderDirectory);
    ModuleShell.start({ allowedAreas: [2, 5] }).then((context) => { if (context) load(); });
})();
