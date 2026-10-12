// ============================================================
// waves.js - wave progression: breaks, spawn queues, new-threat
// announcements, checkpoints every 10 waves, death and victory.
// ============================================================

const SAVE_KEY = 'ldoe3026_checkpoint_v2';   // kept from the old name so existing saves still load

const Waves = {
  queue: [],
  inbound: [],       // zombies on their way in from far away (not simulated until they arrive)
  dirs: [],          // the directions this wave's hordes come from
  spawnTimer: 0,
  deathT: 0,

  typeWeight(id, w) {
    const t = ZOMBIE_TYPES[id];
    if (w < t.intro) return 0;
    const [start, end, ramp] = t.weight;
    const v = start + (w - t.intro) * ramp;
    return ramp >= 0 ? Math.min(end, v) : Math.max(end, v);
  },

  buildQueue(w) {
    const titans = MID_BOSSES[w] ? 0 : waveTitanCount(w);
    // Boss waves bring a smaller escort (and no Titans): the boss is the main event.
    const count = Math.max(1, Math.round((waveZombieCount(w) - titans) * (MID_BOSSES[w] ? 0.55 : 1)));
    const weights = ZOMBIE_ORDER.map(id => this.typeWeight(id, w));
    const q = [];
    for (let i = 0; i < count; i++) q.push(ZOMBIE_ORDER[weightedPick(weights)]);
    // Make sure a newly introduced type actually shows up.
    const fresh = ZOMBIE_ORDER.find(id => ZOMBIE_TYPES[id].intro === w && !ZOMBIE_TYPES[id].boss);
    if (fresh) for (let i = 0; i < 3 && i < q.length; i++) q[i] = fresh;
    shuffle(q);
    for (let k = 0; k < titans; k++) q.splice(Math.floor(q.length * (0.2 + 0.6 * k / Math.max(1, titans))), 0, 'titan');
    if (w === MAX_WAVE) q.splice(Math.floor(q.length * 0.35), 0, 'omega');   // the final boss
    return q;
  },

  startBreak(duration) {
    Game.phase = 'break';
    Game.breakTimer = duration;
    UI.dirty = true;
  },

  startWave() {
    const w = ++Game.wave;
    Game.phase = 'wave';
    this.queue = this.buildQueue(w);
    this.total = this.queue.reduce((n, id) => n + (ZOMBIE_TYPES[id].group || 1), 0);
    this.spawnTimer = 1.2;
    // Hordes approach from 1-4 directions, more as the waves go on.
    this.dirs = Array.from({ length: Math.min(4, 1 + Math.floor(w / 25) + (Math.random() < 0.4 ? 1 : 0)) }, () => Math.random() * Math.PI * 2);
    const fresh = ZOMBIE_ORDER.find(id => ZOMBIE_TYPES[id].intro === w && w > 1);
    let sub = `${this.total} ZOMBIES INBOUND`;
    if (w === MAX_WAVE) sub = '<span class="threat">THE OMEGA TITAN APPROACHES</span>';
    else if (fresh) sub = `<span class="threat">NEW THREAT: ${ZOMBIE_TYPES[fresh].name.toUpperCase()}${ZOMBIE_TYPES[fresh].boss ? '' : 'S'}</span>`;
    else if (waveTitanCount(w)) sub = `<span class="threat">TITAN${waveTitanCount(w) > 1 ? 'S' : ''} INCOMING!</span>`;
    else if (w % 10 === 0) sub = '<span class="threat">HORDE WAVE!</span>';
    Sound.play('wavestart');
    if (MID_BOSSES[w]) { this.total++; Bosses.begin(w); UI.dirty = true; return; }
    UI.banner(w === MAX_WAVE ? 'FINAL WAVE' : `WAVE ${w}`, sub);
    if (waveTitanCount(w) || fresh === 'titan' || w === MAX_WAVE) Sound.play('boss');
    UI.dirty = true;
  },

  completeWave() {
    const w = Game.wave;
    Game.score += w * 50;
    if (w >= MAX_WAVE) { this.victory(); return; }
    Sound.play('waveclear');
    World.regrowNodes(0.5);
    Loot.spawnBreakChests();
    let sub = `+${w * 50} SCORE &middot; HEAL, BUILD AND UPGRADE`;
    if (w % 10 === 0) {
      const r = supplyDropRarity(w);
      Loot.spawnChest(r, true);
      sub = `<span class="rarity-${RARITIES[r].id}">${RARITIES[r].name} SUPPLY DROP NEARBY!</span>`;
    }
    UI.banner(`WAVE ${w} CLEARED`, sub);
    this.startBreak(BREAK_TIME);
    this.saveCheckpoint(true);   // every wave
    Net.waveCleared();
  },

  // A reachable tile just off screen (the flow field proves it can walk to the player).
  pickSpawnPoint() {
    const p = Game.player;
    const minD = Math.hypot(Game.viewW, Game.viewH) / 2 + 24;
    const maxD = Math.min(minD + 220, (FLOW_RADIUS - 2) * TILE);
    for (let tries = 0; tries < 60; tries++) {
      const a = Math.random() * Math.PI * 2, d = rand(minD, maxD);
      const tx = toTile(p.x + Math.cos(a) * d), ty = toTile(p.y + Math.sin(a) * d);
      if (World.isSolid(tx, ty) || World.flowAt(tx, ty) === Infinity) continue;
      return { x: (tx + 0.5) * TILE, y: (ty + 0.5) * TILE };
    }
    for (let tries = 0; tries < 60; tries++) {
      const a = Math.random() * Math.PI * 2, d = rand(100, minD);
      const tx = toTile(p.x + Math.cos(a) * d), ty = toTile(p.y + Math.sin(a) * d);
      if (!World.isSolid(tx, ty) && World.flowAt(tx, ty) !== Infinity) return { x: (tx + 0.5) * TILE, y: (ty + 0.5) * TILE };
    }
    return { x: p.x + 120, y: p.y };
  },

  update(dt) {
    if (Game.phase === 'break') {
      Game.breakTimer -= dt;
      if (Game.breakTimer <= 0 || Input.wasPressed('n')) this.startWave();
      return;
    }
    this.spawnTimer -= dt;
    if (this.queue.length && this.spawnTimer <= 0 && Game.zombies.length + this.inbound.length < waveMaxAlive(Game.wave) * 1.3) {
      const group = Math.min(this.queue.length, randInt(1, 1 + Math.floor(Game.wave / 20)));
      const a = pick(this.dirs) + rand(-0.35, 0.35);
      for (let k = 0; k < group; k++) this.sendInbound(this.queue.shift(), a);
      this.spawnTimer = waveSpawnInterval(Game.wave) * group;
    }
    this.updateInbound(dt);
    if (!this.queue.length && !this.inbound.length && Game.zombies.length === 0 && !Bosses.pending) this.completeWave();
  },

  // ---------- far-away spawning ----------
  // A zombie appears at least SPAWN_CHUNKS chunks away and rushes toward the player
  // while unseen; once it is ARRIVE_DIST away (still off screen) it becomes a real zombie.
  sendInbound(id, angle, hp = null, x = null, y = null) {
    const p = Game.player, t = ZOMBIE_TYPES[id];
    if (!Number.isFinite(angle)) angle = Math.random() * Math.PI * 2;
    if (x === null) {
      const d = SPAWN_CHUNKS * CHUNK_PX + rand(0, 1.5 * CHUNK_PX);
      x = p.x + Math.cos(angle) * d + rand(-24, 24);
      y = p.y + Math.sin(angle) * d + rand(-24, 24);
    }
    const speed = INBOUND_SPEED * clamp(t.speed / 28, 0.75, 1.4);
    this.inbound.push({ id, x, y, speed, hp });
  },

  // A zombie left far behind rejoins the incoming horde from where it is.
  toInbound(z) {
    z.dead = true;
    this.sendInbound(z.id, 0, z.hp, z.x, z.y);
  },

  updateInbound(dt) {
    const p = Game.player, list = this.inbound;
    for (let i = list.length - 1; i >= 0; i--) {
      const e = list[i];
      const dx = p.x - e.x, dy = p.y - e.y, d = Math.hypot(dx, dy) || 1;
      if (d <= ARRIVE_DIST) { list.splice(i, 1); this.arrive(e); continue; }
      const step = Math.min(d - ARRIVE_DIST + 1, e.speed * dt);
      e.x += dx / d * step;
      e.y += dy / d * step;
    }
  },

  // Materialize an inbound zombie on a walkable, reachable tile near where it arrived.
  arrive(e) {
    const t = ZOMBIE_TYPES[e.id];
    let at = null;
    const tx0 = toTile(e.x), ty0 = toTile(e.y);
    for (let r = 0; r <= 6 && !at; r++) {
      for (let dy = -r; dy <= r && !at; dy++) for (let dx = -r; dx <= r && !at; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const tx = tx0 + dx, ty = ty0 + dy;
        if (!World.isSolid(tx, ty) && World.flowAt(tx, ty) !== Infinity) at = { x: (tx + 0.5) * TILE, y: (ty + 0.5) * TILE };
      }
    }
    if (!at) at = this.pickSpawnPoint();
    for (let k = 0; k < (t.group || 1); k++) {
      const ox = k ? rand(-8, 8) : 0, oy = k ? rand(-8, 8) : 0;
      const free = !solidAt(at.x + ox, at.y + oy, 4);
      const z = Zombies.spawn(e.id, free ? at.x + ox : at.x, free ? at.y + oy : at.y);
      if (e.hp) z.hp = Math.min(z.maxHp, e.hp);
    }
  },

  // Incoming counts by direction (for the edge-of-screen arrows).
  incomingSectors() {
    const p = Game.player, sectors = new Array(12).fill(0);
    for (const e of this.inbound) {
      const a = Math.atan2(e.y - p.y, e.x - p.x);
      sectors[((Math.round(a / (Math.PI * 2) * 12) % 12) + 12) % 12] += ZOMBIE_TYPES[e.id].group || 1;
    }
    return sectors;
  },

  remaining() {
    if (Net.role === 'guest') return Net.remote.remaining;
    return this.queue.reduce((n, id) => n + (ZOMBIE_TYPES[id].group || 1), 0) +
      this.inbound.reduce((n, e) => n + (ZOMBIE_TYPES[e.id].group || 1), 0) + Game.zombies.length + (Bosses.pending ? 1 : 0);
  },
  incoming() { if (Net.role === 'guest') return Net.remote.incoming; return this.inbound.reduce((n, e) => n + (ZOMBIE_TYPES[e.id].group || 1), 0); },

  // ---------- saves (see save.js) ----------
  saveCheckpoint(announce) { Save.save(announce); },
  loadSaved() { return Save.load(); },
  clearSaved() { Save.clear(); },

  // ---------- end states ----------
  onPlayerDeath() {
    if (Game.state !== 'playing') return;
    if (Net.active) { Net.localDeath(); return; }   // multiplayer: spectate until the next wave
    Game.state = 'dead';
    this.deathT = 1.8;
    Game.buildMode = false;
    const p = Game.player;
    FX.burst(p.x, p.y, '#ff3d4e', 30, 90, 0.9);
    FX.burst(p.x, p.y, '#3ff0ff', 12, 60, 0.7);
    FX.shake(6);
    Sound.play('gameover');
    UI.setHint('');
  },

  updateDead(dt) {
    this.deathT -= dt;
    if (this.deathT <= 0 && Game.state === 'dead') {
      Game.state = 'gameover';
      UI.showGameOver();
    }
  },

  victory() {
    Game.state = 'victory';
    Game.score += 5000;
    if (Net.role === 'host') Net.toAll({ k: 'win' });
    if (!Net.active) this.clearSaved();
    Game.zombies.length = 0;
    Game.enemyShots.length = 0;
    this.inbound.length = 0;
    Sound.play('victory');
    UI.showVictory();
  },
};
