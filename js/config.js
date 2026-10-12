// ============================================================
// config.js - all tunable game data lives here.
// Add new weapons, zombies, chests or recipes by editing these tables.
// ============================================================

const TILE = 16;            // pixels per tile
const CHUNK = 24;           // tiles per world chunk side (one city block + its roads)
const CHUNK_PX = CHUNK * TILE;
const FLOW_RADIUS = 36;     // tiles around the player covered by zombie pathfinding
const MAX_WAVE = 100;
const BREAK_TIME = 20;      // seconds between waves
const FIRST_BREAK = 15;     // prep time before wave 1
const MAX_LEVEL = 10;       // max weapon upgrade level
const HOTBAR_SIZE = 9;
// Weapon bag: holds every weapon you own (materials and ammo don't use slots).
// It starts small; upgrade it from the BAG menu, or throw weapons away to make room.
const BAG_MAX = 30;
const BAG_LEVELS = [
  { slots: 10 },
  { slots: 14, cost: { metal: 20, wood: 15 } },
  { slots: 18, cost: { metal: 35, wood: 20, techshard: 2 } },
  { slots: 22, cost: { metal: 50, wood: 25, techshard: 5 } },
  { slots: 26, cost: { metal: 70, wood: 30, techshard: 8, diamond: 2 } },
  { slots: 30, cost: { metal: 100, wood: 40, techshard: 12, diamond: 4, plasmacore: 1 } },
];
const ANVIL_RANGE = 44;     // px: how close you must stand to an anvil to forge/upgrade
const MAP_SEED = 3026;      // same seed = same world every run (kept so old saves match)

const PLAYER_BASE = {
  hp: 100,
  speed: 80,          // px per second
  radius: 5,
  invuln: 0.35,       // seconds of invulnerability after a hit
  breakRegen: 4,      // hp per second regenerated during breaks
};

// ---------- Rarities (chests and weapons share these) ----------
const RARITIES = [
  { id: 'common',    name: 'COMMON',    color: '#c8c8c8', light: '#ffffff', dark: '#5a5a5a', body: '#6a4a2a', score: 10 },
  { id: 'uncommon',  name: 'UNCOMMON',  color: '#4fd34f', light: '#b0ffb0', dark: '#1f6e2a', body: '#5a3a20', score: 25 },
  { id: 'rare',      name: 'RARE',      color: '#3fa0ff', light: '#b0dcff', dark: '#1a4a8a', body: '#2a3050', score: 50 },
  { id: 'epic',      name: 'EPIC',      color: '#b05cff', light: '#e0b8ff', dark: '#55208a', body: '#2a1a40', score: 100 },
  { id: 'legendary', name: 'LEGENDARY', color: '#ffb52e', light: '#fff0a0', dark: '#8a5a10', body: '#3a2a10', score: 200 },
  { id: 'mythic',    name: 'MYTHIC',    color: '#ff3d6e', light: '#ffc0d0', dark: '#8a1035', body: '#2a0a18', score: 500 },
];

// ---------- Materials and ammo ----------
const MATERIALS = {
  wood:        { name: 'Wood',         color: '#e0b880' },
  stone:       { name: 'Stone',        color: '#c8c8d0' },
  metal:       { name: 'Metal',        color: '#b0b8c8' },
  techshard:   { name: 'Tech Shard',   color: '#3ff0ff' },
  diamond:     { name: 'Diamond',      color: '#9ff8ff' },
  plasmacore:  { name: 'Plasma Core',  color: '#ff5cf0' },
  voidcrystal: { name: 'Void Crystal', color: '#b05cff' },
  modkit:      { name: 'Mod Kit',      color: '#ff9cf0' },   // rare: Titans drop them; upgrades mods to Mk II / Mk III
};
// Guns use one ammo type each. Rarer guns use rarer ammo.
const AMMO = {
  cells:      { name: 'Energy Cells',      short: 'CELLS',      color: '#3ff0ff' },
  plasma:     { name: 'Plasma Cartridges', short: 'PLASMA',     color: '#ff5cf0' },
  quantum:    { name: 'Quantum Cores',     short: 'QUANTUM',    color: '#ffd040' },
  antimatter: { name: 'Antimatter Rounds', short: 'ANTIMATTER', color: '#b05cff' },
};

