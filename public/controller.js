'use strict';

// ── State ─────────────────────────────────────────────────────────────────────

let ws;
let songs          = [];
let arrangements   = [];
let currentSongId  = null;
let activeArrId    = null;
let editingArrId   = null;
let editingSongId  = null;   // null = add mode, string = edit mode
let displayWindow  = null;
let searchQuery    = '';
let activeLabel    = null;   // label currently used as filter
let sheetLabels    = [];     // labels being edited in the sheet
let searchResults  = null;   // null = not in search mode, array = search results
let availSearch    = '';     // search query in arrangement editor available-songs list
let dragSrcIdx     = null;  // index of item currently being dragged

// ── WebSocket ─────────────────────────────────────────────────────────────────

function connectWS() {
  ws = new WebSocket(`ws://${location.host}`);

  ws.onopen = () => {
    document.getElementById('status-dot').classList.add('connected');
    document.getElementById('status-text').textContent = 'Verbunden';
  };
  ws.onclose = () => {
    document.getElementById('status-dot').classList.remove('connected');
    document.getElementById('status-text').textContent = 'Getrennt';
    setTimeout(connectWS, 2000);
  };
  ws.onerror = () => ws.close();
  ws.onmessage = (e) => {
    const msg = JSON.parse(e.data);
    currentSongId = msg.type === 'song' ? msg.songId : null;
    updateNowPlaying();
    updateSongHighlight();
    updateSongPreview();
  };
}

function send(msg) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

// ── Toast ─────────────────────────────────────────────────────────────────────

function toast(text, type = '') {
  const el = document.createElement('div');
  el.className = `toast${type ? ' ' + type : ''}`;
  el.textContent = text;
  document.getElementById('toasts').prepend(el);
  setTimeout(() => el.remove(), 3200);
}

// ── Now Playing ───────────────────────────────────────────────────────────────

function updateNowPlaying() {
  const card   = document.getElementById('now-playing');
  const title  = document.getElementById('np-title');
  const btn    = document.getElementById('blank-btn');

  if (currentSongId) {
    const song = songs.find((s) => s.id === currentSongId);
    title.textContent = song ? song.title : currentSongId;
    card.classList.add('live');
    btn.classList.remove('always');
    btn.textContent = '⬛ Blank';
  } else {
    title.textContent = 'Schwarze Leinwand';
    card.classList.remove('live');
    btn.classList.add('always');
    btn.textContent = 'Blank';
  }
}

document.getElementById('blank-btn').addEventListener('click', () => {
  send({ type: 'blank' });
});

// ── Monitor dropdown ──────────────────────────────────────────────────────────

document.getElementById('monitor-toggle-btn').addEventListener('click', (e) => {
  e.stopPropagation();
  document.getElementById('monitor-dropdown').classList.toggle('open');
});
document.addEventListener('click', () => {
  document.getElementById('monitor-dropdown').classList.remove('open');
});

async function loadMonitors() {
  try {
    const monitors = await fetch('/api/monitors').then((r) => r.json());
    if (!monitors || !monitors.length) return;
    const container = document.getElementById('monitor-items');
    container.innerHTML = '';
    monitors.forEach((m, i) => {
      const btn = document.createElement('button');
      btn.className = 'monitor-item';
      btn.innerHTML = `🖥 Monitor ${i + 1}${m.primary ? ' <span class="monitor-badge">Primär</span>' : ''}`;
      btn.title = `${m.name}  ${m.width}×${m.height}`;
      btn.addEventListener('click', () => {
        openDisplay(m);
        document.getElementById('monitor-dropdown').classList.remove('open');
      });
      container.appendChild(btn);
    });
  } catch { /* keep default */ }
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

function switchTab(tab) {
  document.querySelectorAll('.tab-btn').forEach((b) => b.classList.remove('active'));
  document.querySelectorAll('.panel').forEach((p) => p.classList.remove('active'));
  document.querySelector(`[data-tab="${tab}"]`).classList.add('active');
  document.getElementById(`tab-${tab}`).classList.add('active');
  document.getElementById('songs-search-section').style.display = tab === 'songs' ? '' : 'none';
}

document.querySelectorAll('.tab-btn').forEach((btn) => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});

// ── Arrangement item helpers ──────────────────────────────────────────────────

function getItems(arr) {
  if (arr.items) return arr.items;
  return (arr.songIds || []).map((id) => ({ type: 'song', id }));
}

