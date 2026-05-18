const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const PORT = 3000;
const SONGS_DIR = path.join(__dirname, 'songs');
const ARR_DIR = path.join(__dirname, 'arrangements');

if (!fs.existsSync(SONGS_DIR)) fs.mkdirSync(SONGS_DIR);
if (!fs.existsSync(ARR_DIR)) fs.mkdirSync(ARR_DIR);

// ── Helpers ──────────────────────────────────────────────────────────────────

function getLocalIP() {
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const iface of ifaces) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return 'localhost';
}

function slugify(str) {
  return str
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function uniqueId(dir, title) {
  let base = slugify(title) || 'item';
  let id = base;
  let n = 1;
  while (fs.existsSync(path.join(dir, `${id}.json`))) id = `${base}-${n++}`;
  return id;
}

// ── Section parser ────────────────────────────────────────────────────────────

const SECTION_HEADER =
  /^(strophe|vers|verse|refrain|chorus|bridge|intro|outro|pre-chorus|vorkehrus|tag|coda|interlude|schluss)[\s\d]*:?$/i;

// ChordPro {directive} or {directive: value}
const CHORDPRO_DIRECTIVE = /^\{([^:}]+)(?::([^}]*))?\}$/;

const CHORDPRO_SECTION_START = {
  'start_of_chorus': 'Chorus', 'soc': 'Chorus',
  'start_of_verse':  'Verse',  'sov': 'Verse',
  'start_of_bridge': 'Bridge', 'sob': 'Bridge',
  'start_of_intro':  'Intro',
  'start_of_outro':  'Outro',
  'start_of_tab':    'Tab',    'sot': 'Tab',
  'start_of_grid':   'Grid',   'sog': 'Grid',
};

const CHORDPRO_SECTION_END =
  /^end_of_|^eoc$|^eov$|^eob$|^eot$|^eog$/;

// Directives that carry no lyric content and should be silently skipped
const CHORDPRO_META =
  /^(album|time|duration|composer|lyricist|copyright|footer|columns|col|pagetype|new_page|np|new_physical_page|npp|comment_box|cb|textfont|textsize|chordfont|chordsize|diagrams|no_grid|ng|grid|g|define|chord)$/;

// Directives that are extracted as song metadata
const CHORDPRO_META_EXTRACT =
  /^(title|t|subtitle|st|artist|key|capo|tempo)$/;

function stripChords(str) {
  return str.replace(/\[[^\]]*\]/g, '').replace(/  +/g, ' ').trim();
}

function pushSection(sections, sec) {
  while (sec.lines.length && sec.lines[sec.lines.length - 1] === '') sec.lines.pop();
  if (sec.lines.length > 0) sections.push(sec);
}