// ---------- Weapons ----------
// Shared:  id, name, kind ('gun' | 'knife'), rarity 0-5, dmg, cd (seconds between attacks),
//          shape (sprite archetype), body/accent/color/glow (palette), sfx (sound layers),
//          ability (shown in menus) + ability-specific numbers used in weapons.js.
// Guns:    ammo (AMMO key, or null = unlimited reserve), mag, reload, speed, range, size, proj (visual).
// Knives:  reach (px), arc (radians), style ('stab' | 'slash' | 'claw' | 'heavy').
// sfx layers: ['t', wave, freq, slideTo, dur, vol, delay] tone | ['n', filter, freq, dur, vol, delay] noise
const WEAPONS = [
  // ===== COMMON GUNS =====
  { id: 'nova', name: 'Nova Spark', kind: 'gun', rarity: 0, dmg: 12, cd: 0.17, ammo: null, mag: 24, reload: 1.0,
    speed: 300, range: 230, size: 2, proj: 'spark', shape: 'pistol', slowEvery: 6,
    body: '#c8d0e0', accent: '#3a4a6a', color: '#5ff4ff', glow: '#ffffff',
    sfx: [['t', 'square', 1200, 500, 0.06, 0.07]],
    ability: 'Every 6th hit slows the zombie.', desc: 'Starter sidearm with unlimited reserve ammo.' },
  { id: 'ion', name: 'Ion Flicker', kind: 'gun', rarity: 0, dmg: 7, cd: 0.07, ammo: 'cells', mag: 40, reload: 1.3,
    speed: 340, range: 200, size: 1, proj: 'ion', spread: 0.08, shape: 'smg', stunChance: 0.08,
    body: '#5a6070', accent: '#ffd040', color: '#fff27a', glow: '#ffffff',
    sfx: [['t', 'square', 2400, 1500, 0.03, 0.045], ['n', 'highpass', 7000, 0.02, 0.03]],
    ability: 'Very rapid fire. 8% chance to stun.', desc: 'Spits a stream of charged ions.' },
  { id: 'scrap', name: 'Scrapcaster MK1', kind: 'gun', rarity: 0, dmg: 20, cd: 0.5, ammo: 'cells', mag: 6, reload: 1.7,
    speed: 260, range: 150, size: 2, proj: 'slug', pellets: 3, spread: 0.22, kb: 240, shape: 'shotgun',
    body: '#7a5a40', accent: '#9aa4b6', color: '#ffb060', glow: '#ffe0a0',
    sfx: [['t', 'square', 160, 55, 0.14, 0.12], ['n', 'lowpass', 1500, 0.14, 0.2]],
    ability: 'Fires 3 scrap slugs that knock zombies back.', desc: 'Junkyard shotgun. 20 damage per slug.' },
  { id: 'echo', name: 'Echo Beam', kind: 'gun', rarity: 0, dmg: 15, cd: 0.24, ammo: 'cells', mag: 20, reload: 1.2,
    speed: 320, range: 230, size: 2, proj: 'echo', shape: 'blaster', pulseEvery: 5,
    body: '#4a6a7a', accent: '#2a3a4a', color: '#7affd8', glow: '#e0fff8',
    sfx: [['t', 'sine', 880, 1320, 0.09, 0.09], ['t', 'triangle', 440, 660, 0.09, 0.05]],
    ability: 'Every 5th shot fires an extra piercing pulse.', desc: 'Resonant beam emitter.' },

  // ===== UNCOMMON GUNS =====
  { id: 'venom', name: 'Venom Pulse', kind: 'gun', rarity: 1, dmg: 19, cd: 0.21, ammo: 'cells', mag: 18, reload: 1.3,
    speed: 250, range: 230, size: 3, proj: 'venom', shape: 'pistol', poisonDps: 5, poisonTime: 3,
    body: '#3c5a30', accent: '#1e2e18', color: '#7dff3a', glow: '#d8ff9a',
    sfx: [['t', 'sawtooth', 320, 140, 0.09, 0.08], ['n', 'bandpass', 1200, 0.05, 0.04]],
    ability: 'Poisons for 5 damage per second for 3s.', desc: 'Toxic pulse pistol.' },
  { id: 'sonic', name: 'Sonic Breaker', kind: 'gun', rarity: 1, dmg: 25, cd: 0.5, ammo: 'cells', mag: 10, reload: 1.5,
    speed: 220, range: 170, size: 7, proj: 'wave', pierce: 4, kb: 210, shape: 'horn',
    body: '#6a5a8a', accent: '#2a2a3a', color: '#c8a0ff', glow: '#ffffff',
    sfx: [['t', 'sine', 150, 70, 0.25, 0.16], ['n', 'bandpass', 600, 0.2, 0.08]],
    ability: 'Sound wave pierces 4 zombies and pushes them back.', desc: 'Concussive sound cannon.' },
  { id: 'needle', name: 'Star Needle', kind: 'gun', rarity: 1, dmg: 65, cd: 0.95, ammo: 'cells', mag: 5, reload: 1.8,
    speed: 560, range: 380, size: 1, proj: 'needle', pierce: 1, shape: 'sniper', critChance: 0.3,
    body: '#d0d8e8', accent: '#3a3a50', color: '#ffe27a', glow: '#ffffff',
    sfx: [['t', 'square', 2600, 800, 0.12, 0.08], ['n', 'highpass', 6000, 0.05, 0.1]],
    ability: '30% weak-point hits deal double damage.', desc: 'Long-range star-metal sniper.' },

  // ===== RARE GUNS =====
  { id: 'prism', name: 'Prism Splitter', kind: 'gun', rarity: 2, dmg: 28, cd: 0.32, ammo: 'plasma', mag: 16, reload: 1.5,
    speed: 360, range: 250, size: 2, proj: 'prism', shape: 'prism', splitDmg: 10,
    body: '#e0e4f0', accent: '#5a4a8a', color: '#ff8af0', glow: '#a0fff8',
    sfx: [['t', 'triangle', 1500, 2400, 0.08, 0.08], ['t', 'sine', 1900, 2800, 0.06, 0.05, 0.03]],
    ability: 'On hit splits into 3 extra 10-damage beams.', desc: 'Crystal-focused light rifle.' },
  { id: 'antigrav', name: 'Anti-Gravity MK4', kind: 'gun', rarity: 2, dmg: 35, cd: 0.5, ammo: 'plasma', mag: 10, reload: 1.6,
    speed: 260, range: 230, size: 3, proj: 'grav', shape: 'gravgun', liftTime: 1.2,
    body: '#3a4a6a', accent: '#9aa4b6', color: '#8ab8ff', glow: '#e0f0ff',
    sfx: [['t', 'sine', 300, 900, 0.16, 0.1], ['t', 'sine', 600, 1800, 0.12, 0.04]],
    ability: 'Lifts zombies into the air: they cannot move or attack.', desc: 'Gravity inverter.' },
  { id: 'hive', name: 'Hive Protocol', kind: 'gun', rarity: 2, dmg: 8, cd: 0.55, ammo: 'plasma', mag: 8, reload: 1.8,
    speed: 150, range: 400, size: 2, proj: 'drone', shape: 'launcher', droneHits: 6, droneLife: 5,
    body: '#5a5030', accent: '#2a2418', color: '#ffd040', glow: '#fff0a0',
    sfx: [['t', 'square', 600, 900, 0.05, 0.06], ['t', 'square', 1200, 1000, 0.05, 0.04, 0.05]],
    ability: 'Launches a homing nanodrone that strikes 6 times for 8 each.', desc: 'Swarm launcher.' },
  { id: 'glacier', name: 'Glacier Burst', kind: 'gun', rarity: 2, dmg: 55, cd: 0.65, ammo: 'plasma', mag: 8, reload: 1.6,
    speed: 220, range: 220, size: 3, proj: 'ice', aoe: 22, shape: 'cannon', freezeTime: 1.0,
    body: '#4a7aa0', accent: '#2a4a6a', color: '#9fe8ff', glow: '#ffffff',
    sfx: [['t', 'triangle', 1600, 700, 0.12, 0.14], ['n', 'highpass', 4000, 0.08, 0.06]],
    ability: 'Ice burst freezes zombies solid for 1s.', desc: 'Cryogenic burst cannon.' },

  // ===== EPIC GUNS =====
  { id: 'redshift', name: 'Redshift Accelerator', kind: 'gun', rarity: 3, dmg: 30, cd: 0.3, ammo: 'plasma', mag: 30, reload: 1.9,
    speed: 380, range: 250, size: 2, proj: 'redshift', shape: 'smg', maxStacks: 10,
    body: '#5a2a2a', accent: '#2a1a1a', color: '#ff4a3a', glow: '#ffd0a0',
    sfx: [['t', 'sawtooth', 700, 300, 0.06, 0.07]],
    ability: 'Fire rate climbs with every consecutive hit (up to 2.5x).', desc: 'Doppler-shift accelerator.' },
  { id: 'vortex', name: 'Vortex Cyclone', kind: 'gun', rarity: 3, dmg: 45, cd: 0.9, ammo: 'plasma', mag: 6, reload: 2.0,
    speed: 115, range: 200, size: 7, proj: 'cyclone', pierce: 99, shape: 'cyclone', pull: 95, pullRadius: 52,
    body: '#2a5a5a', accent: '#1a2a2a', color: '#5affd0', glow: '#e0fff8',
    sfx: [['t', 'sawtooth', 90, 260, 0.4, 0.08], ['n', 'bandpass', 800, 0.4, 0.1]],
    ability: 'Slow cyclone pulls zombies together, hitting each for 45.', desc: 'Storm generator.' },
  { id: 'rift', name: 'Rift Jumper', kind: 'gun', rarity: 3, dmg: 40, cd: 0.32, ammo: 'plasma', mag: 14, reload: 1.6,
    speed: 330, range: 250, size: 2, proj: 'rift', shape: 'pistol', blink: 95, altCd: 3,
    body: '#3a2050', accent: '#1a0a2a', color: '#c060ff', glow: '#ffb0ff',
    sfx: [['t', 'square', 500, 1500, 0.1, 0.07], ['t', 'sine', 250, 750, 0.1, 0.05]],
    ability: 'RIGHT-CLICK: teleport a short distance (3s cooldown).', desc: 'Spatial rift pistol.' },
  { id: 'magma', name: 'Magma Nova', kind: 'gun', rarity: 3, dmg: 70, cd: 0.8, ammo: 'plasma', mag: 6, reload: 2.0,
    speed: 200, range: 220, size: 4, proj: 'magma', aoe: 30, shape: 'launcher', fieldDps: 15, fieldTime: 3,
    body: '#5a2a1a', accent: '#2a1410', color: '#ff7a1a', glow: '#ffe060',
    sfx: [['t', 'square', 180, 60, 0.18, 0.1], ['n', 'lowpass', 900, 0.15, 0.12]],
    ability: 'Explodes and leaves a thermal field (15 dmg/s).', desc: 'Molten core launcher.' },

  // ===== LEGENDARY GUNS =====
  { id: 'aurora', name: 'Aurora Obliterator', kind: 'gun', rarity: 4, dmg: 150, cd: 1.1, ammo: 'quantum', mag: 4, reload: 2.4,
    range: 330, size: 4, proj: 'beam', hitscan: true, shape: 'beam',
    body: '#3a2a5a', accent: '#1a1030', color: '#ff5cf0', glow: '#9cfff0',
    sfx: [['t', 'square', 500, 1800, 0.2, 0.08], ['t', 'sawtooth', 250, 900, 0.25, 0.06], ['n', 'highpass', 3000, 0.15, 0.06]],
    ability: 'Instant beam that pierces every zombie in its path.', desc: 'Prismatic annihilation beam.' },
  { id: 'chrono', name: 'Chrono Shatter', kind: 'gun', rarity: 4, dmg: 85, cd: 0.85, ammo: 'quantum', mag: 6, reload: 2.2,
    speed: 300, range: 260, size: 3, proj: 'chrono', aoe: 26, shape: 'cannon', fieldRadius: 62, fieldTime: 3,
    body: '#c8b070', accent: '#3a3020', color: '#ffe08a', glow: '#9ff8ff',
    sfx: [['t', 'triangle', 1000, 250, 0.3, 0.1], ['t', 'square', 1500, 1500, 0.08, 0.04, 0.1], ['t', 'square', 1500, 1500, 0.08, 0.04, 0.2]],
    ability: '85 damage burst that slows all nearby zombies to a crawl for 3s.', desc: 'Temporal fracture cannon.' },
  { id: 'supernova', name: 'Supernova Protocol', kind: 'gun', rarity: 4, dmg: 100, cd: 1.6, ammo: 'quantum', mag: 3, reload: 2.6,
    speed: 240, range: 210, size: 10, proj: 'shockwave', pierce: 99, shape: 'nova', waves: 3,
    body: '#e0c8a0', accent: '#5a3a1a', color: '#ffb040', glow: '#ffffff',
    sfx: [['t', 'sawtooth', 200, 50, 0.5, 0.14], ['n', 'lowpass', 900, 0.4, 0.2], ['t', 'square', 400, 100, 0.3, 0.06, 0.12]],
    ability: 'Releases 3 energy shockwaves, 100 damage each.', desc: 'Stellar detonation protocol.' },

  // ===== MYTHIC GUNS =====
  { id: 'horizon', name: 'Event Horizon X', kind: 'gun', rarity: 5, dmg: 240, cd: 1.8, ammo: 'antimatter', mag: 2, reload: 3.0,
    speed: 230, range: 260, size: 4, proj: 'horizon', aoe: 24, shape: 'gravgun', singularity: { r: 85, life: 2.6, dps: 20, pull: 130 },
    body: '#1a1428', accent: '#5a2a8a', color: '#b05cff', glow: '#ffffff',
    sfx: [['t', 'sine', 70, 30, 0.7, 0.22], ['t', 'square', 800, 200, 0.3, 0.06], ['n', 'lowpass', 400, 0.6, 0.15]],
    ability: 'Creates a gravity sphere that pulls zombies in and crushes them.', desc: 'Pocket black hole projector.' },
  { id: 'genesis', name: 'Genesis Ω', kind: 'gun', rarity: 5, dmg: 180, pulseDmg: 70, cd: 0.4, charge: 0.55, ammo: 'antimatter', mag: 8, reload: 2.8,
    speed: 330, range: 300, size: 4, proj: 'genesis', aoe: 24, shape: 'beam', altCd: 20, domeTime: 5,
    body: '#e8e8f4', accent: '#8a7a3a', color: '#fff27a', glow: '#ffffff',
    sfx: [['t', 'square', 900, 200, 0.16, 0.09], ['t', 'triangle', 1350, 300, 0.12, 0.07, 0.02]],
    ability: 'TAP: 70 dmg pulse. HOLD: 180 dmg beam. RIGHT-CLICK: energy dome (20s cooldown).', desc: 'Creation engine.' },

  // ===== MORE GUNS (second arsenal) =====
  { id: 'flare', name: 'Flare Pistol', kind: 'gun', rarity: 0, dmg: 14, cd: 0.45, ammo: 'cells', mag: 8, reload: 1.3,
    speed: 230, range: 220, size: 2, proj: 'flare', shape: 'flare', flareTime: 8, burnDps: 3,
    body: '#b84a2a', accent: '#3a2a2a', color: '#ff6a3a', glow: '#ffe0a0',
    sfx: [['t', 'square', 600, 200, 0.12, 0.08], ['n', 'bandpass', 2000, 0.25, 0.08]],
    ability: 'Flares burn zombies and light up the dark for 8s.', desc: 'Emergency signal pistol.' },
  { id: 'ricochet', name: 'Ricochet Rifle', kind: 'gun', rarity: 1, dmg: 30, cd: 0.4, ammo: 'cells', mag: 12, reload: 1.6,
    speed: 360, range: 420, size: 2, proj: 'ricochet', bounces: 3, shape: 'sniper',
    body: '#5a6a50', accent: '#2a3020', color: '#c8ff8a', glow: '#ffffff',
    sfx: [['t', 'square', 900, 1600, 0.06, 0.07], ['n', 'highpass', 4000, 0.06, 0.07]],
    ability: 'Rounds bounce off walls up to 3 times.', desc: 'Trick-shot carbine.' },
  { id: 'arcthrower', name: 'Arc Thrower', kind: 'gun', rarity: 2, dmg: 18, cd: 0.28, ammo: 'plasma', mag: 20, reload: 1.7,
    range: 130, proj: 'arc', chains: 4, shape: 'blaster',
    body: '#3a4a7a', accent: '#1a2a4a', color: '#8ad8ff', glow: '#ffffff',
    sfx: [['n', 'highpass', 5000, 0.1, 0.1], ['t', 'sawtooth', 1800, 600, 0.08, 0.05]],
    ability: 'Lightning chains between up to 4 zombies.', desc: 'Tesla coil projector.' },
  { id: 'gatling', name: 'Gatling Volt', kind: 'gun', rarity: 3, dmg: 9, cd: 0.2, minCd: 0.045, spinUp: 1.4, ammo: 'plasma', mag: 120, reload: 2.6,
    speed: 380, range: 240, size: 1, proj: 'ion', spread: 0.1, shape: 'gatling',
    body: '#4a4a3a', accent: '#ffd040', color: '#fff27a', glow: '#ffffff',
    sfx: [['t', 'square', 1500, 900, 0.035, 0.04], ['n', 'highpass', 6000, 0.02, 0.03]],
    ability: 'Spins up while firing: reaches 20+ shots per second.', desc: 'Rotary volt cannon.' },
  { id: 'mortar', name: 'Nebula Mortar', kind: 'gun', rarity: 3, dmg: 45, cd: 1.0, ammo: 'plasma', mag: 4, reload: 2.2,
    speed: 200, range: 260, size: 3, proj: 'shell', aoe: 60, shape: 'mortar',
    body: '#3a2a5a', accent: '#7a5aaa', color: '#d08aff', glow: '#ffffff',
    sfx: [['t', 'sine', 200, 90, 0.2, 0.16], ['n', 'lowpass', 600, 0.2, 0.12]],
    ability: 'Lobs shells over walls onto the cursor (60px blast that knocks zombies up).', desc: 'Orbital-grade mortar.' },
  { id: 'photon', name: 'Photon Lance', kind: 'gun', rarity: 4, dmg: 320, cd: 0.6, charge: 0.85, ammo: 'quantum', mag: 3, reload: 2.5,
    range: 420, proj: 'rail', shape: 'rail',
    body: '#d8e0f0', accent: '#3a4a6a', color: '#7affff', glow: '#ffffff',
    sfx: [['t', 'square', 200, 2400, 0.25, 0.08], ['n', 'highpass', 2000, 0.3, 0.1], ['t', 'sine', 90, 40, 0.3, 0.15]],
    ability: 'HOLD to charge, then it fires a rail that pierces zombies AND walls.', desc: 'Photonic railgun.' },
  { id: 'seraph', name: 'Seraph Swarm', kind: 'gun', rarity: 5, dmg: 120, cd: 1.6, ammo: 'antimatter', mag: 2, reload: 3.0,
    speed: 150, range: 700, size: 2, proj: 'missile', aoe: 22, missiles: 5, shape: 'pod',
    body: '#e8e0c8', accent: '#c8a040', color: '#ffd040', glow: '#ffffff',
    sfx: [['n', 'bandpass', 1200, 0.4, 0.14], ['t', 'sawtooth', 300, 900, 0.3, 0.06]],
    ability: 'Launches 5 seeker missiles at different targets (120 each).', desc: 'Angelic missile pod.' },

  // ===== THIRD ARSENAL: NECROVANTA ERA GUNS =====
  { id: 'revolver', name: 'Pulse Revolver', kind: 'gun', rarity: 0, dmg: 22, cd: 0.32, ammo: 'cells', mag: 6, reload: 1.6,
    speed: 380, range: 260, size: 2, proj: 'spark', lastRoundCrit: true,
    body: '#6a6a7a', accent: '#c8a040', color: '#ffb84a', glow: '#fff0c0',
    ability: 'The last round in the cylinder deals double damage.', desc: 'Six-shot energy wheelgun.' },
  { id: 'shardsmg', name: 'Shard SMG', kind: 'gun', rarity: 1, dmg: 11, cd: 0.09, ammo: 'cells', mag: 32, reload: 1.5,
    speed: 340, range: 210, size: 1, proj: 'shard', spread: 0.06, shards: 2,
    body: '#3a5a6a', accent: '#9ae8ff', color: '#9ae8ff', glow: '#ffffff',
    ability: 'Rounds shatter into 2 crystal shards on hit.', desc: 'Crystal-fragment submachine gun.' },
  { id: 'scatter', name: 'Plasma Scatter', kind: 'gun', rarity: 2, dmg: 14, cd: 0.7, ammo: 'plasma', mag: 6, reload: 1.9,
    speed: 280, range: 140, size: 2, proj: 'plasmaball', pellets: 6, spread: 0.45, burnDps: 6, kb: 120,
    body: '#3a2a4a', accent: '#ff7a3a', color: '#ff7aff', glow: '#ffe0ff',
    ability: '6 plasma pellets that set zombies ablaze.', desc: 'Plasma shotgun.' },
  { id: 'crossbow', name: 'Hex Crossbow', kind: 'gun', rarity: 2, dmg: 75, cd: 0.9, ammo: 'plasma', mag: 5, reload: 1.8,
    speed: 420, range: 380, size: 1, proj: 'bolt', pierce: 3, pinTime: 1.2,
    body: '#2a3a2a', accent: '#8aff5a', color: '#8aff5a', glow: '#ffffff',
    ability: 'Bolts pierce 3 zombies and pin the last one in place.', desc: 'Hex-runed repeating crossbow.' },
  { id: 'spike', name: 'Railspike Carbine', kind: 'gun', rarity: 3, dmg: 30, cd: 0.38, ammo: 'plasma', mag: 10, reload: 2.0,
    speed: 360, range: 260, size: 2, proj: 'spike', stickDmg: 60, fuse: 1.0,
    body: '#4a4a52', accent: '#ff3d4e', color: '#ff5a5a', glow: '#ffd0d0',
    ability: 'Spikes stick into zombies and explode 1s later (60 dmg).', desc: 'Sticky-charge carbine.' },
  { id: 'inferno', name: 'Inferno Sprayer', kind: 'gun', rarity: 3, dmg: 7, cd: 0.05, ammo: 'plasma', mag: 80, reload: 2.4,
    speed: 170, range: 95, size: 4, proj: 'flame', pierce: 3, spread: 0.22, burnDps: 10, kb: 5,
    body: '#5a3a2a', accent: '#ffb020', color: '#ff7a1a', glow: '#fff0a0',
    ability: 'Continuous cone of fire that burns everything in it.', desc: 'Thermal flamethrower.' },
  { id: 'starfall', name: 'Starfall Launcher', kind: 'gun', rarity: 4, dmg: 90, cd: 1.5, ammo: 'quantum', mag: 3, reload: 2.6,
    speed: 300, range: 280, size: 3, proj: 'beacon', meteors: 6, meteorAoe: 26,
    body: '#1a2a4a', accent: '#ffd040', color: '#8ab8ff', glow: '#ffffff',
    ability: 'Marks a target: 6 meteors rain down around it (90 each).', desc: 'Orbital strike designator.' },
  { id: 'necrovanta', name: 'NECROVANTA \u03A9', kind: 'gun', rarity: 5, dmg: 200, cd: 1.2, ammo: 'antimatter', mag: 3, reload: 3.0,
    speed: 190, range: 300, size: 4, proj: 'soul', burstR: 32, pierce: 99, souls: 8, soulDmg: 60, drain: 0.1,
    body: '#14101e', accent: '#3aff8a', color: '#3aff8a', glow: '#e0ffe8',
    ability: 'A soul orb that drains life as it flies, then bursts into 8 hunting souls.', desc: 'The weapon this era is named after.' },

  // ===== KNIVES =====
  { id: 'fang', name: 'Titanium Fang', kind: 'knife', rarity: 0, dmg: 25, cd: 0.28, reach: 22, arc: 1.5, style: 'stab', shape: 'dagger',
    body: '#8a90a8', accent: '#4a3a30', color: '#d8dce8', glow: '#ffffff',
    sfx: [['n', 'highpass', 2600, 0.07, 0.12], ['t', 'square', 320, 160, 0.05, 0.04]],
    ability: 'Fast stabs. Gathers resources.', desc: 'Titanium combat knife.' },
  { id: 'plasma', name: 'Plasma Edge', kind: 'knife', rarity: 1, dmg: 40, cd: 0.32, reach: 26, arc: 1.9, style: 'slash', shape: 'sword', burnDps: 8, burnTime: 2,
    body: '#2a5a7a', accent: '#1a2a3a', color: '#3ff0ff', glow: '#c8ffff',
    sfx: [['n', 'bandpass', 3000, 0.09, 0.1], ['t', 'sawtooth', 600, 200, 0.1, 0.05]],
    ability: 'Plasma scorches for 8 damage per second.', desc: 'Superheated plasma sword.' },
  { id: 'shockfang', name: 'Shockfang', kind: 'knife', rarity: 1, dmg: 45, cd: 0.38, reach: 24, arc: 1.7, style: 'slash', shape: 'shock', stunChance: 0.25,
    body: '#4a4a5a', accent: '#2a2a3a', color: '#fff060', glow: '#ffffff',
    sfx: [['n', 'highpass', 5000, 0.1, 0.1], ['t', 'square', 1800, 300, 0.08, 0.05]],
    ability: '25% chance to stun with an electric arc.', desc: 'Electrified serrated blade.' },
  { id: 'cryo', name: 'Cryo Dagger', kind: 'knife', rarity: 2, dmg: 55, cd: 0.3, reach: 20, arc: 1.3, style: 'stab', shape: 'dagger', freezeChance: 0.3,
    body: '#4a7aa0', accent: '#2a3a5a', color: '#9fe8ff', glow: '#ffffff',
    sfx: [['n', 'highpass', 4500, 0.08, 0.1], ['t', 'triangle', 1800, 900, 0.08, 0.06]],
    ability: 'Chills on hit; 30% chance to freeze solid.', desc: 'Sub-zero crystal dagger.' },
  { id: 'shadow', name: 'Shadow Piercer', kind: 'knife', rarity: 2, dmg: 65, cd: 0.42, reach: 28, arc: 1.4, style: 'stab', shape: 'dagger',
    stealthTime: 2,
    body: '#1a1a24', accent: '#3a2a5a', color: '#7a5aff', glow: '#c8b8ff',
    sfx: [['n', 'bandpass', 1200, 0.1, 0.08], ['t', 'sine', 200, 90, 0.12, 0.06]],
    ability: 'Double damage from stealth (2s without attacking) or from behind.', desc: 'Assassin\'s phase blade.' },
  { id: 'viper', name: 'Neon Viper', kind: 'knife', rarity: 3, dmg: 85, cd: 0.36, reach: 28, arc: 1.9, style: 'slash', shape: 'sword', arcDmg: 30,
    body: '#1a3a2a', accent: '#ff5cf0', color: '#5aff8a', glow: '#ff9cf0',
    sfx: [['n', 'bandpass', 2200, 0.09, 0.1], ['t', 'square', 900, 1400, 0.07, 0.05]],
    ability: 'Every 3rd strike launches a 30-damage energy arc.', desc: 'Neon serpent blade.' },
  { id: 'quantum', name: 'Quantum Claw', kind: 'knife', rarity: 3, dmg: 100, cd: 0.45, reach: 26, arc: 2.0, style: 'claw', shape: 'claw', blink: 95, altCd: 2.5,
    body: '#2a2a4a', accent: '#5a5a8a', color: '#5ac8ff', glow: '#ffffff',
    sfx: [['n', 'highpass', 3500, 0.07, 0.1], ['n', 'highpass', 3000, 0.07, 0.08, 0.05], ['t', 'sine', 1200, 2400, 0.06, 0.04]],
    ability: 'RIGHT-CLICK: teleport strike (2.5s cooldown).', desc: 'Phase-shifting claws.' },
  { id: 'solar', name: 'Solar Fang', kind: 'knife', rarity: 4, dmg: 140, cd: 0.55, reach: 30, arc: 2.0, style: 'slash', shape: 'sword', burnDps: 20, burnTime: 3,
    body: '#8a5a10', accent: '#4a2a08', color: '#ffb020', glow: '#fff0a0',
    sfx: [['n', 'lowpass', 1800, 0.14, 0.14], ['t', 'sawtooth', 300, 120, 0.15, 0.07]],
    ability: 'Burning energy deals 20 damage per second.', desc: 'Forged in a dying star.' },
  { id: 'void', name: 'Void Shredder', kind: 'knife', rarity: 5, dmg: 200, cd: 0.62, reach: 32, arc: 2.1, style: 'claw', shape: 'claw',
    gravPulse: { every: 2, r: 55, dmg: 40 },
    body: '#14101e', accent: '#5a2a8a', color: '#8a3aff', glow: '#ff5cf0',
    sfx: [['n', 'bandpass', 700, 0.16, 0.14], ['t', 'sine', 90, 40, 0.2, 0.12]],
    ability: 'Every 2nd hit releases a gravity pulse (pulls in, 40 dmg).', desc: 'Tears holes in reality.' },
  { id: 'oblivion', name: 'Oblivion Blade Ω', kind: 'knife', rarity: 5, dmg: 300, cd: 0.8, reach: 38, arc: 2.4, style: 'heavy', shape: 'greatsword',
    shockwave: { dmg: 150, r: 85 }, altCd: 8,
    body: '#1a0a2a', accent: '#5a2a8a', color: '#b05cff', glow: '#ff5cf0',
    sfx: [['n', 'bandpass', 900, 0.18, 0.16], ['t', 'sawtooth', 120, 40, 0.25, 0.1]],
    ability: 'RIGHT-CLICK when charged: 150-damage shockwave (8s charge).', desc: 'Void greatsword. Erases anything.' },
  { id: 'hammer', name: 'Scrap Hammer', kind: 'knife', rarity: 1, dmg: 60, cd: 0.6, reach: 26, arc: 1.8, style: 'heavy', shape: 'hammer', stunTime: 0.5,
    body: '#7a6a5a', accent: '#4a3a2a', color: '#d0a060', glow: '#fff0c0',
    sfx: [['n', 'lowpass', 800, 0.15, 0.18], ['t', 'sine', 120, 50, 0.15, 0.14]],
    ability: 'Heavy smash that stuns and knocks zombies flying.', desc: 'Rebar and an engine block.' },
  { id: 'whip', name: 'Chain Whip', kind: 'knife', rarity: 2, dmg: 45, cd: 0.42, reach: 50, arc: 0.7, style: 'whip', shape: 'whip',
    body: '#5a5a6a', accent: '#3a3a4a', color: '#c8d0ff', glow: '#ffffff',
    sfx: [['n', 'highpass', 3000, 0.12, 0.1], ['t', 'square', 1400, 700, 0.05, 0.04, 0.08]],
    ability: 'Long-reach lash that hits everything in a line.', desc: 'Monofilament chain.' },
  { id: 'reaver', name: 'Blood Reaver', kind: 'knife', rarity: 3, dmg: 95, cd: 0.42, reach: 28, arc: 2.0, style: 'slash', shape: 'axe', lifesteal: 0.15,
    body: '#3a0a14', accent: '#8a1a2a', color: '#ff2a4a', glow: '#ffb0c0',
    sfx: [['n', 'bandpass', 1400, 0.12, 0.12], ['t', 'sawtooth', 200, 80, 0.12, 0.06]],
    ability: 'Heals you for 15% of the damage it deals.', desc: 'Hungry crimson axe.' },
  { id: 'glaive', name: 'Storm Glaive', kind: 'knife', rarity: 4, dmg: 160, cd: 0.55, reach: 40, arc: 1.1, style: 'stab', shape: 'spear', strike: 60,
    body: '#2a3a5a', accent: '#ffd040', color: '#8ad8ff', glow: '#ffffff',
    sfx: [['n', 'highpass', 4500, 0.1, 0.12], ['t', 'square', 1200, 400, 0.1, 0.06]],
    ability: 'Each hit calls down lightning (60 dmg, chains to 2 more).', desc: 'Thunder spear.' },

  // ===== BALISONGS, KARAMBITS AND MORE =====
  { id: 'streetbali', name: 'Street Balisong', kind: 'knife', rarity: 0, dmg: 18, cd: 0.2, reach: 20, arc: 1.4, style: 'flip', shape: 'balisong', comboEvery: 4,
    body: '#6a6a74', accent: '#2a2a30', color: '#d8dce8', glow: '#ffffff',
    ability: 'Lightning-fast flips: every 4th strike hits twice.', desc: 'Butterfly knife from the old city.' },
  { id: 'hookkara', name: 'Hook Karambit', kind: 'knife', rarity: 0, dmg: 22, cd: 0.26, reach: 21, arc: 1.7, style: 'hook', shape: 'karambit', bleedDps: 4,
    body: '#3a3a40', accent: '#8a6a4a', color: '#c8ccd8', glow: '#ffffff',
    ability: 'Hooked strikes cause bleeding (4 dmg/s).', desc: 'Curved claw blade.' },
  { id: 'kunai', name: 'Ion Kunai', kind: 'knife', rarity: 1, dmg: 32, cd: 0.3, reach: 22, arc: 1.3, style: 'stab', shape: 'kunai', throwDmg: 45, altCd: 1.2,
    body: '#2a3a5a', accent: '#3ff0ff', color: '#7affff', glow: '#ffffff',
    ability: 'RIGHT-CLICK: throw an ion kunai (45 dmg, 1.2s cooldown).', desc: 'Balanced throwing blade.' },
  { id: 'neonbali', name: 'Neon Balisong', kind: 'knife', rarity: 1, dmg: 34, cd: 0.22, reach: 22, arc: 1.5, style: 'flip', shape: 'balisong', comboEvery: 4, bleedDps: 4,
    body: '#ff3db0', accent: '#1a1a2a', color: '#ff5cf0', glow: '#ffe0ff',
    ability: 'Fast flips, double hit every 4th strike, neon cuts bleed.', desc: 'Glowing butterfly knife.' },
  { id: 'ripper', name: 'Ripper Chainsword', kind: 'knife', rarity: 2, dmg: 16, cd: 0.11, reach: 27, arc: 1.4, style: 'saw', shape: 'chainsword',
    body: '#5a5a3a', accent: '#ffd040', color: '#e8e0c8', glow: '#ffffff',
    ability: 'Buzzing chain teeth shred 9 times a second.', desc: 'Motorized chain blade.' },
  { id: 'venomkara', name: 'Venom Karambit', kind: 'knife', rarity: 2, dmg: 50, cd: 0.3, reach: 22, arc: 1.8, style: 'hook', shape: 'karambit', poisonDps: 8, hookPull: 10,
    body: '#1a2a1a', accent: '#7dff3a', color: '#7dff3a', glow: '#e0ffc0',
    ability: 'Poisons and hooks zombies toward you.', desc: 'Toxin-channel karambit.' },
  { id: 'phantombali', name: 'Phantom Balisong', kind: 'knife', rarity: 3, dmg: 75, cd: 0.24, reach: 24, arc: 1.6, style: 'flip', shape: 'balisong', comboEvery: 4, echo: 0.4,
    body: '#c8d8f0', accent: '#3a2a5a', color: '#9ab8ff', glow: '#ffffff',
    ability: 'Every strike echoes a ghost strike for 40% more.', desc: 'Half in this world, half not.' },
  { id: 'katana', name: 'Plasma Katana', kind: 'knife', rarity: 3, dmg: 110, cd: 0.5, reach: 38, arc: 1.8, style: 'slash', shape: 'katana', dash: 75, altCd: 3,
    body: '#1a1a24', accent: '#c83a3a', color: '#ff3a5a', glow: '#ffd0d8',
    ability: 'RIGHT-CLICK: dash-slash through everything in front (3s cooldown).', desc: 'Superheated monomolecular katana.' },
  { id: 'eclipsekara', name: 'Eclipse Karambit', kind: 'knife', rarity: 4, dmg: 120, cd: 0.32, reach: 24, arc: 1.9, style: 'hook', shape: 'karambit', spinEvery: 3, spinReach: 36,
    body: '#1a1424', accent: '#ffb020', color: '#ffb020', glow: '#fff0c0',
    ability: 'Every 3rd strike is a 360-degree spin slash.', desc: 'Forged during a black sun.' },
  { id: 'sickle', name: 'Gravity Sickle', kind: 'knife', rarity: 4, dmg: 170, cd: 0.6, reach: 36, arc: 2.8, style: 'heavy', shape: 'sickle', pull: 16,
    body: '#2a2a4a', accent: '#8ab8ff', color: '#8ab8ff', glow: '#ffffff',
    ability: 'A wide reaping arc that drags zombies inward.', desc: 'Gravity-warped crescent.' },
  { id: 'voidbali', name: 'Singularity Balisong', kind: 'knife', rarity: 5, dmg: 180, cd: 0.26, reach: 26, arc: 1.7, style: 'flip', shape: 'balisong', comboEvery: 3, markBurst: 5, markDmg: 300,
    body: '#0e0816', accent: '#b05cff', color: '#b05cff', glow: '#ff9cf0',
    ability: 'Strikes mark zombies; 5 marks collapse them in a 300-dmg singularity.', desc: 'Each flip tears space.' },
  { id: 'scythe', name: 'Nebula Scythe', kind: 'knife', rarity: 5, dmg: 260, cd: 0.85, reach: 46, arc: 3.0, style: 'heavy', shape: 'scythe', lifesteal: 0.1, nebula: 2.5,
    body: '#1a0e2a', accent: '#ff5cf0', color: '#c88aff', glow: '#ffffff',
    ability: 'Huge reaping arc that heals you 10% and leaves slowing nebula clouds.', desc: 'Harvester of dead stars.' },
];
const WEAPON_BY_ID = Object.fromEntries(WEAPONS.map((w, i) => [w.id, Object.assign(w, { index: i, sfx: w.sfx || [] })]));
const WEAPONS_BY_RARITY = RARITIES.map((_, r) => WEAPONS.filter(w => w.rarity === r));