function getArrSongIds(arr) {
  return getItems(arr).filter((i) => i.type === 'song').map((i) => i.id);
}

// ── Songs ─────────────────────────────────────────────────────────────────────

async function loadSongs() {
  songs = await fetch('/api/songs').then((r) => r.json());
  document.getElementById('songs-badge').textContent = songs.length;
  renderLabelFilterStrip();
  renderSongList();
  updateNowPlaying();
}

// ── Label colors ──────────────────────────────────────────────────────────────

const LABEL_PALETTE = [
  { bg: 'rgba(59,130,246,.18)',  color: '#93c5fd', border: 'rgba(59,130,246,.35)'  }, // blue
  { bg: 'rgba(139,92,246,.18)', color: '#c4b5fd', border: 'rgba(139,92,246,.35)'  }, // violet
  { bg: 'rgba(236,72,153,.18)', color: '#f9a8d4', border: 'rgba(236,72,153,.35)'  }, // pink
  { bg: 'rgba(16,185,129,.18)', color: '#6ee7b7', border: 'rgba(16,185,129,.35)'  }, // emerald
  { bg: 'rgba(245,158,11,.18)', color: '#fcd34d', border: 'rgba(245,158,11,.35)'  }, // amber
  { bg: 'rgba(6,182,212,.18)',  color: '#67e8f9', border: 'rgba(6,182,212,.35)'   }, // cyan
  { bg: 'rgba(249,115,22,.18)', color: '#fdba74', border: 'rgba(249,115,22,.35)'  }, // orange
  { bg: 'rgba(132,204,22,.18)', color: '#bef264', border: 'rgba(132,204,22,.35)'  }, // lime
];

function labelPalette(str) {
  let h = 0;
  for (const c of str) h = (h * 31 + c.charCodeAt(0)) & 0x7fffffff;
  return LABEL_PALETTE[h % LABEL_PALETTE.length];
}

function labelChipEl(text, removable = false) {
  const p = labelPalette(text);
  const span = document.createElement('span');
  span.className = 'label-chip' + (removable ? ' removable' : '');
  span.style.setProperty('--chip-bg',     p.bg);
  span.style.setProperty('--chip-color',  p.color);
  span.style.setProperty('--chip-border', p.border);
  span.textContent = text;
  if (removable) {
    const x = document.createElement('span');
    x.className = 'chip-x'; x.textContent = '×';
    span.appendChild(x);
  }
  return span;
}

// ── Label filter strip ────────────────────────────────────────────────────────

function renderLabelFilterStrip() {
  const strip = document.getElementById('label-filter-strip');
  strip.innerHTML = '';

  const all = [...new Set(songs.flatMap((s) => s.labels || []))].sort();
  if (all.length === 0) return;

  for (const label of all) {
    const p   = labelPalette(label);
    const btn = document.createElement('button');
    btn.className = 'label-filter-chip' + (label === activeLabel ? ' active' : '');
    btn.style.setProperty('--chip-bg',     p.bg);
    btn.style.setProperty('--chip-color',  p.color);
    btn.style.setProperty('--chip-border', p.border);
    btn.textContent = label;
    btn.addEventListener('click', () => {
      activeLabel = activeLabel === label ? null : label;
      renderLabelFilterStrip();
      renderSongList();
    });
    strip.appendChild(btn);
  }
}

// ── Song list ─────────────────────────────────────────────────────────────────

function baseList() {
  if (activeArrId) {
    const arr = arrangements.find((a) => a.id === activeArrId);
    if (arr) {
      const result = [];
      for (const item of getItems(arr)) {
        if (item.type === 'song') {
          const song = songs.find((s) => s.id === item.id);
          if (song) result.push(song);
        } else if (item.type === 'separator') {
          result.push({ _sep: true, label: item.label });
        }
      }
      if (activeLabel) return result.filter((i) => i._sep || (i.labels || []).includes(activeLabel));
      return result;
    }
  }
  let list = songs;
  if (activeLabel) list = list.filter((s) => (s.labels || []).includes(activeLabel));
  return list;
}

async function runSearch(q) {
  const results = await fetch(`/api/search?q=${encodeURIComponent(q)}`).then((r) => r.json());
  // If arr or label filter active, restrict results to that subset
  const base = new Set(baseList().map((s) => s.id));
  return results.filter((r) => base.has(r.id));
}

