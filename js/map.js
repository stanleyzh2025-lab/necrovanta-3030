// ============================================================
// map.js - the infinite city. The world is made of CHUNK x CHUNK
// tile chunks generated on demand from a seed (same world every run).
// Each chunk = one city block plus the roads on its top/left edges,
// so neighbouring chunks always line up. Farther chunks hold rarer
// zones: crystal fields, crash sites, weapon caches, alien rifts.
// ============================================================

const T = {
  GRASS: 0, DIRT: 1, ROAD: 2, SIDEWALK: 3, ROOF: 4, RUINWALL: 5, RUBBLE: 6, PLAZA: 7,
  WATER: 8, CRATER: 9, MONUMENT: 10, PYLON: 11, ROCKY: 12, HULL: 13, ALIEN: 14, FLOOR: 15,
};
const TILE_SOLID =        [0, 0, 0, 0, 1, 1, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0].map(Boolean);
const TILE_BLOCKS_SHOTS = [0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 1, 1, 0, 1, 0, 0].map(Boolean);
const MINIMAP_COLORS = ['#3a5228', '#5a4a35', '#2a2a32', '#55555e', '#6a6e80', '#7a7a80', '#4a4640', '#3a4a5a',
  '#2a6a3a', '#3a3530', '#3ff0ff', '#3ff0ff', '#4a4652', '#8a94a6', '#3a2050', '#2e333c'];
const NODE_MINI_COLORS = { tree: '#2a4a1a', deadtree: '#4a3a2a', rock: '#8a8a94', scrap: '#9aa4b6', wreck: '#7a5a4a',
  crystal: '#9ff8ff', techdebris: '#3ff0ff', core: '#ff5cf0', voidcrystal: '#c060ff', alienrock: '#5a3a7a' };

// Zone names (HUD) and the message shown the first time you enter a special one.
const ZONES = {
  plaza:     { name: 'PLAZA (BASE)' },
  buildings: { name: 'CITY BLOCK' },
  ruins:     { name: 'RUINS' },
  park:      { name: 'PARK' },
  lot:       { name: 'SCRAPYARD' },
  forest:    { name: 'OVERGROWN FOREST' },
  wasteland: { name: 'WASTELAND' },
  crystal:   { name: 'CRYSTAL FIELD', alert: 'DIAMOND CRYSTALS DETECTED', color: '#9ff8ff' },
  crash:     { name: 'CRASH SITE', alert: 'TECH SHARDS AND PLASMA CORES', color: '#3ff0ff' },
  armory:    { name: 'WEAPON CACHE', alert: 'ABANDONED ARMORY - WEAPON INSIDE', color: '#ffd040' },
  rift:      { name: 'ALIEN RIFT', alert: 'VOID CRYSTALS DETECTED', color: '#c060ff' },
};

