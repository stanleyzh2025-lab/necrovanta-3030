// ============================================================
// structures.js - player-built walls, spike traps and turrets,
// plus build mode (place / repair / remove on the tile grid).
// ============================================================

const Structures = {
  place(def, tx, ty) {
    const s = {
      def, tx, ty,
      x: (tx + 0.5) * TILE, y: (ty + 0.5) * TILE,
      hp: def.hp * Classes.stat(Game.player, 'structHp'), maxHp: def.hp * Classes.stat(Game.player, 'structHp'),
      cd: 0, angle: -Math.PI / 2, flashT: 0, dead: false,
    };
    World.setStruct(tx, ty, s);
    Game.structures.push(s);
    World.flowDirty = true;
    return s;
  },

  remove(s) {
    s.dead = true;
    World.setStruct(s.tx, s.ty, null);
    const i = Game.structures.indexOf(s);
    if (i >= 0) Game.structures.splice(i, 1);
    World.flowDirty = true;
  },

  damage(s, amount) {
    if (s.dead) return;
    s.hp -= amount;
    s.flashT = 0.1;
    FX.burst(s.x, s.y, '#8a7a6a', 3, 40, 0.25);
    if (s.hp <= 0) {
      FX.burst(s.x, s.y, '#a08060', 14, 80, 0.5);
      Sound.play('break', s.x, s.y);
      this.remove(s);
    }
  },

  clearAll() {
    for (const s of Game.structures) World.setStruct(s.tx, s.ty, null);
    Game.structures.length = 0;
    World.flowDirty = true;
  },

  update(dt) {
    const waveScale = 1 + Game.wave * 0.04;
    for (const s of Game.structures) {
      s.flashT = Math.max(0, s.flashT - dt);
      if (s.def.id === 'turret') this.updateTurret(s, dt, waveScale);
    }
    // Spike traps hurt zombies standing on them, and wear out.
    for (const z of Game.zombies) {
      if (z.dead || z.spawnT > 0) continue;
      const s = World.structAt(toTile(z.x), toTile(z.y));
      if (!s || s.def.id !== 'spikes') continue;
      z.spikeT -= dt;
      if (z.spikeT <= 0) {
        z.spikeT = SPIKE.tick;
        Zombies.damage(z, SPIKE.dmg * waveScale, { dot: true });
        FX.burst(z.x, z.y, '#c8ccd4', 3, 30, 0.2);
        this.damage(s, SPIKE.wear);
      }
    }
  },

  // Is the player standing next to an anvil (needed to forge / upgrade weapons)?
  nearAnvil(p) {
    for (const s of Game.structures) {
      if (s.def.id === 'anvil' && dist2(p.x, p.y, s.x, s.y) < ANVIL_RANGE * ANVIL_RANGE) return s;
    }
    return null;
  },

  updateTurret(s, dt, waveScale) {
    s.cd -= dt;
    let best = null, bestD = TURRET.range * TURRET.range;
    for (const z of Game.zombies) {
      if (z.dead || z.spawnT > 0) continue;
      const d = dist2(s.x, s.y, z.x, z.y);
      if (d < bestD) { bestD = d; best = z; }
    }
    if (!best) return;
    const target = Math.atan2(best.y - 3 - s.y, best.x - s.x);
    s.angle += angleDiff(target, s.angle) * Math.min(1, dt * 12);
    if (s.cd <= 0 && Math.abs(angleDiff(target, s.angle)) < 0.3 && World.lineClear(s.x, s.y, best.x, best.y)) {
      s.cd = TURRET.cd / Classes.stat(Game.player, 'turretRate');
      const w = { speed: TURRET.speed, range: TURRET.range + 20, color: '#ffd040', glow: '#ffffff', size: 1.5, id: 'turret', proj: 'turret' };
      Weapons.spawnBullet(s.x + Math.cos(s.angle) * 8, s.y - 2 + Math.sin(s.angle) * 8, s.angle, w, TURRET.dmg * waveScale, 1);
      Sound.play('turret', s.x, s.y);
    }
  },
};

