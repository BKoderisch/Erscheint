let ws;
let currentSongId = null;
let songs = [];          // all songs from library
let arrangements = [];   // all arrangements
let activeArrId = null;  // arrangement currently used for the song list
let editingArrId = null; // arrangement open in editor
let displayWindow = null;

// ── WebSocket ─────────────────────────────────────────────────────────────────

function connectWS() {
  ws = new WebSocket(`ws://${location.host}`);
  ws.onopen = () => document.getElementById('status-dot').classList.add('connected');
  ws.onclose = () => { document.getElementById('status-dot').classList.remove('connected'); setTimeout(connectWS, 2000); };
  ws.onerror = () => ws.close();
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    currentSongId = msg.type === 'song' ? msg.songId : null;
    updateActiveHighlight();
  };
}

function send(msg) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

// ── Monitor ───────────────────────────────────────────────────────────────────

async function loadMonitors() {
  try {
    const monitors = await fetch('/api/monitors').then((r) => r.json());
    if (!monitors || !monitors.length) return;
    const container = document.getElementById('monitor-buttons');
    container.innerHTML = '';
    monitors.forEach((m, i) => {
      const btn = document.createElement('button');
      btn.className = 'monitor-btn';
      btn.textContent = `🖥 Monitor ${i + 1}${m.primary ? ' (Primär)' : ''}`;
      btn.title = `${m.name}  ${m.width}×${m.height}`;
      btn.addEventListener('click', () => openDisplay(m));
      container.appendChild(btn);
    });
  } catch { /* keep default button */ }
}

function openDisplay(monitor) {
  const features = monitor
    ? `left=${monitor.x},top=${monitor.y},width=${monitor.width},height=${monitor.height}`
    : 'width=1280,height=720';
  if (displayWindow && !displayWindow.closed) {
    displayWindow.focus();
    if (monitor) { displayWindow.moveTo(monitor.x, monitor.y); displayWindow.resizeTo(monitor.width, monitor.height); }
    return;
  }
  displayWindow = window.open('/display', 'erscheint-display', features);
}

// ── Tabs ──────────────────────────────────────────────────────────────────────

document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(`tab-${btn.dataset.tab}`).classList.add('active');
  });
});

// ── Blank button ──────────────────────────────────────────────────────────────

document.getElementById('blank-btn').addEventListener('click', () => send({ type: 'blank' }));

// ── Songs ─────────────────────────────────────────────────────────────────────

async function loadSongs() {
  songs = await fetch('/api/songs').then((r) => r.json());
  renderSongList();
}

function visibleSongs() {
  if (!activeArrId) return songs;
  const arr = arrangements.find((a) => a.id === activeArrId);
  if (!arr) return songs;
  return arr.songIds.map((id) => songs.find((s) => s.id === id)).filter(Boolean);
}

function renderSongList() {
  const list = document.getElementById('song-list');
  const noSongs = document.getElementById('no-songs');
  list.querySelectorAll('.song-item').forEach((el) => el.remove());

  const visible = visibleSongs();
  if (visible.length === 0) { noSongs.style.display = ''; return; }
  noSongs.style.display = 'none';

  for (const song of visible) {
    const li = document.createElement('li');
    li.className = 'song-item' + (song.id === currentSongId ? ' active' : '');
    li.dataset.id = song.id;

    const titleEl = document.createElement('span');
    titleEl.className = 'song-title';
    titleEl.textContent = song.title;

    const delBtn = document.createElement('button');
    delBtn.className = 'icon-btn';
    delBtn.textContent = '✕';
    delBtn.title = 'Löschen';
    delBtn.addEventListener('click', (e) => { e.stopPropagation(); deleteSong(song.id, song.title); });

    li.appendChild(titleEl);
    li.appendChild(delBtn);
    li.addEventListener('click', () => send({ type: 'show_song', songId: song.id }));
    list.appendChild(li);
  }
}

function updateActiveHighlight() {
  document.querySelectorAll('.song-item').forEach((el) => {
    el.classList.toggle('active', el.dataset.id === currentSongId);
  });
}

async function deleteSong(id, title) {
  if (!confirm(`"${title}" wirklich löschen?`)) return;
  await fetch(`/api/songs/${id}`, { method: 'DELETE' });
  if (currentSongId === id) send({ type: 'blank' });
  await loadSongs();
}

// ── Add song (collapsible) ────────────────────────────────────────────────────

const addToggle = document.getElementById('add-toggle');
const addForm = document.getElementById('add-form');
addToggle.addEventListener('click', () => {
  const open = addForm.classList.toggle('open');
  addToggle.classList.toggle('open', open);
});

