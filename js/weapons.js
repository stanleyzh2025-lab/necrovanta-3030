// ============================================================
// weapons.js - every weapon's behaviour: firing, magazines and
// reloading, knife swings, special abilities, projectiles, beams,
// nanodrones, gravity/time fields, and enemy projectiles.
// Weapon numbers live in config.js (WEAPONS); the per-weapon
// special rules are the `case '<id>'` branches below.
// ============================================================

// Guns with physical magazines and shells (the rest reload energy cells).
const BALLISTIC = ['scrap', 'needle', 'ricochet', 'gatling', 'flare', 'mortar', 'seraph', 'revolver', 'crossbow', 'spike'];

const Weapons = {
  noAmmoWarned: -99,
  fireAim: null,
  tasks: [],   // delayed effects: [seconds left, fn] (echo strikes, sticky spikes, meteors)

  later(delay, fn) { this.tasks.push([delay, fn]); },

  updateTasks(dt) {
    for (let i = this.tasks.length - 1; i >= 0; i--) {
      const t = this.tasks[i];
      if ((t[0] -= dt) > 0) continue;
      this.tasks.splice(i, 1);
      t[1]();
    }
  },

  // Per-weapon ability state on the player (hit counters, stacks...).
  ws(p, id) {
    return p.ws[id] || (p.ws[id] = { hits: 0, shots: 0, swings: 0, stacks: 0, stackT: 0, spin: 0 });
  },

  // ---------------------------------------------------------- mods + skins
  // p.mods[id] = { optic: 'scope', core: 'core_fire', ..., mk: { optic: 2 } } (mod ids + their Mk tier)
  mods(p, id) { return (p.mods && p.mods[id]) || {}; },
  modTier(p, id, slot) { const m = this.mods(p, id); return (m.mk && m.mk[slot]) || 1; },
  // The mod in a slot with its stats at the current tier, e.g. { id: 'scope', tier: 2, range: 0.5, ... }.
  mod(p, id, slot) {
    const mid = this.mods(p, id)[slot];
    if (!mid) return null;
    const tier = this.modTier(p, id, slot);
    return Object.assign({ id: mid, tier }, MODS[mid].mk[tier - 1]);
  },
  look(p, w) { return Sprites.look(w.id, this.mods(p, w.id), (p.skin && p.skin[w.id]) || null); },
  magSize(p, w) { const m = this.mod(p, w.id, 'mag'); return m ? Math.round(w.mag * (1 + m.mag)) : w.mag; },
  reloadTime(p, w) { const m = this.mod(p, w.id, 'mag'); return w.reload * (m ? 1 - m.reload : 1) * Classes.stat(p, 'reload'); },
  reach(p, w) { const m = this.mod(p, w.id, 'edge'); return w.reach * (m ? 1 + m.reach : 1); },
  // [main color, glow] for shots and slashes: the skin's colors if one is on.
  colors(p, w) {
    const sk = p.skin && p.skin[w.id];
    return sk ? SKINS[sk].shot : [w.color, w.glow];
  },

  // Everything spawned while a shot is being fired picks up the weapon's mods and skin.
  beginShot(p, w) {
    this.firePlayer = p;
    this.fireScope = this.mod(p, w.id, 'optic');
    this.fireCore = this.mod(p, w.id, 'core');
    this.fireAim = p.aim;
    [this.fireColor, this.fireGlow] = this.colors(p, w);
  },
  endShot() { this.firePlayer = this.fireScope = this.fireCore = null; this.fireColor = this.fireGlow = null; },

  // Elemental core effects, applied on every hit by a modded weapon.
  // core is a mod(...) result: { id, tier, ...stats }; p is the survivor who hit.
  applyCore(z, core, dmg, p = Game.player) {
    if (!core) return;
    switch (core.id) {
      case 'core_fire': Zombies.applyDot(z, 'burn', dmg * core.dot, 2); break;
      case 'core_toxic': Zombies.applyDot(z, 'poison', dmg * core.dot, 3); break;
      case 'core_cryo':
        Zombies.applyStatus(z, 'slow', 1.5);
        if (Math.random() < core.freeze && Zombies.applyStatus(z, 'freeze', 0.6)) FX.burst(z.x, z.y - 6, '#ffffff', 6, 40, 0.3);
        break;
      case 'core_shock': {
        if (Math.random() >= core.chance) break;
        Zombies.applyStatus(z, 'stun', 0.4);
        let best = null, bd = 55 * 55;
        for (const o of Game.zombies) {
          if (o === z || o.dead || o.spawnT > 0) continue;
          const d = dist2(o.x, o.y, z.x, z.y);
          if (d < bd) { bd = d; best = o; }
        }
        if (best) {
          FX.bolt(z.x, z.y - z.hy, best.x, best.y - best.hy, '#fff060');
          Zombies.damage(best, dmg * core.arc, { kb: 10, angle: 0 });
          Zombies.applyStatus(best, 'stun', 0.4);
        }
        Sound.play('zap', z.x, z.y);
        break;
      }
      case 'core_void':
        if (p.hp < p.maxHp) { p.hp = Math.min(p.maxHp, p.hp + dmg * core.leech); if (Math.random() < 0.3) FX.puff(p.x, p.y - 8, '#b05cff', -20, 0.4); }
        break;
    }
  },

  stats(id, lvl) {
    const w = WEAPON_BY_ID[id];
    return { dmg: Math.round(w.dmg * levelDamageMult(lvl)), cd: w.cd };
  },

  // Redshift fires faster the more consecutive hits it lands.
  cooldown(p, w) {
    if (w.id === 'redshift') return w.cd * (1 - 0.06 * this.ws(p, 'redshift').stacks);
    if (w.id === 'gatling') return w.cd - (w.cd - w.minCd) * this.ws(p, 'gatling').spin;
    return w.cd;
  },

  // ---------------------------------------------------------- trigger / ammo
  trigger(p, dt, down) {
    const w = Player.weapon(p);
    const wasDown = p.prevLeft;
    p.prevLeft = down;
    const rs = this.ws(p, 'redshift');
    if (rs.stackT > 0) { rs.stackT -= dt; if (rs.stackT <= 0) rs.stacks = 0; }
    const gs = this.ws(p, 'gatling');
    gs.spin = w && w.id === 'gatling' && down && p.reloadT <= 0 ? Math.min(1, gs.spin + dt / w.spinUp) : Math.max(0, gs.spin - dt * 1.5);
    // Looping motor whine for the Gatling, rising charge whine for charge weapons.
    Sound.loop('motor', gs.spin > 0.02, 45 + gs.spin * 150, gs.spin * 0.05, 'sawtooth', 250 + gs.spin * 1200);
    const ch = w && (w.id === 'photon' || w.id === 'genesis') && p.chargeT > 0 ? Math.min(1, p.chargeT / w.charge) : 0;
    Sound.loop('charge', ch > 0, 260 + ch * 1500, 0.025 + ch * 0.035, 'sine', 4000);
    // Flamethrower roar and chainsword motor while the trigger is held.
    const firing = w && down && p.reloadT <= 0;
    Sound.loop('flame', firing && w.id === 'inferno' && (p.mags.inferno || 0) > 0, 70 + Math.random() * 20, 0.07, 'sawtooth', 700);
    Sound.loop('saw', firing && w.style === 'saw', 95 + Math.sin(Game.time * 30) * 8, 0.05, 'sawtooth', 2200);
    if (!w) return;
    if (w.id === 'genesis') { this.genesisTrigger(p, w, dt, down, wasDown); return; }
    if (w.id === 'photon') { this.photonTrigger(p, w, dt, down); return; }
    if (down) this.tryAttack(p, w);
  },

  tryAttack(p, w) {
    if (p.cooldown > 0 || p.reloadT > 0) return false;
    let mult = levelDamageMult(p.weapons[w.id]);
    if (w.kind === 'knife') {
      const grip = this.mod(p, w.id, 'grip');
      mult *= Classes.meleeMult(p);   // Blade Dancer combo
      p.cooldown = w.cd * (grip ? 1 - grip.haste : 1) * Classes.stat(p, 'meleeSpeed');
      this.melee(p, w, w.dmg * mult, mult);
    } else {
      if (!this.useRound(p, w, 1)) return false;
      p.cooldown = this.cooldown(p, w);
      mult *= Classes.shotMult(p);    // Gunslinger quickdraw
      this.beginShot(p, w);
      this.fire(p, w, mult);
      this.endShot();
    }
    p.lastAttackT = Game.time;
    return true;
  },

  reserve(p, w) { return w.ammo ? p.inv[w.ammo] : Infinity; },

  // Takes rounds from the magazine; starts a reload when it runs dry.
  useRound(p, w, n) {
    const mag = p.mags[w.id] || 0;
    if (mag >= n) { p.mags[w.id] = mag - n; return true; }
    this.startReload(p);
    return false;
  },

  startReload(p) {
    const w = Player.weapon(p);
    if (!w || w.kind !== 'gun' || p.reloadT > 0) return false;
    if ((p.mags[w.id] || 0) >= this.magSize(p, w)) return false;
    if (this.reserve(p, w) <= 0) {
      Sound.play('empty');
      p.cooldown = 0.3;
      if (Game.time - this.noAmmoWarned > 2) {
        this.noAmmoWarned = Game.time;
        UI.toast(`OUT OF ${AMMO[w.ammo].short}! CRAFT MORE (C) OR SWITCH WEAPONS`, '#ff3d4e');
      }
      return false;
    }
    p.reloadT = p.reloadMax = this.reloadTime(p, w);
    p.reloadId = w.id;
    Sound.play(BALLISTIC.includes(w.id) ? 'reload_mag' : 'reload_cell');
    return true;
  },

  updateReload(p, dt) {
    if (p.reloadT <= 0) return;
    const w = Player.weapon(p);
    if (!w || w.id !== p.reloadId) { p.reloadT = 0; return; }
    p.reloadT -= dt;
    if (p.reloadT <= 0) {
      const take = Math.min(this.magSize(p, w) - (p.mags[w.id] || 0), this.reserve(p, w));
      if (w.ammo) p.inv[w.ammo] -= take;
      p.mags[w.id] = (p.mags[w.id] || 0) + take;
      p.reloadT = 0;
      Classes.onReloaded(p);
      Sound.play(BALLISTIC.includes(w.id) ? 'rack' : 'powerup');
      UI.dirty = true;
    }
  },

  muzzle(p, dist = 12) {
    return { x: p.x + Math.cos(p.aim) * dist, y: p.y - 2 + Math.sin(p.aim) * dist };
  },

  // World position of the held gun's barrel tip (matches how render.js draws it).
  barrelTip(p) {
    const w = Player.weapon(p), L = w && this.look(p, w), fx = L && L.fx;
    if (!fx) return this.muzzle(p);
    const img = L.img, a = p.aim;
    const lx = fx.muzzle[0] - GUN_GRIP, ly = (fx.muzzle[1] - Math.floor(img.height / 2)) * (Math.cos(a) < 0 ? -1 : 1);
    const hx = p.x + p.facing * 2, hy = p.y - 3;
    return { x: hx + Math.cos(a) * lx - Math.sin(a) * ly, y: hy + Math.sin(a) * lx + Math.cos(a) * ly };
  },

  // ---------------------------------------------------------- guns
  fire(p, w, mult) {
    if (Net.role === 'guest' && !p.remote) { Net.attack(p, 'fire', w, mult); return; }   // online: the host fires it
    // Shots start just inside the survivor's own box so point-blank shots still
    // land when standing against a wall; the flash is drawn at the barrel tip.
    const a = p.aim, flash = this.barrelTip(p), m = this.muzzle(p, 4), dmg = w.dmg * mult;
    this.curHide = dist(m.x, m.y, flash.x, flash.y);   // bullets become visible at the barrel tip
    p.flashT = 0.05;
    const st = this.ws(p, w.id);
    let pitch = 1;
    p.recoil = w.rarity >= 4 ? 4 : w.id === 'scrap' ? 3 : 2;
    FX.burst(flash.x, flash.y, w.glow, 3, 40, 0.12);
    FX.ring(flash.x, flash.y, 5 + w.rarity, w.color, 0.08);
    FX.light(flash.x, flash.y, 34 + w.rarity * 5, w.color, 0.07);
    switch (w.id) {
      case 'scrap':
        for (let i = 0; i < w.pellets; i++) this.spawnBullet(m.x, m.y, a + (i - 1) * w.spread + rand(-0.04, 0.04), w, dmg, mult);
        FX.burst(p.x, p.y - 2, '#b08a50', 2, 40, 0.5);   // ejected casings
        FX.shake(1.5);
        break;
      case 'ion':
        this.spawnBullet(m.x, m.y, a + rand(-w.spread, w.spread), w, dmg, mult);
        break;
      case 'echo':
        this.spawnBullet(m.x, m.y, a, w, dmg, mult);
        if (++st.shots % w.pulseEvery === 0) {
          this.spawnBullet(m.x, m.y, a, w, dmg, mult, { proj: 'wave', size: 6, pierce: 3, speed: 250, kb: 90 });
          Sound.play('arc');
        }
        break;
      case 'hive':
        this.spawnDrone(m.x, m.y, a, dmg, w);
        break;
      case 'aurora':
        this.beam(m.x, m.y, a, w.range, dmg, w, 4, false, flash);
        FX.shake(3);
        break;
      case 'supernova':
        for (let i = 0; i < w.waves; i++) this.spawnBullet(m.x, m.y, a, w, dmg, mult, { delay: i * 0.14, grow: 26 });
        FX.shake(4);
        break;
      case 'redshift':
        pitch = 1 + st.stacks * 0.08;
        this.spawnBullet(m.x, m.y, a, w, dmg, mult, { color: st.stacks > 6 ? '#ffffff' : st.stacks > 3 ? '#ff9a5a' : w.color });
        break;
      case 'horizon':
        this.spawnBullet(m.x, m.y, a, w, dmg, mult);
        FX.shake(3);
        break;
      case 'gatling':
        pitch = 0.8 + st.spin * 0.5;
        this.spawnBullet(m.x, m.y, a + rand(-w.spread, w.spread) * (0.4 + st.spin * 0.6), w, dmg, mult);
        if (Math.random() < 0.5) FX.burst(p.x, p.y - 2, '#d0b060', 1, 40, 0.4);   // spent casings
        break;
      case 'ricochet':
        this.spawnBullet(m.x, m.y, a, w, dmg, mult).bounces = w.bounces;
        break;
      case 'arcthrower':
        this.chainLightning(p, a, w, dmg);
        break;
      case 'mortar': {
        // Lob a shell at the cursor (clamped to range); it flies over walls and zombies.
        const d = Math.min(w.range, dist(p.x, p.y, Input.mouse.x, Input.mouse.y));
        const b = this.spawnBullet(m.x, m.y, a, w, dmg, mult);
        Object.assign(b, { shell: true, sx: m.x, sy: m.y, tx: p.x + Math.cos(a) * d, ty: p.y + Math.sin(a) * d, dur: Math.max(0.35, d / w.speed), life: 99, h: 0 });
        Sound.whistle(b.dur);
        FX.shake(2);
        break;
      }
      case 'seraph':
        this.launchMissiles(p, m, a, w, dmg, mult);
        FX.shake(3);
        break;
      case 'revolver':
        if (!p.mags.revolver) {   // the last round in the cylinder hits twice as hard
          this.spawnBullet(m.x, m.y, a, w, dmg * 2, mult, { color: '#ffffff', size: 3 });
          FX.float(p.x, p.y - 18, 'LAST ROUND', '#ffd040', 0.6);
          pitch = 0.8;
          FX.shake(2);
        } else this.spawnBullet(m.x, m.y, a, w, dmg, mult);
        break;
      case 'shardsmg': case 'inferno':
        this.spawnBullet(m.x, m.y, a + rand(-w.spread, w.spread), w, dmg, mult, w.id === 'inferno' ? { grow: 26, speed: w.speed * rand(0.85, 1.15) } : {});
        break;
      case 'scatter':
        for (let i = 0; i < w.pellets; i++) this.spawnBullet(m.x, m.y, a + (i / (w.pellets - 1) - 0.5) * w.spread + rand(-0.04, 0.04), w, dmg, mult, { speed: w.speed * rand(0.9, 1.1) });
        FX.shake(2);
        break;
      case 'starfall':
        this.spawnBullet(m.x, m.y, a, w, dmg * 0.3, mult);
        FX.shake(2);
        break;
      case 'necrovanta':
        this.spawnBullet(m.x, m.y, a, w, dmg, mult);
        FX.shake(4);
        break;
      default:
        this.spawnBullet(m.x, m.y, a, w, dmg, mult);
    }
    Sound.gun(w, pitch);
    this.curHide = 0;
  },

  // Genesis Ω: tap for a 70 dmg pulse, hold to charge a 180 dmg beam.
  genesisTrigger(p, w, dt, down, wasDown) {
    if (down && p.reloadT <= 0 && p.cooldown <= 0) {
      p.chargeT += dt;
      if (p.chargeT >= w.charge && !p.charged) { p.charged = true; Sound.play('charge'); }
      if (Math.random() < 0.6) {
        const m = this.muzzle(p, 14);
        FX.puff(m.x + rand(-4, 4), m.y + rand(-4, 4), p.charged ? '#ffffff' : w.color, 0, 0.25);
      }
    }
    if (!down && wasDown && p.chargeT > 0) {
      this.beginShot(p, w);
      const mult = levelDamageMult(p.weapons.genesis);
      const m = this.muzzle(p, 4), tip = this.barrelTip(p);
      p.flashT = 0.06;
      if (p.chargeT >= w.charge) {
        if (this.useRound(p, w, 2)) {
          if (Net.role === 'guest') Net.attack(p, 'gbeam', w, mult);
          else { this.beam(m.x, m.y, p.aim, w.range, w.dmg * mult, w, 5, false, tip); Sound.gun(w, 1, 'genesis_beam'); }
          FX.shake(4);
          p.recoil = 5;
          p.cooldown = w.cd;
          p.lastAttackT = Game.time;
        }
      } else if (this.useRound(p, w, 1)) {
        if (Net.role === 'guest') Net.attack(p, 'gpulse', w, mult);
        else {
          this.curHide = dist(m.x, m.y, tip.x, tip.y);
          this.spawnBullet(m.x, m.y, p.aim, w, w.pulseDmg * mult, mult);
          this.curHide = 0;
          Sound.gun(w, 1, 'genesis');
        }
        p.recoil = 2;
        p.cooldown = w.cd;
        p.lastAttackT = Game.time;
      }
      p.chargeT = 0;
      p.charged = false;
      this.endShot();
    }
    if (!down && !wasDown) { p.chargeT = 0; p.charged = false; }
  },

  spawnBullet(x, y, angle, w, dmg, mult, o = {}) {
    let speed = o.speed || w.speed || 300, range = o.range || w.range;
    const sc = this.fireScope, firing = this.fireAim !== null && this.fireColor;
    if (sc) {   // Holo Scope: longer range, faster shots, tighter spread
      speed *= 1 + sc.speed;
      if (!o.range) range *= 1 + sc.range;
      angle = this.fireAim + angleDiff(angle, this.fireAim) * sc.spread;
    }
    const shooter = this.firePlayer || Game.player;
    if (firing && !o.range) range *= Classes.stat(shooter, 'gunRange');
    const b = {
      x, y, px: x, py: y,
      vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
      angle, dmg, mult: mult || 1,
      life: range / speed,
      critChance: (sc ? sc.crit : 0) + (firing ? Classes.stat(shooter, 'gunCrit') : 0), core: this.fireCore || null, owner: this.firePlayer || null,
      pierce: o.pierce !== undefined ? o.pierce : (w.pierce || 0),
      aoe: o.aoe !== undefined ? o.aoe : (w.aoe || 0),
      kb: o.kb !== undefined ? o.kb : (w.kb || 40),
      wid: w.id, proj: o.proj || w.proj,
      color: o.color || this.fireColor || w.color, glow: this.fireGlow || w.glow,
      size: o.size || w.size || 2, grow: o.grow || 0,
      split: o.split !== undefined ? o.split : w.id === 'prism',
      delay: o.delay || 0, t: 0, hit: [], hitAny: false, hideD: this.curHide || 0,
    };
    Game.bullets.push(b);
    return b;
  },

  // Instant beam (Aurora, Genesis): hits every zombie along the line.
  beam(x0, y0, ang, range, dmg, w, width, throughWalls = false, from = null) {
    const dx = Math.cos(ang), dy = Math.sin(ang), sc = this.fireScope, core = this.fireCore;
    const shooter = this.firePlayer || Game.player;
    const crit = (sc ? sc.crit : 0) + Classes.stat(shooter, 'gunCrit');
    range *= (sc ? 1 + sc.range : 1) * Classes.stat(shooter, 'gunRange');
    const col = this.fireColor || w.color, glowC = this.fireGlow || w.glow;
    let len = range;
    for (let d = 4; d <= range && !throughWalls; d += 4) {
      if (World.blocksShots(toTile(x0 + dx * d), toTile(y0 + dy * d))) { len = d; break; }
    }
    for (const z of Game.zombies) {
      if (z.dead || z.spawnT > 0) continue;
      const zx = z.x - x0, zy = z.y - z.hy - y0;
      const t = clamp(zx * dx + zy * dy, 0, len);
      const ex = zx - dx * t, ey = zy - dy * t;
      if (ex * ex + ey * ey > (z.r + width) ** 2) continue;
      let dd = dmg;
      if (Math.random() < crit) { dd *= 2; FX.float(z.x, z.y - 24, 'CRIT!', '#ffd040', 0.7); }
      Zombies.damage(z, dd, { kb: 70, angle: ang });
      this.applyCore(z, core, dd, shooter);
      FX.burst(z.x, z.y - z.hy, glowC, 5, 60, 0.3);
    }
    // Draw from the barrel tip when the gun isn't poking through a wall.
    const fx0 = from && World.lineClear(x0, y0, from.x, from.y) ? from : { x: x0, y: y0 };
    FX.beam(fx0.x, fx0.y, x0 + dx * len, y0 + dy * len, col, glowC, width + 1, 0.22);
    for (let d = 0; d <= len; d += 40) FX.light(x0 + dx * d, y0 + dy * d, 40, col, 0.22);
    FX.burst(x0 + dx * len, y0 + dy * len, col, 10, 80, 0.4);
  },

  // ---------------------------------------------------------- knives
  melee(p, w, dmg, mult) {
    if (Net.role === 'guest' && !p.remote) { Net.attack(p, 'melee', w, mult); return; }
    const st = this.ws(p, w.id);
    st.swings++;
    p.swingMax = p.swingT = { heavy: 0.26, stab: 0.14, flip: 0.16, saw: 0.1 }[w.style] || 0.18;
    p.swingDir *= -1;
    const cx = p.x, cy = p.y - 2, edge = this.mod(p, w.id, 'edge'), core = this.mod(p, w.id, 'core'), [col, glowC] = this.colors(p, w);
    let reach = this.reach(p, w), arc = w.arc;
    // Eclipse Karambit: every few strikes is a full 360-degree spin.
    const spin = w.spinEvery && st.swings % w.spinEvery === 0;
    if (spin) { reach = w.spinReach * (edge ? 1 + edge.reach : 1); arc = Math.PI * 2; p.spinT = 0.3; FX.ring(cx, cy, reach, col, 0.25); }
    // Balisongs: every few flips land a double strike.
    const combo = w.comboEvery && st.swings % w.comboEvery === 0;
    FX.slash(cx, cy, p.aim, arc, reach, col, spin ? 'spin' : w.style);
    if (combo) FX.slash(cx, cy, p.aim + 0.3 * p.swingDir, arc, reach + 3, glowC, w.style);
    if (w.rarity >= 1 || core) FX.light(cx + Math.cos(p.aim) * 12, cy + Math.sin(p.aim) * 12, 26 + w.rarity * 5, col, 0.14);
    Sound.swing(w, spin || combo);

    // Shadow Piercer: stealth = no attacks and no damage taken for a while.
    const stealth = w.id === 'shadow' && Game.time - p.lastAttackT >= w.stealthTime && Game.time - (p.lastHurtT || -99) >= w.stealthTime;
    let hits = 0, dealt = 0;
    const struck = [];
    const kb = w.id === 'hammer' ? 230 : w.style === 'heavy' ? 100 : w.style === 'saw' ? 12 : w.style === 'flip' ? 35 : 60;
    for (const z of Game.zombies) {
      if (z.dead || z.spawnT > 0) continue;
      const d = dist(cx, cy, z.x, z.y - z.hy);
      if (d > reach + z.r) continue;
      if (Math.abs(angleDiff(Math.atan2(z.y - z.hy - cy, z.x - cx), p.aim)) > arc / 2 && d > z.r + 4) continue;
      let dd = dmg;
      if (w.id === 'shadow' && (stealth || (p.x - z.x) * z.facing < 0)) {
        dd *= 2;
        FX.float(z.x, z.y - 22, stealth ? 'STEALTH X2' : 'BACKSTAB X2', '#c8b8ff', 0.8);
      }
      if (combo) dd *= 2;
      if (edge && Math.random() < edge.crit) { dd *= 2; FX.float(z.x, z.y - 24, 'CRIT!', '#ffffff', 0.7); }
      Zombies.damage(z, dd, { kb, angle: p.aim });
      this.applyCore(z, core, dd, p);
      Sound.play(w.id === 'hammer' ? 'slam' : w.style === 'saw' ? 'shred' : 'slice', z.x, z.y);
      dealt += dd;
      this.knifeHit(p, w, z, mult);
      // Sickle / Venom Karambit: drag zombies in toward you.
      const pull = w.pull || w.hookPull;
      if (pull && d > 10) moveEntity(z, (p.x - z.x) / d * Math.min(d - 10, pull) * (z.type.boss ? BOSS_CC : 1), (p.y - z.y) / d * Math.min(d - 10, pull) * (z.type.boss ? BOSS_CC : 1), z.cr);
      FX.burst(z.x, z.y - z.hy, glowC, 4, 60, 0.25);
      struck.push(z);
      hits++;
    }
    if (combo && hits) FX.float(p.x, p.y - 18, 'FLIP X2', w.color, 0.6);
    if (hits) Classes.onMeleeHit(p);
    // Phantom Balisong: a ghost copy of the strike lands a moment later.
    if (w.echo && hits) {
      const ghost = dmg * w.echo, ang = p.aim;
      this.later(0.12, () => {
        FX.slash(p.x, p.y - 2, ang, arc, reach, '#ffffff', w.style);
        for (const z of struck) if (!z.dead) { Zombies.damage(z, ghost, { kb: 20, angle: ang }); FX.burst(z.x, z.y - z.hy, '#c8d8ff', 5, 50, 0.3); }
        Sound.play('blink');
      });
    }
    // Nebula Scythe: leaves a slowing nebula cloud where the arc landed.
    if (w.nebula) {
      const nx = cx + Math.cos(p.aim) * reach * 0.6, ny = cy + Math.sin(p.aim) * reach * 0.6;
      Game.fields.push({ kind: 'nebula', x: nx, y: ny, r: 26, life: w.nebula, max: w.nebula, tick: 0 });
    }
    if (stealth && hits) Sound.play('stealth');
    if (w.lifesteal && dealt > 0 && p.hp < p.maxHp) {
      const heal = Math.min(p.maxHp - p.hp, dealt * w.lifesteal);
      p.hp += heal;
      FX.float(p.x, p.y - 16, `+${Math.round(heal)}`, '#ff6a8a', 0.6);
      FX.burst(p.x, p.y - 4, '#ff3a5a', 6, 30, 0.4);
    }
    if (hits) FX.shake(w.style === 'heavy' ? 2.5 : 1);

    if (w.id === 'viper' && st.swings % 3 === 0) {
      const m = this.muzzle(p, 4);
      this.spawnBullet(m.x, m.y, p.aim, w, w.arcDmg * mult, mult, { proj: 'wave', size: 6, pierce: 5, speed: 260, range: 150, kb: 60, color: '#ff5cf0' });
      Sound.play('arc');
    }
    if (w.id === 'void' && hits && ++st.hits % w.gravPulse.every === 0) {
      this.gravityPulse(cx + Math.cos(p.aim) * w.reach * 0.7, cy + Math.sin(p.aim) * w.reach * 0.7, w.gravPulse.r, w.gravPulse.dmg * mult);
    }
    if (w.id === 'oblivion') FX.ring(cx + Math.cos(p.aim) * 16, cy + Math.sin(p.aim) * 16, 24, w.color, 0.25);

    // Knives also chop trees, break rocks and strip scrap.
    const tx = toTile(cx), ty = toTile(cy);
    for (let y = ty - 2; y <= ty + 2; y++) for (let x = tx - 2; x <= tx + 2; x++) {
      const n = World.nodeAt(x, y);
      if (!n || n.uses <= 0) continue;
      const nx = (x + 0.5) * TILE, ny = (y + 0.5) * TILE;
      if (dist(cx, cy, nx, ny) > w.reach + 8) continue;
      if (Math.abs(angleDiff(Math.atan2(ny - cy, nx - cx), p.aim)) > w.arc / 2) continue;
      Player.harvest(p, n);
      return;   // one node per swing
    }
  },

  knifeHit(p, w, z, mult) {
    switch (w.id) {
      case 'plasma': Zombies.applyDot(z, 'burn', w.burnDps * mult, w.burnTime); break;
      case 'solar':
        Zombies.applyDot(z, 'burn', w.burnDps * mult, w.burnTime);
        FX.burst(z.x, z.y - 6, '#ffd040', 6, 50, 0.4);
        break;
      case 'shockfang':
        if (Math.random() < w.stunChance && Zombies.applyStatus(z, 'stun', 0.8)) {
          FX.bolt(p.x, p.y - 4, z.x, z.y - z.hy, '#fff060');
          Sound.play('stun', z.x, z.y);
        }
        break;
      case 'hammer':
        if (Zombies.applyStatus(z, 'stun', w.stunTime)) FX.ring(z.x, z.y - 4, 12, '#d0a060', 0.2);
        break;
      case 'glaive':
        this.lightningStrike(z, w.strike * mult, w.color);
        break;
      case 'cryo':
        Zombies.applyStatus(z, 'slow', 2);
        if (Math.random() < w.freezeChance && Zombies.applyStatus(z, 'freeze', 0.8)) Sound.play('freeze', z.x, z.y);
        break;
      case 'hookkara': case 'neonbali':
        Zombies.applyDot(z, 'bleed', w.bleedDps * mult, 3);
        break;
      case 'venomkara':
        Zombies.applyDot(z, 'poison', w.poisonDps * mult, 3);
        break;
      case 'voidbali':
        // Marks stack up; the 5th collapses the zombie into a tiny singularity.
        if (++z.marks >= w.markBurst) {
          z.marks = 0;
          for (const o of Game.zombies) {
            if (o.dead || o.spawnT > 0 || dist2(o.x, o.y, z.x, z.y) > 28 * 28) continue;
            Zombies.damage(o, w.markDmg * mult, { kb: 0, angle: 0 });
          }
          FX.ring(z.x, z.y - 4, 28, w.color, 0.35);
          FX.burst(z.x, z.y - 4, w.glow, 18, -70, 0.45);
          FX.light(z.x, z.y, 70, w.color, 0.3);
          FX.float(z.x, z.y - 24, 'COLLAPSE', w.glow, 0.8);
          Sound.play('gravity', z.x, z.y);
          FX.shake(2);
        }
        break;
    }
  },

  // ---------------------------------------------------------- abilities (right-click / F)
  alt(p) {
    const w = Player.weapon(p);
    if (!w || !w.altCd) return;
    const cd = p.altCd[w.id] || 0;
    if (cd > 0) { Sound.play('error'); UI.toast(`${w.name.toUpperCase()} ABILITY READY IN ${Math.ceil(cd)}s`, '#8a8aa8'); return; }
    const mult = levelDamageMult(p.weapons[w.id]);
    if (Net.role === 'guest' && !p.remote) { Net.attack(p, 'alt', w, mult); p.altCd[w.id] = this.altCd(p, w); return; }   // runs on the host
    switch (w.id) {
      case 'rift':
        this.blink(p, w.blink, w.color);
        break;
      case 'quantum':
        this.blink(p, w.blink, w.color);
        this.melee(p, w, w.dmg * mult, mult);   // strike on arrival
        p.cooldown = w.cd;
        break;
      case 'kunai': {
        const m = this.muzzle(p, 4);
        this.beginShot(p, w);
        this.spawnBullet(m.x, m.y, p.aim, w, w.throwDmg * mult, mult, { proj: 'kunai', speed: 340, range: 230, size: 2, pierce: 1, kb: 40 });
        this.endShot();
        p.swingMax = p.swingT = 0.14;
        Sound.play('throw');
        break;
      }
      case 'katana':
        this.dashSlash(p, w, w.dmg * mult);
        break;
      case 'genesis':
        p.domeT = w.domeTime;
        FX.ring(p.x, p.y - 3, 30, w.color, 0.5);
        Sound.play('dome');
        break;
      case 'oblivion': {
        const r = w.shockwave.r;
        for (const z of Game.zombies) {
          if (z.dead || z.spawnT > 0 || dist2(p.x, p.y, z.x, z.y) > (r + z.r) ** 2) continue;
          Zombies.damage(z, w.shockwave.dmg * mult, { kb: 220, angle: Math.atan2(z.y - p.y, z.x - p.x) });
        }
        FX.ring(p.x, p.y - 2, r, w.color, 0.45);
        FX.ring(p.x, p.y - 2, r * 0.7, w.glow, 0.35);
        FX.light(p.x, p.y, 150, w.color, 0.5);
        FX.burst(p.x, p.y, w.color, 40, 160, 0.6, 2);
        FX.shake(6);
        Sound.play('shockwave');
        break;
      }
    }
    p.altCd[w.id] = this.altCd(p, w);
  },

  // Ability recharge time (Technomancer recharges faster).
  altCd(p, w) { return w.altCd * Classes.stat(p, 'abilityCd'); },

  // Plasma Katana: dash forward (stopping at walls), cutting everything passed.
  dashSlash(p, w, dmg) {
    const a = p.aim, x0 = p.x, y0 = p.y;
    let d = 0;
    for (let s = 2; s <= w.dash; s += 2) {
      if (solidAt(x0 + Math.cos(a) * s, y0 + Math.sin(a) * s, p.r)) break;
      d = s;
    }
    const x1 = x0 + Math.cos(a) * d, y1 = y0 + Math.sin(a) * d;
    for (const z of Game.zombies) {
      if (z.dead || z.spawnT > 0) continue;
      const t = clamp(((z.x - x0) * Math.cos(a) + (z.y - y0) * Math.sin(a)), 0, d);
      if (dist2(z.x, z.y, x0 + Math.cos(a) * t, y0 + Math.sin(a) * t) > (z.r + 12) ** 2) continue;
      Zombies.damage(z, dmg, { kb: 50, angle: a + Math.PI / 2 });
      this.applyCore(z, this.mod(p, w.id, 'core'), dmg, p);
      FX.burst(z.x, z.y - z.hy, w.glow, 8, 70, 0.3);
    }
    for (let s = 0; s < d; s += 6) FX.puff(x0 + Math.cos(a) * s, y0 - 3 + Math.sin(a) * s, s % 12 ? w.color : '#ffffff', 0, 0.3);
    FX.beam(x0, y0 - 3, x1, y1 - 3, w.color, w.glow, 2, 0.18);
    p.x = x1; p.y = y1;
    p.invT = Math.max(p.invT, 0.25);
    p.spinT = 0.3;
    FX.slash(p.x, p.y - 2, a, Math.PI * 2, 28, w.color, 'spin');
    FX.light(p.x, p.y, 60, w.color, 0.25);
    FX.shake(3);
    Sound.play('dash');
  },

  // Short-range teleport toward the cursor; can pass over obstacles.
  blink(p, maxD, color) {
    const a = p.aim, d = Math.min(maxD, dist(p.x, p.y, Input.mouse.x, Input.mouse.y));
    let lx = p.x, ly = p.y;
    for (let s = 4; s <= d; s += 2) {
      const nx = p.x + Math.cos(a) * s, ny = p.y + Math.sin(a) * s;
      if (!solidAt(nx, ny, p.r)) { lx = nx; ly = ny; }
    }
    FX.burst(p.x, p.y - 3, color, 16, 70, 0.45);
    FX.ring(p.x, p.y - 3, 14, color, 0.25);
    p.x = lx; p.y = ly;
    FX.burst(p.x, p.y - 3, color, 16, 70, 0.45);
    FX.ring(p.x, p.y - 3, 18, color, 0.3);
    p.invT = Math.max(p.invT, 0.3);
    FX.light(p.x, p.y, 70, color, 0.3);
    Sound.play('blink');
  },

  // Pulls zombies toward a point and damages them (Void Shredder).
  gravityPulse(x, y, r, dmg) {
    for (const z of Game.zombies) {
      if (z.dead || z.spawnT > 0) continue;
      const d = dist(x, y, z.x, z.y);
      if (d > r + z.r) continue;
      const pull = Math.min(d, 18) * (z.type.boss ? BOSS_CC : 1);
      moveEntity(z, (x - z.x) / (d || 1) * pull, (y - z.y) / (d || 1) * pull, z.cr);
      Zombies.damage(z, dmg, { dot: true });
    }
    FX.ring(x, y, r, '#8a3aff', 0.35);
    FX.burst(x, y, '#ff5cf0', 14, -60, 0.4);
    Sound.play('gravity', x, y);
  },

  // ---------------------------------------------------------- projectiles
  updateBullets(dt) {
    const list = Game.bullets;
    for (let i = list.length - 1; i >= 0; i--) {
      const b = list[i];
      if (b.delay > 0) { b.delay -= dt; continue; }
      b.t += dt;
      b.life -= dt;
      b.size += b.grow * dt;
      b.px = b.x; b.py = b.y;
      if (b.shell) { if (this.updateShell(b, dt)) list.splice(i, 1); continue; }
      if (b.proj === 'cyclone') this.cyclonePull(b, dt);
      if (b.proj === 'missile' || b.proj === 'wisp') this.steerMissile(b, dt);
      const steps = Math.max(1, Math.ceil((Math.abs(b.vx) + Math.abs(b.vy)) * dt / 5));
      let end = null;
      for (let s = 0; s < steps && !end; s++) {
        const sx = b.x, sy = b.y;
        b.x += b.vx * dt / steps;
        b.y += b.vy * dt / steps;
        if (World.blocksShots(toTile(b.x), toTile(b.y))) {
          if (b.bounces > 0) { this.bounce(b, sx, sy); continue; }
          end = 'wall';
          break;
        }
        for (const z of Game.zombies) {
          if (z.dead || z.spawnT > 0 || b.hit.includes(z)) continue;
          const rr = z.r + b.size + 1;
          if (dist2(b.x, b.y, z.x, z.y - z.hy) > rr * rr) continue;
          if (b.aoe) this.explode(b);   // explode, and keep flying if it still pierces
          else { this.onHit(b, z); b.hit.push(z); }
          if (b.pierce-- <= 0) { end = 'hit'; break; }
        }
      }
      if (!end && b.life <= 0) end = 'expire';
      if (end) { this.onEnd(b, end); list.splice(i, 1); }
    }
  },

  onHit(b, z) {
    const w = WEAPON_BY_ID[b.wid], p = b.owner || Game.player;
    let dmg = b.dmg;
    if (b.wid === 'needle' && Math.random() < w.critChance) {
      dmg *= 2;
      FX.float(z.x, z.y - 24, 'WEAK POINT!', '#ffd040', 0.9);
      Sound.play('crit');
    }
    if (b.critChance && Math.random() < b.critChance) { dmg *= 2; FX.float(z.x, z.y - 24, 'CRIT!', '#ffd040', 0.7); }
    Zombies.damage(z, dmg, { kb: b.kb, angle: b.angle });
    this.applyCore(z, b.core, dmg, p);
    FX.burst(b.x, b.y, b.color, 3, 40, 0.2);
    b.hitAny = true;
    if (!w) return;   // turret bullets
    switch (b.wid) {
      case 'nova': {
        const st = this.ws(p, 'nova');
        if (++st.hits % w.slowEvery === 0) { Zombies.applyStatus(z, 'slow', 2.5); FX.ring(z.x, z.y - 3, 10, '#9fe8ff', 0.25); }
        break;
      }
      case 'ion':
        if (Math.random() < w.stunChance && Zombies.applyStatus(z, 'stun', 0.6)) Sound.play('stun', z.x, z.y);
        break;
      case 'venom':
        Zombies.applyDot(z, 'poison', w.poisonDps * b.mult, w.poisonTime);
        break;
      case 'flare':
        Zombies.applyDot(z, 'burn', w.burnDps * b.mult, 3);
        break;
      case 'prism':
        if (b.split) {
          ['#ff5a5a', '#5aff8a', '#5ab0ff'].forEach((col, k) => {
            const nb = this.spawnBullet(b.x, b.y, b.angle + (k - 1) * 0.4, w, w.splitDmg * b.mult, b.mult, { split: false, range: 130, size: 1, color: col, proj: 'prismlet' });
            nb.hit.push(z);
          });
        }
        break;
      case 'antigrav':
        if (Zombies.applyStatus(z, 'lift', w.liftTime)) Sound.play('lift', z.x, z.y);
        break;
      case 'redshift': {
        const st = this.ws(p, 'redshift');
        st.stacks = Math.min(w.maxStacks, st.stacks + 1);
        st.stackT = 1.2;
        break;
      }
      case 'shardsmg':
        if (b.proj === 'shard') for (let k = 0; k < w.shards; k++) {
          const nb = this.spawnBullet(b.x, b.y, b.angle + rand(-0.9, 0.9), w, b.dmg * 0.4, b.mult, { proj: 'shardlet', range: 60, size: 1, speed: 260 });
          nb.hit.push(z);
        }
        break;
      case 'scatter': case 'inferno':
        Zombies.applyDot(z, 'burn', w.burnDps * b.mult, 2.5);
        break;
      case 'crossbow':
        if (b.pierce <= 0 && Zombies.applyStatus(z, 'stun', w.pinTime)) FX.float(z.x, z.y - 22, 'PINNED', w.color, 0.6);
        break;
      case 'spike':
        // Sticks into the zombie and detonates after the fuse.
        z.stickT = w.fuse;
        this.later(w.fuse, () => {
          const x = z.x, y = z.y - z.hy;
          for (const o of Game.zombies) {
            if (o.dead || o.spawnT > 0 || dist2(o.x, o.y - o.hy, x, y) > 22 * 22) continue;
            Zombies.damage(o, w.stickDmg * b.mult, { kb: 80, angle: Math.atan2(o.y - y, o.x - x) });
          }
          z.stickT = 0;
          FX.ring(x, y, 20, w.color, 0.3);
          FX.burst(x, y, w.color, 12, 80, 0.4);
          FX.light(x, y, 50, w.color, 0.25);
          Sound.play('explode', x, y);
        });
        break;
      case 'kunai': case 'necrovanta': {
        if (b.wid === 'necrovanta' && b.proj === 'soul' && p.hp < p.maxHp) {   // drains life as it passes through
          p.hp = Math.min(p.maxHp, p.hp + b.dmg * w.drain);
          FX.puff(z.x, z.y - 6, '#3aff8a', -30, 0.5);
        }
        break;
      }
    }
  },

  onEnd(b, reason) {
    if (b.aoe && reason !== 'hit') this.explode(b);
    if (b.wid === 'chrono') this.chronoField(b);
    if (b.wid === 'flare') {
      const w = WEAPON_BY_ID.flare;
      Game.hazards.push({ x: b.x - b.vx * 0.02, y: b.y - b.vy * 0.02, r: 14, kind: 'flare', life: w.flareTime, max: w.flareTime, friendly: true, dmg: w.burnDps * b.mult * 0.5 });
    }
    if (b.wid === 'redshift' && !b.hitAny) this.ws(b.owner || Game.player, 'redshift').stacks = 0;
    if (b.proj === 'beacon') this.callMeteors(b);
    if (b.proj === 'soul') this.soulBurst(b);
    if (reason === 'wall' && !b.aoe) {
      FX.burst(b.x - b.vx * 0.01, b.y - b.vy * 0.01, b.color, 4, 40, 0.2);
      Sound.play('impact', b.x, b.y);
    }
  },

  explode(b) {
    const w = WEAPON_BY_ID[b.wid], r = b.aoe;
    for (const z of Game.zombies) {
      if (z.dead || z.spawnT > 0 || b.hit.includes(z)) continue;
      if (dist2(b.x, b.y, z.x, z.y - z.hy) > (r + z.r) * (r + z.r)) continue;
      b.hit.push(z);
      Zombies.damage(z, b.dmg, { kb: 70, angle: Math.atan2(z.y - b.y, z.x - b.x) });
      this.applyCore(z, b.core, b.dmg, b.owner || Game.player);
      if (b.wid === 'glacier') { Zombies.applyStatus(z, 'freeze', w.freezeTime); Zombies.applyStatus(z, 'slow', 2.5); }
      if (b.wid === 'mortar') Zombies.applyStatus(z, 'lift', 0.6);
    }
    b.hitAny = true;
    FX.light(b.x, b.y, r * 2.6, b.color, 0.35);
    FX.ring(b.x, b.y, r, b.color, 0.35);
    FX.burst(b.x, b.y, b.color, 14, 90, 0.45);
    FX.burst(b.x, b.y, b.glow, 6, 50, 0.3);
    switch (b.wid) {
      case 'glacier':
        FX.burst(b.x, b.y, '#ffffff', 10, 110, 0.5);
        Sound.play('freeze', b.x, b.y);
        FX.shake(1);
        break;
      case 'magma':
        Game.hazards.push({ x: b.x, y: b.y, r: 24, kind: 'burn', life: w.fieldTime, max: w.fieldTime, friendly: true, dmg: w.fieldDps * b.mult * 0.5 });
        Sound.play('explode', b.x, b.y);
        FX.shake(2);
        break;
      case 'chrono':
        FX.burst(b.x, b.y, '#9ff8ff', 10, 80, 0.5);
        break;
      case 'horizon': {
        const s = w.singularity;
        Game.fields.push({ kind: 'singularity', x: b.x, y: b.y, r: s.r, life: s.life, max: s.life, dps: s.dps * b.mult, pull: s.pull, tick: 0 });
        Sound.play('gravity', b.x, b.y);
        FX.shake(4);
        break;
      }
      default:
        Sound.play(b.aoe >= 28 ? 'explode_big' : 'explode', b.x, b.y);
        FX.shake(2);
    }
  },

  chronoField(b) {
    const w = WEAPON_BY_ID.chrono;
    Game.fields.push({ kind: 'chrono', x: b.x, y: b.y, r: w.fieldRadius, life: w.fieldTime, max: w.fieldTime, tick: 0 });
    FX.ring(b.x, b.y, w.fieldRadius, '#ffe08a', 0.4);
    FX.ring(b.x, b.y, w.fieldRadius * 0.6, '#9ff8ff', 0.3);
    Sound.play('freeze', b.x, b.y);
  },

  // Vortex Cyclone drags nearby zombies into its path.
  cyclonePull(b, dt) {
    const w = WEAPON_BY_ID.vortex;
    for (const z of Game.zombies) {
      if (z.dead || z.spawnT > 0) continue;
      const d = dist(b.x, b.y, z.x, z.y);
      if (d > w.pullRadius || d < 2) continue;
      const f = w.pull * dt * (z.type.boss ? BOSS_CC : 1);
      moveEntity(z, (b.x - z.x) / d * f, (b.y - z.y) / d * f, z.cr);
    }
    if (Math.random() < 0.8) {
      const a = b.t * 14 + Math.random() * 6;
      FX.puff(b.x + Math.cos(a) * 9, b.y + Math.sin(a) * 9, Math.random() < 0.5 ? b.color : b.glow, 0, 0.25);
    }
  },

  // ---------------------------------------------------------- second-arsenal helpers
  // Photon Lance: hold to charge, fires automatically when full (through walls).
  photonTrigger(p, w, dt, down) {
    if (!down || p.reloadT > 0 || p.cooldown > 0) { if (!down) { p.chargeT = 0; p.charged = false; } return; }
    p.chargeT += dt;
    p.charged = p.chargeT >= w.charge * 0.6;
    const m = this.muzzle(p, 16);
    if (Math.random() < 0.7) FX.puff(m.x + rand(-3, 3), m.y + rand(-3, 3), p.charged ? '#ffffff' : w.color, 0, 0.2);
    if (p.chargeT < w.charge) return;
    p.chargeT = 0;
    p.charged = false;
    if (!this.useRound(p, w, 1)) return;
    const o = this.muzzle(p, 4), mult = levelDamageMult(p.weapons.photon);
    p.flashT = 0.07;
    this.beginShot(p, w);
    if (Net.role === 'guest') Net.attack(p, 'photon', w, mult);
    else { this.beam(o.x, o.y, p.aim, w.range, w.dmg * mult, w, 5, true, this.barrelTip(p)); Sound.gun(w, 1, 'photon'); }
    this.endShot();
    FX.shake(5);
    p.recoil = 6;
    p.cooldown = w.cd;
    p.lastAttackT = Game.time;
  },

  // Arc Thrower: lightning jumps from the nearest zombie in front to its neighbours.
  chainLightning(p, a, w, dmg) {
    let fx = p.x + Math.cos(a) * 8, fy = p.y - 2 + Math.sin(a) * 8;
    const hit = [];
    for (let i = 0; i < w.chains; i++) {
      let best = null, bd = Infinity;
      for (const z of Game.zombies) {
        if (z.dead || z.spawnT > 0 || hit.includes(z)) continue;
        const d = dist(fx, fy, z.x, z.y - z.hy);
        if (i === 0) {
          // Measured from the survivor so zombies pressed right up against you still count.
          const dp = dist(p.x, p.y - 2, z.x, z.y - z.hy);
          if (dp > w.range || (dp > z.r + 10 && Math.abs(angleDiff(Math.atan2(z.y - z.hy - p.y + 2, z.x - p.x), a)) > 0.55)) continue;
          if (d < bd && World.lineClear(p.x, p.y - 2, z.x, z.y - z.hy)) { bd = d; best = z; }
          continue;
        } else if (d > 70) continue;
        if (d < bd && World.lineClear(fx, fy, z.x, z.y - z.hy)) { bd = d; best = z; }
      }
      if (!best) break;
      FX.bolt(fx, fy, best.x, best.y - best.hy, w.color);
      FX.bolt(fx, fy, best.x, best.y - best.hy, '#ffffff', 0.08);
      FX.light(best.x, best.y, 40, w.color, 0.15);
      Zombies.damage(best, dmg * Math.pow(0.8, i), { kb: 25, angle: Math.atan2(best.y - fy, best.x - fx) });
      this.applyCore(best, this.fireCore, dmg * Math.pow(0.8, i), p);
      hit.push(best);
      fx = best.x; fy = best.y - best.hy;
    }
    if (!hit.length) {
      const ex = fx + Math.cos(a) * w.range * 0.6, ey = fy + Math.sin(a) * w.range * 0.6;
      FX.bolt(fx, fy, ex, ey, w.color, 0.1);
    }
  },

  // Storm Glaive: lightning from the sky on the target, chaining to 2 neighbours.
  lightningStrike(z, dmg, color) {
    const sx = z.x + rand(-6, 6), sy = z.y - 90;
    FX.bolt(sx, sy, z.x, z.y - z.hy, '#ffffff');
    FX.bolt(sx + 2, sy, z.x, z.y - z.hy, color, 0.2);
    FX.light(z.x, z.y, 70, color, 0.25);
    Zombies.damage(z, dmg, { kb: 20, angle: 0 });
    let from = z;
    const hit = [z];
    for (let i = 0; i < 2; i++) {
      let best = null, bd = 50 * 50;
      for (const o of Game.zombies) {
        if (o.dead || o.spawnT > 0 || hit.includes(o)) continue;
        const d = dist2(from.x, from.y, o.x, o.y);
        if (d < bd) { bd = d; best = o; }
      }
      if (!best) break;
      FX.bolt(from.x, from.y - from.hy, best.x, best.y - best.hy, color);
      Zombies.damage(best, dmg * 0.7, { kb: 15, angle: 0 });
      hit.push(best);
      from = best;
    }
    Sound.play('zap', z.x, z.y);
  },

  // Ricochet: reflect off whichever wall face was hit.
  bounce(b, sx, sy) {
    const hitX = World.blocksShots(toTile(b.x), toTile(sy));
    const hitY = World.blocksShots(toTile(sx), toTile(b.y));
    if (hitX) b.vx = -b.vx;
    if (hitY) b.vy = -b.vy;
    if (!hitX && !hitY) { b.vx = -b.vx; b.vy = -b.vy; }
    b.x = sx; b.y = sy;
    b.angle = Math.atan2(b.vy, b.vx);
    b.bounces--;
    b.hit = [];
    FX.burst(sx, sy, b.color, 5, 50, 0.2);
    FX.light(sx, sy, 24, b.color, 0.1);
    Sound.play('ping', sx, sy);
  },

  // Mortar shells arc through the air and burst where they land.
  updateShell(b, dt) {
    const k = Math.min(1, b.t / b.dur);   // b.t is advanced by updateBullets
    b.x = lerp(b.sx, b.tx, k);
    b.y = lerp(b.sy, b.ty, k);
    b.h = b.meteor ? (1 - k) * 150 : Math.sin(k * Math.PI) * Math.min(70, dist(b.sx, b.sy, b.tx, b.ty) * 0.45);
    if (Math.random() < 0.6) FX.puff(b.x, b.y - b.h, b.meteor ? '#ffb040' : '#b090d0', 0, 0.3);
    if (k < 1) return false;
    this.explode(b);
    return true;
  },

  // Starfall Launcher: the beacon calls meteors down around where it landed.
  callMeteors(b) {
    const w = WEAPON_BY_ID.starfall, dmg = w.dmg * b.mult;
    FX.ring(b.x, b.y, 34, w.color, 0.5);
    Sound.play('beacon', b.x, b.y);
    for (let i = 0; i < w.meteors; i++) {
      this.later(0.3 + i * 0.13, () => {
        const tx = b.x + rand(-30, 30), ty = b.y + rand(-30, 30);
        const m = this.spawnBullet(tx, ty, 0, w, dmg, b.mult, { aoe: w.meteorAoe, proj: 'meteor' });
        Object.assign(m, { shell: true, meteor: true, sx: tx - 40, sy: ty, tx, ty, dur: 0.4, life: 99, h: 150 });
        Sound.whistle(0.4);
      });
    }
  },

  // NECROVANTA: the soul orb bursts and releases hunting souls.
  soulBurst(b) {
    const w = WEAPON_BY_ID.necrovanta;
    b.hit = [];
    b.aoe = w.burstR;
    this.explode(b);
    b.aoe = 0;
    for (let i = 0; i < w.souls; i++) {
      const s = this.spawnBullet(b.x, b.y, i / w.souls * Math.PI * 2, w, w.soulDmg * b.mult, b.mult, { proj: 'wisp', speed: 120, range: 500, size: 2, pierce: 0, kb: 20 });
      s.delay = i * 0.03;
    }
    Sound.play('souls', b.x, b.y);
  },

  // Seraph Swarm: each missile picks its own target (nearest first) and homes in.
  launchMissiles(p, m, a, w, dmg, mult) {
    const targets = Game.zombies.filter(z => !z.dead && z.spawnT <= 0 && dist2(z.x, z.y, p.x, p.y) < 320 * 320)
      .sort((z1, z2) => dist2(z1.x, z1.y, Input.mouse.x, Input.mouse.y) - dist2(z2.x, z2.y, Input.mouse.x, Input.mouse.y));
    for (let i = 0; i < w.missiles; i++) {
      const b = this.spawnBullet(m.x, m.y, a + (i - (w.missiles - 1) / 2) * 0.45, w, dmg, mult);
      b.target = targets.length ? targets[i % targets.length] : null;
      b.delay = i * 0.06;
    }
  },

  steerMissile(b, dt) {
    if (!b.target || b.target.dead) {
      let best = null, bd = 260 * 260;
      for (const z of Game.zombies) {
        if (z.dead || z.spawnT > 0) continue;
        const d = dist2(b.x, b.y, z.x, z.y);
        if (d < bd) { bd = d; best = z; }
      }
      b.target = best;
    }
    const sp = Math.min(340, Math.hypot(b.vx, b.vy) + 260 * dt);
    let a = Math.atan2(b.vy, b.vx);
    if (b.target) a += clamp(angleDiff(Math.atan2(b.target.y - b.target.hy - b.y, b.target.x - b.x), a), -5 * dt, 5 * dt);
    b.vx = Math.cos(a) * sp; b.vy = Math.sin(a) * sp; b.angle = a;
    const trail = b.proj === 'wisp' ? (Math.random() < 0.5 ? '#3aff8a' : '#e0ffe8') : Math.random() < 0.5 ? '#c8c0b0' : '#ffd040';
    if (Math.random() < 0.8) FX.puff(b.x - b.vx * 0.02, b.y - b.vy * 0.02, trail, 0, 0.35);
  },

  // ---------------------------------------------------------- fields + drones
  updateFields(dt) {
    for (let i = Game.fields.length - 1; i >= 0; i--) {
      const f = Game.fields[i];
      f.life -= dt;
      if (f.life <= 0) { Game.fields.splice(i, 1); continue; }
      f.tick -= dt;
      const doTick = f.tick <= 0;
      if (doTick) f.tick = 0.25;
      for (const z of Game.zombies) {
        if (z.dead || z.spawnT > 0) continue;
        const d = dist(f.x, f.y, z.x, z.y);
        if (d > f.r + z.r) continue;
        if (f.kind === 'chrono') {
          z.chronoT = Math.max(z.chronoT, 0.25);
        } else if (f.kind === 'nebula') {
          Zombies.applyStatus(z, 'slow', 0.4);
        } else {
          const pull = f.pull * dt * (z.type.boss ? BOSS_CC : 1) * (0.5 + 0.5 * (1 - d / f.r));
          if (d > 3) moveEntity(z, (f.x - z.x) / d * pull, (f.y - z.y) / d * pull, z.cr);
          if (doTick) Zombies.damage(z, f.dps * 0.25, { dot: true });
        }
      }
      if (f.kind === 'singularity' && Math.random() < 0.9) {
        const a = Math.random() * Math.PI * 2, rr = f.r * (0.4 + Math.random() * 0.6);
        FX.particles.push({ x: f.x + Math.cos(a) * rr, y: f.y + Math.sin(a) * rr, vx: -Math.cos(a) * rr * 2, vy: -Math.sin(a) * rr * 2, life: 0.4, max: 0.4, color: Math.random() < 0.5 ? '#b05cff' : '#ff9cf0', size: 1 });
      }
    }
  },

  spawnDrone(x, y, angle, dmg, w) {
    Game.drones.push({ x, y, vx: Math.cos(angle) * w.speed, vy: Math.sin(angle) * w.speed, target: null, retarget: 0, hits: w.droneHits, life: w.droneLife, dmg, cd: 0, t: 0 });
  },

  updateDrones(dt) {
    const p = Game.player;
    for (let i = Game.drones.length - 1; i >= 0; i--) {
      const d = Game.drones[i];
      d.life -= dt; d.cd -= dt; d.retarget -= dt; d.t += dt;
      if (d.life <= 0 || d.hits <= 0) { FX.burst(d.x, d.y, '#ffd040', 6, 40, 0.3); Game.drones.splice(i, 1); continue; }
      if (!d.target || d.target.dead || d.retarget <= 0) {
        d.retarget = 0.3;
        let best = null, bd = 220 * 220;
        for (const z of Game.zombies) {
          if (z.dead || z.spawnT > 0) continue;
          const dd = dist2(d.x, d.y, z.x, z.y);
          if (dd < bd) { bd = dd; best = z; }
        }
        d.target = best;
      }
      // Steer toward the target, or orbit the player while idle.
      const tx = d.target ? d.target.x : p.x + Math.cos(d.t * 3) * 18;
      const ty = d.target ? d.target.y - d.target.hy : p.y - 10 + Math.sin(d.t * 3) * 10;
      const dx = tx - d.x, dy = ty - d.y, len = Math.hypot(dx, dy) || 1;
      d.vx += (dx / len * 190 - d.vx) * Math.min(1, dt * 6);
      d.vy += (dy / len * 190 - d.vy) * Math.min(1, dt * 6);
      d.x += d.vx * dt;
      d.y += d.vy * dt;
      if (d.target && d.cd <= 0 && len < d.target.r + 4) {
        Zombies.damage(d.target, d.dmg, { kb: 15, angle: Math.atan2(dy, dx) });
        FX.burst(d.x, d.y, '#fff0a0', 4, 50, 0.2);
        Sound.play('drone', d.x, d.y);
        d.hits--;
        d.cd = 0.28;
        d.vx = -d.vx * 0.6; d.vy = -d.vy * 0.6;   // bounce off for the next strike
      }
    }
  },

  // Genesis dome pushes zombies out and blocks their lasers.
  updateDome(p) {
    if (p.domeT <= 0) return;
    for (const z of Game.zombies) {
      if (z.dead) continue;
      const d = dist(p.x, p.y, z.x, z.y), r = 26 + z.r;
      if (d < r && d > 0.1) moveEntity(z, (z.x - p.x) / d * (r - d), (z.y - p.y) / d * (r - d), z.cr);
    }
  },

  // ---------------------------------------------------------- enemy projectiles
  updateEnemyShots(dt) {
    const list = Game.enemyShots, players = Net.livePlayers();
    for (let i = list.length - 1; i >= 0; i--) {
      const s = list[i];
      // Spitter acid: an arcing glob that splashes where it lands.
      if (s.kind === 'glob') {
        s.t += dt;
        const k = Math.min(1, s.t / s.dur);
        s.x = lerp(s.x0, s.tx, k);
        s.y = lerp(s.y0, s.ty, k);
        s.h = Math.sin(k * Math.PI) * 40;
        if (k >= 1) {
          for (const p of players) if (dist2(s.tx, s.ty, p.x, p.y) < 16 * 16) { Player.damage(p, s.dmg); p.poisonT = Math.max(p.poisonT, 3); }
          if (!s.noPool) Game.hazards.push({ x: s.tx, y: s.ty, r: 14, kind: 'toxic', life: 3.5, max: 3.5 });
          FX.burst(s.tx, s.ty, '#b0ff40', 12, 60, 0.4);
          Sound.play('splat', s.tx, s.ty);
          list.splice(i, 1);
        }
        continue;
      }
      // Homing shots curve toward the nearest survivor.
      const p = Zombies.targetFor(s, players.length ? players : [Game.player]);
      // Voltrax ball lightning: slow, curving orbs.
      if (s.kind === 'orb') {
        let a = Math.atan2(s.vy, s.vx);
        a += clamp(angleDiff(Math.atan2(p.y - 3 - s.y, p.x - s.x), a), -1.1 * dt, 1.1 * dt);
        s.vx = Math.cos(a) * 70; s.vy = Math.sin(a) * 70;
        if (Math.random() < 0.5) FX.puff(s.x, s.y, Math.random() < 0.5 ? '#fff060' : '#ffffff', 0, 0.2);
      }
      // Juggernaut rockets home in slowly and explode.
      if (s.kind === 'rocket') {
        let a = Math.atan2(s.vy, s.vx);
        a += clamp(angleDiff(Math.atan2(p.y - 3 - s.y, p.x - s.x), a), -1.6 * dt, 1.6 * dt);
        s.vx = Math.cos(a) * 95; s.vy = Math.sin(a) * 95;
        if (Math.random() < 0.7) FX.puff(s.x - s.vx * 0.05, s.y - s.vy * 0.05, '#8a8a8a', 0, 0.5);
      }
      s.life -= dt;
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      let dead = s.life <= 0;
      const tx = toTile(s.x), ty = toTile(s.y);
      if (!dead && World.blocksShots(tx, ty)) dead = true;
      if (!dead) {
        const st = World.structAt(tx, ty);
        if (st && st.def.solid) { Structures.damage(st, s.dmg); dead = true; }
      }
      for (const q of players) {
        if (dead) break;
        if (q.domeT > 0 && dist2(s.x, s.y, q.x, q.y - 3) < 28 * 28) {   // Genesis dome blocks it
          FX.burst(s.x, s.y, '#fff27a', 6, 50, 0.25);
          dead = true;
        } else if (dist2(s.x, s.y, q.x, q.y - 3) < (q.r + 2) * (q.r + 2)) {
          if (s.kind !== 'rocket') Player.damage(q, s.dmg);
          dead = true;
        }
      }
      if (dead) {
        if (s.kind === 'rocket') {
          // Rockets burst: hurt survivors and structures nearby.
          for (const q of players) if (dist2(s.x, s.y, q.x, q.y) < 30 * 30) Player.damage(q, s.dmg);
          for (const st of Game.structures) if (!st.dead && dist2(s.x, s.y, st.x, st.y) < 30 * 30) Structures.damage(st, s.dmg);
          FX.ring(s.x, s.y, 26, '#ffb040', 0.3);
          FX.burst(s.x, s.y, '#ffb040', 14, 80, 0.4);
          FX.light(s.x, s.y, 70, '#ffb040', 0.3);
          Sound.play('explode', s.x, s.y);
        } else FX.burst(s.x, s.y, s.color, 4, 40, 0.2);
        list.splice(i, 1);
      }
    }
  },
};