// ---------- build mode ----------
const Build = {
  selected: 0,
  ghost: null,        // { tx, ty, valid, action }

  toggle() {
    Game.buildMode = !Game.buildMode;
    Sound.play('click');
    UI.dirty = true;
    UI.toast(Game.buildMode ? `BUILD MODE: 1-${STRUCTURES.length} SELECT, CLICK PLACE/REPAIR, RIGHT-CLICK REMOVE` : 'BUILD MODE OFF', '#3ff0ff');
  },

  update() {
    const p = Game.player;
    for (let i = 0; i < STRUCTURES.length; i++) {
      if (Input.wasPressed(String(i + 1))) { this.selected = i; Sound.play('click'); UI.dirty = true; }
    }
    if (Input.wheel) { this.selected = (this.selected + Input.wheel + STRUCTURES.length) % STRUCTURES.length; UI.dirty = true; }

    const tx = toTile(Input.mouse.x), ty = toTile(Input.mouse.y);
    const def = STRUCTURES[this.selected];
    const inRange = dist(p.x, p.y, (tx + 0.5) * TILE, (ty + 0.5) * TILE) <= BUILD_RANGE;
    const existing = World.structAt(tx, ty);
    let action = 'place', valid = inRange;
    if (existing) {
      action = existing.hp < existing.maxHp ? 'repair' : 'full';
      valid = inRange && action === 'repair';
    } else {
      valid = inRange && World.isOpenGround(tx, ty) && this.tileClear(tx, ty, def);
    }
    this.ghost = { tx, ty, valid, action, existing };

    if (Input.mouse.leftClick) {
      if (!valid) { Sound.play('error'); return; }
      if (action === 'repair') this.repair(existing);
      else if (!canAfford(p.inv, Classes.structCost(def))) {
        Sound.play('error');
        UI.toast(`NEED ${costText(Classes.structCost(def))}`, '#ff3d4e');
      } else {
        payCost(p.inv, Classes.structCost(def));
        if (Net.role === 'guest') Net.toHost({ k: 'build', id: def.id, tx, ty, s: Net.inputState() });   // the host places it for everyone
        else Structures.place(def, tx, ty);
        Save.touch();
        FX.burst((tx + 0.5) * TILE, (ty + 0.5) * TILE, '#c8b890', 8, 40, 0.3);
        Sound.play('build');
        UI.dirty = true;
      }
    }
    if (Input.mouse.rightClick && existing && inRange) {
      // Refund half the cost, scaled by remaining health.
      const ratio = 0.5 * existing.hp / existing.maxHp;
      const paid = Classes.structCost(existing.def);
      for (const k in paid) p.inv[k] += Math.floor(paid[k] * ratio);
      if (Net.role === 'guest') Net.toHost({ k: 'unbuild', tx: existing.tx, ty: existing.ty });
      else Structures.remove(existing);
      Sound.play('break');
      UI.dirty = true;
    }
  },

  // Don't build a solid block on top of the player, zombies or chests.
  tileClear(tx, ty, def) {
    if (Game.chests.some(c => c.tx === tx && c.ty === ty)) return false;
    if (!def.solid) return true;
    const x0 = tx * TILE, y0 = ty * TILE;
    const overlaps = e => e.x + e.r > x0 && e.x - e.r < x0 + TILE && e.y + e.r > y0 && e.y - e.r < y0 + TILE;
    if (Net.players().some(q => !q.dead && overlaps(q))) return false;
    return !Game.zombies.some(z => !z.dead && overlaps(z));
  },

  repairCost(s) {
    const missing = 1 - s.hp / s.maxHp, cost = {};
    const full = Classes.structCost(s.def);
    for (const k in full) cost[k] = Math.max(1, Math.ceil(full[k] * missing * 0.6));
    return cost;
  },

  repair(s) {
    const p = Game.player, cost = this.repairCost(s);
    if (!canAfford(p.inv, cost)) { Sound.play('error'); UI.toast(`REPAIR NEEDS ${costText(cost)}`, '#ff3d4e'); return; }
    payCost(p.inv, cost);
    if (Net.role === 'guest') Net.toHost({ k: 'repair', tx: s.tx, ty: s.ty });
    else s.hp = s.maxHp;
    FX.burst(s.x, s.y, '#5fe05f', 8, 40, 0.4);
    Sound.play('build');
    UI.dirty = true;
  },
};
