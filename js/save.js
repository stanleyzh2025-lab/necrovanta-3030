// ============================================================
// save.js - autosave. Your whole run is saved: wave, survivor,
// bag, mods, skins, everything you built, chests still waiting
// to be opened, opened exploration chests, harvested trees and
// rocks, and thrown weapons. It saves after every wave, every
// 20 seconds, shortly after you build / craft / forge, and when
// you quit or close the tab. Continue (or Retry after dying)
// starts again from the wave you were on.
// ============================================================

const Save = {
  timer: 20,
  dirtyT: 0,     // > 0: something changed, save when it reaches 0

  enabled() { return Game.state === 'playing' && Game.player && !Net.active; },

  // Something worth keeping changed (a build, craft, upgrade...): save in a moment.
  touch() { if (this.enabled() && this.dirtyT <= 0) this.dirtyT = 1.5; },

  update(dt) {
    if (!this.enabled()) return;
    if (this.dirtyT > 0 && (this.dirtyT -= dt) <= 0) this.save();
    if ((this.timer -= dt) <= 0) this.save();
  },

  snapshot() {
    const p = Game.player, inWave = Game.phase === 'wave';
    const clone = o => JSON.parse(JSON.stringify(o));
    return {
      v: 3,
      // A save made during a wave restarts that wave, so it records the last finished one.
      wave: inWave ? Game.wave - 1 : Game.wave,
      kills: Game.kills, score: Game.score, time: Game.time, explored: Game.explored || 0,
      player: {
        cls: p.cls, x: p.x, y: p.y, weapons: { ...p.weapons }, inv: { ...p.inv }, upgrades: { ...p.upgrades },
        hotbar: [...p.hotbar], slot: p.slot, mags: { ...p.mags }, bag: [...p.bag], bagLevel: p.bagLevel,
        mods: clone(p.mods), skins: clone(p.skins), skin: { ...p.skin },
      },
      structures: Game.structures.filter(s => !s.dead).map(s => [s.def.id, s.tx, s.ty, Math.round(s.hp)]),
      chests: Game.chests.filter(c => !c.opened && !c.explore).map(c => [c.tx, c.ty, c.rarity, c.cache ? 1 : 0, c.weapon || 0]),
      openedChests: [...World.openedExplore],
      nodes: World.depletedNodes(),
      ground: Game.groundWeapons.map(g => [g.id, g.level, Math.round(g.x), Math.round(g.y), g.mag || 0]),
    };
  },

  save(announce = false) {
    if (!this.enabled()) return;
    this.timer = 20;
    this.dirtyT = 0;
    Game.checkpoint = this.snapshot();
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(Game.checkpoint)); } catch (e) { /* storage full or blocked */ }
    if (announce) UI.toast(`PROGRESS SAVED - NEXT: WAVE ${Game.checkpoint.wave + 1}`, '#ffd040');
  },

  load() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch (e) { return null; }
  },

  clear() {
    try { localStorage.removeItem(SAVE_KEY); } catch (e) { /* ignore */ }
  },

  // World state that must be known before chunks generate again (called right after World.reset).
  restoreWorld(cp) {
    for (const k of cp.openedChests || []) World.openedExplore.add(k);
    for (const [tx, ty, uses] of cp.nodes || []) World.depleted.set(tx + ',' + ty, uses);
  },

  // Everything else, once the player exists.
  restoreObjects(cp) {
    for (const [id, tx, ty, hp] of cp.structures || []) {
      if (STRUCT_BY_ID[id] && World.isOpenGround(tx, ty)) Structures.place(STRUCT_BY_ID[id], tx, ty).hp = hp;
    }
    for (const [tx, ty, rarity, cache, weapon] of cp.chests || []) {
      if (World.isSolid(tx, ty)) continue;
      const c = Loot.addChest(tx, ty, clamp(rarity, 0, RARITIES.length - 1), !!cache);
      if (weapon && WEAPON_BY_ID[weapon]) c.weapon = weapon;
    }
    for (const [id, level, x, y, mag] of cp.ground || []) {
      if (WEAPON_BY_ID[id]) Loot.dropWeapon(id, clamp(level, 1, MAX_LEVEL), x, y, mag);
    }
  },
};

// Save when the tab is closed or hidden.
window.addEventListener('pagehide', () => Save.save());
document.addEventListener('visibilitychange', () => { if (document.hidden) Save.save(); });
