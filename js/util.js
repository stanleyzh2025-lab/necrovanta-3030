// ============================================================
// util.js - small math / random helpers shared by every module.
// ============================================================

// Seeded RNG (mulberry32) so the map is identical every run.
function makeRng(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rand = (min, max) => min + Math.random() * (max - min);
const randInt = (min, max) => Math.floor(min + Math.random() * (max - min + 1));
const pick = arr => arr[Math.floor(Math.random() * arr.length)];
const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
const lerp = (a, b, t) => a + (b - a) * t;
const dist2 = (ax, ay, bx, by) => (ax - bx) * (ax - bx) + (ay - by) * (ay - by);
const dist = (ax, ay, bx, by) => Math.sqrt(dist2(ax, ay, bx, by));

function angleDiff(a, b) {
  let d = a - b;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return d;
}

function weightedPick(weights) {
  let total = 0;
  for (const w of weights) total += w;
  let r = Math.random() * total;
  for (let i = 0; i < weights.length; i++) {
    r -= weights[i];
    if (r <= 0) return i;
  }
  return weights.length - 1;
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Inventory cost helpers: cost objects look like { wood: 4, metal: 2 }.
function canAfford(inv, cost) {
  for (const k in cost) if ((inv[k] || 0) < cost[k]) return false;
  return true;
}
function payCost(inv, cost) {
  for (const k in cost) inv[k] -= cost[k];
}
// Display name for any inventory key (materials, ammo, healing items).
function itemName(k) {
  if (MATERIALS[k]) return MATERIALS[k].name;
  if (AMMO[k]) return AMMO[k].name;
  if (HEAL_ITEMS[k]) return HEAL_ITEMS[k].name;
  return k;
}
function costText(cost) {
  return Object.entries(cost).map(([k, v]) => `${v} ${itemName(k).toUpperCase()}`).join(' + ');
}

const toTile = px => Math.floor(px / TILE);

// Deterministic integer hash of two coordinates (used for chunk seeds).
function hash2(x, y, seed) {
  let h = (seed ^ Math.imul(x, 374761393) ^ Math.imul(y, 668265263)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return (h ^ (h >>> 16)) >>> 0;
}

// Random integer inside a [min, max] range array.
const rollRange = r => randInt(r[0], r[1]);

function formatTime(sec) {
  sec = Math.floor(sec);
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  const mm = String(m).padStart(2, '0'), ss = String(s).padStart(2, '0');
  return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`;
}

// The single shared game state object. Modules read and write it directly.
const Game = {
  state: 'title',     // title | classpick | lobby | room | playing | dead | gameover | victory
  phase: 'break',     // break | wave
  paused: false,
  menuOpen: false,
  buildMode: false,
  wave: 0,
  breakTimer: 0,
  kills: 0,
  score: 0,
  time: 0,
  player: null,
  others: [],         // online: teammates to draw (stand-ins on the host, copies from the host on guests)
  zombies: [],
  bullets: [],
  enemyShots: [],
  drops: [],
  chests: [],
  hazards: [],
  structures: [],
  groundWeapons: [],  // thrown / overflow weapons lying in the world (press E to pick up)
  ambient: 0.4,       // darkness of the night overlay (0 = full daylight)
  drones: [],         // Hive Protocol nanodrones
  fields: [],         // gravity sphere / time-slow fields
  camera: { x: 0, y: 0, shake: 0 },
  viewW: 480,
  viewH: 270,
  scale: 3,
  checkpoint: null,
};