function renderSongList() {
  const ul = document.getElementById('song-list');
  ul.innerHTML = '';

  const displayList = searchResults !== null ? searchResults : baseList();
  const allEmpty    = songs.length === 0;
  const noResults   = !allEmpty && displayList.length === 0;

  document.getElementById('songs-empty').style.display      = allEmpty  ? '' : 'none';
  document.getElementById('songs-no-results').style.display = noResults ? '' : 'none';

  for (const song of displayList) {
    // Separator divider (only when not in search mode)
    if (song._sep) {
      if (searchResults !== null) continue;
      const li = document.createElement('li');
      li.className = 'song-sep';
      li.textContent = song.label || '—';
      ul.appendChild(li);
      continue;
    }

    const li = document.createElement('li');
    li.className = 'song-card' + (song.id === currentSongId ? ' active' : '');
    li.dataset.id = song.id;

    // Highlight query term in matchContext
    let contextHtml = '';
    if (song.matchType === 'content' && song.matchContext) {
      const esc   = escHtml(song.matchContext);
      const q     = escHtml(searchQuery);
      const hi    = esc.replace(new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), '<mark>$&</mark>');
      contextHtml = `<div class="song-card-context">↳ ${hi}</div>`;
    }

    li.innerHTML = `
      <div class="song-card-body">
        <div class="song-card-title">${escHtml(song.title)}</div>
        ${contextHtml}
        <div class="song-card-labels"></div>
      </div>
      <div class="song-card-actions">
        <button class="card-btn" data-action="edit"   title="Bearbeiten">✎</button>
        <button class="card-btn danger" data-action="delete" title="Löschen">✕</button>
      </div>`;

    // Render label chips
    const labelsEl = li.querySelector('.song-card-labels');
    for (const lbl of (song.labels || [])) labelsEl.appendChild(labelChipEl(lbl));

    li.querySelector('[data-action="edit"]').addEventListener('click', (e) => {
      e.stopPropagation(); openSheet('edit', song.id);
    });
    li.querySelector('[data-action="delete"]').addEventListener('click', (e) => {
      e.stopPropagation(); confirmDeleteSong(li, song.id, song.title);
    });
    li.addEventListener('click', () => send({ type: 'show_song', songId: song.id }));
    ul.appendChild(li);
  }
}

function updateSongHighlight() {
  document.querySelectorAll('.song-card').forEach((el) => {
    el.classList.toggle('active', el.dataset.id === currentSongId);
  });
}

function confirmDeleteSong(li, id, title) {
  // If confirmation is already showing on this card, ignore
  if (li.querySelector('.delete-confirm')) return;

  const actions = li.querySelector('.song-card-actions');
  actions.style.opacity = '1';

  const confirm = document.createElement('div');
  confirm.className = 'delete-confirm';
  confirm.innerHTML = `
    <span class="delete-confirm-label">Löschen?</span>
    <button class="delete-confirm-yes">Ja</button>
    <button class="delete-confirm-no">Nein</button>`;

  confirm.querySelector('.delete-confirm-yes').addEventListener('click', (e) => {
    e.stopPropagation(); deleteSong(id, title);
  });
  confirm.querySelector('.delete-confirm-no').addEventListener('click', (e) => {
    e.stopPropagation(); confirm.remove(); actions.style.opacity = '';
  });

  actions.replaceWith(confirm);
}

async function deleteSong(id, title) {
  await fetch(`/api/songs/${id}`, { method: 'DELETE' });
  if (currentSongId === id) send({ type: 'blank' });
  toast(`„${title}" gelöscht`);
  searchResults = null;
  await loadSongs();
  if (editingArrId) renderArrEditor();
}

// ── Search ────────────────────────────────────────────────────────────────────

let searchDebounce = null;

document.getElementById('search-input').addEventListener('input', (e) => {
  searchQuery = e.target.value.trim();
  clearTimeout(searchDebounce);
  if (!searchQuery) {
    searchResults = null;
    renderSongList();
    return;
  }
  searchDebounce = setTimeout(async () => {
    searchResults = await runSearch(searchQuery);
    renderSongList();
  }, 180);
});

// ── Arrangement banner ────────────────────────────────────────────────────────