function parseRawText(rawText) {
  const lines = rawText.split(/\r?\n/);
  const sections = [];
  const meta = { title: '', subtitle: '', artist: '', key: '', capo: 0, tempo: null };
  let current = null;
  let prevBlank = true;

  for (const rawLine of lines) {
    const raw = rawLine.trim();
    if (!raw) {
      if (current) {
        if (current.label && current.lines.length > 0) {
          // Named section: keep open across blank lines, mark gap
          if (current.lines[current.lines.length - 1] !== '') current.lines.push('');
        } else if (current.lines.length > 0) {
          sections.push(current);
          current = null;
        }
      }
      prevBlank = true;
      continue;
    }

    // ── ChordPro directives ────────────────────────────────────────────────────
    const dm = raw.match(CHORDPRO_DIRECTIVE);
    if (dm) {
      const dir = dm[1].trim().toLowerCase();
      const val = (dm[2] || '').trim();

      if (CHORDPRO_SECTION_START[dir] !== undefined) {
        if (current) pushSection(sections, current);
        // use explicit label from directive if provided, e.g. {start_of_verse: Strophe 2}
        current = { label: val || CHORDPRO_SECTION_START[dir], lines: [] };
        prevBlank = false;
        continue;
      }
      if (CHORDPRO_SECTION_END.test(dir)) {
        if (current) { pushSection(sections, current); current = null; }
        prevBlank = true;
        continue;
      }
      if (dir === 'comment' || dir === 'c' || dir === 'comment_italic' || dir === 'ci') {
        // treat as an inline label / section heading
        if (val) {
          if (current) pushSection(sections, current);
          current = { label: val, lines: [] };
          prevBlank = false;
        }
        continue;
      }
      if (dir === 'chorus') {
        // {chorus} repeat marker — skip silently
        continue;
      }
      if (CHORDPRO_META_EXTRACT.test(dir)) {
        // extract known metadata directives
        if (dir === 'title' || dir === 't') { if (val) meta.title = val; }
        else if (dir === 'subtitle' || dir === 'st') { if (val) meta.subtitle = val; }
        else if (dir === 'artist') { if (val) meta.artist = val; }
        else if (dir === 'key') { if (val) meta.key = val; }
        else if (dir === 'capo') { const n = parseInt(val, 10); if (!isNaN(n)) meta.capo = n; }
        else if (dir === 'tempo') { const n = parseInt(val, 10); if (!isNaN(n)) meta.tempo = n; }
        continue;
      }
      if (CHORDPRO_META.test(dir)) {
        continue; // silently drop metadata directives
      }
      continue; // unknown directive — skip
    }

    // ── Plain-text section headers ─────────────────────────────────────────────
    const stripped = stripChords(raw);
    if (!stripped) { prevBlank = false; continue; } // chord-only line
    const isHeader = SECTION_HEADER.test(stripped) || (prevBlank && stripped.endsWith(':') && stripped.length < 40);
    prevBlank = false;
    if (isHeader) {
      if (current) pushSection(sections, current);
      current = { label: stripped.replace(/:$/, '').trim(), lines: [] };
    } else {
      if (!current) current = { label: '', lines: [] };
      current.lines.push(raw); // preserve original with chord markers
    }
  }
  if (current) pushSection(sections, current);
  return { sections, meta };
}

// ── Monitor detection ─────────────────────────────────────────────────────────

function getMonitors() {
  if (process.platform !== 'win32') return null;
  try {
    const ps = `Add-Type -AssemblyName System.Windows.Forms;$screens=[System.Windows.Forms.Screen]::AllScreens;$result=$screens|ForEach-Object{[PSCustomObject]@{name=$_.DeviceName -replace '\\\\.\\\\','';x=$_.Bounds.X;y=$_.Bounds.Y;width=$_.Bounds.Width;height=$_.Bounds.Height;primary=$_.Primary}};$result|ConvertTo-Json -Compress`;
    const output = execSync(`powershell -NoProfile -NonInteractive -Command "${ps}"`, { timeout: 5000 }).toString().trim();
    const parsed = JSON.parse(output);
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch { return null; }
}

// ── Express app ───────────────────────────────────────────────────────────────

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (_req, res) => res.redirect('/controller'));
app.get('/controller', (_req, res) => res.sendFile(path.join(__dirname, 'public', 'controller.html')));
app.get('/display',  (_req, res) => res.sendFile(path.join(__dirname, 'public', 'display.html')));
app.get('/chords',   (_req, res) => res.sendFile(path.join(__dirname, 'public', 'display.html')));

// ── Songs API ─────────────────────────────────────────────────────────────────

function songSummary(s) {
  return { id: s.id, title: s.title, sectionCount: s.sections ? s.sections.length : 0, labels: s.labels || [], key: s.key || '', playKey: s.playKey || '' };
}

function loadAllSongs() {
  return fs.readdirSync(SONGS_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => { try { return JSON.parse(fs.readFileSync(path.join(SONGS_DIR, f), 'utf8')); } catch { return null; } })
    .filter(Boolean)
    .sort((a, b) => a.title.localeCompare(b.title, 'de'));
}

