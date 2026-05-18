let currentSongId = null;

// ── WebSocket ─────────────────────────────────────────────────────────────────

function connect() {
  const ws = new WebSocket(`ws://${location.host}`);

  ws.onopen = () => {
    // Connection restored — no visual feedback needed on display
  };

  ws.onmessage = (event) => {
    handleMessage(JSON.parse(event.data));
  };

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
      const song = await res.json();
      renderSong(song);
    } catch {
      showBlank();
    }
  }
}

// ── Rendering ─────────────────────────────────────────────────────────────────

function renderSong(song) {
  const container = document.getElementById('lyrics-container');
  container.innerHTML = '';

  let firstSection = true;
  for (const section of song.sections) {
    if (!firstSection) {
      const gap = document.createElement('span');
      gap.className = 'section-gap';
      container.appendChild(gap);
    }
    firstSection = false;

    if (section.label) {
      const labelEl = document.createElement('span');
      labelEl.className = 'section-label';
      labelEl.textContent = section.label;
      container.appendChild(labelEl);
    }

    for (const line of section.lines) {
      const lineEl = document.createElement('span');
      lineEl.className = 'lyric-line';
      lineEl.textContent = line;
      container.appendChild(lineEl);
    }
  }

  autoScale(container);
}

function showBlank() {
  currentSongId = null;
  document.getElementById('lyrics-container').innerHTML = '';
}

// ── Auto-scaling (binary search) ──────────────────────────────────────────────

function autoScale(container) {
  const maxH = window.innerHeight * 0.9;
  const maxW = window.innerWidth * 0.9;

  let lo = 4, hi = 200, best = lo;

  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    container.style.fontSize = `${mid}px`;
    if (container.scrollHeight <= maxH && container.scrollWidth <= maxW) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }

  container.style.fontSize = `${best}px`;
}

window.addEventListener('resize', () => {
  const container = document.getElementById('lyrics-container');
  if (container.children.length > 0) autoScale(container);
});

connect();