// ---------- Survivor classes (picked when starting a new game) ----------
// stats change the defaults in Classes.defaults (classes.js); start is the starting kit;
// suit/accent/visor recolor the survivor sprite.
const CLASSES = [
  { id: 'survivor', name: 'Survivor', color: '#3ff0ff', suit: '#3a4a7a', accent: '#ff8a2a', visor: '#3ff0ff',
    tag: 'Balanced all-rounder',
    perks: ['No weaknesses, no tricks', 'Starts with a Med Kit and 20 extra Energy Cells'],
    start: { weapons: ['nova', 'fang'], inv: { medkit: 1, cells: 20 } }, stats: {} },
  { id: 'bladedancer', name: 'Blade Dancer', color: '#ff5cf0', suit: '#4a1a4a', accent: '#ff5cf0', visor: '#ff9cf0',
    tag: 'Melee combos',
    perks: ['Starts with a Street Balisong', 'COMBO: every melee hit within 1.5s adds +5% melee damage (up to +50%)', '15% faster melee attacks'],
    start: { weapons: ['streetbali', 'nova'] }, stats: { meleeSpeed: 0.85, combo: 0.05 } },
  { id: 'gunslinger', name: 'Gunslinger', color: '#ffb84a', suit: '#5a3a1a', accent: '#c8a040', visor: '#ffd040',
    tag: 'Fast reloads',
    perks: ['Starts with a Pulse Revolver', '40% faster reloads', 'QUICKDRAW: the first shot after a reload deals +60% damage'],
    start: { weapons: ['revolver', 'nova', 'fang'], inv: { cells: 40 } }, stats: { reload: 0.6, quickdraw: 0.6 } },
  { id: 'marksman', name: 'Marksman', color: '#9ae8ff', suit: '#2a3a3a', accent: '#5aff8a', visor: '#9ae8ff',
    tag: 'Long-range crits',
    perks: ['Starts with a Holo Scope on the Nova Spark', '+25% gun range', '+10% gun crit chance (x2 damage)'],
    start: { weapons: ['nova', 'fang'], mods: { nova: { optic: 'scope' } } }, stats: { gunRange: 1.25, gunCrit: 0.1 } },
  { id: 'engineer', name: 'Engineer', color: '#ffd040', suit: '#4a4a2a', accent: '#ffd040', visor: '#5aff8a',
    tag: 'Builds fortresses',
    perks: ['Structures cost 30% less', 'Walls, traps and turrets have +60% HP', 'Turrets fire 40% faster', 'Starts with 25 metal and 20 stone'],
    start: { weapons: ['nova', 'fang'], inv: { metal: 25, stone: 20, wood: 10 } }, stats: { buildCost: 0.7, structHp: 1.6, turretRate: 1.4 } },
  { id: 'medic', name: 'Medic', color: '#5fe05f', suit: '#e8e8f0', accent: '#e03040', visor: '#5fe05f',
    tag: 'Heals and regenerates',
    perks: ['Healing items heal 60% more', 'Regenerates 2 HP/s after 4s without taking damage', 'Starts with 3 Med Kits'],
    start: { weapons: ['nova', 'fang'], inv: { medkit: 3 } }, stats: { heal: 1.6, regen: 2 } },
  { id: 'scavenger', name: 'Scavenger', color: '#c8a070', suit: '#4a3a2a', accent: '#7aa05a', visor: '#ffb84a',
    tag: 'Finds more loot',
    perks: ['+50% materials from gathering and chests', 'Chests are 50% more likely to hold a weapon', 'Starts with a 14-slot bag'],
    start: { weapons: ['nova', 'fang'], bagLevel: 1 }, stats: { loot: 1.5, chestWeapon: 1.5 } },
  { id: 'bulwark', name: 'Bulwark', color: '#a8b2c4', suit: '#5a6476', accent: '#ffd040', visor: '#ff3d4e',
    tag: 'Walking tank',
    perks: ['+50 max HP and 20% less damage taken', 'SPIKED ARMOR: zombies that hit you take 15 damage and get knocked back', '10% slower'],
    start: { weapons: ['nova', 'hammer'] }, stats: { hp: 50, armor: 0.8, speed: 0.9, thorns: 15 } },
  { id: 'pyro', name: 'Pyro', color: '#ff7a1a', suit: '#5a2a1a', accent: '#ffb020', visor: '#ff7a1a',
    tag: 'Everything burns',
    perks: ['Starts with a Flare Pistol', 'Burn damage +60%', 'Immune to burning'],
    start: { weapons: ['flare', 'nova', 'fang'], inv: { cells: 30 } }, stats: { burn: 1.6, burnImmune: true } },
  { id: 'technomancer', name: 'Technomancer', color: '#7affff', suit: '#1a2a4a', accent: '#3ff0ff', visor: '#ffffff',
    tag: 'Ability spam',
    perks: ['Starts with an Ion Kunai', 'Weapon abilities recharge 40% faster', 'Starts with 6 Tech Shards'],
    start: { weapons: ['kunai', 'nova'], inv: { techshard: 6 } }, stats: { abilityCd: 0.6 } },
];
const CLASS_BY_ID = Object.fromEntries(CLASSES.map(c => [c.id, c]));