app.get('/api/songs', (_req, res) => {
  res.json(loadAllSongs().map(songSummary));
});

// GET /api/search?q=term — full-text search (title → label → lyrics)
app.get('/api/search', (req, res) => {
  const q = (req.query.q || '').toLowerCase().trim();
  if (!q) return res.json([]);

  const titleHits = [], labelHits = [], contentHits = [];

  for (const song of loadAllSongs()) {
    if (song.title.toLowerCase().includes(q)) {
      titleHits.push({ ...songSummary(song), matchType: 'title' });
      continue;
    }
    if ((song.labels || []).some((l) => l.toLowerCase().includes(q))) {
      labelHits.push({ ...songSummary(song), matchType: 'label' });
      continue;
    }
    for (const section of (song.sections || [])) {
      const hit = section.lines.find((l) => stripChords(l).toLowerCase().includes(q));
      if (hit) {
        contentHits.push({ ...songSummary(song), matchType: 'content', matchContext: hit });
        break;
      }
    }
  }

  res.json([...titleHits, ...labelHits, ...contentHits]);
});

app.get('/api/songs/:id', (req, res) => {
  const file = path.join(SONGS_DIR, `${req.params.id}.json`);
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'Not found' });
  res.json(JSON.parse(fs.readFileSync(file, 'utf8')));
});

app.post('/api/songs', (req, res) => {
  const { title, rawText, labels, artist, subtitle, key, capo, tempo, playKey } = req.body;
  if (!title || !rawText) return res.status(400).json({ error: 'title and rawText required' });
  const id = uniqueId(SONGS_DIR, title);
  const { sections, meta } = parseRawText(rawText);
  const song = {
    id,
    title,
    subtitle: subtitle !== undefined ? subtitle : (meta.subtitle || ''),
    artist:   artist   !== undefined ? artist   : (meta.artist   || ''),
    key:      key      !== undefined ? key      : (meta.key      || ''),
    capo:     capo     !== undefined ? (parseInt(capo, 10) || 0) : meta.capo,
    tempo:    tempo    !== undefined ? (parseInt(tempo, 10) || null) : meta.tempo,
    playKey:  playKey || key || meta.key || '',
    labels: labels || [],
    rawText,
    sections,
  };
  fs.writeFileSync(path.join(SONGS_DIR, `${id}.json`), JSON.stringify(song, null, 2));
  res.status(201).json(song);
});

app.put('/api/songs/:id', (req, res) => {
  const file = path.join(SONGS_DIR, `${req.params.id}.json`);
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'Not found' });
  const existing = JSON.parse(fs.readFileSync(file, 'utf8'));
  const { title, rawText, labels, artist, subtitle, key, capo, tempo, playKey } = req.body;
  let sections = existing.sections;
  let meta = { subtitle: '', artist: '', key: '', capo: 0, tempo: null };
  const effectiveRawText = rawText !== undefined ? rawText : existing.rawText;
  if (rawText) { const parsed = parseRawText(rawText); sections = parsed.sections; meta = parsed.meta; }
  const updated = {
    ...existing,
    title:    title    !== undefined ? title    : existing.title,
    subtitle: subtitle !== undefined ? subtitle : (existing.subtitle !== undefined ? existing.subtitle : meta.subtitle),
    artist:   artist   !== undefined ? artist   : (existing.artist   !== undefined ? existing.artist   : meta.artist),
    key:      key      !== undefined ? key      : (existing.key      !== undefined ? existing.key      : meta.key),
    capo:     capo     !== undefined ? (parseInt(capo, 10) || 0)      : (existing.capo  !== undefined ? existing.capo  : meta.capo),
    tempo:    tempo    !== undefined ? (parseInt(tempo, 10) || null)  : (existing.tempo !== undefined ? existing.tempo : meta.tempo),
    playKey:  playKey  !== undefined ? playKey  : (existing.playKey || ''),
    rawText:  effectiveRawText,
    sections,
    labels: labels !== undefined ? labels : (existing.labels || []),
  };
  fs.writeFileSync(file, JSON.stringify(updated, null, 2));
  res.json(updated);
});

