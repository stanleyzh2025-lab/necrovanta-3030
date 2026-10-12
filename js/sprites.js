// ============================================================
// sprites.js - every pixel-art sprite is built once at startup
// (from text grids or small procedural drawings) into canvases.
// ============================================================

const OUTLINE = '#14141c';

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

// Build a sprite from rows of characters. '.' is transparent; other
// characters are looked up in the palette ('o' defaults to the outline color).
function spriteFromRows(rows, palette) {
  const w = Math.max(...rows.map(r => r.length));
  const c = makeCanvas(w, rows.length);
  const g = c.getContext('2d');
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const ch = row[x];
      if (ch === '.' || ch === ' ') continue;
      const col = palette[ch] || (ch === 'o' ? OUTLINE : null);
      if (!col) continue;
      g.fillStyle = col;
      g.fillRect(x, y, 1, 1);
    }
  });
  return c;
}

// Solid white silhouette of a sprite (used for the hit flash).
function silhouette(src, color = '#ffffff') {
  const c = makeCanvas(src.width, src.height);
  const g = c.getContext('2d');
  g.drawImage(src, 0, 0);
  g.globalCompositeOperation = 'source-in';
  g.fillStyle = color;
  g.fillRect(0, 0, c.width, c.height);
  return c;
}

// Adds a 1px outline around every opaque pixel.
function addOutline(c, color = OUTLINE) {
  const g = c.getContext('2d');
  const img = g.getImageData(0, 0, c.width, c.height);
  const d = img.data, w = c.width, h = c.height;
  const solid = (x, y) => x >= 0 && y >= 0 && x < w && y < h && d[(y * w + x) * 4 + 3] > 0;
  const marks = [];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (!solid(x, y) && (solid(x - 1, y) || solid(x + 1, y) || solid(x, y - 1) || solid(x, y + 1))) marks.push(x, y);
  }
  g.fillStyle = color;
  for (let i = 0; i < marks.length; i += 2) g.fillRect(marks[i], marks[i + 1], 1, 1);
  return c;
}

function px(g, x, y, color) { g.fillStyle = color; g.fillRect(x, y, 1, 1); }

// Pixel data of a finished sprite, read through a scratch canvas flagged for readback.
function readPixels(src) {
  const c = makeCanvas(src.width, src.height), g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(src, 0, 0);
  return g.getImageData(0, 0, src.width, src.height).data;
}

// Lighting + texture pass over a finished sprite: pixels on a top/left edge
// catch the light, bottom/right edges fall into shadow, and a fixed noise
// pattern adds material grain. Outline pixels are left alone.
function detailPass(c, o = {}) {
  const lit = o.lit ?? 0.2, shadow = o.shadow ?? 0.24, grain = o.grain ?? 0.06;
  const g = c.getContext('2d'), W = c.width, H = c.height;
  const img = g.getImageData(0, 0, W, H), d = img.data, src = new Uint8ClampedArray(d);
  const solid = (x, y) => {
    if (x < 0 || y < 0 || x >= W || y >= H) return false;
    const i = (y * W + x) * 4;
    return src[i + 3] >= 128 && !(src[i] === 0x14 && src[i + 1] === 0x14 && src[i + 2] === 0x1c);
  };
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    if (!solid(x, y)) continue;
    let k = 0;
    if (!solid(x, y - 1)) k += lit;
    if (!solid(x - 1, y)) k += lit * 0.4;
    if (!solid(x, y + 1)) k -= shadow;
    if (!solid(x + 1, y)) k -= shadow * 0.45;
    const n = (((x + (o.seed || 0)) * 73856093) ^ (y * 19349663)) >>> 0;
    if (n % 7 === 0) k -= grain; else if (n % 11 === 0) k += grain * 0.8;
    if (!k) continue;
    const i = (y * W + x) * 4;
    for (let ch = 0; ch < 3; ch++) d[i + ch] = k > 0 ? d[i + ch] + (255 - d[i + ch]) * k : d[i + ch] * (1 + k);
  }
  g.putImageData(img, 0, 0);
  return c;
}

