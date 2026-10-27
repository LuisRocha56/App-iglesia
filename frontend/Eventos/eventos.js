(() => {
    let services = [];
    let currentAreas = [];
    const list = document.getElementById('serviceList');
    const status = document.getElementById('servicesStatus');
    const form = document.getElementById('eventForm');

    function date(value) {
        return new Intl.DateTimeFormat('es-MX', { dateStyle: 'full', timeStyle: 'short' }).format(new Date(value));
    }
    function render() {
        list.replaceChildren();
        if (!services.length) { list.innerHTML = '<p class="module-empty">No hay próximos eventos.</p>'; return; }
        services.forEach((service) => {
            const item = document.createElement('article'); item.className = 'module-item';
            item.innerHTML = `<h3></h3><div class="event-meta"></div><p class="event-details"></p>`;
            item.querySelector('h3').textContent = `${service.event_type}: ${service.title}`;
            item.querySelector('.event-meta').textContent = date(service.starts_at);
            item.querySelector('.event-details').textContent = service.details || 'Sin detalles adicionales.';
            if (service.songs?.length) {
                const songs = document.createElement('p'); songs.textContent = `Cantos: ${service.songs.map((song) => song.title).join(', ')}`; item.append(songs);
            }
            if (service.assignments?.length) {
                const team = document.createElement('p'); team.textContent = `Equipo: ${service.assignments.map((a) => `${a.position}: ${a.name}`).join(' · ')}`; item.append(team);
            }
            if (currentAreas.includes(2) || currentAreas.includes(5)) {
                const actions = document.createElement('div'); actions.className = 'module-item-actions';
                const edit = document.createElement('button'); edit.className = 'module-button secondary'; edit.textContent = 'Editar'; edit.type = 'button';
                edit.addEventListener('click', () => { form.elements.id.value = service.id; form.elements.title.value = service.title; form.elements.eventType.value = service.event_type; form.elements.details.value = service.details || ''; const d = new Date(service.starts_at); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); form.elements.startsAt.value = d.toISOString().slice(0, 16); form.querySelector('button[type="submit"]').textContent = 'Actualizar evento'; document.getElementById('cancelEvent').hidden = false; form.scrollIntoView({ behavior: 'smooth' }); });
                const remove = document.createElement('button'); remove.className = 'module-button danger'; remove.textContent = 'Eliminar'; remove.type = 'button';
                remove.addEventListener('click', async () => { if (!window.confirm('¿Eliminar este evento?')) return; try { await MiIglesia.request(`/api/services/${service.id}`, { method: 'DELETE' }); await load(); } catch (error) { status.textContent = error.message; } });
                actions.append(edit, remove); item.append(actions);
            }
            list.append(item);
        });
    }
    async function load() { try { ({ services } = await MiIglesia.request('/api/services')); render(); } catch (error) { status.textContent = error.message; } }
    form?.addEventListener('submit', async (event) => { event.preventDefault(); const data = new FormData(form); const id = data.get('id'); try { await MiIglesia.request(id ? `/api/services/${id}` : '/api/services', { method: id ? 'PATCH' : 'POST', body: JSON.stringify({ title: data.get('title'), eventType: data.get('eventType'), startsAt: data.get('startsAt'), details: data.get('details') }) }); form.reset(); form.elements.id.value = ''; document.getElementById('cancelEvent').hidden = true; await load(); } catch (error) { document.getElementById('eventStatus').textContent = error.message; } });
    document.getElementById('cancelEvent')?.addEventListener('click', () => { form.reset(); form.elements.id.value = ''; document.getElementById('cancelEvent').hidden = true; });
    ModuleShell.start({ allowedAreas: [] }).then((context) => { if (context) { currentAreas = context.areas; document.querySelectorAll('[data-required-area="2"]').forEach((el) => { el.hidden = !currentAreas.includes(2) && !currentAreas.includes(5); }); load(); } });
})();
