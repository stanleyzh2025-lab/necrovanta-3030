// ============================================================
// zombies.js - spawning, simple chase AI, special attacks,
// status effects, taking damage and dying. AI rule: follow the
// flow field toward the player; smash any wall in the way;
// sometimes go for turrets. Each type adds one simple trick.
// ============================================================

const Zombies = {
  nextUid: 0,

  spawn(typeId, x, y) {
    const t = ZOMBIE_TYPES[typeId];
    const w = Math.max(1, Game.wave);
    const hp = t.hp * waveHpMult(w);
    const z = {
      id: typeId, type: t, uid: ++this.nextUid,
      x, y, vx: 0, vy: 0,
      // r = hitbox, cr = map collision box (small so crowds fit through 1-tile gaps)
      r: t.r, cr: t.scale ? 6.5 : t.bulky ? 5 : typeId === 'leech' ? 3 : 4,
      hy: t.hy !== undefined ? t.hy : t.scale ? 10 : 3,   // hitbox center height above the feet
      hp, maxHp: hp,
      speed: t.speed * waveSpeedMult(w) * rand(0.9, 1.1),
      dmg: t.dmg * waveDmgMult(w),
      atkT: rand(0.3, 0.8), special: rand(1.5, 3.5), chargeT: 0,
      anim: Math.random() * 4, facing: 1, lunge: 0,
      flashT: 0, groanT: rand(1, 8),
      // status effects (seconds remaining)
      slowT: 0, freezeT: 0, stunT: 0, liftT: 0, chronoT: 0,
      burnT: 0, burnDps: 0, poisonT: 0, poisonDps: 0, bleedT: 0, bleedDps: 0, dotT: 0, spikeT: 0, marks: 0, stickT: 0,
      kbx: 0, kby: 0,
      target: null, retargetT: 0,
      ax: x, ay: y, stuckT: 0,              // stuck detection anchor
      spawnT: 0.5,
      shieldA: 0,                           // riot shield facing
      mode: null, modeT: 0, chDir: 0,       // brute charge state
      fuse: 0, tp: null, summoned: 0, bossT: 4, laserT: 6,
      dead: false,
    };
    Game.zombies.push(z);
    FX.burst(x, y, t.final ? '#ff5cf0' : '#5aff6a', t.final ? 30 : 8, 30, 0.6);
    return z;
  },

  // Crowd control. Bosses and armored types resist; some types are immune. Returns true if applied.
  applyStatus(z, kind, time) {
    const t = z.type;
    if (t.immune === kind || (t.immune === 'slow' && kind === 'freeze')) return false;
    if (t.boss && kind !== 'slow') time *= BOSS_CC;
    if (t.ccResist && kind !== 'slow') time *= 1 - t.ccResist;
    if (kind === 'slow') z.slowT = Math.max(z.slowT, time);
    else if (kind === 'freeze') z.freezeT = Math.max(z.freezeT, time);
    else if (kind === 'stun') z.stunT = Math.max(z.stunT, time);
    else if (kind === 'lift') z.liftT = Math.max(z.liftT, time);
    if (kind !== 'slow' && z.mode) z.mode = null;   // interrupts a brute's charge
    return true;
  },

  // Damage over time: 'burn', 'poison' or 'bleed'. Fire zombies ignore burn, toxic ignore poison.
  applyDot(z, kind, dps, time) {
    if (z.type.immune === kind) return;
    if (kind === 'burn') { z.burnT = Math.max(z.burnT, time); z.burnDps = Math.max(z.burnDps, dps * Classes.stat(Game.player, 'burn')); }
    else if (kind === 'bleed') { z.bleedT = Math.max(z.bleedT, time); z.bleedDps = Math.max(z.bleedDps, dps); }
    else { z.poisonT = Math.max(z.poisonT, time); z.poisonDps = Math.max(z.poisonDps, dps); }
  },

  // The survivor a zombie goes after: the nearest one still alive.
  targetFor(z, players) {
    if (players.length === 1) return players[0];
    let best = players[0], bd = Infinity;
    for (const q of players) { const d = dist2(z.x, z.y, q.x, q.y); if (d < bd) { bd = d; best = q; } }
    return best;
  },

  update(dt) {
    const zs = Game.zombies, players = Net.livePlayers();

    for (const z of zs) {
      if (z.dead) continue;
      const t = z.type;
      const p = z.tgt = this.targetFor(z, players);
      z.flashT = Math.max(0, z.flashT - dt);
      z.lunge = Math.max(0, z.lunge - dt);
      if (z.spawnT > 0) { z.spawnT -= dt; continue; }
      z.atkT -= dt;
      z.special -= dt;
      for (const k of ['slowT', 'freezeT', 'stunT', 'chronoT', 'burnT', 'poisonT', 'bleedT', 'stickT']) if (z[k] > 0) z[k] = Math.max(0, z[k] - dt);
      if (z.liftT > 0) {
        z.liftT -= dt;
        if (z.liftT <= 0) FX.burst(z.x, z.y + 2, '#8a8a7a', 6, 30, 0.3);   // lands
      }

      // Damage over time (burn / poison / bleed).
      if (z.burnT > 0 || z.poisonT > 0 || z.bleedT > 0) {
        z.dotT -= dt;
        if (Math.random() < 0.2) FX.puff(z.x, z.y - 6, z.burnT > 0 ? '#ff8a20' : z.poisonT > 0 ? '#7dff3a' : '#c8102a', z.bleedT > 0 && !z.burnT && !z.poisonT ? 25 : -20);
        if (z.dotT <= 0) {
          z.dotT = 0.5;
          const dps = (z.burnT > 0 ? z.burnDps : 0) + (z.poisonT > 0 ? z.poisonDps : 0) + (z.bleedT > 0 ? z.bleedDps : 0);
          this.damage(z, dps * 0.5, { dot: true });
          if (z.dead) continue;
        }
      }
      if (z.burnT <= 0) z.burnDps = 0;
      if (z.poisonT <= 0) z.poisonDps = 0;
      if (z.bleedT <= 0) z.bleedDps = 0;

      // Ambient particles for elemental zombies.
      if (t.particle && Math.random() < 0.12) FX.puff(z.x, z.y - 4, t.particle, t.id === 'toxic' ? 15 : -18);
      if (z.id === 'wraith' && Math.random() < 0.2) FX.puff(z.x, z.y - 6, '#b05cff', -10, 0.5);
      if (z.id === 'phantom' && Math.random() < 0.1) FX.puff(z.x, z.y - 6, '#c8e8ff', -8, 0.6);

      const dpx = p.x - z.x, dpy = p.y - z.y;
      const dp = Math.hypot(dpx, dpy);

      // Groan now and then when close enough to hear.
      z.groanT -= dt;
      if (z.groanT <= 0) {
        z.groanT = rand(4, 9) / (t.groan || 1);
        if (dp < 340) Sound.groan(z.id, z.x, z.y);
      }

      // Left far behind (the player ran off)? It joins the incoming horde again.
      if (dp > 900 && !t.final && !t.named && !t.stationary) { Waves.toInbound(z); continue; }

      // Frozen, stunned or lifted zombies can't move or attack.
      if (z.freezeT > 0 || z.stunT > 0 || z.liftT > 0) {
        if (z.stunT > 0 && Math.random() < 0.3) FX.puff(z.x + rand(-4, 4), z.y - 12, '#fff060', -5, 0.2);
        moveEntity(z, z.kbx * dt, z.kby * dt, z.cr, t.phases);
        z.kbx *= Math.pow(0.001, dt);
        z.kby *= Math.pow(0.001, dt);
        z.chargeT = 0;
        z.fuse = z.fuse > 0 ? z.fuse : 0;
        continue;
      }

      // Riot shields swing slowly to face the player.
      if (t.shield) z.shieldA += angleDiff(Math.atan2(dpy, dpx), z.shieldA) * Math.min(1, dt * 3);

      // --- choose target: player, or a nearby turret if the player is far ---
      z.retargetT -= dt;
      if (z.target && z.target.dead) z.target = null;
      if (z.retargetT <= 0) {
        z.retargetT = 0.5;
        z.target = null;
        if (dp > 90 && !t.keepAway) {
          for (const s of Game.structures) {
            if (s.def.id === 'turret' && dist2(z.x, z.y, s.x, s.y) < 60 * 60) { z.target = s; break; }
          }
        }
      }

      // --- special abilities (each returns true to hold still this frame) ---
      let stop = false;
      if (t.zaps) stop = this.electric(z, p, dp, dt);
      if (t.shoots && z.special <= 0 && dp < 125 && dp > 24 && World.lineClear(z.x, z.y - 4, p.x, p.y - 3)) {
        z.special = rand(1.8, 2.6);
        const a = Math.atan2(p.y - 3 - (z.y - 4), p.x - z.x);
        Game.enemyShots.push({ kind: 'laser', x: z.x, y: z.y - 4, vx: Math.cos(a) * 135, vy: Math.sin(a) * 135, dmg: z.dmg * 0.9, life: 1.6, color: '#ff2040' });
        Sound.play('laser', z.x, z.y);
      }
      if (t.slams && z.special <= 0 && dp < (t.final ? 46 : 34)) this.slam(z, p, dp);
      if (t.spits) stop = this.spit(z, p, dp) || stop;
      if (t.explodes) { const r = this.bloat(z, dp, dt); if (r === 'boom') continue; stop = r || stop; }
      if (t.summons) this.summon(z, dp);
      if (t.charges) { const r = this.brute(z, p, dp, dt); if (r === 'moved') { this.checkStuck(z, dp, null, dt); continue; } stop = r || stop; }
      if (t.rockets && z.special <= 0 && dp < 220 && dp > 40 && World.lineClear(z.x, z.y - 6, p.x, p.y - 3)) {
        z.special = rand(4, 5.5);
        const a = Math.atan2(p.y - z.y, p.x - z.x);
        Game.enemyShots.push({ kind: 'rocket', x: z.x, y: z.y - 8, vx: Math.cos(a) * 95, vy: Math.sin(a) * 95, dmg: z.dmg * 1.3, life: 3.5, color: '#ffd040' });
        Sound.play('rocket', z.x, z.y);
      }
      if (t.teleports) stop = this.wraith(z, p, dp, dt) || stop;
      if (t.final) this.omega(z, p, dp, dt);
      if (t.ai) stop = Bosses.think(z, p, dp, dt) || stop;

      // --- movement ---
      let dirX = 0, dirY = 0, chase = false;
      z.detourT = Math.max(0, (z.detourT || 0) - dt);
      if (!stop) {
        // Ranged zombies keep their distance, but rush in after holding for a while
        // so a wave can never stall on one that won't come closer.
        z.rushT = Math.max(0, (z.rushT || 0) - dt);
        const los = t.keepAway && z.rushT <= 0 && dp < t.keepAway + 40 && World.lineClear(z.x, z.y - 4, p.x, p.y - 3);
        if (los) { z.holdT = (z.holdT || 0) + dt; if (z.holdT > 8) { z.holdT = 0; z.rushT = 5; } }
        if (los && dp < t.keepAway - 15) { dirX = -dpx; dirY = -dpy; }           // back off to range
        else if (los) { dirX = 0; dirY = 0; }                                       // in range: hold position
        else if (z.target) { dirX = z.target.x - z.x; dirY = z.target.y - z.y; }
        else if (dp < 30 && !z.detourT && (t.phases || World.walkClear(z.x, z.y, p.x, p.y))) { dirX = dpx; dirY = dpy; chase = true; }
        else {
          const step = this.flowStep(z);
          if (step) { dirX = step.x - z.x; dirY = step.y - z.y; }
          else { dirX = dpx; dirY = dpy; }
        }
      }
      const len = Math.hypot(dirX, dirY) || 1;
      let sp = (dirX || dirY) ? z.speed : 0;
      if (z.slowT > 0 && t.immune !== 'slow') sp *= 0.5;
      if (z.chronoT > 0) sp *= 0.3;
      if (dp < z.r + p.r + 2 && !z.target) sp = 0;   // already touching the player
      z.vx = lerp(z.vx, (dirX / len) * sp, Math.min(1, dt * 10));
      z.vy = lerp(z.vy, (dirY / len) * sp, Math.min(1, dt * 10));
      const blocked = moveEntity(z, (z.vx + z.kbx) * dt, (z.vy + z.kby) * dt, z.cr, t.phases);
      z.kbx *= Math.pow(0.001, dt);
      z.kby *= Math.pow(0.001, dt);
      if (Math.abs(z.vx) > 1) z.facing = z.vx > 0 ? 1 : -1;
      else if (t.keepAway) z.facing = dpx > 0 ? 1 : -1;
      z.anim += dt * (sp / 8);

      // Blocked by a player structure? Smash it.
      if (blocked) {
        const s = World.structAt(blocked.tx, blocked.ty);
        if (s && s.def.solid) {
          if (z.atkT <= 0) {
            z.atkT = 1;
            z.lunge = 0.15;
            Structures.damage(s, z.dmg * (t.structMult || 1));
          }
        } else if (chase) {
          // The straight line to the player clips a wall corner: follow the path for a moment.
          z.detourT = 0.5;
        } else {
          // Snagged on scenery: nudge toward the center of the current tile.
          const cx = (toTile(z.x) + 0.5) * TILE, cy = (toTile(z.y) + 0.5) * TILE;
          moveEntity(z, (cx - z.x) * dt * 5, (cy - z.y) * dt * 5, z.cr, t.phases);
        }
      }
      // Reached a targeted turret? Attack it.
      if (z.target && dist2(z.x, z.y, z.target.x, z.target.y) < 15 * 15 && z.atkT <= 0) {
        z.atkT = 1;
        z.lunge = 0.15;
        Structures.damage(z.target, z.dmg * (t.structMult || 1));
      }

      this.checkStuck(z, dp, blocked, dt);

      // --- melee attack on the player ---
      const reach = z.r + p.r + 3;
      if (!t.slams && !t.explodes && dp < reach && z.atkT <= 0) {
        z.atkT = t.id === 'fast' || t.id === 'leech' ? 0.75 : 1;
        z.lunge = 0.15;
        const hp0 = p.hp;
        Player.damage(p, z.dmg);
        if (p.hp < hp0) Classes.onHitBy(p, z);   // Bulwark spiked armor
        if (t.burns) p.burnT = 3;
        if (t.poisons) p.poisonT = 4;
        if (t.freezes) p.slowT = 2;
        if (t.drains && p.hp < hp0) {
          z.hp = Math.min(z.maxHp, z.hp + (hp0 - p.hp) * 2);
          FX.burst(z.x, z.y - 2, '#ff3a5a', 4, 30, 0.3);
        }
      }
    }

    this.separate();
    for (let i = zs.length - 1; i >= 0; i--) if (zs[i].dead) zs.splice(i, 1);
  },

  relocate(z) {
    const at = Waves.pickSpawnPoint();
    z.x = z.ax = at.x;
    z.y = z.ay = at.y;
    z.stuckT = 0;
    z.spawnT = 0.5;
    z.kbx = z.kby = 0;
  },

  // Safety net: a zombie that stays within 6px of the same spot for 6s
  // (wedged in a crowd or on scenery) is moved to a fresh spawn point.
  checkStuck(z, dp, blocked, dt) {
    // Being close only counts if it can actually reach you (not stuck behind a wall corner).
    const close = dp < 40 && World.walkClear(z.x, z.y, z.tgt.x, z.tgt.y);
    const busy = close || z.target || z.chargeT > 0 || z.mode || z.fuse > 0 || z.tp || z.type.keepAway || z.type.final || z.type.named || z.type.stationary ||
      (blocked && World.structAt(blocked.tx, blocked.ty));
    if (busy || dist2(z.x, z.y, z.ax, z.ay) > 36) { z.ax = z.x; z.ay = z.y; z.stuckT = 0; return; }
    z.stuckT += dt;
    if (z.stuckT > 6) this.relocate(z);
  },

  // Next tile center to walk toward, following the flow field downhill.
  flowStep(z) {
    const tx = toTile(z.x), ty = toTile(z.y);
    let best = World.flowAt(tx, ty), bx = 0, by = 0, found = false;
    if (best === Infinity) return null;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      if (dx && dy && (World.moveCost(tx + dx, ty) >= 5 || World.moveCost(tx, ty + dy) >= 5)) continue;
      const f = World.flowAt(tx + dx, ty + dy);
      if (f < best) { best = f; bx = tx + dx; by = ty + dy; found = true; }
    }
    if (!found) return null;
    return { x: (bx + 0.5) * TILE, y: (by + 0.5) * TILE };
  },

  // ---------- special abilities ----------
  // Electric zombies charge up briefly, then zap the player if still close.
  electric(z, p, dp, dt) {
    if (z.chargeT > 0) {
      z.chargeT -= dt;
      if (Math.random() < 0.5) FX.puff(z.x + rand(-5, 5), z.y - 6, '#fff060', -10, 0.2);
      if (z.chargeT <= 0) {
        z.special = rand(2.5, 3.5);
        if (dp < 90 && World.lineClear(z.x, z.y - 5, p.x, p.y - 3)) {
          FX.bolt(z.x, z.y - 5, p.x, p.y - 3, '#fff060');
          FX.bolt(z.x, z.y - 5, p.x, p.y - 3, '#ffffff', 0.1);
          Player.damage(p, z.dmg * 1.2, { color: '#fff060' });
          p.slowT = Math.max(p.slowT, 0.5);
          Sound.play('zap', z.x, z.y);
        }
      }
      return true;   // stands still while charging
    }
    if (z.special <= 0 && dp < 75 && World.lineClear(z.x, z.y - 5, p.x, p.y - 3)) {
      z.chargeT = 0.55;
      Sound.play('charge', z.x, z.y);
      return true;
    }
    return false;
  },

  // Titans (and the Omega) slam the ground: hurts the player and nearby walls.
  slam(z, p, dp) {
    const big = z.type.final, r = big ? 64 : 44;
    z.special = big ? 2.2 : 2.6;
    z.lunge = 0.3;
    FX.ring(z.x, z.y, r, big ? '#ff5cf0' : '#c8a070', 0.4);
    FX.burst(z.x, z.y, '#8a7a5a', big ? 30 : 18, 90, 0.5);
    FX.shake(big ? 8 : 5);
    Sound.play('slam', z.x, z.y);
    if (dp < r - 2) Player.damage(p, z.dmg);
    for (const s of Game.structures) {
      if (!s.dead && dist2(z.x, z.y, s.x, s.y) < r * r) Structures.damage(s, z.dmg * z.type.structMult);
    }
  },

  // Spitters lob acid that lands where the player was standing.
  spit(z, p, dp) {
    if (z.special > 0 || dp > 160 || !World.lineClear(z.x, z.y - 4, p.x, p.y - 3)) return false;
    z.special = rand(2.2, 3.2);
    z.lunge = 0.2;
    const lead = 0.5;   // aim a little ahead of a moving player
    const tx = p.x + (p.mvx || 0) * lead, ty = p.y + (p.mvy || 0) * lead;
    Game.enemyShots.push({ kind: 'glob', x0: z.x, y0: z.y - 8, x: z.x, y: z.y - 8, tx, ty, t: 0, dur: 0.85, dmg: z.dmg, color: '#b0ff40' });
    Sound.play('spit', z.x, z.y);
    return true;
  },

  // Bloaters light a fuse when they reach you, then burst.
  bloat(z, dp, dt) {
    if (z.fuse > 0) {
      z.fuse -= dt;
      z.flashT = Math.floor(z.fuse * 16) % 2 ? 0.05 : 0;
      if (z.fuse <= 0) { this.explodeBloater(z); return 'boom'; }
      return true;
    }
    if (dp < 22) { z.fuse = 0.65; Sound.play('fuse', z.x, z.y); return true; }
    return false;
  },

  explodeBloater(z) {
    if (z.exploded) return;
    z.exploded = true;
    const r = 46;
    FX.ring(z.x, z.y, r, '#d8c070', 0.45);
    FX.burst(z.x, z.y, '#c8b060', 26, 120, 0.6);
    FX.burst(z.x, z.y, '#7a6a3a', 14, 70, 0.8);
    FX.light(z.x, z.y, 120, '#ffb040', 0.4);
    FX.shake(5);
    Sound.play('explode', z.x, z.y);
    for (const p of Net.livePlayers()) if (dist2(z.x, z.y, p.x, p.y) < r * r) { Player.damage(p, z.dmg * 2.5); p.poisonT = Math.max(p.poisonT, 2); }
    for (const s of Game.structures) if (!s.dead && dist2(z.x, z.y, s.x, s.y) < r * r) Structures.damage(s, z.dmg * 4);
    Game.hazards.push({ x: z.x, y: z.y, r: 20, kind: 'toxic', life: 3, max: 3 });
    if (!z.dead) this.kill(z);
  },

  // Necromancers stay back and raise the dead.
  summon(z, dp) {
    if (z.special > 0 || dp > 240 || z.summoned >= 8) return;
    z.special = rand(6, 8);
    z.summoned += 2;
    for (let i = 0; i < 2; i++) {
      const a = Math.random() * Math.PI * 2, x = z.x + Math.cos(a) * 18, y = z.y + Math.sin(a) * 18;
      if (!solidAt(x, y, 4)) { const m = this.spawn('normal', x, y); m.spawnT = 0.9; }
    }
    FX.ring(z.x, z.y, 26, '#c060ff', 0.5);
    FX.burst(z.x, z.y - 6, '#c060ff', 14, 50, 0.6);
    FX.light(z.x, z.y, 60, '#c060ff', 0.5);
    Sound.play('summon', z.x, z.y);
  },

  // Brutes wind up, then charge in a straight line. Walls stop them cold.
  brute(z, p, dp, dt) {
    if (z.mode === 'windup') {
      z.modeT -= dt;
      z.chDir = Math.atan2(p.y - z.y, p.x - z.x);
      z.facing = Math.cos(z.chDir) >= 0 ? 1 : -1;
      if (Math.random() < 0.5) FX.puff(z.x + rand(-6, 6), z.y + 3, '#8a7a5a', -6, 0.3);
      if (z.modeT <= 0) { z.mode = 'charge'; z.modeT = 0.9; }
      return true;
    }
    if (z.mode === 'charge') {
      z.modeT -= dt;
      const sp = 230 * dt;
      const blocked = moveEntity(z, Math.cos(z.chDir) * sp, Math.sin(z.chDir) * sp, z.cr);
      z.anim += dt * 4;
      if (Math.random() < 0.7) FX.puff(z.x, z.y + 3, '#a89878', 0, 0.3);
      if (dist(z.x, z.y, p.x, p.y) < z.r + p.r + 5) {
        Player.damage(p, z.dmg * 1.6);
        moveEntity(p, Math.cos(z.chDir) * 26, Math.sin(z.chDir) * 26);
        FX.shake(6);
        z.mode = null;
      } else if (blocked) {
        const s = World.structAt(blocked.tx, blocked.ty);
        if (s) Structures.damage(s, z.dmg * 5);
        else z.stunT = 1;   // slammed into a building
        FX.shake(4);
        Sound.play('slam', z.x, z.y);
        z.mode = null;
      } else if (z.modeT <= 0) z.mode = null;
      if (!z.mode) z.special = rand(4, 6);
      return 'moved';
    }
    if (z.special <= 0 && dp < 170 && dp > 34 && World.walkClear(z.x, z.y, p.x, p.y)) {
      z.mode = 'windup';
      z.modeT = 0.7;
      Sound.play('roar', z.x, z.y);
      return true;
    }
    return false;
  },

  // Void Wraiths mark a spot beside the player, then teleport there.
  wraith(z, p, dp, dt) {
    if (z.tp) {
      z.tp.t -= dt;
      if (Math.random() < 0.6) FX.puff(z.tp.x + rand(-6, 6), z.tp.y + rand(-4, 4), '#b05cff', -12, 0.4);
      if (z.tp.t <= 0) {
        FX.burst(z.x, z.y - 4, '#b05cff', 14, 60, 0.4);
        z.x = z.ax = z.tp.x; z.y = z.ay = z.tp.y;
        FX.burst(z.x, z.y - 4, '#ff5cf0', 14, 60, 0.4);
        FX.light(z.x, z.y, 50, '#b05cff', 0.3);
        z.tp = null;
        z.special = rand(4.5, 6.5);
        z.atkT = 0.35;
      }
      return true;
    }
    if (z.special <= 0 && dp > 60 && dp < 420) {
      for (let i = 0; i < 10; i++) {
        const a = Math.random() * Math.PI * 2, x = p.x + Math.cos(a) * 28, y = p.y + Math.sin(a) * 28;
        if (!solidAt(x, y, z.cr)) {
          z.tp = { x, y, t: 0.55 };
          Sound.play('teleport', x, y);
          return true;
        }
      }
      z.special = 1;
    }
    return false;
  },

  // The Omega Titan's extra attacks: a ring of lasers and summoned elites.
  omega(z, p, dp, dt) {
    z.laserT -= dt;
    z.bossT -= dt;
    if (z.laserT <= 0) {
      z.laserT = 5.5;
      const n = 14, off = Math.random();
      for (let i = 0; i < n; i++) {
        const a = (i + off) / n * Math.PI * 2;
        Game.enemyShots.push({ kind: 'laser', x: z.x, y: z.y - 20, vx: Math.cos(a) * 110, vy: Math.sin(a) * 110, dmg: z.dmg * 0.5, life: 3, color: '#ff5cf0' });
      }
      FX.ring(z.x, z.y - 20, 30, '#ff5cf0', 0.4);
      Sound.play('laser', z.x, z.y);
    }
    if (z.bossT <= 0) {
      z.bossT = 14;
      for (let i = 0; i < 3; i++) {
        const a = Math.random() * Math.PI * 2, x = z.x + Math.cos(a) * 40, y = z.y + Math.sin(a) * 40;
        if (!solidAt(x, y, 4)) { const m = this.spawn(pick(['armored', 'fire', 'cyber', 'freezing', 'riot']), x, y); m.spawnT = 0.9; }
      }
      FX.ring(z.x, z.y, 60, '#c060ff', 0.6);
      Sound.play('summon', z.x, z.y);
    }
  },

  // Push overlapping zombies apart (and off the player).
  separate() {
    const zs = Game.zombies, p = Game.player;
    for (let i = 0; i < zs.length; i++) {
      const a = zs[i];
      if (a.dead) continue;
      for (let j = i + 1; j < zs.length; j++) {
        const b = zs[j];
        if (b.dead) continue;
        const dx = b.x - a.x, dy = b.y - a.y, min = a.cr + b.cr;
        const d2 = dx * dx + dy * dy;
        if (d2 >= min * min || d2 < 0.0001) continue;
        const d = Math.sqrt(d2), push = (min - d) / 2, nx = dx / d, ny = dy / d;
        const wa = a.type.kbImmune ? 0.15 : 1, wb = b.type.kbImmune ? 0.15 : 1;
        moveEntity(a, -nx * push * wa, -ny * push * wa, a.cr, a.type.phases);
        moveEntity(b, nx * push * wb, ny * push * wb, b.cr, b.type.phases);
      }
      const dx = a.x - p.x, dy = a.y - p.y, min = a.cr + p.r;
      const d2 = dx * dx + dy * dy;
      if (d2 < min * min && d2 > 0.0001) {
        const d = Math.sqrt(d2);
        moveEntity(a, (dx / d) * (min - d), (dy / d) * (min - d), a.cr, a.type.phases);
      }
    }
  },

  damage(z, amount, opts = {}) {
    if (z.dead) return;
    const t = z.type;
    if (z.shielded) {   // Voltrax's pylon shield: nothing gets through
      if (!opts.dot && Game.time - (z.shieldMsgT || 0) > 0.8) {
        z.shieldMsgT = Game.time;
        FX.float(z.x, z.y - 44, 'SHIELDED', '#7affff', 0.6);
        FX.burst(z.x, z.y - z.hy, '#7affff', 5, 60, 0.25);
        Sound.play('shield', z.x, z.y);
      }
      return;
    }
    if (!opts.dot && t.armor) amount *= 1 - t.armor;
    // Riot shields soak hits coming from the front.
    if (t.shield && !opts.dot && opts.angle !== undefined && Math.abs(angleDiff(opts.angle + Math.PI, z.shieldA)) < 1.05) {
      amount *= t.shield;
      if (Math.random() < 0.4) {
        FX.burst(z.x + Math.cos(z.shieldA) * 7, z.y - 4 + Math.sin(z.shieldA) * 7, '#7affff', 4, 50, 0.2);
        Sound.play('shield', z.x, z.y);
      }
    }
    z.hp -= amount;
    if (!opts.dot) {
      z.flashT = 0.08;
      FX.float(z.x + rand(-3, 3), z.y - 14 - (t.scale ? 10 * t.scale - 10 : 0), Math.round(amount), amount >= 150 ? '#ff9cf0' : amount >= 60 ? '#ffd040' : '#ffffff', amount >= 100 ? 0.7 : 0.5, amount >= 100);
      Sound.play('hit', z.x, z.y);
      if (opts.kb && !t.kbImmune) {
        z.kbx += Math.cos(opts.angle) * opts.kb;
        z.kby += Math.sin(opts.angle) * opts.kb;
      }
    }
    if (z.hp <= 0) this.kill(z);
  },

  kill(z) {
    if (z.dead) return;
    z.dead = true;
    const t = z.type;
    Game.kills++;
    Game.score += Math.round(t.score * (1 + Game.wave * 0.05));
    FX.burst(z.x, z.y - 3, t.colors.k, 10, 70, 0.5);
    FX.burst(z.x, z.y - 3, '#5a1010', 6, 50, 0.6);
    if (t.named) Bosses.onKill(z);
    else if (t.boss) {
      const big = t.final;
      FX.ring(z.x, z.y, big ? 120 : 50, big ? '#ff5cf0' : '#ffd040', big ? 1.2 : 0.6);
      FX.burst(z.x, z.y, big ? '#ff5cf0' : '#ffd040', big ? 80 : 30, big ? 200 : 120, big ? 1.4 : 0.8);
      FX.light(z.x, z.y, big ? 300 : 160, big ? '#ff5cf0' : '#ffd040', big ? 1.5 : 0.8);
      FX.shake(big ? 12 : 7);
      Sound.play('titandie', z.x, z.y);
      if (big) Sound.play('shockwave', z.x, z.y);
      UI.toast(big ? 'THE OMEGA TITAN HAS FALLEN!' : 'TITAN DEFEATED! BOSS LOOT DROPPED', '#ffd040');
    } else {
      Sound.play('zdie', z.x, z.y);
    }
    if (t.deathBlast === 'fire') {
      Game.hazards.push({ x: z.x, y: z.y, r: 14, kind: 'fire', life: 3, max: 3 });
      FX.ring(z.x, z.y, 18, '#ff8a20', 0.3);
      FX.light(z.x, z.y, 50, '#ff8a20', 0.3);
    } else if (t.deathBlast === 'toxic') {
      Game.hazards.push({ x: z.x, y: z.y, r: 16, kind: 'toxic', life: 4, max: 4 });
      FX.burst(z.x, z.y, '#9aff40', 12, 50, 0.6);
    }
    if (t.explodes) this.explodeBloater(z);
    Loot.zombieDrops(z);
    UI.dirty = true;
  },

  // Fire / toxic puddles. Friendly fields (Magma, flares) burn zombies instead.
  updateHazards(dt) {
    const list = Game.hazards;
    for (let i = list.length - 1; i >= 0; i--) {
      const h = list[i];
      h.life -= dt;
      if (h.life <= 0) { list.splice(i, 1); continue; }
      if (h.friendly) {
        h.tick = (h.tick || 0) - dt;
        if (h.tick <= 0) {
          h.tick = 0.5;
          for (const z of Game.zombies) {
            if (!z.dead && z.type.immune !== 'burn' && dist2(z.x, z.y, h.x, h.y) < (h.r + z.r) * (h.r + z.r)) this.damage(z, h.dmg, { dot: true });
          }
        }
      }
      const col = h.kind === 'toxic' ? '#9aff40' : h.kind === 'flare' ? (Math.random() < 0.5 ? '#ffd0a0' : '#ff6a3a') : '#ff9a20';
      if (Math.random() < (h.kind === 'flare' ? 0.7 : 0.3)) FX.puff(h.x + rand(-h.r * 0.6, h.r * 0.6), h.y + rand(-h.r * 0.4, h.r * 0.4), col, -12, 0.4);
    }
  },
};
