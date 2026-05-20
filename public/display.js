let currentSongId = null;
let currentSong   = null;
const showChords  = location.pathname.startsWith('/chords');

// ── Transposition ─────────────────────────────────────────────────────────────

const SHARPS = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
const FLATS  = ['C','Db','D','Eb','E','F','Gb','G','Ab','A','Bb','B'];
const KEY_CYCLE = ['C','Db','D','Eb','E','F','F#','G','Ab','A','Bb','B'];

function noteIdx(n) {
  const i = SHARPS.indexOf(n);
  return i >= 0 ? i : FLATS.indexOf(n);
}

const FLAT_ROOTS = new Set(['F','Bb','Eb','Ab','Db','Gb']);
function preferFlat(key) {
  const r = (key || '').match(/^[A-G][b#]?/)?.[0] || '';
  return r.endsWith('b') || FLAT_ROOTS.has(r);
}

function transposeNote(note, steps, flat) {
  const i = noteIdx(note); if (i < 0) return note;
  const j = ((i + steps) % 12 + 12) % 12;
  return flat ? FLATS[j] : SHARPS[j];
}

function transposeChord(chord, steps, flat) {
  if (!steps) return chord;
  return chord.replace(
    /^([A-G][#b]?)([^/]*)(\/([A-G][#b]?)(.*))?$/,
    (_, root, qual, _bassSlash, bass, bassQual) => {
      const r = transposeNote(root, steps, flat);
      const b = bass ? '/' + transposeNote(bass, steps, flat) + (bassQual || '') : '';
      return r + qual + b;
    }
  );
}

function keySteps(from, to) {
  const f = noteIdx((from || '').match(/^[A-G][b#]?/)?.[0] || '');
  const t = noteIdx((to   || '').match(/^[A-G][b#]?/)?.[0] || '');
  return (f < 0 || t < 0) ? 0 : ((t - f + 12) % 12);
}

function shiftKey(key, delta) {
  const root = (key || '').match(/^[A-G][b#]?/)?.[0] || '';
  const qual = key ? key.slice(root.length) : '';
  let idx = KEY_CYCLE.indexOf(root);
  if (idx < 0) { const j = noteIdx(root); idx = j >= 0 ? j : 0; }
  return KEY_CYCLE[((idx + delta) % 12 + 12) % 12] + qual;
}

// ── Transposition state ───────────────────────────────────────────────────────

let transposeSteps = 0;
let transposeFlat  = false;

function updateTranspose() {
  if (!currentSong || !showChords) { transposeSteps = 0; transposeFlat = false; return; }
  const playKey = currentSong._wsPlayKey || currentSong.playKey || currentSong.key || '';
  transposeSteps = keySteps(currentSong.key || '', playKey);
  transposeFlat  = preferFlat(playKey);
}

// ── WebSocket ─────────────────────────────────────────────────────────────────

function connect() {
  const ws = new WebSocket(`ws://${location.host}`);
  ws.onmessage = (e) => handleMessage(JSON.parse(e.data));
  ws.onclose   = () => setTimeout(connect, 2000);
  ws.onerror   = () => ws.close();
}

async function handleMessage(msg) {
  if (msg.type === 'blank') {
    showBlank();
  } else if (msg.type === 'song') {
    const wsPlayKey = msg.playKey || null;
    const wsCapo    = msg.capo ?? null;
    const sameKey   = wsPlayKey === (currentSong?._wsPlayKey ?? null);
    const sameCapo  = wsCapo    === (currentSong?._wsCapo    ?? null);
    if (msg.songId === currentSongId && sameKey && sameCapo) return;
    currentSongId = msg.songId;
    try {
      const res = await fetch(`/api/songs/${msg.songId}`);
      if (!res.ok) { showBlank(); return; }
      currentSong = await res.json();
      currentSong._wsPlayKey = wsPlayKey;
      currentSong._wsCapo    = msg.capo ?? null;
      applyBestLayout();
      updateMetaOverlay();
    } catch { showBlank(); }
  }
}

function showBlank() {
  currentSongId = null;
  currentSong   = null;
  document.getElementById('lyrics-container').innerHTML = '';
  updateMetaOverlay();
}

// ── Chord helpers ─────────────────────────────────────────────────────────────

function hasChords(line) {
  return /\[[^\]]+\]/.test(line);
}

function plainText(line) {
  return line.replace(/\[[^\]]*\]/g, '');
}

function buildChordGroup(chord, text) {
  const g = document.createElement('span');
  g.className = 'chord-group';
  const c = document.createElement('span');
  c.className = 'chord';
  c.textContent = chord || ' ';
  const t = document.createElement('span');
  t.className = 'lyric-text';
  t.textContent = text || ' ';
  g.appendChild(c);
  g.appendChild(t);
  return g;
}

function buildChordLineEl(line) {
  const el = document.createElement('span');
  el.className = 'lyric-line';
  const firstBracket = line.indexOf('[');
  if (firstBracket > 0) {
    el.appendChild(buildChordGroup('', line.slice(0, firstBracket)));
  }
  const regex = /\[([^\]]+)\]([^\[]*)/g;
  let match;
  while ((match = regex.exec(line)) !== null) {
    el.appendChild(buildChordGroup(transposeChord(match[1], transposeSteps, transposeFlat), match[2]));
  }
  return el;
}

// ── DOM builders ──────────────────────────────────────────────────────────────

function sectionTypeClass(label) {
  const l = (label || '').toLowerCase();
  if (/^(verse|vers\b|strophe)/.test(l))      return 'sec-verse';
  if (/^(chorus|refrain)/.test(l))             return 'sec-chorus';
  if (/^bridge/.test(l))                       return 'sec-bridge';
  if (/^intro/.test(l))                        return 'sec-intro';
  if (/^outro/.test(l))                        return 'sec-outro';
  if (/^(pre-chorus|vorkehrus|pre\b)/.test(l)) return 'sec-pre';
  return '';
}

function buildSectionEl(section) {
  const block = document.createElement('div');
  const typeClass = showChords ? sectionTypeClass(section.label) : '';
  block.className = 'section' + (typeClass ? ' ' + typeClass : '');
  if (section.label) {
    const el = document.createElement('span');
    el.className = 'section-label';
    el.textContent = section.label;
    block.appendChild(el);
  }
  for (const line of section.lines) {
    let el;
    if (line === '') {
      el = document.createElement('span');
      el.style.cssText = 'display:block;height:0.4em';
    } else if (showChords && hasChords(line)) {
      el = buildChordLineEl(line);
    } else {
      el = document.createElement('span');
      el.className = 'lyric-line';
      el.textContent = plainText(line);
    }
    block.appendChild(el);
  }
  return block;
}

function buildSongHeader(song) {
  const wrap = document.createElement('div');
  const titleEl = document.createElement('span');
  titleEl.className = 'song-title';
  titleEl.textContent = song.title;
  wrap.appendChild(titleEl);
  if (song.artist) {
    const artistEl = document.createElement('span');
    artistEl.className = 'song-artist';
    artistEl.textContent = song.artist;
    wrap.appendChild(artistEl);
  }
  return wrap;
}

function buildLayout(container, song, numCols, allowWrap) {
  container.innerHTML = '';
  container.style.whiteSpace = allowWrap ? 'normal' : 'nowrap';

  if (numCols <= 1) {
    container.style.display = 'block';
    container.appendChild(buildSongHeader(song));
    for (const s of song.sections) container.appendChild(buildSectionEl(s));
    return;
  }

  container.style.display = 'flex';
  container.style.gap = '4vw';
  container.style.alignItems = 'flex-start';

  const colDivs = Array.from({ length: numCols }, () => {
    const div = document.createElement('div');
    div.className = 'col';
    div.style.cssText = `flex: 1; min-width: 0; overflow: hidden; white-space: nowrap;`;
    return div;
  });

  colDivs[0].appendChild(buildSongHeader(song));

  const perCol = Math.ceil(song.sections.length / numCols);
  song.sections.forEach((s, i) => {
    colDivs[Math.min(Math.floor(i / perCol), numCols - 1)].appendChild(buildSectionEl(s));
  });

  colDivs.forEach(col => container.appendChild(col));
}

// ── Binary search ─────────────────────────────────────────────────────────────

function bestFontSize(container, numCols) {
  const maxH = window.innerHeight * 0.96;
  const maxW = window.innerWidth * 0.96;
  const cols = numCols > 1 ? [...container.querySelectorAll('.col')] : null;

  let lo = 4, hi = 200, best = lo;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    container.style.fontSize = `${mid}px`;

    const fits = cols
      ? container.scrollHeight <= maxH &&
        cols.every(col => col.scrollWidth <= col.clientWidth + 1)
      : container.scrollHeight <= maxH && container.scrollWidth <= maxW;

    if (fits) { best = mid; lo = mid + 1; }
    else       { hi = mid - 1; }
  }
  return best;
}

// ── Layout engine ─────────────────────────────────────────────────────────────

const MIN_FONT = 10;

function applyBestLayout() {
  if (!currentSong) return;
  if (window.innerWidth < 100 || window.innerHeight < 100) return;

  updateTranspose();

  const container = document.getElementById('lyrics-container');
  container.style.visibility = 'hidden';

  let bestCols = 1, bestSize = 0, bestWrap = true;

  buildLayout(container, currentSong, 1, true);
  const sz1 = bestFontSize(container, 1);
  if (sz1 > bestSize) { bestSize = sz1; bestCols = 1; bestWrap = true; }

  for (const cols of [2, 3]) {
    buildLayout(container, currentSong, cols, false);
    const sz = bestFontSize(container, cols);
    if (sz > bestSize) { bestSize = sz; bestCols = cols; bestWrap = false; }
    if (sz >= 200) break;
  }

  buildLayout(container, currentSong, bestCols, bestWrap);
  container.style.fontSize = `${Math.max(bestSize, MIN_FONT)}px`;
  container.style.visibility = 'visible';
}

// Debounce: wait until resizing has stopped before recalculating
let resizeTimer = null;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(applyBestLayout, 120);
});

// ── Meta overlay ──────────────────────────────────────────────────────────────

let metaListenersAttached = false;

function updateMetaOverlay() {
  const overlay  = document.getElementById('meta-overlay');
  if (!showChords || !currentSong) { overlay.style.display = 'none'; return; }

  if (!metaListenersAttached) {
    metaListenersAttached = true;
    document.getElementById('meta-key-down').addEventListener('click', () => shiftPlayKey(-1));
    document.getElementById('meta-key-up').addEventListener('click',   () => shiftPlayKey( 1));
  }

  overlay.style.display = 'flex';
  const playKey = currentSong._wsPlayKey || currentSong.playKey || currentSong.key || '';
  const origKey = currentSong.key || '';

  document.getElementById('meta-key-display').textContent = playKey || '—';
  const origEl = document.getElementById('meta-key-orig');
  if (origKey && playKey && origKey !== playKey) {
    origEl.textContent = `(${origKey})`;
    origEl.style.display = '';
  } else {
    origEl.style.display = 'none';
  }
  const effectiveCapo = currentSong._wsCapo ?? currentSong.capo ?? 0;
  document.getElementById('meta-capo-text').textContent =
    effectiveCapo > 0 ? `Capo ${effectiveCapo}` : '';
}

async function shiftPlayKey(delta) {
  if (!currentSong) return;
  const base = currentSong.playKey || currentSong.key || 'C';
  const newKey = shiftKey(base, delta);
  try {
    const updated = await fetch(`/api/songs/${currentSong.id}`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playKey: newKey }),
    }).then((r) => r.json());
    currentSong.playKey = updated.playKey;
  } catch { currentSong.playKey = newKey; }
  updateTranspose();
  applyBestLayout();
  updateMetaOverlay();
}

connect();

// ── Auto-fullscreen ───────────────────────────────────────────────────────────
(function () {
  if (new URLSearchParams(location.search).get('fullscreen') !== '1') return;
  function tryFullscreen() {
    document.documentElement.requestFullscreen({ navigationUI: 'hide' }).catch(() => {
      // Activation not available yet — show a tap-to-fullscreen overlay
      const btn = document.createElement('button');
      btn.textContent = '⛶ Vollbild';
      btn.style.cssText = 'position:fixed;bottom:20px;left:50%;transform:translateX(-50%);padding:14px 28px;background:rgba(255,255,255,.15);border:1px solid rgba(255,255,255,.3);border-radius:10px;color:#fff;font-size:18px;cursor:pointer;z-index:999;backdrop-filter:blur(8px)';
      btn.addEventListener('click', () => { document.documentElement.requestFullscreen({ navigationUI: 'hide' }); btn.remove(); }, { once: true });
      document.body.appendChild(btn);
    });
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', tryFullscreen, { once: true });
  } else {
    tryFullscreen();
  }
})();