document.getElementById('add-btn').addEventListener('click', async () => {
  const titleInput = document.getElementById('title-input');
  const textInput = document.getElementById('text-input');
  const btn = document.getElementById('add-btn');
  const title = titleInput.value.trim();
  const rawText = textInput.value.trim();
  if (!title) { titleInput.focus(); return; }
  if (!rawText) { textInput.focus(); return; }

  btn.disabled = true; btn.textContent = 'Wird hinzugefügt…';
  try {
    await fetch('/api/songs', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, rawText }),
    });
    titleInput.value = ''; textInput.value = '';
    addForm.classList.remove('open'); addToggle.classList.remove('open');
    await loadSongs();
  } finally { btn.disabled = false; btn.textContent = 'Hinzufügen'; }
});

// ── Arrangements list ─────────────────────────────────────────────────────────

async function loadArrangements() {
  arrangements = await fetch('/api/arrangements').then((r) => r.json());
  renderArrangementList();
}

function renderArrangementList() {
  const list = document.getElementById('arr-list');
  const noArr = document.getElementById('no-arr');
  list.querySelectorAll('.arr-item').forEach((el) => el.remove());

  if (arrangements.length === 0) { noArr.style.display = ''; return; }
  noArr.style.display = 'none';

  for (const arr of arrangements) {
    const li = document.createElement('li');
    li.className = 'arr-item' + (arr.id === activeArrId ? ' active-arr' : '');
    li.dataset.id = arr.id;

    const nameEl = document.createElement('span');
    nameEl.className = 'arr-name';
    nameEl.textContent = arr.name;

    const actions = document.createElement('div');
    actions.className = 'arr-actions';

    const useBtn = document.createElement('button');
    useBtn.className = 'icon-btn';
    useBtn.textContent = arr.id === activeArrId ? '✓' : '▶';
    useBtn.title = arr.id === activeArrId ? 'Aktiv' : 'Verwenden';
    useBtn.addEventListener('click', () => activateArrangement(arr.id));

    const editBtn = document.createElement('button');
    editBtn.className = 'icon-btn';
    editBtn.textContent = '✎';
    editBtn.title = 'Bearbeiten';
    editBtn.addEventListener('click', () => openArrEditor(arr.id));

    const delBtn = document.createElement('button');
    delBtn.className = 'icon-btn';
    delBtn.textContent = '✕';
    delBtn.title = 'Löschen';
    delBtn.addEventListener('click', () => deleteArrangement(arr.id, arr.name));

    actions.append(useBtn, editBtn, delBtn);
    li.append(nameEl, actions);
    list.appendChild(li);
  }
}

function activateArrangement(id) {
  activeArrId = activeArrId === id ? null : id;
  renderArrangementList();
  renderSongList();
  updateArrBanner();

  // Switch to songs tab
  document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
  document.querySelectorAll('.tab-panel').forEach((p) => p.classList.remove('active'));
  document.querySelector('[data-tab="songs"]').classList.add('active');
  document.getElementById('tab-songs').classList.add('active');
}

function updateArrBanner() {
  const banner = document.getElementById('active-arr-banner');
  const nameEl = document.getElementById('active-arr-name');
  if (activeArrId) {
    const arr = arrangements.find((a) => a.id === activeArrId);
    nameEl.textContent = arr ? arr.name : '';
    banner.classList.add('visible');
  } else {
    banner.classList.remove('visible');
  }
}

document.getElementById('clear-arr-btn').addEventListener('click', () => {
  activeArrId = null;
  renderArrangementList();
  renderSongList();
  updateArrBanner();
});

async function deleteArrangement(id, name) {
  if (!confirm(`"${name}" wirklich löschen?`)) return;
  if (activeArrId === id) { activeArrId = null; updateArrBanner(); }
  await fetch(`/api/arrangements/${id}`, { method: 'DELETE' });
  await loadArrangements();
}

// ── New arrangement (collapsible) ─────────────────────────────────────────────

const arrToggle = document.getElementById('arr-toggle');
const arrCreateForm = document.getElementById('arr-create-form');
arrToggle.addEventListener('click', () => {
  const open = arrCreateForm.style.display === 'block';
  arrCreateForm.style.display = open ? 'none' : 'block';
  arrToggle.querySelector('.chevron').style.transform = open ? '' : 'rotate(180deg)';
});

