const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const PORT = 3000;
const SONGS_DIR = path.join(__dirname, 'songs');

// Ensure songs directory exists
if (!fs.existsSync(SONGS_DIR)) fs.mkdirSync(SONGS_DIR);

// ── Helpers ──────────────────────────────────────────────────────────────────

function getLocalIP() {
  for (const ifaces of Object.values(os.networkInterfaces())) {
    for (const iface of ifaces) {
      if (iface.family === 'IPv4' && !iface.internal) return iface.address;
    }
  }
  return 'localhost';
}

function slugify(title) {
  return title
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function uniqueId(title) {
  let base = slugify(title) || 'song';
  let id = base;
  let n = 1;
  while (fs.existsSync(path.join(SONGS_DIR, `${id}.json`))) {
    id = `${base}-${n++}`;
  }
  return id;
}

// ── Section parser ────────────────────────────────────────────────────────────

const SECTION_HEADER =
  /^(strophe|vers|verse|refrain|chorus|bridge|intro|outro|pre-chorus|vorkehrus|tag|coda|interlude)[\s\d]*:?$/i;

function parseRawText(rawText) {
  const lines = rawText.split(/\r?\n/);
  const sections = [];
  let current = null;

  for (const rawLine of lines) {
    const line = rawLine.trim();

    if (!line) {
      if (current && current.lines.length > 0) {
        sections.push(current);
        current = null;
      }
      continue;
    }

    const isHeader =
      SECTION_HEADER.test(line) || (line.endsWith(':') && line.length < 40);

    if (isHeader) {
      if (current && current.lines.length > 0) sections.push(current);
      current = { label: line.replace(/:$/, '').trim(), lines: [] };
    } else {
      if (!current) current = { label: '', lines: [] };
      current.lines.push(line);
    }
  }

  if (current && current.lines.length > 0) sections.push(current);
  return sections;
}

// ── Monitor detection ─────────────────────────────────────────────────────────

function getMonitors() {
  if (process.platform !== 'win32') return null;
  try {
    const ps = `
Add-Type -AssemblyName System.Windows.Forms;
$screens = [System.Windows.Forms.Screen]::AllScreens;
$result = $screens | ForEach-Object {
  [PSCustomObject]@{
    name    = $_.DeviceName -replace '\\\\.\\\\', '';
    x       = $_.Bounds.X;
    y       = $_.Bounds.Y;
    width   = $_.Bounds.Width;
    height  = $_.Bounds.Height;
    primary = $_.Primary
  }
};
$result | ConvertTo-Json -Compress
`.trim();
    const output = execSync(
      `powershell -NoProfile -NonInteractive -Command "${ps.replace(/"/g, '\\"')}"`,
      { timeout: 5000 }
    ).toString().trim();
    const parsed = JSON.parse(output);
    // PowerShell returns an object (not array) when there's only one monitor
    return Array.isArray(parsed) ? parsed : [parsed];
  } catch {
    return null;
  }
}

// ── Express app ───────────────────────────────────────────────────────────────

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// GET /api/songs — list of {id, title}
app.get('/api/songs', (_req, res) => {
  const songs = fs
    .readdirSync(SONGS_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      try {
        const song = JSON.parse(fs.readFileSync(path.join(SONGS_DIR, f), 'utf8'));
        return { id: song.id, title: song.title };
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => a.title.localeCompare(b.title, 'de'));
  res.json(songs);
});

// GET /api/songs/:id — full song
app.get('/api/songs/:id', (req, res) => {
  const file = path.join(SONGS_DIR, `${req.params.id}.json`);
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'Not found' });
  res.json(JSON.parse(fs.readFileSync(file, 'utf8')));
});

// POST /api/songs — {title, rawText}
app.post('/api/songs', (req, res) => {
  const { title, rawText } = req.body;
  if (!title || !rawText) return res.status(400).json({ error: 'title and rawText required' });
  const id = uniqueId(title);
  const song = { id, title, sections: parseRawText(rawText) };
  fs.writeFileSync(path.join(SONGS_DIR, `${id}.json`), JSON.stringify(song, null, 2));
  res.status(201).json(song);
});

// DELETE /api/songs/:id
app.delete('/api/songs/:id', (req, res) => {
  const file = path.join(SONGS_DIR, `${req.params.id}.json`);
  if (!fs.existsSync(file)) return res.status(404).json({ error: 'Not found' });
  fs.unlinkSync(file);
  res.json({ ok: true });
});

// GET /api/monitors
app.get('/api/monitors', (_req, res) => {
  const monitors = getMonitors();
  res.json(monitors);
});

// ── HTTP + WebSocket server ───────────────────────────────────────────────────

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const clients = new Set();
let currentState = { type: 'blank' };

wss.on('connection', (ws) => {
  clients.add(ws);
  // Sync new client to current state
  ws.send(JSON.stringify(currentState));

  ws.on('message', (raw) => {
    try {
      const msg = JSON.parse(raw);
      if (msg.type === 'show_song' && msg.songId) {
        currentState = { type: 'song', songId: msg.songId };
        broadcast(currentState);
      } else if (msg.type === 'blank') {
        currentState = { type: 'blank' };
        broadcast(currentState);
      }
    } catch { /* ignore malformed messages */ }
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