function updateArrBanner() {
  const banner = document.getElementById('arr-banner');
  const nameEl = document.getElementById('arr-banner-name');
  if (activeArrId) {
    const arr = arrangements.find((a) => a.id === activeArrId);
    nameEl.textContent = arr ? arr.name : '';
    banner.classList.add('visible');
  } else {
    banner.classList.remove('visible');
  }
}

document.getElementById('arr-banner-clear').addEventListener('click', () => {
  activeArrId = null;
  updateArrBanner();
  renderSongList();
  renderArrangementList();
});

// ── Sheet (Add / Edit song) ───────────────────────────────────────────────────

function sectionsToText(sections) {
  return sections.map((s) => {
    const lines = [];
    if (s.label) lines.push(s.label + ':');
    lines.push(...s.lines);
    return lines.join('\n');
  }).join('\n\n');
}

function renderSheetLabels() {
  const container = document.getElementById('sheet-labels-list');
  container.innerHTML = '';
  for (const lbl of sheetLabels) {
    const chip = labelChipEl(lbl, true);
    chip.addEventListener('click', () => {
      sheetLabels = sheetLabels.filter((l) => l !== lbl);
      renderSheetLabels();
      renderLabelSuggestions();
    });
    container.appendChild(chip);
  }
}

function renderLabelSuggestions() {
  const container = document.getElementById('sheet-label-suggestions');
  container.innerHTML = '';

  const allLabels = [...new Set(songs.flatMap((s) => s.labels || []))].sort();
  const available = allLabels.filter((l) => !sheetLabels.includes(l));
  if (available.length === 0) return;

  const hint = document.createElement('span');
  hint.style.cssText = 'font-size:.7rem;color:var(--text-3);width:100%;margin-bottom:2px;display:block;';
  hint.textContent = 'Vorhandene Labels:';
  container.appendChild(hint);

  for (const lbl of available) {
    const chip = labelChipEl(lbl);
    chip.style.cursor = 'pointer';
    chip.title = 'Hinzufügen';
    chip.addEventListener('click', () => {
      sheetLabels.push(lbl);
      renderSheetLabels();
      renderLabelSuggestions();
    });
    container.appendChild(chip);
  }
}

document.getElementById('sheet-label-add').addEventListener('click', () => {
  const input = document.getElementById('sheet-label-input');
  const val   = input.value.trim();
  if (val && !sheetLabels.includes(val)) {
    sheetLabels.push(val);
    renderSheetLabels();
    renderLabelSuggestions();
  }
  input.value = '';
  input.focus();
});

document.getElementById('sheet-label-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); document.getElementById('sheet-label-add').click(); }
});

async function openSheet(mode, songId = null) {
  editingSongId = mode === 'edit' ? songId : null;
  const titleEl  = document.getElementById('sheet-title-text');
  const nameEl   = document.getElementById('sheet-name');
  const textEl   = document.getElementById('sheet-text');
  const submitEl = document.getElementById('sheet-submit');

  if (mode === 'edit' && songId) {
    titleEl.textContent  = 'Song bearbeiten';
    submitEl.textContent = 'Speichern';
    try {
      const song = await fetch(`/api/songs/${songId}`).then((r) => r.json());
      nameEl.value = song.title;
      textEl.value = sectionsToText(song.sections);
      sheetLabels  = [...(song.labels || [])];
    } catch { toast('Fehler beim Laden', 'error'); return; }
  } else {
    titleEl.textContent  = 'Song hinzufügen';
    submitEl.textContent = 'Hinzufügen';
    nameEl.value = '';
    textEl.value = '';
    sheetLabels  = [];
  }

  renderSheetLabels();
  renderLabelSuggestions();
  document.getElementById('sheet-overlay').classList.add('open');
  setTimeout(() => nameEl.focus(), 250);
}

function closeSheet() {
  document.getElementById('sheet-overlay').classList.remove('open');
  editingSongId = null;
  sheetLabels   = [];
}

document.getElementById('fab').addEventListener('click',          () => openSheet('add'));
document.getElementById('sheet-close').addEventListener('click',  closeSheet);
document.getElementById('sheet-cancel').addEventListener('click', closeSheet);
document.getElementById('sheet-overlay').addEventListener('click', (e) => {
  if (e.target === document.getElementById('sheet-overlay')) closeSheet();
});

