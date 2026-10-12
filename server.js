// ============================================================
// server.js - NECROVANTA:3030 multiplayer server.
//
// Serves the game to browsers and runs the online lobby: public
// rooms anyone can join and private rooms that need a password.
// The player who creates a room is its host: their browser runs
// the world (zombies, waves, loot) and this server just relays
// messages between the players in each room.
//
//   npm run deploy              start it and open the game in your browser
//   npm run online              same, plus a public link friends anywhere can use
//                               (needs Cloudflare's free tool: brew install cloudflared)
//   node server.js              just start it, then open http://localhost:3030
//   PORT=4000 npm run deploy    use another port
//   BROWSER=none npm run deploy start without opening a browser
//
// Plain Node.js 18+ - nothing to install (npm install is instant).
// ============================================================
'use strict';
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const { exec, execSync, spawn } = require('child_process');

const PORT = Number(process.env.PORT) || 3030;
const HOST = process.env.HOST || '0.0.0.0';   // all network interfaces, so friends on your network can join
const ROOT = __dirname;
const MAX_MSG = 2 * 1024 * 1024;               // largest message accepted from a browser
const MAX_ROOMS = 100;
const MAX_PLAYERS = 4;
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.md': 'text/plain; charset=utf-8', '.png': 'image/png', '.ico': 'image/x-icon',
};

// ---------------------------------------------------------- game files
const server = http.createServer((req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return; }
  let rel;
  try { rel = decodeURIComponent(new URL(req.url, 'http://local').pathname); } catch (e) { res.writeHead(400); res.end(); return; }
  if (rel === '/') rel = '/index.html';
  const file = path.normalize(path.join(ROOT, rel));
  const ext = path.extname(file).toLowerCase();
  // Only files inside the game folder, no hidden files, only known file types.
  if (!file.startsWith(ROOT + path.sep) || file.split(path.sep).some(part => part.startsWith('.')) || !MIME[ext]) {
    res.writeHead(404); res.end('Not found'); return;
  }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[ext], 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
    res.end(req.method === 'HEAD' ? undefined : data);
  });
});

// ---------------------------------------------------------- websockets (RFC 6455, text frames)
server.on('upgrade', (req, socket) => {
  let pathname = '';
  try { pathname = new URL(req.url, 'http://local').pathname; } catch (e) { /* bad url */ }
  const key = req.headers['sec-websocket-key'];
  if (pathname !== '/ws' || String(req.headers.upgrade).toLowerCase() !== 'websocket' || !key) { socket.destroy(); return; }
  const accept = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
  socket.setNoDelay(true);
  new Client(socket);
});

let nextId = 1;
const clients = new Set();
const rooms = new Map();

class Client {
  constructor(socket) {
    this.id = 'p' + (nextId++);
    this.socket = socket;
    this.buf = Buffer.alloc(0);
    this.frags = [];
    this.name = 'SURVIVOR';
    this.room = null;
    this.alive = true;
    this.fails = [];      // times of wrong password attempts
    clients.add(this);
    socket.on('data', d => this.onData(d));
    socket.on('close', () => this.drop());
    socket.on('error', () => this.drop());
    this.send({ t: 'welcome', id: this.id });
  }

