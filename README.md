# NECROVANTA:3030

A retro 8-bit top-down zombie survival game set in the year 3030. Survive 100 waves in an
endless ruined city with 61 futuristic weapons against 20 kinds of zombie.

## Play

**Easiest:** in this folder run

```
npm install
npm run deploy
```

`npm install` takes a second (there's nothing to download), and `npm run deploy` starts the game's server and
opens the game in your browser at http://localhost:3030 (single player and multiplayer). Leave that terminal
window open while you play; **Ctrl+C** stops the server. Running `npm run deploy` again while it's already
running just opens the game. Needs Node.js 18+ (nodejs.org).

- `npm run online` also gives you a public link for friends on other networks (see Multiplayer below).
- `npm start` starts the server without opening a browser.
- `PORT=4000 npm run deploy` uses another port.

You can also just double-click `index.html` for single player (no server needed).

### Saving
Everything saves automatically in your browser: your wave, survivor, bag, mods, skins, **everything you built**
(with its damage), chests still waiting to be opened, opened exploration chests, chopped trees and mined rocks,
and weapons you threw on the ground. It saves after every wave, every 20 seconds, a moment after you build,
craft, forge or open a chest, and when you quit or close the tab. **Continue** (or **Retry** after dying) puts
you back on the wave you were on; if you left in the middle of a wave, that wave starts again.

### Multiplayer (online co-op, up to 4 players)
Online play needs the small server that comes with the game (plain Node.js, nothing to install):

1. Install Node.js 18 or newer from nodejs.org if you don't have it.
2. In this folder run: `npm run deploy` (or `node server.js`)
3. It prints addresses like `http://localhost:3030` and `http://192.168.1.20:3030`.
   Open one in your browser (friends on the same Wi-Fi use the second one) and press **MULTIPLAYER**.
4. Type your name, press **CONNECT**, then **CREATE A ROOM** or **JOIN** one from the list.
   - **Private rooms** need a password: tick PRIVATE and set one; friends type it next to the room to join.
   - Each player picks their own class in the room. The host presses **START GAME**; others can join a game
     that is already running.

How it works: the room's **host** runs the world (zombies, waves, bosses, chests, builds) and the server
passes messages between the players. Everyone keeps their own bag, materials, mods, skins and class.
Chests give their loot to whoever opens them; drops go to whoever is closest. If you go down you watch
your team and come back when they clear the wave; if everyone is down, the game is over.
Menus don't pause an online game. Online games aren't saved (single-player saves are untouched).

#### Playing on separate devices (no IP addresses needed)
- **Same Wi-Fi:** run `npm run deploy`. Friends type your computer's network name, which the server prints,
  e.g. `http://Stanleys-MacBook-Air.local:3030`. (If a device can't open `.local` names, use the
  "Same Wi-Fi (by IP)" address printed below it.)
- **Anywhere (different networks):** install Cloudflare's free tunnel tool once with `brew install cloudflared`
  (Windows: `winget install --id Cloudflare.cloudflared`), then run `npm run online`. It prints a link like
  `https://some-random-words.trycloudflare.com`: send it to your friends; they open it, press MULTIPLAYER and
  join your room. The link changes every time and works while your computer and that terminal stay on.
  Anyone with the link can see your public rooms, so use a private room (password) for friends-only games.
- **Join from anywhere, any time (your computer can be off):** host it free on Render. One time:
  1. Make a free account at github.com, click **New repository**, name it `necrovanta-3030`, create it, then
     click **uploading an existing file** and drag in everything from this folder (`index.html`, `style.css`,
     `server.js`, `package.json`, `package-lock.json`, `render.yaml`, `README.md` and the `js` folder). Commit.
  2. Make a free account at render.com (sign in with GitHub), click **New** > **Blueprint**, pick the
     `necrovanta-3030` repository and click **Apply**. Render reads `render.yaml` and starts the server.
  3. After a few minutes you get a permanent link like `https://necrovanta-3030.onrender.com`. Open it on any
     phone, tablet or computer, anywhere, press MULTIPLAYER > CONNECT, and create or join a room.
  On the free plan the server sleeps after ~15 minutes with nobody on it; the first visit after that takes
  about a minute. To update the game later, upload the changed files to GitHub again; Render redeploys itself.
The pixel font loads from Google Fonts; offline it falls back to a monospace font.

| Key | Action |
| --- | --- |
| WASD / arrows | Move |
| Mouse | Aim |
| Left click (hold) | Attack / auto-fire (Genesis Ω: tap = pulse, hold = beam) |
| Right click / F | Weapon ability (Rift Jumper and Quantum Claw teleport, Genesis Ω dome, Oblivion Blade Ω shockwave, Ion Kunai throw, Plasma Katana dash-slash) |
| R | Reload |
| 1–9, mouse wheel | Hotbar slots (in the bag: hover a weapon and press 1–9 to put it on that slot) |
| E | Open chest / hold next to a tree, rock, scrap or crystal to gather |
| Q | Quick heal (picks the best-fitting item) |
| B | Build mode: 1–6 pick a structure, click to place or repair, right-click to remove |
| I / C / U / O | Weapon bag / Craft / Forge / Mods menus (pauses the game) |
| N | Start the next wave early |
| P / Esc | Pause (online the game keeps running) |
| M | Mute everything |
| K | Music on / off |

### Survivor classes
Starting a new game asks you to pick one of 10 classes (each has its own suit colors):

| Class | Perks |
| --- | --- |
| Survivor | Balanced; starts with an extra Med Kit and 20 Energy Cells |
| Blade Dancer | Starts with a Street Balisong; melee COMBO (+5% melee damage per hit within 1.5s, up to +50%); 15% faster melee |
| Gunslinger | Starts with a Pulse Revolver; 40% faster reloads; QUICKDRAW: first shot after a reload deals +60% |
| Marksman | Starts with a Holo Scope on the Nova Spark; +25% gun range; +10% gun crit chance |
| Engineer | Structures cost 30% less, have +60% HP; turrets fire 40% faster; extra metal and stone |
| Medic | Healing items heal 60% more; regenerates 2 HP/s after 4s unhurt; starts with 3 Med Kits |
| Scavenger | +50% materials from gathering and chests; chests 50% more likely to hold a weapon; 14-slot bag |
| Bulwark | +50 max HP, 20% less damage; SPIKED ARMOR hurts and knocks back zombies that hit you; 10% slower |
| Pyro | Starts with a Flare Pistol; +60% burn damage; immune to burning |
| Technomancer | Starts with an Ion Kunai; weapon abilities recharge 40% faster; 6 Tech Shards |

Your class and its perks are listed in the SURVIVOR tab, and it is saved with your checkpoints.

### World
- The map is endless: new city blocks generate as you walk. The farther from the plaza,
  the better the chests and the rarer the zones: **Crystal Fields** (diamonds), **Crash Sites**
  (tech shards, plasma cores), **Weapon Caches** (a guaranteed weapon) and **Alien Rifts**
  (void crystals, 5+ blocks out). The minimap arrow points home.
- Zombies only spawn near you, so build your base where you plan to fight.

### Weapons
- 35 guns and 26 melee weapons across six rarities (Common → Mythic). Every weapon you don't own yet is
  listed in the **Forge** tab with its ability and recipe.
- Melee includes **balisongs** (Street, Neon, Phantom, Singularity: the blade visibly flips around the
  pivot on every strike and folds shut when idle; every few flips hit twice), **karambits** (Hook,
  Venom, Eclipse: hooked strikes that bleed, poison, or spin 360°), plus the Ion Kunai, Ripper
  Chainsword, Plasma Katana, Gravity Sickle and Nebula Scythe.
- Newer guns: Pulse Revolver, Shard SMG, Plasma Scatter, Hex Crossbow, Railspike Carbine,
  Inferno Sprayer, Starfall Launcher and the mythic **NECROVANTA Ω**.
- Guns use magazines and one ammo type each: Energy Cells (common/uncommon), Plasma Cartridges
  (rare/epic), Quantum Cores (legendary), Antimatter Rounds (mythic). Nova Spark never runs dry.
- Get weapons from chests (small chance in every rarity), Weapon Caches, Titan boss crates,
  or **forge** them at a **Tech Anvil** (build one with B for 15 metal, stand next to it, press U).
- Upgrade any weapon at an anvil from Level 1 to 10 (+10% base damage per level). Higher levels
  need Tech Shards, Diamonds, Plasma Cores and Void Crystals. Duplicate weapons from chests
  level the weapon up for free.

### Mods and skins
- Press **O** for the **Mods** tab. Standing next to a Tech Anvil, you can attach mods to any weapon you own:
  - Guns have an **Optic** slot (Holo Scope: more range and shot speed, tighter spread, 10% crits), a
    **Magazine** slot (Extended Mag: +50% magazine, faster reloads) and a **Core** slot.
  - Melee weapons have an **Edge** slot (Mono Edge: +25% reach, 10% crits), a **Grip** slot (Balanced Grip:
    18% faster attacks) and a **Core** slot.
  - **Elemental cores**: Inferno (burn), Cryo (slow, chance to freeze), Tesla (chance to stun and arc to a
    neighbour), Toxin (poison) and Void (heals you for 4% of damage dealt).
  - Mods cost more on rarer weapons. Swapping a mod destroys the old one; removing is free.
  - Every mod upgrades from **Mk I to Mk II to Mk III** (stronger numbers each time, plus gold and pink
    trim on the weapon). Upgrades need materials and rare **Mod Kits**: 1 for Mk II, 2 for Mk III.
    Only Titans drop Mod Kits (1 each, look for the pulsing pink beacon; the Omega Titan drops 3).
  - Mods show on the weapon: a scope on top, a longer magazine, a glowing core gem, a honed white edge.
- **Skins**: every **mythic** chest holds a skin for one of your weapons (legendary chests sometimes do
  too): **Gold** and **Neon** (common), **Frost** and **Blood** (rarer) and **Void** (rarest). The skin goes on
  right away; switch skins in the Mods tab at any time. Skins recolour the weapon and its shots: gold glints,
  neon throbs, frost glitters, blood drips and void twinkles with stars.

### Weapon bag
- Every weapon you own lives in the **bag** (press I). It has 30 slots but starts with 10 open;
  upgrade it 5 times (+4 slots each) from the bag screen. Materials, ammo and healing items
  don't take bag slots.
- Bag full? New weapons from chests drop on the ground instead. **Throw** a weapon (button in
  the bag, or drag it onto the throw zone) to make room; thrown weapons stay where they land and
  can be picked up again with E.
- Drag weapons onto the hotbar row (or hover + 1–9) to choose your 9 quick-slot weapons;
  drag between bag slots to rearrange.

### Waves
- Zombies spawn at least **10 chunks** away and rush in unseen, appearing just off screen about
  7 seconds later. Red arrows around the survivor show where each horde is coming from and how big it is.
- New zombie types keep arriving all the way to the end:

| Wave | Zombie | Trick |
| --- | --- | --- |
| 1 | Zombie | Walks and bites |
| 4 | Armored | Takes 35% less damage |
| 6 | Crawler | Low, slow, comes in numbers |
| 8 | Fast | Runs |
| 11 | Spitter | Keeps its distance and lobs acid (watch the landing ring) |
| 14 | Fire | Sets you on fire, leaves flames when it dies |
| 17 | Bloater | Lights a fuse next to you and explodes (also wrecks walls) |
| 20 | Toxic | Poisons, leaves acid pools |
| 24 | Riot | Front shield blocks 75% of damage: flank it or use explosions |
| **25** | **BOSS: Maw, the Hive Queen** | Acid volleys, hatches broods; at half health burrows and erupts under you (dodge the tracking circle) |
| 28 | Electric | Charges up and zaps you |
| 32 | Phantom | Walks straight through your walls and blinks closer |
| 36 | Cyber | Shoots lasers |
| 41 | Necromancer | Stays back and raises the dead |
| 45 | Freezing | Slows you |
| 50 | Brute | Winds up (red line on the ground) and charges |
| **50** | **BOSS: Voltrax, the Storm Engine** | Lightning strikes on telegraphed circles, ball lightning; at 66% and 33% it shields itself: destroy its 3 Tesla Pylons |
| 55 | Titan | Boss: ground slam, drops boss loot |
| 60 | Leech Swarm | Packs of 4 tiny fast biters that heal by draining you |
| 68 | Juggernaut | Heavy armor, ignores knockback, fires homing rockets |
| **75** | **BOSS: Necrovanta, the Dead King** | Soul-bolt spirals, grave hands, raises elites; below 40% blinks around the arena |
| 78 | Void Wraith | Marks a spot next to you and teleports there |
| 100 | OMEGA TITAN | Final boss: huge slam, rings of lasers, summons elites |

- **Boss waves (25, 50, 75)** seal an arena (a glowing ring) around you: you can't leave until the boss dies.
  The boss has a health bar at the top of the screen, telegraphs its big attacks with circles on the ground,
  and changes tactics partway through. Each one drops a guaranteed weapon crate (Epic / Legendary / Mythic,
  preferring a weapon you don't own; the Dead King drops the NECROVANTA Ω) plus 1 / 2 / 3 Mod Kits.
- Breaks between waves last 20 s. Survivor upgrades are only available during breaks.
- Progress saves automatically every wave (see Saving above).

## Code layout

| File | What it does |
| --- | --- |
| `js/config.js` | **All tunable data**: weapons, ammo, materials, zombies, loot, recipes, structures, wave scaling |
| `js/util.js` | Math/random helpers and the shared `Game` state object |
| `js/audio.js` | 8-bit sound effects synthesized with Web Audio (no audio files) |
| `js/input.js` | Keyboard and mouse state |
| `js/sprites.js` | Builds every pixel-art sprite at startup (guns and knives from detailed part lists, a lighting pass for characters/props), plus a bitmap font |
| `js/map.js` | Infinite chunked world: seeded zone generator, collision, resource nodes, pathfinding |
| `js/classes.js` | Survivor classes: starting kits and the perk numbers the rest of the game asks for |
| `js/player.js` | Movement, hotbar, gathering, healing, taking damage |
| `js/weapons.js` | Firing, magazines/reloading, knives, every weapon ability, projectiles, beams, fields, delayed effects |
| `js/zombies.js` | Zombie AI, status effects, special attacks, damage and death |
| `js/structures.js` | Walls, spike traps, turrets, anvils and build mode |
| `js/loot.js` | Chests, weapon rolls, boss crates, zombie drops |
| `js/waves.js` | Wave flow, spawning, checkpoints, death and victory |
| `js/bosses.js` | Mid-run bosses: arenas, telegraphed strikes, attack scripts, phases and rewards |
| `js/ui.js` | HUD, hotbar, minimap, menus (Bag/Supplies/Craft/Forge/Survivor) and screens |
| `js/render.js` | Draws the world each frame, including the night lighting pass |
| `js/main.js` | Boot, resize, game loop, global keys |
| `js/save.js` | Autosave: what is saved, when, and how it is restored |
| `js/net.js` | Online co-op: lobby, host-side stand-ins for other players, guest-side sync |
| `server.js` | Game server: serves the game, lobby, public/private rooms, message relay (`npm run deploy`) |
| `package.json` | `npm run deploy` / `npm start` scripts (no dependencies) |

## Expanding

- **New weapon**: add an entry to `WEAPONS` in `config.js` (palette, stats). Guns get their pixel art
  from a part list in `Sprites.gunDesigns` (parts like `body`, `metal`, `coil`, `core`, `scope`, `grip`,
  `dish`, `ring`...; each has a detailed renderer in `Sprites.buildGun`) and their shot sound from a
  recipe in `Sound.gun` (`audio.js`). Melee weapons are laid out the same way in `Sprites.knifeDesigns`
  (`blade` with tips like `point`/`clip`/`tanto`/`leaf`, `curve`, `crescent` for karambits and scythes,
  `handle`, `guard`, `ring`, `bali`, `saw`...; renderers in `Sprites.knifeKit`). Parts on layer `'B'`
  become a balisong's flipping blade. Swing sounds per style are in `Sound.swing`.
  A unique ability goes in a `case '<id>'` branch in `weapons.js` (`fire`, `onHit`, `explode`,
  `knifeHit` or `alt`). It automatically appears in chests, the Armory and the Forge.
- **New boss**: add it to `ZOMBIE_TYPES` with `named`, `ai`, `arena` and `reward`, list its wave in `MID_BOSSES`,
  write its attack script in `bosses.js` (a function named after its `ai`) and its sprite in `Sprites.buildBosses()`.
- **New zombie**: add it to `ZOMBIE_TYPES` and `ZOMBIE_ORDER`. Abilities are flags
  (`burns`, `poisons`, `freezes`, `zaps`, `shoots`, `slams`, `armor`, `deathBlast`, `boss`) handled in `zombies.js`.
- **New structure**: add it to `STRUCTURES` and draw its 16x16 sprite in `Sprites.buildStructures()`.
- **Sprite shading**: `detailPass()` in `sprites.js` adds the top-left light, bottom-right shadow and
  grain to the survivor, zombies, chests and structures; tune its `lit`/`shadow`/`grain` options.
- **New zone**: add a `zone_<name>` builder in `map.js`, list it in `ZONES`, and give it odds in `pickZone`.
- **Bag size**: edit `BAG_LEVELS` in `config.js` (slots and upgrade costs per level).
- **New class**: add an entry to `CLASSES` in `config.js` (colors, perks text, starting kit, `stats`). The
  stats it can change are listed in `Classes.defaults` (`js/classes.js`).
- **Mods / skins**: `MODS` (with Mk I-III stats in `mk`), `MOD_SLOTS`, `modTierCost`, `SKINS` (with drop `weight`)
  and `SKIN_CHANCE` in `config.js`. Mod effects are in
  `Weapons.spawnBullet` / `onHit` / `melee` and `Weapons.applyCore`; their pictures in `Sprites.modGun` and
  `Sprites.modKnife`. A skin's `pal` recolours the weapon when `Sprites.look()` rebuilds it.
- **Spawn distance / arrival time**: `SPAWN_CHUNKS`, `INBOUND_SPEED` and `ARRIVE_DIST` in `config.js`.
- **Sound**: every effect is a recipe in `Sound.play` (`audio.js`); zombie voices are in
  `Sound.groanVoices`; the music sequencer is the `Music` object at the bottom of `audio.js`.
- **Lighting**: night darkness is `Game.ambient` (set in `Main.update`); light sources are added in
  `Render.drawLighting`, and lamps/windows register lights in `World.renderChunk`.
- **Difficulty / pacing**: the `wave*` functions in `config.js` control HP, damage, speed,
  zombie count, spawn rate and Titan count per wave.