document.getElementById('sheet-submit').addEventListener('click', async () => {
  const title   = document.getElementById('sheet-name').value.trim();
  const rawText = document.getElementById('sheet-text').value.trim();
  const btn     = document.getElementById('sheet-submit');

  if (!title) { document.getElementById('sheet-name').focus(); return; }

  btn.disabled = true;
  try {
    if (editingSongId) {
      await fetch(`/api/songs/${editingSongId}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, rawText: rawText || undefined, labels: sheetLabels }),
      });
      toast(`„${title}" gespeichert`, 'success');
    } else {
      if (!rawText) { document.getElementById('sheet-text').focus(); btn.disabled = false; return; }
      await fetch('/api/songs', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, rawText, labels: sheetLabels }),
      });
      toast(`„${title}" hinzugefügt`, 'success');
    }
    closeSheet();
    await loadSongs();
  } catch { toast('Fehler beim Speichern', 'error'); }
  finally { btn.disabled = false; }
});

// ── Arrangements list ─────────────────────────────────────────────────────────

async function loadArrangements() {
  arrangements = await fetch('/api/arrangements').then((r) => r.json());
  document.getElementById('arr-badge').textContent = arrangements.length;
  renderArrangementList();
}

function renderArrangementList() {
  const ul    = document.getElementById('arr-list');
  const empty = document.getElementById('arr-empty');
  ul.innerHTML = '';

  if (arrangements.length === 0) { empty.style.display = ''; return; }
  empty.style.display = 'none';

  for (const arr of arrangements) {
    const isActive = arr.id === activeArrId;
    const count = arr.songIds.length;
    const li = document.createElement('li');
    li.className = 'arr-card' + (isActive ? ' active-arr' : '');
    li.innerHTML = `
      <div class="arr-card-body">
        <div class="arr-card-title">${escHtml(arr.name)}</div>
        <div class="arr-card-meta">${count} ${count === 1 ? 'Song' : 'Songs'}</div>
      </div>
      <div class="arr-card-actions">
        <button class="card-btn" data-action="use"  title="${isActive ? 'Aktiv' : 'Verwenden'}">${isActive ? '✓' : '▶'}</button>
        <button class="card-btn" data-action="edit" title="Bearbeiten">✎</button>
        <button class="card-btn danger" data-action="delete" title="Löschen">✕</button>
      </div>`;

    li.querySelector('[data-action="use"]').addEventListener('click',    () => activateArr(arr.id));
    li.querySelector('[data-action="edit"]').addEventListener('click',   () => openArrEditor(arr.id));
    li.querySelector('[data-action="delete"]').addEventListener('click', () => deleteArr(arr.id, arr.name));
    ul.appendChild(li);
  }
}

function activateArr(id) {
  activeArrId = activeArrId === id ? null : id;
  renderArrangementList();
  renderSongList();
  updateArrBanner();
  if (activeArrId) {
    switchTab('songs');
    const arr = arrangements.find((a) => a.id === activeArrId);
    toast(`Arrangement „${arr.name}" aktiv`, 'success');
  }
}

async function deleteArr(id, name) {
  await fetch(`/api/arrangements/${id}`, { method: 'DELETE' });
  if (activeArrId === id) { activeArrId = null; updateArrBanner(); renderSongList(); }
  toast(`„${name}" gelöscht`);
  await loadArrangements();
}

// ── New arrangement ───────────────────────────────────────────────────────────

document.getElementById('arr-new-btn').addEventListener('click', () => {
  const form = document.getElementById('create-arr-form');
  const open = form.classList.toggle('open');
  if (open) setTimeout(() => document.getElementById('arr-name-input').focus(), 50);
});

document.getElementById('arr-create-btn').addEventListener('click', async () => {
  const input = document.getElementById('arr-name-input');
  const name  = input.value.trim();
  if (!name) { input.focus(); return; }
  const arr = await fetch('/api/arrangements', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, songIds: [] }),
  }).then((r) => r.json());
  input.value = '';
  document.getElementById('create-arr-form').classList.remove('open');
  toast(`„${name}" erstellt`, 'success');
  await loadArrangements();
  openArrEditor(arr.id);
});

document.getElementById('arr-name-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') document.getElementById('arr-create-btn').click();
});

// ── Arrangement editor ────────────────────────────────────────────────────────

function openArrEditor(id) {
  editingArrId = id;
  availSearch  = '';
  document.getElementById('arr-list-view').classList.add('hidden');
  document.getElementById('arr-editor').classList.add('open');
  renderArrEditor();
}