// ---------- Weapon mods (attached at a Tech Anvil, MODS tab) ----------
// Every weapon has three mod slots; attaching a mod replaces whatever was in that slot.
const MOD_SLOTS = {
  gun:   [['optic', 'OPTIC'], ['mag', 'MAGAZINE'], ['core', 'ELEMENTAL CORE']],
  knife: [['edge', 'EDGE'], ['grip', 'GRIP'], ['core', 'ELEMENTAL CORE']],
};
const modPct = v => Math.round(v * 100) + '%';
// mk holds each mod's stats at Mk I, Mk II and Mk III; text(stats) describes them.
const MODS = {
  scope:      { slot: 'optic', name: 'Holo Scope',    color: '#3ff0ff', cost: { metal: 10, techshard: 2 },
                mk: [{ range: 0.35, speed: 0.2, spread: 0.6, crit: 0.1 }, { range: 0.5, speed: 0.3, spread: 0.45, crit: 0.15 }, { range: 0.7, speed: 0.4, spread: 0.3, crit: 0.22 }],
                text: s => `+${modPct(s.range)} range, +${modPct(s.speed)} shot speed, ${modPct(1 - s.spread)} less spread, ${modPct(s.crit)} crit chance (x2).` },
  extmag:     { slot: 'mag',   name: 'Extended Mag',  color: '#ffd040', cost: { metal: 14, stone: 6 },
                mk: [{ mag: 0.5, reload: 0.2 }, { mag: 0.8, reload: 0.3 }, { mag: 1.2, reload: 0.4 }],
                text: s => `+${modPct(s.mag)} magazine size and ${modPct(s.reload)} faster reloads.` },
  monoedge:   { slot: 'edge',  name: 'Mono Edge',     color: '#ffffff', cost: { metal: 10, diamond: 1 },
                mk: [{ reach: 0.25, crit: 0.1 }, { reach: 0.35, crit: 0.15 }, { reach: 0.5, crit: 0.22 }],
                text: s => `+${modPct(s.reach)} reach and a ${modPct(s.crit)} crit chance (x2).` },
  balgrip:    { slot: 'grip',  name: 'Balanced Grip', color: '#ffd040', cost: { wood: 8, metal: 8 },
                mk: [{ haste: 0.18 }, { haste: 0.26 }, { haste: 0.35 }],
                text: s => `${modPct(s.haste)} faster attacks.` },
  core_fire:  { slot: 'core',  name: 'Inferno Core',  color: '#ff7a1a', cost: { metal: 8, plasmacore: 1 },
                mk: [{ dot: 0.15 }, { dot: 0.22 }, { dot: 0.3 }],
                text: s => `Hits set zombies on fire (${modPct(s.dot)} of the hit per second for 2s).` },
  core_cryo:  { slot: 'core',  name: 'Cryo Core',     color: '#9fe8ff', cost: { metal: 8, diamond: 2 },
                mk: [{ freeze: 0.08 }, { freeze: 0.13 }, { freeze: 0.2 }],
                text: s => `Hits slow zombies, with a ${modPct(s.freeze)} chance to freeze them.` },
  core_shock: { slot: 'core',  name: 'Tesla Core',    color: '#fff060', cost: { metal: 8, techshard: 4 },
                mk: [{ chance: 0.15, arc: 0.5 }, { chance: 0.22, arc: 0.65 }, { chance: 0.3, arc: 0.8 }],
                text: s => `${modPct(s.chance)} chance to stun and arc to a nearby zombie for ${modPct(s.arc)} damage.` },
  core_toxic: { slot: 'core',  name: 'Toxin Core',    color: '#7dff3a', cost: { metal: 8, stone: 10, techshard: 2 },
                mk: [{ dot: 0.1 }, { dot: 0.15 }, { dot: 0.2 }],
                text: s => `Hits poison zombies (${modPct(s.dot)} of the hit per second for 3s).` },
  core_void:  { slot: 'core',  name: 'Void Core',     color: '#b05cff', cost: { metal: 12, voidcrystal: 1 },
                mk: [{ leech: 0.04 }, { leech: 0.06 }, { leech: 0.08 }],
                text: s => `Heals you for ${modPct(s.leech)} of the damage you deal.` },
};
const MOD_MAX_TIER = 3;
const MK_NAMES = ['', 'MK I', 'MK II', 'MK III'];
const MODKIT_TITAN_DROP = 1;   // mod kits per Titan (the Omega Titan drops 3)
// Mods cost more on rarer weapons.
function modCost(mod, w) {
  const c = {};
  for (const k in mod.cost) c[k] = Math.ceil(mod.cost[k] * (1 + w.rarity * 0.5));
  return c;
}
// Upgrading an attached mod to Mk II / Mk III: more materials plus rare Mod Kits.
function modTierCost(mod, w, tier) {
  const c = modCost(mod, w);
  for (const k in c) c[k] *= tier;
  c.modkit = tier - 1;
  return c;
}