  onData(d) {
    this.buf = this.buf.length ? Buffer.concat([this.buf, d]) : d;
    if (this.buf.length > MAX_MSG + 16) { this.close(); return; }
    for (;;) {
      if (this.buf.length < 2) return;
      const b0 = this.buf[0], b1 = this.buf[1], fin = b0 & 0x80, op = b0 & 0x0f;
      let len = b1 & 0x7f, off = 2;
      if (len === 126) { if (this.buf.length < 4) return; len = this.buf.readUInt16BE(2); off = 4; }
      else if (len === 127) {
        if (this.buf.length < 10) return;
        if (this.buf.readUInt32BE(2) !== 0) { this.close(); return; }
        len = this.buf.readUInt32BE(6); off = 10;
      }
      if (!(b1 & 0x80) || len > MAX_MSG) { this.close(); return; }   // browsers always mask
      if (this.buf.length < off + 4 + len) return;
      const mask = this.buf.subarray(off, off + 4);
      const data = Buffer.from(this.buf.subarray(off + 4, off + 4 + len));
      for (let i = 0; i < len; i++) data[i] ^= mask[i & 3];
      this.buf = this.buf.subarray(off + 4 + len);
      if (op === 8) { this.close(); return; }
      if (op === 9) { this.frame(10, data); continue; }
      if (op === 10) { this.alive = true; continue; }
      if (op !== 1 && op !== 0) continue;   // binary frames are ignored
      this.frags.push(data);
      if (this.frags.reduce((n, f) => n + f.length, 0) > MAX_MSG) { this.close(); return; }
      if (!fin) continue;
      const text = Buffer.concat(this.frags).toString('utf8');
      this.frags = [];
      let msg;
      try { msg = JSON.parse(text); } catch (e) { continue; }
      if (msg && typeof msg === 'object') {
        try { this.handle(msg); } catch (e) { console.error('message error', e); }
      }
    }
  }

  frame(op, payload) {
    if (this.socket.destroyed) return;
    const len = payload.length;
    let head;
    if (len < 126) head = Buffer.from([0x80 | op, len]);
    else if (len < 65536) { head = Buffer.alloc(4); head[0] = 0x80 | op; head[1] = 126; head.writeUInt16BE(len, 2); }
    else { head = Buffer.alloc(10); head[0] = 0x80 | op; head[1] = 127; head.writeUInt32BE(0, 2); head.writeUInt32BE(len, 6); }
    this.socket.write(Buffer.concat([head, payload]));
  }

  send(obj) { this.sendText(JSON.stringify(obj)); }
  sendText(text) { this.frame(1, Buffer.from(text, 'utf8')); }
  backlog() { return this.socket.writableLength; }

  close() {
    try { this.frame(8, Buffer.alloc(0)); } catch (e) { /* already gone */ }
    this.socket.end();
    this.drop();
  }

  drop() {
    if (!clients.has(this)) return;
    clients.delete(this);
    leaveRoom(this);
    this.socket.destroy();
  }

  handle(m) {
    switch (m.t) {
      case 'hello': this.name = cleanText(m.name, 'SURVIVOR', 12); break;
      case 'list': this.send({ t: 'rooms', rooms: roomList() }); break;
      case 'create': createRoom(this, m); break;
      case 'join': joinRoom(this, m); break;
      case 'leave': leaveRoom(this); this.send({ t: 'left' }); break;
      case 'start': {
        const r = this.room;
        if (r && r.host === this && !r.started) { r.started = true; for (const p of r.players) p.send({ t: 'started' }); }
        break;
      }
      case 'info': if (this.room && this.room.host === this) this.room.wave = Math.max(0, Math.min(999, Number(m.wave) | 0)); break;
      case 'to': relay(this, m); break;
    }
  }
}

// Names shown in the game: capitals, digits and a few symbols the pixel font has.
function cleanText(v, fallback, max) {
  const s = String(v == null ? '' : v).toUpperCase().replace(/[^A-Z0-9 .!?:-]/g, '').replace(/\s+/g, ' ').trim().slice(0, max);
  return s || fallback;
}

function hashPass(pass, salt) { return crypto.scryptSync(pass, salt, 32); }

function roomInfo(r) {
  return { id: r.id, name: r.name, priv: r.priv, max: r.max, host: r.host.id, started: r.started, wave: r.wave,
    players: r.players.map(p => ({ id: p.id, name: p.name })) };
}

function roomList() {
  return [...rooms.values()].map(r => ({ id: r.id, name: r.name, priv: r.priv, max: r.max, count: r.players.length,
    started: r.started, wave: r.wave, host: r.host.name }));
}

