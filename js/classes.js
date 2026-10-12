// ============================================================
// classes.js - survivor classes: starting kits and passive perks.
// The class list itself lives in config.js (CLASSES); this file
// turns a class into numbers the rest of the game asks for.
// ============================================================

const Classes = {
  // What every stat is when a class doesn't change it.
  defaults: {
    reload: 1, meleeSpeed: 1, combo: 0, quickdraw: 0,   // weapon handling
    gunRange: 1, gunCrit: 0, burn: 1, abilityCd: 1,    // damage
    hp: 0, armor: 1, speed: 1, thorns: 0, burnImmune: false, heal: 1, regen: 0,   // survival
    buildCost: 1, structHp: 1, turretRate: 1, loot: 1, chestWeapon: 1,             // base and loot
  },

  get(p) { return CLASS_BY_ID[(p && p.cls) || 'survivor'] || CLASSES[0]; },

  stat(p, key) {
    const s = this.get(p).stats;
    return s[key] !== undefined ? s[key] : this.defaults[key];
  },

  // Fresh game: hand out the class's starting weapons, items and mods.
  applyStart(p, id) {
    const c = CLASS_BY_ID[id] || CLASSES[0], st = c.start;
    p.cls = c.id;
    p.weapons = {};
    p.bag = Array(BAG_MAX).fill(null);
    p.hotbar = Array(HOTBAR_SIZE).fill(null);
    p.mags = {};
    st.weapons.forEach((wid, i) => {
      const w = WEAPON_BY_ID[wid];
      p.weapons[wid] = 1;
      p.bag[i] = wid;
      p.hotbar[i] = wid;
      if (w.kind === 'gun') p.mags[wid] = w.mag;
    });
    for (const k in st.inv || {}) p.inv[k] = (p.inv[k] || 0) + st.inv[k];
    for (const wid in st.mods || {}) {
      const m = Object.assign({ mk: {} }, st.mods[wid]);
      for (const slot in st.mods[wid]) m.mk[slot] = 1;
      p.mods[wid] = m;
    }
    if (st.bagLevel) p.bagLevel = st.bagLevel;
    p.slot = 0;
  },

  update(p, dt) {
    // Blade Dancer combo fades if you stop hitting things.
    if (p.combo > 0 && (p.comboT -= dt) <= 0) p.combo = 0;
    // Medic regeneration after a few seconds without being hurt.
    const regen = this.stat(p, 'regen');
    if (regen && p.hp < p.maxHp && Game.time - (p.lastHurtT || -99) > 4) p.hp = Math.min(p.maxHp, p.hp + regen * dt);
  },

  // Melee damage multiplier from the current combo.
  meleeMult(p) { return 1 + this.stat(p, 'combo') * (p.combo || 0); },

  onMeleeHit(p) {
    if (!this.stat(p, 'combo')) return;
    p.combo = Math.min(10, (p.combo || 0) + 1);
    p.comboT = 1.5;
    if (p.combo >= 5 && p.combo % 5 === 0) FX.float(p.x, p.y - 20, `COMBO X${p.combo}`, '#ff5cf0', 0.7);
  },

  // Gunslinger: a finished reload arms a quickdraw shot.
  onReloaded(p) { if (this.stat(p, 'quickdraw')) p.quickdraw = true; },

  // Damage multiplier for the next gun shot (and uses up the quickdraw).
  shotMult(p) {
    if (!p.quickdraw) return 1;
    p.quickdraw = false;
    FX.float(p.x, p.y - 20, 'QUICKDRAW', '#ffb84a', 0.6);
    return 1 + this.stat(p, 'quickdraw');
  },

  // Bulwark spiked armor: punish zombies that land a hit.
  onHitBy(p, z) {
    const t = this.stat(p, 'thorns');
    if (!t || z.dead) return;
    Zombies.damage(z, t, { kb: 160, angle: Math.atan2(z.y - p.y, z.x - p.x) });
    FX.burst(z.x, z.y - 6, '#c8ccd8', 5, 50, 0.25);
  },

  // Scales a material amount by the Scavenger bonus (fractions round up by chance).
  lootAmount(p, n) {
    const v = n * this.stat(p, 'loot'), f = Math.floor(v);
    return f + (Math.random() < v - f ? 1 : 0);
  },

  // Structure costs after the Engineer discount.
  structCost(def, p = Game.player) {
    const m = this.stat(p, 'buildCost'), c = {};
    for (const k in def.cost) c[k] = Math.max(1, Math.ceil(def.cost[k] * m));
    return c;
  },
};