document.getElementById('arr-back').addEventListener('click', () => {
  editingArrId = null;
  document.getElementById('arr-editor').classList.remove('open');
  document.getElementById('arr-list-view').classList.remove('hidden');
  loadArrangements();
});

function renderArrEditor() {
  const arr = arrangements.find((a) => a.id === editingArrId);
  if (!arr) return;

  document.getElementById('arr-editor-name').textContent = arr.name;

  const items = getItems(arr);
  const ul    = document.getElementById('arr-song-list');
  ul.innerHTML = '';

  let songNum = 0;
  items.forEach((item, idx) => {
    const li = document.createElement('li');

    if (item.type === 'separator') {
      li.className = 'arr-sep-row';
      li.innerHTML = `
        <span class="drag-handle">⠿</span>
        <span class="arr-sep-text">${escHtml(item.label || '—')}</span>
        <button class="move-btn" draggable="false" title="Nach oben" ${idx === 0 ? 'disabled' : ''}>▲</button>
        <button class="move-btn" draggable="false" title="Nach unten" ${idx === items.length - 1 ? 'disabled' : ''}>▼</button>
        <button class="card-btn danger" draggable="false" title="Entfernen">✕</button>`;
    } else {
      const song = songs.find((s) => s.id === item.id);
      if (!song) return;
      songNum++;
      li.className = 'arr-song-row';
      li.innerHTML = `
        <span class="drag-handle">⠿</span>
        <span class="arr-song-num">${songNum}</span>
        <span class="arr-song-title">${escHtml(song.title)}</span>
        <button class="move-btn" draggable="false" title="Nach oben" ${idx === 0 ? 'disabled' : ''}>▲</button>
        <button class="move-btn" draggable="false" title="Nach unten" ${idx === items.length - 1 ? 'disabled' : ''}>▼</button>
        <button class="card-btn danger" draggable="false" title="Entfernen">✕</button>`;
    }

    const [upBtn, downBtn, removeBtn] = li.querySelectorAll('button');
    upBtn.addEventListener('click',     () => moveItem(idx, -1));
    downBtn.addEventListener('click',   () => moveItem(idx,  1));
    removeBtn.addEventListener('click', () => removeItem(idx));

    // ── Drag & drop ──────────────────────────────────────────────────────────
    li.draggable = true;

    li.addEventListener('dragstart', (e) => {
      dragSrcIdx = idx;
      e.dataTransfer.effectAllowed = 'move';
      setTimeout(() => li.classList.add('arr-dragging'), 0);
    });

    li.addEventListener('dragend', () => {
      dragSrcIdx = null;
      li.classList.remove('arr-dragging');
      ul.querySelectorAll('li').forEach((el) => el.classList.remove('arr-drop-above', 'arr-drop-below'));
    });

    li.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (dragSrcIdx === idx) return;
      ul.querySelectorAll('li').forEach((el) => el.classList.remove('arr-drop-above', 'arr-drop-below'));
      const { top, height } = li.getBoundingClientRect();
      li.classList.add(e.clientY < top + height / 2 ? 'arr-drop-above' : 'arr-drop-below');
    });

    li.addEventListener('dragleave', (e) => {
      if (!li.contains(e.relatedTarget)) li.classList.remove('arr-drop-above', 'arr-drop-below');
    });

    li.addEventListener('drop', (e) => {
      e.preventDefault();
      li.classList.remove('arr-drop-above', 'arr-drop-below');
      if (dragSrcIdx === null || dragSrcIdx === idx) return;

      const { top, height } = li.getBoundingClientRect();
      let insertAt = e.clientY < top + height / 2 ? idx : idx + 1;
      if (dragSrcIdx < insertAt) insertAt--;
      if (dragSrcIdx === insertAt) return;

      const currentArr = arrangements.find((a) => a.id === editingArrId);
      if (!currentArr) return;
      const its = [...getItems(currentArr)];
      const [moved] = its.splice(dragSrcIdx, 1);
      its.splice(insertAt, 0, moved);
      saveArrItems(its);
    });

    ul.appendChild(li);
  });

  // Restore avail search input value (persists across re-renders)
  document.getElementById('arr-avail-search').value = availSearch;
  renderArrAvailList();
}

