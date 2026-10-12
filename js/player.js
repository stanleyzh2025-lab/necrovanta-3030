// ============================================================
// player.js - the survivor: movement, collision, aiming, hotbar,
// interacting (chests / gathering), healing and taking damage.
// Weapon firing, reloading and abilities live in weapons.js.
// ============================================================

function createPlayer() {
  return {
    x: World.spawnPoint.x, y: World.spawnPoint.y,
    r: PLAYER_BASE.radius,
    hp: PLAYER_BASE.hp, maxHp: PLAYER_BASE.hp,
    aim: 0, facing: 1, anim: 0, moving: false,
    hotbar: ['nova', 'fang', null, null, null, null, null, null, null],
    slot: 0,
    weapons: { nova: 1, fang: 1 },      // owned weapon id -> upgrade level (1-10)
    bag: ['nova', 'fang', ...Array(BAG_MAX - 2).fill(null)],   // weapon bag slot order
    bagLevel: 0,
    mags: { nova: WEAPON_BY_ID.nova.mag },   // gun id -> rounds in the magazine
    mods: {},                           // weapon id -> { optic, mag, core, edge, grip } (mod ids)
    skins: {},                          // weapon id -> skins found for it, e.g. ['gold']
    skin: {},                           // weapon id -> skin currently shown
    ws: {},                             // per-weapon ability state (hit counters etc.)
    altCd: {},                          // weapon id -> seconds until its ability is ready
    cooldown: 0, swingT: 0, swingDir: 1, recoil: 0, spinT: 0,
    cls: 'survivor',                    // survivor class id (CLASSES in config.js)
    combo: 0, comboT: 0, quickdraw: false,   // Blade Dancer combo, Gunslinger quickdraw
    reloadT: 0, reloadMax: 0, reloadId: null,
    chargeT: 0, prevLeft: false,        // Genesis tap/hold
    lastAttackT: -99,                   // Shadow Piercer stealth
    domeT: 0,                           // Genesis energy dome
    invT: 0, hurtT: 0,
    slowT: 0, burnT: 0, poisonT: 0, dotTick: 0,
    gatherT: 0,
    inv: {
      wood: 10, stone: 4, metal: 2, techshard: 0, diamond: 0, plasmacore: 0, voidcrystal: 0, modkit: 0,
      cells: 30, plasma: 0, quantum: 0, antimatter: 0,
      bandage: 2, medkit: 0, serum: 0,
    },
    upgrades: { vitality: 0, armor: 0, boots: 0 },
  };
}

// ---------- shared collision helpers (used by zombies too) ----------
// Returns the first solid tile overlapped by a box of radius r at (x, y), or null.
// ghost = ignore player-built structures (Phantoms walk through walls).
function solidAt(x, y, r, ghost = false) {
  const x0 = toTile(x - r), x1 = toTile(x + r - 0.01);
  const y0 = toTile(y - r), y1 = toTile(y + r - 0.01);
  for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
    if (ghost ? World.isSolidStatic(tx, ty) : World.isSolid(tx, ty)) return { tx, ty };
  }
  return null;
}

// Moves an entity with axis-separated collision. Returns the tile that blocked it.
function moveEntity(e, dx, dy, r = e.r, ghost = false) {
  let blocked = null;
  if (dx) {
    const hit = solidAt(e.x + dx, e.y, r, ghost);
    if (!hit) e.x += dx; else blocked = hit;
  }
  if (dy) {
    const hit = solidAt(e.x, e.y + dy, r, ghost);
    if (!hit) e.y += dy; else blocked = blocked || hit;
  }
  return blocked;
}

