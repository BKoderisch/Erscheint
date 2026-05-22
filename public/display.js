let currentSongId  = null;  // song the musician sees locally
let currentSong    = null;
let beamerSongId   = null;  // song currently on the beamer (from WS)
let previewPlayKey = null;  // playKey of the locally previewed song
const showChords   = location.pathname.startsWith('/chords');

// Overridden by the chords sidebar block to keep active highlight in sync
let updateSidebarActive = () => {};

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

let ws = null;

function send(msg) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

function connect() {
  ws = new WebSocket(`ws://${location.host}`);
  ws.onmessage = (e) => handleMessage(JSON.parse(e.data));
  ws.onclose   = () => { ws = null; setTimeout(connect, 2000); };
  ws.onerror   = () => ws.close();
}

async function handleMessage(msg) {
  if (msg.type === 'blank') {
    beamerSongId = null;
    showBlank();
  } else if (msg.type === 'song') {
    const wsPlayKey = msg.playKey || null;
    const wsCapo    = msg.capo ?? null;
    beamerSongId = msg.songId;

    // Always update local view — controller can change what /chords shows too.
    // (Beamer button appears when the user has browsed locally to a different song.)
    const sameKey  = wsPlayKey === (currentSong?._wsPlayKey ?? null);
    const sameCapo = wsCapo    === (currentSong?._wsCapo    ?? null);
    if (msg.songId === currentSongId && sameKey && sameCapo) return;
    currentSongId  = msg.songId;
    previewPlayKey = null;
    try {
      const res = await fetch(`/api/songs/${msg.songId}`);
      if (!res.ok) { showBlank(); return; }
      currentSong = await res.json();
      currentSong._wsPlayKey = wsPlayKey;
      currentSong._wsCapo    = msg.capo ?? null;
      applyBestLayout();
      updateMetaOverlay();
      updateBeamerBtn();
      updateSidebarActive();
    } catch { showBlank(); }
  }
}

function showBlank() {
  currentSongId  = null;
  currentSong    = null;
  previewPlayKey = null;
  document.getElementById('lyrics-container').innerHTML = '';
  updateMetaOverlay();
  updateBeamerBtn();
  updateSidebarActive();
}

function updateBeamerBtn() {
  if (!showChords) return;
  const btn = document.getElementById('beamer-btn');
  btn.style.display = (currentSongId && currentSongId !== beamerSongId) ? 'flex' : 'none';
}