function createRoom(c, m) {
  leaveRoom(c);
  if (rooms.size >= MAX_ROOMS) { c.send({ t: 'err', msg: 'SERVER FULL - TOO MANY ROOMS' }); return; }
  const priv = !!m.priv, pass = typeof m.pass === 'string' ? m.pass.slice(0, 32) : '';
  if (priv && pass.length < 3) { c.send({ t: 'err', msg: 'PRIVATE ROOMS NEED A PASSWORD (3+ CHARACTERS)' }); return; }
  const salt = crypto.randomBytes(16);
  const r = {
    id: crypto.randomBytes(4).toString('hex'), name: cleanText(m.name, c.name + ' ROOM', 20), priv,
    salt, hash: priv ? hashPass(pass, salt) : null,
    max: Math.max(2, Math.min(MAX_PLAYERS, Number(m.max) | 0 || MAX_PLAYERS)),
    host: c, players: [c], started: false, wave: 0,
  };
  rooms.set(r.id, r);
  c.room = r;
  c.send({ t: 'joined', room: roomInfo(r) });
}

function joinRoom(c, m) {
  const r = rooms.get(String(m.room));
  if (!r) { c.send({ t: 'err', msg: 'ROOM NOT FOUND' }); return; }
  if (r === c.room) return;
  if (r.players.length >= r.max) { c.send({ t: 'err', msg: 'ROOM IS FULL' }); return; }
  if (r.priv) {
    const now = Date.now();
    c.fails = c.fails.filter(t => now - t < 60000);
    if (c.fails.length >= 5) { c.send({ t: 'err', msg: 'TOO MANY WRONG PASSWORDS - TRY AGAIN IN A MINUTE' }); return; }
    const given = hashPass(typeof m.pass === 'string' ? m.pass.slice(0, 32) : '', r.salt);
    if (!crypto.timingSafeEqual(given, r.hash)) { c.fails.push(now); c.send({ t: 'err', msg: 'WRONG PASSWORD' }); return; }
  }
  leaveRoom(c);
  r.players.push(c);
  c.room = r;
  c.send({ t: 'joined', room: roomInfo(r) });
  for (const p of r.players) if (p !== c) p.send({ t: 'room', room: roomInfo(r) });
  if (r.started) {   // joining a game in progress
    r.host.send({ t: 'peer', id: c.id, name: c.name, join: 1 });
    c.send({ t: 'started', late: 1 });
  }
}

function leaveRoom(c) {
  const r = c.room;
  if (!r) return;
  c.room = null;
  r.players = r.players.filter(p => p !== c);
  if (r.host === c || !r.players.length) {   // the host left: the room closes
    rooms.delete(r.id);
    for (const p of r.players) { p.room = null; p.send({ t: 'closed', reason: 'THE HOST LEFT THE ROOM' }); }
    return;
  }
  for (const p of r.players) p.send({ t: 'room', room: roomInfo(r) });
  r.host.send({ t: 'peer', id: c.id, name: c.name, leave: 1 });
}

// Guests can only talk to their host; the host talks to everyone or to one guest.
function relay(c, m) {
  const r = c.room;
  if (!r) return;
  const text = JSON.stringify({ t: 'msg', from: c.id, d: m.d });
  if (r.host !== c) { r.host.sendText(text); return; }
  for (const p of r.players) {
    if (p === c || (m.to !== 'all' && m.to !== p.id)) continue;
    if (m.lossy && p.backlog() > 1024 * 1024) continue;   // skip a world update for a guest on a slow connection
    p.sendText(text);
  }
}

// Drop connections that stop answering pings.
setInterval(() => {
  for (const c of clients) {
    if (!c.alive) { c.close(); continue; }
    c.alive = false;
    c.frame(9, Buffer.alloc(0));
  }
}, 20000);

const LOCAL_URL = `http://localhost:${PORT}`;
const WANT_OPEN = process.argv.includes('--open') && String(process.env.BROWSER).toLowerCase() !== 'none';
const WANT_ONLINE = process.argv.includes('--online');

