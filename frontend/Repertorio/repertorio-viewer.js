(() => {
    const root = document.createElement('section');
    root.className = 'song-reader';
    root.hidden = true;
    root.setAttribute('aria-label', 'Lector de canción');
    document.body.appendChild(root);

    let song = null;
    let transpose = 0;
    let capo = 0;
    let fontScale = 1;
    let lightMode = false;
    let menuOpen = false;

    const semitones = {
        C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4,
        F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9,
        'A#': 10, Bb: 10, B: 11
    };
    const noteNames = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
    const chordShapes = {
        C: [[1, 1], [2, 2], [3, 3]], D: [[1, 2], [2, 3], [3, 2]],
        E: [[0, 1], [1, 2], [2, 2]], F: [[0, 1], [1, 2], [2, 3]],
        G: [[4, 1], [5, 2], [6, 3]], A: [[1, 2], [2, 2], [3, 2]],
        Am: [[1, 2], [2, 2], [3, 1]], Dm: [[1, 1], [2, 3], [3, 2]],
        Em: [[0, 1], [1, 2], [2, 2]]
    };

    function escapeText(value) {
        return String(value || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function splitLines(value) {
        return String(value || '').replace(/\r/g, '').split('\n');
    }

    function transposeChord(chord) {
        const match = chord.match(/^((?:Do|Re|Mi|Fa|Sol|La|Si|[A-G])(?:#|b)?)(.*)$/i);
        if (!match || !transpose) return chord;
        const spanish = { Do: 'C', Re: 'D', Mi: 'E', Fa: 'F', Sol: 'G', La: 'A', Si: 'B' };
        const root = spanish[match[1]] || match[1];
        const normalizedRoot = root[0].toUpperCase() + root.slice(1);
        if (!(normalizedRoot in semitones)) return chord;
        return `${noteNames[(semitones[normalizedRoot] + transpose + 12) % 12]}${match[2]}`;
    }

    function transposeChordLine(line) {
        return line.split(/(\s+)/).map((part) =>
            /^\S+$/.test(part) ? transposeChord(part) : part
        ).join('');
    }

    function songLines() {
        const lyrics = splitLines(song?.lyrics);
        const chords = splitLines(song?.chords);
        const count = Math.max(lyrics.length, chords.length);
        return Array.from({ length: count }, (_, index) => ({
            lyric: lyrics[index] || '',
            chord: chords[index] || ''
        }));
    }

    function chordDiagram(chord) {
        const rootMatch = chord.match(/^((?:Do|Re|Mi|Fa|Sol|La|Si|[A-G])(?:#|b)?(?:m)?)/i);
        const name = rootMatch ? transposeChord(rootMatch[1]) : chord;
        const shapeName = name.replace(/^(?:[A-G](?:#|b)?)/, (root) => root) in chordShapes
            ? name.replace(/7|maj7|sus4|add9/g, '')
            : name;
        const dots = chordShapes[shapeName] || [];
        const lines = [];
        for (let index = 0; index < 6; index++) {
            const x = 15 + index * 12;
            lines.push(`<line x1="${x}" y1="25" x2="${x}" y2="83" stroke="#5f748d" stroke-width="1"/>`);
        }
        for (let index = 0; index < 5; index++) {
            const y = 25 + index * 12;
            lines.push(`<line x1="15" y1="${y}" x2="75" y2="${y}" stroke="#5f748d" stroke-width="${index === 0 ? 3 : 1}"/>`);
        }
        dots.forEach(([string, fret]) => {
            lines.push(`<circle cx="${15 + (string - 1) * 12}" cy="${25 + fret * 12 - 6}" r="4" fill="#38b6ff"/>`);
        });
        return `<div class="song-chord-diagram"><strong>${escapeText(name)}</strong><svg viewBox="0 0 90 100" aria-label="Diagrama de ${escapeText(name)}">${lines.join('')}</svg></div>`;
    }

    function uniqueChords() {
        const found = [];
        songLines().forEach(({ chord }) => {
            chord.split(/\s+/).filter(Boolean).forEach((value) => {
                const normalized = transposeChord(value);
                if (!found.includes(normalized)) found.push(normalized);
            });
        });
        return found.slice(0, 10);
    }

    function sheetMarkup() {
        const lines = songLines();
        if (!lines.length || !lines.some(({ lyric, chord }) => lyric || chord)) {
            return '<p class="song-reader-empty">Esta canción todavía no tiene letra.</p>';
        }
        return lines.map(({ lyric, chord }) => `
            <div class="song-reader-line">
                <div class="song-reader-chords">${escapeText(transposeChordLine(chord))}</div>
                <div class="song-reader-lyrics">${escapeText(lyric)}</div>
            </div>
        `).join('');
    }

    function menuMarkup() {
        return `
            <div class="song-reader-toolbar">
                <button class="song-reader-icon-button" data-action="close" aria-label="Cerrar lector">‹</button>
                <button class="song-reader-icon-button" data-action="print" aria-label="Imprimir canción">▣</button>
                <button class="song-reader-icon-button" data-action="bookmark" aria-label="Guardar canción">♡</button>
                <button class="song-reader-icon-button" data-action="download" aria-label="Descargar canción">↓</button>
                <button class="song-reader-icon-button" data-action="share" aria-label="Compartir canción">↗</button>
            </div>
            <div class="song-reader-menu">
                <div class="song-reader-menu-section">
                    <h3>Vista</h3>
                    <button data-action="theme"><span>Tema</span><span>${lightMode ? 'Claro' : 'Oscuro'}</span></button>
                    <button data-action="font-down"><span>Texto</span><span>100%</span></button>
                    <button data-action="font-up"><span>Aumentar texto</span><span>+</span></button>
                </div>
                <div class="song-reader-menu-section">
                    <h3>Instrumento</h3>
                    <button data-action="instrument"><span>Diagramas</span><span>Guitarra ›</span></button>
                    <div class="song-reader-stepper">
                        <strong>Tono</strong>
                        <button data-action="transpose-down" aria-label="Bajar tono">−</button>
                        <span>${transpose === 0 ? 'Original' : `${transpose > 0 ? '+' : ''}${transpose}`}</span>
                        <button data-action="transpose-up" aria-label="Subir tono">+</button>
                    </div>
                    <div class="song-reader-stepper">
                        <strong>Capo</strong>
                        <button data-action="capo-down" aria-label="Bajar capo">−</button>
                        <span>${capo}º traste</span>
                        <button data-action="capo-up" aria-label="Subir capo">+</button>
                    </div>
                    <button data-action="tuning"><span>Afinación</span><span>Estándar ›</span></button>
                </div>
                <div class="song-reader-menu-section">
                    <h3>Contenido</h3>
                    <button data-action="copy"><span>Copiar letra sin acordes</span><span>↗</span></button>
                    <button data-action="share"><span>Compartir canción</span><span>↗</span></button>
                </div>
            </div>
        `;
    }

    function render() {
        root.className = `song-reader${lightMode ? ' song-reader-light' : ''}`;
        root.dataset.menuOpen = menuOpen ? 'true' : 'false';
        root.innerHTML = `
            <aside class="song-reader-sidebar">${menuMarkup()}</aside>
            <main class="song-reader-main">
                <div class="song-reader-content">
                    <div class="song-reader-heading">
                        <button class="song-reader-icon-button song-reader-mobile-menu" data-action="menu" aria-label="Abrir menú">☰</button>
                        <div>
                            <h1>${escapeText(song?.title)}</h1>
                            <p>${escapeText(song?.author || 'Autor no registrado')} · ${song?.has_sequence ? 'Tiene secuencia' : 'Sin secuencia'}</p>
                        </div>
                    </div>
                    <div class="song-reader-diagrams">${uniqueChords().map(chordDiagram).join('')}</div>
                    <article class="song-reader-sheet" style="font-size:${fontScale}em">
                        <section class="song-reader-section">
                            <h2 class="song-reader-section-title">Letra y acordes</h2>
                            ${sheetMarkup()}
                        </section>
                    </article>
                </div>
            </main>
        `;
        root.querySelectorAll('[data-action]').forEach((button) => {
            button.addEventListener('click', () => handleAction(button.dataset.action));
        });
    }

    async function handleAction(action) {
        if (action === 'close') {
            root.hidden = true;
            document.body.style.overflow = '';
        } else if (action === 'menu') {
            menuOpen = !menuOpen;
            render();
        } else if (action === 'theme') {
            lightMode = !lightMode;
            render();
        } else if (action === 'font-up') {
            fontScale = Math.min(1.5, fontScale + .1);
            render();
        } else if (action === 'font-down') {
            fontScale = Math.max(.8, fontScale - .1);
            render();
        } else if (action === 'transpose-up') {
            transpose = (transpose + 1) % 12;
            render();
        } else if (action === 'transpose-down') {
            transpose = (transpose + 11) % 12;
            render();
        } else if (action === 'capo-up') {
            capo = Math.min(12, capo + 1);
            render();
        } else if (action === 'capo-down') {
            capo = Math.max(0, capo - 1);
            render();
        } else if (action === 'copy') {
            try {
                await navigator.clipboard.writeText(splitLines(song?.lyrics).join('\n'));
            } catch (error) {
                console.error('No se pudo copiar la letra:', error);
            }
        } else if (action === 'bookmark') {
            const key = 'mi-iglesia-bookmarked-songs';
            const saved = new Set(JSON.parse(localStorage.getItem(key) || '[]'));
            if (saved.has(String(song.id))) saved.delete(String(song.id));
            else saved.add(String(song.id));
            localStorage.setItem(key, JSON.stringify([...saved]));
        } else if (action === 'download') {
            const content = `${song.title}\n\n${splitLines(song?.lyrics).join('\n')}`;
            const link = document.createElement('a');
            link.href = URL.createObjectURL(new Blob([content], { type: 'text/plain;charset=utf-8' }));
            link.download = `${song.title || 'cancion'}.txt`;
            link.click();
            URL.revokeObjectURL(link.href);
        } else if (action === 'print') {
            window.print();
        } else if (action === 'share') {
            if (navigator.share) {
                await navigator.share({ title: song.title, text: splitLines(song?.lyrics).join('\n') });
            }
        }
    }

    window.openSongViewer = (selectedSong) => {
        song = selectedSong;
        transpose = 0;
        capo = 0;
        menuOpen = false;
        render();
        root.hidden = false;
        document.body.style.overflow = 'hidden';
    };
})();