let currentSongId = null;
let currentSong   = null;

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
    if (msg.songId === currentSongId) return;
    currentSongId = msg.songId;
    try {
      const res = await fetch(`/api/songs/${msg.songId}`);
      if (!res.ok) { showBlank(); return; }
      currentSong = await res.json();
      applyBestLayout();
    } catch { showBlank(); }
  }
}

function showBlank() {
  currentSongId = null;
  currentSong   = null;
  document.getElementById('lyrics-container').innerHTML = '';
}

// ── DOM builders ──────────────────────────────────────────────────────────────

function buildSectionEl(section) {
  const block = document.createElement('div');
  block.className = 'section';
  if (section.label) {
    const el = document.createElement('span');
    el.className = 'section-label';
    el.textContent = section.label;
    block.appendChild(el);
  }
  for (const line of section.lines) {
    const el = document.createElement('span');
    el.className = 'lyric-line';
    el.textContent = line;
    block.appendChild(el);
  }
  return block;
}

function buildLayout(container, song, numCols, allowWrap) {
  container.innerHTML = '';
  container.style.whiteSpace = allowWrap ? 'normal' : 'nowrap';

  const titleEl = document.createElement('span');
  titleEl.className = 'song-title';
  titleEl.textContent = song.title;

  if (numCols <= 1) {
    container.style.display = 'block';
    container.appendChild(titleEl);
    for (const s of song.sections) container.appendChild(buildSectionEl(s));
    return;
  }

  // Flexbox columns
  container.style.display = 'flex';
  container.style.gap = '4vw';
  container.style.alignItems = 'flex-start';

  const colDivs = Array.from({ length: numCols }, () => {
    const div = document.createElement('div');
    div.className = 'col';
    div.style.cssText = `flex: 1; min-width: 0; overflow: hidden; white-space: nowrap;`;
    return div;
  });

  colDivs[0].appendChild(titleEl);

  const perCol = Math.ceil(song.sections.length / numCols);
  song.sections.forEach((s, i) => {
    colDivs[Math.min(Math.floor(i / perCol), numCols - 1)].appendChild(buildSectionEl(s));
  });

  colDivs.forEach(col => container.appendChild(col));
}

// ── Binary search ─────────────────────────────────────────────────────────────

function bestFontSize(container, numCols) {
  const maxH = window.innerHeight * 0.9;
  const maxW = window.innerWidth * 0.9;
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

function applyBestLayout() {
  if (!currentSong) return;
  const container = document.getElementById('lyrics-container');
  const portrait  = window.innerHeight > window.innerWidth;

  if (portrait) {
    buildLayout(container, currentSong, 1, true);
    container.style.fontSize = `${bestFontSize(container, 1)}px`;
    return;
  }

  // Landscape: find the column count that gives the largest font
  let bestCols = 1, bestSize = 0;
  for (const cols of [1, 2, 3]) {
    buildLayout(container, currentSong, cols, false);
    const size = bestFontSize(container, cols);
    if (size > bestSize) { bestSize = size; bestCols = cols; }
    if (size >= 200) break;
  }

  buildLayout(container, currentSong, bestCols, false);
  container.style.fontSize = `${bestSize}px`;
}

window.addEventListener('resize', applyBestLayout);

connect();