// This computer's network name (e.g. Stanleys-MacBook-Air.local): devices on the
// same Wi-Fi can use it instead of an IP address.
function localName() {
  let name = '';
  if (process.platform === 'darwin') { try { name = execSync('scutil --get LocalHostName', { encoding: 'utf8' }).trim(); } catch (e) { /* fall back */ } }
  if (!name) name = os.hostname();
  if (!name || name === 'localhost') return '';
  return name.endsWith('.local') ? name : name.split('.')[0] + '.local';
}

// npm run online: a free Cloudflare quick tunnel gives this server a public https link.
function startTunnel() {
  const child = spawn('cloudflared', ['tunnel', '--no-autoupdate', '--url', `http://localhost:${PORT}`], { stdio: ['ignore', 'pipe', 'pipe'] });
  let shown = false;
  const look = d => {
    const m = String(d).match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
    if (!m || shown) return;
    shown = true;
    console.log('');
    console.log('  ================================================================');
    console.log('   PLAY ONLINE - send this link to your friends:');
    console.log(`   ${m[0]}`);
    console.log('   (it works from any network; it changes each time you start)');
    console.log('  ================================================================');
    console.log('');
  };
  child.stdout.on('data', look);
  child.stderr.on('data', look);
  child.on('error', err => {
    if (err.code !== 'ENOENT') { console.log('Could not start the public link:', err.message); return; }
    console.log('');
    console.log('To get a public link for friends on other networks, install Cloudflare\'s free tunnel tool once:');
    console.log('  Mac:      brew install cloudflared');
    console.log('  Windows:  winget install --id Cloudflare.cloudflared');
    console.log('  Linux:    see https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/');
    console.log('then run  npm run online  again. (The game still works on this computer and your Wi-Fi meanwhile.)');
  });
  child.on('exit', code => { if (shown) console.log(`Public link closed (tunnel exited${code ? ' with code ' + code : ''}).`); });
  const stop = () => { try { child.kill(); } catch (e) { /* already gone */ } };
  process.on('exit', stop);
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { stop(); process.exit(0); });
}

// Opens the game in the default browser (npm run deploy).
function openBrowser(url) {
  const cmd = process.platform === 'darwin' ? `open "${url}"` : process.platform === 'win32' ? `start "" "${url}"` : `xdg-open "${url}"`;
  exec(cmd, err => { if (err) console.log(`Could not open a browser automatically - open ${url} yourself.`); });
}

server.on('error', async err => {
  if (err.code !== 'EADDRINUSE') { console.error(err); process.exit(1); }
  // Something already uses the port. If it's this game's server, just open it.
  let ours = false;
  try { ours = (await (await fetch(LOCAL_URL + '/')).text()).includes('NECROVANTA'); } catch (e) { /* not reachable */ }
  if (ours) {
    console.log(`NECROVANTA:3030 is already running at ${LOCAL_URL}`);
    if (WANT_OPEN) openBrowser(LOCAL_URL);
    if (WANT_ONLINE) startTunnel();   // give the running server a public link (Ctrl+C closes it)
    else process.exit(0);
    return;
  }
  console.error(`Port ${PORT} is already in use by another program. Try another port, e.g.  PORT=4000 npm run deploy`);
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  console.log(`NECROVANTA:3030 server running.`);
  console.log(`  On this computer:   ${LOCAL_URL}`);
  if (HOST === '0.0.0.0' || HOST === '::') {
    const name = localName();
    if (name) console.log(`  Same Wi-Fi:          http://${name}:${PORT}   (no IP address needed)`);
    for (const list of Object.values(os.networkInterfaces())) {
      for (const a of list || []) if (a.family === 'IPv4' && !a.internal) console.log(`  Same Wi-Fi (by IP):  http://${a.address}:${PORT}`);
    }
  }
  console.log('Players open that address in a browser, then MULTIPLAYER.  (Ctrl+C stops the server.)');
  if (!WANT_ONLINE) console.log('Friends on other networks:  npm run online  (gives you a public link)');
  if (WANT_OPEN) openBrowser(LOCAL_URL);
  if (WANT_ONLINE) startTunnel();
});