const Player = {
  maxHp(p) { return PLAYER_BASE.hp + 20 * p.upgrades.vitality + Classes.stat(p, 'hp'); },
  speed(p) {
    let s = PLAYER_BASE.speed * (1 + 0.06 * p.upgrades.boots) * Classes.stat(p, 'speed');
    if (p.slowT > 0) s *= 0.55;
    return s;
  },
  damageTaken(p) { return (1 - 0.07 * p.upgrades.armor) * Classes.stat(p, 'armor'); },
  healAmount(p, item) { return Math.round(HEAL_ITEMS[item].heal * Classes.stat(p, 'heal')); },
  weapon(p) { return WEAPON_BY_ID[p.hotbar[p.slot]] || null; },

  update(p, dt) {
    p.maxHp = this.maxHp(p);
    p.cooldown = Math.max(0, p.cooldown - dt);
    p.swingT = Math.max(0, p.swingT - dt);
    p.spinT = Math.max(0, p.spinT - dt);
    p.recoil = Math.max(0, p.recoil - dt * 20);
    p.flashT = Math.max(0, (p.flashT || 0) - dt);
    p.invT = Math.max(0, p.invT - dt);
    p.hurtT = Math.max(0, p.hurtT - dt);
    p.slowT = Math.max(0, p.slowT - dt);
    p.domeT = Math.max(0, p.domeT - dt);
    for (const id in p.altCd) p.altCd[id] = Math.max(0, p.altCd[id] - dt);

    // --- movement ---
    let mx = 0, my = 0;
    if (Input.isDown('a', 'arrowleft')) mx -= 1;
    if (Input.isDown('d', 'arrowright')) mx += 1;
    if (Input.isDown('w', 'arrowup')) my -= 1;
    if (Input.isDown('s', 'arrowdown')) my += 1;
    p.moving = !!(mx || my);
    p.mvx = p.mvy = 0;
    if (p.moving) {
      const len = Math.hypot(mx, my), spd = this.speed(p), sp = spd * dt;
      p.mvx = (mx / len) * spd; p.mvy = (my / len) * spd;
      moveEntity(p, (mx / len) * sp, (my / len) * sp);
      p.anim += dt * 8;
      // Footsteps that match the ground underfoot.
      p.stepT = (p.stepT || 0) - dt;
      if (p.stepT <= 0) {
        p.stepT = 0.3;
        const tile = World.tileAt(toTile(p.x), toTile(p.y + 4));
        Sound.step(tile === T.GRASS || tile === T.DIRT || tile === T.RUBBLE || tile === T.ALIEN ? 'soft' : tile === T.FLOOR || tile === T.HULL ? 'metal' : 'hard');
      }
      if (p.slowT > 0 && Math.random() < 0.3) FX.puff(p.x, p.y + 4, '#bfefff', -5, 0.4);
    }

    // --- aim ---
    p.aim = Math.atan2(Input.mouse.y - (p.y - 2), Input.mouse.x - p.x);
    p.facing = Math.cos(p.aim) >= 0 ? 1 : -1;

    // --- weapons (number keys are used by build mode instead) ---
    if (!Game.buildMode) {
      for (let i = 0; i < HOTBAR_SIZE; i++) if (Input.wasPressed(String(i + 1))) this.selectSlot(p, i);
      if (Input.wheel) this.cycleWeapon(p, Input.wheel);
      if (Input.wasPressed('r')) Weapons.startReload(p);
      if (Input.mouse.rightClick || Input.wasPressed('f')) Weapons.alt(p);
      Weapons.trigger(p, dt, Input.mouse.left);
    }
    Weapons.updateReload(p, dt);

    // --- interact / gather / heal ---
    const chest = Loot.nearestChest(p);
    const gw = chest ? null : Loot.nearestGroundWeapon(p);
    const node = chest || gw ? null : this.nearestNode(p);
    if (chest && Input.wasPressed('e')) Loot.openChest(chest);
    if (gw && Input.wasPressed('e')) Loot.pickUpWeapon(gw);
    if (node && Input.isDown('e')) {
      p.gatherT -= dt;
      if (p.gatherT <= 0) { this.harvest(p, node); p.gatherT = GATHER_TIME; }
    } else {
      p.gatherT = 0;
    }
    if (Input.wasPressed('q')) this.quickHeal(p);

    if (chest) UI.setHint(`E: OPEN ${RARITIES[chest.rarity].name} ${chest.cache ? 'WEAPON CACHE' : 'CHEST'}`);
    else if (gw) UI.setHint(`E: PICK UP ${WEAPON_BY_ID[gw.id].name.toUpperCase()} LV${gw.level}${this.bagFree(p) < 0 && !p.weapons[gw.id] ? ' (BAG FULL!)' : ''}`);
    else if (node) UI.setHint(`HOLD E: GATHER ${itemName(NODE_TYPES[node.kind].res).toUpperCase()}`);
    else if (Structures.nearAnvil(p) && !Game.buildMode) UI.setHint('ANVIL: PRESS U TO FORGE / UPGRADE WEAPONS');
    else UI.setHint('');

    // --- damage over time from burning / poison ---
    if (Classes.stat(p, 'burnImmune')) p.burnT = 0;   // Pyro
    p.burnT = Math.max(0, p.burnT - dt);
    p.poisonT = Math.max(0, p.poisonT - dt);
    if (p.burnT > 0 || p.poisonT > 0) {
      p.dotTick -= dt;
      if (Math.random() < 0.25) FX.puff(p.x, p.y - 4, p.burnT > 0 ? '#ffaa20' : '#9aff40');
      if (p.dotTick <= 0) {
        p.dotTick = 0.5;
        const scale = waveDmgMult(Math.max(1, Game.wave));
        if (p.burnT > 0) this.damage(p, 1.5 * scale, { dot: true, color: '#ffaa20' });
        if (p.poisonT > 0) this.damage(p, 1.2 * scale, { dot: true, color: '#9aff40' });
      }
    }
    // Hazard puddles (fire / toxic) left by dead zombies.
    for (const h of Game.hazards) {
      if (h.friendly) continue;
      if (dist2(p.x, p.y, h.x, h.y) < h.r * h.r) {
        if (h.kind === 'fire') p.burnT = Math.max(p.burnT, 1);
        else p.poisonT = Math.max(p.poisonT, 1);
      }
    }

    // Slow regeneration between waves.
    if (Game.phase === 'break' && p.hp < p.maxHp) p.hp = Math.min(p.maxHp, p.hp + PLAYER_BASE.breakRegen * dt);
    Classes.update(p, dt);
  },

  selectSlot(p, i) {
    if (!p.hotbar[i]) { Sound.play('error'); return; }
    if (p.slot !== i) {
      p.slot = i;
      p.reloadT = 0;
      p.chargeT = 0;
      Sound.play('click');
      UI.dirty = true;
    }
  },

  cycleWeapon(p, dir) {
    for (let k = 1; k <= HOTBAR_SIZE; k++) {
      const i = (p.slot + dir * k + HOTBAR_SIZE * 9) % HOTBAR_SIZE;
      if (p.hotbar[i]) { this.selectSlot(p, i); return; }
    }
  },

  // ---------- weapon bag ----------
  bagCapacity(p) { return BAG_LEVELS[p.bagLevel].slots; },
  bagCount(p) { return p.bag.filter(Boolean).length; },
  bagFree(p) {
    const cap = this.bagCapacity(p);
    for (let i = 0; i < cap; i++) if (!p.bag[i]) return i;
    return -1;
  },

  // Adds a weapon (or levels it up if already owned). Returns 'new', 'upgrade',
  // 'max', or 'full' when the bag has no room (the caller drops it on the ground).
  giveWeapon(p, id, level = 1, mag = null) {
    const w = WEAPON_BY_ID[id];
    if (!p.weapons[id]) {
      const free = this.bagFree(p);
      if (free < 0) return 'full';
      p.bag[free] = id;
      p.weapons[id] = level;
      if (w.kind === 'gun') p.mags[id] = mag === null ? w.mag : mag;
      const hot = p.hotbar.indexOf(null);
      if (hot >= 0) p.hotbar[hot] = id;
      UI.dirty = true;
      return 'new';
    }
    if (p.weapons[id] < MAX_LEVEL) { p.weapons[id]++; UI.dirty = true; return 'upgrade'; }
    return 'max';
  },

  // Throws a weapon out of the bag. It lands on the ground where you can pick it up again.
  throwWeapon(p, id) {
    if (!p.weapons[id]) return false;
    if (this.bagCount(p) <= 1) { UI.toast("YOU CAN'T THROW YOUR LAST WEAPON", '#ff3d4e'); Sound.play('error'); return false; }
    const a = p.aim, w = WEAPON_BY_ID[id];
    Loot.dropWeapon(id, p.weapons[id], p.x + Math.cos(a) * 14, p.y + Math.sin(a) * 14, p.mags[id]);
    delete p.weapons[id];
    delete p.mags[id];
    p.bag[p.bag.indexOf(id)] = null;
    const h = p.hotbar.indexOf(id);
    if (h >= 0) p.hotbar[h] = null;
    if (!p.hotbar[p.slot]) {
      const next = p.hotbar.findIndex(Boolean);
      if (next >= 0) p.slot = next;
    }
    p.reloadT = 0;
    Sound.play('throw');
    UI.toast(`THREW ${w.name.toUpperCase()} - PRESS E ON IT TO PICK UP`, '#8a8aa8');
    UI.dirty = true;
    return true;
  },

  upgradeBag(p) {
    const next = BAG_LEVELS[p.bagLevel + 1];
    if (!next || !canAfford(p.inv, next.cost)) { Sound.play('error'); return false; }
    payCost(p.inv, next.cost);
    p.bagLevel++;
    Sound.play('upgrade');
    UI.toast(`BAG UPGRADED: ${next.slots} WEAPON SLOTS`, '#ffd040');
    UI.dirty = true;
    return true;
  },

  // Puts an owned weapon into a hotbar slot (swapping places if it was already on the bar).
  assignHotbar(p, id, slot) {
    if (!p.weapons[id]) return;
    const at = p.hotbar.indexOf(id);
    if (at === slot) return;
    if (at >= 0) p.hotbar[at] = p.hotbar[slot];
    p.hotbar[slot] = id;
    if (slot === p.slot || at === p.slot) p.reloadT = 0;
    Sound.play('click');
    UI.dirty = true;
  },

  unassignHotbar(p, id) {
    const at = p.hotbar.indexOf(id);
    if (at < 0) return;
    if (p.hotbar.filter(Boolean).length <= 1) { Sound.play('error'); return; }
    p.hotbar[at] = null;
    if (at === p.slot) p.slot = p.hotbar.findIndex(Boolean);
    Sound.play('click');
    UI.dirty = true;
  },

  equip(p, id) { this.assignHotbar(p, id, p.slot); },

  nearestNode(p) {
    let best = null, bestD = 23 * 23;
    const tx = toTile(p.x), ty = toTile(p.y);
    for (let y = ty - 2; y <= ty + 2; y++) for (let x = tx - 2; x <= tx + 2; x++) {
      const n = World.nodeAt(x, y);
      if (!n || n.uses <= 0) continue;
      const d = dist2(p.x, p.y, (x + 0.5) * TILE, (y + 0.5) * TILE);
      if (d < bestD) { bestD = d; best = n; }
    }
    return best;
  },

  harvest(p, node) {
    if (node.uses <= 0) return;
    const def = NODE_TYPES[node.kind];
    const amount = Classes.lootAmount(p, def.yield + (def.yield > 1 && Math.random() < 0.25 ? 1 : 0));
    Net.harvested(node);
    p.inv[def.res] += amount;
    node.uses--;
    node.shake = 0.15;
    const cx = (node.tx + 0.5) * TILE, cy = (node.ty + 0.5) * TILE;
    const col = MATERIALS[def.res].color;
    FX.burst(cx, cy, col, 5, 50, 0.35);
    FX.float(cx, cy - 10, `+${amount} ${itemName(def.res)}`, col);
    if (def.bonus && Math.random() < def.bonus[1]) {
      p.inv[def.bonus[0]] += 1;
      FX.float(cx, cy - 17, `+1 ${itemName(def.bonus[0])}!`, MATERIALS[def.bonus[0]].color, 1.1);
      if (['diamond', 'techshard', 'voidcrystal'].includes(def.bonus[0])) Sound.play('crit');
    }
    const res = def.res;
    Sound.play(res === 'wood' ? 'gather_wood' : res === 'stone' ? 'gather_stone' : res === 'metal' || res === 'techshard' ? 'gather_metal' : 'gather_crystal', cx, cy);
    if (node.uses <= 0) { World.flowDirty = true; FX.burst(cx, cy, col, 10, 70, 0.5); }
    UI.dirty = true;
  },

  quickHeal(p) {
    const missing = p.maxHp - p.hp;
    if (missing < 1) { UI.toast('HP IS FULL', '#8a8aa8'); return; }
    const owned = Object.keys(HEAL_ITEMS).filter(k => p.inv[k] > 0).sort((a, b) => HEAL_ITEMS[a].heal - HEAL_ITEMS[b].heal);
    if (!owned.length) { UI.toast('NO HEALING ITEMS - CRAFT SOME (C)', '#ff3d4e'); Sound.play('error'); return; }
    // Use the biggest item that won't waste much healing; otherwise the smallest one.
    const eff = k => Math.min(this.healAmount(p, k), p.maxHp);
    const fits = owned.filter(k => eff(k) <= missing + 10);
    const item = fits.length ? fits[fits.length - 1] : owned[0];
    p.inv[item]--;
    const healed = Math.min(missing, this.healAmount(p, item));
    p.hp += healed;
    p.burnT = p.poisonT = 0;
    FX.float(p.x, p.y - 14, `+${Math.round(healed)}`, '#5fe05f');
    FX.burst(p.x, p.y, '#5fe05f', 10, 40, 0.5);
    Sound.play('heal');
    UI.toast(`USED ${HEAL_ITEMS[item].name.toUpperCase()}`, '#5fe05f');
    UI.dirty = true;
  },

  damage(p, amount, opts = {}) {
    if (p.remote) { Net.hurt(p, amount, opts); return; }   // a teammate: their own game applies it
    if (Game.state !== 'playing' || p.dead) return;
    if (!opts.dot) {
      if (p.invT > 0) return;
      p.invT = PLAYER_BASE.invuln;
      p.hurtT = 0.2;
      p.lastHurtT = Game.time;
      Sound.play('hurt');
      FX.shake(2.5);
    }
    amount *= this.damageTaken(p);
    if (p.domeT > 0) amount *= 0.4;   // Genesis energy dome
    p.hp -= amount;
    FX.float(p.x + rand(-4, 4), p.y - 16, Math.max(1, Math.round(amount)), opts.color || '#ff4050', 0.6);
    if (p.hp <= 0) {
      p.hp = 0;
      Waves.onPlayerDeath();
    }
  },
};