const World = {
  chunks: new Map(),
  lastKey: -1,
  lastChunk: null,
  _i: 0,                                       // local tile index from the last cell() call
  spawnPoint: { x: 13 * TILE, y: 16.5 * TILE },
  monument: { x: 12 * TILE, y: 11 * TILE },
  flowW: FLOW_RADIUS * 2 + 1,
  flow: new Float64Array((FLOW_RADIUS * 2 + 1) ** 2),
  flowCost: new Float64Array((FLOW_RADIUS * 2 + 1) ** 2),
  flowX0: 0,
  flowY0: 0,
  flowDirty: true,
  flowTimer: 0,
  flowTile: '',
  evictTimer: 0,

  openedExplore: new Set(),   // 'tx,ty' of exploration chests already opened (saved)
  depleted: new Map(),        // 'tx,ty' -> uses left, for harvested nodes (saved)

  reset() {
    this.chunks.clear();
    this.openedExplore.clear();
    this.depleted.clear();
    this.lastKey = -1;
    this.lastChunk = null;
    this.flow.fill(Infinity);
    this.flowDirty = true;
  },

  // ---------------------------------------------------------- lookups
  chunk(cx, cy) {
    const key = (cx + 32768) * 65536 + (cy + 32768);
    if (key === this.lastKey) return this.lastChunk;
    let c = this.chunks.get(key);
    if (!c) c = this.generate(cx, cy, key);
    this.lastKey = key;
    this.lastChunk = c;
    return c;
  },

  // Chunk holding a tile; also stores the tile's local index in this._i.
  cell(tx, ty) {
    const cx = Math.floor(tx / CHUNK), cy = Math.floor(ty / CHUNK);
    const c = this.chunk(cx, cy);
    this._i = (ty - cy * CHUNK) * CHUNK + (tx - cx * CHUNK);
    return c;
  },

  tileAt(tx, ty) { return this.cell(tx, ty).tiles[this._i]; },
  inBounds() { return true; },   // the world never ends

  isSolid(tx, ty) {
    const c = this.cell(tx, ty), i = this._i;
    if (TILE_SOLID[c.tiles[i]]) return true;
    const n = c.nodeGrid[i];
    if (n !== -1 && c.nodes[n].uses > 0) return true;
    const s = c.structs[i];
    return !!(s && s.def.solid);
  },

  // Solid ignoring player structures (for zombies that phase through walls).
  isSolidStatic(tx, ty) {
    const c = this.cell(tx, ty), i = this._i;
    if (TILE_SOLID[c.tiles[i]]) return true;
    const n = c.nodeGrid[i];
    return n !== -1 && c.nodes[n].uses > 0;
  },

  blocksShots(tx, ty) { return TILE_BLOCKS_SHOTS[this.tileAt(tx, ty)]; },

  nodeAt(tx, ty) {
    const c = this.cell(tx, ty), n = c.nodeGrid[this._i];
    return n === -1 ? null : c.nodes[n];
  },

  structAt(tx, ty) { return this.cell(tx, ty).structs[this._i]; },
  setStruct(tx, ty, s) { this.cell(tx, ty).structs[this._i] = s; },

  // Free ground where a chest or structure could go.
  isOpenGround(tx, ty) {
    const c = this.cell(tx, ty), i = this._i;
    if (TILE_SOLID[c.tiles[i]] || c.structs[i]) return false;
    const n = c.nodeGrid[i];
    return n === -1 || c.nodes[n].uses <= 0;
  },

  moveCost(tx, ty) {
    const c = this.cell(tx, ty), i = this._i;
    if (TILE_SOLID[c.tiles[i]]) return Infinity;
    const n = c.nodeGrid[i];
    if (n !== -1 && c.nodes[n].uses > 0) return Infinity;
    const s = c.structs[i];
    if (s) return s.def.solid ? 12 : 3;
    return 1;
  },

  // Line of sight for shots (sampled every 4px).
  lineClear(x0, y0, x1, y1) {
    const d = dist(x0, y0, x1, y1), steps = Math.ceil(d / 4);
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      if (this.blocksShots(toTile(lerp(x0, x1, t)), toTile(lerp(y0, y1, t)))) return false;
    }
    return true;
  },

  // Can something walk in a straight line between two points (no solid tiles)?
  walkClear(x0, y0, x1, y1) {
    const d = dist(x0, y0, x1, y1), steps = Math.ceil(d / 4);
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      if (this.isSolid(toTile(lerp(x0, x1, t)), toTile(lerp(y0, y1, t)))) return false;
    }
    return true;
  },

  chunkAtPx(x, y) { return this.chunk(Math.floor(x / CHUNK_PX), Math.floor(y / CHUNK_PX)); },

  // Chunks in a square radius around a pixel position.
  chunksAround(x, y, radius) {
    const pcx = Math.floor(x / CHUNK_PX), pcy = Math.floor(y / CHUNK_PX), out = [];
    for (let cy = pcy - radius; cy <= pcy + radius; cy++) for (let cx = pcx - radius; cx <= pcx + radius; cx++) out.push(this.chunk(cx, cy));
    return out;
  },

  // Regrow depleted resource nodes near the player between waves.
  // Harvested nodes in every generated chunk, as [tx, ty, uses left] (for saves).
  depletedNodes() {
    const out = [];
    for (const c of this.chunks.values()) for (const n of c.nodes) if (n.uses < n.max) out.push([n.tx, n.ty, n.uses]);
    return out;
  },

  regrowNodes(chance) {
    const p = Game.player;
    let changed = false;
    for (const c of this.chunksAround(p.x, p.y, 2)) {
      for (const n of c.nodes) {
        if (n.uses > 0 || Math.random() > chance) continue;
        if (this.structAt(n.tx, n.ty) || Game.chests.some(ch => !ch.opened && ch.tx === n.tx && ch.ty === n.ty)) continue;
        if (Math.abs(p.x - (n.tx + 0.5) * TILE) < 14 && Math.abs(p.y - (n.ty + 0.5) * TILE) < 14) continue;
        n.uses = n.max;
        changed = true;
      }
    }
    if (changed) this.flowDirty = true;
  },

  // Per-frame housekeeping: drop far-away chunk images to save memory,
  // and announce special zones the first time the player walks in.
  update(dt, p) {
    this.evictTimer -= dt;
    if (this.evictTimer <= 0) {
      this.evictTimer = 1;
      const pcx = Math.floor(p.x / CHUNK_PX), pcy = Math.floor(p.y / CHUNK_PX);
      for (const c of this.chunks.values()) {
        if (c.canvas && (Math.abs(c.cx - pcx) > 3 || Math.abs(c.cy - pcy) > 3)) c.canvas = null;
      }
    }
    // Pre-render one nearby chunk image per frame so walking into new areas never hitches.
    for (const n of this.chunksAround(p.x, p.y, 2)) {
      if (!n.canvas) { this.renderChunk(n); break; }
    }
    const c = this.chunkAtPx(p.x, p.y);
    if (!c.visited) {
      c.visited = true;
      Game.explored = (Game.explored || 0) + 1;
      const z = ZONES[c.zone];
      if (z.alert && Game.state === 'playing') {
        UI.toast(`${z.name}: ${z.alert}`, z.color);
        Sound.play('discover');
      }
    }
  },

  // ---------------------------------------------------------- generation
  generate(cx, cy, key) {
    const N = CHUNK * CHUNK;
    const c = {
      cx, cy, key, tiles: new Uint8Array(N), nodeGrid: new Int16Array(N).fill(-1), nodes: [],
      structs: new Array(N).fill(null), buildings: [], zone: 'buildings', dist: Math.max(Math.abs(cx), Math.abs(cy)),
      canvas: null, mini: null, visited: false, ship: null, lamps: [], lights: [],
    };
    this.chunks.set(key, c);
    const rng = makeRng(hash2(cx, cy, MAP_SEED));
    const ctx = {
      c, rng,
      R: (a, b) => a + Math.floor(rng() * (b - a + 1)),
      P: arr => arr[Math.floor(rng() * arr.length)],
      set: (x, y, t) => { if (x >= 0 && y >= 0 && x < CHUNK && y < CHUNK) c.tiles[y * CHUNK + x] = t; },
      get: (x, y) => c.tiles[y * CHUNK + x],
      addNode: (kind, x, y) => {
        if (x < 0 || y < 0 || x >= CHUNK || y >= CHUNK) return;
        const i = y * CHUNK + x, t = c.tiles[i];
        if (c.nodeGrid[i] !== -1 || TILE_SOLID[t] || t === T.PLAZA || t === T.FLOOR) return;
        if ((t === T.ROAD || t === T.SIDEWALK) && kind !== 'wreck') return;
        const def = NODE_TYPES[kind];
        c.nodeGrid[i] = c.nodes.length;
        const ntx = cx * CHUNK + x, nty = cy * CHUNK + y, saved = this.depleted.get(ntx + ',' + nty);
        c.nodes.push({ kind, tx: ntx, ty: nty, uses: saved !== undefined ? saved : def.uses, max: def.uses, variant: Math.floor(rng() * 3), shake: 0 });
      },
    };
    const { set, R } = ctx;

    // Ground noise (uses world coordinates so it flows across chunks).
    for (let y = 0; y < CHUNK; y++) for (let x = 0; x < CHUNK; x++) {
      const gx = cx * CHUNK + x, gy = cy * CHUNK + y;
      const n = Math.sin(gx * 0.31 + 1.7) * Math.cos(gy * 0.27 + 0.4) + (rng() - 0.5) * 0.6;
      set(x, y, n > 0.45 ? T.DIRT : T.GRASS);
    }
    // Roads on the top and left edge (3 lanes) with sidewalks on both sides.
    for (let i = 0; i < CHUNK; i++) { set(3, i, T.SIDEWALK); set(CHUNK - 1, i, T.SIDEWALK); set(i, 3, T.SIDEWALK); set(i, CHUNK - 1, T.SIDEWALK); }
    for (let i = 0; i < CHUNK; i++) for (let k = 0; k < 3; k++) { set(k, i, T.ROAD); set(i, k, T.ROAD); }
    // Roads crumble the farther you travel from the plaza.
    const decay = c.dist <= 1 ? 0.02 : Math.min(0.3, 0.02 + (c.dist - 1) * 0.04);
    for (let y = 0; y < CHUNK; y++) for (let x = 0; x < CHUNK; x++) {
      if (x > 2 && y > 2) continue;
      const r = rng();
      if (r < decay * 0.5) set(x, y, T.CRATER);
      else if (r < decay) set(x, y, T.RUBBLE);
    }
    for (let i = R(0, 2); i > 0; i--) {
      if (rng() < 0.5) ctx.addNode('wreck', rng() < 0.5 ? 0 : 2, R(5, 21));
      else ctx.addNode('wreck', R(5, 21), rng() < 0.5 ? 0 : 2);
    }

    c.zone = this.pickZone(cx, cy, c.dist, rng);
    this['zone_' + c.zone](ctx, 4, 4, CHUNK - 2, CHUNK - 2);

    // Street lamps along the sidewalks: most work, some flicker, some are smashed.
    c.lamps = [];
    for (const [lx, ly] of [[3, 8], [3, 16], [8, 3], [16, 3]]) {
      if (rng() > 0.75) continue;
      const r = rng(), broken = c.dist > 3 ? 0.45 : 0.2;
      c.lamps.push({ lx, ly, state: r < broken ? 'broken' : r < broken + 0.15 ? 'flicker' : 'on' });
    }

    // Exploration chest: more likely and better the farther out you go.
    if (c.zone !== 'plaza') {
      let chance = Math.min(0.55, 0.22 + c.dist * 0.04);
      if (['crystal', 'crash', 'rift'].includes(c.zone)) chance += 0.15;
      if (rng() < chance) {
        const spot = this.freeSpot(ctx, 5, 21);
        // Skipped if a save says it was already opened.
        if (spot && !this.openedExplore.has((cx * CHUNK + spot[0]) + ',' + (cy * CHUNK + spot[1]))) {
          Loot.addChest(cx * CHUNK + spot[0], cy * CHUNK + spot[1], weightedPick(rarityWeights(exploreLevel(c.dist)))).explore = true;
        }
      }
    }
    return c;
  },

  freeSpot(ctx, lo, hi) {
    const { c, R } = ctx;
    for (let t = 0; t < 40; t++) {
      const x = R(lo, hi), y = R(lo, hi), i = y * CHUNK + x;
      if (!TILE_SOLID[c.tiles[i]] && c.nodeGrid[i] === -1 && c.tiles[i] !== T.WATER) return [x, y];
    }
    return null;
  },

  pickZone(cx, cy, d, rng) {
    if (cx === 0 && cy === 0) return 'plaza';
    if (d === 1) {
      // A fixed, balanced ring of blocks around the starting plaza.
      return { '0,-1': 'buildings', '1,-1': 'park', '1,0': 'ruins', '1,1': 'lot', '0,1': 'buildings', '-1,1': 'park', '-1,0': 'ruins', '-1,-1': 'lot' }[`${cx},${cy}`];
    }
    // Special zones (each roughly 7-9% of chunks once you are far enough out).
    const r = rng();
    let t = 0;
    if (d >= 5 && r < (t += 0.07)) return 'rift';
    if (d >= 3 && r < (t += 0.08)) return 'armory';
    if (r < (t += 0.09)) return 'crystal';
    if (r < (t += 0.09)) return 'crash';
    const table = d >= 3
      ? [['buildings', 3], ['ruins', 3], ['park', 1.5], ['lot', 2], ['forest', 2], ['wasteland', 2.5]]
      : [['buildings', 3.5], ['ruins', 2.5], ['park', 2], ['lot', 2], ['forest', 1.5]];
    let total = table.reduce((a, t) => a + t[1], 0), roll = rng() * total;
    for (const [name, w] of table) { roll -= w; if (roll <= 0) return name; }
    return 'buildings';
  },

  // ---------- zone builders (x0..x1, y0..y1 = block interior, local tiles) ----------
  zone_plaza(g, x0, y0, x1, y1) {
    const { set } = g;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) set(x, y, T.PLAZA);
    set(12, 11, T.MONUMENT); set(13, 11, T.MONUMENT); set(12, 12, T.MONUMENT); set(13, 12, T.MONUMENT);
    [[6, 6], [20, 6], [6, 20], [20, 20]].forEach(([x, y]) => set(x, y, T.PYLON));
    [[7, 9], [19, 13], [8, 19], [18, 8], [10, 5]].forEach(([x, y], i) => set(x, y, i % 2 ? T.RUBBLE : T.CRATER));
  },

  zone_buildings(g, x0, y0, x1, y1) {
    const { c, set, R, rng, addNode } = g;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if (rng() < 0.2) set(x, y, T.RUBBLE);
    const placed = [];
    for (let t = 0; t < 30 && placed.length < 3; t++) {
      const bw = R(4, 8), bh = R(3, 7);
      const bx = R(x0 + 1, x1 - bw), by = R(y0 + 1, y1 - bh);
      if (placed.some(p => bx < p.x + p.w + 2 && bx + bw + 2 > p.x && by < p.y + p.h + 2 && by + bh + 2 > p.y)) continue;
      placed.push({ x: bx, y: by, w: bw, h: bh, style: Math.floor(rng() * 4), seed: Math.floor(rng() * 1e6) });
    }
    for (const b of placed) {
      for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) set(x, y, T.ROOF);
      c.buildings.push(b);
    }
    for (let i = 0; i < 4; i++) addNode(rng() < 0.5 ? 'rock' : 'scrap', R(x0, x1), R(y0, y1));
    for (let i = 0; i < 2; i++) addNode('tree', R(x0, x1), R(y0, y1));
  },

  zone_ruins(g, x0, y0, x1, y1) {
    const { set, R, P, rng, addNode } = g;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) set(x, y, rng() < 0.5 ? T.RUBBLE : T.DIRT);
    const rx0 = x0 + 1, ry0 = y0 + 1, rx1 = x1 - 1, ry1 = y1 - 1;
    for (let x = rx0; x <= rx1; x++) for (const y of [ry0, ry1]) if (rng() < 0.6) set(x, y, T.RUINWALL);
    for (let y = ry0; y <= ry1; y++) for (const x of [rx0, rx1]) if (rng() < 0.6) set(x, y, T.RUINWALL);
    const mx = Math.floor((rx0 + rx1) / 2), my = Math.floor((ry0 + ry1) / 2);
    for (let d = -1; d <= 1; d++) { set(mx + d, ry0, T.RUBBLE); set(mx + d, ry1, T.RUBBLE); set(rx0, my + d, T.RUBBLE); set(rx1, my + d, T.RUBBLE); }
    for (let i = 0; i < 3; i++) {
      const sx = R(rx0 + 2, rx1 - 2), sy = R(ry0 + 2, ry1 - 2), len = R(1, 3);
      for (let j = 0; j < len; j++) set(sx + (i % 2 ? j : 0), sy + (i % 2 ? 0 : j), T.RUINWALL);
    }
    for (let i = 0; i < 6; i++) addNode(P(['scrap', 'scrap', 'rock', 'wreck']), R(rx0 + 1, rx1 - 1), R(ry0 + 1, ry1 - 1));
    for (let i = 0; i < 2; i++) addNode('deadtree', R(x0, x1), R(y0, y1));
  },

  zone_park(g, x0, y0, x1, y1) {
    const { set, R, rng, addNode } = g;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) set(x, y, T.GRASS);
    this.pond(g, x0, y0, x1, y1);
    const area = (x1 - x0 + 1) * (y1 - y0 + 1);
    for (let i = 0; i < area / 9; i++) addNode(rng() < 0.8 ? 'tree' : 'deadtree', R(x0, x1), R(y0, y1));
    for (let i = 0; i < 3; i++) addNode('rock', R(x0, x1), R(y0, y1));
  },

  zone_forest(g, x0, y0, x1, y1) {
    const { set, R, rng, addNode } = g;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) set(x, y, rng() < 0.85 ? T.GRASS : T.DIRT);
    if (rng() < 0.3) this.pond(g, x0, y0, x1, y1);
    const area = (x1 - x0 + 1) * (y1 - y0 + 1);
    for (let i = 0; i < area / 5; i++) addNode(rng() < 0.85 ? 'tree' : 'deadtree', R(x0, x1), R(y0, y1));
    for (let i = 0; i < 4; i++) addNode('rock', R(x0, x1), R(y0, y1));
  },

  zone_lot(g, x0, y0, x1, y1) {
    const { set, R, P, rng, addNode } = g;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) set(x, y, rng() < 0.75 ? T.DIRT : (rng() < 0.5 ? T.CRATER : T.RUBBLE));
    const area = (x1 - x0 + 1) * (y1 - y0 + 1);
    for (let i = 0; i < area / 14; i++) addNode(P(['wreck', 'scrap', 'scrap', 'rock']), R(x0, x1), R(y0, y1));
    for (let i = 0; i < 2; i++) addNode('deadtree', R(x0, x1), R(y0, y1));
  },

  zone_wasteland(g, x0, y0, x1, y1) {
    const { set, R, rng, addNode } = g;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const r = rng();
      set(x, y, r < 0.7 ? T.DIRT : r < 0.85 ? T.CRATER : T.RUBBLE);
    }
    for (let i = 0; i < 4; i++) addNode('deadtree', R(x0, x1), R(y0, y1));
    for (let i = 0; i < 4; i++) addNode('rock', R(x0, x1), R(y0, y1));
    for (let i = 0; i < 3; i++) addNode('scrap', R(x0, x1), R(y0, y1));
    addNode('wreck', R(x0, x1), R(y0, y1));
  },

  zone_crystal(g, x0, y0, x1, y1) {
    const { set, R, rng, addNode } = g;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) set(x, y, rng() < 0.85 ? T.ROCKY : T.RUBBLE);
    for (let i = R(4, 7); i > 0; i--) addNode('crystal', R(x0 + 1, x1 - 1), R(y0 + 1, y1 - 1));
    for (let i = R(3, 5); i > 0; i--) addNode('rock', R(x0, x1), R(y0, y1));
  },

  zone_crash(g, x0, y0, x1, y1) {
    const { c, set, R, rng, addNode } = g;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) set(x, y, rng() < 0.92 ? T.DIRT : T.CRATER);
    // Crashed ship hull in the middle, broken open at one end.
    const sx = 9, sy = 11, sw = 8, sh = 4;
    for (let y = sy; y < sy + sh; y++) for (let x = sx; x < sx + sw; x++) set(x, y, T.HULL);
    set(sx + sw - 1, sy, T.RUBBLE); set(sx + sw - 1, sy + sh - 1, T.RUBBLE);
    c.ship = { x: sx, y: sy, w: sw, h: sh };
    for (let i = R(5, 7); i > 0; i--) addNode('techdebris', R(x0, x1), R(y0, y1));
    if (rng() < 0.45) addNode('core', R(x0 + 1, x1 - 1), R(sy + sh + 1, y1 - 1));
    for (let i = 0; i < 2; i++) addNode('scrap', R(x0, x1), R(y0, y1));
  },

  zone_armory(g, x0, y0, x1, y1) {
    const { c, set, R, rng, addNode } = g;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) set(x, y, rng() < 0.6 ? T.DIRT : T.RUBBLE);
    // Bunker: wall ring with a door on the bottom, metal floor inside.
    for (let y = 8; y <= 18; y++) for (let x = 8; x <= 18; x++) {
      const edge = x === 8 || x === 18 || y === 8 || y === 18;
      set(x, y, edge ? T.RUINWALL : T.FLOOR);
    }
    for (let x = 12; x <= 14; x++) set(x, 18, T.FLOOR);
    const rar = Math.min(5, 1 + Math.floor(c.dist / 2));
    Loot.addChest(c.cx * CHUNK + 13, c.cy * CHUNK + 12, rar, true);
    for (let i = 0; i < 3; i++) addNode('scrap', R(x0, x1), rng() < 0.5 ? R(y0, 6) : R(20, y1));
  },

  zone_rift(g, x0, y0, x1, y1) {
    const { set, R, rng, addNode } = g;
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) set(x, y, rng() < 0.95 ? T.ALIEN : T.CRATER);
    for (let i = R(4, 6); i > 0; i--) addNode('alienrock', R(x0, x1), R(y0, y1));
    for (let i = R(2, 4); i > 0; i--) addNode('voidcrystal', R(x0 + 2, x1 - 2), R(y0 + 2, y1 - 2));
  },

  pond(g, x0, y0, x1, y1) {
    const { set, R } = g;
    const cx = R(x0 + 4, x1 - 4), cy = R(y0 + 4, y1 - 4), rx = R(2, 3), ry = R(2, 3);
    for (let y = cy - ry; y <= cy + ry; y++) for (let x = cx - rx; x <= cx + rx; x++) {
      if (((x - cx) / (rx + 0.5)) ** 2 + ((y - cy) / (ry + 0.5)) ** 2 < 1) set(x, y, T.WATER);
    }
  },

  // ---------------------------------------------------------- flow field
  // Dijkstra from the player's tile over a square window around them.
  // Zombies walk "downhill"; player walls are passable at a high cost so
  // zombies either walk around short walls or stop and smash them.
  updateFlow(dt, px, py) {
    this.flowTimer -= dt;
    const ptx = toTile(px), pty = toTile(py), key = ptx + ',' + pty;
    if (!this.flowDirty && (this.flowTimer > 0 || key === this.flowTile)) return;
    this.flowTimer = 0.25;
    this.flowDirty = false;
    this.flowTile = key;

    const W = this.flowW, R = FLOW_RADIUS, x0 = ptx - R, y0 = pty - R;
    this.flowX0 = x0;
    this.flowY0 = y0;
    const cost = this.flowCost, flow = this.flow;
    for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) cost[y * W + x] = this.moveCost(x0 + x, y0 + y);
    flow.fill(Infinity);
    const heap = new MinHeap(), start = R * W + R;
    flow[start] = 0;
    heap.push(0, start);
    while (heap.size) {
      const [d, i] = heap.pop();
      if (d > flow[i]) continue;
      const x = i % W, y = (i / W) | 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= W) continue;
        const j = ny * W + nx;
        let cst = cost[j];
        if (cst === Infinity) continue;
        if (dx && dy) {
          if (cost[y * W + nx] >= 5 || cost[ny * W + x] >= 5) continue;   // no corner cutting
          cst *= 1.414;
        }
        const nd = d + cst;
        if (nd < flow[j]) { flow[j] = nd; heap.push(nd, j); }
      }
    }
  },

  flowAt(tx, ty) {
    const x = tx - this.flowX0, y = ty - this.flowY0, W = this.flowW;
    if (x < 0 || y < 0 || x >= W || y >= W) return Infinity;
    return this.flow[y * W + x];
  },

  // ---------------------------------------------------------- rendering
  renderChunk(c) {
    const cv = makeCanvas(CHUNK_PX, CHUNK_PX);
    const g = cv.getContext('2d');
    const rng = makeRng(hash2(c.cx, c.cy, MAP_SEED + 1));
    // Static light sources in world pixels: lamps, lit windows, neon, landmarks.
    const ox = c.cx * CHUNK_PX, oy = c.cy * CHUNK_PX;
    const lights = c.lights = [];
    const light = (x, y, r, color, i, flicker = false) => lights.push({ x: ox + x, y: oy + y, r, color, i, flicker });
    for (let ly = 0; ly < CHUNK; ly++) for (let lx = 0; lx < CHUNK; lx++) this.drawTile(g, c, lx, ly, rng);
    for (const b of c.buildings) this.drawBuilding(g, b, light);
    if (c.zone === 'plaza') {
      this.drawMonument(g, 12 * TILE, 11 * TILE);
      this.drawPlazaDecor(g, rng);
      light(12 * TILE + 16, 11 * TILE + 12, 80, '#3ff0ff', 0.9);
      for (const [x, y] of [[6, 6], [20, 6], [6, 20], [20, 20]]) light(x * TILE + 8, y * TILE + 7, 40, '#3ff0ff', 0.7);
    }
    if (c.ship) {
      this.drawShip(g, c.ship);
      const sx = c.ship.x * TILE, sy = c.ship.y * TILE, sw = c.ship.w * TILE, sh = c.ship.h * TILE;
      for (let i = 0; i < 3; i++) light(sx + sw - 27 + i * 9, sy + sh - 7, 22, '#ff7a1a', 0.7, true);
    }
    if (c.zone === 'armory') { this.drawBunkerSign(g); light(11 * TILE + 24, 8 * TILE + 7, 34, '#ffd040', 0.6); }
    if (c.zone === 'rift') for (let i = 0; i < 6; i++) light(rng() * CHUNK_PX, rng() * CHUNK_PX, 26, '#c060ff', 0.5, rng() < 0.5);
    for (const lamp of c.lamps) {
      this.drawLamp(g, lamp);
      if (lamp.state !== 'broken') light(lamp.lx * TILE + 8, lamp.ly * TILE - 4, 62, '#cfeeff', 0.85, lamp.state === 'flicker');
    }
    c.canvas = cv;
    return cv;
  },

  miniFor(c) {
    if (c.mini) return c.mini;
    const m = makeCanvas(CHUNK, CHUNK), g = m.getContext('2d');
    for (let i = 0; i < c.tiles.length; i++) {
      const n = c.nodeGrid[i];
      g.fillStyle = n !== -1 ? NODE_MINI_COLORS[c.nodes[n].kind] : MINIMAP_COLORS[c.tiles[i]];
      g.fillRect(i % CHUNK, (i / CHUNK) | 0, 1, 1);
    }
    return (c.mini = m);
  },

  drawTile(g, c, lx, ly, rng) {
    const t = c.tiles[ly * CHUNK + lx];
    const x = lx * TILE, y = ly * TILE;
    const gx = c.cx * CHUNK + lx, gy = c.cy * CHUNK + ly;
    const speckle = (cols, count) => {
      for (let i = 0; i < count; i++) px(g, x + Math.floor(rng() * 16), y + Math.floor(rng() * 16), cols[Math.floor(rng() * cols.length)]);
    };
    switch (t) {
      case T.GRASS: {
        g.fillStyle = '#3e5a2c'; g.fillRect(x, y, 16, 16);
        speckle(['#4a6a32', '#34502a', '#56763a', '#5a5a2e'], 22);
        // Grass blades: dark root, lit tip.
        for (let i = 0; i < 6; i++) {
          const bx = x + Math.floor(rng() * 15), by = y + 1 + Math.floor(rng() * 14);
          px(g, bx, by, '#2e4620'); px(g, bx, by - 1, '#5e8a3a'); if (rng() < 0.5) px(g, bx + 1, by - 1, '#4a6a32');
        }
        if (rng() < 0.1) {   // tiny wildflowers
          const fx = x + 3 + Math.floor(rng() * 10), fy = y + 3 + Math.floor(rng() * 10), col = ['#e8e0c8', '#e8c840', '#b07ad8', '#e05a6a'][Math.floor(rng() * 4)];
          px(g, fx, fy, col); px(g, fx + 2, fy + 1, col); px(g, fx + 1, fy + 2, '#2e4620');
        }
        if (rng() < 0.2) { g.fillStyle = '#6a6a34'; g.fillRect(x + Math.floor(rng() * 12), y + Math.floor(rng() * 12), 3, 1); }
        break;
      }
      case T.DIRT:
        g.fillStyle = '#5a4a35'; g.fillRect(x, y, 16, 16);
        speckle(['#6a5a42', '#4a3c2a', '#76664c'], 18);
        for (let i = 0; i < 2; i++) {   // pebbles with a lit top and a shadow
          const bx = x + 2 + Math.floor(rng() * 12), by = y + 2 + Math.floor(rng() * 12);
          px(g, bx, by, '#9a8a70'); px(g, bx + 1, by, '#7a6a52'); px(g, bx, by + 1, '#3a2e20');
        }
        if (rng() < 0.1) { g.fillStyle = '#8a8a84'; g.fillRect(x + 4 + Math.floor(rng() * 8), y + 6 + Math.floor(rng() * 6), 2, 1); }
        if (c.zone === 'wasteland' && rng() < 0.05) { g.fillStyle = '#d8d0c0'; g.fillRect(x + 5, y + 8, 5, 1); g.fillRect(x + 6, y + 7, 1, 3); }   // bones
        break;
      case T.ROAD: case T.CRATER: {
        g.fillStyle = c.zone === 'rift' && t === T.CRATER ? '#1a0e24' : '#2a2a31'; g.fillRect(x, y, 16, 16);
        speckle(['#33333b', '#24242a', '#3a3a42'], 20);
        if (t === T.ROAD) {
          if (lx === 1 && ly > 2 && gy % 2 === 0) { g.fillStyle = '#8a7a3a'; g.fillRect(x + 7, y + 3, 2, 8); }
          if (ly === 1 && lx > 2 && gx % 2 === 0) { g.fillStyle = '#8a7a3a'; g.fillRect(x + 3, y + 7, 8, 2); }
        }
        if (rng() < 0.25) pxLine(g, x + rng() * 16, y + rng() * 16, x + rng() * 16, y + rng() * 16, '#1a1a1e');
        if (t === T.ROAD && rng() < 0.06) {   // oil stain with a faint rainbow sheen
          const ox = x + 3 + Math.floor(rng() * 6), oy = y + 4 + Math.floor(rng() * 6);
          g.fillStyle = '#1c1c22'; g.fillRect(ox, oy, 6, 3); g.fillRect(ox + 1, oy - 1, 4, 5);
          px(g, ox + 2, oy, '#3a3a5a'); px(g, ox + 3, oy + 1, '#3a4a3a');
        }
        if (t === T.ROAD && rng() < 0.05) {   // litter
          g.fillStyle = ['#8a2a2a', '#c8c8c0', '#4a6a8a'][Math.floor(rng() * 3)];
          g.fillRect(x + 2 + Math.floor(rng() * 11), y + 2 + Math.floor(rng() * 11), 2, 1);
        }
        if (t === T.CRATER) this.drawCrater(g, x, y, rng, c.zone === 'rift');
        break;
      }
      case T.SIDEWALK:
        g.fillStyle = '#5a5a62'; g.fillRect(x, y, 16, 16);
        g.fillStyle = '#64646c'; g.fillRect(x, y, 16, 1); g.fillRect(x, y + 8, 16, 1); g.fillRect(x, y, 1, 16); g.fillRect(x + 8, y, 1, 16);   // slab bevels
        g.fillStyle = '#4a4a52'; g.fillRect(x, y + 15, 16, 1); g.fillRect(x + 15, y, 1, 16); g.fillRect(x + 7, y, 1, 16); g.fillRect(x, y + 7, 16, 1);
        speckle(['#66666e', '#505058'], 8);
        if (rng() < 0.15) pxLine(g, x + 2, y + rng() * 16, x + 14, y + rng() * 16, '#3a3a40');
        if (rng() < 0.12) { px(g, x + 7, y + 3 + Math.floor(rng() * 10), '#4a6a32'); px(g, x + 6, y + 4 + Math.floor(rng() * 8), '#5a7a3a'); }   // weeds in the joints
        if (rng() < 0.05) { g.fillStyle = '#46464c'; g.fillRect(x + 2 + Math.floor(rng() * 10), y + 2 + Math.floor(rng() * 10), 2, 2); }   // old gum
        break;
      case T.RUBBLE:
        g.fillStyle = '#4a4640'; g.fillRect(x, y, 16, 16);
        speckle(['#5a564e', '#3a3630'], 14);
        for (let i = 0; i < 4; i++) {
          const rx = x + Math.floor(rng() * 13), ry = y + Math.floor(rng() * 13);
          g.fillStyle = '#7a7670'; g.fillRect(rx, ry, 3, 2);
          g.fillStyle = '#9a968e'; g.fillRect(rx, ry, 2, 1);
          g.fillStyle = '#2a2622'; g.fillRect(rx, ry + 2, 3, 1);
        }
        if (rng() < 0.2) pxLine(g, x + 3, y + 12, x + 12, y + 9, '#8a4a2a');   // rebar
        break;
      case T.PLAZA: case T.MONUMENT: case T.PYLON:
        g.fillStyle = '#323e4c'; g.fillRect(x, y, 16, 16);
        {
          // Four stone slabs per tile, each a slightly different tone with a lit top-left bevel.
          const tones = ['#3c4a5a', '#3a4756', '#3e4c5e', '#384452'];
          for (let q = 0; q < 4; q++) {
            const qx = x + 1 + (q % 2) * 8, qy = y + 1 + (q >> 1) * 8, tone = tones[(gx * 3 + gy * 5 + q) & 3];
            g.fillStyle = tone; g.fillRect(qx, qy, 7, 7);
            g.fillStyle = shade(tone, 0.12); g.fillRect(qx, qy, 7, 1); g.fillRect(qx, qy, 1, 7);
            g.fillStyle = shade(tone, -0.15); g.fillRect(qx + 1, qy + 6, 6, 1);
          }
        }
        g.fillStyle = '#28323e'; g.fillRect(x + 8, y + 1, 1, 14); g.fillRect(x + 1, y + 8, 14, 1);
        if ((gx + gy) % 4 === 0) { px(g, x + 1, y + 1, '#3ff0ff'); px(g, x + 2, y + 1, '#1a9aaa'); }
        if (rng() < 0.2) pxLine(g, x + 2, y + 3, x + 6 + rng() * 8, y + 12, '#262e38');
        if (rng() < 0.05) { px(g, x + 3 + Math.floor(rng() * 10), y + 3 + Math.floor(rng() * 10), '#8a6a3a'); }   // dead leaf
        if (t === T.PYLON) {
          g.fillStyle = '#1a1e26'; g.fillRect(x + 4, y + 2, 8, 13);
          g.fillStyle = '#5a6476'; g.fillRect(x + 5, y + 3, 6, 11);
          g.fillStyle = '#3ff0ff'; g.fillRect(x + 7, y + 4, 2, 7);
          g.fillStyle = '#9ff8ff'; g.fillRect(x + 7, y + 5, 1, 2);
        }
        break;
      case T.WATER: {
        // Toxic sludge: dark base, ripple lines, glowing bubbles, dark shore edges.
        g.fillStyle = '#16362a'; g.fillRect(x, y, 16, 16);
        speckle(['#1e4a32', '#12281e'], 10);
        for (let i = 0; i < 2; i++) { g.fillStyle = '#2f7a3a'; g.fillRect(x + Math.floor(rng() * 10), y + 3 + i * 7 + Math.floor(rng() * 3), 4 + Math.floor(rng() * 3), 1); }
        if (rng() < 0.35) { const bx = x + 3 + Math.floor(rng() * 10), by = y + 3 + Math.floor(rng() * 10); px(g, bx, by, '#8aff50'); px(g, bx + 1, by - 1, '#c8ff90'); }
        const edge = (dx, dy) => {
          const nx = lx + dx, ny = ly + dy;
          return nx < 0 || ny < 0 || nx >= CHUNK || ny >= CHUNK || c.tiles[ny * CHUNK + nx] !== T.WATER;
        };
        g.fillStyle = '#2a2418';
        if (edge(0, -1)) g.fillRect(x, y, 16, 2);
        if (edge(0, 1)) g.fillRect(x, y + 15, 16, 1);
        if (edge(-1, 0)) g.fillRect(x, y, 1, 16);
        if (edge(1, 0)) g.fillRect(x + 15, y, 1, 16);
        break;
      }
      case T.RUINWALL:
        g.fillStyle = '#4a4640'; g.fillRect(x, y, 16, 16);
        g.fillStyle = '#1e1c1a'; g.fillRect(x, y + 1, 16, 15);
        g.fillStyle = '#6a6a70'; g.fillRect(x + 1, y + 2, 14, 8);    // top face
        g.fillStyle = '#8a8a90'; g.fillRect(x + 1, y + 2, 14, 2);
        g.fillStyle = '#4a4a52'; g.fillRect(x + 1, y + 10, 14, 5);   // front face
        g.fillStyle = '#3a3a40'; g.fillRect(x + 1, y + 12, 14, 1);
        for (let i = 0; i < 3; i++) px(g, x + 2 + Math.floor(rng() * 12), y + 2, '#4a4640');   // chipped edge
        pxLine(g, x + 3 + rng() * 4, y + 3, x + 6 + rng() * 6, y + 9, '#4a4a50');
        if (rng() < 0.5) { px(g, x + 4, y + 1, '#8a4a2a'); px(g, x + 4, y, '#8a4a2a'); px(g, x + 11, y + 1, '#8a4a2a'); }
        break;
      case T.ROOF:
        g.fillStyle = '#1a1a20'; g.fillRect(x, y, 16, 16);   // drawn over by drawBuilding
        break;
      case T.ROCKY:
        g.fillStyle = '#3e3a44'; g.fillRect(x, y, 16, 16);
        speckle(['#4a4652', '#322e38', '#56525e'], 20);
        if (rng() < 0.25) px(g, x + 3 + Math.floor(rng() * 10), y + 3 + Math.floor(rng() * 10), '#9ff8ff');
        if (rng() < 0.2) pxLine(g, x + 2, y + rng() * 16, x + 13, y + rng() * 16, '#2a2630');
        break;
      case T.HULL:
        g.fillStyle = '#20242c'; g.fillRect(x, y, 16, 16);
        g.fillStyle = '#6a7486'; g.fillRect(x, y + 1, 16, 14);
        g.fillStyle = '#8a94a6'; g.fillRect(x, y + 1, 16, 2);
        g.fillStyle = '#4a5466'; g.fillRect(x, y + 12, 16, 3);
        g.fillStyle = '#3a4250'; g.fillRect(x + 7, y + 3, 1, 9);
        px(g, x + 2, y + 5, '#c8d0dc'); px(g, x + 13, y + 5, '#c8d0dc');
        if (rng() < 0.4) { g.fillStyle = '#1a1a1a'; g.fillRect(x + 3 + Math.floor(rng() * 8), y + 6, 4, 3); }   // scorch
        break;
      case T.ALIEN:
        g.fillStyle = '#24142e'; g.fillRect(x, y, 16, 16);
        speckle(['#2e1a3a', '#1a0e22', '#3a2048'], 18);
        if (rng() < 0.5) pxLine(g, x + rng() * 16, y + rng() * 16, x + rng() * 16, y + rng() * 16, '#7a3ab0');
        if (rng() < 0.25) px(g, x + 3 + Math.floor(rng() * 10), y + 3 + Math.floor(rng() * 10), '#ff5cf0');
        break;
      case T.FLOOR:
        g.fillStyle = '#2e333c'; g.fillRect(x, y, 16, 16);
        g.fillStyle = '#262a32';
        for (let i = 0; i < 16; i += 4) { g.fillRect(x + i, y, 1, 16); g.fillRect(x, y + i, 16, 1); }
        if (rng() < 0.15) { g.fillStyle = '#ffd040'; g.fillRect(x + 1, y + 14, 14, 1); }
        break;
    }
  },

  // Round scorched blast pit: lit rim on the lower-right, shadow on the upper-left.
  drawCrater(g, x, y, rng, alien) {
    const r = 4.8 + rng() * 1.4, cx = x + 7.5, cy = y + 7.5;
    for (let py = 0; py < 16; py++) for (let pxi = 0; pxi < 16; pxi++) {
      const dx = x + pxi + 0.5 - cx, dy = y + py + 0.5 - cy, d = Math.hypot(dx, dy);
      if (d > r + 1.6) continue;
      let col;
      if (d > r) col = rng() < 0.5 ? 'rgba(10,8,6,0.45)' : null;              // scorch halo
      else if (d > r - 1.2) col = dx + dy > 0 ? (alien ? '#5a3a7a' : '#5a5048') : (alien ? '#0e0614' : '#141210');   // rim
      else col = (dx + dy) < -2 ? (alien ? '#12081c' : '#1a1714') : (alien ? '#1e1028' : '#24201c');               // floor
      if (col) { g.fillStyle = col; g.fillRect(x + pxi, y + py, 1, 1); }
    }
    if (alien && rng() < 0.6) px(g, Math.round(cx), Math.round(cy), '#ff5cf0');
    else if (rng() < 0.4) { g.fillStyle = '#3a342e'; g.fillRect(Math.round(cx) - 1, Math.round(cy), 2, 1); }
  },

  // Roof + front facade of a ruined building (local chunk pixels).
  drawBuilding(g, b, light = () => {}) {
    const rng = makeRng(b.seed);
    const x = b.x * TILE, y = b.y * TILE, w = b.w * TILE, h = b.h * TILE;
    const styles = [
      { roof: '#4a4f5e', edge: '#6a7084', dark: '#33363f', wall: '#3a3e4a' },
      { roof: '#5e4a40', edge: '#7e6a5a', dark: '#3e302a', wall: '#4a3a32' },
      { roof: '#3e5250', edge: '#5a706c', dark: '#2a3836', wall: '#344442' },
      { roof: '#545058', edge: '#76707a', dark: '#38343c', wall: '#423e46' },
    ];
    const s = styles[b.style];
    const facade = 12;
    g.fillStyle = 'rgba(0,0,0,0.35)';
    g.fillRect(x + w, y + 4, 4, h - 4);
    g.fillStyle = s.dark; g.fillRect(x, y, w, h - facade);
    g.fillStyle = s.roof; g.fillRect(x + 2, y + 2, w - 4, h - facade - 4);
    g.fillStyle = s.edge; g.fillRect(x, y, w, 2); g.fillRect(x, y, 2, h - facade);
    for (let i = 0; i < w * h / 40; i++) px(g, x + 2 + Math.floor(rng() * (w - 4)), y + 2 + Math.floor(rng() * (h - facade - 4)), rng() < 0.5 ? s.dark : s.edge);
    const props = Math.floor(b.w * b.h / 6) + 1;
    for (let i = 0; i < props; i++) {
      const px0 = x + 4 + Math.floor(rng() * (w - 14)), py0 = y + 4 + Math.floor(rng() * Math.max(1, h - facade - 14));
      const r = rng();
      if (r < 0.3) {
        g.fillStyle = '#22242a'; g.fillRect(px0, py0, 7, 6);
        g.fillStyle = '#8a8e9a'; g.fillRect(px0, py0, 7, 2);
        g.fillStyle = '#4a4e5a'; g.fillRect(px0 + 1, py0 + 3, 5, 1);
      } else if (r < 0.55) {
        g.fillStyle = '#1a2236'; g.fillRect(px0, py0, 10, 7);
        g.fillStyle = '#2a4a8a';
        for (let a = 0; a < 3; a++) for (let cc = 0; cc < 2; cc++) g.fillRect(px0 + 1 + a * 3, py0 + 1 + cc * 3, 2, 2);
        if (rng() < 0.5) pxLine(g, px0 + 1, py0 + 1, px0 + 8, py0 + 5, '#9ac8ff');
      } else if (r < 0.75) {
        g.fillStyle = '#0c0c10'; g.fillRect(px0, py0, 8, 6); g.fillRect(px0 + 2, py0 - 1, 5, 8);
        g.fillStyle = '#5a5650'; g.fillRect(px0 + 1, py0 + 5, 3, 1); g.fillRect(px0 + 5, py0, 2, 1);
        px(g, px0 + 4, py0 + 2, '#8a4a2a');
      } else {
        g.fillStyle = '#22242a'; g.fillRect(px0 + 2, py0 + 6, 5, 2);
        pxLine(g, px0 + 4, py0 + 6, px0 + 4, py0, '#9a9aa6');
        px(g, px0 + 4, py0, '#ff3040');
        pxLine(g, px0 + 2, py0 + 2, px0 + 6, py0 + 2, '#9a9aa6');
      }
    }
    pxLine(g, x + rng() * w, y + 2, x + rng() * w, y + h - facade - 2, s.dark);
    const fy = y + h - facade;
    g.fillStyle = s.wall; g.fillRect(x, fy, w, facade);
    g.fillStyle = shade(s.wall, -0.3); g.fillRect(x, fy, w, 1); g.fillRect(x, y + h - 1, w, 1);
    for (let wx = x + 3; wx < x + w - 5; wx += 6) {
      const r = rng();
      const col = r < 0.12 ? '#e8d870' : r < 0.2 ? '#3ff0ff' : r < 0.55 ? '#14161c' : '#2a3040';
      g.fillStyle = '#14161c'; g.fillRect(wx, fy + 3, 4, 5);
      g.fillStyle = col; g.fillRect(wx + 1, fy + 4, 2, 3);
      if (r < 0.2) light(wx + 2, fy + 6, 16, col, 0.6, r < 0.04);
      if (r > 0.8) pxLine(g, wx, fy + 3, wx + 3, fy + 7, '#6a7080');
    }
    const dx = x + Math.floor(w / 2) - 3;
    g.fillStyle = '#0c0c10'; g.fillRect(dx, fy + 5, 6, 7);
    g.fillStyle = '#5a5650'; g.fillRect(dx - 1, fy + 4, 8, 1);
    if (rng() < 0.5) {
      const nx = x + 3 + Math.floor(rng() * (w - 14));
      const col = rng() < 0.5 ? '#ff4fd8' : '#3ff0ff';
      g.fillStyle = '#14161c'; g.fillRect(nx - 1, fy - 2, 12, 4);
      g.fillStyle = col; g.fillRect(nx, fy - 1, 3, 2); g.fillRect(nx + 4, fy - 1, 2, 2); g.fillRect(nx + 7, fy - 1, 3, 2);
      light(nx + 5, fy, 30, col, 0.75, rng() < 0.4);
    }
  },

  // Futuristic street lamp: pole base on the sidewalk, lamp head overhanging the road.
  drawLamp(g, lamp) {
    const x = lamp.lx * TILE + 8, y = lamp.ly * TILE + 8;
    g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(x - 2, y + 2, 5, 2);
    g.fillStyle = '#1a1e26'; g.fillRect(x - 1, y - 12, 3, 15);
    g.fillStyle = '#5a6476'; g.fillRect(x, y - 12, 1, 14);
    g.fillStyle = '#1a1e26'; g.fillRect(x - 3, y - 15, 7, 4);
    if (lamp.state === 'broken') {
      g.fillStyle = '#3a3a44'; g.fillRect(x - 2, y - 14, 5, 2);
      g.fillStyle = '#9ac8e0'; g.fillRect(x + 3, y + 3, 1, 1); g.fillRect(x - 3, y + 4, 1, 1);   // broken glass
    } else {
      g.fillStyle = '#cfeeff'; g.fillRect(x - 2, y - 14, 5, 2);
      g.fillStyle = '#ffffff'; g.fillRect(x - 1, y - 14, 3, 1);
    }
  },

  drawShip(g, s) {
    // Cockpit, engine nozzles and torn plating on top of the hull tiles.
    const x = s.x * TILE, y = s.y * TILE, w = s.w * TILE, h = s.h * TILE;
    g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(x + 4, y + h, w - 8, 4);
    g.fillStyle = '#2a3a5a'; g.fillRect(x + 4, y + 10, 18, 22);
    g.fillStyle = '#5a8aba'; g.fillRect(x + 6, y + 12, 14, 6);
    pxLine(g, x + 7, y + 13, x + 17, y + 17, '#c8e8ff');
    for (let i = 0; i < 3; i++) {
      g.fillStyle = '#1a1e26'; g.fillRect(x + w - 30 + i * 9, y + h - 12, 7, 10);
      g.fillStyle = '#ff7a1a'; g.fillRect(x + w - 28 + i * 9, y + h - 9, 3, 4);
    }
    g.fillStyle = '#ffd040';
    for (let i = 0; i < w - 40; i += 6) g.fillRect(x + 28 + i, y + 6, 3, 2);
    g.fillStyle = '#0c0c10'; g.fillRect(x + w / 2, y + 20, 10, 8);
  },

  drawBunkerSign(g) {
    const x = 11 * TILE, y = 8 * TILE + 3;
    g.fillStyle = '#14161c'; g.fillRect(x, y, 48, 9);
    g.fillStyle = '#ffd040';
    for (let i = 0; i < 6; i++) g.fillRect(x + 2 + i * 8, y + 2, 4, 5);
  },

  drawPlazaDecor(g, rng) {
    const m = { x: 12 * TILE, y: 11 * TILE };
    for (const [bx, by] of [[m.x - 56, m.y + 4], [m.x + 70, m.y + 4], [m.x - 56, m.y + 60], [m.x + 70, m.y + 60]]) {
      g.fillStyle = '#1a1e26'; g.fillRect(bx, by, 18, 6);
      g.fillStyle = '#6a5a4a'; g.fillRect(bx + 1, by + 1, 16, 2);
      g.fillStyle = '#4a3e32'; g.fillRect(bx + 1, by + 3, 16, 2);
      g.fillStyle = '#1a1e26'; g.fillRect(bx + 2, by + 6, 2, 2); g.fillRect(bx + 14, by + 6, 2, 2);
    }
    for (let i = 0; i < 9; i++) {
      const sx = m.x - 80 + Math.floor(rng() * 190), sy = m.y - 100 + Math.floor(rng() * 220);
      g.fillStyle = 'rgba(10,8,8,0.35)';
      g.fillRect(sx, sy, 8 + Math.floor(rng() * 8), 4 + Math.floor(rng() * 4));
      g.fillRect(sx + 2, sy - 2, 6, 8);
      if (rng() < 0.4) { g.fillStyle = 'rgba(90,16,16,0.5)'; g.fillRect(sx + 3, sy + 1, 3, 2); }
    }
  },

  drawMonument(g, x, y) {
    g.fillStyle = '#1a1e26'; g.fillRect(x + 2, y + 2, 28, 30);
    g.fillStyle = '#6a7486'; g.fillRect(x + 4, y + 18, 24, 12);
    g.fillStyle = '#8a94a6'; g.fillRect(x + 4, y + 18, 24, 2);
    g.fillStyle = '#4a5466'; g.fillRect(x + 10, y + 4, 12, 15);
    g.fillStyle = '#7a8496'; g.fillRect(x + 10, y + 4, 4, 15);
    g.fillStyle = '#1a1e26'; g.fillRect(x + 18, y + 4, 4, 3); g.fillRect(x + 20, y + 7, 2, 2);
    g.fillStyle = '#3ff0ff'; g.fillRect(x + 14, y + 9, 4, 6);
    g.fillStyle = '#c8ffff'; g.fillRect(x + 15, y + 10, 2, 3);
    pxLine(g, x + 6, y + 22, x + 26, y + 26, '#3a4250');
  },
};

// Minimal binary min-heap for the flow-field Dijkstra.
class MinHeap {
  constructor() { this.k = []; this.v = []; }
  get size() { return this.k.length; }
  push(key, val) {
    const k = this.k, v = this.v;
    let i = k.length;
    k.push(key); v.push(val);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= key) break;
      k[i] = k[p]; v[i] = v[p];
      i = p;
    }
    k[i] = key; v[i] = val;
  }
  pop() {
    const k = this.k, v = this.v;
    const topK = k[0], topV = v[0];
    const lastK = k.pop(), lastV = v.pop();
    const n = k.length;
    if (n > 0) {
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i, mk = lastK;
        if (l < n && k[l] < mk) { m = l; mk = k[l]; }
        if (r < n && k[r] < mk) { m = r; mk = k[r]; }
        if (m === i) break;
        k[i] = k[m]; v[i] = v[m];
        i = m;
      }
      k[i] = lastK; v[i] = lastV;
    }
    return [topK, topV];
  }
}
