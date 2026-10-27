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
    let openSubmenu = null;
    let searchQuery = '';

    let selectedInstrument = 'guitarra';
    let selectedCipher = 'spanish';

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

    function menuMarkup() {
        const showCapo = selectedInstrument !== 'piano';
        const currentNoteName = formatChordNote(semitonesMap['C'] + transpose);

        return `
            <div class="song-reader-toolbar">
                <button class="song-reader-icon-button" data-action="close" aria-label="Cerrar lector">‹</button>
                <button class="song-reader-icon-button" data-action="print" aria-label="Imprimir texto">▣</button>
                <button class="song-reader-icon-button" data-action="download-pdf" aria-label="Descargar texto">↓</button>
                <button class="song-reader-icon-button" data-action="share-pdf" aria-label="Compartir texto">↗</button>
            </div>

            <div class="song-reader-search">
                <input type="search" id="songReaderSearch" placeholder="Buscar otra canción…" autocomplete="off" value="${escapeText(searchQuery).replace(/"/g, '&quot;')}" aria-label="Buscar otra canción">
                <div class="song-reader-search-results" id="songReaderSearchResults" hidden></div>
            </div>

            <div class="song-reader-menu">
                <div class="song-reader-menu-section">
                    <h3>Vista</h3>
                    <button class="song-reader-menu-item" data-action="theme"><span>Tema</span><span class="item-val">${lightMode ? 'Claro' : 'Oscuro'}</span></button>
                    <button class="song-reader-menu-item" data-action="font-down"><span>Texto</span><span class="item-val">100%</span></button>
                    <button class="song-reader-menu-item" data-action="font-up"><span>Aumentar texto</span><span class="item-val">+</span></button>
                </div>

                <div class="song-reader-menu-section">
                    <h3>Ajustes Musicales</h3>
                    
                    <!-- 1. Instrumento -->
                    <button class="song-reader-menu-item ${openSubmenu === 'instrument' ? 'active' : ''}" data-toggle-submenu="instrument">
                        <span>Instrumento</span>
                        <span class="item-val">${selectedInstrument.charAt(0).toUpperCase() + selectedInstrument.slice(1)} ›</span>
                    </button>
                    <div class="song-reader-submenu ${openSubmenu === 'instrument' ? 'open' : ''}">
                        <div class="options-grid">
                            <button class="option-btn ${selectedInstrument === 'guitarra' ? 'selected' : ''}" data-set-instrument="guitarra">${icons.guitarra} Guitarra</button>
                            <button class="option-btn ${selectedInstrument === 'electrica' ? 'selected' : ''}" data-set-instrument="electrica">${icons.electrica} Eléctrica</button>
                            <button class="option-btn ${selectedInstrument === 'piano' ? 'selected' : ''}" data-set-instrument="piano">${icons.piano} Piano</button>
                            <button class="option-btn ${selectedInstrument === 'bajo' ? 'selected' : ''}" data-set-instrument="bajo">${icons.bajo} Bajo</button>
                        </div>
                    </div>

                    <!-- 2. Tono -->
                    <button class="song-reader-menu-item ${openSubmenu === 'tone' ? 'active' : ''}" data-toggle-submenu="tone">
                        <span>Tono</span>
                        <span class="item-val">${currentNoteName} (${transpose === 0 ? 'Original' : `${transpose > 0 ? '+' : ''}${transpose / 2} T`}) ›</span>
                    </button>
                    <div class="song-reader-submenu ${openSubmenu === 'tone' ? 'open' : ''}">
                        <div class="tone-controls">
                            <button class="tone-btn" data-action="transpose-down">-1/2 tono</button>
                            <button class="tone-btn" data-action="transpose-up">+1/2 tono</button>
                        </div>
                        <div class="options-grid">
                            ${notesSpanish.map((note, idx) => `
                                <button class="option-btn ${((semitonesMap['C'] + transpose) % 12 + 12) % 12 === idx ? 'selected' : ''}" data-set-transpose="${idx}">
                                    ${formatChordNote(idx)}
                                </button>
                            `).join('')}
                        </div>
                        ${transpose !== 0 ? `<button class="reset-btn" data-action="transpose-reset">Restaurar tono original</button>` : ''}
                    </div>

                    <!-- 3. Capo -->
                    ${showCapo ? `
                    <button class="song-reader-menu-item ${openSubmenu === 'capo' ? 'active' : ''}" data-toggle-submenu="capo">
                        <span>Capo</span>
                        <span class="item-val">${capo === 0 ? 'Sin capo' : `${capo}.er traste`} ›</span>
                    </button>
                    <div class="song-reader-submenu ${openSubmenu === 'capo' ? 'open' : ''}">
                        <div class="options-grid">
                            <button class="option-btn ${capo === 0 ? 'selected' : ''}" data-set-capo="0">Sin capo</button>
                            ${Array.from({ length: 12 }, (_, i) => `
                                <button class="option-btn ${capo === i + 1 ? 'selected' : ''}" data-set-capo="${i + 1}">
                                    ${i + 1}º traste
                                </button>
                            `).join('')}
                        </div>
                    </div>
                    ` : ''}

                    <!-- 4. Cifrado -->
                    <button class="song-reader-menu-item ${openSubmenu === 'cipher' ? 'active' : ''}" data-toggle-submenu="cipher">
                        <span>Cifrado</span>
                        <span class="item-val">${selectedCipher === 'english' ? 'C D E' : selectedCipher === 'spanish' ? 'Do Re Mi' : 'DO RE MI'} ›</span>
                    </button>
                    <div class="song-reader-submenu ${openSubmenu === 'cipher' ? 'open' : ''}">
                        <div class="options-grid full-width">
                            <button class="option-btn ${selectedCipher === 'english' ? 'selected' : ''}" data-set-cipher="english">C D E F G A B</button>
                            <button class="option-btn ${selectedCipher === 'spanish' ? 'selected' : ''}" data-set-cipher="spanish">Do Re Mi Fa Sol La Si</button>
                            <button class="option-btn ${selectedCipher === 'uppercase' ? 'selected' : ''}" data-set-cipher="uppercase">DO RE MI FA SOL LA SI</button>
                        </div>
                    </div>
                </div>

                <div class="song-reader-menu-section">
                    <h3>Contenido</h3>
                    <button class="song-reader-menu-item" data-action="copy"><span>Copiar letra sin acordes</span><span class="item-val">↗</span></button>
                </div>
            </div>
        `;
    }

    function render() {
        root.className = `song-reader${lightMode ? ' song-reader-light' : ''}`;
        root.dataset.menuOpen = menuOpen ? 'true' : 'false';

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

        const searchInput = root.querySelector('#songReaderSearch');
        const searchResults = root.querySelector('#songReaderSearchResults');

        function renderSearchResults() {
            searchResults.replaceChildren();
            const query = searchQuery.trim().toLocaleLowerCase('es-MX');
            if (!query) {
                searchResults.hidden = true;
                return;
            }
            const all = typeof window.getRepertorioSongs === 'function' ? window.getRepertorioSongs() : [];
            const matches = all
                .filter((item) => `${item.title} ${item.author || ''}`.toLocaleLowerCase('es-MX').includes(query))
                .slice(0, 8);
            if (!matches.length) {
                const empty = document.createElement('p');
                empty.className = 'song-reader-search-empty';
                empty.textContent = 'Sin resultados';
                searchResults.appendChild(empty);
            }
            matches.forEach((item) => {
                const button = document.createElement('button');
                button.type = 'button';
                button.className = 'song-reader-search-item';
                const title = document.createElement('strong');
                title.textContent = item.title;
                const author = document.createElement('span');
                author.textContent = item.author || 'Autor no registrado';
                button.append(title, author);
                button.addEventListener('click', () => {
                    searchQuery = '';
                    window.openSongViewer(item, { keepMenu: true });
                });
                searchResults.appendChild(button);
            });
            searchResults.hidden = false;
        }

        searchInput.addEventListener('input', () => {
            searchQuery = searchInput.value;
            renderSearchResults();
        });
        renderSearchResults();

        // Desplegar/cerrar submenús
        root.querySelectorAll('[data-toggle-submenu]').forEach((button) => {
            button.addEventListener('click', (e) => {
                e.stopPropagation();
                const target = button.dataset.toggleSubmenu;
                openSubmenu = openSubmenu === target ? null : target;
                render();
            });
        });

        // Eventos de botones internos
        root.querySelectorAll('[data-set-instrument]').forEach((btn) => {
            btn.addEventListener('click', () => {
                selectedInstrument = btn.dataset.setInstrument;
                openSubmenu = null;
                render();
            });
        });

        root.querySelectorAll('[data-set-transpose]').forEach((btn) => {
            btn.addEventListener('click', () => {
                const targetIndex = Number(btn.dataset.setTranspose);
                transpose = targetIndex - semitonesMap['C'];
                openSubmenu = null;
                render();
            });
        });

        root.querySelectorAll('[data-set-capo]').forEach((btn) => {
            btn.addEventListener('click', () => {
                capo = Number(btn.dataset.setCapo);
                openSubmenu = null;
                render();
            });
        });

        root.querySelectorAll('[data-set-cipher]').forEach((btn) => {
            btn.addEventListener('click', () => {
                selectedCipher = btn.dataset.setCipher;
                openSubmenu = null;
                render();
            });
        });

        root.querySelectorAll('[data-action]').forEach((button) => {
            button.addEventListener('click', () => handleAction(button.dataset.action));
        });
    }

    function generateSongText() {
        let content = `${song.title}\nAutor: ${song.author || 'Desconocido'}\n\n`;
        songLines().forEach(({ lyric, chord }) => {
            if (chord) content += `${transposeChordLine(chord)}\n`;
            if (lyric) content += `${lyric}\n`;
            content += `\n`;
        });
        return content;
    }

    function songPrintRows() {
        const rows = [];
        songLines().forEach(({ lyric, chord }) => {
            const chordText = transposeChordLine(chord).replace(/\s+$/, '');
            if (chordText) rows.push({ text: chordText, chord: true });
            rows.push({ text: lyric, chord: false });
        });
        return rows;
    }

    function printSong() {
        const frame = document.createElement('iframe');
        frame.style.cssText = 'position:fixed;width:0;height:0;border:0;right:0;bottom:0';
        const body = songPrintRows()
            .map((row) => `<div class="${row.chord ? 'c' : 'l'}">${escapeText(row.text) || '&nbsp;'}</div>`)
            .join('');
        frame.srcdoc = `<!doctype html><html><head><meta charset="utf-8"><title>${escapeText(song.title)}</title>
            <style>
                @page { margin: 18mm; }
                body { margin: 0; background: #fff; color: #000; font-family: 'Courier New', monospace; font-size: 11pt; }
                h1 { margin: 0 0 2pt; font-size: 16pt; }
                p { margin: 0 0 14pt; font-size: 10pt; color: #333; }
                div { white-space: pre-wrap; line-height: 1.35; }
                .c { font-weight: bold; }
            </style></head><body>
            <h1>${escapeText(song.title)}</h1><p>${escapeText(song.author || '')}</p>${body}</body></html>`;
        frame.onload = () => {
            frame.contentWindow.focus();
            frame.contentWindow.print();
            setTimeout(() => frame.remove(), 2000);
        };
        document.body.appendChild(frame);
    }

    // Genera un PDF simple (Courier) con letra y acordes, sin fondo ni dependencias externas
    function buildPdfBlob() {
        const pageWidth = 595;
        const pageHeight = 842;
        const margin = 50;
        const fontSize = 10;
        const lineHeight = 14;
        const maxChars = Math.floor((pageWidth - margin * 2) / (fontSize * 0.6));
        const maxLines = Math.floor((pageHeight - margin * 2) / lineHeight);

        const pdfText = (value) => String(value)
            .replace(/\t/g, '    ')
            .replace(/[^\x20-\xFF]/g, '?')
            .replace(/([\\()])/g, '\\$1');

        const entries = [
            { text: song.title || 'Canción', font: 'F2', size: 14, gap: 1 },
            { text: song.author || '', font: 'F1', size: 10, gap: 1 }
        ];
        songLines().forEach(({ lyric, chord }) => {
            const chordText = transposeChordLine(chord).replace(/\s+$/, '');
            const length = Math.max(chordText.length, lyric.length, 1);
            for (let start = 0; start < length; start += maxChars) {
                if (chordText.slice(start, start + maxChars).trim()) {
                    entries.push({ text: chordText.slice(start, start + maxChars), font: 'F2', size: fontSize, gap: 0 });
                }
                entries.push({ text: lyric.slice(start, start + maxChars), font: 'F1', size: fontSize, gap: 0 });
            }
        });

        const pages = [[]];
        let used = 0;
        entries.forEach((entry) => {
            const cost = 1 + entry.gap;
            if (used + cost > maxLines) {
                pages.push([]);
                used = 0;
            }
            pages[pages.length - 1].push({ ...entry, row: used });
            used += cost;
        });

        const objects = [];
        const pageIds = pages.map((_, i) => 5 + i * 2);
        objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
        objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`;
        objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>';
        objects[4] = '<< /Type /Font /Subtype /Type1 /BaseFont /Courier-Bold /Encoding /WinAnsiEncoding >>';
        pages.forEach((items, i) => {
            const stream = items.map((item) => {
                const y = pageHeight - margin - item.row * lineHeight - 10;
                return `BT /${item.font} ${item.size} Tf ${margin} ${y} Td (${pdfText(item.text)}) Tj ET`;
            }).join('\n');
            objects[5 + i * 2] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${pageWidth} ${pageHeight}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${6 + i * 2} 0 R >>`;
            objects[6 + i * 2] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
        });

        let pdf = '%PDF-1.4\n';
        const offsets = [];
        for (let id = 1; id < objects.length; id++) {
            offsets[id] = pdf.length;
            pdf += `${id} 0 obj\n${objects[id]}\nendobj\n`;
        }
        const xref = pdf.length;
        pdf += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
        for (let id = 1; id < objects.length; id++) {
            pdf += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
        }
        pdf += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;

        const bytes = new Uint8Array(pdf.length);
        for (let i = 0; i < pdf.length; i++) bytes[i] = pdf.charCodeAt(i) & 255;
        return new Blob([bytes], { type: 'application/pdf' });
    }

    function pdfFileName() {
        return `${(song.title || 'cancion').replace(/[\\/:*?"<>|]+/g, '').trim() || 'cancion'}.pdf`;
    }

    function downloadPdf() {
        const link = document.createElement('a');
        link.href = URL.createObjectURL(buildPdfBlob());
        link.download = pdfFileName();
        link.click();
        setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    }

    async function sharePdf() {
        const file = new File([buildPdfBlob()], pdfFileName(), { type: 'application/pdf' });
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
            try {
                await navigator.share({ files: [file], title: song.title });
            } catch (error) {
                if (error.name !== 'AbortError') console.error('No se pudo compartir el PDF:', error);
            }
        } else {
            downloadPdf();
        }
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
            openSubmenu = null;
            render();
        } else if (action === 'print') {
            printSong();
        } else if (action === 'download-pdf') {
            downloadPdf();
        } else if (action === 'share-pdf') {
            await sharePdf();
        } else if (action === 'copy') {
            try {
                await navigator.clipboard.writeText(splitLines(song?.lyrics).join('\n'));
            } catch (error) {
                console.error('No se pudo copiar la letra:', error);
            }
        }
    }

    window.openSongViewer = (selectedSong, { keepMenu = false } = {}) => {
        song = selectedSong;
        transpose = 0;
        capo = 0;
        openSubmenu = null;
        menuOpen = keepMenu ? menuOpen : false;
        if (!keepMenu) searchQuery = '';
        root.scrollTop = 0;
        render();
        root.hidden = false;
        document.body.style.overflow = 'hidden';
    };
})();