// ---------- Weapon skins (found in chests, switched any time in the MODS tab) ----------
// pal overrides the weapon's colors when its sprite is rebuilt; shot = [bullet color, glow].
const SKINS = {
  gold:  { name: 'Gold',  color: '#ffd040', weight: 3, shot: ['#ffd040', '#fff6c8'],
           pal: { body: '#d8a830', accent: '#8a5a14', metal: ['#c8963a', '#ffe9a0', '#7a5414', '#3a2808'], dark: ['#3a2a14', '#5a4420', '#1e1408'],
                  blade: '#ffcc40', edge: '#fff6c8' } },
  neon:  { name: 'Neon',  color: '#ff3df0', weight: 3, shot: ['#ff3df0', '#3ff0ff'],
           pal: { body: '#16141f', accent: '#ff2bd6', color: '#3ff0ff', glow: '#e0ffff', metal: ['#2e2a40', '#ff5cf0', '#1a1626', '#0c0a12'],
                  dark: ['#0c0c14', '#2a2a40', '#050508'], blade: '#1e1a2e', edge: '#3ff0ff' } },
  frost: { name: 'Frost', color: '#9fe8ff', weight: 2, shot: ['#9fe8ff', '#ffffff'],
           pal: { body: '#c8e8f8', accent: '#4a8ab8', color: '#9fe8ff', glow: '#ffffff', metal: ['#a8c8e0', '#ffffff', '#6a8aa8', '#2a3a52'],
                  dark: ['#2a3a52', '#4a6a8a', '#16202e'], blade: '#c8f0ff', edge: '#ffffff' } },
  blood: { name: 'Blood', color: '#ff2a3a', weight: 2, shot: ['#ff2a3a', '#ffb0b8'],
           pal: { body: '#5a0a14', accent: '#1a0408', color: '#ff2a3a', glow: '#ffb0b8', metal: ['#8a2a32', '#e06a72', '#4a0a12', '#200408'],
                  dark: ['#200408', '#3a0a12', '#100204'], blade: '#a8101e', edge: '#ff8a94' } },
  void:  { name: 'Void',  color: '#b05cff', weight: 1, shot: ['#b05cff', '#ff9cf0'],
           pal: { body: '#14101e', accent: '#5a2a8a', color: '#b05cff', glow: '#ff9cf0', metal: ['#3a2a52', '#8a6ab8', '#24183a', '#0e0816'],
                  dark: ['#0a0610', '#2a1a3a', '#050308'], blade: '#2a1a40', edge: '#ff9cf0' } },
};
// Chance a chest holds a skin, by rarity: mythic chests always do, legendary ones sometimes.
const SKIN_CHANCE = [0, 0, 0, 0, 0.15, 1];

