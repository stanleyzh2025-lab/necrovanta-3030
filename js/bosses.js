// ============================================================
// bosses.js - the mid-run bosses (waves 25, 50, 75): sealed
// arenas, telegraphed attacks, phase changes and rewards.
// Boss stats live in ZOMBIE_TYPES (config.js); each boss's
// attack script is the function named by its `ai` field.
// ============================================================

const TAU = Math.PI * 2;

const Bosses = {
  marks: [],       // telegraphed ground strikes: { x, y, r, t, max, kind, dmg, follow, owner }
  pending: null,   // { id, t }: the boss about to make its entrance
  zapT: 0,

  reset() {
    this.marks.length = 0;
    this.pending = null;
    Game.arena = null;
  },

  // Boss wave: seal an arena around the survivor; the boss bursts in after a short intro.
  begin(w) {
    const id = MID_BOSSES[w], t = ZOMBIE_TYPES[id], p = Game.player, a = t.arena;
    Game.arena = { x: p.x, y: p.y, r: a.r, color: a.color, theme: a.theme, t: 0, open: 0, decor: this.decor(a.theme, p.x, p.y, a.r) };
    this.pending = { id, t: 2.5 };
    UI.banner(`WAVE ${w}`, `<span class="threat">${t.name}</span>`);
    UI.toast('THE ARENA IS SEALED - DEFEAT THE BOSS TO GET OUT', a.color);
    Sound.play('boss');
    FX.ring(p.x, p.y, a.r, a.color, 0.8);
    FX.shake(4);
  },

  // Decorations scattered inside the arena (drawn by drawGround).
  decor(theme, cx, cy, r) {
    const list = [], n = theme === 'storm' ? 8 : 10;
    for (let i = 0; i < n; i++) {
      const a = i / n * TAU + 0.3, d = theme === 'storm' ? r : r * (0.45 + (i % 3) * 0.17);
      const x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d;
      if (theme !== 'storm' && World.isSolid(toTile(x), toTile(y))) continue;
      list.push({ x, y, v: i });
    }
    return list;
  },

  // Nearest spot around (x, y) where something of radius r fits.
  freeSpot(x, y, r) {
    if (!solidAt(x, y, r)) return [x, y];
    for (let d = 8; d <= 64; d += 8) for (let k = 0; k < 8; k++) {
      const a = k / 8 * TAU, nx = x + Math.cos(a) * d, ny = y + Math.sin(a) * d;
      if (!solidAt(nx, ny, r)) return [nx, ny];
    }
    return [x, y];
  },

  spawnBoss() {
    const id = this.pending.id, a = Game.arena || { x: Game.player.x, y: Game.player.y, r: 160 }, p = Game.player;
    this.pending = null;
    // Enter across the arena from the survivor.
    const ang = dist(p.x, p.y, a.x, a.y) > 10 ? Math.atan2(a.y - p.y, a.x - p.x) : Math.random() * TAU;
    const [x, y] = this.freeSpot(a.x + Math.cos(ang) * a.r * 0.55, a.y + Math.sin(ang) * a.r * 0.55, 8);
    const z = Zombies.spawn(id, x, y);
    Object.assign(z, { spawnT: 1.2, phase: 1, atkA: 2.5, atkB: 6, atkC: 9, atkD: 6 });
    const col = ZOMBIE_TYPES[id].arena.color;
    FX.ring(x, y, 60, col, 0.8);
    FX.burst(x, y, col, 40, 140, 0.9);
    FX.light(x, y, 160, col, 0.8);
    FX.shake(8);
    Sound.play('summon', x, y);
    Sound.play('titandie', x, y);
  },

  update(dt) {
    const a = Game.arena, p = Game.player;
    if (this.pending && (this.pending.t -= dt) <= 0) this.spawnBoss();
    if (a) {
      a.t += dt;
      if (a.open) { if ((a.open += dt) > 1.5) Game.arena = null; }
      else {
        // Hive arena: acid drips from the ceiling of the nest.
        if (a.theme === 'hive' && Math.random() < dt / 3.5) {
          const ang = Math.random() * TAU, d = Math.sqrt(Math.random()) * a.r * 0.85;
          this.mark(a.x + Math.cos(ang) * d, a.y + Math.sin(ang) * d, 14, 1.3, 'acid', 6 * waveDmgMult(Game.wave));
        }
      }
    }
    for (let i = this.marks.length - 1; i >= 0; i--) {
      const m = this.marks[i];
      m.t -= dt;
      // Tracking marks follow the survivor, then lock in place before they hit.
      if (m.follow && m.max - m.t < m.follow) { m.x += (p.x - m.x) * Math.min(1, dt * 4); m.y += (p.y - m.y) * Math.min(1, dt * 4); }
      if (m.t <= 0) { this.marks.splice(i, 1); this.strike(m); }
    }
    if (Game.arena && !Game.arena.open) this.confine(p);   // last, after any knockback
  },

  // Keep the survivor inside a sealed arena (the wall shocks you back).
  confine(p) {
    const a = Game.arena, dx = p.x - a.x, dy = p.y - a.y, d = Math.hypot(dx, dy), max = a.r - p.r - 2;
    if (d <= max) return;
    const tx = a.x + dx / d * max, ty = a.y + dy / d * max;
    moveEntity(p, tx - p.x, ty - p.y, p.r);
    if (dist(p.x, p.y, a.x, a.y) > max + 4 && !solidAt(tx, ty, p.r)) { p.x = tx; p.y = ty; }
    if (Game.time - this.zapT > 0.6) {
      this.zapT = Game.time;
      FX.burst(p.x + dx / d * 5, p.y - 3 + dy / d * 5, a.color, 8, 60, 0.3);
      FX.bolt(p.x + dx / d * 6, p.y - 10, p.x + dx / d * 6, p.y + 4, a.color, 0.1);
      Sound.play('zap', p.x, p.y);
    }
  },

  mark(x, y, r, t, kind, dmg, extra = {}) {
    this.marks.push(Object.assign({ x, y, r, t, max: t, kind, dmg }, extra));
  },

  // A telegraphed strike lands.
  strike(m) {
    for (const p of Net.livePlayers()) this.strikeOn(m, p, dist2(p.x, p.y, m.x, m.y) < (m.r + p.r) ** 2);
  },

  // Effects at the strike spot happen once (first call); damage applies to each survivor inside.
  strikeOn(m, p, inside) {
    const first = !m.done;
    m.done = true;
    if (!first && !inside) return;
    switch (m.kind) {
      case 'bolt':
        if (!first) { if (inside) Player.damage(p, m.dmg); break; }
        FX.bolt(m.x + rand(-8, 8), m.y - 120, m.x, m.y, '#ffffff', 0.18);
        FX.bolt(m.x + rand(-8, 8), m.y - 120, m.x, m.y, '#fff060', 0.25);
        FX.ring(m.x, m.y, m.r, '#fff060', 0.3);
        FX.burst(m.x, m.y, '#fff060', 10, 80, 0.3);
        FX.light(m.x, m.y, 70, '#fff060', 0.25);
        Sound.play('zap', m.x, m.y);
        if (inside) Player.damage(p, m.dmg);
        break;
      case 'hands':
        // Skeletal hands claw up out of the earth: damage and a grip that slows you.
        if (!first) { if (inside) { Player.damage(p, m.dmg); p.slowT = Math.max(p.slowT, 1.5); } break; }
        for (let i = 0; i < 5; i++) FX.bolt(m.x + rand(-m.r, m.r) * 0.7, m.y + 2, m.x + rand(-m.r, m.r) * 0.7, m.y - rand(8, 16), i % 2 ? '#d8d0c0' : '#3aff8a', 0.35);
        FX.burst(m.x, m.y, '#3aff8a', 12, 60, 0.5);
        FX.burst(m.x, m.y, '#4a3a2a', 10, 50, 0.5);
        Sound.play('slam', m.x, m.y);
        if (inside) { Player.damage(p, m.dmg); p.slowT = Math.max(p.slowT, 1.5); }
        break;
      case 'acid':
        if (!first) { if (inside) { Player.damage(p, m.dmg); p.poisonT = Math.max(p.poisonT, 2); } break; }
        Game.hazards.push({ x: m.x, y: m.y, r: 14, kind: 'toxic', life: 3, max: 3 });
        FX.burst(m.x, m.y, '#b0ff40', 12, 60, 0.4);
        Sound.play('splat', m.x, m.y);
        if (inside) { Player.damage(p, m.dmg); p.poisonT = Math.max(p.poisonT, 2); }
        break;
      case 'erupt': {
        const z = m.owner;
        if (!z || z.dead) break;
        if (!first) {
          if (inside) { Player.damage(p, m.dmg); const a = Math.atan2(p.y - m.y, p.x - m.x); if (!p.remote) moveEntity(p, Math.cos(a) * 26, Math.sin(a) * 26, p.r); }
          break;
        }
        [z.x, z.y] = this.freeSpot(m.x, m.y, z.cr);
        z.ax = z.x; z.ay = z.y;
        z.burrowed = false;
        z.spawnT = 0.35;
        FX.ring(m.x, m.y, m.r + 10, '#b0ff40', 0.5);
        FX.burst(m.x, m.y, '#6a5a3a', 30, 120, 0.7);
        FX.burst(m.x, m.y, '#c8ff40', 20, 100, 0.6);
        FX.shake(6);
        Sound.play('slam', m.x, m.y);
        Sound.play('splat', m.x, m.y);
        Game.hazards.push({ x: m.x, y: m.y, r: 18, kind: 'toxic', life: 3, max: 3 });
        if (inside) {
          Player.damage(p, m.dmg);
          const a = Math.atan2(p.y - m.y, p.x - m.x);
          moveEntity(p, Math.cos(a) * 26, Math.sin(a) * 26, p.r);
        }
        break;
      }
    }
  },

  // ---------------------------------------------------------- attack scripts
  // Called from Zombies.update; returning true holds the boss still this frame.
  think(z, p, dp, dt) {
    switch (z.type.ai) {
      case 'hivequeen': return this.hivequeen(z, p, dp, dt);
      case 'voltrax': return this.voltrax(z, p, dp, dt);
      case 'deadking': return this.deadking(z, p, dp, dt);
      case 'pylon': return this.pylon(z, p, dp, dt);
    }
    return false;
  },

  phaseBanner(z, text) {
    UI.banner(z.type.name.split(',')[0], `<span class="threat">${text}</span>`);
    FX.ring(z.x, z.y - 10, 70, z.type.arena.color, 0.6);
    FX.light(z.x, z.y, 140, z.type.arena.color, 0.6);
    FX.shake(6);
    Sound.play('boss');
  },

  timers(z, dt) { z.atkA -= dt; z.atkB -= dt; z.atkC -= dt; z.atkD -= dt; },

  // MAW, THE HIVE QUEEN: acid volleys and broods; at half health she burrows
  // and erupts under the survivor.
  hivequeen(z, p, dp, dt) {
    this.timers(z, dt);
    const enraged = z.hp < z.maxHp * 0.5;
    if (enraged && z.phase === 1) { z.phase = 2; z.atkC = 1.5; this.phaseBanner(z, 'THE QUEEN BURROWS! WATCH THE GROUND'); }
    if (z.atkA <= 0 && dp < 260) {
      // Acid volley: a fan of globs across where you're standing.
      z.atkA = enraged ? 2.6 : 3.4;
      const n = enraged ? 7 : 5, side = Math.atan2(p.y - z.y, p.x - z.x) + Math.PI / 2;
      for (let i = 0; i < n; i++) {
        const off = (i - (n - 1) / 2) * 20;
        Game.enemyShots.push({ kind: 'glob', x0: z.x, y0: z.y - 14, x: z.x, y: z.y - 14, tx: p.x + Math.cos(side) * off + rand(-5, 5), ty: p.y + Math.sin(side) * off + rand(-5, 5),
          t: 0, dur: 0.8 + Math.abs(off) * 0.004, dmg: z.dmg * 0.7, color: '#b0ff40', noPool: i !== (n >> 1) });
      }
      z.lunge = 0.3;
      Sound.play('spit', z.x, z.y);
    }
    if (z.atkB <= 0) {
      // Brood: crawlers and leeches hatch around her (up to 10 alive).
      z.atkB = enraged ? 7 : 9;
      const alive = Game.zombies.filter(o => o.broodOf === z && !o.dead).length;
      for (let i = 0; i < Math.min(4, 10 - alive); i++) {
        const a = Math.random() * TAU, x = z.x + Math.cos(a) * 22, y = z.y + Math.sin(a) * 22;
        if (solidAt(x, y, 4)) continue;
        const m = Zombies.spawn(i % 2 ? 'leech' : 'crawler', x, y);
        m.spawnT = 0.8;
        m.broodOf = z;
      }
      FX.burst(z.x, z.y - 10, '#c8ff40', 24, 80, 0.6);
      Sound.play('splat', z.x, z.y);
    }
    if (enraged && z.atkC <= 0) {
      // Burrow: vanish underground, chase the survivor's position, erupt.
      z.atkC = 9;
      z.burrowed = true;
      z.spawnT = 99;   // underground: nothing can touch her until she erupts
      FX.burst(z.x, z.y, '#6a5a3a', 30, 90, 0.6);
      FX.shake(4);
      Sound.play('slam', z.x, z.y);
      this.mark(p.x, p.y, 34, 1.9, 'erupt', z.dmg * 1.6, { follow: 1.3, owner: z });
      return true;
    }
    return false;
  },

  // VOLTRAX, THE STORM ENGINE: lightning strikes and ball lightning. At 66% and
  // 33% it shields itself until its three Tesla Pylons are destroyed.
  voltrax(z, p, dp, dt) {
    this.timers(z, dt);
    const frac = z.hp / z.maxHp;
    if (!z.shielded && ((z.phase === 1 && frac < 0.66) || (z.phase === 2 && frac < 0.33))) {
      z.phase++;
      z.shielded = true;
      this.spawnPylons(z);
      this.phaseBanner(z, 'SHIELD UP! DESTROY THE 3 TESLA PYLONS');
    }
    if (z.shielded && !Game.zombies.some(o => o.pylonOf === z && !o.dead)) {
      z.shielded = false;
      FX.ring(z.x, z.y - 16, 40, '#7affff', 0.5);
      FX.burst(z.x, z.y - 16, '#7affff', 30, 120, 0.6);
      UI.toast('VOLTRAX SHIELD DOWN - HIT IT NOW!', '#fff060');
      Sound.play('break', z.x, z.y);
    }
    if (z.atkA <= 0 && dp < 300) {
      // Lightning: telegraphed circles on and around you, striking one after another.
      z.atkA = z.shielded ? 2.6 : 3.8 - z.phase * 0.4;
      const n = 2 + z.phase;
      this.mark(p.x + (p.mvx || 0) * 0.4, p.y + (p.mvy || 0) * 0.4, 18, 1.1, 'bolt', z.dmg);
      for (let i = 1; i <= n; i++) {
        const a = Math.random() * TAU, d = rand(26, 70);
        this.mark(p.x + Math.cos(a) * d, p.y + Math.sin(a) * d, 18, 1.1 + i * 0.15, 'bolt', z.dmg);
      }
      Sound.play('charge', z.x, z.y);
    }
    if (z.atkB <= 0 && dp < 280) {
      // Ball lightning: slow orbs that curve toward you.
      z.atkB = 5.5;
      const a0 = Math.atan2(p.y - z.y, p.x - z.x);
      for (let i = 0; i < 3; i++) {
        const a = a0 + (i - 1) * 0.6;
        Game.enemyShots.push({ kind: 'orb', x: z.x, y: z.y - 18, vx: Math.cos(a) * 70, vy: Math.sin(a) * 70, dmg: z.dmg * 0.6, life: 4.5, color: '#fff060' });
      }
      z.lunge = 0.3;
      Sound.play('arc', z.x, z.y);
    }
    return false;
  },

  spawnPylons(z) {
    const a = Game.arena, cx = a ? a.x : z.x, cy = a ? a.y : z.y, r = a ? a.r * 0.62 : 70, a0 = Math.random() * TAU;
    for (let i = 0; i < 3; i++) {
      // Somewhere you can see (and shoot) from the middle of the arena, not behind a building.
      let x, y;
      for (let k = 0; k < 12; k++) {
        const ang = a0 + i / 3 * TAU + (k >> 1) * 0.25 * (k % 2 ? -1 : 1), d = r * (1 - (k >> 2) * 0.2);
        [x, y] = this.freeSpot(cx + Math.cos(ang) * d, cy + Math.sin(ang) * d, 6);
        if (World.lineClear(cx, cy - 2, x, y - 9)) break;
      }
      const m = Zombies.spawn('pylon', x, y);
      m.spawnT = 0.8;
      m.pylonOf = z;
      m.zapT = rand(1, 2);
      FX.bolt(z.x, z.y - 18, x, y - 10, '#fff060', 0.3);
    }
    Sound.play('powerup', z.x, z.y);
  },

  // Tesla Pylon: stands still and zaps the survivor when close.
  pylon(z, p, dp, dt) {
    z.zapT -= dt;
    if (z.zapT <= 0 && dp < 80 && World.lineClear(z.x, z.y - 12, p.x, p.y - 3)) {
      z.zapT = 2.2;
      FX.bolt(z.x, z.y - 14, p.x, p.y - 4, '#fff060');
      FX.bolt(z.x, z.y - 14, p.x, p.y - 4, '#ffffff', 0.08);
      Player.damage(p, z.dmg);
      Sound.play('zap', z.x, z.y);
    }
    return true;
  },

  // NECROVANTA, THE DEAD KING: soul spirals, grave hands and raised elites. Below
  // 40% health it starts blinking around the arena and casts faster.
  deadking(z, p, dp, dt) {
    this.timers(z, dt);
    const enraged = z.hp < z.maxHp * 0.4;
    if (enraged && z.phase === 1) { z.phase = 2; z.atkD = 1; this.phaseBanner(z, 'THE DEAD KING RISES IN FURY!'); }
    if (z.tp) {   // blinking
      z.tp.t -= dt;
      if (z.tp.t <= 0) {
        FX.burst(z.x, z.y - 10, '#3aff8a', 20, 70, 0.4);
        z.x = z.ax = z.tp.x; z.y = z.ay = z.tp.y;
        FX.burst(z.x, z.y - 10, '#b05cff', 20, 70, 0.4);
        FX.light(z.x, z.y, 70, '#3aff8a', 0.3);
        z.tp = null;
      }
      return true;
    }
    if (z.spiral > 0) {
      // Soul spiral: rotating arms of soul bolts. He stands still while casting.
      z.spiralT -= dt;
      if (z.spiralT <= 0) {
        z.spiralT = enraged ? 0.06 : 0.08;
        z.spiral--;
        const arms = enraged ? 3 : 2;
        for (let k = 0; k < arms; k++) {
          const a = z.spiralA + k * TAU / arms;
          Game.enemyShots.push({ kind: 'laser', x: z.x, y: z.y - 18, vx: Math.cos(a) * 90, vy: Math.sin(a) * 90, dmg: z.dmg * 0.4, life: 3, color: '#3aff8a' });
        }
        z.spiralA += 0.33;
      }
      return true;
    }
    if (z.atkA <= 0 && dp < 260) {
      z.atkA = enraged ? 5 : 6.5;
      z.spiral = 20; z.spiralT = 0; z.spiralA = Math.random() * TAU;
      FX.ring(z.x, z.y - 18, 30, '#3aff8a', 0.5);
      Sound.play('souls', z.x, z.y);
      return true;
    }
    if (z.atkB <= 0 && dp < 280) {
      // Grave hands under you and around you.
      z.atkB = enraged ? 5 : 7;
      this.mark(p.x, p.y, 16, 1.0, 'hands', z.dmg * 0.8);
      for (let i = 0; i < 3; i++) {
        const a = i / 3 * TAU + Math.random(), d = rand(28, 50);
        this.mark(p.x + Math.cos(a) * d, p.y + Math.sin(a) * d, 16, 1.2, 'hands', z.dmg * 0.8);
      }
      Sound.play('summon', z.x, z.y);
    }
    if (z.atkC <= 0) {
      // Raise the dead: elite escorts claw out of the ground.
      z.atkC = 13;
      for (let i = 0; i < 3; i++) {
        const a = Math.random() * TAU, x = z.x + Math.cos(a) * 30, y = z.y + Math.sin(a) * 30;
        if (solidAt(x, y, 4)) continue;
        const m = Zombies.spawn(pick(['armored', 'wraith', 'riot', 'cyber', 'brute']), x, y);
        m.spawnT = 1;
      }
      FX.ring(z.x, z.y, 50, '#b05cff', 0.6);
      Sound.play('summon', z.x, z.y);
    }
    if (enraged && z.atkD <= 0 && dp < 320) {
      z.atkD = 6;
      const a = Math.random() * TAU;
      const [x, y] = this.freeSpot(p.x + Math.cos(a) * 60, p.y + Math.sin(a) * 60, z.cr);
      z.tp = { x, y, t: 0.6 };
      Sound.play('teleport', x, y);
      return true;
    }
    return false;
  },

  // ---------------------------------------------------------- death + rewards
  onKill(z) {
    const t = z.type, a = Game.arena;
    if (a && !a.open) a.open = 0.001;
    this.marks.length = 0;
    for (const o of Game.zombies) if (o.pylonOf === z && !o.dead) Zombies.kill(o);
    // Guaranteed weapon crate: preferably a weapon you don't own yet.
    const pool = WEAPONS_BY_RARITY[t.reward.rarity], p = Game.player;
    const fresh = pool.filter(w => !p.weapons[w.id]);
    const wid = t.reward.prefer && !p.weapons[t.reward.prefer] ? t.reward.prefer : (fresh.length ? pick(fresh) : pick(pool)).id;
    const [x, y] = this.freeSpot(z.x, z.y, 6);
    const c = Loot.addChest(toTile(x), toTile(y), t.reward.rarity, true);
    c.weapon = wid;
    const col = t.arena.color;
    FX.ring(z.x, z.y, 120, col, 1.2);
    FX.burst(z.x, z.y, col, 70, 180, 1.2, 2);
    FX.light(z.x, z.y, 260, col, 1.4);
    FX.shake(10);
    Sound.play('titandie', z.x, z.y);
    Sound.play('shockwave', z.x, z.y);
    UI.banner(`${t.name.split(',')[0]} DEFEATED`, `<span class="rarity-${RARITIES[t.reward.rarity].id}">${RARITIES[t.reward.rarity].name} WEAPON CRATE</span> &middot; ${t.reward.kits} MOD KIT${t.reward.kits > 1 ? 'S' : ''} &middot; THE ARENA OPENS`);
  },

  // ---------------------------------------------------------- drawing
  // Arena floor, decorations and telegraph circles (under the actors).
  drawGround(g, cam) {
    const a = Game.arena;
    if (a) {
      const fade = a.open ? Math.max(0, 1 - a.open / 1.5) : Math.min(1, a.t * 1.5);
      const x = Math.round(a.x - cam.x), y = Math.round(a.y - cam.y);
      g.globalAlpha = 0.08 * fade;
      g.fillStyle = a.color;
      g.beginPath(); g.arc(x, y, a.r, 0, TAU); g.fill();
      // Inner rune circle.
      g.globalAlpha = 0.25 * fade;
      g.strokeStyle = a.color; g.lineWidth = 1;
      g.beginPath(); g.arc(x, y, a.r * 0.5, 0, TAU); g.stroke();
      for (let i = 0; i < 6; i++) {
        const ang = i / 6 * TAU + a.t * 0.1;
        g.fillStyle = a.color;
        g.fillRect(Math.round(x + Math.cos(ang) * a.r * 0.5) - 1, Math.round(y + Math.sin(ang) * a.r * 0.5) - 1, 3, 3);
      }
      g.globalAlpha = fade;
      for (const d of a.decor) this.drawDecor(g, a, Math.round(d.x - cam.x), Math.round(d.y - cam.y), d.v);
      g.globalAlpha = 1;
    }
    for (const m of this.marks) {
      const x = Math.round(m.x - cam.x), y = Math.round(m.y - cam.y), k = 1 - m.t / m.max;
      const col = m.kind === 'bolt' ? '#fff060' : m.kind === 'hands' ? '#3aff8a' : '#b0ff40';
      g.globalAlpha = 0.18 + k * 0.25;
      g.fillStyle = col;
      g.beginPath(); g.ellipse(x, y, m.r * k, m.r * k * 0.6, 0, 0, TAU); g.fill();
      g.globalAlpha = 0.5 + (Math.floor(Game.time * 12) % 2) * 0.4;
      g.strokeStyle = col; g.lineWidth = 1;
      g.beginPath(); g.ellipse(x, y, m.r, m.r * 0.6, 0, 0, TAU); g.stroke();
      if (m.kind === 'erupt') {   // churning dirt where the queen will burst out
        g.fillStyle = '#6a5a3a';
        for (let i = 0; i < 6; i++) g.fillRect(Math.round(x + Math.cos(i + Game.time * 9) * m.r * 0.4), Math.round(y + Math.sin(i * 2 + Game.time * 7) * m.r * 0.25), 2, 1);
      }
      g.globalAlpha = 1;
    }
  },

  drawDecor(g, a, x, y, v) {
    if (a.theme === 'hive') {        // pulsing egg sacs
      const pulse = Math.sin(a.t * 3 + v) > 0.6 ? 1 : 0;
      g.fillStyle = '#14141c'; g.fillRect(x - 3, y - 4, 7, 6);
      g.fillStyle = '#7a9a3a'; g.fillRect(x - 2, y - 3, 5, 4);
      g.fillStyle = pulse ? '#e8ff90' : '#c8ff40'; g.fillRect(x - 1, y - 2, 2, 2);
    } else if (a.theme === 'storm') {   // conductor posts on the ring
      g.fillStyle = '#14141c'; g.fillRect(x - 2, y - 12, 5, 14);
      g.fillStyle = '#5a6476'; g.fillRect(x - 1, y - 11, 3, 12);
      g.fillStyle = Math.floor(a.t * 8 + v) % 3 ? '#fff060' : '#ffffff'; g.fillRect(x - 1, y - 13, 3, 2);
    } else {                          // tombstones with a ghost candle
      g.fillStyle = '#14141c'; g.fillRect(x - 4, y - 9, 9, 11);
      g.fillStyle = '#6a6a74'; g.fillRect(x - 3, y - 8, 7, 9);
      g.fillStyle = '#8a8a94'; g.fillRect(x - 3, y - 8, 7, 1);
      g.fillStyle = '#4a4a52'; g.fillRect(x - 1, y - 6, 3, 1); g.fillRect(x, y - 7, 1, 3);
      if (v % 2) { g.fillStyle = '#3aff8a'; g.fillRect(x + 5, y - 3 - (Math.floor(a.t * 6 + v) % 2), 1, 2); }
    }
  },

  // Arena wall, pylon tethers and boss shields (over the actors).
  drawTop(g, cam) {
    const a = Game.arena;
    if (a) {
      const fade = a.open ? Math.max(0, 1 - a.open / 1.5) : Math.min(1, a.t * 1.5);
      const x = a.x - cam.x, y = a.y - cam.y;
      g.globalAlpha = 0.55 * fade;
      g.strokeStyle = a.color; g.lineWidth = 2;
      g.beginPath(); g.arc(x, y, a.r, 0, TAU); g.stroke();
      // Energy segments racing around the wall.
      g.globalAlpha = 0.9 * fade;
      g.strokeStyle = '#ffffff'; g.lineWidth = 1;
      for (let i = 0; i < 6; i++) {
        const s = a.t * 0.8 + i / 6 * TAU;
        g.beginPath(); g.arc(x, y, a.r, s, s + 0.18); g.stroke();
      }
      g.globalAlpha = 1;
    }
    for (const z of Game.zombies) {
      if (z.dead || z.spawnT > 0) continue;
      const zx = z.x - cam.x, zy = z.y - cam.y;
      if (z.pylonOf && !z.pylonOf.dead) {   // power tether to Voltrax
        g.globalAlpha = 0.4 + Math.random() * 0.4;
        pxLine(g, zx, zy - 14, z.pylonOf.x - cam.x, z.pylonOf.y - cam.y - 18, Math.random() < 0.5 ? '#fff060' : '#7affff');
        g.globalAlpha = 1;
      }
      if (z.shielded) {
        g.globalAlpha = 0.25 + Math.sin(Game.time * 8) * 0.1;
        g.fillStyle = '#7affff';
        g.beginPath(); g.arc(zx, zy - z.hy, z.r + 10, 0, TAU); g.fill();
        g.globalAlpha = 0.8;
        g.strokeStyle = '#ffffff'; g.lineWidth = 1;
        g.beginPath(); g.arc(zx, zy - z.hy, z.r + 10, Game.time * 3, Game.time * 3 + 4); g.stroke();
        g.globalAlpha = 1;
      }
    }
  },

  // Light sources for the night lighting pass.
  lights(add) {
    const a = Game.arena;
    if (a && !a.open) for (let i = 0; i < 10; i++) { const ang = i / 10 * TAU + a.t * 0.2; add(a.x + Math.cos(ang) * a.r, a.y + Math.sin(ang) * a.r, 40, 0.35, a.color); }
    for (const m of this.marks) add(m.x, m.y, m.r * 2, 0.3 + (1 - m.t / m.max) * 0.4, m.kind === 'bolt' ? '#fff060' : m.kind === 'hands' ? '#3aff8a' : '#b0ff40');
    for (const z of Game.zombies) if (z.type.named && !z.burrowed) add(z.x, z.y - 10, 60, 0.5, z.type.arena.color);
  },
};