async function loadSongLocally(id, playKey) {
  try {
    const res = await fetch(`/api/songs/${id}`);
    if (!res.ok) return;
    currentSong = await res.json();
    currentSongId  = id;
    previewPlayKey = playKey || null;
    currentSong._wsPlayKey = playKey || null;
    currentSong._wsCapo    = null;
    applyBestLayout();
    updateMetaOverlay();
    updateBeamerBtn();
  } catch {}
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

// ── Song sidebar + navigation (chords page only) ─────────────────────────────

if (showChords) {
  let allSongs      = [];   // full song list from API
  let arrangements  = [];   // all arrangements
  let activeArrId   = null; // currently selected arrangement (null = all songs)
  let currentOrder  = [];   // songs in current view (arr or all), with _playKey
  let sidebarOpen   = false;

  const sidebar    = document.getElementById('song-sidebar');
  const overlay    = document.getElementById('sidebar-overlay');
  const toggleBtn  = document.getElementById('sidebar-toggle');
  const closeBtn   = document.getElementById('sidebar-close');
  const arrSelect  = document.getElementById('sidebar-arr-select');
  const searchEl   = document.getElementById('sidebar-search');
  const listEl     = document.getElementById('sidebar-list');

  // Update active highlight in the sidebar list without re-rendering everything
  updateSidebarActive = function () {
    document.querySelectorAll('.sidebar-song[data-songid]').forEach(li => {
      li.classList.toggle('active', li.dataset.songid === currentSongId);
    });
    // If sidebar is open, scroll active item into view
    if (sidebarOpen) {
      const active = listEl.querySelector('.sidebar-song.active');
      if (active) active.scrollIntoView({ block: 'nearest' });
    }
  };

  // ── Helpers ────────────────────────────────────────────────────────────────

  function escSidebar(s) {
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  }

  function buildOrder() {
    if (!activeArrId) {
      currentOrder = allSongs.map(s => ({ ...s, _playKey: null }));
      return;
    }
    const arr = arrangements.find(a => a.id === activeArrId);
    if (!arr) { currentOrder = allSongs.map(s => ({ ...s, _playKey: null })); return; }
    const items = arr.items || [];
    currentOrder = items
      .filter(it => it.type === 'song')
      .map(it => {
        const song = allSongs.find(s => s.id === it.id);
        return song ? { ...song, _playKey: it.playKey || null } : null;
      })
      .filter(Boolean);
  }

  // ── Render ─────────────────────────────────────────────────────────────────

  function renderArrSelect() {
    arrSelect.innerHTML = '<option value="">— Alle Songs —</option>'
      + arrangements.map(a => `<option value="${escSidebar(a.id)}">${escSidebar(a.name)}</option>`).join('');
    arrSelect.value = activeArrId || '';
  }

  function renderSidebarList(query) {
    const q = query.trim().toLowerCase();
    // Search always across all songs; no query → show current order
    const base     = q ? allSongs : currentOrder;
    const filtered = q ? base.filter(s => s.title.toLowerCase().includes(q)) : base;

    listEl.innerHTML = '';
    let num = 0;
    for (const song of filtered) {
      const inOrder = !q && activeArrId;
      num++;
      const li = document.createElement('li');
      li.className = 'sidebar-song' + (song.id === currentSongId ? ' active' : '');
      li.dataset.songid = song.id;
      const keyLabel = song._playKey || song.playKey || song.key || '';
      li.innerHTML =
        (inOrder ? `<span class="sidebar-song-num">${num}</span>` : '') +
        `<span class="sidebar-song-title">${escSidebar(song.title)}</span>` +
        (keyLabel ? `<span class="sidebar-song-key">${escSidebar(keyLabel)}</span>` : '');
      li.addEventListener('click', () => {
        loadSongLocally(song.id, song._playKey || null);
        closeSidebar();
      });
      listEl.appendChild(li);
    }
    if (!filtered.length) {
      const li = document.createElement('li');
      li.className = 'sidebar-empty';
      li.textContent = 'Keine Songs gefunden';
      listEl.appendChild(li);
    }
  }

  // ── Open / Close ───────────────────────────────────────────────────────────

  function openSidebar() {
    sidebarOpen = true;
    sidebar.classList.add('open');
    overlay.classList.add('open');
    searchEl.value = '';
    renderSidebarList('');
    // scroll active item into view
    setTimeout(() => {
      const active = listEl.querySelector('.sidebar-song.active');
      if (active) active.scrollIntoView({ block: 'center' });
    }, 50);
  }

  function closeSidebar() {
    sidebarOpen = false;
    sidebar.classList.remove('open');
    overlay.classList.remove('open');
  }

  // ── Navigation ─────────────────────────────────────────────────────────────

  function navigateSong(delta) {
    if (!currentOrder.length) return;
    const idx = currentOrder.findIndex(s => s.id === currentSongId);
    const next = idx < 0
      ? (delta > 0 ? 0 : currentOrder.length - 1)
      : idx + delta;
    if (next < 0 || next >= currentOrder.length) return;
    const song = currentOrder[next];
    loadSongLocally(song.id, song._playKey || null);
  }

  // ── Load data ──────────────────────────────────────────────────────────────

  const ARR_PREF_KEY = 'erscheint-chords-arr';

  async function loadSidebarData() {
    try {
      [allSongs, arrangements] = await Promise.all([
        fetch('/api/songs').then(r => r.json()),
        fetch('/api/arrangements').then(r => r.json()),
      ]);
    } catch { allSongs = []; arrangements = []; }

    // Prefer last used arrangement, then auto-select if only one exists
    const saved = localStorage.getItem(ARR_PREF_KEY);
    if (saved && arrangements.find(a => a.id === saved)) {
      activeArrId = saved;
    } else if (arrangements.length >= 1) {
      activeArrId = arrangements[0].id;
    }

    buildOrder();
    renderArrSelect();
  }

  // ── Events ─────────────────────────────────────────────────────────────────

  toggleBtn.style.display = 'flex';
  toggleBtn.addEventListener('click', () => sidebarOpen ? closeSidebar() : openSidebar());
  closeBtn.addEventListener('click', closeSidebar);
  overlay.addEventListener('click', closeSidebar);

  arrSelect.addEventListener('change', () => {
    activeArrId = arrSelect.value || null;
    if (activeArrId) localStorage.setItem(ARR_PREF_KEY, activeArrId);
    else             localStorage.removeItem(ARR_PREF_KEY);
    buildOrder();
    renderSidebarList(searchEl.value);
  });

  searchEl.addEventListener('input', () => renderSidebarList(searchEl.value));

  // Keyboard: Escape closes sidebar, arrows navigate songs
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { closeSidebar(); return; }
    if (sidebarOpen) return;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); navigateSong(+1); }
    if (e.key === 'ArrowLeft'  || e.key === 'ArrowUp'  ) { e.preventDefault(); navigateSong(-1); }
  });

  // Touch swipe: left/right to navigate songs
  let touchStartX = 0, touchStartY = 0;
  document.addEventListener('touchstart', (e) => {
    touchStartX = e.touches[0].clientX;
    touchStartY = e.touches[0].clientY;
  }, { passive: true });
  document.addEventListener('touchend', (e) => {
    if (sidebarOpen) return;
    const dx = e.changedTouches[0].clientX - touchStartX;
    const dy = e.changedTouches[0].clientY - touchStartY;
    if (Math.abs(dx) < 60 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    navigateSong(dx < 0 ? +1 : -1);
  }, { passive: true });

  // Beamer button: send locally previewed song to the beamer
  document.getElementById('beamer-btn').addEventListener('click', () => {
    if (!currentSongId) return;
    const pk = previewPlayKey || undefined;
    send({ type: 'show_song', songId: currentSongId, ...(pk ? { playKey: pk } : {}) });
    beamerSongId = currentSongId;
    updateBeamerBtn();
  });

  loadSidebarData();
}

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
