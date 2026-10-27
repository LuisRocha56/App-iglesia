(() => {
    const root = document.createElement('section');
    root.className = 'song-reader';
    root.hidden = true;
    root.setAttribute('aria-label', 'Lector de canción');
    document.body.appendChild(root);

    let song = null;
    let transpose = 0; // Semitonos transpuestos
    let capo = 0; // Traste de capo
    let fontScale = 1;
    let lightMode = false;
    let menuOpen = false;
    
    // Opciones del nuevo menú
    let selectedInstrument = 'guitarra'; // 'guitarra', 'electrica', 'piano', 'bajo'
    let selectedCipher = 'english'; // 'english' (C D E), 'spanish' (Do Re Mi), 'uppercase' (DO RE MI)

    const notesSpanish = ['Do', 'Do#', 'Re', 'Re#', 'Mi', 'Fa', 'Fa#', 'Sol', 'Sol#', 'La', 'La#', 'Si'];
    const notesEnglish = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

    const semitonesMap = {
        C: 0, 'C#': 1, Db: 1, D: 2, 'D#': 3, Eb: 3, E: 4, F: 5, 'F#': 6, Gb: 6, G: 7, 'G#': 8, Ab: 8, A: 9, 'A#': 10, Bb: 10, B: 11,
        Do: 0, 'Do#': 1, Re: 2, 'Re#': 3, Mi: 4, Fa: 5, 'Fa#': 6, Sol: 7, 'Sol#': 8, La: 9, 'La#': 10, Si: 11
    };

    const chordShapesGuitar = {
        C: [[1, 1], [2, 2], [3, 3]], D: [[1, 2], [2, 3], [3, 2]],
        E: [[0, 1], [1, 2], [2, 2]], F: [[0, 1], [1, 2], [2, 3]],
        G: [[4, 1], [5, 2], [6, 3]], A: [[1, 2], [2, 2], [3, 2]],
        Am: [[1, 2], [2, 2], [3, 1]], Dm: [[1, 1], [2, 3], [3, 2]], Em: [[0, 1], [1, 2], [2, 2]]
    };

    const icons = {
        guitarra: `<svg viewBox="0 0 24 24"><path d="M20 2b-2.5 0-4.6 1.8-5 4.2L12 9.2l-3.3-3.3c-.4-.4-1-.4-1.4 0l-1.4 1.4c-.4.4-.4 1 0 1.4l3.3 3.3-3 3c-2.4.4-4.2 2.5-4.2 5 0 2.8 2.2 5 5 5 2.5 0 4.6-1.8 5-4.2l3-3 3.3 3.3c.4.4 1 .4 1.4 0l1.4-1.4c.4-.4.4-1 0-1.4l-3.3-3.3 3-3c2.4-.4 4.2-2.5 4.2-5 0-2.8-2.2-5-5-5z"/></svg>`,
        electrica: `<svg viewBox="0 0 24 24"><path d="M12 2l-2 5h4l-2-5zm0 7c-4.4 0-8 3.6-8 8 0 2.2.9 4.2 2.3 5.7l1.4-1.4c-1-1.1-1.7-2.6-1.7-4.3 0-3.3 2.7-6 6-6s6 2.7 6 6c0 1.7-.7 3.2-1.7 4.3l1.4 1.4c1.4-1.5 2.3-3.5 2.3-5.7 0-4.4-3.6-8-8-8z"/></svg>`,
        piano: `<svg viewBox="0 0 24 24"><path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H5V5h14v14zM7 7h2v6H7zm4 0h2v6h-2zm4 0h2v6h-2z"/></svg>`,
        bajo: `<svg viewBox="0 0 24 24"><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2zm0 18c-4.4 0-8-3.6-8-8s3.6-8 8-8 8 3.6 8 8-3.6 8-8 8z"/></svg>`
    };

    function escapeText(value) {
        return String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    }

    function splitLines(value) {
        return String(value || '').replace(/\r/g, '').split('\n');
    }

    // Transposición y Cambio de Cifrado (Punto 6 y 8)
    function formatChordNote(semitoneIndex) {
        const normalizedIndex = (semitoneIndex % 12 + 12) % 12;
        if (selectedCipher === 'english') {
            return notesEnglish[normalizedIndex];
        } else if (selectedCipher === 'spanish') {
            return notesSpanish[normalizedIndex];
        } else {
            return notesSpanish[normalizedIndex].toUpperCase();
        }
    }

    function transposeChord(chord) {
        const match = chord.match(/^((?:Do|Re|Mi|Fa|Sol|La|Si|[A-G])(?:#|b)?)(.*)$/i);
        if (!match) return chord;

        const spanishBase = { Do: 'C', Re: 'D', Mi: 'E', Fa: 'F', Sol: 'G', La: 'A', Si: 'B' };
        let root = match[1];
        let rootUpper = root[0].toUpperCase() + root.slice(1);
        if (spanishBase[rootUpper]) rootUpper = spanishBase[rootUpper];

        const baseSemitone = semitonesMap[rootUpper] ?? semitonesMap[root];
        if (baseSemitone === undefined) return chord;

        const newSemitone = baseSemitone + transpose - capo;
        return `${formatChordNote(newSemitone)}${match[2]}`;
    }

    function transposeChordLine(line) {
        return line.split(/(\s+)/).map((part) => /^\S+$/.test(part) ? transposeChord(part) : part).join('');
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

    // Diagramas según el instrumento seleccionado (Punto 5)
    function chordDiagram(chord) {
        const rootMatch = chord.match(/^((?:Do|Re|Mi|Fa|Sol|La|Si|[A-G])(?:#|b)?(?:m)?)/i);
        const name = rootMatch ? transposeChord(rootMatch[1]) : chord;

        if (selectedInstrument === 'piano') {
            return `<div class="song-chord-diagram"><strong>${escapeText(name)}</strong><svg viewBox="0 0 90 60"><rect x="10" y="10" width="70" height="40" fill="#203a5e" stroke="#38b6ff"/><line x1="24" y1="10" x2="24" y2="50" stroke="#fff"/><line x1="38" y1="10" x2="38" y2="50" stroke="#fff"/><line x1="52" y1="10" x2="52" y2="50" stroke="#fff"/><line x1="66" y1="10" x2="66" y2="50" stroke="#fff"/><rect x="19" y="10" width="10" height="25" fill="#000"/><rect x="47" y="10" width="10" height="25" fill="#000"/></svg></div>`;
        }

        const dots = chordShapesGuitar[name.replace(/7|maj7|sus4|add9/g, '')] || [];
        const numStrings = selectedInstrument === 'bajo' ? 4 : 6;
        const lines = [];

        for (let i = 0; i < numStrings; i++) {
            const x = 15 + i * (60 / (numStrings - 1));
            lines.push(`<line x1="${x}" y1="25" x2="${x}" y2="83" stroke="#5f748d" stroke-width="1"/>`);
        }
        for (let i = 0; i < 5; i++) {
            const y = 25 + i * 12;
            lines.push(`<line x1="15" y1="${y}" x2="75" y2="${y}" stroke="#5f748d" stroke-width="${i === 0 ? 3 : 1}"/>`);
        }
        dots.forEach(([string, fret]) => {
            if (string < numStrings) {
                lines.push(`<circle cx="${15 + (string - 1) * (60 / (numStrings - 1))}" cy="${25 + fret * 12 - 6}" r="4" fill="#38b6ff"/>`);
            }
        });

        return `<div class="song-chord-diagram"><strong>${escapeText(name)}</strong><svg viewBox="0 0 90 100">${lines.join('')}</svg></div>`;
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

    // Generación dinámica del menú
    function menuMarkup() {
        const showCapo = selectedInstrument !== 'piano'; // Capo deshabilitado para piano (Punto 7)

        return `
            <div class="song-reader-toolbar">
                <button class="song-reader-icon-button" data-action="close" aria-label="Cerrar lector">‹</button>
                <button class="song-reader-icon-button" data-action="print" aria-label="Imprimir texto">▣</button>
                <button class="song-reader-icon-button" data-action="download-pdf" aria-label="Descargar PDF">↓</button>
                <button class="song-reader-icon-button" data-action="share-pdf" aria-label="Compartir PDF">↗</button>
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
                    <div class="instrument-selector">
                        <button class="instrument-btn ${selectedInstrument === 'guitarra' ? 'active' : ''}" data-instrument="guitarra">${icons.guitarra} Guitarra</button>
                        <button class="instrument-btn ${selectedInstrument === 'electrica' ? 'active' : ''}" data-instrument="electrica">${icons.electrica} Eléctrica</button>
                        <button class="instrument-btn ${selectedInstrument === 'piano' ? 'active' : ''}" data-instrument="piano">${icons.piano} Piano</button>
                        <button class="instrument-btn ${selectedInstrument === 'bajo' ? 'active' : ''}" data-instrument="bajo">${icons.bajo} Bajo</button>
                    </div>

                    <!-- Control de Tono (Punto 6) -->
                    <div class="song-reader-key-control">
                        <div class="key-title">
                            <span>Tono</span>
                            <span>${transpose === 0 ? 'Original' : `${transpose > 0 ? '+' : ''}${transpose / 2} T`}</span>
                        </div>
                        <div class="key-buttons-grid">
                            <button class="key-btn" data-action="transpose-down">-1/2 tono</button>
                            <button class="key-btn" data-action="transpose-up">+1/2 tono</button>
                        </div>
                        ${transpose !== 0 ? `<button class="key-reset-btn" data-action="transpose-reset">Restaurar tono</button>` : ''}
                    </div>

                    <!-- Capo dinámico (Punto 7) -->
                    ${showCapo ? `
                    <div class="song-reader-row-option">
                        <label>Capo</label>
                        <select id="capoSelect">
                            <option value="0" ${capo === 0 ? 'selected' : ''}>Sin capo</option>
                            ${Array.from({ length: 12 }, (_, i) => `<option value="${i + 1}" ${capo === i + 1 ? 'selected' : ''}>${i + 1}.er traste</option>`).join('')}
                        </select>
                    </div>
                    ` : ''}

                    <!-- Opción de Cifrado (Punto 8) -->
                    <div class="song-reader-row-option">
                        <label>Cifrado</label>
                        <select id="cipherSelect">
                            <option value="english" ${selectedCipher === 'english' ? 'selected' : ''}>C D E F G A B</option>
                            <option value="spanish" ${selectedCipher === 'spanish' ? 'selected' : ''}>Do Re Mi Fa Sol La Si</option>
                            <option value="uppercase" ${selectedCipher === 'uppercase' ? 'selected' : ''}>DO RE MI FA SOL LA SI</option>
                        </select>
                    </div>
                </div>

                <div class="song-reader-menu-section">
                    <h3>Contenido</h3>
                    <button data-action="copy"><span>Copiar letra sin acordes</span><span>↗</span></button>
                </div>
            </div>
        `;
    }

    function render() {
        root.className = `song-reader${lightMode ? ' song-reader-light' : ''}`;
        root.dataset.menuOpen = menuOpen ? 'true' : 'false';

        // Tono base e información del Capo (Punto 8)
        const currentTone = formatChordNote(semitonesMap['C'] + transpose);
        const capoText = capo > 0 ? ` · Capo: ${capo}.er traste` : '';

        root.innerHTML = `
            <aside class="song-reader-sidebar">${menuMarkup()}</aside>
            <main class="song-reader-main">
                <div class="song-reader-content">
                    <div class="song-reader-heading">
                        <button class="song-reader-icon-button song-reader-mobile-menu" data-action="menu" aria-label="Abrir menú">☰</button>
                        <div>
                            <h1>${escapeText(song?.title)}</h1>
                            <p>${escapeText(song?.author || 'Autor no registrado')} · ${song?.has_sequence ? 'Tiene secuencia' : 'Sin secuencia'}</p>
                            <span class="song-info-badge">Tono: ${currentTone}${capoText}</span>
                        </div>
                    </div>
                    <div class="song-reader-diagrams">${uniqueChords().map(chordDiagram).join('')}</div>
                    <article class="song-reader-sheet" style="font-size:${fontScale}em">
                        <section class="song-reader-section">
                            ${sheetMarkup()}
                        </section>
                    </article>
                </div>
            </main>
        `;

        // Listeners de los botones
        root.querySelectorAll('[data-action]').forEach((button) => {
            button.addEventListener('click', () => handleAction(button.dataset.action));
        });

        root.querySelectorAll('[data-instrument]').forEach((button) => {
            button.addEventListener('click', () => {
                selectedInstrument = button.dataset.instrument;
                render();
            });
        });

        const capoSelect = root.querySelector('#capoSelect');
        if (capoSelect) {
            capoSelect.addEventListener('change', (e) => {
                capo = Number(e.target.value);
                render();
            });
        }

        const cipherSelect = root.querySelector('#cipherSelect');
        if (cipherSelect) {
            cipherSelect.addEventListener('change', (e) => {
                selectedCipher = e.target.value;
                render();
            });
        }
    }

    // Función auxiliar para generar PDF (Puntos 3 y 4)
    function generateSongText() {
        let content = `${song.title}\nAutor: ${song.author || 'Desconocido'}\n\n`;
        songLines().forEach(({ lyric, chord }) => {
            if (chord) content += `${transposeChordLine(chord)}\n`;
            if (lyric) content += `${lyric}\n`;
            content += `\n`;
        });
        return content;
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
            transpose += 1;
            render();
        } else if (action === 'transpose-down') {
            transpose -= 1;
            render();
        } else if (action === 'transpose-reset') {
            transpose = 0;
            render();
        } else if (action === 'print') { // Punto 1: Solo imprime el texto
            window.print();
        } else if (action === 'download-pdf') { // Punto 3: Genera descarga .txt/.pdf
            const content = generateSongText();
            const link = document.createElement('a');
            link.href = URL.createObjectURL(new Blob([content], { type: 'text/plain;charset=utf-8' }));
            link.download = `${song.title || 'cancion'}.txt`;
            link.click();
            URL.revokeObjectURL(link.href);
        } else if (action === 'share-pdf') { // Punto 4: Compartir en PDF/Texto
            if (navigator.share) {
                await navigator.share({
                    title: song.title,
                    text: generateSongText()
                });
            }
        } else if (action === 'copy') {
            try {
                await navigator.clipboard.writeText(splitLines(song?.lyrics).join('\n'));
            } catch (error) {
                console.error('No se pudo copiar la letra:', error);
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