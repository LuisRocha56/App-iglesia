(() => {
    const chordSuggestions = ['Do', 'Re', 'Mi', 'Fa', 'Sol', 'La', 'Si'];
    const songsPerPage = 10;
    let songs = [];
    let currentPage = 1;
    let composerLines = [];
    let activeChordInput = null;
    let activeLineIndex = -1;
    let pasteDirty = false;
    let canDeleteAnyComment = false;
    let canManageChords = true;
    window.getRepertorioSongs = () => songs;

    const $ = (selector) => document.querySelector(selector);
    const text = (parent, tag, className, value) => {
        const element = document.createElement(tag);
        element.className = className || '';
        element.textContent = value;
        parent.appendChild(element);
        return element;
    };
    const date = (value) => value
        ? new Intl.DateTimeFormat('es-MX', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
        : 'Sin registro';

    const chordRootPattern = '(?:Do|DO|Re|RE|Mi|MI|Fa|FA|Sol|SOL|La|LA|Si|SI|[A-G])(?:#|b|♯|♭)?';
    const chordTokenRegex = new RegExp(`^${chordRootPattern}(?:maj|min|dim|aug|sus|add|m|M|[0-9]|[#b+\\-°º∆Δ]|\\([^)\\s]*\\))*(?:/${chordRootPattern})?$`);

    function chordLine(value) {
        const tokens = value.trim().split(/\s+/).filter(Boolean);
        return tokens.length > 0 && tokens.length <= 24 && tokens.every((token) => chordTokenRegex.test(token));
    }

    function parseComposer(value) {
        const parsed = [];
        let pendingChord = '';
        String(value || '').replace(/\r/g, '').split('\n').forEach((line) => {
            if (!line.trim()) {
                if (pendingChord) {
                    parsed.push({ chord: pendingChord, lyric: '' });
                    pendingChord = '';
                } else if (parsed.length && parsed[parsed.length - 1].lyric) {
                    parsed.push({ chord: '', lyric: '' });
                }
                return;
            }
            if (chordLine(line)) {
                if (pendingChord) parsed.push({ chord: pendingChord, lyric: '' });
                pendingChord = line.trim();
            } else {
                parsed.push({ chord: pendingChord, lyric: line });
                pendingChord = '';
            }
        });
        if (pendingChord) parsed.push({ chord: pendingChord, lyric: '' });
        return parsed.length ? parsed : [{ chord: '', lyric: '' }];
    }

    function syncComposer() {
        const form = $('#songForm');
        form.elements.lyrics.value = composerLines.map(({ lyric }) => lyric).join('\n');
        form.elements.chords.value = composerLines.map(({ chord }) => chord).join('\n');
    }

    function renderComposer() {
        const editor = $('#songLineEditor');
        editor.classList.toggle('lyrics-only', !canManageChords);
        editor.replaceChildren();
        if (!composerLines.length) {
            text(editor, 'p', 'composer-empty', 'Pega la canción y pulsa “Detectar líneas”.');
            return;
        }
        composerLines.forEach((line, index) => {
            const row = document.createElement('div');
            row.className = 'song-line-row';
            const chord = document.createElement('input');
            chord.className = 'song-line-chord';
            chord.hidden = !canManageChords;
            chord.value = line.chord;
            chord.placeholder = 'Acordes';
            chord.setAttribute('aria-label', `Acordes de la línea ${index + 1}`);
            chord.addEventListener('focus', () => { activeChordInput = chord; });
            chord.addEventListener('input', () => {
                composerLines[index].chord = chord.value;
                syncComposer();
            });
            const lyric = document.createElement('input');
            lyric.value = line.lyric;
            lyric.placeholder = 'Letra';
            lyric.setAttribute('aria-label', `Letra de la línea ${index + 1}`);
            lyric.addEventListener('input', () => {
                composerLines[index].lyric = lyric.value;
                syncComposer();
            });
            const remove = text(row, 'button', 'song-line-remove', 'Quitar');
            remove.type = 'button';
            remove.addEventListener('click', () => {
                composerLines.splice(index, 1);
                activeLineIndex = Math.min(index, composerLines.length - 1);
                renderComposer();
                syncComposer();
            });
            const handle = document.createElement('button');
            handle.type = 'button';
            handle.className = 'song-line-handle';
            handle.textContent = '⋮⋮';
            handle.title = 'Arrastra para mover la línea';
            handle.setAttribute('aria-label', `Mover la línea ${index + 1}`);
            handle.addEventListener('pointerdown', (event) => startLineDrag(event, row, handle));
            row.dataset.index = String(index);
            [chord, lyric].forEach((input) => input.addEventListener('focus', () => { activeLineIndex = index; }));
            row.prepend(handle, chord, lyric);
            editor.appendChild(row);
        });
        syncComposer();
    }

    function startLineDrag(event, row, handle) {
        event.preventDefault();
        const editor = $('#songLineEditor');
        row.classList.add('dragging');
        // Mover la fila en el DOM libera la captura del puntero, por eso se escucha en document.
        const move = (e) => {
            const bounds = editor.getBoundingClientRect();
            if (e.clientY < bounds.top + 40) editor.scrollTop -= 14;
            else if (e.clientY > bounds.bottom - 40) editor.scrollTop += 14;
            const siblings = [...editor.children].filter((el) => el !== row);
            const next = siblings.find((el) => e.clientY < el.getBoundingClientRect().top + el.offsetHeight / 2);
            if (next) {
                if (row.nextSibling !== next) editor.insertBefore(row, next);
            } else if (editor.lastElementChild !== row) {
                editor.appendChild(row);
            }
        };
        const end = () => {
            document.removeEventListener('pointermove', move);
            document.removeEventListener('pointerup', end);
            document.removeEventListener('pointercancel', end);
            const order = [...editor.children].map((el) => Number(el.dataset.index));
            composerLines = order.map((i) => composerLines[i]);
            activeLineIndex = order.indexOf(Number(row.dataset.index));
            renderComposer();
        };
        document.addEventListener('pointermove', move);
        document.addEventListener('pointerup', end);
        document.addEventListener('pointercancel', end);
    }

    function loadComposer(lyrics, chords) {
        const lyricLines = String(lyrics || '').replace(/\r/g, '').split('\n');
        const chordLines = String(chords || '').replace(/\r/g, '').split('\n');
        const length = Math.max(lyricLines.length, chordLines.length, 1);
        composerLines = Array.from({ length }, (_, index) => ({
            chord: chordLines[index] || '',
            lyric: lyricLines[index] || ''
        }));
        $('#songPasteInput').value = composerLines
            .map(({ chord, lyric }) => chord ? `${chord}\n${lyric}` : lyric)
            .join('\n');
        renderComposer();
    }

    function resetForm() {
        $('#songForm').reset();
        $('#songForm').elements.songId.value = '';
        $('#songFormHeading').textContent = 'Agregar canción';
        $('#songForm button[type="submit"]').textContent = 'Guardar canción';
        $('#cancelSongEdit').hidden = true;
        composerLines = [];
        activeLineIndex = -1;
        pasteDirty = false;
        renderComposer();
    }

    function renderActivity() {
        const list = $('#songActivityList');
        list.replaceChildren();
        const recent = [...songs]
            .filter((song) => song.updated_at || song.created_at)
            .sort((a, b) => new Date(b.updated_at || b.created_at) - new Date(a.updated_at || a.created_at))
            .slice(0, 5);
        recent.forEach((song) => {
            const item = document.createElement('div');
            item.className = 'activity-item';
            text(item, 'strong', '', song.title);
            const meta = document.createElement('span');
            meta.className = 'activity-meta';
            const isNew = song.created_at && song.updated_at
                && new Date(song.created_at).getTime() === new Date(song.updated_at).getTime();
            text(meta, 'span', `activity-badge${isNew ? '' : ' updated'}`, isNew ? 'Nueva' : 'Actualizada');
            meta.append(document.createTextNode(date(song.updated_at || song.created_at)));
            item.appendChild(meta);
            list.appendChild(item);
        });
        $('#songActivity').hidden = !recent.length;
    }

    function renderTable() {
        const query = $('#songSearch').value.trim().toLocaleLowerCase('es-MX');
        const filtered = songs.filter((song) =>
            `${song.title} ${song.author || ''}`.toLocaleLowerCase('es-MX').includes(query)
        );
        const pageCount = Math.max(1, Math.ceil(filtered.length / songsPerPage));
        currentPage = Math.min(currentPage, pageCount);
        const visible = filtered.slice((currentPage - 1) * songsPerPage, currentPage * songsPerPage);
        const list = $('#songList');
        list.replaceChildren();
        visible.forEach((song) => {
            const row = document.createElement('tr');
            const titleCell = document.createElement('td');
            const titleButton = text(titleCell, 'button', 'song-name-button', song.title);
            titleButton.type = 'button';
            titleButton.addEventListener('click', () => window.openSongViewer(song));
            row.appendChild(titleCell);
            text(row, 'td', '', song.author || '—');
            text(row, 'td', '', song.has_sequence ? 'Sí' : 'No');
            text(row, 'td', '', song.last_played_at ? date(song.last_played_at) : 'Sin registro');
            const actions = document.createElement('td');
            actions.className = 'table-actions';
            const open = text(actions, 'button', '', 'Abrir lector');
            open.type = 'button';
            open.addEventListener('click', () => window.openSongViewer(song));
            const edit = text(actions, 'button', '', 'Editar');
            edit.type = 'button';
            edit.addEventListener('click', () => startEdit(song));
            const remove = text(actions, 'button', 'delete-song', 'Eliminar');
            remove.type = 'button';
            remove.addEventListener('click', () => deleteSong(song));
            row.appendChild(actions);
            list.appendChild(row);
        });
        if (!filtered.length) {
            const row = document.createElement('tr');
            const cell = text(row, 'td', '', songs.length ? 'No hay coincidencias.' : 'Todavía no hay canciones.');
            cell.colSpan = 5;
            list.appendChild(row);
        }
        $('#songCount').textContent = String(songs.length);
        $('#songResultsMeta').textContent = filtered.length
            ? `Mostrando ${(currentPage - 1) * songsPerPage + 1}–${Math.min(currentPage * songsPerPage, filtered.length)} de ${filtered.length} canciones`
            : '0 canciones';
        const pagination = $('#songPagination');
        pagination.replaceChildren();
        const previous = text(pagination, 'button', '', 'Anterior');
        previous.type = 'button';
        previous.disabled = currentPage === 1;
        previous.addEventListener('click', () => { currentPage -= 1; renderTable(); });
        text(pagination, 'span', 'page-status', `Página ${currentPage} de ${pageCount}`);
        const next = text(pagination, 'button', '', 'Siguiente');
        next.type = 'button';
        next.disabled = currentPage >= pageCount;
        next.addEventListener('click', () => { currentPage += 1; renderTable(); });
    }

    async function loadSongs() {
        const result = await MiIglesia.request('/api/songs');
        songs = result.songs;
        renderActivity();
        renderTable();
    }

    const commentStatusLabels = { pendiente: 'Pendiente', en_revision: 'En revisión', terminado: 'Terminado' };
    const normalizeSearch = (value) => String(value || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

    function hideSongResults() {
        $('#commentSongResults').hidden = true;
    }

    function chooseCommentSong(song) {
        $('#commentSongId').value = song ? song.id : '';
        $('#commentSongSearch').value = song ? song.title : '';
        hideSongResults();
    }

    function renderSongResults() {
        const results = $('#commentSongResults');
        const query = normalizeSearch($('#commentSongSearch').value.trim());
        results.replaceChildren();
        if (!query) {
            hideSongResults();
            return;
        }
        const matches = songs
            .filter((song) => normalizeSearch(`${song.title} ${song.author || ''}`).includes(query))
            .slice(0, 8);
        if (!matches.length) {
            text(results, 'p', 'song-picker-empty', 'No se encontró esa canción.');
        }
        matches.forEach((song) => {
            const option = text(results, 'button', 'song-picker-option', song.title);
            option.type = 'button';
            option.setAttribute('role', 'option');
            if (song.author) text(option, 'small', '', song.author);
            option.addEventListener('mousedown', (event) => event.preventDefault());
            option.addEventListener('click', () => chooseCommentSong(song));
        });
        results.hidden = false;
    }

    $('#commentSongSearch').addEventListener('input', () => {
        $('#commentSongId').value = '';
        renderSongResults();
    });
    $('#commentSongSearch').addEventListener('focus', renderSongResults);
    $('#commentSongSearch').addEventListener('blur', hideSongResults);

    function setComments(comments) {
        const open = comments.filter((comment) => comment.status !== 'terminado').length;
        const badge = $('#commentsOpenCount');
        badge.hidden = !open;
        badge.textContent = `${open} por atender`;
        const list = $('#commentList');
        list.replaceChildren();
        if (!comments.length) {
            text(list, 'p', 'composer-empty', 'No hay comentarios por ahora.');
            return;
        }
        comments.forEach((comment) => list.appendChild(renderComment(comment)));
    }

    async function commentRequest(path, method, body) {
        const status = $('#commentStatus');
        try {
            const result = await MiIglesia.request(path, { method, body: body && JSON.stringify(body) });
            setComments(result.comments);
            status.textContent = '';
            return true;
        } catch (error) {
            status.textContent = error.message;
            return false;
        }
    }

    function renderComment(comment) {
        const item = document.createElement('article');
        item.className = `comment-item ${comment.status}`;
        const meta = text(item, 'div', 'comment-meta', '');
        text(meta, 'strong', '', comment.author_name);
        text(meta, 'span', '', date(comment.created_at));
        if (comment.song_title) text(item, 'span', 'comment-song', `♪ ${comment.song_title}`);
        text(item, 'p', 'comment-body', comment.body);

        const controls = text(item, 'div', 'comment-controls', '');
        const select = document.createElement('select');
        select.className = 'comment-status-select';
        select.setAttribute('aria-label', 'Estatus del comentario');
        Object.entries(commentStatusLabels).forEach(([value, label]) => select.appendChild(new Option(label, value)));
        select.value = comment.status;
        select.addEventListener('change', () => commentRequest(`/api/song-comments/${comment.id}`, 'PATCH', { status: select.value }));
        controls.appendChild(select);
        if (comment.is_mine || canDeleteAnyComment) {
            const remove = text(controls, 'button', 'comment-delete', 'Eliminar');
            remove.type = 'button';
            remove.addEventListener('click', () => {
                if (window.confirm('¿Eliminar este comentario y sus respuestas?')) {
                    commentRequest(`/api/song-comments/${comment.id}`, 'DELETE');
                }
            });
        }

        if (comment.replies.length) {
            const replies = text(item, 'div', 'comment-replies', '');
            comment.replies.forEach((reply) => {
                const entry = text(replies, 'div', 'comment-reply', '');
                const replyMeta = text(entry, 'div', 'comment-meta', '');
                text(replyMeta, 'strong', '', reply.author_name);
                text(replyMeta, 'span', '', date(reply.created_at));
                text(entry, 'p', 'comment-body', reply.body);
            });
        }

        const form = document.createElement('form');
        form.className = 'comment-reply-form';
        const area = document.createElement('textarea');
        area.rows = 2;
        area.maxLength = 1000;
        area.required = true;
        area.placeholder = 'Responder…';
        const send = text(form, 'button', '', 'Responder');
        send.type = 'submit';
        form.prepend(area);
        form.addEventListener('submit', (event) => {
            event.preventDefault();
            commentRequest(`/api/song-comments/${comment.id}/replies`, 'POST', { body: area.value });
        });
        item.appendChild(form);
        return item;
    }

    async function loadComments() {
        const result = await MiIglesia.request('/api/song-comments');
        setComments(result.comments);
    }

    $('#commentForm').addEventListener('submit', async (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const button = form.querySelector('button[type="submit"]');
        button.disabled = true;
        const saved = await commentRequest('/api/song-comments', 'POST', {
            body: form.elements.body.value,
            songId: form.elements.songId.value || null
        });
        if (saved) form.reset();
        button.disabled = false;
    });

    function startEdit(song) {
        const form = $('#songForm');
        form.elements.songId.value = song.id;
        form.elements.title.value = song.title || '';
        form.elements.author.value = song.author || '';
        form.elements.hasSequence.checked = Boolean(song.has_sequence);
        form.elements.chordsUrl.value = song.chords_url || '';
        form.elements.sheetUrl.value = song.sheet_url || '';
        loadComposer(song.lyrics, song.chords);
        $('#songFormHeading').textContent = 'Editar canción';
        form.querySelector('button[type="submit"]').textContent = 'Guardar cambios';
        $('#cancelSongEdit').hidden = false;
        form.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    async function deleteSong(song) {
        if (!window.confirm(`¿Eliminar "${song.title}" del repertorio?`)) return;
        try {
            await MiIglesia.request(`/api/songs/${encodeURIComponent(song.id)}`, { method: 'DELETE' });
            await loadSongs();
            $('#songStatus').textContent = 'Canción eliminada.';
        } catch (error) {
            $('#songStatus').textContent = error.message;
        }
    }

    $('#songPasteInput').addEventListener('input', () => { pasteDirty = true; });
    $('#parseSongLines').addEventListener('click', () => {
        pasteDirty = false;
        composerLines = parseComposer($('#songPasteInput').value);
        renderComposer();
        $('#songLinesDialog').showModal();
        $('#songStatus').textContent = 'Se separaron las líneas de letra y acordes.';
    });
    $('#closeSongLines').addEventListener('click', () => $('#songLinesDialog').close());
    $('#songLinesDialog').addEventListener('close', () => {
        $('#songPasteInput').value = composerLines
            .map(({ chord, lyric }) => chord ? `${chord}\n${lyric}` : lyric)
            .join('\n');
    });
    $('#songLinesDialog').addEventListener('click', (event) => {
        if (event.target === event.currentTarget) event.currentTarget.close();
    });
    $('#addSongLine').addEventListener('click', () => {
        const at = activeLineIndex >= 0 && activeLineIndex < composerLines.length ? activeLineIndex + 1 : composerLines.length;
        composerLines.splice(at, 0, { chord: '', lyric: '' });
        activeLineIndex = at;
        renderComposer();
        const target = $('#songLineEditor').children[at];
        const input = target && (canManageChords ? target.querySelector('.song-line-chord') : target.querySelector('input:not(.song-line-chord)'));
        if (input) { input.focus(); target.scrollIntoView({ block: 'nearest' }); }
    });
    $('#copySongLyrics').addEventListener('click', async () => {
        syncComposer();
        try {
            await navigator.clipboard.writeText($('#songForm').elements.lyrics.value);
            $('#songStatus').textContent = 'La letra se copió sin los acordes.';
        } catch (error) {
            console.error('No se pudo copiar la letra:', error);
            $('#songStatus').textContent = 'No se pudo copiar automáticamente.';
        }
    });
    chordSuggestions.forEach((chordName) => {
        const button = text($('#songChordSuggestions'), 'button', '', chordName);
        button.type = 'button';
        button.addEventListener('click', () => {
            if (!activeChordInput) {
                $('#songStatus').textContent = 'Selecciona primero una línea de acordes.';
                return;
            }
            activeChordInput.value += `${activeChordInput.value.trim() ? ' ' : ''}${chordName}`;
            activeChordInput.dispatchEvent(new Event('input'));
            activeChordInput.focus();
        });
    });
    $('#songSearch').addEventListener('input', () => { currentPage = 1; renderTable(); });
    $('#cancelSongEdit').addEventListener('click', resetForm);
    $('#songForm').addEventListener('submit', async (event) => {
        event.preventDefault();
        const form = event.currentTarget;
        if (pasteDirty && $('#songPasteInput').value.trim()) {
            composerLines = parseComposer($('#songPasteInput').value);
            renderComposer();
        }
        pasteDirty = false;
        syncComposer();
        const data = new FormData(form);
        const songId = String(data.get('songId') || '');
        const button = form.querySelector('button[type="submit"]');
        button.disabled = true;
        try {
            await MiIglesia.request(songId ? `/api/songs/${encodeURIComponent(songId)}` : '/api/songs', {
                method: songId ? 'PATCH' : 'POST',
                body: JSON.stringify({
                    title: data.get('title'),
                    author: data.get('author'),
                    hasSequence: data.get('hasSequence') === 'true',
                    lyrics: data.get('lyrics'),
                    chords: data.get('chords'),
                    chordsUrl: data.get('chordsUrl'),
                    sheetUrl: data.get('sheetUrl')
                })
            });
            resetForm();
            $('#songStatus').textContent = songId ? 'Canción actualizada.' : 'Canción agregada.';
            await loadSongs();
        } catch (error) {
            $('#songStatus').textContent = error.message;
        } finally {
            button.disabled = false;
        }
    });

    (async () => {
        try {
            const { user } = await MiIglesia.request('/api/auth/me');
            const areas = Array.isArray(user.role_ids) && user.role_ids.length
                ? user.role_ids.map(Number)
                : [Number(user.area)];
            if (!areas.some((area) => [1, 2, 3, 5].includes(area))) {
                window.location.replace('../../Inicio.html');
                return;
            }
            $('#repertoireUserName').textContent = user.nombre;
            canManageChords = areas.some((area) => [1, 2, 5].includes(area));
            canDeleteAnyComment = areas.includes(5);
            if (!canManageChords) {
                $('.chord-tools').hidden = true;
            }
            await loadSongs();
            loadComments().catch((error) => {
                $('#commentStatus').textContent = error.status === 404 || /JSON/.test(error.message)
                    ? 'Los comentarios aún no están disponibles en el servidor.'
                    : error.message;
            });
        } catch (error) {
            if (error.status === 401) {
                MiIglesia.clearToken();
                window.location.replace('../../index.html');
            } else {
                $('#songStatus').textContent = error.message || 'No se pudo cargar el repertorio.';
            }
        }
    })();
})();