function renderArrAvailList() {
  const arr = arrangements.find((a) => a.id === editingArrId);
  if (!arr) return;

  const q      = availSearch.toLowerCase();
  const inArr  = new Set(getArrSongIds(arr));
  const avail  = songs.filter((s) => !inArr.has(s.id) && (!q || s.title.toLowerCase().includes(q)));
  const availUl = document.getElementById('arr-avail-list');
  const noAvail = document.getElementById('arr-avail-empty');
  availUl.innerHTML = '';

  if (avail.length === 0) {
    noAvail.style.display = '';
  } else {
    noAvail.style.display = 'none';
    avail.forEach((song) => {
      const li = document.createElement('li');
      li.className = 'avail-row';
      li.innerHTML = `<span class="avail-title">${escHtml(song.title)}</span>
        <button class="add-btn-small">+ Hinzufügen</button>`;
      li.querySelector('button').addEventListener('click', () => addArrSong(song.id));
      availUl.appendChild(li);
    });
  }
}

async function saveArrItems(items) {
  const arr = arrangements.find((a) => a.id === editingArrId);
  if (!arr) return;
  arr.items   = items;
  arr.songIds = items.filter((i) => i.type === 'song').map((i) => i.id);
  await fetch(`/api/arrangements/${arr.id}`, {
    method: 'PUT', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items: arr.items, songIds: arr.songIds }),
  });
  if (activeArrId === arr.id) renderSongList();
  renderArrEditor();
}

async function moveItem(idx, dir) {
  const arr = arrangements.find((a) => a.id === editingArrId);
  if (!arr) return;
  const items = [...getItems(arr)];
  const [item] = items.splice(idx, 1);
  items.splice(idx + dir, 0, item);
  await saveArrItems(items);
}

async function removeItem(idx) {
  const arr = arrangements.find((a) => a.id === editingArrId);
  if (!arr) return;
  const items = [...getItems(arr)];
  items.splice(idx, 1);
  await saveArrItems(items);
}

async function addArrSong(songId) {
  const arr = arrangements.find((a) => a.id === editingArrId);
  if (!arr) return;
  await saveArrItems([...getItems(arr), { type: 'song', id: songId }]);
}

async function addSeparator(label) {
  const arr = arrangements.find((a) => a.id === editingArrId);
  if (!arr) return;
  await saveArrItems([...getItems(arr), { type: 'separator', label }]);
}

// ── Song preview panel ────────────────────────────────────────────────────────

async function updateSongPreview() {
  const empty   = document.getElementById('preview-empty');
  const content = document.getElementById('preview-content');

  if (!currentSongId) {
    empty.style.display   = '';
    content.style.display = 'none';
    return;
  }

  try {
    const song = await fetch(`/api/songs/${currentSongId}`).then((r) => r.json());
    document.getElementById('preview-song-title').textContent = song.title;

    const sectionsEl = document.getElementById('preview-sections');
    sectionsEl.innerHTML = '';
    for (const section of song.sections) {
      const div = document.createElement('div');
      div.className = 'preview-section';
      if (section.label) {
        const lbl = document.createElement('span');
        lbl.className = 'preview-section-label';
        lbl.textContent = section.label;
        div.appendChild(lbl);
      }
      for (const line of section.lines) {
        const p = document.createElement('p');
        p.className = 'preview-line';
        p.textContent = line;
        div.appendChild(p);
      }
      sectionsEl.appendChild(div);
    }

    empty.style.display   = 'none';
    content.style.display = '';
  } catch {
    empty.style.display   = '';
    content.style.display = 'none';
  }
}

// ── Utility ───────────────────────────────────────────────────────────────────

function escHtml(str) {
  return str.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ── Arrangement editor event listeners ───────────────────────────────────────

document.getElementById('arr-sep-btn').addEventListener('click', () => {
  const input = document.getElementById('arr-sep-input');
  const label = input.value.trim();
  if (!label) { input.focus(); return; }
  addSeparator(label);
  input.value = '';
});

document.getElementById('arr-sep-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') { e.preventDefault(); document.getElementById('arr-sep-btn').click(); }
});

document.getElementById('arr-avail-search').addEventListener('input', (e) => {
  availSearch = e.target.value;
  renderArrAvailList();
});

// ── Init ──────────────────────────────────────────────────────────────────────

connectWS();
loadMonitors();
Promise.all([loadSongs(), loadArrangements()]);
