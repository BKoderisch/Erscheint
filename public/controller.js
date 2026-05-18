let ws;
let currentSongId = null;
let songs = [];
let displayWindow = null;

// ── WebSocket ─────────────────────────────────────────────────────────────────

function connectWS() {
  ws = new WebSocket(`ws://${location.host}`);

  ws.onopen = () => {
    document.getElementById('status-dot').classList.add('connected');
  };

  ws.onclose = () => {
    document.getElementById('status-dot').classList.remove('connected');
    setTimeout(connectWS, 2000);
  };

  ws.onerror = () => ws.close();

  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    if (msg.type === 'song') {
      currentSongId = msg.songId;
    } else if (msg.type === 'blank') {
      currentSongId = null;
    }
    updateActiveHighlight();
    updateBlankButton();
  };
}

function send(msg) {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

// ── Monitor detection ─────────────────────────────────────────────────────────

async function loadMonitors() {
  try {
    const res = await fetch('/api/monitors');
    const monitors = await res.json();
    if (!monitors || monitors.length === 0) return; // keep default button

    const container = document.getElementById('monitor-buttons');
    container.innerHTML = '';

    monitors.forEach((m, i) => {
      const btn = document.createElement('button');
      btn.className = 'monitor-btn' + (m.primary ? ' primary-badge' : '');
      btn.textContent = `🖥 Monitor ${i + 1}`;
      btn.title = `${m.name}  ${m.width}×${m.height}`;
      btn.addEventListener('click', () => openDisplay(m));
      container.appendChild(btn);
    });
  } catch {
    // Fallback: keep default button
  }
}

function openDisplay(monitor) {
  const features = monitor
    ? `left=${monitor.x},top=${monitor.y},width=${monitor.width},height=${monitor.height}`
    : `width=1280,height=720`;

  if (displayWindow && !displayWindow.closed) {
    displayWindow.focus();
    if (monitor) {
      displayWindow.moveTo(monitor.x, monitor.y);
      displayWindow.resizeTo(monitor.width, monitor.height);
    }
    return;
  }

  displayWindow = window.open('/display', 'erscheint-display', features);
}

// ── Song list ─────────────────────────────────────────────────────────────────

async function loadSongs() {
  const res = await fetch('/api/songs');
  songs = await res.json();
  renderSongList();
}

function renderSongList() {
  const list = document.getElementById('song-list');
  const noSongs = document.getElementById('no-songs');

  // Remove all song items (keep #no-songs)
  list.querySelectorAll('.song-item').forEach((el) => el.remove());

  if (songs.length === 0) {
    noSongs.style.display = '';
    return;
  }
  noSongs.style.display = 'none';

  for (const song of songs) {
    const li = document.createElement('li');
    li.className = 'song-item' + (song.id === currentSongId ? ' active' : '');
    li.dataset.id = song.id;

    const titleEl = document.createElement('span');
    titleEl.className = 'song-title';
    titleEl.textContent = song.title;

    const delBtn = document.createElement('button');
    delBtn.className = 'delete-btn';
    delBtn.textContent = '✕';
    delBtn.title = 'Löschen';
    delBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteSong(song.id, song.title);
    });

    li.appendChild(titleEl);
    li.appendChild(delBtn);
    li.addEventListener('click', () => {
      send({ type: 'show_song', songId: song.id });
    });
    list.appendChild(li);
  }
}

function updateActiveHighlight() {
  document.querySelectorAll('.song-item').forEach((el) => {
    el.classList.toggle('active', el.dataset.id === currentSongId);
  });
}

function updateBlankButton() {
  document.getElementById('blank-btn').classList.toggle('active-blank', currentSongId === null);
}

async function deleteSong(id, title) {
  if (!confirm(`"${title}" wirklich löschen?`)) return;
  await fetch(`/api/songs/${id}`, { method: 'DELETE' });
  if (currentSongId === id) send({ type: 'blank' });
  await loadSongs();
}

// ── Add song ──────────────────────────────────────────────────────────────────

document.getElementById('add-btn').addEventListener('click', async () => {
  const titleInput = document.getElementById('title-input');
  const textInput = document.getElementById('text-input');
  const btn = document.getElementById('add-btn');

  const title = titleInput.value.trim();
  const rawText = textInput.value.trim();

  if (!title) { titleInput.focus(); return; }
  if (!rawText) { textInput.focus(); return; }

  btn.disabled = true;
  btn.textContent = 'Wird hinzugefügt…';

  try {
    await fetch('/api/songs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, rawText }),
    });
    titleInput.value = '';
    textInput.value = '';
    await loadSongs();
  } finally {
    btn.disabled = false;
    btn.textContent = 'Hinzufügen';
  }
});

// ── Blank button ──────────────────────────────────────────────────────────────

document.getElementById('blank-btn').addEventListener('click', () => {
  send({ type: 'blank' });
});

// ── Init ──────────────────────────────────────────────────────────────────────

connectWS();
loadMonitors();
loadSongs();