app.delete('/api/songs/:id', (req, res) => {
  const file = path.join(SONGS_DIR, `${req.params.id}.json`);
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'Not found' });
  fs.unlinkSync(file);
  res.json({ ok: true });
});

// ── Arrangements API ──────────────────────────────────────────────────────────

app.get('/api/arrangements', (_req, res) => {
  const list = fs.readdirSync(ARR_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => { try { const a = JSON.parse(fs.readFileSync(path.join(ARR_DIR, f), 'utf8')); return { id: a.id, name: a.name, songIds: a.songIds, items: a.items }; } catch { return null; } })
    .filter(Boolean)
    .sort((a, b) => a.name.localeCompare(b.name, 'de'));
  res.json(list);
});

app.get('/api/arrangements/:id', (req, res) => {
  const file = path.join(ARR_DIR, `${req.params.id}.json`);
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'Not found' });
  res.json(JSON.parse(fs.readFileSync(file, 'utf8')));
});

app.post('/api/arrangements', (req, res) => {
  const { name, songIds } = req.body;
  if (!name) return res.status(400).json({ error: 'name required' });
  const id = uniqueId(ARR_DIR, name);
  const arr = { id, name, songIds: songIds || [] };
  fs.writeFileSync(path.join(ARR_DIR, `${id}.json`), JSON.stringify(arr, null, 2));
  res.status(201).json(arr);
});

app.put('/api/arrangements/:id', (req, res) => {
  const file = path.join(ARR_DIR, `${req.params.id}.json`);
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'Not found' });
  const existing = JSON.parse(fs.readFileSync(file, 'utf8'));
  const updated = { ...existing, ...req.body, id: existing.id };
  fs.writeFileSync(file, JSON.stringify(updated, null, 2));
  res.json(updated);
});

app.delete('/api/arrangements/:id', (req, res) => {
  const file = path.join(ARR_DIR, `${req.params.id}.json`);
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'Not found' });
  fs.unlinkSync(file);
  res.json({ ok: true });
});

// GET /api/monitors
app.get('/api/monitors', (_req, res) => res.json(getMonitors()));

// ── WebSocket ─────────────────────────────────────────────────────────────────

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });
const clients = new Set();
let currentState = { type: 'blank' };

wss.on('connection', (ws) => {
  clients.add(ws);
  ws.send(JSON.stringify(currentState));
  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw);
      if (msg.type === 'show_song' && msg.songId) {
        currentState = { type: 'song', songId: msg.songId, playKey: msg.playKey || null, capo: msg.capo ?? null };
        broadcast(currentState);
      } else if (msg.type === 'blank') {
        currentState = { type: 'blank' };
        broadcast(currentState);
      }
    } catch { /* ignore */ }
  });
  ws.on('close', () => clients.delete(ws));
  ws.on('error', () => clients.delete(ws));
});

function broadcast(message) {
  const data = JSON.stringify(message);
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN) client.send(data);
  }
}

// ── Start ─────────────────────────────────────────────────────────────────────

server.listen(PORT, () => {
  const ip = getLocalIP();
  console.log('');
  console.log('  ╔══════════════════════════════════════╗');
  console.log('  ║          Erscheint läuft             ║');
  console.log('  ╠══════════════════════════════════════╣');
  console.log(`  ║  Display:    http://localhost:${PORT}/display`);
  console.log(`  ║  Controller: http://${ip}:${PORT}/controller`);
  console.log('  ╚══════════════════════════════════════╝');
  console.log('');
  console.log('  Zum Beenden: Strg+C');
  console.log('');
});