// Pixel line (Bresenham) used for branches, cracks and lightning.
function pxLine(g, x0, y0, x1, y1, color) {
  x0 |= 0; y0 |= 0; x1 |= 0; y1 |= 0;
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  g.fillStyle = color;
  for (;;) {
    g.fillRect(x0, y0, 1, 1);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}

// Draw a shaded blob (trees, rocks): pixels inside an ellipse with a noisy edge,
// lit from the top-left. ramp = [light, mid, dark].
function shadedBlob(g, cx, cy, rx, ry, ramp, rng, rough = 0.18) {
  for (let y = Math.floor(cy - ry - 1); y <= cy + ry + 1; y++) {
    for (let x = Math.floor(cx - rx - 1); x <= cx + rx + 1; x++) {
      const nx = (x + 0.5 - cx) / rx, ny = (y + 0.5 - cy) / ry;
      const d = nx * nx + ny * ny;
      if (d > 1 - rng() * rough) continue;
      const light = -(nx + ny) * 0.5 + (rng() - 0.5) * 0.5;
      px(g, x, y, light > 0.25 ? ramp[0] : light > -0.3 ? ramp[1] : ramp[2]);
    }
  }
}

const Sprites = {
  player: [],          // [idle, walkA, walkB]
  playerFlash: [],
  zombies: {},         // type -> { frames: [..], flash: [..] }
  weapons: {},         // weapon id -> canvas
  icons: {},           // item id -> canvas
  chests: [],          // rarity index -> { closed, open }
  nodes: {},           // node kind -> [variants], plus '<kind>_dead'
  structures: {},      // structure id -> canvas
  turretBarrel: null,
  font: {},
  textCache: new Map(),

  init() {
    this.buildPlayer();
    this.buildZombies();
    this.buildBosses();
    this.buildWeapons();
    this.buildIcons();
    this.buildChests();
    this.buildNodes();
    this.buildStructures();
    this.buildFont();
  },

  // ---------- Player: futuristic survivor with helmet + cyan visor ----------
  buildPlayer() {
    const top = [
      '....oooo....',
      '...ohWhho...',
      '..ohWhhhho..',
      '..ohhvvvvvo.',
      '..oHhvwVvvo.',
      '..oHhhhhhho.',
      '...oHHlHHo..',
      '..oMssaasMo.',
      '.ogMssaAsMgo',
      '.ogSsaaasSgo',
      '..oSsssssSo.',
      '..oyyyByyyo.',
    ];
    const legs = [
      ['...oso.oso..', '...obo.obo..', '...ooo.ooo..'],
      ['...oso.oso..', '...obo.ooo..', '...ooo......'],
      ['...oso.oso..', '...ooo.obo..', '.......ooo..'],
    ];
    this.playerRows = { top, legs };
    const set = this.playerFor('survivor');
    this.player = set.frames;
    this.playerFlash = set.flash;
  },

  // Survivor frames recolored for a class (suit, accent, visor), cached per class.
  playerSets: {},
  playerFor(clsId) {
    if (this.playerSets[clsId]) return this.playerSets[clsId];
    const c = CLASS_BY_ID[clsId] || CLASSES[0], { top, legs } = this.playerRows;
    const pal = { h: '#dfe3ee', W: '#ffffff', H: '#8f96ad', v: c.visor, V: shade(c.visor, -0.45), w: '#ffffff', l: '#ff3d4e', M: '#a8b2c4',
                  s: c.suit, S: shade(c.suit, -0.32), a: c.accent, A: shade(c.accent, 0.5), g: '#8f96ad', y: '#4a3a2a', B: '#ffd040', b: '#22222c' };
    const pack = c.id === 'survivor' ? '#b85a1a' : shade(c.accent, -0.3);
    // Body frames, then a survival backpack drawn behind the back (left side).
    const frames = legs.map(l => {
      const body = spriteFromRows(top.concat(l), pal);
      const cv = makeCanvas(body.width + 1, body.height), g = cv.getContext('2d');
      g.fillStyle = OUTLINE; g.fillRect(0, 6, 4, 8);
      g.fillStyle = pack; g.fillRect(1, 7, 2, 6);
      g.fillStyle = shade(pack, 0.3); g.fillRect(1, 7, 2, 1);
      g.fillStyle = shade(pack, -0.4); g.fillRect(1, 11, 2, 1);   // strap
      g.fillStyle = '#5a6476'; g.fillRect(1, 6, 1, 1);             // antenna stub
      g.fillStyle = c.visor; g.fillRect(1, 9, 1, 1);
      g.drawImage(body, 1, 0);
      return detailPass(cv, { lit: 0.16, shadow: 0.22, grain: 0.04 });
    });
    return (this.playerSets[clsId] = { frames, flash: frames.map(f => silhouette(f, '#ff4050')) });
  },

  // ---------- Zombies: one base body, palette swapped, plus per-type details ----------
  // The sprite has 3 empty rows on top for flames / antennae / horns.
  // Overlay rows replace base pixels ('.' keeps the base pixel); a list of row
  // maps animates by walk frame.
  zombieOverlays: {
    armored:  { rows: { 2: '...ooooo....', 3: '..oMMMMMo...', 4: '..omMmmMo...', 9: '..oMMm......' }, pal: { M: '#9aa0ae', m: '#d8dee8' } },
    fast:     { rows: { 2: '....rrr.....', 3: '....rRr.....' }, pal: { r: '#d83a2a', R: '#ff6a4a' } },
    fire:     { rows: [{ 0: '....f..f....', 1: '...fFf.Ff...', 2: '..fFYFfFYf..' }, { 0: '.....f..f...', 1: '...fFfFf....', 2: '..fYFfFYFf..' }],
                pal: { f: '#e04a10', F: '#ffaa20', Y: '#ffe680' } },
    toxic:    { rows: { 4: '....B.......', 11: '..B.......d.', 12: '.....B....d.' }, pal: { B: '#d8ff60', d: '#7acc3a' } },
    electric: { rows: [{ 0: '.....y......', 1: '....yW......', 2: '.....Wy.....', 10: '.......y.y..' }, { 0: '......y.....', 1: '.....Wy.....', 2: '....yW......', 10: '........y.y.' }],
                pal: { y: '#fff060', W: '#ffffff' } },
    cyber:    { rows: { 1: '.......o....', 2: '......oRo...', 5: '..oVVVVVo...', 10: '.......SSSSo' }, pal: { R: '#ff2040', V: '#ff3050', S: '#a8b2c4' } },
    freezing: { rows: { 1: '...I...I....', 2: '...Ii.iI....', 9: '..oIi.......' }, pal: { I: '#ffffff', i: '#9fe8ff' } },
    titan:    { rows: { 1: '..H.....H...', 2: '...H...H....', 9: '.S..........' }, pal: { H: '#e8dcc0', S: '#c8c0b0' } },
    spitter:  { rows: { 8: '...oGGGo....', 9: '......G.....' }, pal: { G: '#c8ff40' } },
    riot:     { rows: { 2: '...ooooo....', 3: '..oHHHHHo...', 4: '..oVVVVVo...', 5: '..oHkekHo...' }, pal: { H: '#2a2e3a', V: '#3ff0ff' } },
    phantom:  { rows: [{ 15: '..o.o.o.....', 16: '...o.o......', 17: '............' }, { 15: '...o.o......', 16: '..o.o.o.....', 17: '............' }] },
    necro:    { rows: { 1: '...........O', 2: '...ooooo...S', 3: '..oRRRRRo..S', 4: '.oRRhhhRRo.S', 5: '.oR.....Ro.S', 6: '...........S',
                7: '...........S', 8: '...........S', 11: '...........S', 12: '...........S', 13: '...........S' },
                pal: { R: '#3a1a4a', S: '#6a4a2a', O: '#c060ff' } },
    wraith:   { rows: { 3: '..oWWWWWo...', 4: '.oWWWWWWWo..', 5: '.oWoEoEoWo..', 6: '.oWokkkoWo..', 15: '..oWWWWo....', 16: '..oWoWWo....', 17: '...o..o.....' },
                pal: { W: '#1a0e24', E: '#ff5cf0' } },
    omega:    { rows: { 1: '...C.C.C....', 2: '...CCCCC....', 9: '.S..........', 10: '...Q........', 11: '..oQQ.......' }, pal: { C: '#ff5cf0', Q: '#ff2a6a', S: '#e8dcc0' } },
    brute:    { rows: { 2: '...SSS......', 9: '.SS.........', 12: '.oCxxcco....' }, pal: { S: '#d8d0c0' } },
    juggernaut: { rows: { 3: '..oMMMMMo...', 4: '..oMmmmMo...', 8: '.PP.........', 9: '.PMMMmoooooo', 11: '.oMMMMooooo.', 13: '..oMMMMo....' },
                pal: { M: '#5a6476', m: '#a8b2c4', P: '#ffd040' } },
  },
  // Zombies that don't use the shared human body.
  customZombies: {
    crawler: {
      top: ['..............', '..............', '..............', '..........oooo', '.........ohhhho', '..ooooooookekeo', '.occcxccccokkko', 'opCcccccccoKKo.'],
      legs: [['opoCCCCCCoooko.', '.o.oooooo.okko.', '...........oo..'],
             ['opoCCCCCCoo....', '.o.oooooookko..', '.........okko..'],
             ['.poCCCCCCoooko.', 'oo.oooooo.okko.', '...........oo..']],
    },
    bloater: {
      top: ['..............', '..............', '..............', '....ooooo.....', '...ohhhhho....', '...okkekeo....', '...okkkkko....', '...oKkokKo....',
            '..ooKKKKKoo...', '.oxxxxxxxxxooo', 'oxxXxxxxxXxkko', 'oxxxxxXxxxxooo', 'oxXxxxxxxXxo..', 'oxxxxxxXxxxo..', '.oxxxxxxxxo...', '..ooopppoo....'],
      legs: [['...opopo......', '...okoko......', '...ooooo......'],
             ['...opopo......', '...okooo......', '...ooo........'],
             ['...opopo......', '...oooko......', '.....ooo......']],
    },
    leech: {
      top: ['........', '........', '..oooo..', '.okkkko.', 'okekkeko', 'okkKKkko', 'oKxooxKo', '.oKKKKo.'],
      legs: [['..o..o..'], ['.o....o.'], ['..o..o..']],
    },
  },

  buildZombies() {
    const top = [
      '............',
      '............',
      '............',
      '...ooooo....',
      '..ohhhhho...',
      '..oLkekeo...',
      '..oLkkkKo...',
      '..oKkowKo...',
      '...oKbKo....',
      '..occcxooooo',
      '.occxcckLkko',
      '.oCcncooooo.',
      '.oCbxcnco...',
      '..oCCCco....',
      '..opXpo.....',
    ];
    const legs = [
      ['..opopo.....', '..okoko.....', '..ooooo.....'],
      ['..opopo.....', '..okooo.....', '..ooo.......'],
      ['..opopo.....', '..oooko.....', '....ooo.....'],
    ];
    for (const id of ZOMBIE_ORDER) {
      const t = ZOMBIE_TYPES[id], ov = this.zombieOverlays[id], custom = this.customZombies[id];
      const pal = Object.assign({ K: shade(t.colors.k, -0.25), X: shade(t.colors.x, -0.35), L: shade(t.colors.k, 0.25),
                                  b: '#6a1010', n: '#d8d0c0', w: '#e8e0c8' }, t.colors, ov ? ov.pal : {});
      const body = custom ? custom.top : top, legSet = custom ? custom.legs : legs;
      const frames = legSet.map((l, f) => {
        const rows = body.concat(l).map(r => r.split(''));
        if (ov) {
          const layer = Array.isArray(ov.rows) ? ov.rows[f % ov.rows.length] : ov.rows;
          for (const r in layer) [...layer[r]].forEach((ch, x) => { if (ch !== '.') rows[r][x] = ch; });
        }
        const sp = spriteFromRows(rows.map(r => r.join('')), pal);
        if (!t.bulky) return detailPass(sp, { seed: f });
        // Bulky types: stamp the body twice, 2px apart, for a broader silhouette.
        const c = makeCanvas(sp.width + 2, sp.height), g = c.getContext('2d');
        g.drawImage(sp, 0, 0); g.drawImage(sp, 2, 0); g.drawImage(sp, 1, 0);
        return detailPass(c, { seed: f });
      });
      this.zombies[id] = { frames, flash: frames.map(f => silhouette(f)), ice: frames.map(f => silhouette(f, '#bfefff')) };
    }
  },

  // ---------- Mid-run bosses (drawn procedurally, 3 frames: idle, walk A, walk B) ----------
  buildBosses() {
    const R = (g, x, y, w, h, c) => { g.fillStyle = c; g.fillRect(x, y, w, h); };
    const set = (id, w, h, draw) => {
      const frames = [0, 1, 2].map(f => {
        const c = makeCanvas(w, h);
        draw(c.getContext('2d', { willReadFrequently: true }), f, makeRng(31));   // outlined, then shaded: read back twice
        addOutline(c);
        return detailPass(c, { seed: f });
      });
      this.zombies[id] = { frames, flash: frames.map(fr => silhouette(fr)), ice: frames.map(fr => silhouette(fr, '#bfefff')) };
    };

    // MAW, THE HIVE QUEEN: bloated egg-sac abdomen, spined head, snapping mandibles.
    set('hivequeen', 26, 20, (g, f, rng) => {
      const step = f === 1 ? 1 : f === 2 ? -1 : 0;
      for (let i = 0; i < 3; i++) {   // six legs behind the body
        const lx = 8 + i * 5, s = i % 2 ? step : -step;
        pxLine(g, lx, 13, lx - 2 + s, 19, '#3a4a2a');
        pxLine(g, lx + 1, 13, lx + 3 - s, 19, '#2a3a1e');
      }
      shadedBlob(g, 8, 10, 7.5, 6, ['#c8e070', '#8aaa40', '#4a6a2a'], rng, 0.08);
      for (let x = 4; x < 14; x += 3) pxLine(g, x, 5, x - 1, 15, '#5a7a30');   // segment ridges
      [[5, 8], [9, 11], [6, 13], [11, 7]].forEach(([x, y]) => { R(g, x, y, 2, 2, '#c8ff40'); px(g, x, y, '#f0ffb0'); });   // glowing eggs
      shadedBlob(g, 17, 10, 5, 4.5, ['#9ab060', '#6a8040', '#3a5024'], rng, 0.08);
      shadedBlob(g, 21, 7, 3.5, 3.2, ['#a8c070', '#7a9048', '#44582a'], rng, 0.06);
      [[19, 2], [21, 2], [23, 3]].forEach(([x, y]) => { px(g, x, y, '#e8e0c8'); px(g, x, y + 1, '#c8c0a8'); });   // spined crown
      px(g, 21, 6, '#ff3a20'); px(g, 23, 6, '#ff3a20'); px(g, 22, 5, '#ffb020');   // eyes
      const m = f === 2 ? 1 : 0;
      pxLine(g, 23, 9, 25, 10 + m, '#e8e0c8'); pxLine(g, 23, 10, 25, 12 + m, '#c8c0a8');   // mandibles
      px(g, 24, 13 + m, '#c8ff40');   // acid drool
    });

    // VOLTRAX, THE STORM ENGINE: zombie pilot in an armored frame with shoulder tesla coils.
    set('voltrax', 22, 26, (g, f) => {
      const step = f === 1 ? 1 : f === 2 ? -1 : 0;
      for (const [lx, up] of [[6, step > 0], [12, step < 0]]) {
        R(g, lx, 18 - (up ? 1 : 0), 4, 7, '#3a4458'); R(g, lx, 24, 5, 2, '#22283a'); R(g, lx + 1, 20 - (up ? 1 : 0), 2, 1, '#fff060');
      }
      R(g, 4, 9, 14, 10, '#4a5468'); R(g, 4, 9, 14, 2, '#8a94a6'); R(g, 5, 17, 12, 2, '#2a3040');   // torso plates
      R(g, 8, 11, 6, 5, '#22283a'); R(g, 9, 12, 4, 3, '#fff060'); px(g, 10, 12, '#ffffff');      // reactor core
      for (const sx of [3, 16]) {   // tesla coils
        R(g, sx, 3, 3, 7, '#5a6476');
        for (let y = 4; y < 10; y += 2) R(g, sx, y, 3, 1, '#c8a040');
        R(g, sx, 1, 3, 2, '#fff060'); px(g, sx + 1, 0, '#ffffff');
      }
      R(g, 8, 3, 6, 6, '#6a7a9a'); R(g, 8, 3, 6, 2, '#3ff0ff'); px(g, 10, 3, '#ffffff');       // cracked helmet, glowing brain
      px(g, 9, 6, '#3ff0ff'); px(g, 12, 6, '#3ff0ff'); R(g, 9, 8, 4, 1, '#22283a');
      R(g, 17, 12, 5, 3, '#5a6476'); R(g, 17, 12, 5, 1, '#8a94a6'); px(g, 21, 13, '#fff060');  // arm cannon
      R(g, 1, 12, 3, 5, '#3a4458'); px(g, 1, 17, '#c8ccd8'); px(g, 3, 17, '#c8ccd8');           // claw arm
      if (f) pxLine(g, 4, 0, 17, f, '#fff060');   // arc between the coils
    });

    // NECROVANTA, THE DEAD KING: crowned skull, royal robe, soul-orb staff.
    set('deadking', 22, 28, (g, f) => {
      const sway = f === 1 ? 1 : f === 2 ? -1 : 0;
      for (let y = 10; y < 27; y++) {   // robe widening to a tattered hem
        const half = 3 + Math.floor((y - 10) * 0.42), cx = 10 + (y > 20 ? sway : 0);
        R(g, cx - half, y, half * 2 + 1, 1, y % 5 === 0 ? '#3a1a4a' : '#2a1438');
        px(g, cx - half, y, '#4a2a5a'); px(g, cx + half, y, '#160a20');
        if (y > 11) px(g, cx, y, '#ffd040');   // gold trim
      }
      for (let x = 3; x < 19; x += 2) px(g, x + sway, 27, '#160a20');
      R(g, 4 + sway, 25, 13, 1, '#c8a030');
      R(g, 4, 9, 13, 3, '#3a2a4a'); R(g, 4, 9, 13, 1, '#5a4a6a'); px(g, 4, 8, '#d8d0c0'); px(g, 16, 8, '#d8d0c0');   // pauldrons
      R(g, 8, 3, 5, 6, '#d8d0c0'); R(g, 8, 3, 5, 1, '#f0e8d8'); R(g, 9, 8, 3, 1, '#a8a090');                          // skull
      px(g, 9, 5, '#3aff8a'); px(g, 11, 5, '#3aff8a'); px(g, 9, 4, '#1a3a24'); px(g, 11, 4, '#1a3a24');
      R(g, 9, 7, 3, 1, '#4a4038'); px(g, 10, 7, '#d8d0c0');
      R(g, 7, 2, 7, 1, '#ffd040'); [[7, 1], [10, 0], [10, 1], [13, 1]].forEach(([x, y]) => px(g, x, y, '#ffd040')); px(g, 10, 2, '#ff2a6a');   // crown
      pxLine(g, 18, 6, 18, 27, '#5a3a2a'); px(g, 18, 6, '#8a6a4a');                                                 // staff
      R(g, 17, 2, 3, 3, '#3aff8a'); px(g, 18, 3, '#ffffff'); px(g, 17 + (f % 2) * 2, 1, '#9affc8');
      R(g, 16, 13, 2, 2, '#d8d0c0');
    });

    // Tesla Pylon (Voltrax's shield generators).
    set('pylon', 9, 16, (g, f) => {
      R(g, 1, 13, 7, 3, '#3a4250'); R(g, 1, 13, 7, 1, '#6a7486');
      R(g, 3, 4, 3, 9, '#5a6476');
      for (let y = 5; y < 13; y += 2) R(g, 2, y, 5, 1, '#c8a040');
      R(g, 2, 0, 5, 4, '#fff060'); R(g, 3, 1, 2, 2, '#ffffff');
      if (f) px(g, f === 1 ? 1 : 7, 1, '#ffffff');
    });
  },

  // ---------- Weapons (pointing right, pivot at left-middle) ----------
  // Each archetype is a list of parts [x, y, w, h, material]. Parts get
  // 3-tone shading (lit top edge, shadowed bottom edge), then an outline,
  // which gives the pixel models a chunky 3D look. 'g' parts glow.
  // Materials: b body, d dark body, a accent, m metal, g glow,
  //            h grip, e blade edge, E blade, k blade back.
  weaponShapes: {
    pistol:   [[2, 0, 9, 3, 'b'], [11, 1, 2, 1, 'm'], [4, 1, 4, 1, 'g'], [3, 3, 3, 4, 'd'], [6, 3, 2, 1, 'd'], [8, 2, 3, 1, 'a']],
    smg:      [[0, 1, 1, 2, 'd'], [1, 1, 12, 3, 'b'], [13, 2, 3, 1, 'm'], [3, 0, 6, 1, 'a'], [5, 4, 3, 3, 'd'], [1, 4, 3, 2, 'd'], [9, 2, 3, 1, 'g']],
    shotgun:  [[0, 2, 4, 3, 'd'], [4, 1, 9, 3, 'b'], [13, 1, 4, 2, 'm'], [6, 4, 6, 2, 'a'], [8, 0, 4, 1, 'g'], [4, 4, 2, 3, 'd']],
    blaster:  [[1, 2, 8, 3, 'b'], [3, 1, 4, 1, 'm'], [9, 1, 2, 5, 'a'], [11, 2, 2, 3, 'g'], [2, 5, 3, 3, 'd']],
    horn:     [[1, 3, 7, 3, 'b'], [3, 2, 3, 1, 'g'], [8, 2, 3, 5, 'a'], [11, 1, 3, 7, 'a'], [14, 0, 2, 9, 'm'], [12, 3, 1, 3, 'g'], [2, 6, 3, 3, 'd']],
    sniper:   [[0, 2, 5, 2, 'd'], [5, 1, 9, 3, 'b'], [14, 2, 8, 1, 'm'], [7, 0, 5, 1, 'a'], [11, 0, 1, 1, 'g'], [6, 4, 2, 2, 'd'], [10, 2, 3, 1, 'g']],
    prism:    [[1, 2, 10, 3, 'b'], [3, 1, 6, 1, 'a'], [6, 3, 3, 1, 'a'], [11, 3, 2, 1, 'm'], [13, 1, 3, 5, 'g'], [2, 5, 3, 3, 'd']],
    gravgun:  [[1, 3, 9, 4, 'b'], [3, 2, 5, 1, 'm'], [10, 1, 2, 8, 'a'], [12, 1, 2, 1, 'a'], [12, 7, 2, 1, 'a'], [12, 3, 3, 3, 'g'], [2, 7, 3, 3, 'd']],
    launcher: [[0, 1, 15, 4, 'b'], [15, 0, 3, 6, 'a'], [4, 2, 8, 1, 'g'], [16, 2, 1, 2, 'g'], [2, 5, 3, 3, 'd'], [6, 5, 4, 2, 'd']],
    cannon:   [[1, 1, 10, 5, 'b'], [5, 0, 4, 1, 'a'], [11, 2, 4, 3, 'm'], [15, 1, 2, 5, 'a'], [3, 3, 6, 1, 'g'], [2, 6, 3, 2, 'd']],
    cyclone:  [[1, 3, 8, 4, 'b'], [9, 1, 6, 8, 'a'], [10, 2, 4, 6, 'd'], [11, 3, 2, 4, 'g'], [15, 3, 2, 4, 'm'], [2, 7, 3, 3, 'd']],
    beam:     [[0, 2, 4, 4, 'd'], [4, 1, 10, 6, 'b'], [14, 2, 6, 1, 'm'], [14, 6, 6, 1, 'm'], [14, 3, 6, 3, 'a'], [17, 4, 3, 1, 'g'], [6, 3, 6, 2, 'g'], [6, 7, 3, 2, 'd']],
    nova:     [[1, 3, 10, 5, 'b'], [3, 2, 6, 1, 'a'], [5, 4, 4, 2, 'g'], [11, 1, 4, 9, 'a'], [12, 4, 2, 3, 'g'], [15, 3, 3, 5, 'm'], [18, 4, 2, 3, 'g'], [4, 8, 3, 3, 'd']],
    dagger:   [[0, 2, 4, 2, 'h'], [4, 0, 1, 6, 'a'], [5, 2, 9, 1, 'e'], [5, 3, 8, 1, 'E'], [5, 4, 6, 1, 'k'], [14, 2, 1, 1, 'e']],
    sword:    [[0, 2, 5, 2, 'h'], [5, 0, 1, 6, 'a'], [6, 1, 12, 1, 'e'], [6, 2, 13, 2, 'E'], [6, 4, 11, 1, 'k'], [8, 3, 8, 1, 'g'], [18, 2, 2, 1, 'e']],
    shock:    [[0, 3, 4, 2, 'h'], [4, 1, 1, 6, 'a'], [5, 2, 10, 3, 'E'], [5, 2, 10, 1, 'e'], [7, 5, 1, 1, 'E'], [10, 5, 1, 1, 'E'], [13, 5, 1, 1, 'E'], [6, 3, 8, 1, 'g'], [15, 3, 2, 1, 'e']],
    claw:     [[0, 4, 4, 3, 'h'], [4, 2, 3, 7, 'b'], [7, 1, 7, 1, 'e'], [7, 2, 6, 1, 'E'], [7, 4, 8, 1, 'e'], [7, 5, 7, 1, 'E'], [7, 7, 7, 1, 'e'], [7, 8, 6, 1, 'E'], [5, 4, 1, 2, 'g']],
    greatsword: [[0, 3, 5, 2, 'h'], [5, 0, 2, 8, 'a'], [7, 1, 15, 1, 'e'], [7, 2, 16, 4, 'E'], [7, 6, 14, 1, 'k'], [9, 3, 11, 2, 'g'], [23, 3, 1, 2, 'e']],
    flare:    [[2, 1, 8, 3, 'b'], [4, 0, 3, 1, 'm'], [10, 0, 3, 5, 'a'], [11, 1, 1, 3, 'g'], [3, 4, 3, 3, 'd']],
    gatling:  [[0, 2, 4, 3, 'd'], [4, 1, 6, 5, 'b'], [10, 1, 8, 1, 'm'], [10, 3, 8, 1, 'm'], [10, 5, 8, 1, 'm'], [10, 0, 2, 7, 'a'], [6, 2, 3, 1, 'g'], [5, 6, 3, 3, 'd'], [17, 2, 1, 3, 'g']],
    mortar:   [[0, 4, 4, 3, 'd'], [3, 2, 12, 5, 'b'], [15, 1, 3, 7, 'a'], [5, 3, 8, 1, 'g'], [6, 7, 3, 3, 'd'], [16, 3, 1, 3, 'g']],
    rail:     [[0, 3, 4, 3, 'd'], [4, 2, 8, 5, 'b'], [12, 3, 12, 1, 'm'], [12, 5, 12, 1, 'm'], [12, 4, 12, 1, 'g'], [6, 1, 4, 1, 'a'], [6, 7, 3, 2, 'd'], [23, 3, 1, 3, 'g']],
    pod:      [[1, 2, 5, 5, 'd'], [5, 0, 10, 9, 'b'], [15, 1, 2, 7, 'a'], [7, 1, 2, 2, 'g'], [10, 1, 2, 2, 'g'], [7, 6, 2, 2, 'g'], [10, 6, 2, 2, 'g'], [13, 3, 2, 3, 'm'], [3, 8, 3, 3, 'd']],
    hammer:   [[0, 3, 12, 2, 'h'], [12, 0, 6, 8, 'b'], [13, 3, 4, 1, 'g'], [11, 1, 1, 6, 'a']],
    whip:     [[0, 2, 4, 2, 'h'], [4, 1, 1, 4, 'a'], [5, 2, 3, 1, 'e'], [8, 3, 3, 1, 'E'], [11, 2, 3, 1, 'e'], [14, 3, 3, 1, 'E'], [17, 2, 2, 1, 'g']],
    axe:      [[0, 3, 11, 2, 'h'], [9, 0, 3, 9, 'b'], [12, 0, 5, 1, 'e'], [12, 1, 6, 2, 'E'], [12, 3, 6, 3, 'E'], [12, 6, 5, 2, 'E'], [12, 8, 4, 1, 'e'], [13, 4, 3, 1, 'g']],
    spear:    [[0, 3, 14, 1, 'h'], [0, 4, 14, 1, 'k'], [14, 1, 2, 6, 'a'], [16, 2, 6, 1, 'e'], [16, 3, 8, 2, 'E'], [16, 5, 6, 1, 'e'], [18, 3, 4, 1, 'g']],
  },
  weaponGlow: {},      // weapon id -> additive glow layer (same size as sprite)
  weaponFx: {},        // weapon id -> { lines, muzzle, drum } for animated details

  // ---------- Gun designs ----------
  // Every gun is laid out by hand from detailed parts (pointing right, grip
  // at the left, sizes in pixels). Each part type has its own renderer below.
  gunDesigns: {
    // --- common ---
    nova:     [['grip', 3, 4, 3, 4], ['body', 2, 1, 11, 2], ['plate', 2, 3, 8, 1], ['glowline', 4, 2, 6], ['metal', 13, 1, 2, 2], ['emitter', 15, 0, 1, 4], ['metal', 10, 0, 2, 1], ['trigger', 6, 4]],
    ion:      [['stock', 0, 2, 3, 3], ['grip', 4, 5, 2, 3], ['mag', 7, 5, 3, 3], ['body', 3, 1, 10, 4], ['rail', 4, 0, 6], ['coil', 8, 2, 4, 2], ['shroud', 13, 2, 4, 2], ['metal', 17, 2, 2, 1]],
    scrap:    [['stock', 0, 2, 4, 4], ['grip', 5, 5, 2, 3], ['body', 4, 1, 8, 4], ['metal', 12, 1, 8, 1], ['dark', 12, 2, 8, 1], ['metal', 12, 3, 8, 1], ['band', 14, 1, 1, 3], ['band', 18, 1, 1, 3],
               ['plate', 9, 5, 6, 2], ['glowline', 6, 2, 3], ['metal', 20, 0, 1, 5]],
    echo:     [['grip', 3, 7, 3, 3], ['body', 2, 3, 9, 4], ['fin', 4, 1, 4, 2], ['coil', 5, 4, 4, 2], ['metal', 11, 4, 2, 2], ['dish', 13, 1, 3, 8]],
    flare:    [['grip', 3, 5, 3, 4], ['metal', 1, 1, 2, 2], ['body', 2, 2, 7, 3], ['tube', 9, 1, 5, 5], ['band', 9, 1, 1, 5], ['trigger', 6, 5]],
    // --- uncommon ---
    venom:    [['grip', 3, 6, 3, 4], ['body', 2, 3, 9, 3], ['tank', 4, 0, 5, 3], ['cable', 9, 1, 12, 4], ['glowline', 3, 4, 5], ['metal', 11, 4, 4, 1], ['emitter', 15, 3, 1, 3], ['trigger', 6, 6]],
    sonic:    [['grip', 2, 8, 3, 3], ['body', 1, 4, 8, 4], ['fin', 2, 2, 4, 2], ['coil', 6, 4, 3, 4], ['metal', 9, 5, 2, 2], ['bell', 11, 1, 7, 10]],
    needle:   [['stock', 0, 2, 5, 3], ['grip', 6, 5, 2, 3], ['mag', 10, 5, 2, 2], ['body', 5, 2, 9, 3], ['scope', 7, 0, 6, 2], ['glowline', 6, 3, 7], ['shroud', 14, 2, 4, 3],
               ['metal', 18, 3, 6, 1], ['metal', 24, 2, 2, 3]],
    ricochet: [['stock', 0, 2, 4, 3], ['grip', 5, 6, 2, 3], ['mag', 9, 6, 2, 3], ['body', 4, 2, 9, 4], ['scope', 7, 0, 4, 2], ['glowline', 5, 4, 6], ['shroud', 13, 2, 6, 3],
               ['metal', 19, 3, 3, 1], ['emitter', 22, 2, 2, 3]],
    // --- rare ---
    prism:    [['grip', 2, 7, 3, 3], ['body', 1, 3, 9, 4], ['fin', 3, 1, 5, 2], ['glowline', 2, 4, 7], ['metal', 10, 4, 2, 2], ['crystal', 12, 1, 5, 8]],
    antigrav: [['grip', 2, 8, 3, 3], ['body', 1, 3, 9, 5], ['coil', 4, 4, 4, 3], ['metal', 10, 5, 2, 1], ['ring', 11, 0, 7, 11]],
    hive:     [['grip', 3, 6, 3, 4], ['body', 0, 1, 15, 5], ['hex', 2, 2, 10, 3], ['metal', 6, 0, 4, 1], ['band', 13, 1, 1, 5], ['dish', 15, 0, 3, 7]],
    glacier:  [['grip', 3, 7, 3, 3], ['body', 1, 2, 11, 5], ['fin', 5, 0, 5, 2], ['core', 4, 3, 6, 3], ['metal', 12, 3, 5, 3], ['coil', 13, 3, 3, 3], ['emitter', 17, 2, 2, 5]],
    arcthrower: [['grip', 2, 7, 3, 3], ['tank', 3, 0, 4, 3], ['body', 1, 3, 8, 4], ['coil', 9, 2, 5, 5], ['metal', 14, 1, 4, 2], ['metal', 14, 6, 4, 2], ['spark', 15, 3, 2, 3]],
    // --- epic ---
    redshift: [['stock', 0, 2, 2, 2], ['grip', 3, 5, 2, 3], ['mag', 6, 5, 3, 4], ['body', 2, 1, 12, 4], ['rail', 3, 0, 7], ['glowline', 3, 3, 5], ['coil', 9, 2, 5, 2], ['shroud', 14, 2, 5, 2], ['metal', 19, 2, 3, 1]],
    vortex:   [['grip', 2, 8, 3, 3], ['body', 1, 4, 8, 4], ['fin', 2, 2, 4, 2], ['glowline', 2, 6, 6], ['turbine', 9, 1, 8, 9], ['emitter', 17, 3, 2, 5]],
    rift:     [['grip', 3, 6, 3, 4], ['body', 2, 3, 9, 3], ['fin', 4, 1, 4, 2], ['glowline', 3, 4, 7], ['portal', 11, 1, 6, 8], ['trigger', 6, 6]],
    magma:    [['grip', 4, 7, 3, 3], ['body', 0, 2, 16, 5], ['metal', 8, 0, 4, 2], ['vent', 1, 3, 3], ['core', 5, 3, 7, 3], ['band', 14, 2, 1, 5], ['dish', 16, 1, 4, 7]],
    gatling:  [['grip', 3, 8, 3, 3], ['body', 0, 3, 7, 5], ['metal', 3, 1, 4, 2], ['core', 1, 4, 3, 2], ['drum', 7, 2, 3, 7], ['metal', 10, 2, 12, 1], ['dark', 10, 3, 12, 1],
               ['metal', 10, 4, 12, 1], ['dark', 10, 5, 12, 1], ['metal', 10, 6, 12, 1], ['band', 14, 1, 1, 7], ['band', 19, 1, 1, 7], ['metal', 22, 2, 1, 5]],
    mortar:   [['plate', 0, 5, 4, 5], ['grip', 6, 8, 3, 3], ['body', 3, 2, 14, 6], ['scope', 9, 0, 3, 2], ['glowline', 5, 5, 10], ['band', 7, 2, 1, 6], ['band', 13, 2, 1, 6], ['dish', 17, 1, 3, 8]],
    // --- legendary ---
    aurora:   [['stock', 0, 3, 4, 5], ['grip', 6, 9, 3, 2], ['body', 4, 2, 11, 7], ['scope', 8, 0, 5, 2], ['aurora', 6, 4, 6, 3], ['fin', 15, 1, 7, 2], ['fin', 15, 8, 7, 2, 'down'],
               ['metal', 15, 4, 8, 3], ['coil', 16, 4, 5, 3], ['emitter', 23, 3, 2, 5]],
    chrono:   [['grip', 3, 8, 3, 3], ['body', 1, 2, 11, 6], ['dial', 4, 2, 6, 6], ['metal', 12, 4, 6, 2], ['band', 14, 3, 1, 4], ['dish', 18, 2, 3, 6]],
    supernova:[['grip', 4, 9, 3, 3], ['body', 1, 3, 11, 6], ['sun', 3, 3, 7, 6], ['dish', 12, 1, 4, 10], ['metal', 16, 4, 4, 4], ['coil', 17, 4, 3, 4], ['emitter', 20, 3, 2, 6]],
    photon:   [['stock', 0, 3, 4, 3], ['grip', 5, 7, 2, 2], ['body', 4, 2, 8, 5], ['scope', 6, 0, 5, 2], ['coil', 6, 3, 4, 3], ['metal', 12, 2, 14, 1], ['glowline', 12, 4, 14],
               ['metal', 12, 6, 14, 1], ['band', 16, 2, 1, 5], ['band', 21, 2, 1, 5], ['emitter', 26, 2, 2, 5]],
    // --- mythic ---
    horizon:  [['grip', 3, 9, 3, 3], ['body', 1, 3, 9, 6], ['coil', 4, 4, 4, 3], ['cable', 2, 3, 10, 1], ['blackhole', 10, 0, 10, 12], ['emitter', 20, 4, 2, 4]],
    genesis:  [['stock', 0, 3, 4, 5], ['grip', 6, 8, 3, 3], ['body', 4, 1, 12, 8], ['halo', 7, 3, 5, 5], ['fin', 16, 0, 6, 2], ['fin', 16, 9, 6, 2, 'down'],
               ['metal', 16, 4, 8, 3], ['glowline', 17, 5, 6], ['emitter', 24, 3, 2, 5]],
    seraph:   [['grip', 1, 7, 3, 4], ['body', 4, 0, 12, 12], ['tubes', 6, 2, 8, 8], ['fin', 16, 1, 3, 10], ['scope', 7, 0, 4, 1]],
    // --- third arsenal ---
    revolver: [['dark', 1, 0, 2, 1], ['grip', 3, 5, 3, 4], ['body', 2, 1, 5, 3], ['cylinder', 6, 0, 5, 5], ['metal', 11, 1, 7, 1], ['glowline', 11, 2, 7],
               ['metal', 11, 3, 6, 1], ['rail', 12, 0, 5], ['emitter', 18, 0, 1, 4], ['trigger', 6, 5]],
    shardsmg: [['stock', 0, 2, 3, 3], ['grip', 4, 5, 2, 3], ['mag', 8, 5, 2, 4], ['body', 3, 1, 9, 4], ['rail', 4, 0, 6], ['coil', 6, 2, 4, 2], ['shroud', 12, 2, 4, 2],
               ['crystal', 16, 0, 4, 6]],
    scatter:  [['stock', 0, 2, 4, 4], ['grip', 5, 6, 2, 3], ['body', 4, 1, 9, 5], ['glowline', 5, 3, 6], ['tank', 9, 6, 6, 3], ['metal', 13, 1, 7, 2], ['metal', 13, 3, 7, 2],
               ['band', 15, 1, 1, 4], ['bell', 20, 0, 3, 6]],
    crossbow: [['stock', 0, 4, 4, 3], ['grip', 6, 7, 2, 3], ['limbs', 15, 0, 4, 11], ['body', 4, 4, 14, 3], ['rail', 5, 3, 12], ['glowline', 7, 5, 9], ['tip', 18, 4, 3, 3],
               ['scope', 8, 1, 4, 2]],
    spike:    [['stock', 0, 2, 4, 3], ['grip', 5, 6, 2, 3], ['mag', 9, 6, 3, 3], ['body', 4, 2, 10, 4], ['scope', 6, 0, 5, 2], ['metal', 14, 2, 8, 1], ['glowline', 14, 3, 8],
               ['metal', 14, 4, 8, 1], ['band', 17, 2, 1, 3], ['tip', 22, 2, 4, 3]],
    inferno:  [['grip', 4, 6, 3, 4], ['body', 2, 3, 12, 4], ['tank', 3, 0, 6, 3], ['cable', 8, 1, 14, 3], ['vent', 3, 4, 8], ['metal', 14, 3, 6, 3], ['band', 16, 3, 1, 3],
               ['bell', 20, 2, 3, 5]],
    starfall: [['stock', 0, 3, 4, 4], ['grip', 6, 8, 3, 3], ['body', 3, 2, 14, 6], ['scope', 7, 0, 5, 2], ['star', 7, 3, 5, 5], ['glowline', 12, 5, 4], ['band', 13, 2, 1, 6],
               ['dish', 17, 0, 3, 10]],
    necrovanta: [['stock', 0, 4, 4, 4], ['grip', 6, 9, 3, 3], ['body', 3, 2, 14, 8], ['skull', 6, 3, 6, 6], ['fin', 17, 0, 6, 2], ['fin', 17, 10, 6, 2, 'down'],
               ['metal', 17, 4, 6, 4], ['coil', 18, 4, 4, 4], ['portal', 23, 2, 6, 8]],
  },

  // ---------- Knife designs ----------
  // Melee weapons are laid out from detailed parts like the guns (pointing
  // right, the hand on the first handle/pole part). Parts are
  // [type, x, y, w, h, spec, layer]; on balisongs the parts on layer 'B' form
  // the blade that flips around the 'pivot' pin.
  knifeDesigns: {
    fang:     [['pommel', 0, 2, 2, 3], ['handle', 2, 2, 5, 3, 'wrap'], ['guard', 7, 0, 2, 7], ['blade', 9, 1, 12, 4, 'clip fuller serr']],
    plasma:   [['pommel', 0, 2, 2, 3, 'gem'], ['handle', 2, 2, 5, 3, 'grip'], ['guard', 7, 0, 2, 7, 'gem'], ['blade', 9, 1, 16, 5, 'point glow core']],
    shockfang:[['pommel', 0, 2, 2, 3], ['handle', 2, 2, 5, 3, 'grip'], ['guard', 7, 1, 2, 5], ['blade', 9, 1, 13, 5, 'tanto serr glow'], ['zig', 10, 2, 8, 2]],
    cryo:     [['pommel', 0, 2, 2, 3, 'gem'], ['handle', 2, 2, 5, 3, 'wrap'], ['guard', 7, 0, 2, 7], ['blade', 9, 1, 11, 5, 'point glow'], ['frost', 9, 1, 10, 5]],
    shadow:   [['pommel', 0, 2, 2, 3], ['handle', 2, 2, 6, 3, 'wrap'], ['guard', 8, 0, 1, 7], ['blade', 9, 2, 16, 3, 'point glow core']],
    viper:    [['pommel', 0, 2, 2, 3, 'gem'], ['handle', 2, 2, 5, 3, 'grip'], ['guard', 7, 0, 2, 7, 'gem'], ['blade', 9, 1, 16, 5, 'point wave glow core']],
    quantum:  [['handle', 0, 4, 4, 3, 'grip'], ['plate', 4, 1, 3, 9], ['claw', 7, 1, 9, 9, 3], ['gem', 4, 4]],
    solar:    [['pommel', 0, 2, 2, 3, 'gem'], ['handle', 2, 2, 5, 3, 'wrap'], ['guard', 7, 0, 3, 7, 'gem'], ['blade', 10, 1, 16, 5, 'drop glow core']],
    void:     [['handle', 0, 5, 4, 3, 'grip'], ['plate', 4, 1, 3, 11], ['claw', 7, 0, 11, 13, 3], ['gem', 4, 5]],
    oblivion: [['pommel', 0, 3, 2, 3, 'gem'], ['handle', 2, 3, 5, 3, 'wrap'], ['guard', 7, 0, 3, 9, 'gem'], ['blade', 10, 1, 22, 7, 'point glow core'], ['runes', 12, 3, 14, 1]],
    hammer:   [['pole', 0, 4, 14, 2, 'bands'], ['head', 13, 0, 8, 10]],
    whip:     [['pommel', 0, 2, 1, 3], ['handle', 1, 2, 5, 3, 'grip'], ['guard', 6, 1, 1, 5], ['chain', 7, 0, 18, 7]],
    reaver:   [['pole', 0, 5, 15, 2, 'bands'], ['axe', 10, 0, 9, 13], ['band', 10, 4, 2, 4], ['gem', 13, 5]],
    glaive:   [['pole', 0, 3, 17, 2, 'bands'], ['guard', 16, 1, 2, 6, 'gem'], ['blade', 18, 2, 10, 4, 'point glow core'], ['zig', 19, 1, 6, 1]],
    // --- balisongs, karambits and more ---
    streetbali:  [['bali', 0, 2, 9, 3], ['pivot', 9, 3, 1, 1], ['blade', 10, 2, 10, 3, 'clip', 'B']],
    neonbali:    [['bali', 0, 2, 9, 3, 'glow'], ['pivot', 9, 3, 1, 1], ['blade', 10, 2, 11, 3, 'clip glow', 'B']],
    phantombali: [['bali', 0, 2, 10, 3, 'glow'], ['pivot', 10, 3, 1, 1], ['blade', 11, 2, 12, 3, 'drop glow core', 'B']],
    voidbali:    [['bali', 0, 2, 10, 3, 'glow'], ['pivot', 10, 3, 1, 1], ['blade', 11, 1, 13, 5, 'tanto glow core', 'B'], ['runes', 13, 2, 7, 1, '', 'B']],
    hookkara:    [['ring', 0, 1, 5, 5], ['handle', 4, 2, 6, 3, 'grip'], ['crescent', 8, 0, 10, 11, { cx: 1, cy: 10, R: 8, a0: -1.75, a1: 0.1, th: 4 }]],
    venomkara:   [['ring', 0, 1, 5, 5, 'glow'], ['handle', 4, 2, 6, 3, 'grip'], ['crescent', 8, 0, 11, 12, { cx: 1, cy: 11, R: 9, a0: -1.75, a1: 0.1, th: 4, glow: true }]],
    eclipsekara: [['ring', 0, 1, 5, 5, 'glow'], ['handle', 4, 2, 6, 3, 'wrap'], ['crescent', 8, 0, 12, 13, { cx: 1, cy: 12, R: 10, a0: -1.75, a1: 0.12, th: 5, glow: true, core: true }]],
    kunai:       [['ring', 0, 1, 5, 5, 'glow'], ['handle', 4, 2, 5, 3, 'wrap'], ['blade', 9, 0, 9, 7, 'leaf glow core']],
    ripper:      [['pommel', 0, 3, 2, 3], ['handle', 2, 3, 5, 3, 'grip'], ['motor', 7, 0, 5, 9], ['saw', 12, 1, 15, 7]],
    katana:      [['pommel', 0, 3, 1, 3], ['handle', 1, 3, 8, 3, 'diamond'], ['tsuba', 9, 1, 2, 7], ['curve', 11, 0, 22, 3, 'up 3 glow core']],
    sickle:      [['handle', 0, 9, 8, 3, 'wrap'], ['band', 8, 9, 1, 3], ['crescent', 8, 0, 15, 12, { cx: 7, cy: 7, R: 7, a0: 2.7, a1: 6.6, th: 4, glow: true }]],
    scythe:      [['pole', 0, 2, 24, 2, 'bands'], ['crescent', 9, 0, 16, 15, { cx: 5, cy: 3, R: 10, a0: 0, a1: 2.0, th: 5, glow: true, core: true }], ['band', 22, 1, 2, 4], ['gem', 22, 2]],
  },

  buildWeapons() {
    for (const w of WEAPONS) {
      const r = this.buildWeapon(w);
      this.weapons[w.id] = r.img;
      this.weaponGlow[w.id] = r.glow;
      this.weaponFx[w.id] = r.fx;
    }
  },

  // Builds one weapon sprite { img, glow, fx }, optionally in a skin's colors.
  buildWeapon(w, skin = null) {
    if (w.kind === 'gun' && this.gunDesigns[w.id]) return this.buildGun(w, skin);
    if (this.knifeDesigns[w.id]) return this.buildKnife(w, skin);
    return this.buildKnifeSimple(w);
  },

  // Skin palette overrides (see SKINS in config.js), or the weapon's own colors.
  skinPalette(w, skin) {
    const S = skin ? SKINS[skin].pal : {};
    return {
      body: S.body || w.body, accent: S.accent || w.accent, color: S.color || w.color, glow: S.glow || w.glow,
      metal: S.metal || ['#8a94a6', '#d0d8e4', '#4a5262', '#262b34'], dark: S.dark || ['#2a2a34', '#44445a', '#16161c'],
      blade: S.blade || S.color || w.color, edge: S.edge || S.glow || w.glow,
    };
  },

  buildGun(w, skin = null) {
    const PAD = 2, parts = this.gunDesigns[w.id];
    let maxX = 0, maxY = 0;
    for (const pt of parts) {
      const [type, x, y, a, b] = pt;
      const pw = type === 'rail' || type === 'glowline' || type === 'vent' ? a : type === 'trigger' ? 2 : type === 'cable' ? Math.max(x, a) - x + 1 : a;
      const ph = type === 'rail' || type === 'glowline' || type === 'vent' ? 1 : type === 'trigger' ? 2 : type === 'cable' ? Math.abs(b - y) + 2 : b;
      maxX = Math.max(maxX, (type === 'cable' ? Math.max(x, a) + 1 : x + pw));
      maxY = Math.max(maxY, (type === 'cable' ? Math.max(y, b) + 2 : y + ph));
    }
    const W = maxX + PAD * 2, H = maxY + PAD * 2;
    const c = makeCanvas(W, H), g = c.getContext('2d');
    const glow = makeCanvas(W, H), gg = glow.getContext('2d');
    const fx = { lines: [], muzzle: [W - PAD, Math.floor(H / 2)], drum: null };
    const C = this.skinPalette(w, skin);
    const P = {
      body: C.body, bodyL: shade(C.body, 0.32), bodyD: shade(C.body, -0.35), bodyDD: shade(C.body, -0.62),
      acc: C.accent, accL: shade(C.accent, 0.38), accD: shade(C.accent, -0.4),
      glow: C.color, glowHi: C.glow, glowD: shade(C.color, -0.35),
      metal: C.metal[0], metalL: C.metal[1], metalD: C.metal[2], metalDD: C.metal[3],
      dark: C.dark[0], darkL: C.dark[1], darkD: C.dark[2],
    };
    const rect = (x, y, rw, rh, col) => { g.fillStyle = col; g.fillRect(x + PAD, y + PAD, rw, rh); };
    const dot = (x, y, col) => { g.fillStyle = col; g.fillRect(x + PAD, y + PAD, 1, 1); };
    const glowRect = (x, y, rw, rh, col = P.glow, a = 0.5) => { gg.globalAlpha = a; gg.fillStyle = col; gg.fillRect(x + PAD - 1, y + PAD - 1, rw + 2, rh + 2); gg.globalAlpha = 1; };
    // Soft oval glow for big round parts (a box would read as a tinted square).
    const glowOval = (x, y, rw, rh, col = P.glow, a = 0.45) => {
      gg.fillStyle = col;
      for (const [k, al] of [[1, a * 0.5], [0.6, a]]) {
        gg.globalAlpha = al;
        gg.beginPath();
        gg.ellipse(x + PAD + rw / 2, y + PAD + rh / 2, rw / 2 * k + 0.5, rh / 2 * k + 0.5, 0, 0, Math.PI * 2);
        gg.fill();
      }
      gg.globalAlpha = 1;
    };
    // Shaded block: lit top row, shadowed bottom row.
    const block = (x, y, rw, rh, mid, light, darkc) => {
      rect(x, y, rw, rh, mid);
      rect(x, y, rw, 1, light);
      if (rh >= 3) rect(x, y + rh - 1, rw, 1, darkc);
      else if (rh === 2) rect(x, y + 1, rw, 1, shade(mid, -0.15));
    };
    // Visit every pixel of an ellipse inscribed in the box; f(px, py, nd, angle).
    const ellipse = (x, y, rw, rh, f) => {
      const cx = x + rw / 2, cy = y + rh / 2;
      for (let py = y; py < y + rh; py++) for (let pxx = x; pxx < x + rw; pxx++) {
        const dx = (pxx + 0.5 - cx) / (rw / 2), dy = (py + 0.5 - cy) / (rh / 2), nd = dx * dx + dy * dy;
        if (nd <= 1) f(pxx, py, nd, Math.atan2(dy, dx));
      }
    };
    const R = {
      body(x, y, rw, rh) {
        block(x, y, rw, rh, P.body, P.bodyL, P.bodyD);
        for (let sx = x + 4; sx < x + rw - 2; sx += 5) for (let yy = y + 1; yy < y + rh - 1; yy++) dot(sx, yy, P.bodyD);   // panel seams
        if (rh >= 3) { dot(x + 1, y + rh - 2, P.bodyL); dot(x + rw - 2, y + rh - 2, P.bodyL); }   // rivets
        dot(x + 1, y, '#ffffff');
      },
      plate(x, y, rw, rh) { block(x, y, rw, rh, P.acc, P.accL, P.accD); if (rw >= 4 && rh >= 2) dot(x + rw - 2, y + rh - 1, P.accL); },
      metal(x, y, rw, rh) {
        block(x, y, rw, rh, P.metal, P.metalL, P.metalD);
        if (rw >= 6) for (let sx = x + 3; sx < x + rw - 1; sx += 4) rect(sx, y, 1, rh, P.metalD);   // barrel rings
        rect(x + rw - 1, y, 1, rh, P.metalD);
      },
      dark(x, y, rw, rh) { rect(x, y, rw, rh, P.darkD); },
      grip(x, y, rw, rh) {
        for (let r = 0; r < rh; r++) {
          const off = -Math.floor(r / 2);   // angled back like a real pistol grip
          rect(x + off, y + r, rw, 1, P.dark);
          dot(x + off, y + r, P.darkL);
          if (r % 2) dot(x + off + Math.floor(rw / 2), y + r, P.darkD);
        }
      },
      stock(x, y, rw, rh) {
        if (rw >= 3 && rh >= 3) {
          rect(x, y, rw, rh, P.bodyD);
          g.clearRect(x + PAD + 1, y + PAD + 1, rw - 2, rh - 2);   // skeletal frame
          rect(x, y, 1, rh, P.darkD);
          rect(x, y, rw, 1, P.bodyL);
        } else block(x, y, rw, rh, P.bodyD, P.body, P.bodyDD);
      },
      mag(x, y, rw, rh) {
        rect(x, y, rw, rh, P.dark);
        rect(x, y, 1, rh, P.darkL);
        if (rh >= 3) { rect(x + 1, y + 1, 1, rh - 2, P.glow); glowRect(x + 1, y + 1, 1, rh - 2); }
        rect(x, y + rh - 1, rw, 1, P.metalD);
      },
      rail(x, y, rw) { for (let i = 0; i < rw; i++) dot(x + i, y, i % 2 ? P.metalD : P.metalL); },
      trigger(x, y) { dot(x, y, P.darkD); dot(x, y + 1, P.darkD); dot(x + 1, y + 1, P.darkD); },
      glowline(x, y, rw) {
        rect(x, y, rw, 1, P.glow);
        for (let i = 1; i < rw; i += 3) dot(x + i, y, P.glowHi);
        glowRect(x, y, rw, 1);
        fx.lines.push([x + PAD, y + PAD, rw]);
      },
      coil(x, y, rw, rh) {
        for (let i = 0; i < rw; i++) {
          const on = i % 2 === 0;
          rect(x + i, y, 1, rh, on ? P.glow : P.bodyDD);
          if (on) { dot(x + i, y, P.glowHi); if (rh >= 3) dot(x + i, y + rh - 1, P.glowD); }
        }
        glowRect(x, y, rw, rh, P.glow, 0.4);
      },
      core(x, y, rw, rh) {
        rect(x, y, rw, rh, P.metalDD);
        if (rw > 2 && rh > 2) {
          rect(x + 1, y + 1, rw - 2, rh - 2, P.glow);
          rect(x + 1 + Math.floor((rw - 2) / 2), y + 1, 1, rh - 2, P.glowHi);
          dot(x + 1, y + 1, '#ffffff');
        } else rect(x, y, rw, rh, P.glow);
        glowRect(x, y, rw, rh, P.glow, 0.6);
      },
      shroud(x, y, rw, rh) {
        rect(x, y, rw, rh, P.metalD);
        rect(x, y, rw, 1, P.metal);
        const rows = rh >= 3 ? [y + 1] : [y + rh - 1];
        for (const yy of rows) for (let i = x + 1; i < x + rw - 1; i += 2) dot(i, yy, P.metalDD);   // cooling holes
        rect(x + rw - 1, y, 1, rh, P.metalDD);
      },
      emitter(x, y, rw, rh) {
        block(x, y, rw, rh, P.acc, P.accL, P.accD);
        for (let yy = y + 1; yy < y + rh - 1; yy += 2) dot(x, yy, P.accL);
        rect(x + rw - 1, y + 1, 1, Math.max(1, rh - 2), P.glow);
        glowRect(x + rw - 1, y + 1, 1, Math.max(1, rh - 2), P.glow, 0.7);
      },
      fin(x, y, rw, rh, dir) {
        for (let i = 0; i < rw; i++) {
          const colH = Math.max(1, Math.round(rh * (1 - i / rw)));
          const top = dir === 'down' ? y : y + rh - colH;
          rect(x + i, top, 1, colH, P.acc);
          dot(x + i, dir === 'down' ? top + colH - 1 : top, P.accL);
        }
      },
      band(x, y, rw, rh) { rect(x, y, rw, rh, P.acc); dot(x, y, P.accL); dot(x, y + rh - 1, P.accD); },
      tank(x, y, rw, rh) {
        rect(x, y, rw, rh, P.metalD);
        rect(x + 1, y + 1, rw - 2, rh - 1, '#14201a');
        const liq = Math.max(1, Math.ceil((rh - 1) * 0.6));
        rect(x + 1, y + rh - liq, rw - 2, liq, P.glow);
        dot(x + 1 + ((rw - 2) >> 1), y + rh - liq, P.glowHi);
        rect(x, y, rw, 1, P.metalL);
        glowRect(x + 1, y + rh - liq, rw - 2, liq, P.glow, 0.5);
      },
      cable(x0, y0, x1, y1) {
        const n = Math.max(2, Math.abs(x1 - x0) * 2);
        for (let i = 0; i <= n; i++) {
          const t = i / n;
          dot(Math.round(lerp(x0, x1, t)), Math.round(lerp(y0, y1, t) + Math.sin(t * Math.PI) * 1.2), P.accD);
        }
      },
      tube(x, y, rw, rh) {
        block(x, y, rw, rh, P.body, P.bodyL, P.bodyD);
        rect(x + rw - 2, y + 1, 2, rh - 2, P.bodyDD);
        rect(x + rw - 1, y + 2, 1, Math.max(1, rh - 4), P.glow);
        glowRect(x + rw - 1, y + 1, 1, rh - 2, P.glow, 0.6);
      },
      dish(x, y, rw, rh) {
        for (let i = 0; i < rw; i++) {
          const colH = Math.round(lerp(rh * 0.55, rh, i / Math.max(1, rw - 1)));
          const top = y + Math.floor((rh - colH) / 2);
          rect(x + i, top, 1, colH, i === rw - 1 ? P.metalL : P.acc);
          dot(x + i, top, P.accL);
          dot(x + i, top + colH - 1, P.accD);
        }
        rect(x + rw - 1, y + 2, 1, rh - 4, P.glow);
        glowRect(x + rw - 1, y + 1, 1, rh - 2, P.glow, 0.7);
      },
      bell(x, y, rw, rh) {
        for (let i = 0; i < rw; i++) {
          const colH = Math.round(lerp(rh * 0.4, rh, (i / Math.max(1, rw - 1)) ** 1.6));
          const top = y + Math.floor((rh - colH) / 2);
          rect(x + i, top, 1, colH, P.acc);
          dot(x + i, top, P.accL);
          dot(x + i, top + colH - 1, P.accD);
          if (colH > 4 && i >= rw - 3) rect(x + i, top + 2, 1, colH - 4, i === rw - 1 ? P.glow : P.bodyDD);
        }
        glowRect(x + rw - 1, y + 2, 1, rh - 4, P.glow, 0.7);
      },
      crystal(x, y, rw, rh) {
        const cx = x + rw / 2, cy = y + rh / 2;
        for (let py = y; py < y + rh; py++) for (let pxx = x; pxx < x + rw; pxx++) {
          const dx = (pxx + 0.5 - cx) / (rw / 2), dy = (py + 0.5 - cy) / (rh / 2);
          if (Math.abs(dx) + Math.abs(dy) > 1) continue;
          const col = Math.abs(dx) + Math.abs(dy) < 0.35 ? '#ffffff' : dx < 0 ? (dy < 0 ? '#e8f8ff' : '#8affff') : (dy < 0 ? '#ff8af0' : '#ffe27a');
          dot(pxx, py, col);
        }
        glowOval(x, y, rw, rh, P.glow, 0.45);
      },
      ring(x, y, rw, rh) {
        ellipse(x, y, rw, rh, (pxx, py, nd, a) => {
          if (nd >= 0.5) dot(pxx, py, Math.floor((a + Math.PI) / (Math.PI / 4)) % 2 ? P.acc : P.metalL);
          else if (nd < 0.18) dot(pxx, py, nd < 0.06 ? '#ffffff' : P.glow);
        });
        glowOval(x + rw / 4, y + rh / 4, rw / 2, rh / 2, P.glow, 0.8);
      },
      hex(x, y, rw, rh) {
        for (let yy = 0; yy < rh; yy++) for (let xx = (yy % 2) * 1; xx < rw; xx += 3) {
          rect(x + xx, y + yy, 2, 1, P.glow);
          dot(x + xx, y + yy, P.glowHi);
        }
        glowRect(x, y, rw, rh, P.glow, 0.35);
      },
      spark(x, y, rw, rh) {
        rect(x, y, rw, rh, P.glow);
        dot(x + (rw >> 1), y + (rh >> 1), '#ffffff');
        glowRect(x - 1, y - 1, rw + 2, rh + 2, P.glow, 0.8);
      },
      turbine(x, y, rw, rh) {
        ellipse(x, y, rw, rh, (pxx, py, nd, a) => {
          let col = Math.floor((a + Math.PI) / (Math.PI / 3)) % 2 ? P.metal : P.bodyDD;   // blades
          if (nd > 0.72) col = P.acc;
          if (nd < 0.14) col = P.glowHi;
          else if (nd < 0.3) col = P.glow;
          dot(pxx, py, col);
        });
        glowOval(x + rw / 4, y + rh / 4, rw / 2, rh / 2, P.glow, 0.7);
      },
      portal(x, y, rw, rh) {
        ellipse(x, y, rw, rh, (pxx, py, nd, a) => {
          if (nd >= 0.45) dot(pxx, py, Math.floor((a + nd * 4 + Math.PI) / (Math.PI / 3)) % 2 ? P.glow : P.acc);
          else dot(pxx, py, (pxx + py) % 4 === 0 ? P.glowHi : '#14081e');
        });
        glowOval(x, y, rw, rh, P.glow, 0.45);
      },
      aurora(x, y, rw, rh) {
        const cols = ['#ff5cf0', '#c88aff', '#9cfff0', '#7affd8', '#9cfff0', '#ff9cf0'];
        for (let i = 0; i < rw; i++) { rect(x + i, y, 1, rh, cols[i % cols.length]); dot(x + i, y, '#ffffff'); }
        glowRect(x, y, rw, rh, '#ff9cf0', 0.6);
      },
      dial(x, y, rw, rh) {
        ellipse(x, y, rw, rh, (pxx, py, nd) => dot(pxx, py, nd > 0.65 ? P.acc : '#f0dca0'));
        const cx = x + Math.floor(rw / 2), cy = y + Math.floor(rh / 2);
        dot(cx, cy, P.darkD); dot(cx, cy - 1, P.darkD); dot(cx + 1, cy, P.darkD); dot(cx, cy - 2, P.darkD);   // clock hands
        glowOval(x, y, rw, rh, '#ffe08a', 0.35);
      },
      sun(x, y, rw, rh) {
        ellipse(x, y, rw, rh, (pxx, py, nd) => dot(pxx, py, nd < 0.25 ? '#ffffff' : nd < 0.6 ? '#ffe08a' : '#ff9a2a'));
        glowOval(x, y, rw, rh, '#ffb040', 0.7);
      },
      blackhole(x, y, rw, rh) {
        ellipse(x, y, rw, rh, (pxx, py, nd, a) => {
          let col;
          if (nd > 0.68) col = Math.floor((a + Math.PI) / (Math.PI / 4)) % 2 ? P.glow : '#ff9cf0';   // accretion disk
          else if (nd > 0.5) col = '#ffffff';                                                      // photon ring
          else col = '#05000a';                                                                    // event horizon
          dot(pxx, py, col);
        });
        glowOval(x, y, rw, rh, P.glow, 0.55);
      },
      halo(x, y, rw, rh) {
        ellipse(x, y, rw, rh, (pxx, py, nd) => dot(pxx, py, nd > 0.55 ? '#ffd040' : nd < 0.2 ? '#ffffff' : '#fff6c8'));
        glowOval(x, y, rw, rh, '#fff27a', 0.7);
      },
      tubes(x, y, rw, rh) {
        rect(x, y, rw, rh, P.bodyD);
        for (let ty = 0; ty + 2 <= rh; ty += 3) for (let tx = 0; tx + 2 <= rw; tx += 3) {
          rect(x + tx, y + ty, 2, 2, '#0c0c10');
          dot(x + tx + 1, y + ty, P.glow);
          glowRect(x + tx + 1, y + ty, 1, 1, P.glow, 0.6);
        }
      },
      scope(x, y, rw, rh) {
        rect(x, y, rw, rh, '#1a1c24');
        rect(x, y, rw, 1, '#3a3e4a');
        rect(x + rw - 1, y, 1, rh, '#3ff0ff');
        dot(x, y + rh - 1, '#2a4a8a');
        glowRect(x + rw - 1, y, 1, rh, '#3ff0ff', 0.6);
      },
      drum(x, y, rw, rh) {
        block(x, y, rw, rh, P.metal, P.metalL, P.metalD);
        for (let yy = y + 1; yy < y + rh - 1; yy += 2) rect(x, yy, rw, 1, P.metalD);
        fx.drum = [x + PAD, y + PAD, rw, rh];
      },
      vent(x, y, rw) { for (let i = 0; i < rw; i++) { dot(x + i, y, P.bodyDD); dot(x + i, y + 1, P.bodyDD); i++; } },
      cylinder(x, y, rw, rh) {   // revolver drum: fluted, with glowing charged chambers
        block(x, y, rw, rh, P.metal, P.metalL, P.metalD);
        for (let i = x + 1; i < x + rw - 1; i += 2) rect(i, y + 1, 1, rh - 2, P.metalD);
        for (let i = x + 2; i < x + rw - 1; i += 2) { dot(i, y + (rh >> 1), P.glow); glowRect(i, y + (rh >> 1), 1, 1, P.glow, 0.6); }
        rect(x, y, 1, rh, P.metalDD);
        dot(x + 1, y, '#ffffff');
      },
      limbs(x, y, rw, rh) {   // crossbow arms swept back, with an energy bowstring
        const half = Math.floor(rh / 2), cy = y + half;
        for (const sg of [-1, 1]) for (let i = 0; i <= half; i++) {
          const sx = x - 3 + Math.round(i / half * 3);
          dot(sx, cy + sg * i, P.glowHi);
        }
        glowRect(x - 3, y, 4, rh, P.glow, 0.25);
        for (const sg of [-1, 1]) for (let i = 0; i <= half; i++) {
          const lx = x + rw - 1 - Math.round((i / half) ** 2 * (rw - 1));
          dot(lx, cy + sg * i, i === half ? P.glow : P.acc);
          if (i > 0 && i < half) dot(lx - 1, cy + sg * i, P.accD);
          if (i === half) glowRect(lx, cy + sg * i, 1, 1, P.glow, 0.7);
        }
      },
      tip(x, y, rw, rh) {   // armour-piercing spike head
        for (let i = 0; i < rw; i++) {
          const hh = Math.max(1, Math.round(rh * (1 - i / rw)));
          const top = y + Math.floor((rh - hh) / 2);
          rect(x + i, top, 1, hh, P.acc);
          dot(x + i, top, P.accL);
        }
        dot(x, y + (rh >> 1), P.glowHi);
        glowRect(x, y, rw, rh, P.glow, 0.4);
      },
      star(x, y, rw, rh) {   // four-point star core
        const cx = x + (rw >> 1), cy = y + (rh >> 1);
        rect(x, y, rw, rh, P.bodyDD);
        for (let i = -(rw >> 1); i <= rw >> 1; i++) dot(cx + i, cy, Math.abs(i) <= 1 ? '#ffffff' : P.glow);
        for (let i = -(rh >> 1); i <= rh >> 1; i++) dot(cx, cy + i, Math.abs(i) <= 1 ? '#ffffff' : P.glow);
        for (const [dx, dy] of [[-1, -1], [1, 1], [1, -1], [-1, 1]]) dot(cx + dx, cy + dy, P.accL);
        glowOval(x, y, rw, rh, P.glow, 0.6);
      },
      skull(x, y) {   // bone skull with glowing eyes
        const rows = ['.bbbb.', 'bbbbbb', 'bEbbEb', 'bbBBbb', '.bdbd.', '.BBBB.'];
        const cols = { b: '#e0d8c4', B: '#9a9080', E: P.glowHi, d: '#14101e' };
        rows.forEach((r, yy) => [...r].forEach((ch, xx) => { if (ch !== '.') dot(x + xx, y + yy, cols[ch]); }));
        glowRect(x + 1, y + 2, 1, 1, P.glow, 0.9); glowRect(x + 4, y + 2, 1, 1, P.glow, 0.9);
      },
    };
    for (const pt of parts) {
      const [type, ...args] = pt;
      R[type](...args);
    }
    // Muzzle = right end of the part that reaches farthest (ignoring fins).
    let best = null;
    for (const [type, x, y, a, b] of parts) {
      if (type === 'fin' || type === 'cable' || type === 'rail' || type === 'glowline' || type === 'trigger' || type === 'vent') continue;
      if (!best || x + a > best[0]) best = [x + a, y + b / 2];
    }
    if (best) fx.muzzle = [best[0] + PAD, Math.round(best[1] + PAD)];
    addOutline(c);
    return { img: c, glow, fx };
  },

  buildKnife(w, skin = null) {
    const PAD = 2, parts = this.knifeDesigns[w.id];
    const size = pt => {
      const [type, , , a, b, spec] = pt;
      if (type === 'curve') return [a, b + (+String(spec).split(' ')[1] || 0)];
      if (type === 'blade' && String(spec).includes('wave')) return [a, b + 1];
      if (type === 'gem' || type === 'pivot') return [2, 2];
      return [a, b];
    };
    let maxX = 0, maxY = 0;
    for (const pt of parts) { const [pw, ph] = size(pt); maxX = Math.max(maxX, pt[1] + pw); maxY = Math.max(maxY, pt[2] + ph); }
    const W = maxX + PAD * 2, H = maxY + PAD * 2;
    const C = this.skinPalette(w, skin);
    const P = {
      body: C.body, bodyL: shade(C.body, 0.3), bodyD: shade(C.body, -0.35), bodyDD: shade(C.body, -0.6),
      acc: C.accent, accL: shade(C.accent, 0.38), accD: shade(C.accent, -0.4),
      glow: C.color, glowHi: C.glow, glowD: shade(C.color, -0.35),
      blade: C.blade, bladeL: shade(C.blade, 0.4), bladeD: shade(C.blade, -0.28), spine: shade(C.blade, -0.5), edge: C.edge, sheen: '#ffffff',
      metal: C.metal[0], metalL: C.metal[1], metalD: C.metal[2],
      dark: C.dark[0], darkL: C.dark[1], darkD: C.dark[2],
    };
    const layer = keep => {
      const c = makeCanvas(W, H), glow = makeCanvas(W, H), fx = { lines: [], saw: null };
      const K = this.knifeKit(c.getContext('2d'), glow.getContext('2d'), P, PAD, fx);
      for (const pt of parts) if (keep(pt)) K[pt[0]](...pt.slice(1, 6));
      addOutline(c);
      return { c, glow, fx };
    };
    const full = layer(() => true);
    const hold = parts.find(pt => pt[0] === 'handle' || pt[0] === 'bali' || pt[0] === 'pole');
    const fx = {
      lines: full.fx.lines, saw: full.fx.saw, drum: null,
      muzzle: [W - PAD, Math.floor(H / 2)],
      holdY: hold ? hold[2] + PAD + Math.floor(hold[4] / 2) : Math.floor(H / 2),
    };
    // Balisongs: the handle and the blade are separate layers so the blade can flip.
    if (w.shape === 'balisong') {
      const handle = layer(pt => pt[6] !== 'B'), blade = layer(pt => pt[6] === 'B');
      const pin = parts.find(pt => pt[0] === 'pivot');
      fx.lines = handle.fx.lines;
      fx.bali = { handle: handle.c, handleGlow: handle.glow, blade: blade.c, bladeGlow: blade.glow, pivot: [pin[1] + PAD + 0.5, pin[2] + PAD + 0.5] };
    }
    return { img: full.c, glow: full.glow, fx };
  },

  // Part renderers for knifeDesigns (coordinates are inside the padding).
  knifeKit(g, gg, P, PAD, fx) {
    const rect = (x, y, rw, rh, col) => { g.fillStyle = col; g.fillRect(x + PAD, y + PAD, rw, rh); };
    const dot = (x, y, col) => { g.fillStyle = col; g.fillRect(x + PAD, y + PAD, 1, 1); };
    const clear = (x, y) => g.clearRect(x + PAD, y + PAD, 1, 1);
    const glow = (x, y, rw, rh, col = P.glow, a = 0.5) => { gg.globalAlpha = a; gg.fillStyle = col; gg.fillRect(x + PAD - 1, y + PAD - 1, rw + 2, rh + 2); gg.globalAlpha = 1; };
    const softGlow = (x, y, col = P.glow, a = 0.35) => { gg.globalAlpha = a; gg.fillStyle = col; gg.fillRect(x + PAD, y + PAD, 1, 1); gg.globalAlpha = 1; };
    // One blade column: dark spine on top, steel body, bevel line, bright edge.
    const column = (x, top, bot, i, flags) => {
      for (let y = top; y <= bot; y++) {
        let col = P.blade;
        if (y === bot) col = P.edge;
        else if (y === top) col = P.spine;
        else if (y === bot - 1) col = P.bladeL;
        dot(x, y, col);
        if (flags.glow) softGlow(x, y, P.glow, y === bot ? 0.55 : 0.18);
      }
      if (bot - top >= 3 && i % 5 === 2) dot(x, top + 1, P.sheen);   // polish glints
      if (flags.core && bot - top >= 2) {
        const mid = top + Math.floor((bot - top) / 2);
        dot(x, mid, i % 3 ? P.glow : P.glowHi);
        softGlow(x, mid, P.glow, 0.7);
      }
    };
    const K = {
      // Blade tips: point, clip, drop, tanto, leaf (kunai), blunt.
      // Flags: fuller, serr (spine notches), wave (kris), glow (edge glow), core (energy core line).
      blade(x, y, len, h, spec = 'point') {
        const f = spec.split(' '), tip = f[0];
        const flags = { glow: f.includes('glow'), core: f.includes('core') };
        const tl = Math.min(len - 1, Math.max(2, Math.round(h * 1.6)));
        const mid = y + (h - 1) / 2;
        for (let i = 0; i < len; i++) {
          let top = y, bot = y + h - 1;
          const k = (i - (len - tl) + 1) / tl;
          if (tip === 'leaf') {
            const peak = len * 0.3, kk = i < peak ? 0.45 + 0.55 * i / peak : 1 - (i - peak) / (len - peak);   // diamond kunai head
            const prof = Math.max(0.5, (h / 2) * kk);
            top = Math.round(mid - prof + 0.5); bot = Math.round(mid + prof - 0.5);
          } else if (k > 0 && tip !== 'blunt') {
            if (tip === 'point') { top = Math.round(lerp(y, mid, k)); bot = Math.round(lerp(y + h - 1, mid, k)); }
            else if (tip === 'clip') { top = y + Math.round(Math.pow(k, 0.8) * (h - 1)); bot = y + h - 1 - Math.round(k * k * k * (h - 1) * 0.3); }
            else if (tip === 'drop') { top = y + Math.round(k * k * (h - 1) * 0.6); bot = y + h - 1 - Math.round(Math.pow(k, 1.3) * (h - 1) * 0.6); }
            else if (tip === 'tanto') { if (k > 0.45) bot = y + h - 1 - Math.round((k - 0.45) / 0.55 * (h - 1)); }
          }
          if (top > bot) top = bot;
          const wob = f.includes('wave') && i > 2 ? Math.round(Math.sin(i * 0.9)) : 0;
          column(x + i, top + wob, bot + wob, i, flags);
          if (f.includes('fuller') && h >= 4 && i >= 2 && k <= 0) dot(x + i, top + 1, P.bladeD);
          if (f.includes('serr') && i >= 1 && i <= len * 0.4 && i % 2) clear(x + i, top + wob);
        }
        if (flags.core && h >= 3 && tip !== 'leaf') fx.lines.push([x + PAD, Math.floor(mid) + PAD, len - tl]);
      },
      // Curved blade ('up 3' = rises 3px toward the tip, like a katana).
      curve(x, y, len, h, spec) {
        const f = spec.split(' '), up = f[0] === 'up', bend = +f[1];
        const flags = { glow: f.includes('glow'), core: f.includes('core') };
        for (let i = 0; i < len; i++) {
          const k = i / Math.max(1, len - 1);
          const off = Math.round(bend * k * k);
          const hh = Math.max(1, Math.round(h * (1 - Math.max(0, k - 0.8) / 0.2 * 0.75)));
          const top = up ? y + bend - off : y + off;
          column(x + i, top, top + hh - 1, i, flags);
        }
      },
      // Arc of a ring: karambits, sickles, scythes, axe heads. The edge is on the
      // inner (concave) side unless o.outer. Thickness tapers to a point unless th >= R.
      crescent(x, y, rw, rh, o) {
        const span = o.a1 - o.a0, TAU = Math.PI * 2;
        for (let py = 0; py < rh; py++) for (let pxx = 0; pxx < rw; pxx++) {
          const dx = pxx + 0.5 - o.cx, dy = py + 0.5 - o.cy, r = Math.hypot(dx, dy);
          const rel = ((Math.atan2(dy, dx) - o.a0) % TAU + TAU) % TAU;
          if (rel > span || r > o.R) continue;
          const t = rel / span, th = o.th >= o.R ? o.R : lerp(o.th, 1, Math.pow(t, 1.7));
          const d = o.R - r;
          if (d >= th) continue;
          let col = P.blade;
          if (o.outer) col = d < 1 ? P.edge : d < 2 ? P.bladeL : d > th - 1.5 ? P.bladeD : P.blade;
          else col = d < 1 ? P.spine : d >= th - 1 ? P.edge : d >= th - 2 ? P.bladeL : P.blade;
          if (o.core && Math.abs(d - th / 2) < 0.5 && th >= 3) col = (pxx + py) % 3 ? P.glow : P.glowHi;
          dot(x + pxx, y + py, col);
          if (o.glow) softGlow(x + pxx, y + py, P.glow, col === P.edge || col === P.glow ? 0.55 : 0.15);
          if (!o.outer && d < 1 && (pxx * 7 + py * 3) % 9 === 0) dot(x + pxx, y + py, P.sheen);
        }
      },
      axe(x, y, rw, rh) {   // bearded axe head flaring out to a convex edge
        const cy = y + (rh - 1) / 2;
        for (let i = 0; i < rw; i++) {
          const k = i / (rw - 1);
          let half = 1.5 + (rh / 2 - 1.5) * Math.pow(k, 1.6);
          if (i === rw - 1) half -= 1;   // rounded edge corners
          const top = Math.round(cy - half), bot = Math.round(cy + half);
          for (let yy = top; yy <= bot; yy++) {
            let col = P.blade;
            if (i >= rw - 2) col = P.edge;
            else if (i === rw - 3) col = P.bladeL;
            else if (yy === top) col = P.bladeL;
            else if (yy === bot) col = P.bladeD;
            dot(x + i, yy, col);
            softGlow(x + i, yy, P.glow, i >= rw - 2 ? 0.55 : 0.12);
          }
          if (i > 1 && i < rw - 3) dot(x + i, Math.round(cy - half * 0.45), P.spine);   // blood groove
        }
      },
      handle(x, y, rw, rh, spec = 'wrap') {
        rect(x, y, rw, rh, P.dark);
        rect(x, y, rw, 1, P.darkL);
        if (rh >= 3) rect(x, y + rh - 1, rw, 1, P.darkD);
        if (spec === 'wrap') {
          for (let i = 0; i < rw; i++) for (let r = 0; r < rh; r++) if ((i + r) % 3 === 0) dot(x + i, y + r, r === 0 ? P.accL : r === rh - 1 ? P.accD : P.acc);
        } else if (spec === 'diamond') {   // katana silk wrap over ray skin
          rect(x, y, rw, rh, P.acc); rect(x, y, rw, 1, P.accL); rect(x, y + rh - 1, rw, 1, P.accD);
          for (let i = 1; i < rw - 1; i += 2) dot(x + i, y + Math.floor(rh / 2), '#e8e0d0');
        } else if (spec === 'grip') {      // moulded finger ridges
          for (let i = 1; i < rw; i += 2) rect(x + i, y + 1, 1, Math.max(1, rh - 2), P.darkD);
          dot(x + rw - 1, y + rh - 1, P.acc);
        }
      },
      pommel(x, y, rw, rh, spec) {
        rect(x, y, rw, rh, P.metal); rect(x, y, rw, 1, P.metalL); rect(x, y + rh - 1, rw, 1, P.metalD);
        if (spec === 'gem') { dot(x + (rw >> 1), y + (rh >> 1), P.glowHi); glow(x, y + (rh >> 1), rw, 1, P.glow, 0.5); }
      },
      guard(x, y, rw, rh, spec) {
        rect(x, y, rw, rh, P.acc);
        rect(x, y, 1, rh, P.accL);
        if (rw >= 2) rect(x + rw - 1, y, 1, rh, P.accD);
        dot(x, y, '#ffffff');
        dot(x + rw - 1, y + rh - 1, P.accD);
        if (spec === 'gem') { const cy = y + (rh >> 1); dot(x + (rw >> 1), cy, P.glowHi); dot(x + (rw >> 1), cy - 1, P.glow); glow(x, cy - 1, rw, 2, P.glow, 0.6); }
        else if (rh >= 5) { dot(x + (rw >> 1), y + 1, P.metalL); dot(x + (rw >> 1), y + rh - 2, P.metalL); }
      },
      tsuba(x, y, rw, rh) {   // round katana guard
        rect(x, y + 1, rw, rh - 2, P.metalD); rect(x, y, rw, 1, P.metal); rect(x, y + rh - 1, rw, 1, P.metalD);
        rect(x, y + 1, 1, rh - 2, P.metal); dot(x, y + 1, P.metalL);
        dot(x + rw - 1, y + 2, '#ffd040'); dot(x + rw - 1, y + rh - 3, '#ffd040');
      },
      ring(x, y, rw, rh, spec) {   // karambit / kunai finger ring
        const cx = x + rw / 2, cy = y + rh / 2;
        for (let py = y; py < y + rh; py++) for (let pxx = x; pxx < x + rw; pxx++) {
          const dx = (pxx + 0.5 - cx) / (rw / 2), dy = (py + 0.5 - cy) / (rh / 2), nd = dx * dx + dy * dy;
          if (nd > 1.05 || nd < 0.3) continue;
          let col = dx + dy < -0.4 ? P.metalL : dx + dy > 0.5 ? P.metalD : P.metal;
          if (spec === 'glow' && nd < 0.55) { col = P.glow; softGlow(pxx, py, P.glow, 0.7); }
          dot(pxx, py, col);
        }
      },
      bali(x, y, rw, rh, spec) {   // balisong handle: two channel halves, latch, pins
        rect(x, y, rw, rh, P.body);
        rect(x, y, rw, 1, P.bodyL);
        rect(x, y + rh - 1, rw, 1, P.bodyD);
        const midY = y + (rh >> 1);
        for (let i = 1; i < rw - 1; i++) {
          const hole = i % 3 !== 0;
          dot(x + i, midY, hole ? (spec === 'glow' ? P.glow : P.darkD) : P.bodyD);
          if (hole && spec === 'glow') softGlow(x + i, midY, P.glow, 0.6);
        }
        if (spec === 'glow') fx.lines.push([x + 1 + PAD, midY + PAD, rw - 2]);
        dot(x, midY, P.acc); dot(x, y, P.accL);            // latch
        dot(x + 1, y, '#ffffff');
        dot(x + rw - 1, y, P.metalL); dot(x + rw - 1, y + rh - 1, P.metalL);   // pivot pins
      },
      pivot(x, y) { dot(x, y, P.metalL); dot(x, y - 1, P.metal); dot(x, y + 1, P.metalD); },
      pole(x, y, rw, rh, spec) {
        rect(x, y, rw, rh, P.bodyD); rect(x, y, rw, 1, P.body);
        dot(x, y, P.bodyL);
        rect(x, y, 4, rh, P.dark); for (let i = 0; i < 4; i += 2) dot(x + i, y, P.darkL);   // grip wrap
        if (spec === 'bands') for (let i = 7; i < rw - 1; i += 6) { rect(i, y, 1, rh, P.acc); dot(i, y, P.accL); }
      },
      plate(x, y, rw, rh) {   // claw housing over the fist
        rect(x, y, rw, rh, P.body); rect(x, y, rw, 1, P.bodyL); rect(x, y + rh - 1, rw, 1, P.bodyD);
        rect(x + rw - 1, y + 1, 1, rh - 2, P.acc);
        for (let yy = y + 2; yy < y + rh - 1; yy += 3) dot(x + 1, yy, P.bodyDD);
      },
      claw(x, y, rw, rh, n) {   // n curved talons fanning out of the housing
        for (let k = 0; k < n; k++) {
          const ty = y + Math.round(k * (rh - 2) / Math.max(1, n - 1));
          const len = rw - (k === 1 ? 0 : 2);
          K.curve(x, ty, len, 2, (k === n - 1 ? 'down 1' : 'up 1') + ' glow');
        }
      },
      head(x, y, rw, rh) {   // scrap-hammer engine block
        rect(x, y, rw, rh, P.body); rect(x, y, rw, 1, P.bodyL); rect(x, y + rh - 1, rw, 1, P.bodyDD);
        rect(x, y, 1, rh, P.bodyD);
        rect(x + 2, y + 2, rw - 4, rh - 4, P.bodyD);
        for (let yy = y + 1; yy < y + rh - 1; yy++) dot(x + rw - 1, yy, Math.floor((yy - y) / 2) % 2 ? P.acc : '#ffd040');   // hazard face
        rect(x + 3, y + rh / 2 - 1, 2, 2, P.glow); dot(x + 3, y + rh / 2 - 1, P.glowHi);
        glow(x + 3, y + rh / 2 - 1, 2, 2, P.glow, 0.6);
        for (const [dx, dy] of [[1, 1], [rw - 2, 1], [1, rh - 2], [rw - 2, rh - 2]]) dot(x + dx, y + dy, P.metalL);   // bolts
      },
      chain(x, y, rw, rh) {   // whip links rippling out to a glowing barb
        const mid = y + (rh >> 1);
        for (let i = 0; i < rw; i++) {
          const yy = mid + Math.round(Math.sin(i * 0.7) * (rh >> 1) * Math.min(1, i / 6));
          dot(x + i, yy, i % 2 ? P.metal : P.metalL);
          if (i % 2 === 0) dot(x + i, yy + 1, P.metalD);
          if (i >= rw - 2) { dot(x + i, yy, P.glowHi); glow(x + i, yy, 1, 1, P.glow, 0.6); }
        }
      },
      motor(x, y, rw, rh) {   // chainsword engine
        rect(x, y, rw, rh, P.body); rect(x, y, rw, 1, P.bodyL); rect(x, y + rh - 1, rw, 1, P.bodyDD);
        for (let yy = y + 2; yy < y + rh - 2; yy += 2) rect(x + 1, yy, rw - 2, 1, P.bodyDD);   // cooling fins
        rect(x + rw - 1, y + 1, 1, rh - 2, P.acc);
        dot(x + 1, y + 1, P.glow); glow(x + 1, y + 1, 1, 1, P.glow, 0.6);
      },
      saw(x, y, rw, rh) {   // guide bar with chain teeth (animated in render.js)
        rect(x, y + 1, rw, rh - 2, P.metal);
        rect(x, y + 1, rw, 1, P.metalL);
        rect(x + 1, y + 2, rw - 3, rh - 4, P.metalD);
        rect(x + 2, y + (rh >> 1), rw - 5, 1, P.acc);
        for (let i = 0; i < rw - 1; i++) {
          dot(x + i, y, i % 2 ? P.bladeL : P.spine);
          dot(x + i, y + rh - 1, i % 2 ? P.spine : P.bladeL);
        }
        clear(x + rw - 1, y + 1); clear(x + rw - 1, y + rh - 2);   // rounded nose
        fx.saw = [x + PAD, y + PAD, rw - 1, rh];
      },
      band(x, y, rw, rh) { rect(x, y, rw, rh, P.acc); dot(x, y, P.accL); dot(x, y + rh - 1, P.accD); },
      gem(x, y) { dot(x, y, '#ffffff'); dot(x + 1, y, P.glow); dot(x, y + 1, P.glow); dot(x + 1, y + 1, P.glowD); glow(x, y, 2, 2, P.glow, 0.6); },
      zig(x, y, rw, rh) {   // lightning running along the blade
        for (let i = 0; i < rw; i++) {
          const yy = y + (Math.floor(i / 2) % 2 ? rh - 1 : 0);
          dot(x + i, yy, i % 2 ? P.glow : P.glowHi);
          softGlow(x + i, yy, P.glow, 0.7);
        }
      },
      frost(x, y, rw, rh) {   // ice crystals on the blade
        for (let i = 1; i < rw; i += 3) {
          const yy = y + 1 + (i * 7) % Math.max(1, rh - 2);
          dot(x + i, yy, '#ffffff');
          softGlow(x + i, yy, '#ffffff', 0.6);
        }
      },
      runes(x, y, rw) {   // engraved glowing glyphs
        for (let i = 0; i < rw; i += 3) {
          dot(x + i, y, P.glowHi); if (i + 1 < rw) dot(x + i + 1, y, P.glow);
          softGlow(x + i, y, P.glow, 0.8);
        }
      },
    };
    return K;
  },

  // Fallback for melee weapons without a knifeDesign (three-tone archetype shapes).
  buildKnifeSimple(w) {
    const PAD = 2;
    const parts = this.weaponShapes[w.shape].slice();
    const maxX = Math.max(...parts.map(p => p[0] + p[2])), maxY = Math.max(...parts.map(p => p[1] + p[3]));
    const W = maxX + PAD * 2, H = maxY + PAD * 2;
    const c = makeCanvas(W, H), g = c.getContext('2d');
    const glow = makeCanvas(W, H), gg = glow.getContext('2d');
    const mats = {
      b: w.body, d: shade(w.body, -0.45), a: w.accent, m: '#9aa4b6', g: w.color,
      h: '#2a2420', e: w.glow, E: w.color, k: shade(w.body, -0.2),
    };
    for (const [x, y, pw, ph, m] of parts) {
      const X = x + PAD, Y = y + PAD, col = mats[m];
      if (m === 'g') {
        g.fillStyle = col; g.fillRect(X, Y, pw, ph);
        g.fillStyle = w.glow;
        g.fillRect(X + Math.floor(pw / 2), Y + Math.floor(ph / 2), Math.max(1, pw >> 2), Math.max(1, ph >> 2));
        gg.fillStyle = w.color; gg.globalAlpha = 0.5;
        gg.fillRect(X - 1, Y - 1, pw + 2, ph + 2);
        gg.globalAlpha = 1;
        continue;
      }
      if (m === 'e' || m === 'E' || m === 'k') { g.fillStyle = col; g.fillRect(X, Y, pw, ph); continue; }
      g.fillStyle = col; g.fillRect(X, Y, pw, ph);
      g.fillStyle = shade(col, 0.35); g.fillRect(X, Y, pw, 1);
      if (ph >= 3) { g.fillStyle = shade(col, -0.35); g.fillRect(X, Y + ph - 1, pw, 1); }
      if (pw >= 4 && ph >= 2) px(g, X + 1, Y, '#ffffff');
    }
    addOutline(c);
    return { img: c, glow, fx: { lines: [], muzzle: [W - PAD, Math.floor(H / 2)], drum: null } };
  },

  // ---------- Weapon looks: skin + visible mods ----------
  looks: new Map(),

  // The weapon as a player has it (skin colors plus mod parts), cached per combination.
  look(id, mods = {}, skin = null) {
    const tier = k => (mods.mk && mods.mk[k]) || 1;
    const key = id + '|' + (skin || '') + '|' + ['optic', 'mag', 'core', 'edge', 'grip'].map(k => mods[k] ? mods[k] + tier(k) : '').join(',');
    let L = this.looks.get(key);
    if (L) return L;
    const w = WEAPON_BY_ID[id];
    const base = skin ? this.buildWeapon(w, skin) : { img: this.weapons[id], glow: this.weaponGlow[id], fx: this.weaponFx[id] };
    L = w.kind === 'gun' ? this.modGun(w, base, mods) : this.modKnife(w, base, mods);
    L.key = key;
    L.skin = skin;
    if (skin && !L.fx.bali) {
      L.shine = silhouette(L.img);   // glint mask (gold, frost)
      // Pixel lists for twinkles (void, frost) and blood drips: the body, plus
      // the top and bottom edge of every column.
      const W = L.img.width, H = L.img.height, d = readPixels(L.img);
      const solid = (x, y) => { const i = (y * W + x) * 4; return d[i + 3] > 128 && !(d[i] === 0x14 && d[i + 1] === 0x14 && d[i + 2] === 0x1c); };
      L.pts = []; L.drips = { top: [], bot: [] };
      for (let x = 0; x < W; x++) {
        let top = -1, bot = -1;
        for (let y = 0; y < H; y++) if (solid(x, y)) { if (top < 0) top = y; bot = y; if ((x * 7 + y * 3) % 4 === 0) L.pts.push([x, y]); }
        if (top >= 0) { L.drips.top.push([x, top - 1]); L.drips.bot.push([x, bot + 1]); }
      }
      if (!L.pts.length) L.pts.push([0, 0]);
    }
    this.looks.set(key, L);
    return L;
  },

  // Gun mods are drawn as extra parts: a scope on top, a longer magazine
  // underneath and a glowing elemental core set into the body. The canvas
  // grows 3px at the top and bottom so the gun stays centred in the hand.
  modGun(w, base, mods) {
    if (!mods.optic && !mods.mag && !mods.core) return { img: base.img, glow: base.glow, fx: base.fx };
    const M = 3, PAD = 2, parts = this.gunDesigns[w.id] || [];
    const W = base.img.width, H = base.img.height + M * 2;
    const img = makeCanvas(W, H), glow = makeCanvas(W, H), ov = makeCanvas(W, H);
    const g = img.getContext('2d'), gg = glow.getContext('2d'), og = ov.getContext('2d');
    g.drawImage(base.img, 0, M);
    gg.drawImage(base.glow, 0, M);
    const r = (x, y, rw, rh, c) => { og.fillStyle = c; og.fillRect(x, y, rw, rh); };
    const shine = (x, y, rw, rh, c, a) => { gg.globalAlpha = a; gg.fillStyle = c; gg.fillRect(x - 1, y - 1, rw + 2, rh + 2); gg.globalAlpha = 1; };
    const find = t => parts.find(pt => pt[0] === t);
    const mk = k => (mods.mk && mods.mk[k]) || 1;
    const TIER = ['', '#c8ccd8', '#ffd040', '#ff9cf0'];   // trim color per Mk
    const body = find('body') || ['body', 1, 1, W - 6, 3];
    const bx = body[1] + PAD, by = body[2] + PAD + M, bw = body[3], bh = body[4];
    if (mods.optic === 'scope') {
      const ex = find('scope');
      const sw = ex ? ex[3] + 2 : 7;
      const sx = ex ? ex[1] + PAD - 1 : bx + Math.max(1, Math.floor(bw * 0.3));
      const sy = (ex ? ex[2] + PAD + M : by) - 3;
      r(sx, sy, sw, 2, '#5a6272'); r(sx, sy, sw, 1, '#a8b2c4');                  // tube, lit on top
      r(sx, sy, 1, 2, '#2a2e3a');                                                  // eyepiece
      r(sx + sw - 1, sy, 1, 2, '#3ff0ff'); r(sx + sw - 1, sy, 1, 1, '#ffffff');     // front lens
      r(sx + Math.floor(sw / 2), sy - 1, 1, 1, '#8a94a6');                         // adjustment turret
      r(sx + 1, sy + 2, 1, 1, '#4a5262'); r(sx + sw - 3, sy + 2, 1, 1, '#4a5262'); // mounts
      if (mk('optic') >= 2) r(sx + 2, sy, 1, 2, TIER[mk('optic')]);              // Mk trim rings
      if (mk('optic') >= 3) { r(sx + 4, sy, 1, 2, TIER[3]); shine(sx + 2, sy, 3, 2, TIER[3], 0.4); }
      shine(sx + sw - 1, sy, 1, 2, '#3ff0ff', 0.5 + mk('optic') * 0.15);
    }
    if (mods.mag === 'extmag') {
      const mg = find('mag'), gr = find('grip');
      const mx = mg ? mg[1] + PAD : (gr ? gr[1] + gr[3] + 1 : body[1] + 3) + PAD;
      const my = mg ? mg[2] + PAD + M + mg[4] : by + bh;
      const mw = mg ? mg[3] : 3;
      r(mx, my, mw, 3, '#2a2a34'); r(mx, my, 1, 3, '#44445a');
      const stripe = ['', '#ffd040', '#ff8a2a', '#ff3df0'][mk('mag')];
      if (mw >= 2) { r(mx + 1, my, 1, 2, stripe); shine(mx + 1, my, 1, 2, stripe, 0.4 + mk('mag') * 0.15); }
      r(mx, my + 2, mw, 1, mk('mag') >= 2 ? TIER[mk('mag')] : '#5a6272');
    }
    if (mods.core) {
      const col = MODS[mods.core].color;
      const cx = bx + (bw > 8 ? 3 : 1), cy = by + Math.max(0, Math.floor((bh - 2) / 2));
      if (mk('core') >= 3) { r(cx - 1, cy, 4, 2, TIER[3]); }   // Mk III: gold-pink setting around the gem
      r(cx, cy, 2, 2, col); r(cx, cy, 1, 1, '#ffffff'); r(cx + 1, cy + 1, 1, 1, shade(col, -0.3));
      shine(cx, cy, 2, 2, col, 0.6 + mk('core') * 0.2);
    }
    addOutline(ov);
    g.drawImage(ov, 0, 0);
    const fx = Object.assign({}, base.fx, {
      muzzle: [base.fx.muzzle[0], base.fx.muzzle[1] + M],
      lines: base.fx.lines.map(([x, y, lw]) => [x, y + M, lw]),
      drum: base.fx.drum && [base.fx.drum[0], base.fx.drum[1] + M, base.fx.drum[2], base.fx.drum[3]],
    });
    return { img, glow, fx };
  },

  // Melee mods: a core gem in the guard or handle, a bright honed edge along
  // the blade, and a gold weight band on the grip. Same canvas size.
  modKnife(w, base, mods) {
    if (!mods.edge && !mods.grip && !mods.core) return { img: base.img, glow: base.glow, fx: base.fx };
    const PAD = 2, parts = this.knifeDesigns[w.id] || [];
    const mk = k => (mods.mk && mods.mk[k]) || 1;
    const find = (...types) => parts.find(pt => types.includes(pt[0]));
    const bladeTypes = ['blade', 'curve', 'crescent', 'axe', 'saw', 'claw', 'chain', 'head'];
    const paint = (src, srcGlow, opt) => {
      const img = makeCanvas(src.width, src.height), glow = makeCanvas(src.width, src.height);
      const g = img.getContext('2d'), gg = glow.getContext('2d');
      g.drawImage(src, 0, 0); gg.drawImage(srcGlow, 0, 0);
      const dot = (x, y, c) => { g.fillStyle = c; g.fillRect(x, y, 1, 1); };
      const shine = (x, y, rw, rh, c, a) => { gg.globalAlpha = a; gg.fillStyle = c; gg.fillRect(x - 1, y - 1, rw + 2, rh + 2); gg.globalAlpha = 1; };
      if (opt.edge && mods.edge === 'monoedge') {
        // Hone the lowest blade pixel of every column inside the blade parts.
        const d = readPixels(img);
        const solid = (x, y) => { const i = (y * img.width + x) * 4; return d[i + 3] > 128 && !(d[i] === 0x14 && d[i + 1] === 0x14 && d[i + 2] === 0x1c); };
        for (const pt of parts.filter(pt => bladeTypes.includes(pt[0]) && pt[6] === opt.layer)) {
          const x0 = pt[1] + PAD, y0 = pt[2] + PAD, x1 = x0 + pt[3], y1 = Math.min(img.height - 1, y0 + pt[4] + 3);
          for (let x = x0; x < x1; x++) for (let y = y1; y >= y0; y--) {
            if (!solid(x, y)) continue;
            dot(x, y, '#ffffff');
            gg.globalAlpha = 0.4 + mk('edge') * 0.2; gg.fillStyle = mk('edge') >= 3 ? '#9ff8ff' : '#e8f8ff';
            gg.fillRect(x, y - (mk('edge') >= 2 ? 1 : 0), 1, mk('edge') >= 2 ? 2 : 1); gg.globalAlpha = 1;
            break;
          }
        }
      }
      const hold = find('handle', 'bali', 'pole');
      if (opt.handle && mods.grip === 'balgrip' && hold) {
        const hx = hold[1] + PAD, hy = hold[2] + PAD, hw = hold[0] === 'pole' ? Math.min(6, hold[3]) : hold[3], hh = hold[4];
        for (let i = 1; i < hw; i += 2) dot(hx + i, hy + Math.floor(hh / 2), '#c8a040');   // grip tape
        const band = ['', '#ffd040', '#ffb020', '#ff9cf0'][mk('grip')];
        for (let y = hy; y < hy + hh; y++) dot(hx + hw - 1, y, y === hy ? '#fff0a0' : band);   // weight band
        if (mk('grip') >= 3) for (let y = hy; y < hy + hh; y++) dot(hx + hw - 3, y, band);
      }
      if (opt.handle && mods.core) {
        const t = find('guard', 'tsuba', 'plate', 'ring') || hold;
        if (t) {
          const col = MODS[mods.core].color;
          const gx = t[1] + PAD + Math.max(0, Math.floor(t[3] / 2) - 1), gy = t[2] + PAD + Math.max(0, Math.floor(t[4] / 2) - 1);
          dot(gx, gy, '#ffffff'); dot(gx + 1, gy, col); dot(gx, gy + 1, col); dot(gx + 1, gy + 1, shade(col, -0.35));
          shine(gx, gy, 2, 2, col, 0.5 + mk('core') * 0.2);
        }
      }
      return { img, glow };
    };
    const full = paint(base.img, base.glow, { edge: true, handle: true, layer: undefined });
    // Balisong blades use layer 'B'; the composite picture hones them too.
    if (base.fx.bali) {
      const both = parts.filter(pt => bladeTypes.includes(pt[0]));
      if (mods.edge && both.some(pt => pt[6] === 'B')) Object.assign(full, paint(full.img, full.glow, { edge: true, layer: 'B' }));
      const h = paint(base.fx.bali.handle, base.fx.bali.handleGlow, { handle: true });
      const b = paint(base.fx.bali.blade, base.fx.bali.bladeGlow, { edge: true, layer: 'B' });
      const fx = Object.assign({}, base.fx, { bali: Object.assign({}, base.fx.bali, { handle: h.img, handleGlow: h.glow, blade: b.img, bladeGlow: b.glow }) });
      return { img: full.img, glow: full.glow, fx };
    }
    return { img: full.img, glow: full.glow, fx: base.fx };
  },

  // Small star-shaped muzzle flash sprite per weapon color (cached).
  flashSprite(color) {
    this.flashCache = this.flashCache || {};
    if (this.flashCache[color]) return this.flashCache[color];
    const c = makeCanvas(9, 7), g = c.getContext('2d');
    g.fillStyle = color;
    g.fillRect(0, 3, 9, 1); g.fillRect(2, 1, 1, 5); g.fillRect(4, 0, 1, 7); g.fillRect(1, 2, 6, 3);
    g.fillStyle = '#ffffff';
    g.fillRect(1, 3, 5, 1); g.fillRect(2, 2, 3, 3);
    return (this.flashCache[color] = c);
  },

  // ---------- 8x8 item icons ----------
  buildIcons() {
    const defs = {
      wood:  [['........', '.oooooo.', 'oYybbbbo', '.oooooo.', '.oooooo.', 'oYybbbbo', '.oooooo.', '........'],
              { Y: '#e0b880', y: '#a87848', b: '#6a4020' }],
      stone: [['........', '..oooo..', '.oLLsso.', 'oLssssso', 'osssSSso', 'osSSSSSo', '.oooooo.', '........'],
              { L: '#c8c8d0', s: '#8a8a96', S: '#5a5a66' }],
      metal: [['........', '..ooooo.', '.oLLLLLo', 'oLmmmmmo', 'ommmmmMo', 'oMMMMMMo', 'oooooooo', '........'],
              { L: '#e8eef8', m: '#9aa6b8', M: '#5a6478' }],
      cells: [['..oooo..', '.occcco.', '.ocyyco.', '.occyco.', '.ocyyco.', '.ocycco.', '.occcco.', '..oooo..'],
              { c: '#1a9aaa', y: '#c8ffff' }],
      bandage: [['........', '........', 'oooooooo', 'oyyyyyyo', 'oyyrryyo', 'oyyyyyyo', 'oooooooo', '........'],
              { y: '#f0e0c0', r: '#e03040' }],
      medkit: [['..oooo..', '.oo..oo.', 'oooooooo', 'owwrrwwo', 'owrrrrwo', 'owwrrwwo', 'owwwwwwo', 'oooooooo'],
              { w: '#f0f0f0', r: '#e03040' }],
      serum: [['...oo...', '..oLLo..', '...oo...', '..ommo..', '.ommmmo.', '.ommMmo.', '.ommmmo.', '..oooo..'],
              { L: '#a0a0b0', m: '#ff5cf0', M: '#ffffff' }],
      skull: [['.ooooo..', 'owwwwwo.', 'owowowo.', 'owwwwwo.', '.owowo..', '.ooooo..', '........', '........'],
              { w: '#e8e8e0' }],
      heart: [['........', '.oo.oo..', 'orrorro.', 'orrrrro.', '.orrro..', '..oro...', '...o....', '........'],
              { r: '#ff4050' }],
      techshard: [['....oo..', '...occo.', '..occwo.', '.occco..', 'occcco..', 'ocwco...', '.oco....', '..o.....'],
              { c: '#1a9aaa', w: '#9ff8ff' }],
      diamond: [['........', '.oooooo.', 'owwccLLo', '.occcLo.', '..occo..', '...oo...', '........', '........'],
              { w: '#ffffff', c: '#9ff8ff', L: '#4ac8e0' }],
      plasmacore: [['..oooo..', '.ommmmo.', 'ompwwmmo', 'ompwmmmo', 'ommmmmmo', 'ommmmmPo', '.oPPPPo.', '..oooo..'],
              { m: '#ff5cf0', p: '#ffb0ff', w: '#ffffff', P: '#a02a90' }],
      voidcrystal: [['...oo...', '..ovvo..', '.ovwvvo.', '.ovwvvo.', 'ovvvdvvo', '.ovvdvo.', '..ovvo..', '...oo...'],
              { v: '#b05cff', w: '#e8c8ff', d: '#3a1460' }],
      plasma: [['..oooo..', '.oaaaao.', '.ommmmo.', '.ompmmo.', '.ompmmo.', '.ommmmo.', '.oaaaao.', '..oooo..'],
              { a: '#9aa4b6', m: '#ff5cf0', p: '#ffd0ff' }],
      quantum: [['........', '.oooooo.', 'oyYYYYyo', 'oYyyyyYo', 'oYywyyYo', 'oYyyyyYo', 'oyYYYYyo', '.oooooo.'],
              { y: '#ffd040', Y: '#a87a10', w: '#ffffff' }],
      antimatter: [['...oo...', '.oovvoo.', 'ov.ww.vo', 'ovwddwvo', 'ovwddwvo', 'ov.ww.vo', '.oovvoo.', '...oo...'],
              { v: '#b05cff', w: '#ff9cf0', d: '#14081e' }],
      bag: [['..oooo..', '.oo..oo.', 'oooooooo', 'obbbbbbo', 'obyyyybo', 'obbyybbo', 'oBbbbbBo', 'oooooooo'],
              { b: '#9a6430', B: '#6a4020', y: '#ffd040' }],
      lock: [['..oooo..', '.o....o.', '.o....o.', 'oooooooo', 'oggggggo', 'oggooggo', 'oggggggo', 'oooooooo'],
              { g: '#7a7a94' }],
      modkit: [['..oooo..', '.oLLLLo.', 'oooooooo', 'obbbbbbo', 'obpwwpbo', 'obbppbbo', 'oBBBBBBo', 'oooooooo'],
              { L: '#c8ccd8', b: '#5a6476', B: '#3a4250', p: '#ff5cf0', w: '#ffffff' }],
    };
    for (const k in defs) this.icons[k] = spriteFromRows(defs[k][0], defs[k][1]);
  },

  // ---------- Chests: one per rarity ----------
  buildChests() {
    // M metal corner brackets, G gold lock plate, k keyhole, B plank seams, Y sparkle.
    const closed = [
      '.oooooooooo.',
      'oMLLLLLLLLMo',
      'oMllllllllMo',
      'oDDDDGGDDDDo',
      'oooooGkooooo',
      'oMbbbGGbbbMo',
      'oMBBBBBBBBMo',
      'oMbbbbbbbbMo',
      'oMDDDDDDDDMo',
      '.oooooooooo.',
    ];
    const open = [
      '.oooooooooo.',
      'oMDllllllDMo',
      'oMLLLLLLLLMo',
      'oooooooooooo',
      'oyYyyyyYyyyo',
      'oMbbbGGbbbMo',
      'oMBBBBBBBBMo',
      'oMbbbbbbbbMo',
      'oMDDDDDDDDMo',
      '.oooooooooo.',
    ];
    this.chests = RARITIES.map((r, i) => {
      const pal = { L: r.light, l: r.color, D: r.dark, b: r.body, B: shade(r.body, -0.3), G: '#ffd040', k: '#2a1a08',
                    M: i >= 4 ? '#ffe9a0' : '#b8c0cc', y: r.light, Y: '#ffffff' };
      return { closed: detailPass(spriteFromRows(closed, pal), { grain: 0.05 }), open: detailPass(spriteFromRows(open, pal), { grain: 0.05 }) };
    });
  },

  // ---------- Resource nodes (procedural, seeded) ----------
  buildNodes() {
    const rng = makeRng(77);
    const make = (w, h, draw) => { const c = makeCanvas(w, h); draw(c.getContext('2d')); return addOutline(c); };

    this.nodes.tree = [0, 1, 2].map(v => make(18, 20, g => {
      g.fillStyle = '#4a3020'; g.fillRect(8, 12, 3, 7);
      g.fillStyle = '#6a4630'; g.fillRect(8, 12, 1, 7);
      g.fillStyle = '#2e1e14'; g.fillRect(10, 12, 1, 7);
      px(g, 7, 18, '#4a3020'); px(g, 11, 18, '#4a3020');   // roots
      const ramp = v === 2 ? ['#8a8a3a', '#5e6a2a', '#3a4a1e'] : ['#6a9a3e', '#46702c', '#2c4a1e'];
      shadedBlob(g, 9, 8, 7.5, 6.5, ramp, rng);
      shadedBlob(g, 6, 6, 3.5, 3, ramp, rng, 0.1);
      shadedBlob(g, 12, 9, 3, 2.5, ramp, rng, 0.1);
      // Leaf clusters catching the light, plus a few berries or blossoms.
      const hi = v === 2 ? '#b0b050' : '#8ac850';
      for (let i = 0; i < 9; i++) {
        const lx = 3 + Math.floor(rng() * 10), ly = 3 + Math.floor(rng() * 6);
        px(g, lx, ly, hi); if (rng() < 0.5) px(g, lx + 1, ly, hi);
      }
      for (let i = 0; i < 6; i++) px(g, 5 + Math.floor(rng() * 9), 9 + Math.floor(rng() * 4), ramp[2]);
      if (v === 1) [[5, 8], [11, 6], [13, 10]].forEach(([x, y]) => px(g, x, y, '#e04a5a'));
    }));
    this.nodes.deadtree = [0, 1].map(v => make(18, 20, g => {
      const c1 = '#5a4030', c2 = '#3a281c';
      g.fillStyle = c1; g.fillRect(8, 6, 2, 13);
      pxLine(g, 9, 10, 3 + v, 4, c1); pxLine(g, 9, 9, 15 - v, 3, c1);
      pxLine(g, 5, 6, 3, 1, c2); pxLine(g, 13, 5, 15, 1, c2); pxLine(g, 9, 6, 10, 1, c1);
    }));
    this.nodes.rock = [0, 1, 2].map(v => make(16, 14, g => {
      shadedBlob(g, 8, 8, 6.5 - v * 0.5, 5, ['#b4b4bc', '#82828e', '#56565f'], rng, 0.25);
      if (v === 1) shadedBlob(g, 4, 10, 2.5, 2, ['#b4b4bc', '#82828e', '#56565f'], rng, 0.1);
      pxLine(g, 6, 6, 9, 9, '#4a4a52'); pxLine(g, 9, 9, 11, 9, '#4a4a52');   // crack
      px(g, 5, 5, '#e0e0e8'); px(g, 6, 4, '#d0d0d8');                          // sheen
      if (v !== 1) { px(g, 4, 11, '#5a7a3a'); px(g, 5, 11, '#4a6a30'); px(g, 11, 11, '#5a7a3a'); }   // moss
      if (v === 2) { px(g, 10, 6, '#c8a050'); px(g, 11, 7, '#a88040'); }       // ore fleck
    }));
    this.nodes.scrap = [0, 1].map(v => make(16, 14, g => {
      const cols = ['#8a94a6', '#5a6478', '#b0b8c8', '#9aa4b6', '#9a5a3a'];
      for (let i = 0; i < 10; i++) {
        g.fillStyle = cols[Math.floor(rng() * cols.length)];
        g.fillRect(2 + Math.floor(rng() * 9), 4 + Math.floor(rng() * 6), 2 + Math.floor(rng() * 4), 2 + Math.floor(rng() * 2));
      }
      g.fillStyle = '#3ff0ff'; g.fillRect(6 + v * 3, 6, 2, 1);
    }));
    this.nodes.wreck = [0, 1].map(v => make(20, 14, g => {
      const body = v ? '#7a4a3a' : '#4a5a6a', dark = shade(body, -0.35), lite = shade(body, 0.3);
      g.fillStyle = body; g.fillRect(2, 5, 16, 6);
      g.fillStyle = lite; g.fillRect(2, 5, 16, 1);
      g.fillStyle = dark; g.fillRect(2, 10, 16, 1);
      g.fillStyle = '#2a3a4a'; g.fillRect(6, 2, 8, 3);
      g.fillStyle = '#6a9aba'; g.fillRect(7, 3, 2, 1);
      pxLine(g, 9, 2, 12, 4, '#9ac8e0');
      g.fillStyle = '#9a5a2a'; g.fillRect(4, 7, 3, 2); g.fillRect(12, 8, 2, 1);
      g.fillStyle = '#222'; g.fillRect(3, 11, 4, 2); g.fillRect(13, 11, 4, 2);
      g.fillStyle = '#ff3d4e'; g.fillRect(17, 6, 1, 2);
    }));
    // Advanced resource nodes found in special zones.
    const shard = (g, x, y, h, light, mid, dark) => {
      for (let i = 0; i < h; i++) {
        const half = Math.max(0, Math.round(Math.min(i, h - 1 - i) * 0.6));
        g.fillStyle = light; g.fillRect(x - half, y + i, half + 1, 1);
        g.fillStyle = mid; g.fillRect(x + 1, y + i, half, 1);
        if (i > h / 2) { g.fillStyle = dark; g.fillRect(x + half, y + i, 1, 1); }
      }
    };
    this.nodes.crystal = [0, 1].map(v => make(16, 16, g => {
      shadedBlob(g, 8, 13, 6, 2.5, ['#6a6676', '#4a4652', '#322e38'], rng, 0.1);
      shard(g, 7, 2 + v, 11, '#ffffff', '#9ff8ff', '#2a8aa8');
      shard(g, 4, 6, 7, '#e8ffff', '#7ae8f8', '#2a8aa8');
      shard(g, 11, 5 - v, 8, '#e8ffff', '#7ae8f8', '#2a8aa8');
    }));
    this.nodes.techdebris = [0, 1].map(v => make(16, 14, g => {
      g.fillStyle = '#4a5466'; g.fillRect(2, 5, 11, 6);
      g.fillStyle = '#6a7486'; g.fillRect(2, 5, 11, 1);
      g.fillStyle = '#2a3040'; g.fillRect(3 + v, 3, 6, 3);
      pxLine(g, 3, 8, 11, 8, '#3ff0ff'); pxLine(g, 6, 6, 6, 10, '#3ff0ff');
      px(g, 11, 6, '#ff3d4e'); px(g, 9, 9, '#9ff8ff');
      g.fillStyle = '#8a4a2a'; g.fillRect(12, 9, 2, 2);
    }));
    this.nodes.core = [make(16, 16, g => {
      g.fillStyle = '#3a4250'; g.fillRect(3, 11, 10, 3); g.fillRect(4, 6, 2, 6); g.fillRect(10, 6, 2, 6);
      g.fillStyle = '#5a6476'; g.fillRect(3, 11, 10, 1);
      shadedBlob(g, 8, 7, 3.5, 3.5, ['#ffd0ff', '#ff5cf0', '#a02a90'], rng, 0.05);
      px(g, 7, 5, '#ffffff');
    })];
    this.nodes.voidcrystal = [0, 1].map(v => make(16, 18, g => {
      shadedBlob(g, 8, 15, 6, 2.5, ['#4a3058', '#2e1a3a', '#1a0e22'], rng, 0.1);
      shard(g, 8, 1, 14, '#e8c8ff', '#b05cff', '#3a1460');
      shard(g, 4 + v, 7, 8, '#c8a0ff', '#8a3aff', '#3a1460');
      shard(g, 12, 6, 9, '#c8a0ff', '#8a3aff', '#3a1460');
    }));
    this.nodes.alienrock = [0, 1, 2].map(v => make(16, 14, g => {
      shadedBlob(g, 8, 8, 6.5 - v * 0.5, 5, ['#6a5078', '#4a3458', '#2e1e3a'], rng, 0.25);
      pxLine(g, 4, 9, 10, 6, '#c060ff'); px(g, 7, 8, '#ff9cf0');
    }));
    // Depleted versions
    this.nodes.tree_dead = [make(18, 20, g => {
      g.fillStyle = '#5a3a24'; g.fillRect(7, 14, 4, 3);
      g.fillStyle = '#c8a070'; g.fillRect(8, 14, 2, 1);
    })];
    this.nodes.deadtree_dead = this.nodes.tree_dead;
    this.nodes.rock_dead = [make(16, 14, g => {
      g.fillStyle = '#6a6a74'; g.fillRect(4, 10, 2, 2); g.fillRect(9, 11, 3, 2); g.fillRect(7, 8, 2, 1);
    })];
    this.nodes.scrap_dead = [make(16, 14, g => {
      g.fillStyle = '#5a6478'; g.fillRect(4, 10, 3, 1); g.fillRect(9, 11, 4, 1);
    })];
    this.nodes.crystal_dead = [make(16, 16, g => {
      g.fillStyle = '#4a4652'; g.fillRect(4, 12, 8, 2);
      g.fillStyle = '#4ac8e0'; g.fillRect(6, 10, 1, 2); g.fillRect(9, 11, 1, 1);
    })];
    this.nodes.techdebris_dead = this.nodes.scrap_dead;
    this.nodes.core_dead = [make(16, 16, g => {
      g.fillStyle = '#3a4250'; g.fillRect(3, 11, 10, 3); g.fillRect(4, 6, 2, 6); g.fillRect(10, 6, 2, 6);
    })];
    this.nodes.voidcrystal_dead = [make(16, 18, g => {
      g.fillStyle = '#2e1a3a'; g.fillRect(4, 14, 8, 2);
      g.fillStyle = '#8a3aff'; g.fillRect(7, 12, 1, 2);
    })];
    this.nodes.alienrock_dead = [make(16, 14, g => {
      g.fillStyle = '#4a3458'; g.fillRect(4, 10, 2, 2); g.fillRect(9, 11, 3, 2);
    })];
    this.nodes.wreck_dead = [make(20, 14, g => {
      g.fillStyle = '#2a2a2a'; g.fillRect(3, 8, 14, 4);
      g.fillStyle = '#4a4a4a'; g.fillRect(5, 9, 3, 1); g.fillRect(11, 10, 4, 1);
    })];
  },

  // ---------- Player-built defenses ----------
  buildStructures() {
    const make = draw => { const c = makeCanvas(16, 16); draw(c.getContext('2d')); return c; };

    this.structures.woodwall = make(g => {
      g.fillStyle = '#2a1a10'; g.fillRect(0, 0, 16, 16);
      for (let i = 0; i < 4; i++) {   // four planks with grain, knots and nails
        const x = i * 4, base = i % 2 ? '#8a5a30' : '#9a6a3a';
        g.fillStyle = base; g.fillRect(x, 1, 3, 14);
        g.fillStyle = shade(base, 0.25); g.fillRect(x, 1, 1, 14); g.fillRect(x, 1, 3, 1);
        g.fillStyle = shade(base, -0.25); g.fillRect(x + 2, 2, 1, 13);
        for (let y = 3 + i; y < 14; y += 4) px(g, x + 1, y, shade(base, -0.18));   // grain
        if (i === 1 || i === 2) { px(g, x + 1, 11 - i, '#5a3a1a'); px(g, x + 1, 12 - i, '#4a2a10'); }   // knot
        g.fillStyle = '#d8dce4'; g.fillRect(x + 1, 3, 1, 1); g.fillRect(x + 1, 12, 1, 1);
        px(g, x + 1, 4, '#6a6a70'); px(g, x + 1, 13, '#6a6a70');
      }
      g.fillStyle = '#5a3a20'; g.fillRect(0, 7, 16, 2);   // cross brace
      g.fillStyle = '#7a5230'; g.fillRect(0, 7, 16, 1);
      px(g, 2, 8, '#c8c8c8'); px(g, 13, 8, '#c8c8c8');
    });
    this.structures.stonewall = make(g => {
      g.fillStyle = '#2e2e36'; g.fillRect(0, 0, 16, 16);
      for (let row = 0; row < 4; row++) for (let col = -1; col < 3; col++) {
        const x = col * 8 + (row % 2 ? 4 : 0) + 1, y = row * 4 + 1;
        const base = (row * 3 + col) % 3 === 0 ? '#8a8a94' : (row + col) % 2 ? '#7e7e8a' : '#747480';
        g.fillStyle = base; g.fillRect(x, y, 6, 3);
        g.fillStyle = shade(base, 0.28); g.fillRect(x, y, 6, 1); g.fillRect(x, y, 1, 3);
        g.fillStyle = shade(base, -0.25); g.fillRect(x + 1, y + 2, 5, 1);
        if ((row + col) % 3 === 1) px(g, x + 3, y + 1, shade(base, -0.3));   // pits
      }
      px(g, 4, 6, '#4a7a3a'); px(g, 5, 6, '#5a8a3a'); px(g, 11, 14, '#4a7a3a');   // moss
      pxLine(g, 9, 2, 11, 4, '#4a4a54');   // crack
    });
    this.structures.metalwall = make(g => {
      g.fillStyle = '#20242c'; g.fillRect(0, 0, 16, 16);
      g.fillStyle = '#7a8496'; g.fillRect(1, 1, 14, 14);
      g.fillStyle = '#a8b2c4'; g.fillRect(1, 1, 14, 2); g.fillRect(1, 1, 1, 14);
      g.fillStyle = '#5a6476'; g.fillRect(1, 13, 14, 2); g.fillRect(14, 1, 1, 14);
      g.fillStyle = '#6a7486'; g.fillRect(3, 4, 10, 2); g.fillRect(3, 10, 10, 2);   // pressed panels
      g.fillStyle = '#8a94a6'; g.fillRect(3, 4, 10, 1); g.fillRect(3, 10, 10, 1);
      for (let i = 0; i < 4; i++) { g.fillStyle = i % 2 ? '#ffd040' : '#222'; g.fillRect(2 + i * 3, 7, 3, 2); }
      g.fillStyle = '#d8e0ec'; [[2, 2], [13, 2], [2, 13], [13, 13]].forEach(([x, y]) => g.fillRect(x, y, 1, 1));
      px(g, 3, 3, '#4a5466'); px(g, 12, 12, '#4a5466');
      px(g, 11, 4, '#3ff0ff');   // status light
    });
    this.structures.spikes = make(g => {
      g.fillStyle = '#2e2e30'; g.fillRect(1, 1, 14, 14);
      g.fillStyle = '#3e3e42'; g.fillRect(1, 1, 14, 1);
      g.fillStyle = '#1e1e20'; g.fillRect(1, 13, 14, 2);
      for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) {
        const bx = 2 + x * 5, by = 2 + y * 4;
        g.fillStyle = '#7a7e86'; g.fillRect(bx, by + 2, 3, 1);
        g.fillStyle = '#c8ccd4'; g.fillRect(bx + 1, by, 1, 3);
        px(g, bx + 1, by, '#ffffff');
        if ((x + y) % 3 === 0) px(g, bx + 1, by + 1, '#8a1a1a');   // blood on the tips
      }
    });
    this.structures.turret = make(g => {
      g.fillStyle = '#20242c'; g.fillRect(1, 2, 14, 13);
      g.fillStyle = '#4a5466'; g.fillRect(2, 3, 12, 11);
      g.fillStyle = '#6a7486'; g.fillRect(2, 3, 12, 2); g.fillRect(2, 3, 1, 11);
      g.fillStyle = '#3a4250'; g.fillRect(4, 6, 8, 6);   // turret ring
      g.fillStyle = '#2a2e38'; g.fillRect(5, 7, 6, 4);
      for (let i = 3; i < 13; i += 2) px(g, i, 13, '#2a2e38');   // vents
      g.fillStyle = '#ffd040'; g.fillRect(2, 12, 2, 2); g.fillRect(12, 12, 2, 2);
      px(g, 2, 12, '#222'); px(g, 13, 13, '#222');
      px(g, 12, 4, '#5aff8a');   // power LED
    });
    this.structures.anvil = make(g => {
      g.fillStyle = '#14161c'; g.fillRect(3, 10, 10, 5); g.fillRect(1, 3, 14, 6);
      g.fillStyle = '#4a5466'; g.fillRect(4, 11, 8, 3);
      g.fillStyle = '#5a6476'; g.fillRect(4, 11, 8, 1);
      g.fillStyle = '#6a7486'; g.fillRect(2, 4, 12, 4); g.fillRect(0, 4, 3, 2);
      g.fillStyle = '#a8b2c4'; g.fillRect(2, 4, 12, 1); g.fillRect(0, 4, 2, 1);
      g.fillStyle = '#4a5466'; g.fillRect(2, 7, 12, 1);
      g.fillStyle = '#3ff0ff'; g.fillRect(5, 6, 6, 1); g.fillRect(7, 12, 2, 1);
      px(g, 6, 6, '#c8ffff'); px(g, 9, 6, '#c8ffff');
      g.fillStyle = '#ffd040'; g.fillRect(4, 14, 8, 1);
      px(g, 5, 9, '#ff8a2a'); px(g, 10, 9, '#ff8a2a');   // glowing forge seams
      px(g, 12, 5, '#ffffff');
    });
    for (const k in this.structures) if (k !== 'spikes') detailPass(this.structures[k], { lit: 0.08, shadow: 0.1, grain: 0.05, seed: k.length });
    this.drone = (() => {
      const c = makeCanvas(7, 5), g = c.getContext('2d');
      g.fillStyle = '#14161c'; g.fillRect(0, 0, 7, 1); g.fillRect(0, 4, 7, 1);
      g.fillStyle = '#ffd040'; g.fillRect(1, 1, 5, 3);
      g.fillStyle = '#2a2418'; g.fillRect(3, 1, 1, 3);
      g.fillStyle = '#ff3d4e'; g.fillRect(5, 2, 1, 1);
      return c;
    })();
    this.turretBarrel = (() => {
      const c = makeCanvas(12, 6), g = c.getContext('2d');
      g.fillStyle = '#20242c'; g.fillRect(0, 0, 12, 6);
      g.fillStyle = '#9aa4b6'; g.fillRect(1, 1, 7, 4);
      g.fillStyle = '#c8d0dc'; g.fillRect(7, 2, 5, 2);
      g.fillStyle = '#3ff0ff'; g.fillRect(2, 2, 2, 2);
      return c;
    })();
  },

  // ---------- Tiny 3x5 bitmap font for in-world text ----------
  buildFont() {
    const glyphs = {
      A: '010101111101101', B: '110101110101110', C: '011100100100011', D: '110101101101110', E: '111100110100111',
      F: '111100110100100', G: '011100101101011', H: '101101111101101', I: '111010010010111', J: '001001001101010',
      K: '101101110101101', L: '100100100100111', M: '101111111101101', N: '110101101101101', O: '010101101101010',
      P: '110101110100100', Q: '010101101110011', R: '110101110101101', S: '011100010001110', T: '111010010010010',
      U: '101101101101111', V: '101101101101010', W: '101101111111101', X: '101101010101101', Y: '101101010010010',
      Z: '111001010100111', 0: '111101101101111', 1: '010110010010111', 2: '110001010100111', 3: '110001010001110',
      4: '101101111001001', 5: '111100110001110', 6: '011100110101010', 7: '111001010010010', 8: '010101010101010',
      9: '010101011001110', '+': '000010111010000', '-': '000000111000000', '!': '010010010000010', '?': '110001010000010',
      '.': '000000000000010', ':': '000010000010000', '/': '001001010100100', '%': '101001010100101', ' ': '000000000000000',
      '(': '010100100100010', ')': '010001001001010', '*': '000101010101000', '\u03A9': '010101101010111',
    };
    this.font = glyphs;
  },

  // Returns a cached canvas with the text rendered (1px drop shadow).
  text(str, color = '#ffffff') {
    const key = str + '|' + color;
    let c = this.textCache.get(key);
    if (c) return c;
    if (this.textCache.size > 400) this.textCache.clear();
    str = String(str).toUpperCase();
    c = makeCanvas(str.length * 4 + 1, 6);
    const g = c.getContext('2d');
    const drawPass = (ox, oy, col) => {
      g.fillStyle = col;
      for (let i = 0; i < str.length; i++) {
        const glyph = this.font[str[i]] || this.font['?'];
        for (let b = 0; b < 15; b++) if (glyph[b] === '1') g.fillRect(i * 4 + (b % 3) + ox, Math.floor(b / 3) + oy, 1, 1);
      }
    };
    drawPass(1, 1, '#000000');
    drawPass(0, 0, color);
    this.textCache.set(key, c);
    return c;
  },
};

