// ============================================================
// net.js - online co-op, talking to server.js.
//
// Lobby: list rooms, create a public or private (password) room,
// join one. In a game the room's HOST runs the whole world
// (zombies, waves, loot, builds) exactly like single player;
// every other survivor is a stand-in on the host's side, moved
// by that player's inputs. GUESTS move their own survivor, send
// their attacks to the host, and draw the world the host sends
// back 15 times a second. Each player keeps their own bag,
// materials, mods and class.
// ============================================================

const NET_RATE = 1 / 15;     // world updates per second from the host
// Data from other players is never trusted: ids must be real game ids (not '__proto__'),
// and banner text may only carry the game's own color labels.
const own = (o, k) => typeof k === 'string' && Object.prototype.hasOwnProperty.call(o, k);
const FX_KINDS = ['burst', 'puff', 'ring', 'bolt', 'slash', 'beam', 'float', 'light'];
function safeBannerHtml(s) {
  return esc(String(s).slice(0, 300))
    .replace(/&lt;span class=&quot;(threat|rarity-[a-z]+)&quot;&gt;/g, '<span class="$1">')
    .replace(/&lt;\/span&gt;/g, '</span>')
    .replace(/&amp;middot;/g, '&middot;');
}
const INPUT_RATE = 1 / 20;   // input updates per second from a guest

