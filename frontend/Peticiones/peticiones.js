(() => {
    const list = document.getElementById('prayerList'); const status = document.getElementById('prayerStatus');
    function render(prayers) { list.replaceChildren(); if (!prayers.length) { list.innerHTML = '<p class="module-empty">Todavía no hay peticiones publicadas.</p>'; return; } prayers.forEach((prayer) => { const item = document.createElement('article'); item.className = 'module-item'; const title = document.createElement('h3'); title.textContent = prayer.author_name || 'Petición de oración'; const text = document.createElement('p'); text.textContent = prayer.body; item.append(title, text); list.append(item); }); }
    async function load() { try { const { prayers } = await MiIglesia.request('/api/prayers'); render(prayers); } catch (error) { status.textContent = error.message; } }
    document.getElementById('prayerForm').addEventListener('submit', async (event) => { event.preventDefault(); const form = event.currentTarget; try { await MiIglesia.request('/api/prayers', { method: 'POST', body: JSON.stringify({ body: new FormData(form).get('body') }) }); form.reset(); status.textContent = 'Petición enviada para aprobación.'; await load(); } catch (error) { status.textContent = error.message; } });
    ModuleShell.start().then((context) => { if (context) load(); });
})();