// Lighten (amt > 0) or darken (amt < 0) a hex color.
function shade(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const f = v => clamp(Math.round(amt > 0 ? v + (255 - v) * amt : v * (1 + amt)), 0, 255);
  r = f(r); g = f(g); b = f(b);
  return '#' + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
}

// Icon -> data URL for HTML <img> (cached).
const iconUrlCache = {};
function iconUrl(kind, id, size) {
  // Weapons the player owns are shown with their skin and mods.
  // ('wbase' = always the plain weapon, e.g. on the class picker.)
  const p = Game.player, look = kind === 'weapon' && p && p.weapons && p.weapons[id] ? Weapons.look(p, WEAPON_BY_ID[id]) : null;
  const key = kind + ':' + id + ':' + (size === 'wide' ? 'w' : '') + (look ? ':' + look.key : '');
  if (iconUrlCache[key]) return iconUrlCache[key];
  const src = look ? look.img : kind === 'weapon' || kind === 'wbase' ? Sprites.weapons[id] : kind === 'struct' ? Sprites.structures[id]
    : kind === 'class' ? Sprites.playerFor(id).frames[0] : Sprites.icons[id];
  // size 'wide' = tight rectangle (menu weapon pictures); otherwise a padded square.
  const wide = size === 'wide';
  const cw = wide ? src.width : Math.max(size || 0, src.width + 2, src.height + 2);
  const ch = wide ? src.height : cw;
  const c = makeCanvas(cw, ch);
  const g = c.getContext('2d');
  g.drawImage(src, Math.floor((cw - src.width) / 2), Math.floor((ch - src.height) / 2));
  if (kind === 'struct' && id === 'turret') g.drawImage(Sprites.turretBarrel, Math.floor(cw / 2) - 2, Math.floor(ch / 2) - 3);
  return (iconUrlCache[key] = c.toDataURL());
}