const Net = {
  active: false,        // in a multiplayer game
  role: null,           // 'host' | 'guest'
  ws: null,
  id: null,
  name: '',
  url: '',
  cls: 'survivor',
  status: 'NOT CONNECTED',
  error: '',
  rooms: [],
  room: null,
  peers: new Map(),     // host: guest id -> stand-in survivor
  remote: { remaining: 0, incoming: 0, gotWorld: false },
  zmap: new Map(),      // guest: zombie uid -> drawable zombie
  cmap: new Map(),      // guest: 'tx,ty' -> chest
  others: new Map(),    // guest: player id -> drawable teammate
  fxQueue: [],
  sndQueue: [],
  soundOwner: null,
  sendT: 0,
  structT: 0,

  // ---------------------------------------------------------- players
  players() {
    if (!Game.player) return [];
    return this.role === 'host' ? [Game.player, ...this.peers.values()] : [Game.player];
  },
  // Survivors zombies can go after (falls back to you, even if dead, so nothing breaks).
  livePlayers() {
    const l = this.players().filter(q => !q.dead);
    return l.length ? l : Game.player ? [Game.player] : [];
  },

  // ---------------------------------------------------------- connection + lobby
  defaultUrl() {
    if (location.protocol === 'http:' || location.protocol === 'https:') return `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`;
    return 'ws://localhost:3030/ws';
  },

  connect(url, name) {
    this.disconnect();
    this.url = url;
    this.name = name;
    this.error = '';
    this.status = 'CONNECTING...';
    let ws;
    try { ws = new WebSocket(url); } catch (e) { this.status = 'BAD SERVER ADDRESS'; UI.refreshLobby(); return; }
    this.ws = ws;
    ws.onopen = () => {
      this.status = 'CONNECTED';
      this.send({ t: 'hello', name, v: 1 });
      this.send({ t: 'list' });
      UI.refreshLobby();
    };
    ws.onerror = () => { if (this.ws === ws) { this.status = 'CANNOT REACH THE SERVER'; UI.refreshLobby(); } };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.room = null;
      this.status = this.status === 'CONNECTED' ? 'DISCONNECTED' : this.status;
      if (this.active) this.endGame('CONNECTION TO THE SERVER WAS LOST');
      else UI.refreshLobby();
    };
    ws.onmessage = e => {
      let m;
      try { m = JSON.parse(e.data); } catch (err) { return; }
      try { this.onMessage(m); } catch (err) { console.error('net message failed', err); }
    };
  },

  disconnect() {
    if (this.ws) { const ws = this.ws; this.ws = null; ws.close(); }
    this.room = null;
    this.status = 'NOT CONNECTED';
  },

  connected() { return this.ws && this.ws.readyState === 1; },
  send(m) { if (this.connected()) this.ws.send(JSON.stringify(m)); },
  toHost(d) { this.send({ t: 'to', to: 'host', d }); },
  toAll(d, lossy = false) { this.send({ t: 'to', to: 'all', d, lossy: lossy ? 1 : 0 }); },
  toPeer(id, d) { this.send({ t: 'to', to: id, d }); },

  refresh() { this.send({ t: 'list' }); },
  createRoom(name, max, priv, pass) { this.error = ''; this.send({ t: 'create', name, max, priv, pass }); },
  joinRoom(id, pass) { this.error = ''; this.send({ t: 'join', room: id, pass }); },
  startRoom() { this.send({ t: 'start' }); },
  leaveRoom() {
    this.send({ t: 'leave' });
    this.room = null;
    this.stopGame();
  },
  isHost() { return this.room && this.room.host === this.id; },

  onMessage(m) {
    switch (m.t) {
      case 'welcome': this.id = m.id; break;
      case 'rooms': this.rooms = Array.isArray(m.rooms) ? m.rooms : []; UI.refreshLobby(); break;
      case 'joined': this.room = m.room; UI.showRoom(); Sound.play('click'); break;
      case 'room': this.room = m.room; if (!this.active) UI.showRoom(); else this.roomChanged(); break;
      case 'left': this.room = null; break;
      case 'closed': this.room = null; if (this.active) this.endGame(m.reason || 'THE ROOM CLOSED'); else UI.showLobby(m.reason); break;
      case 'err': this.error = String(m.msg || 'ERROR'); Sound.play('error'); if (Game.state === 'room') UI.showRoom(); else UI.refreshLobby(); break;
      case 'started': this.startGame(); break;
      case 'peer':
        if (this.role !== 'host') break;
        if (m.join) this.addPeer(m.id, m.name);
        if (m.leave) this.removePeer(m.id);
        break;
      case 'msg':
        if (this.role === 'host') this.hostReceive(m.from, m.d || {});
        else if (this.role === 'guest') this.guestReceive(m.d || {});
        break;
    }
  },

  // ---------------------------------------------------------- starting / ending a game
  startGame() {
    if (!this.room) return;
    this.role = this.room.host === this.id ? 'host' : 'guest';
    this.active = true;
    this.peers.clear(); this.zmap.clear(); this.cmap.clear(); this.others.clear();
    this.fxQueue = []; this.sndQueue = [];
    this.remote = { remaining: 0, incoming: 0, gotWorld: false };
    Main.newGame(null, this.cls);
    const p = Game.player;
    p.id = this.id;
    p.name = this.name;
    if (this.role === 'host') {
      for (const pl of this.room.players) if (pl.id !== this.id) this.addPeer(pl.id, pl.name);
      UI.toast(`YOU ARE HOSTING ${this.room.name} - KEEP THIS TAB OPEN`, '#ffd040');
    } else {
      for (const k of ['zombies', 'bullets', 'enemyShots', 'drops', 'hazards', 'chests', 'drones', 'fields']) Game[k].length = 0;
      this.toHost({ k: 'hi', c: this.cls });
      UI.banner(this.room.name, 'JOINING THE HOST\'S WORLD...');
    }
    Game.others = [];
  },

  stopGame() {
    this.active = false;
    this.role = null;
    this.peers.clear();
    this.others.clear();
    Game.others = [];
  },

  // The game ended for a network reason: back to the lobby with a message.
  endGame(reason) {
    this.stopGame();
    Main.toTitle();
    UI.showLobby(reason);
  },

  roomChanged() {
    UI.toast(`${this.room.players.length}/${this.room.max} SURVIVORS IN THE ROOM`, '#8a8aa8');
  },

  // ---------------------------------------------------------- host side
  addPeer(id, name) {
    if (this.peers.has(id) || id === this.id) return;
    const p = createPlayer();   // a full survivor so every weapon and ability works on it
    for (const k in p.inv) p.inv[k] = 0;
    Object.assign(p, { id, name: String(name || 'SURVIVOR').slice(0, 12), remote: true, x: Game.player.x + rand(-12, 12), y: Game.player.y + rand(-12, 12),
      _hp: 100, _combo: 0, _dome: 0, hurtQ: [], seen: Game.time });
    this.peers.set(id, p);
    this.toPeer(id, { k: 'nodes', list: World.depletedNodes() });
    UI.toast(`${p.name} JOINED`, '#5fe05f');
    Sound.play('discover');
  },

  removePeer(id) {
    const p = this.peers.get(id);
    if (!p) return;
    this.peers.delete(id);
    UI.toast(`${p.name} LEFT`, '#8a8aa8');
    this.checkAllDead();
  },

  num(v, d) { return typeof v === 'number' && Number.isFinite(v) ? v : d; },

  // Weapon mods sent by a guest: only known mods in their own slots.
  cleanMods(md) {
    const out = { mk: {} };
    if (!md || typeof md !== 'object') return out;
    for (const slot of ['optic', 'mag', 'core', 'edge', 'grip']) {
      const id = md[slot];
      if (own(MODS, id) && MODS[id].slot === slot) {
        out[slot] = id;
        out.mk[slot] = clamp((md.mk && md.mk[slot]) | 0 || 1, 1, MOD_MAX_TIER);
      }
    }
    return out;
  },

  // A guest's latest state, applied to their stand-in.
  applyInput(q, s) {
    if (!s || typeof s !== 'object') return;
    const n = (v, d) => this.num(v, d);
    q.x = n(s.x, q.x); q.y = n(s.y, q.y);
    q.aim = n(s.a, q.aim); q.facing = Math.cos(q.aim) >= 0 ? 1 : -1;
    q.moving = !!s.mv; q.mvx = n(s.vx, 0); q.mvy = n(s.vy, 0); q.anim = n(s.an, 0);
    q.maxHp = clamp(n(s.mh, 100), 1, 9999);
    q.hp = q._hp = clamp(n(s.hp, q.hp), 0, q.maxHp);
    q.mx = n(s.mx, q.x); q.my = n(s.my, q.y);
    if (own(WEAPON_BY_ID, s.w)) {
      q.hotbar = [s.w]; q.slot = 0;
      q.weapons[s.w] = clamp(s.lv | 0, 1, MAX_LEVEL);
      q.mods[s.w] = this.cleanMods(s.md);
      if (own(SKINS, s.sk)) q.skin[s.w] = s.sk; else delete q.skin[s.w];
    }
    if (own(CLASS_BY_ID, s.c)) q.cls = s.c;
    q.swingT = n(s.st, 0); q.swingMax = n(s.sm, 0.18) || 0.18; q.swingDir = s.sd > 0 ? 1 : -1; q.spinT = n(s.sp, 0);
    q.flashT = n(s.fl, 0); q.reloadT = n(s.rl, 0); q.reloadMax = n(s.rm, 1) || 1;
    q.invT = n(s.iv, 0); q.hurtT = n(s.hu, 0); q.recoil = n(s.rc, 0); q.charged = !!s.ch;
    q.lastAttackT = Game.time - n(s.la, 99);
    q.domeT = Math.max(q.domeT, n(s.dm, 0));
    q.dead = !!s.dd;
    q.seen = Game.time;
  },

  hostReceive(from, d) {
    const q = this.peers.get(from);
    if (!q) return;
    if (d.s && d.k !== 'atk') this.applyInput(q, d.s);   // requests carry where the guest is right now
    switch (d.k) {
      case 'in': this.applyInput(q, d); break;
      case 'hi': if (own(CLASS_BY_ID, d.c)) q.cls = d.c; break;
      case 'atk': this.applyInput(q, d.s); this.runAttack(q, d); break;
      case 'open': {
        const c = Game.chests.find(ch => ch.tx === d.tx && ch.ty === d.ty && !ch.opened);
        if (c && dist(q.x, q.y, c.x, c.y) < 48) Loot.openChest(c, q);
        break;
      }
      case 'build': {
        const def = own(STRUCT_BY_ID, d.id) ? STRUCT_BY_ID[d.id] : null, tx = d.tx | 0, ty = d.ty | 0;
        if (def && !World.structAt(tx, ty) && World.isOpenGround(tx, ty) && Build.tileClear(tx, ty, def) && dist(q.x, q.y, (tx + 0.5) * TILE, (ty + 0.5) * TILE) < BUILD_RANGE + 24) {
          Structures.place(def, tx, ty);
          FX.burst((tx + 0.5) * TILE, (ty + 0.5) * TILE, '#c8b890', 8, 40, 0.3);
          Sound.play('build', (tx + 0.5) * TILE, (ty + 0.5) * TILE);
        }
        break;
      }
      case 'unbuild': { const s = World.structAt(d.tx | 0, d.ty | 0); if (s) { Structures.remove(s); Sound.play('break', s.x, s.y); } break; }
      case 'repair': { const s = World.structAt(d.tx | 0, d.ty | 0); if (s) { s.hp = s.maxHp; FX.burst(s.x, s.y, '#5fe05f', 8, 40, 0.4); } break; }
      case 'harv': {
        const node = World.nodeAt(d.tx | 0, d.ty | 0);
        if (node && node.uses > 0) { node.uses--; node.shake = 0.15; if (node.uses <= 0) World.flowDirty = true; this.toAll({ k: 'node', tx: node.tx, ty: node.ty, u: node.uses }); }
        break;
      }
      case 'skip': if (Game.phase === 'break') Waves.startWave(); break;
      case 'dead':
        q.dead = true;
        FX.burst(q.x, q.y, '#ff3d4e', 30, 90, 0.9);
        UI.toast(`${q.name} IS DOWN!`, '#ff3d4e');
        this.checkAllDead();
        break;
    }
  },

  // Run a guest's attack on the host's world, as if they fired it here.
  runAttack(q, d) {
    const w = own(WEAPON_BY_ID, d.w) ? WEAPON_BY_ID[d.w] : null;
    if (!w || q.dead) return;
    const mult = clamp(this.num(d.m, 1), 0.1, 6);
    q.hotbar = [w.id]; q.slot = 0;
    const x0 = q.x, y0 = q.y, mouse = { x: Input.mouse.x, y: Input.mouse.y };
    Input.mouse.x = q.mx; Input.mouse.y = q.my;   // abilities aim at this survivor's cursor
    this.soundOwner = q.id;
    try {
      if (d.kind === 'melee' && w.kind === 'knife') Weapons.melee(q, w, w.dmg * mult, mult);
      else if (d.kind === 'fire' && w.kind === 'gun') { Weapons.beginShot(q, w); Weapons.fire(q, w, mult); Weapons.endShot(); }
      else if (d.kind === 'alt' && w.altCd) { q.altCd = {}; Weapons.alt(q); }
      else if ((d.kind === 'gbeam' || d.kind === 'gpulse' || d.kind === 'photon') && (w.id === 'genesis' || w.id === 'photon')) {
        Weapons.beginShot(q, w);
        const m = Weapons.muzzle(q, 4), tip = Weapons.barrelTip(q);
        if (d.kind === 'gpulse') { Weapons.spawnBullet(m.x, m.y, q.aim, w, w.pulseDmg * mult, mult); Sound.gun(w, 1, 'genesis'); }
        else { Weapons.beam(m.x, m.y, q.aim, w.range, w.dmg * mult, w, 5, d.kind === 'photon', tip); Sound.gun(w, 1, d.kind === 'photon' ? 'photon' : 'genesis_beam'); }
        Weapons.endShot();
      }
    } finally {
      Input.mouse.x = mouse.x; Input.mouse.y = mouse.y;
      this.soundOwner = null;
    }
    if (dist(q.x, q.y, x0, y0) > 2) this.toPeer(q.id, { k: 'pos', x: q.x, y: q.y, iv: q.invT });   // blinked or dashed
  },

  // Damage the host's world dealt to a guest; sent with the next update.
  hurt(q, amount, opts) {
    if (q.hurtQ.length < 40) q.hurtQ.push([Math.round(amount * 10) / 10, opts.dot ? 1 : 0, opts.color || 0]);
  },

  // Called every frame on the host after the world has updated.
  hostTick(dt) {
    Game.others = [...this.peers.values()];
    for (const q of this.peers.values()) {
      q.domeT = Math.max(0, q.domeT - dt);
      q._dome = Math.max(0, q._dome - dt);
      // Everything that happened to a guest's survivor on this side goes back to them.
      const u = {};
      if (q.hurtQ.length) { u.h = q.hurtQ; q.hurtQ = []; }
      const gain = {};
      for (const k in q.inv) if (q.inv[k] > 0) { gain[k] = q.inv[k]; q.inv[k] = 0; }
      if (Object.keys(gain).length) u.it = gain;
      if (q.hp > q._hp + 0.5) { u.heal = Math.round((q.hp - q._hp) * 10) / 10; q._hp = q.hp; }
      if (q.burnT > 0 || q.poisonT > 0 || q.slowT > 0) { u.st = [q.burnT, q.poisonT, q.slowT]; q.burnT = q.poisonT = q.slowT = 0; }
      if (q.combo !== q._combo) { u.combo = q.combo; q._combo = q.combo; }
      if (q.domeT > q._dome + 0.5) { u.dome = q.domeT; q._dome = q.domeT; }
      if (Object.keys(u).length) { u.k = 'upd'; this.toPeer(q.id, u); }
      // A guest who stopped sending anything for 15 seconds is treated as gone.
      if (Game.time - q.seen > 15) this.removePeer(q.id);
    }
    this.sendT -= dt;
    if (this.sendT <= 0 && this.peers.size) {
      this.sendT = NET_RATE;
      this.structT -= NET_RATE;
      this.toAll(this.snapshot(this.structT <= 0), true);
      if (this.structT <= 0) { this.structT = 0.5; this.send({ t: 'info', wave: Game.wave }); }
    } else if (!this.peers.size) { this.fxQueue.length = 0; this.sndQueue.length = 0; }
  },

  zflags(z) {
    return (z.flashT > 0 ? 1 : 0) | (z.freezeT > 0 ? 2 : 0) | (z.stunT > 0 ? 4 : 0) | (z.liftT > 0 ? 8 : 0) |
      ((z.slowT > 0 || z.chronoT > 0) ? 16 : 0) | (z.burrowed ? 32 : 0) | (z.shielded ? 64 : 0) | (z.mode === 'windup' ? 128 : 0) |
      (z.chargeT > 0 ? 256 : 0) | (z.lunge > 0 ? 512 : 0) | (z.stickT > 0 ? 1024 : 0);
  },

  playerState(q) {
    const w = Player.weapon(q), r = v => Math.round(v * 100) / 100;
    return [q.id, q.name || '', q.cls, Math.round(q.x), Math.round(q.y), r(q.aim), q.moving ? 1 : 0, r(q.anim), Math.round(q.hp), q.maxHp,
      w ? w.id : 0, w ? Weapons.mods(q, w.id) : 0, w ? (q.skin[w.id] || 0) : 0, r(q.swingT), r(q.swingMax || 0.18), q.swingDir, r(q.spinT || 0),
      r(q.flashT || 0), q.dead ? 1 : 0, r(q.reloadT), r(q.reloadMax || 1), r(Game.time - q.lastAttackT), q.charged ? 1 : 0, r(q.recoil || 0),
      r(q.invT), r(q.hurtT), r(q.domeT)];
  },

  // Everything a guest needs to draw the world.
  snapshot(withStructures) {
    const r = v => Math.round(v * 10) / 10, i = Math.round, a = Game.arena;
    const s = {
      k: 's',
      w: [Game.wave, Game.phase === 'wave' ? 1 : 0, r(Game.breakTimer), Waves.total, Waves.remaining(), Waves.incoming(), Game.kills, Game.score, r(Game.time)],
      z: Game.zombies.filter(z => !z.dead).map(z => [z.uid, z.id, i(z.x), i(z.y), i(z.hp / z.maxHp * 1000), z.facing, this.zflags(z), r(z.spawnT),
        r(z.type.shield ? z.shieldA : z.chDir || 0), z.marks | 0, z.tp ? i(z.tp.x) : 0, z.tp ? i(z.tp.y) : 0, r(z.fuse || 0), r(z.anim)]),
      b: Game.bullets.filter(b => b.delay <= 0).map(b => [i(b.x), i(b.y), i(b.vx), i(b.vy), b.proj, b.color, b.glow, r(b.size), r(b.t),
        b.shell ? i(b.h) : -1, b.aoe | 0, b.shell ? i(b.tx) : 0, b.shell ? i(b.ty) : 0, i(b.hideD || 0)]),
      e: Game.enemyShots.map(e => [e.kind, i(e.x), i(e.y), r(e.h || 0), i(e.vx || 0), i(e.vy || 0), e.color, i(e.tx || 0), i(e.ty || 0), r(e.t || 0), r(e.dur || 1)]),
      h: Game.hazards.map(h => [i(h.x), i(h.y), h.r, h.kind, r(h.life), h.max, h.friendly ? 1 : 0]),
      f: Game.fields.map(f => [f.kind, i(f.x), i(f.y), f.r, r(f.life), f.max]),
      d: Game.drones.map(d => [i(d.x), i(d.y)]),
      r: Game.drops.map(d => [i(d.x), i(d.y), d.kind, r(d.t)]),
      c: Game.chests.map(c => [c.tx, c.ty, c.rarity, c.cache ? 1 : 0, c.opened ? 1 : 0, r(c.openT)]),
      i: Waves.inbound.map(e => [i(e.x), i(e.y), e.id]),
      a: a ? [i(a.x), i(a.y), a.r, a.color, a.theme, r(a.t), r(a.open)] : 0,
      m: Bosses.marks.map(m => [i(m.x), i(m.y), m.r, r(m.t), m.max, m.kind]),
      p: this.players().map(q => this.playerState(q)),
      x: this.fxQueue,
      n: this.sndQueue,
    };
    if (withStructures) s.s = Game.structures.filter(t => !t.dead).map(t => [t.def.id, t.tx, t.ty, i(t.hp), i(t.maxHp), r(t.angle), r(t.flashT || 0)]);
    this.fxQueue = [];
    this.sndQueue = [];
    return s;
  },

  // Host: share effects and sounds with the guests (the originals still play here).
  hookOutputs() {
    const round = a => a.map(v => typeof v === 'number' ? Math.round(v * 10) / 10 : v);
    for (const k of ['burst', 'puff', 'ring', 'bolt', 'slash', 'beam', 'float', 'light']) {
      const orig = FX[k].bind(FX);
      FX[k] = (...args) => {
        orig(...args);
        if (this.role === 'host' && this.peers.size && this.fxQueue.length < 260) this.fxQueue.push([k, ...round(args)]);
      };
    }
    const play = Sound.play.bind(Sound);
    const global = ['wavestart', 'boss', 'waveclear', 'victory', 'titandie', 'shockwave'];
    Sound.play = (name, x, y) => {
      play(name, x, y);
      if (this.role === 'host' && this.peers.size && (x !== undefined || global.includes(name)) && this.sndQueue.length < 60) {
        this.sndQueue.push([name, x === undefined ? null : Math.round(x), y === undefined ? null : Math.round(y)]);
      }
    };
    // Gunshots and swings: tagged with who made them, so the shooter doesn't hear them twice.
    for (const k of ['gun', 'swing']) {
      const orig = Sound[k].bind(Sound);
      Sound[k] = (w, a, b) => {
        if (this.role === 'host' && this.peers.size && this.sndQueue.length < 60) this.sndQueue.push([k, w.id, a === undefined ? null : a, b === undefined ? null : b, this.soundOwner || this.id]);
        if (!this.soundOwner) orig(w, a, b);   // a teammate's shots are heard on their own computer
      };
    }
    const banner = UI.banner.bind(UI);
    UI.banner = (title, sub) => {
      banner(title, sub);
      if (this.role === 'host' && this.peers.size) this.toAll({ k: 'banner', a: title, b: sub || '' });
    };
  },

  // A tree or rock was harvested.
  harvested(node) {
    if (this.role === 'guest') this.toHost({ k: 'harv', tx: node.tx, ty: node.ty });
    else if (this.role === 'host' && this.peers.size) this.toAll({ k: 'node', tx: node.tx, ty: node.ty, u: node.uses - 1 });
  },

  // After a wave: regrown trees and rocks, and everyone who fell comes back.
  waveCleared() {
    if (this.role !== 'host') return;
    this.toAll({ k: 'nodes', list: World.depletedNodes(), reset: 1 });
    this.toAll({ k: 'respawn' });
    if (Game.player.dead) this.revive(Game.player);
  },

  checkAllDead() {
    if (this.role !== 'host' || !this.players().every(q => q.dead)) return;
    const stats = { wave: Game.wave, kills: Game.kills, score: Game.score };
    this.toAll({ k: 'over', ...stats });
    this.gameOver(stats);
  },

  // ---------------------------------------------------------- guest side
  inputState() {
    const p = Game.player, w = Player.weapon(p), r = v => Math.round(v * 100) / 100;
    return {
      x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10, a: r(p.aim), mv: p.moving ? 1 : 0, vx: Math.round(p.mvx || 0), vy: Math.round(p.mvy || 0),
      an: r(p.anim), hp: Math.round(p.hp * 10) / 10, mh: p.maxHp, mx: Math.round(Input.mouse.x), my: Math.round(Input.mouse.y),
      w: w ? w.id : 0, lv: w ? p.weapons[w.id] : 1, md: w ? Weapons.mods(p, w.id) : 0, sk: w ? p.skin[w.id] || 0 : 0, c: p.cls,
      st: r(p.swingT), sm: r(p.swingMax || 0.18), sd: p.swingDir, sp: r(p.spinT || 0), fl: r(p.flashT || 0), rl: r(p.reloadT), rm: r(p.reloadMax || 1),
      iv: r(p.invT), hu: r(p.hurtT), rc: r(p.recoil || 0), ch: p.charged ? 1 : 0, la: r(Game.time - p.lastAttackT), dm: r(p.domeT), dd: p.dead ? 1 : 0,
    };
  },

  // A guest's attack: shown and heard here at once, then run on the host's world.
  attack(p, kind, w, mult) {
    if (kind === 'fire' || kind === 'gbeam' || kind === 'gpulse' || kind === 'photon') {
      p.flashT = 0.05;
      p.recoil = w.rarity >= 4 ? 4 : 2;
      Sound.gun(w, 1, kind === 'gbeam' ? 'genesis_beam' : kind === 'gpulse' ? 'genesis' : undefined);
    } else if (kind === 'melee') {
      p.swingMax = p.swingT = { heavy: 0.26, stab: 0.14, flip: 0.16, saw: 0.1 }[w.style] || 0.18;
      p.swingDir *= -1;
      Sound.swing(w);
    }
    this.toHost({ k: 'atk', kind, w: w.id, m: Math.round(mult * 1000) / 1000, s: this.inputState() });
  },

  guestTick(dt) {
    const p = Game.player;
    this.sendT -= dt;
    if (this.sendT <= 0) { this.sendT = INPUT_RATE; this.toHost({ k: 'in', ...this.inputState() }); }
    if (Input.wasPressed('n') && Game.phase === 'break') this.toHost({ k: 'skip' });
    // Smooth movement between the host's updates.
    const k = Math.min(1, dt * 12);
    for (const z of Game.zombies) {
      z.x += (z.tx - z.x) * k; z.y += (z.ty - z.y) * k;
      z.flashT = Math.max(0, z.flashT - dt);
      if (z.spawnT > 0) z.spawnT = Math.max(0, z.spawnT - dt);
    }
    for (const b of Game.bullets) { b.px = b.x; b.py = b.y; if (b.h < 0) { b.x += b.vx * dt; b.y += b.vy * dt; } b.t += dt; }
    for (const s of Game.enemyShots) if (s.kind !== 'glob') { s.x += s.vx * dt; s.y += s.vy * dt; }
    for (const o of Game.others) { o.x += (o.tx - o.x) * k; o.y += (o.ty - o.y) * k; }
    for (const c of Game.chests) if (!c.opened) c.bob += dt * 3;
    for (const d of Game.drops) d.t += dt;
    if (Game.arena) { Game.arena.t += dt; if (!Game.arena.open && !p.dead) Bosses.confine(p); }
    for (const m of Bosses.marks) m.t = Math.max(0, m.t - dt);
    if (Game.phase === 'break') Game.breakTimer = Math.max(0, Game.breakTimer - dt);
  },

  guestReceive(d) {
    const p = Game.player;
    switch (d.k) {
      case 's': this.applySnapshot(d); break;
      case 'upd':
        if (Array.isArray(d.h)) for (const [a, dot, color] of d.h) Player.damage(p, this.num(a, 0), { dot: !!dot, color: color || undefined });
        if (d.it && typeof d.it === 'object') {
          for (const key in d.it) if (own(p.inv, key)) {
            const n = Math.max(0, this.num(d.it[key], 0) | 0);
            p.inv[key] += n;
            const col = MATERIALS[key] ? MATERIALS[key].color : AMMO[key] ? AMMO[key].color : '#5fe05f';
            if (n) FX.float(p.x, p.y - 14, `+${n} ${itemName(key)}`, col);
          }
          UI.dirty = true;
        }
        if (d.heal) p.hp = Math.min(p.maxHp, p.hp + Math.max(0, this.num(d.heal, 0)));
        if (Array.isArray(d.st) && !p.dead) {
          if (d.st[0] > 0 && !Classes.stat(p, 'burnImmune')) p.burnT = Math.max(p.burnT, this.num(d.st[0], 0));
          if (d.st[1] > 0) p.poisonT = Math.max(p.poisonT, this.num(d.st[1], 0));
          if (d.st[2] > 0) p.slowT = Math.max(p.slowT, this.num(d.st[2], 0));
        }
        if (typeof d.combo === 'number') { p.combo = clamp(d.combo | 0, 0, 10); p.comboT = 1.5; }
        if (d.dome) p.domeT = Math.max(p.domeT, this.num(d.dome, 0));
        break;
      case 'pos': if (!p.dead) { p.x = this.num(d.x, p.x); p.y = this.num(d.y, p.y); p.invT = Math.max(p.invT, this.num(d.iv, 0)); } break;
      case 'loot': Loot.grantChestLoot({ x: this.num(d.x, p.x), y: this.num(d.y, p.y), rarity: clamp(d.rarity | 0, 0, 5), cache: !!d.cache, weapon: own(WEAPON_BY_ID, d.weapon) ? d.weapon : null }); break;
      case 'node': { const n = World.nodeAt(d.tx | 0, d.ty | 0); if (n) { n.uses = clamp(d.u | 0, 0, n.max); n.shake = 0.15; } break; }
      case 'nodes': {
        const map = new Map();
        if (Array.isArray(d.list)) for (const [tx, ty, u] of d.list) map.set(tx + ',' + ty, u);
        for (const [k, u] of map) World.depleted.set(k, u);
        for (const c of World.chunks.values()) for (const n of c.nodes) {
          const u = map.get(n.tx + ',' + n.ty);
          if (u !== undefined) n.uses = u; else if (d.reset) n.uses = n.max;
        }
        if (d.reset) World.depleted = map;
        break;
      }
      case 'banner': UI.banner(esc(String(d.a || '').slice(0, 60)), safeBannerHtml(d.b || '')); break;
      case 'respawn': if (p.dead) this.revive(p); break;
      case 'over': this.gameOver(d); break;
      case 'win': Waves.victory(); break;
    }
  },

  makeZombie(id) {
    const t = ZOMBIE_TYPES[id];
    return { id, type: t, r: t.r, hy: t.hy !== undefined ? t.hy : t.scale ? 10 : 3, cr: 4, hp: 1000, maxHp: 1000, facing: 1, anim: 0,
      flashT: 0, freezeT: 0, stunT: 0, liftT: 0, slowT: 0, chronoT: 0, spawnT: 0, lunge: 0, tp: null, mode: null, chDir: 0, shieldA: 0,
      fuse: 0, marks: 0, stickT: 0, chargeT: 0, dead: false, x: 0, y: 0, tx: 0, ty: 0 };
  },

  applySnapshot(s) {
    const n = (v, d) => this.num(v, d);
    if (Array.isArray(s.w)) {
      const [wave, inWave, brk, total, remaining, incoming, kills, score, time] = s.w;
      Game.wave = n(wave, Game.wave) | 0; Game.phase = inWave ? 'wave' : 'break'; Game.breakTimer = n(brk, 0);
      Waves.total = n(total, 0); this.remote.remaining = n(remaining, 0); this.remote.incoming = n(incoming, 0);
      Game.kills = n(kills, 0); Game.score = n(score, 0);
      const ht = n(time, Game.time);
      if (Math.abs(ht - Game.time) > 0.5) Game.time = ht;   // otherwise keep counting smoothly here
    }
    // Zombies keep their identity between updates so they glide instead of jumping.
    const seen = new Set();
    for (const a of s.z || []) {
      if (!Array.isArray(a) || !own(ZOMBIE_TYPES, a[1])) continue;
      const t = ZOMBIE_TYPES[a[1]];
      let z = this.zmap.get(a[0]);
      if (!z) { z = this.makeZombie(a[1]); z.x = z.tx = a[2]; z.y = z.ty = a[3]; this.zmap.set(a[0], z); }
      const f = a[6] | 0;
      z.tx = n(a[2], z.x); z.ty = n(a[3], z.y); z.hp = n(a[4], 1000); z.facing = a[5] < 0 ? -1 : 1;
      if (f & 1) z.flashT = 0.08;
      z.freezeT = f & 2 ? 1 : 0; z.stunT = f & 4 ? 1 : 0; z.liftT = f & 8 ? 1 : 0; z.slowT = f & 16 ? 1 : 0;
      z.burrowed = !!(f & 32); z.shielded = !!(f & 64); z.mode = f & 128 ? 'windup' : null; z.chargeT = f & 256 ? 1 : 0;
      z.lunge = f & 512 ? 0.1 : 0; z.stickT = f & 1024 ? 0.5 : 0;
      z.spawnT = n(a[7], 0);
      if (t.shield) z.shieldA = n(a[8], 0); else z.chDir = n(a[8], 0);
      z.marks = a[9] | 0;
      z.tp = a[10] || a[11] ? { x: a[10], y: a[11], t: 0.3 } : null;
      z.fuse = n(a[12], 0); z.anim = n(a[13], 0);
      seen.add(a[0]);
    }
    for (const uid of this.zmap.keys()) if (!seen.has(uid)) this.zmap.delete(uid);
    Game.zombies.length = 0;
    for (const z of this.zmap.values()) Game.zombies.push(z);

    Game.bullets.length = 0;
    for (const b of s.b || []) {
      const [x, y, vx, vy, proj, color, glow, size, t, h, aoe, tx, ty, hideD] = b;
      Game.bullets.push({ x, y, px: x, py: y, vx, vy, angle: Math.atan2(vy, vx), proj, color, glow, size, t, h, shell: h >= 0, aoe, tx, ty, hideD, delay: 0, life: 1 });
    }
    Game.enemyShots.length = 0;
    for (const [kind, x, y, h, vx, vy, color, tx, ty, t, dur] of s.e || []) Game.enemyShots.push({ kind, x, y, h, vx, vy, color, tx, ty, t, dur });
    Game.hazards.length = 0;
    for (const [x, y, r, kind, life, max, friendly] of s.h || []) Game.hazards.push({ x, y, r, kind, life, max, friendly: !!friendly });
    Game.fields.length = 0;
    for (const [kind, x, y, r, life, max] of s.f || []) Game.fields.push({ kind, x, y, r, life, max, tick: 1, pull: 0, dps: 0 });
    Game.drones.length = 0;
    for (const [x, y] of s.d || []) Game.drones.push({ x, y, vx: 0, vy: 0, t: 0 });
    Game.drops.length = 0;
    for (const [x, y, kind, t] of s.r || []) Game.drops.push({ x, y, kind, t, amount: 0 });
    // Chests keep their identity (bob animation, "already asked to open").
    const ckeys = new Set();
    for (const [tx, ty, rarity, cache, opened, openT] of s.c || []) {
      const key = tx + ',' + ty;
      let c = this.cmap.get(key);
      if (!c) { c = { tx, ty, x: (tx + 0.5) * TILE, y: (ty + 0.5) * TILE, rarity, cache: !!cache, opened: false, openT: 0, bob: Math.random() * 6 }; this.cmap.set(key, c); }
      c.opened = !!opened; c.openT = openT;
      ckeys.add(key);
    }
    for (const key of this.cmap.keys()) if (!ckeys.has(key)) this.cmap.delete(key);
    Game.chests.length = 0;
    for (const c of this.cmap.values()) Game.chests.push(c);
    Waves.inbound.length = 0;
    for (const [x, y, id] of s.i || []) if (own(ZOMBIE_TYPES, id)) Waves.inbound.push({ x, y, id });
    if (Array.isArray(s.a)) {
      const [x, y, r, color, theme, t, open] = s.a;
      if (!Game.arena || Game.arena.x !== x || Game.arena.y !== y) Game.arena = { x, y, r, color, theme, t, open, decor: Bosses.decor(theme, x, y, r) };
      Object.assign(Game.arena, { r, color, t, open });
    } else Game.arena = null;
    Bosses.marks.length = 0;
    for (const [x, y, r, t, max, kind] of s.m || []) Bosses.marks.push({ x, y, r, t, max, kind });
    if (s.s) this.applyStructures(s.s);
    this.applyPlayers(s.p || []);
    // Replay the host's effects and sounds.
    for (const e of s.x || []) { if (Array.isArray(e) && FX_KINDS.includes(e[0])) { try { FX[e[0]](...e.slice(1)); } catch (err) { /* bad effect */ } } }
    for (const e of s.n || []) this.playRemoteSound(e);
    if (!this.remote.gotWorld) { this.remote.gotWorld = true; UI.dirty = true; }
  },

  applyStructures(list) {
    const want = new Map();
    for (const [id, tx, ty, hp, maxHp, angle, flashT] of list) if (own(STRUCT_BY_ID, id)) want.set(tx + ',' + ty, { id, tx, ty, hp, maxHp, angle, flashT });
    for (const s of [...Game.structures]) {
      const w = want.get(s.tx + ',' + s.ty);
      if (!w || w.id !== s.def.id) Structures.remove(s);
    }
    for (const [key, w] of want) {
      let s = World.structAt(w.tx, w.ty);
      if (!s) s = Structures.place(STRUCT_BY_ID[w.id], w.tx, w.ty);
      Object.assign(s, { hp: w.hp, maxHp: w.maxHp, angle: w.angle, flashT: w.flashT });
    }
  },

  applyPlayers(list) {
    const seen = new Set();
    for (const a of list) {
      const [id, name, cls, x, y, aim, moving, anim, hp, maxHp, wid, mods, skin, swingT, swingMax, swingDir, spinT, flashT, dead,
        reloadT, reloadMax, la, charged, recoil, invT, hurtT, domeT] = a;
      if (id === this.id) continue;
      let o = this.others.get(id);
      if (!o) { o = { id, x, y, tx: x, ty: y, ws: {}, weapons: {}, mods: {}, skin: {}, hotbar: [null], slot: 0, r: 5, altCd: {}, upgrades: {} }; this.others.set(id, o); }
      Object.assign(o, { name: String(name).slice(0, 12), cls: own(CLASS_BY_ID, cls) ? cls : 'survivor', tx: x, ty: y, aim, facing: Math.cos(aim) >= 0 ? 1 : -1, moving: !!moving, anim,
        hp, maxHp, swingT, swingMax, swingDir, spinT, flashT, dead: !!dead, reloadT, reloadMax, lastAttackT: Game.time - la, charged: !!charged,
        recoil, invT, hurtT, domeT });
      if (own(WEAPON_BY_ID, wid)) { o.hotbar = [wid]; o.weapons[wid] = 1; o.mods[wid] = this.cleanMods(mods); if (own(SKINS, skin)) o.skin[wid] = skin; else delete o.skin[wid]; }
      else o.hotbar = [null];
      seen.add(id);
    }
    for (const id of this.others.keys()) if (!seen.has(id)) this.others.delete(id);
    Game.others = [...this.others.values()];
  },

  playRemoteSound(e) {
    if (!Array.isArray(e)) return;
    if (e[0] === 'gun' || e[0] === 'swing') {
      const w = own(WEAPON_BY_ID, e[1]) ? WEAPON_BY_ID[e[1]] : null;
      if (!w || e[4] === this.id) return;   // your own shots were already heard
      Sound.remoteGain = 0.45;
      if (e[0] === 'gun') Sound.gun(w, e[2] === null ? 1 : e[2], e[3] === null ? undefined : e[3]); else Sound.swing(w, e[2] || false);
      Sound.remoteGain = 1;
      return;
    }
    if (typeof e[0] === 'string') Sound.play(e[0], typeof e[1] === 'number' ? e[1] : undefined, typeof e[2] === 'number' ? e[2] : undefined);
  },

  // ---------------------------------------------------------- death, respawn, game over
  localDeath() {
    const p = Game.player;
    if (p.dead) return;
    p.dead = true;
    p.hp = 0;
    Game.buildMode = false;
    FX.burst(p.x, p.y, '#ff3d4e', 30, 90, 0.9);
    FX.burst(p.x, p.y, '#3ff0ff', 12, 60, 0.7);
    FX.shake(6);
    Sound.play('gameover');
    UI.banner('YOU ARE DOWN', 'YOU COME BACK WHEN YOUR TEAM CLEARS THIS WAVE');
    if (this.role === 'guest') this.toHost({ k: 'dead' });
    else this.checkAllDead();
  },

  revive(p) {
    p.dead = false;
    p.hp = Math.round(p.maxHp * 0.6);
    p.invT = 2;
    p.burnT = p.poisonT = p.slowT = 0;
    // Come back next to a teammate who is still standing.
    const mate = this.role === 'host' ? [...this.peers.values()].find(q => !q.dead) : Game.others.find(o => !o.dead);
    if (mate) { p.x = mate.x + rand(-10, 10); p.y = mate.y + rand(-10, 10); if (solidAt(p.x, p.y, p.r)) { p.x = mate.x; p.y = mate.y; } }
    FX.ring(p.x, p.y, 20, '#5fe05f', 0.5);
    Sound.play('heal');
    UI.toast('BACK ON YOUR FEET!', '#5fe05f');
  },

  gameOver(stats) {
    if (Game.state !== 'playing') return;
    Game.state = 'gameover';
    Game.buildMode = false;
    Sound.play('gameover');
    UI.showMpGameOver(stats || {});
  },
};

// Online games keep running when the tab is in the background: browsers stop
// drawing hidden tabs and slow their timers down, so a tiny background worker
// (whose timer isn't slowed) ticks the game whenever no frame was drawn lately.
Net.backgroundTick = () => {
  if (!Net.active || Game.state !== 'playing' || performance.now() - (Main.lastLoop || 0) < 150) return;
  Main.update(0.05);
  Input.endFrame();
};
try {
  const src = 'setInterval(() => postMessage(0), 50);';
  const worker = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
  worker.onmessage = Net.backgroundTick;
} catch (e) {
  setInterval(Net.backgroundTick, 50);   // workers unavailable: a normal (slower in background) timer
}
