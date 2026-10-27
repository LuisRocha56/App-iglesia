(() => {
    const form = document.getElementById('resourceForm');
    const list = document.getElementById('resourceList');
    const status = document.getElementById('resourceStatus');
    const noticeForm = document.getElementById('noticeForm');
    const noticeList = document.getElementById('noticeList');
    const noticeStatus = document.getElementById('noticeStatus');

    function renderResources(resources, areas) {
        list.replaceChildren();
        resources.forEach((resource) => {
            const item = document.createElement('article');
            item.className = 'module-item';
            item.innerHTML = '<h3></h3><p></p>';
            item.querySelector('h3').textContent = resource.title;
            item.querySelector('p').textContent = `${resource.category}${resource.description ? ` · ${resource.description}` : ''}`;
            if (resource.url) {
                const link = document.createElement('a');
                link.href = resource.url;
                link.target = '_blank';
                link.rel = 'noopener';
                link.textContent = 'Abrir recurso';
                item.append(link);
            }
            if (areas.some((area) => [2, 3, 5].includes(area))) {
                const button = document.createElement('button');
                button.className = 'module-button danger';
                button.type = 'button';
                button.textContent = 'Eliminar';
                button.addEventListener('click', async () => {
                    try {
                        await MiIglesia.request(`/api/resources/${resource.id}`, { method: 'DELETE' });
                        await load(areas);
                    } catch (error) {
                        status.textContent = error.message;
                    }
                });
                item.append(button);
            }
            list.append(item);
        });
        if (!resources.length) list.innerHTML = '<p class="module-empty">Todavía no hay recursos.</p>';
    }

    function renderNotices(notices) {
        noticeList.replaceChildren();
        notices.forEach((notice) => {
            const item = document.createElement('article');
            item.className = 'module-item';
            item.innerHTML = '<h3></h3><p></p>';
            item.querySelector('h3').textContent = notice.title;
            item.querySelector('p').textContent =
                `${new Date(notice.show_at).toLocaleString('es-MX')} · ${notice.body || 'Sin mensaje'}`;
            const image = document.createElement('img');
            image.className = 'notice-image';
            image.alt = notice.title;
            item.append(image);
            MiIglesia.requestBlob(`/api/multimedia-notices/${notice.id}/content`)
                .then((blob) => { image.src = URL.createObjectURL(blob); })
                .catch(() => image.remove());
            noticeList.append(item);
        });
        if (!notices.length) noticeList.innerHTML = '<p class="module-empty">No hay avisos programados.</p>';
    }

    async function load(areas) {
        try {
            const [{ resources }, { notices }] = await Promise.all([
                MiIglesia.request('/api/resources'),
                MiIglesia.request('/api/multimedia-notices')
            ]);
            renderResources(resources, areas);
            renderNotices(notices);
        } catch (error) {
            status.textContent = error.message;
        }
    }

    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        try {
            await MiIglesia.request('/api/resources', { method: 'POST', body: new FormData(form) });
            form.reset();
            status.textContent = 'Recurso guardado.';
            const context = await MiIglesia.request('/api/auth/me');
            await load((context.user.areas || []).map((area) => Number(area.id ?? area)));
        } catch (error) {
            status.textContent = error.message;
        }
    });

    noticeForm.addEventListener('submit', async (event) => {
        event.preventDefault();
        try {
            await MiIglesia.request('/api/multimedia-notices', {
                method: 'POST',
                body: new FormData(noticeForm)
            });
            noticeForm.reset();
            noticeStatus.textContent = 'Aviso multimedia programado.';
            const context = await MiIglesia.request('/api/auth/me');
            await load((context.user.areas || []).map((area) => Number(area.id ?? area)));
        } catch (error) {
            noticeStatus.textContent = error.message;
        }
    });

    ModuleShell.start({ allowedAreas: [2, 3, 5] }).then((context) => {
        if (context) load(context.areas);
    });
})();