// +10% base damage per upgrade level (level 1 = base, level 10 = +90%).
function levelDamageMult(lvl) { return 1 + 0.1 * (lvl - 1); }

// Upgrading from lvl to lvl+1 at an anvil. Higher levels and rarities need advanced materials.
function upgradeCost(w, lvl) {
  const r = w.rarity, c = { metal: (5 + r * 5) * lvl, stone: (2 + r * 2) * lvl };
  if (lvl >= 4) c.techshard = Math.ceil((r + 1) * (lvl - 3) / 2);
  if (lvl >= 6) c.diamond = Math.ceil((r + 1) * (lvl - 5) / 3);
  if (r >= 3 && lvl >= 5) c.plasmacore = Math.ceil((r - 2) * (lvl - 4) / 3);
  if (r >= 5 && lvl >= 7) c.voidcrystal = lvl - 6;
  return c;
}

// Forging a weapon from scratch at an anvil, by rarity. Knives swap some metal for wood/stone.
function weaponRecipe(w) {
  const base = [
    { metal: 14, stone: 6, wood: 4 },
    { metal: 22, stone: 8, techshard: 2 },
    { metal: 32, techshard: 5, diamond: 2 },
    { metal: 45, techshard: 9, diamond: 4, plasmacore: 1 },
    { metal: 65, techshard: 14, diamond: 8, plasmacore: 3 },
    { metal: 90, techshard: 20, diamond: 12, plasmacore: 5, voidcrystal: 3 },
  ][w.rarity];
  const c = { ...base };
  if (w.kind === 'knife') { c.metal = Math.round(c.metal * 0.7); c.wood = (c.wood || 0) + 6; }
  return c;
}