document.getElementById('arr-create-btn').addEventListener('click', async () => {
  const input = document.getElementById('arr-name-input');
  const name = input.value.trim();
  if (!name) { input.focus(); return; }
  await fetch('/api/arrangements', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, songIds: [] }),
  });
  input.value = '';
  arrCreateForm.style.display = 'none';
  arrToggle.querySelector('.chevron').style.transform = '';
  await loadArrangements();
});

// ── Arrangement editor ────────────────────────────────────────────────────────

function openArrEditor(id) {
  editingArrId = id;
  const arr = arrangements.find((a) => a.id === id);
  document.getElementById('arr-editor-name').textContent = arr.name;
  document.getElementById('arr-list-view').style.display = 'none';
  document.getElementById('arr-editor').classList.add('open');
  renderArrEditor();
}

document.getElementById('arr-back').addEventListener('click', () => {
  editingArrId = null;
  document.getElementById('arr-editor').classList.remove('open');
  document.getElementById('arr-list-view').style.display = '';
  loadArrangements();
});

function renderArrEditor() {
  const arr = arrangements.find((a) => a.id === editingArrId);
  if (!arr) return;

  // Songs in arrangement (ordered)
  const songList = document.getElementById('arr-song-list');
  songList.innerHTML = '';

  arr.songIds.forEach((songId, idx) => {
    const song = songs.find((s) => s.id === songId);
    if (!song) return;

    const li = document.createElement('li');
    li.className = 'arr-song-item';

    const titleEl = document.createElement('span');
    titleEl.className = 'arr-song-title';
    titleEl.textContent = song.title;

    const upBtn = document.createElement('button');
    upBtn.className = 'move-btn'; upBtn.textContent = '▲'; upBtn.title = 'Nach oben';
    upBtn.disabled = idx === 0;
    upBtn.addEventListener('click', () => moveArrSong(arr, idx, -1));

    const downBtn = document.createElement('button');
    downBtn.className = 'move-btn'; downBtn.textContent = '▼'; downBtn.title = 'Nach unten';
    downBtn.disabled = idx === arr.songIds.length - 1;
    downBtn.addEventListener('click', () => moveArrSong(arr, idx, 1));

    const removeBtn = document.createElement('button');
    removeBtn.className = 'icon-btn'; removeBtn.textContent = '✕'; removeBtn.title = 'Entfernen';
    removeBtn.addEventListener('click', () => removeArrSong(arr, songId));

    li.append(titleEl, upBtn, downBtn, removeBtn);
    songList.appendChild(li);
  });

  // Available songs (not yet in arrangement)
  const inArr = new Set(arr.songIds);
  const available = songs.filter((s) => !inArr.has(s.id));
  const availList = document.getElementById('arr-available-list');
  const noAvail = document.getElementById('no-avail');
  availList.innerHTML = '';

  if (available.length === 0) {
    noAvail.style.display = '';
  } else {
    noAvail.style.display = 'none';
    for (const song of available) {
      const li = document.createElement('li');
      li.className = 'avail-item';

      const titleEl = document.createElement('span');
      titleEl.className = 'avail-title';
      titleEl.textContent = song.title;

      const addBtn = document.createElement('button');
      addBtn.className = 'add-to-arr-btn'; addBtn.textContent = '+ Hinzufügen';
      addBtn.addEventListener('click', () => addArrSong(arr, song.id));

      li.append(titleEl, addBtn);
      availList.appendChild(li);
    }
  }
}

async function saveArr(arr) {
  await fetch(`/api/arrangements/${arr.id}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ songIds: arr.songIds }),
  });
  // Update local copy
  const idx = arrangements.findIndex((a) => a.id === arr.id);
  if (idx !== -1) arrangements[idx] = { ...arrangements[idx], songIds: arr.songIds };
}

async function moveArrSong(arr, idx, dir) {
  const ids = [...arr.songIds];
  const [item] = ids.splice(idx, 1);
  ids.splice(idx + dir, 0, item);
  arr.songIds = ids;
  await saveArr(arr);
  if (activeArrId === arr.id) renderSongList();
  renderArrEditor();
}

async function removeArrSong(arr, songId) {
  arr.songIds = arr.songIds.filter((id) => id !== songId);
  await saveArr(arr);
  if (activeArrId === arr.id) renderSongList();
  renderArrEditor();
}

async function addArrSong(arr, songId) {
  arr.songIds = [...arr.songIds, songId];
  await saveArr(arr);
  if (activeArrId === arr.id) renderSongList();
  renderArrEditor();
}

// ── Init ──────────────────────────────────────────────────────────────────────

connectWS();
loadMonitors();
Promise.all([loadSongs(), loadArrangements()]);
