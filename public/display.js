let currentSongId = null;

// ── WebSocket ─────────────────────────────────────────────────────────────────

function connect() {
  const ws = new WebSocket(`ws://${location.host}`);
  ws.onmessage = (e) => handleMessage(JSON.parse(e.data));
  ws.onclose = () => setTimeout(connect, 2000);
  ws.onerror = () => ws.close();
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
      renderSong(await res.json());
    } catch { showBlank(); }
  }
}

// ── Rendering ─────────────────────────────────────────────────────────────────

function renderSong(song) {
  const container = document.getElementById('lyrics-container');
  container.innerHTML = '';

  for (const section of song.sections) {
    const block = document.createElement('div');
    block.className = 'section';

    if (section.label) {
      const labelEl = document.createElement('span');
      labelEl.className = 'section-label';
      labelEl.textContent = section.label;
      block.appendChild(labelEl);
    }

    for (const line of section.lines) {
      const lineEl = document.createElement('span');
      lineEl.className = 'lyric-line';
      lineEl.textContent = line;
      block.appendChild(lineEl);
    }

    container.appendChild(block);
  }

  autoScale(container);
}

function showBlank() {
  currentSongId = null;
  document.getElementById('lyrics-container').innerHTML = '';
}

// ── Auto-scaling with multi-column search ─────────────────────────────────────

function binarySearchFontSize(container) {
  const maxH = window.innerHeight * 0.9;
  const maxW = window.innerWidth * 0.9;
  let lo = 4, hi = 200, best = lo;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    container.style.fontSize = `${mid}px`;
    if (container.scrollHeight <= maxH && container.scrollWidth <= maxW) {
      best = mid; lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return best;
}

function autoScale(container) {
  let bestCols = 1;
  let bestSize = 0;

  for (const cols of [1, 2, 3]) {
    container.style.columnCount = cols > 1 ? cols : 'auto';
    const size = binarySearchFontSize(container);
    if (size > bestSize) {
      bestSize = size;
      bestCols = cols;
    }
    // No point trying more columns if font is already as large as it gets
    if (size >= 200) break;
  }

  container.style.columnCount = bestCols > 1 ? bestCols : 'auto';
  container.style.fontSize = `${bestSize}px`;
}

window.addEventListener('resize', () => {
  const container = document.getElementById('lyrics-container');
  if (container.children.length > 0) autoScale(container);
});

connect();
