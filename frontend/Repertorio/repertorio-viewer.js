(() => {
    const root = document.createElement('section');
    root.className = 'song-reader';
    root.hidden = true;
    root.setAttribute('aria-label', 'Lector de canción');
    document.body.appendChild(root);

    root.addEventListener('click', (event) => {
        if (!event.target.closest('[data-chord-key], .song-chord-popup')) hideChordPopup();
    });
    root.addEventListener('scroll', () => hideChordPopup(), true);
    let song = null;
    let transpose = 0;
    let capo = 0;
    let fontScale = 1;
    let lightMode = false;
    let menuOpen = false;
    let openSubmenu = null;
    let searchQuery = '';
    let activeChordKey = null;
    let currentChords = [];
    const voicingChoice = {};

    let selectedInstrument = 'guitarra';
    let selectedCipher = 'spanish';

    const notesSpanish = ['Do', 'Do#', 'Re', 'Re#', 'Mi', 'Fa', 'Fa#', 'Sol', 'Sol#', 'La', 'La#', 'Si'];
    const notesEnglish = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
    const notesSpanishFlat = ['Do', 'Reb', 'Re', 'Mib', 'Mi', 'Fa', 'Solb', 'Sol', 'Lab', 'La', 'Sib', 'Si'];
    const notesEnglishFlat = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];
    let useFlats = false;

    const naturalSemitones = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11, Do: 0, Re: 2, Mi: 4, Fa: 5, Sol: 7, La: 9, Si: 11 };

    // Un acorde es: raíz (inglés o español) + calidad + bajo opcional (F#/G#)
    const chordRootPattern = '(?:Do|DO|Re|RE|Mi|MI|Fa|FA|Sol|SOL|La|LA|Si|SI|[A-G])(?:#|b|♯|♭)?';
    const chordQualityPattern = '(?:maj|min|dim|aug|sus|add|m|M|[0-9]|[#b+\\-°º∆Δ]|\\([^)\\s]*\\))*';
    const chordTokenRegex = new RegExp(`^(${chordRootPattern})(${chordQualityPattern})(?:/(${chordRootPattern}))?$`);
    const chordFillerRegex = /^(?:\|\|?|\/|-|–|:|\.{2,}|\(?x\d+\)?|N\.?C\.?|[A-Za-zÁÉÍÓÚáéíóúñÑ]+:)$/;

    // Formas de guitarra (cuerdas de la 6ª a la 1ª; -1 = no tocar). Las de barra se desplazan según la raíz.
    const E_SHAPES = {
        '': [0, 2, 2, 1, 0, 0], m: [0, 2, 2, 0, 0, 0], 7: [0, 2, 0, 1, 0, 0], m7: [0, 2, 0, 0, 0, 0],
        maj7: [0, 2, 1, 1, 0, 0], sus4: [0, 2, 2, 2, 0, 0], sus2: [0, 2, 4, 4, 0, 0], 5: [0, 2, 2, -1, -1, -1],
        6: [0, 2, 2, 1, 2, 0], aug: [0, 3, 2, 1, 1, 0]
    };
    const A_SHAPES = {
        '': [-1, 0, 2, 2, 2, 0], m: [-1, 0, 2, 2, 1, 0], 7: [-1, 0, 2, 0, 2, 0], m7: [-1, 0, 2, 0, 1, 0],
        maj7: [-1, 0, 2, 1, 2, 0], sus4: [-1, 0, 2, 2, 3, 0], sus2: [-1, 0, 2, 2, 0, 0], 5: [-1, 0, 2, 2, -1, -1],
        6: [-1, 0, 2, 2, 2, 2], dim: [-1, 0, 1, 2, 1, -1], aug: [-1, 0, 3, 2, 2, 1]
    };
    const OPEN_SHAPES = {
        '0:': [-1, 3, 2, 0, 1, 0], '0:7': [-1, 3, 2, 3, 1, 0], '0:maj7': [-1, 3, 2, 0, 0, 0], '0:add9': [-1, 3, 2, 0, 3, 0],
        '2:': [-1, -1, 0, 2, 3, 2], '2:m': [-1, -1, 0, 2, 3, 1], '2:7': [-1, -1, 0, 2, 1, 2], '2:m7': [-1, -1, 0, 2, 1, 1],
        '2:maj7': [-1, -1, 0, 2, 2, 2], '2:sus4': [-1, -1, 0, 2, 3, 3], '2:sus2': [-1, -1, 0, 2, 3, 0],
        '5:maj7': [-1, -1, 3, 2, 1, 0], '7:': [3, 2, 0, 0, 0, 3], '7:7': [3, 2, 0, 0, 0, 1],
        '7:maj7': [3, 2, 0, 0, 0, 2], '7:6': [3, 2, 0, 0, 0, 0], '11:7': [-1, 2, 1, 2, 0, 2]
    };
    const PIANO_INTERVALS = {
        '': [0, 4, 7], m: [0, 3, 7], 7: [0, 4, 7, 10], m7: [0, 3, 7, 10], maj7: [0, 4, 7, 11], sus4: [0, 5, 7],
        sus2: [0, 2, 7], dim: [0, 3, 6], aug: [0, 4, 8], 5: [0, 7], 6: [0, 4, 7, 9], add9: [0, 4, 7, 14]
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

    function escapeAttr(value) {
        return escapeText(value).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
    }

    function splitLines(value) {
        return String(value || '').replace(/\r/g, '').split('\n');
    }

    function formatChordNote(semitoneIndex) {
        const normalizedIndex = (semitoneIndex % 12 + 12) % 12;
        const english = useFlats ? notesEnglishFlat : notesEnglish;
        const spanish = useFlats ? notesSpanishFlat : notesSpanish;
        if (selectedCipher === 'english') {
            return english[normalizedIndex];
        } else if (selectedCipher === 'spanish') {
            return spanish[normalizedIndex];
        } else {
            return spanish[normalizedIndex].toUpperCase();
        }
    }

    const mod12 = (value) => ((value % 12) + 12) % 12;
    const effectiveCapo = () => (selectedInstrument === 'piano' ? 0 : capo);

    function noteToSemitone(note) {
        const spanish = note.match(/^(do|re|mi|fa|sol|la|si)([#b♯♭]?)$/i);
        const english = note.match(/^([A-G])([#b♯♭]?)$/);
        const match = spanish || english;
        if (!match) return null;
        const key = spanish ? match[1][0].toUpperCase() + match[1].slice(1).toLowerCase() : match[1];
        const accidental = match[2] === '#' || match[2] === '♯' ? 1 : match[2] ? -1 : 0;
        return mod12(naturalSemitones[key] + accidental);
    }

    function parseChordToken(token) {
        const match = token.match(chordTokenRegex);
        if (!match) return null;
        const rootSemitone = noteToSemitone(match[1]);
        if (rootSemitone === null) return null;
        return { root: rootSemitone, quality: match[2], bass: match[3] ? noteToSemitone(match[3]) : null, prefix: '', suffix: '' };
    }

    function parseChordWithPunctuation(token) {
        const direct = parseChordToken(token);
        if (direct) return direct;
        const wrapped = token.match(/^([(\[]*)(.+?)([)\],]*)$/);
        const inner = wrapped ? parseChordToken(wrapped[2]) : null;
        return inner ? { ...inner, prefix: wrapped[1], suffix: wrapped[3] } : null;
    }

    // Una línea es de acordes si todos sus elementos son acordes (o separadores como | x2 Intro:)
    function isChordLine(line) {
        const tokens = String(line || '').trim().split(/\s+/).filter(Boolean);
        if (!tokens.length || tokens.length > 32) return false;
        let chords = 0;
        for (const token of tokens) {
            if (parseChordWithPunctuation(token)) chords += 1;
            else if (!chordFillerRegex.test(token)) return false;
        }
        return chords > 0;
    }

    function chordType(quality) {
        const text = quality.replace(/[()]/g, '');
        if (/^(?:maj|M|∆|Δ)\d/.test(text)) return 'maj7';
        if (/^(?:dim|°|º)/.test(text) || /^(?:m|min|-)\S*b5/.test(text)) return 'dim';
        if (/^(?:aug|\+)/.test(text)) return 'aug';
        if (/^(?:m(?!aj)|min|-)/.test(text)) return /^(?:m|min|-)(?:7|9|11|13)/.test(text) ? 'm7' : 'm';
        if (/^sus2/.test(text)) return 'sus2';
        if (/^sus/.test(text)) return 'sus4';
        if (/^(?:7|9|11|13)/.test(text)) return '7';
        if (/^5/.test(text)) return '5';
        if (/^6/.test(text)) return '6';
        if (/^add/.test(text)) return 'add9';
        return '';
    }

    // shapeLabel = lo que se escribe en la hoja (forma con capo); soundLabel = acorde que suena realmente
    function chordInfo(parsed) {
        const capoShift = effectiveCapo();
        const label = (shift) => `${formatChordNote(parsed.root + shift)}${parsed.quality}${parsed.bass === null ? '' : `/${formatChordNote(parsed.bass + shift)}`}`;
        return {
            shapeRoot: mod12(parsed.root + transpose - capoShift),
            soundRoot: mod12(parsed.root + transpose),
            type: chordType(parsed.quality),
            shapeLabel: label(transpose - capoShift),
            soundLabel: label(transpose)
        };
    }

    function chordLineParts(line) {
        const parts = [];
        const pattern = /\S+/g;
        let length = 0;
        let match;
        while ((match = pattern.exec(line))) {
            const parsed = parseChordWithPunctuation(match[0]);
            const info = parsed ? chordInfo(parsed) : null;
            const text = parsed ? `${parsed.prefix}${info.shapeLabel}${parsed.suffix}` : match[0];
            // Mantiene la alineación original aunque el cifrado cambie la longitud del acorde
            const gap = length < match.index ? match.index - length : (length ? 1 : 0);
            if (gap) {
                parts.push({ text: ' '.repeat(gap), info: null });
                length += gap;
            }
            parts.push({ text, info });
            length += text.length;
        }
        return parts;
    }

    function transposeChordLine(line) {
        return chordLineParts(line).map((part) => part.text).join('');
    }

    function chordLineHtml(line) {
        return chordLineParts(line).map((part) => part.info
            ? `<button type="button" class="song-chord-token" data-chord-key="${escapeAttr(part.info.shapeLabel)}">${escapeText(part.text)}</button>`
            : escapeText(part.text)
        ).join('');
    }

    function songLines() {
        const lyrics = splitLines(song?.lyrics);
        const chords = splitLines(song?.chords);
        const count = Math.max(lyrics.length, chords.length);
        return Array.from({ length: count }, (_, index) => {
            const lyric = lyrics[index] || '';
            const chord = chords[index] || '';
            // Acordes escritos como texto dentro de la letra, aunque la columna de acordes tenga contenido
            if (isChordLine(lyric)) {
                const rows = [];
                if (chord.trim()) rows.push({ lyric: '', chord, chordOnly: true });
                rows.push({ lyric: '', chord: lyric, chordOnly: true });
                return rows;
            }
            return [{ lyric, chord }];
        }).flat();
    }

    function originalKey() {
        for (const { chord } of songLines()) {
            const pattern = /\S+/g;
            let match;
            while ((match = pattern.exec(chord))) {
                const parsed = parseChordWithPunctuation(match[0]);
                if (parsed) return parsed.root;
            }
        }
        return 0;
    }

    function barreFor(frets, fret) {
        if (fret <= 0) return null;
        const strings = frets.map((value, index) => (value === fret ? index : -1)).filter((index) => index >= 0);
        return strings.length < 2 ? null : { fret, from: strings[0], to: strings[strings.length - 1] };
    }

    function guitarVoicings(rootSemitone, type) {
        const list = [];
        const seen = new Set();
        const add = (frets, barreFret) => {
            const key = frets.join(',');
            if (seen.has(key)) return;
            seen.add(key);
            list.push({ frets, barre: barreFor(frets, barreFret) });
        };
        const collect = (shape) => {
            if (OPEN_SHAPES[`${rootSemitone}:${shape}`]) add(OPEN_SHAPES[`${rootSemitone}:${shape}`], 0);
            if (E_SHAPES[shape]) {
                const fret = mod12(rootSemitone - 4);
                add(E_SHAPES[shape].map((value) => (value < 0 ? -1 : value + fret)), fret);
            }
            if (A_SHAPES[shape]) {
                const fret = mod12(rootSemitone - 9);
                add(A_SHAPES[shape].map((value) => (value < 0 ? -1 : value + fret)), fret);
            }
        };
        collect(type);
        if (!list.length) collect(type.startsWith('m') && type !== 'maj7' ? 'm' : '');
        return list.sort((a, b) => Math.max(...a.frets) - Math.max(...b.frets));
    }

    function bassVoicings(rootSemitone) {
        const onE = mod12(rootSemitone - 4);
        const onA = mod12(rootSemitone - 9);
        return [{ frets: [onE, -1, -1, -1], barre: null }, { frets: [-1, onA, -1, -1], barre: null }];
    }

    function pianoVoicings(rootSemitone, type) {
        const base = (PIANO_INTERVALS[type] || PIANO_INTERVALS['']).map((interval) => rootSemitone + interval);
        return [0, 1, 2]
            .filter((inversion) => inversion < base.length)
            .map((inversion) => ({ notes: new Set(base.map((note, index) => (index < inversion ? note + 12 : note) % 24)) }));
    }

    function voicingsFor(info) {
        if (selectedInstrument === 'piano') return pianoVoicings(info.shapeRoot, info.type);
        if (selectedInstrument === 'bajo') return bassVoicings(info.shapeRoot);
        return guitarVoicings(info.shapeRoot, info.type);
    }

    function voicingKey(info) {
        return `${selectedInstrument}|${info.shapeRoot}|${info.type}`;
    }

    function currentVoicing(info) {
        const list = voicingsFor(info);
        const index = (voicingChoice[voicingKey(info)] || 0) % list.length;
        return { voicing: list[index], count: list.length };
    }

    function fretboardSvg(frets, barre, capoFret, showMuted) {
        const count = frets.length;
        const left = 15;
        const width = 60;
        const spacing = width / (count - 1);
        const top = 28;
        const rowHeight = 15;
        const rows = 5;
        const positive = frets.filter((fret) => fret > 0);
        const start = positive.length && Math.max(...positive) > rows ? Math.min(...positive) : 1;
        const x = (index) => left + index * spacing;
        const parts = [];

        if (capoFret > 0) {
            parts.push(`<rect class="cd-capo" x="${left - 6}" y="${top - 15}" width="${width + 12}" height="12" rx="4"/>`);
            parts.push(`<text class="cd-capo-text" x="${left + width / 2}" y="${top - 6}" text-anchor="middle">C A P O</text>`);
        } else if (start === 1) {
            parts.push(`<rect class="cd-nut" x="${left}" y="${top - 2}" width="${width}" height="4"/>`);
        }
        for (let i = 0; i < count; i++) {
            parts.push(`<line class="cd-string" x1="${x(i)}" y1="${top}" x2="${x(i)}" y2="${top + rows * rowHeight}"/>`);
        }
        for (let r = 0; r <= rows; r++) {
            parts.push(`<line class="cd-fret" x1="${left}" y1="${top + r * rowHeight}" x2="${left + width}" y2="${top + r * rowHeight}"/>`);
        }
        if (start > 1) {
            parts.push(`<text class="cd-fretnum" x="2" y="${top + rowHeight / 2 + 3}">${start + capoFret}</text>`);
        } else if (capoFret > 0) {
            parts.push(`<text class="cd-fretnum" x="2" y="${top - 5}">${capoFret}</text>`);
        }

        if (barre) {
            parts.push(`<rect class="cd-barre" x="${x(barre.from) - 5}" y="${top + (barre.fret - start) * rowHeight + 3}" width="${x(barre.to) - x(barre.from) + 10}" height="${rowHeight - 6}" rx="4"/>`);
        }

        const fingered = [];
        frets.forEach((fret, index) => {
            const covered = barre && fret === barre.fret && index >= barre.from && index <= barre.to;
            if (fret > 0 && !covered) fingered.push({ index, fret });
        });
        fingered.sort((a, b) => a.fret - b.fret || a.index - b.index);
        fingered.forEach(({ index, fret }, order) => {
            const cx = x(index);
            const cy = top + (fret - start) * rowHeight + rowHeight / 2;
            parts.push(`<circle class="cd-dot" cx="${cx}" cy="${cy}" r="5.5"/><text class="cd-finger" x="${cx}" y="${cy + 3}">${Math.min(4, order + (barre ? 2 : 1))}</text>`);
        });

        const markY = top + rows * rowHeight + 12;
        frets.forEach((fret, index) => {
            if (fret < 0) {
                if (showMuted) parts.push(`<text class="cd-mark" x="${x(index)}" y="${markY + 3}">×</text>`);
            } else if (fret === 0) {
                parts.push(`<circle class="cd-open" cx="${x(index)}" cy="${markY}" r="3"/>`);
            } else {
                parts.push(`<circle class="cd-fretted" cx="${x(index)}" cy="${markY}" r="2.5"/>`);
            }
        });
        return `<svg viewBox="0 0 90 ${top + rows * rowHeight + 20}" role="img" aria-hidden="true">${parts.join('')}</svg>`;
    }

    function pianoSvg(notes) {
        const whitePitches = [0, 2, 4, 5, 7, 9, 11];
        const blackPositions = { 1: 0, 3: 1, 6: 3, 8: 4, 10: 5 };
        const keyWidth = 7;
        const parts = [];
        for (let i = 0; i < 14; i++) {
            const pitch = whitePitches[i % 7] + 12 * Math.floor(i / 7);
            parts.push(`<rect class="cd-key${notes.has(pitch) ? ' on' : ''}" x="${i * keyWidth}" y="8" width="${keyWidth}" height="44"/>`);
        }
        for (let octave = 0; octave < 2; octave++) {
            Object.entries(blackPositions).forEach(([pitch, whiteIndex]) => {
                const note = Number(pitch) + 12 * octave;
                const xPos = (octave * 7 + whiteIndex) * keyWidth + keyWidth - 2.3;
                parts.push(`<rect class="cd-key-black${notes.has(note) ? ' on' : ''}" x="${xPos}" y="8" width="4.6" height="28" rx="1"/>`);
            });
        }
        return `<svg viewBox="0 0 98 60" role="img" aria-hidden="true">${parts.join('')}</svg>`;
    }

    function diagramSvg(info) {
        const { voicing } = currentVoicing(info);
        if (selectedInstrument === 'piano') return pianoSvg(voicing.notes);
        return fretboardSvg(voicing.frets, voicing.barre, effectiveCapo(), selectedInstrument !== 'bajo');
    }

    function chordDisplayName(info) {
        return `${info.shapeLabel}${effectiveCapo() % 12 ? '*' : ''}`;
    }

    function chordCardMarkup(info) {
        return `
            <button type="button" class="song-chord-diagram" data-chord-key="${escapeAttr(info.shapeLabel)}" aria-label="Ver acorde ${escapeAttr(info.shapeLabel)}">
                <strong>${escapeText(chordDisplayName(info))}</strong>
                ${diagramSvg(info)}
            </button>`;
    }

    function chordPopupMarkup(info) {
        const differs = effectiveCapo() % 12 && info.soundLabel !== info.shapeLabel;
        const subtitle = differs
            ? `<b>${escapeText(info.soundLabel)}</b> con forma de <b>${escapeText(info.shapeLabel)}</b>`
            : `<b>${escapeText(info.shapeLabel)}</b>`;
        return `
            <span class="song-chord-popup-handle"></span>
            <h4>${escapeText(chordDisplayName(info))}</h4>
            ${diagramSvg(info)}
            <p>${subtitle}</p>
            <button type="button" class="song-chord-popup-change" data-action="chord-change">Cambiar</button>`;
    }

    let popupEl = null;
    let popupPinned = false;
    let anchorIndex = -1;
    let hideTimer = null;

    function hideChordPopup() {
        clearTimeout(hideTimer);
        activeChordKey = null;
        popupPinned = false;
        if (popupEl) popupEl.remove();
        popupEl = null;
    }

    function scheduleHide() {
        clearTimeout(hideTimer);
        if (!popupPinned) hideTimer = setTimeout(hideChordPopup, 220);
    }

    // La ventana se despliega hacia arriba del acorde (o hacia abajo si no hay espacio)
    function showChordPopup(anchor) {
        const info = currentChords.find((chord) => chord.shapeLabel === anchor.dataset.chordKey);
        if (!info) return;
        clearTimeout(hideTimer);
        activeChordKey = info.shapeLabel;
        anchorIndex = [...root.querySelectorAll('[data-chord-key]')].indexOf(anchor);
        if (popupEl) popupEl.remove();
        popupEl = document.createElement('div');
        popupEl.className = 'song-chord-popup';
        popupEl.setAttribute('role', 'dialog');
        popupEl.innerHTML = chordPopupMarkup(info);
        popupEl.addEventListener('mouseenter', () => clearTimeout(hideTimer));
        popupEl.addEventListener('mouseleave', scheduleHide);
        popupEl.addEventListener('click', (event) => {
            event.stopPropagation();
            if (event.target.closest('[data-action="chord-change"]')) {
                voicingChoice[voicingKey(info)] = (voicingChoice[voicingKey(info)] || 0) + 1;
                popupEl.innerHTML = chordPopupMarkup(info);
                const card = [...root.querySelectorAll('.song-chord-diagram')].find((el) => el.dataset.chordKey === info.shapeLabel);
                if (card) card.innerHTML = `<strong>${escapeText(chordDisplayName(info))}</strong>${diagramSvg(info)}`;
            }
        });
        root.appendChild(popupEl);

        const rect = anchor.getBoundingClientRect();
        const width = popupEl.offsetWidth;
        const height = popupEl.offsetHeight;
        const left = Math.min(Math.max(8, rect.left + rect.width / 2 - width / 2), window.innerWidth - width - 8);
        const top = rect.top - height - 8 >= 8 ? rect.top - height - 8 : rect.bottom + 8;
        popupEl.style.left = `${left}px`;
        popupEl.style.top = `${top}px`;
    }

    function uniqueChords() {
        const found = [];
        songLines().forEach(({ chord }) => {
            const pattern = /\S+/g;
            let match;
            while ((match = pattern.exec(chord))) {
                const parsed = parseChordWithPunctuation(match[0]);
                if (!parsed) continue;
                const info = chordInfo(parsed);
                if (!found.some((item) => item.shapeLabel === info.shapeLabel)) found.push(info);
            }
        });
        return found;
    }

    function sheetMarkup() {
        const lines = songLines();
        if (!lines.length || !lines.some(({ lyric, chord }) => lyric || chord)) {
            return '<p class="song-reader-empty">Esta canción todavía no tiene letra.</p>';
        }
        return lines.map(({ lyric, chord, chordOnly }) => {
            if (!lyric && !chord) return '<div class="song-reader-line song-reader-line-blank"></div>';
            return `
            <div class="song-reader-line${chordOnly ? ' song-reader-line-chord' : ''}">
                ${chord ? `<div class="song-reader-chords">${chordLineHtml(chord)}</div>` : ''}
                ${lyric ? `<div class="song-reader-lyrics">${escapeText(lyric)}</div>` : ''}
            </div>`;
        }).join('');
    }

    function menuMarkup() {
        const showCapo = selectedInstrument !== 'piano';
        const currentNoteName = formatChordNote(originalKey() + transpose);

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
                    <div class="song-reader-slider-row">
                        <div class="song-reader-slider-head"><span>Texto</span><span class="item-val" id="songFontValue">${Math.round(fontScale * 100)}%</span></div>
                        <div class="song-reader-slider-body">
                            <span class="slider-a small">A</span>
                            <input type="range" id="songFontRange" min="70" max="180" step="5" value="${Math.round(fontScale * 100)}" aria-label="Tamaño del texto">
                            <span class="slider-a big">A</span>
                        </div>
                    </div>
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
                            <button class="tone-btn" data-action="transpose-down-full">-1 tono</button>
                            <button class="tone-btn" data-action="transpose-up-full">+1 tono</button>
                        </div>
                        <div class="options-grid">
                            ${notesSpanish.map((note, idx) => `
                                <button class="option-btn ${mod12(originalKey() + transpose) === idx ? 'selected' : ''}" data-set-transpose="${idx}">
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
                        <span class="item-val">${capo === 0 ? 'Sin capo' : `${capo}º traste`} ›</span>
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

        const currentTone = formatChordNote(originalKey() + transpose);
        const capoText = effectiveCapo() > 0 ? ` · Capo: ${effectiveCapo()}º traste` : '';
        currentChords = uniqueChords();
        if (activeChordKey && !currentChords.some((chord) => chord.shapeLabel === activeChordKey)) activeChordKey = null;

        const previous = {
            main: root.querySelector('.song-reader-main')?.scrollTop,
            strip: root.querySelector('#songDiagrams')?.scrollLeft
        };

        root.innerHTML = `
            <aside class="song-reader-sidebar">
                <div class="song-reader-sheet-head">
                    <span class="song-reader-sheet-grip"></span>
                    <strong>Opciones</strong>
                    <button type="button" class="song-reader-icon-button" data-action="menu" aria-label="Cerrar opciones">✕</button>
                </div>
                ${menuMarkup()}
            </aside>
            <div class="song-reader-backdrop" data-action="menu"></div>
            <main class="song-reader-main">
                <div class="song-reader-topbar">
                    <button type="button" class="song-reader-icon-button" data-action="close" aria-label="Cerrar lector">‹</button>
                    <div class="song-reader-topbar-title">
                        <strong>${escapeText(song?.title)}</strong>
                        <span>${escapeText(song?.author || 'Autor no registrado')}</span>
                    </div>
                    <button type="button" class="song-reader-icon-button" data-action="mobile-search" aria-label="Buscar canción">⌕</button>
                </div>
                <div class="song-reader-content">
                    <div class="song-reader-heading">
                        <div>
                            <h1>${escapeText(song?.title)}</h1>
                            <p>${escapeText(song?.author || 'Autor no registrado')} · ${song?.has_sequence ? 'Tiene secuencia' : 'Sin secuencia'}</p>
                            <span class="song-info-badge">Tono: ${currentTone}${capoText}</span>
                        </div>
                    </div>
                    ${currentChords.length ? `
                    <div class="song-reader-diagrams-wrap">
                        <button type="button" class="song-diagrams-nav prev" data-action="diagrams-prev" aria-label="Acordes anteriores" hidden>‹</button>
                        <div class="song-reader-diagrams" id="songDiagrams">${currentChords.map(chordCardMarkup).join('')}</div>
                        <button type="button" class="song-diagrams-nav next" data-action="diagrams-next" aria-label="Más acordes" hidden>›</button>
                    </div>` : ''}
                    <article class="song-reader-sheet" style="font-size:${fontScale}em">
                        <section class="song-reader-section">
                            ${sheetMarkup()}
                        </section>
                    </article>
                </div>
            </main>
            <nav class="song-reader-mobilebar" aria-label="Acciones rápidas">
                <button type="button" data-action="transpose-down" aria-label="Bajar medio tono">−½</button>
                <button type="button" class="mobilebar-tone" data-action="mobile-tone" aria-label="Elegir tono"><small>Tono</small><strong>${escapeText(currentTone)}</strong></button>
                <button type="button" data-action="transpose-up" aria-label="Subir medio tono">+½</button>
                <button type="button" class="mobilebar-menu" data-action="menu" aria-label="Abrir opciones"><span>☰</span> Opciones</button>
            </nav>
        `;
        popupEl = null;

        if (previous.main !== undefined) root.querySelector('.song-reader-main').scrollTop = previous.main;
        const strip = root.querySelector('#songDiagrams');
        if (strip) {
            if (previous.strip !== undefined) strip.scrollLeft = previous.strip;
            const updateNav = () => {
                root.querySelector('.song-diagrams-nav.prev').hidden = strip.scrollLeft <= 2;
                root.querySelector('.song-diagrams-nav.next').hidden = strip.scrollLeft + strip.clientWidth >= strip.scrollWidth - 2;
            };
            strip.addEventListener('scroll', updateNav);
            updateNav();
        }

        const fontRange = root.querySelector('#songFontRange');
        fontRange.addEventListener('input', () => {
            fontScale = Number(fontRange.value) / 100;
            root.querySelector('.song-reader-sheet').style.fontSize = `${fontScale}em`;
            root.querySelector('#songFontValue').textContent = `${fontRange.value}%`;
        });

        root.querySelectorAll('[data-chord-key]').forEach((element) => {
            element.addEventListener('mouseenter', () => {
                if (!popupPinned) showChordPopup(element);
            });
            element.addEventListener('mouseleave', scheduleHide);
            element.addEventListener('click', (event) => {
                event.stopPropagation();
                popupPinned = true;
                showChordPopup(element);
            });
        });
        if (activeChordKey) {
            const anchor = root.querySelectorAll('[data-chord-key]')[anchorIndex];
            if (anchor) showChordPopup(anchor);
            else hideChordPopup();
        }

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
                    window.openSongViewer(item, { keepMenu: !window.matchMedia('(max-width: 1024px)').matches });
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
                transpose = targetIndex - originalKey();
                transpose = mod12(transpose) > 6 ? mod12(transpose) - 12 : mod12(transpose);
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
            if (lyric || !chordText) rows.push({ text: lyric, chord: false });
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
                if (lyric || !chordText) {
                    entries.push({ text: lyric.slice(start, start + maxChars), font: 'F1', size: fontSize, gap: 0 });
                }
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
        } else if (action === 'mobile-tone') {
            menuOpen = true;
            openSubmenu = 'tone';
            render();
        } else if (action === 'mobile-search') {
            menuOpen = true;
            openSubmenu = null;
            render();
            root.querySelector('#songReaderSearch')?.focus();
        } else if (action === 'menu') {
            menuOpen = !menuOpen;
            render();
        } else if (action === 'theme') {
            lightMode = !lightMode;
            render();
        } else if (action === 'transpose-up') {
            transpose += 1;
            render();
        } else if (action === 'transpose-down') {
            transpose -= 1;
            render();
        } else if (action === 'transpose-up-full') {
            transpose += 2;
            render();
        } else if (action === 'transpose-down-full') {
            transpose -= 2;
            render();
        } else if (action === 'transpose-reset') {
            transpose = 0;
            openSubmenu = null;
            render();
        } else if (action === 'diagrams-prev' || action === 'diagrams-next') {
            root.querySelector('#songDiagrams')?.scrollBy({ left: action === 'diagrams-next' ? 320 : -320, behavior: 'smooth' });
        } else if (action === 'print') {
            printSong();
        } else if (action === 'download-pdf') {
            downloadPdf();
        } else if (action === 'share-pdf') {
            await sharePdf();
        } else if (action === 'copy') {
            try {
                const lyricsOnly = songLines().filter(({ chordOnly }) => !chordOnly).map(({ lyric }) => lyric);
                await navigator.clipboard.writeText(lyricsOnly.join('\n'));
            } catch (error) {
                console.error('No se pudo copiar la letra:', error);
            }
        }
    }

    // Si la canción escribe bemoles (Sib, Bb) y ningún sostenido, se mantienen los bemoles
    function detectFlats() {
        let flats = 0;
        let sharps = 0;
        songLines().forEach(({ chord }) => {
            (chord.match(/\S+/g) || []).forEach((token) => {
                const parsed = parseChordWithPunctuation(token);
                if (!parsed) return;
                const body = token.replace(/^[(\[]+/, '');
                const accidentals = body.match(new RegExp(chordRootPattern, 'g')) || [];
                accidentals.forEach((root) => {
                    if (/[b♭]$/.test(root) && !/^[Bb]$/.test(root)) flats += 1;
                    else if (/[#♯]$/.test(root)) sharps += 1;
                });
            });
        });
        return flats > 0 && sharps === 0;
    }

    window.openSongViewer = (selectedSong, { keepMenu = false } = {}) => {
        useFlats = false;
        hideChordPopup();
        song = selectedSong;
        useFlats = detectFlats();
        transpose = 0;
        capo = 0;
        openSubmenu = null;
        activeChordKey = null;
        menuOpen = keepMenu ? menuOpen : false;
        if (!keepMenu) searchQuery = '';
        root.replaceChildren();
        render();
        root.hidden = false;
        document.body.style.overflow = 'hidden';
    };
})();