// ---------- Zombies ----------
// intro = first wave the type can appear. weight ramps up from intro.
// colors: k skin, h head top, c clothes, C clothes shade, p pants, e eyes, x detail.
const ZOMBIE_TYPES = {
  normal:   { name: 'Zombie',          hp: 30,  speed: 26, dmg: 8,  r: 5, score: 10,  intro: 1,  weight: [10, 4, -0.08],
    colors: { k: '#7aa05a', h: '#7aa05a', c: '#6a5a8a', C: '#4a3f63', p: '#3a3a50', e: '#ff2020', x: '#4a3f63' } },
  armored:  { name: 'Armored Zombie',  hp: 85,  speed: 21, dmg: 11, r: 5, score: 25,  intro: 4,  weight: [2, 6, 0.3], armor: 0.35,
    colors: { k: '#6a8a50', h: '#9aa0ae', c: '#8a8f9a', C: '#5a5f6a', p: '#4a4a55', e: '#ff3030', x: '#d0d8e0' } },
  fast:     { name: 'Fast Zombie',     hp: 22,  speed: 52, dmg: 6,  r: 4.5, score: 20, intro: 8,  weight: [2, 6, 0.3],
    colors: { k: '#b0b080', h: '#b0b080', c: '#9a2a2a', C: '#6a1a1a', p: '#2a2a30', e: '#ffff40', x: '#6a1a1a' } },
  fire:     { name: 'Fire Zombie',     hp: 48,  speed: 30, dmg: 9,  r: 5, score: 30,  intro: 14, weight: [2, 5, 0.25], burns: true, deathBlast: 'fire',
    immune: 'burn', particle: '#ffaa20',
    colors: { k: '#8a4a2a', h: '#6a3018', c: '#2a1a1a', C: '#1a0a0a', p: '#2a1a14', e: '#ffdd00', x: '#ffaa20' } },
  toxic:    { name: 'Toxic Zombie',    hp: 55,  speed: 27, dmg: 8,  r: 5, score: 30,  intro: 20, weight: [2, 5, 0.25], poisons: true, deathBlast: 'toxic',
    immune: 'poison', particle: '#b0ff40',
    colors: { k: '#7acc3a', h: '#7acc3a', c: '#4a6a2a', C: '#2f4a1a', p: '#33402a', e: '#e0ff00', x: '#c8ff60' } },
  electric: { name: 'Electric Zombie', hp: 60,  speed: 34, dmg: 10, r: 5, score: 40,  intro: 28, weight: [2, 4, 0.2], zaps: true,
    immune: 'stun', particle: '#fff060',
    colors: { k: '#6a7a9a', h: '#8a9aba', c: '#2a2a4a', C: '#1a1a30', p: '#22223a', e: '#ffffff', x: '#fff060' } },
  cyber:    { name: 'Cyber Zombie',    hp: 130, speed: 30, dmg: 12, r: 5, score: 60,  intro: 36, weight: [2, 4, 0.2], armor: 0.2, shoots: true,
    colors: { k: '#8a8a9a', h: '#5a5a6a', c: '#3a3a4a', C: '#25252f', p: '#2a2a35', e: '#ff0040', x: '#ff2040' } },
  freezing: { name: 'Freezing Zombie', hp: 95,  speed: 28, dmg: 10, r: 5, score: 50,  intro: 45, weight: [2, 4, 0.2], freezes: true,
    immune: 'slow', particle: '#d8f4ff',
    colors: { k: '#a0d0f0', h: '#d0ecff', c: '#4a7aa0', C: '#30587a', p: '#2a4a6a', e: '#40e0ff', x: '#ffffff' } },
  titan:    { name: 'TITAN',           hp: 900, speed: 17, dmg: 26, r: 10, score: 400, intro: 55, weight: [0, 0.5, 0.02], scale: 2,
    structMult: 4, slams: true, kbImmune: true, boss: true,
    colors: { k: '#5a7a40', h: '#4a6a30', c: '#4a3a2a', C: '#2f2418', p: '#2a2a2a', e: '#ff4000', x: '#8a2020' } },

  // ----- second wave of mutations -----
  crawler:  { name: 'Crawler',         hp: 20,  speed: 20, dmg: 6,  r: 4, hy: 1, score: 12,  intro: 6,  weight: [3, 5, 0.3], groan: 0.7,
    colors: { k: '#8a9a6a', h: '#8a9a6a', c: '#5a4a3a', C: '#3a2e24', p: '#3a3a40', e: '#ff4030', x: '#3a2e24' } },
  spitter:  { name: 'Spitter',         hp: 40,  speed: 24, dmg: 9,  r: 5, score: 30,  intro: 11, weight: [2, 4, 0.2], spits: true, keepAway: 95,
    colors: { k: '#9ab04a', h: '#9ab04a', c: '#5a6a2a', C: '#3a4a1a', p: '#3a3a30', e: '#e8ff40', x: '#c8ff40' } },
  bloater:  { name: 'Bloater',         hp: 90,  speed: 17, dmg: 10, r: 6.5, score: 35, intro: 17, weight: [2, 3.5, 0.2], explodes: true, groan: 0.6,
    colors: { k: '#a0905a', h: '#a0905a', c: '#7a6a3a', C: '#5a4a2a', p: '#3a3a30', e: '#ff3020', x: '#d8c070' } },
  riot:     { name: 'Riot Zombie',     hp: 80,  speed: 24, dmg: 11, r: 5, score: 45,  intro: 24, weight: [2, 4, 0.2], shield: 0.25,
    colors: { k: '#7a8a6a', h: '#2a2e3a', c: '#2a3040', C: '#1a1e2a', p: '#22262e', e: '#ff3030', x: '#3ff0ff' } },
  phantom:  { name: 'Phantom',         hp: 45,  speed: 32, dmg: 10, r: 5, score: 45,  intro: 32, weight: [2, 4, 0.2], phases: true, groan: 1.6,
    colors: { k: '#c8d8e8', h: '#e8f0ff', c: '#8a9ab8', C: '#6a7a98', p: '#5a6a88', e: '#7affff', x: '#ffffff' } },
  necro:    { name: 'Necromancer',     hp: 110, speed: 22, dmg: 9,  r: 5, score: 70,  intro: 41, weight: [1, 2, 0.1], summons: true, keepAway: 120,
    colors: { k: '#8a8a7a', h: '#2a1a3a', c: '#3a1a4a', C: '#24102e', p: '#24102e', e: '#c060ff', x: '#c060ff' } },
  brute:    { name: 'Brute',           hp: 320, speed: 22, dmg: 22, r: 7, score: 120, intro: 50, weight: [1, 2.5, 0.1], charges: true, kbImmune: true,
    bulky: true, structMult: 3, groan: 0.5,
    colors: { k: '#7a5a4a', h: '#5a3a2a', c: '#4a2a2a', C: '#2e1a1a', p: '#2a2020', e: '#ff6a00', x: '#a83020' } },
  leech:    { name: 'Leech Swarm',     hp: 12,  speed: 62, dmg: 4,  r: 3.5, hy: 2, score: 8, intro: 60, weight: [2, 4, 0.2], drains: true, group: 4, groan: 2,
    colors: { k: '#8a2a4a', h: '#8a2a4a', c: '#5a1a2a', C: '#3a0a1a', p: '#3a0a1a', e: '#ffff60', x: '#ff6a8a' } },
  juggernaut: { name: 'Juggernaut',    hp: 420, speed: 18, dmg: 18, r: 7, score: 150, intro: 68, weight: [1, 2, 0.08], armor: 0.5, kbImmune: true,
    ccResist: 0.5, rockets: true, bulky: true, structMult: 3, groan: 0.5,
    colors: { k: '#7a7a8a', h: '#4a5466', c: '#5a6476', C: '#3a4250', p: '#2a2e38', e: '#ff3040', x: '#ffd040' } },
  wraith:   { name: 'Void Wraith',     hp: 90,  speed: 30, dmg: 14, r: 5, score: 80,  intro: 78, weight: [1.5, 3, 0.15], teleports: true, groan: 1.4,
    colors: { k: '#3a2a4a', h: '#1a0e24', c: '#1a0e24', C: '#0e0616', p: '#0e0616', e: '#ff5cf0', x: '#b05cff' } },
  omega:    { name: 'OMEGA TITAN',     hp: 7000, speed: 14, dmg: 40, r: 15, hy: 16, score: 5000, intro: 100, weight: [0, 0, 0], scale: 3,
    boss: true, final: true, kbImmune: true, slams: true, structMult: 6, groan: 0.35,
    colors: { k: '#4a3a5a', h: '#2a1a3a', c: '#1a1024', C: '#0e0816', p: '#140a1e', e: '#ff2a6a', x: '#ff5cf0' } },

  // ----- mid-run bosses (waves 25, 50, 75; see MID_BOSSES) and their minions -----
  // named: shown on the boss bar and fought in a sealed arena. ai: attack script in bosses.js.
  hivequeen: { name: 'MAW, THE HIVE QUEEN', hp: 2600, speed: 19, dmg: 22, r: 17, hy: 16, score: 2500, intro: 25, weight: [0, 0, 0], scale: 2,
    boss: true, named: true, ai: 'hivequeen', kbImmune: true, structMult: 4, groan: 0.5,
    arena: { r: 160, color: '#b0ff40', theme: 'hive' }, reward: { rarity: 3, kits: 1 },
    colors: { k: '#7a9a3a', h: '#5a7040', c: '#a8c860', C: '#6a8a3a', p: '#3a4a2a', e: '#ff3a20', x: '#c8ff40' } },
  voltrax:   { name: 'VOLTRAX, THE STORM ENGINE', hp: 4200, speed: 21, dmg: 28, r: 17, hy: 21, score: 4000, intro: 50, weight: [0, 0, 0], scale: 2,
    boss: true, named: true, ai: 'voltrax', kbImmune: true, structMult: 5, groan: 0.5,
    arena: { r: 160, color: '#fff060', theme: 'storm' }, reward: { rarity: 4, kits: 2 },
    colors: { k: '#6a7a9a', h: '#8a9aba', c: '#3a4458', C: '#22283a', p: '#22283a', e: '#3ff0ff', x: '#fff060' } },
  deadking:  { name: 'NECROVANTA, THE DEAD KING', hp: 6200, speed: 16, dmg: 32, r: 17, hy: 23, score: 6000, intro: 75, weight: [0, 0, 0], scale: 2,
    boss: true, named: true, ai: 'deadking', kbImmune: true, structMult: 5, groan: 0.4,
    arena: { r: 160, color: '#3aff8a', theme: 'grave' }, reward: { rarity: 5, kits: 3, prefer: 'necrovanta' },
    colors: { k: '#d8d0c0', h: '#2a1a3a', c: '#2a1438', C: '#160a20', p: '#160a20', e: '#3aff8a', x: '#ffd040' } },
  pylon:     { name: 'Tesla Pylon', hp: 260, speed: 0, dmg: 14, r: 7, hy: 9, score: 150, intro: 999, weight: [0, 0, 0],
    ai: 'pylon', stationary: true, kbImmune: true, immune: 'slow', groan: 0.001,
    colors: { k: '#8a94a6', h: '#5a6476', c: '#3a4250', C: '#22283a', p: '#22283a', e: '#fff060', x: '#fff060' } },
};
// Boss of each mid-run boss wave.
const MID_BOSSES = { 25: 'hivequeen', 50: 'voltrax', 75: 'deadking' };
// Order of appearance across the 100 waves.
const ZOMBIE_ORDER = ['normal', 'armored', 'crawler', 'fast', 'spitter', 'fire', 'bloater', 'toxic', 'riot', 'electric', 'phantom',
  'cyber', 'necro', 'freezing', 'brute', 'titan', 'leech', 'juggernaut', 'wraith', 'omega'];

// Zombies spawn far away and rush in while unseen, then walk the last stretch.
const SPAWN_CHUNKS = 10;                       // minimum spawn distance, in chunks
const INBOUND_SPEED = 480;                     // px/s while far away and off screen (~7s to arrive)
const ARRIVE_DIST = (FLOW_RADIUS - 4) * TILE;  // they appear (still off screen) at this distance
// Bosses shrug off crowd control: stun / freeze / lift durations and pulls are scaled by this.
const BOSS_CC = 0.3;

