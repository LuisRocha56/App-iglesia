(() => {
    const roleLabels = { 1: 'Músico', 2: 'Coordinador', 3: 'Multimedia', 4: 'Sonido', 6: 'Miembro' };
    const roleOptions = [1, 2, 3, 4, 6];
    const userList = document.getElementById('userList');
    const userSearch = document.getElementById('userSearch');
    const settingsStatus = document.getElementById('settingsStatus');
    const userStatus = document.getElementById('userStatus');
    let users = [];

    function renderUsers() {
        const query = userSearch.value.trim().toLocaleLowerCase('es-MX');
        userList.replaceChildren();
        users.filter((user) => user.nombre.toLocaleLowerCase('es-MX').includes(query)).forEach((user) => {
            const item = document.createElement('article');
            item.className = 'module-item';
            const areas = (user.areas || []).map(Number);
            item.innerHTML = `<h3></h3><p class="admin-role"></p><form class="user-role-form"></form><div class="user-card-actions"></div><p class="module-status"></p>`;
            item.querySelector('h3').textContent = user.nombre;
            item.querySelector('.admin-role').textContent = `${user.email} · ${(user.roles || []).join(', ')}`;
            const roleForm = item.querySelector('.user-role-form');
            roleOptions.forEach((role) => {
                const label = document.createElement('label');
                const input = document.createElement('input');
                input.type = 'checkbox'; input.value = String(role); input.checked = areas.includes(role);
                label.append(input, document.createTextNode(roleLabels[role]));
                roleForm.append(label);
            });
            const saveRoles = document.createElement('button');
            saveRoles.className = 'module-button'; saveRoles.type = 'submit'; saveRoles.textContent = 'Guardar roles';
            roleForm.append(saveRoles);
            roleForm.addEventListener('submit', async (event) => {
                event.preventDefault();
                const selected = [...roleForm.querySelectorAll('input:checked')].map((input) => Number(input.value));
                const cardStatus = item.querySelector('.module-status');
                try {
                    await MiIglesia.request(`/api/admin/users/${user.id}/role`, { method: 'PATCH', body: JSON.stringify({ areas: selected }) });
                    cardStatus.textContent = 'Roles actualizados.';
                    await load();
                } catch (error) { cardStatus.textContent = error.message; }
            });
            const reset = document.createElement('button');
            reset.className = 'module-button secondary'; reset.type = 'button'; reset.textContent = 'Restablecer contraseña';
            reset.addEventListener('click', async () => {
                const password = window.prompt(`Nueva contraseña para ${user.nombre}:`);
                if (!password) return;
                try {
                    await MiIglesia.request(`/api/admin/users/${user.id}/password`, { method: 'PATCH', body: JSON.stringify({ password }) });
                    item.querySelector('.module-status').textContent = 'Contraseña restablecida.';
                } catch (error) { item.querySelector('.module-status').textContent = error.message; }
            });
            const remove = document.createElement('button');
            remove.className = 'module-button danger'; remove.type = 'button'; remove.textContent = 'Eliminar usuario';
            remove.addEventListener('click', async () => {
                if (!window.confirm(`¿Eliminar a ${user.nombre}? Esta acción no se puede deshacer.`)) return;
                try { await MiIglesia.request(`/api/admin/users/${user.id}`, { method: 'DELETE' }); await load(); }
                catch (error) { item.querySelector('.module-status').textContent = error.message; }
            });
            item.querySelector('.user-card-actions').append(reset, remove);
            userList.append(item);
        });
        if (!userList.childElementCount) userList.innerHTML = '<p class="module-empty">No hay usuarios que coincidan.</p>';
    }

    function renderAudit(logs) {
        const list = document.getElementById('auditList');
        list.replaceChildren();
        logs.forEach((log) => {
            const item = document.createElement('article'); item.className = 'module-item';
            item.innerHTML = '<h3></h3><p></p>';
            item.querySelector('h3').textContent = log.action || 'Actividad';
            item.querySelector('p').textContent = log.created_at ? new Date(log.created_at).toLocaleString('es-MX') : '';
            list.append(item);
        });
    }

    async function load() {
        try {
            const [{ users: loadedUsers }, settings, audit] = await Promise.all([
                MiIglesia.request('/api/admin/users'),
                MiIglesia.request('/api/admin/settings'),
                MiIglesia.request('/api/admin/audit-logs')
            ]);
            users = loadedUsers;
            document.querySelector('#settingsForm [name="churchName"]').value = settings.churchName || '';
            renderUsers();
            renderAudit(audit.logs || []);
            const system = await MiIglesia.request('/api/admin/system-status');
            document.getElementById('systemStatus').textContent = system.api === 'connected'
                ? 'API y base de datos conectados.'
                : 'No se pudo verificar la conexión técnica.';
        } catch (error) { settingsStatus.textContent = error.message; }
    }

    document.getElementById('settingsForm').addEventListener('submit', async (event) => {
        event.preventDefault();
        try {
            await MiIglesia.request('/api/admin/settings', { method: 'PUT', body: JSON.stringify({ churchName: new FormData(event.currentTarget).get('churchName') }) });
            settingsStatus.textContent = 'Configuración guardada.';
        } catch (error) { settingsStatus.textContent = error.message; }
    });
    document.getElementById('userForm').addEventListener('submit', async (event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        const areas = data.getAll('areas').map(Number);
        try {
            await MiIglesia.request('/api/admin/users', {
                method: 'POST',
                body: JSON.stringify({ nombre: data.get('nombre'), telefono: data.get('telefono'), email: data.get('email'), password: data.get('password'), areas })
            });
            event.currentTarget.reset();
            event.currentTarget.querySelector('[value="6"]').checked = true;
            userStatus.textContent = 'Usuario creado correctamente.';
            await load();
        } catch (error) { userStatus.textContent = error.message; }
    });
    userSearch.addEventListener('input', renderUsers);
    ModuleShell.start({ allowedAreas: [5] }).then((context) => { if (context) load(); });
})();