// Per-wave scaling of zombie stats. Kept gentle so difficulty climbs gradually
// and low-rarity weapons stay useful with upgrades.
function waveHpMult(w)    { return 1 + (w - 1) * 0.022; }
function waveDmgMult(w)   { return 1 + (w - 1) * 0.012; }
function waveSpeedMult(w) { return 1 + Math.min(0.3, (w - 1) * 0.003); }
function waveZombieCount(w) {
  let n = Math.round(4 + w * 0.9 + Math.pow(w, 1.3) * 0.07);
  if (w % 10 === 0) n = Math.round(n * 1.25);      // horde waves
  return n;
}
function waveTitanCount(w) {
  if (w === MAX_WAVE) return 3;   // plus the Omega Titan
  if (w < 55) return 0;
  return w % 5 === 0 ? 1 + Math.floor((w - 55) / 15) : 0;
}
function waveSpawnInterval(w) { return Math.max(0.25, 1.25 - w * 0.011); }
function waveMaxAlive(w) { return Math.min(75, 22 + w); }

// ---------- Chests ----------
// Chest rarity odds. "w" is the wave, or an equivalent level for far-away exploration chests.
function rarityWeights(w) {
  return [
    Math.max(10, 60 - w * 0.6),
    30 + w * 0.2,
    w >= 3 ? 12 + w * 0.3 : 0,
    w >= 8 ? 4 + w * 0.25 : 0,
    w >= 15 ? 1 + w * 0.12 : 0,
    w >= 30 ? 0.3 + w * 0.06 : 0,
  ];
}
// Exploration chests get better the farther a chunk is from the starting plaza.
function exploreLevel(chunkDist) { return 4 + chunkDist * 9; }

// Chance that a chest of each rarity holds a weapon. The weapon is usually the
// chest's own rarity, sometimes one lower, rarely one higher.
const CHEST_WEAPON_CHANCE = [0.10, 0.16, 0.24, 0.32, 0.42, 0.55];

// What each chest rarity can contain. Ranges are [min, max].
const LOOT_TABLE = {
  common:    { mats: [4, 8],   metal: [0, 2],   ammo: { cells: [0, 15] }, adv: { techshard: [0, 1] }, heal: ['bandage'] },
  uncommon:  { mats: [6, 12],  metal: [1, 4],   ammo: { cells: [10, 25], plasma: [0, 8] }, adv: { techshard: [0, 2] }, heal: ['bandage', 'medkit'] },
  rare:      { mats: [10, 18], metal: [3, 7],   ammo: { cells: [15, 30], plasma: [6, 16] }, adv: { techshard: [1, 3], diamond: [0, 1] }, heal: ['medkit'] },
  epic:      { mats: [14, 24], metal: [6, 12],  ammo: { plasma: [12, 24], quantum: [0, 4] }, adv: { techshard: [2, 5], diamond: [1, 2], plasmacore: [0, 1] }, heal: ['medkit', 'serum'] },
  legendary: { mats: [20, 32], metal: [10, 18], ammo: { plasma: [15, 30], quantum: [4, 9], antimatter: [0, 2] }, adv: { techshard: [4, 8], diamond: [2, 4], plasmacore: [1, 2], voidcrystal: [0, 1] }, heal: ['serum'] },
  mythic:    { mats: [30, 45], metal: [18, 30], ammo: { quantum: [6, 12], antimatter: [2, 5] }, adv: { techshard: [6, 12], diamond: [3, 6], plasmacore: [2, 3], voidcrystal: [1, 2] }, heal: ['serum', 'serum'] },
};
const START_CHESTS = 6;
const MAX_CHESTS = 14;      // break chests near the player (exploration chests are extra)
function chestsPerBreak(w) { return 3 + Math.floor(w / 20); }
// Guaranteed supply drop after every 10th wave: rarity index by wave.
function supplyDropRarity(w) { return w >= 70 ? 5 : w >= 40 ? 4 : w >= 20 ? 3 : 2; }

// ---------- Items ----------
const HEAL_ITEMS = {
  bandage: { name: 'Bandage',    heal: 25 },
  medkit:  { name: 'Med Kit',    heal: 60 },
  serum:   { name: 'Nano Serum', heal: 9999 },
};

// ---------- Crafting recipes (CRAFT tab, usable anywhere) ----------
const RECIPES = [
  { id: 'bandage',    name: 'Bandage',              desc: 'Heals 25 HP',           cost: { wood: 4 },                       give: { bandage: 1 } },
  { id: 'medkit',     name: 'Med Kit',              desc: 'Heals 60 HP',           cost: { wood: 3, metal: 3 },             give: { medkit: 1 } },
  { id: 'serum',      name: 'Nano Serum',           desc: 'Full heal',             cost: { metal: 8, stone: 6 },            give: { serum: 1 } },
  { id: 'cells',      name: 'Energy Cells x25',     desc: 'Common & uncommon guns', cost: { metal: 4, stone: 2 },           give: { cells: 25 } },
  { id: 'plasma',     name: 'Plasma Cartridges x15', desc: 'Rare & epic guns',     cost: { metal: 5, techshard: 1 },        give: { plasma: 15 } },
  { id: 'quantum',    name: 'Quantum Cores x6',     desc: 'Legendary guns',        cost: { techshard: 2, diamond: 1 },      give: { quantum: 6 } },
  { id: 'antimatter', name: 'Antimatter Rounds x3', desc: 'Mythic guns',           cost: { plasmacore: 1, voidcrystal: 1 }, give: { antimatter: 3 } },
];

// ---------- Survivor upgrades (SURVIVOR tab, between waves) ----------
const SURVIVOR_UPGRADES = [
  { id: 'vitality', name: 'Vitality Core', desc: '+20 max HP', max: 5, cost: n => ({ metal: 6 * (n + 1), stone: 4 * (n + 1) }) },
  { id: 'armor',    name: 'Armor Plating', desc: '-7% damage taken', max: 5, cost: n => ({ metal: 8 * (n + 1), wood: 5 * (n + 1) }) },
  { id: 'boots',    name: 'Hover Boots',   desc: '+6% move speed', max: 3, cost: n => ({ metal: 5 * (n + 1), wood: 6 * (n + 1) }) },
];

// ---------- Buildable structures (build mode) ----------
const STRUCTURES = [
  { id: 'woodwall',  name: 'Wood Wall',   cost: { wood: 4 },            hp: 160, solid: true,  desc: 'Cheap barrier' },
  { id: 'stonewall', name: 'Stone Wall',  cost: { stone: 4 },           hp: 380, solid: true,  desc: 'Sturdy barrier' },
  { id: 'metalwall', name: 'Metal Wall',  cost: { metal: 4 },           hp: 800, solid: true,  desc: 'Toughest barrier' },
  { id: 'spikes',    name: 'Spike Trap',  cost: { wood: 2, metal: 2 },  hp: 120, solid: false, desc: 'Hurts zombies on it' },
  { id: 'turret',    name: 'Auto Turret', cost: { metal: 8, stone: 4 }, hp: 300, solid: true,  desc: 'Shoots nearby zombies' },
  { id: 'anvil',     name: 'Tech Anvil',  cost: { metal: 15 },          hp: 500, solid: true,  desc: 'Forge and upgrade weapons here' },
];
const STRUCT_BY_ID = Object.fromEntries(STRUCTURES.map(s => [s.id, s]));
const BUILD_RANGE = 90;     // px from player
const TURRET = { range: 130, cd: 0.42, dmg: 10, speed: 280 };
const SPIKE = { dmg: 22, tick: 0.5, wear: 4 };

// ---------- Resource nodes ----------
// bonus: [material, chance] rolled on every gather.
const NODE_TYPES = {
  tree:        { res: 'wood',        yield: 2, uses: 6 },
  deadtree:    { res: 'wood',        yield: 2, uses: 4 },
  rock:        { res: 'stone',       yield: 2, uses: 6, bonus: ['diamond', 0.04] },
  scrap:       { res: 'metal',       yield: 1, uses: 5, bonus: ['techshard', 0.08] },
  wreck:       { res: 'metal',       yield: 2, uses: 6, bonus: ['techshard', 0.1] },
  crystal:     { res: 'diamond',     yield: 1, uses: 3, bonus: ['stone', 0.5] },
  techdebris:  { res: 'techshard',   yield: 1, uses: 4, bonus: ['metal', 0.6] },
  core:        { res: 'plasmacore',  yield: 1, uses: 2 },
  voidcrystal: { res: 'voidcrystal', yield: 1, uses: 2 },
  alienrock:   { res: 'stone',       yield: 2, uses: 4, bonus: ['voidcrystal', 0.06] },
};
const GATHER_TIME = 0.35;   // seconds per gather tick while holding E

// Zombie drops on death. minWave gates late drops; types limits a drop to some zombies.
const DROPS = [
  { kind: 'cells',     chance: 0.09, amount: [4, 9] },
  { kind: 'metal',     chance: 0.08, amount: [1, 2] },
  { kind: 'heal',      chance: 0.07, amount: [8, 12] },
  { kind: 'plasma',    chance: 0.05, amount: [3, 6], minWave: 10 },
  { kind: 'techshard', chance: 0.12, amount: [1, 1], types: ['cyber', 'electric'] },
  { kind: 'quantum',   chance: 0.03, amount: [1, 2], minWave: 35, types: ['cyber', 'freezing', 'armored'] },
];
// Titans (bosses) always drop these, plus a chance at a weapon crate.
const BOSS_DROPS = { plasmacore: [1, 2], quantum: [3, 5], diamond: [0, 2], antimatter: [0, 2], voidcrystal: [0, 1] };
const BOSS_WEAPON_CHANCE = 0.4;
