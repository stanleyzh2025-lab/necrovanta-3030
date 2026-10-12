// ============================================================
// main.js - boot, resize, game loop, global keys, new game /
// checkpoint loading. This is the entry point.
// ============================================================

const Main = {
  canvas: null,
  last: 0,
  titleT: 0,
  fireworkT: 0,

  init() {
    this.canvas = $('game');
    Sprites.init();
    Render.init(this.canvas);
    Input.init(this.canvas);
    UI.init();
    Net.hookOutputs();
    this.resize();
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('blur', () => { if (Game.state === 'playing' && !Game.paused && !Game.menuOpen && !Net.active) this.setPaused(true); });
    this.toTitle();
    requestAnimationFrame(t => this.loop(t));
  },

  // Integer pixel scale that keeps roughly 270 game pixels of height.
  resize() {
    const vw = window.innerWidth, vh = window.innerHeight;
    let scale = Math.max(1, Math.round(vh / 270));
    while (scale > 1 && vw / scale < 400) scale--;
    Game.scale = scale;
    Game.viewW = Math.ceil(vw / scale);
    Game.viewH = Math.ceil(vh / scale);
    this.canvas.style.width = Game.viewW * scale + 'px';
    this.canvas.style.height = Game.viewH * scale + 'px';
    Render.resize();
    UI.setScale(scale);
  },

  toTitle() {
    Game.state = 'title';
    Game.paused = false;
    Game.menuOpen = false;
    $('menu').classList.add('hidden');
    UI.el.hud.classList.add('hidden');
    this.clearWorld();
    this.saved = Waves.loadSaved();
    UI.showTitle(this.saved);
  },

  // Empties every list and regenerates the (deterministic) world from scratch.
  clearWorld() {
    Structures.clearAll();
    for (const k of ['zombies', 'bullets', 'enemyShots', 'drops', 'hazards', 'chests', 'drones', 'fields', 'groundWeapons']) Game[k].length = 0;
    Waves.inbound.length = 0;
    Waves.queue.length = 0;
    Weapons.tasks.length = 0;
    Bosses.reset();
    FX.clear();
    World.reset();
    Game.explored = 0;
  },

  newGame(cp = null, cls = 'survivor') {
    this.clearWorld();
    const p = Game.player = createPlayer();
    if (!cp) Classes.applyStart(p, cls);
    else Save.restoreWorld(cp);   // opened chests and harvested nodes, before chunks generate
    Game.wave = 0; Game.kills = 0; Game.score = 0; Game.time = 0;
    if (cp) {
      Game.wave = cp.wave; Game.kills = cp.kills; Game.score = cp.score; Game.time = cp.time;
      Game.explored = cp.explored || 0;
      const cpp = cp.player;
      p.cls = CLASS_BY_ID[cpp.cls] ? cpp.cls : 'survivor';
      p.weapons = {};
      for (const id in cpp.weapons) if (WEAPON_BY_ID[id]) p.weapons[id] = Math.min(MAX_LEVEL, cpp.weapons[id]);
      p.inv = { ...p.inv, ...cpp.inv };
      p.upgrades = { ...p.upgrades, ...cpp.upgrades };
      // Mods and skins (older saves have none). Unknown ids are dropped.
      for (const id in cpp.mods || {}) {
        if (!WEAPON_BY_ID[id]) continue;
        const src = cpp.mods[id], m = { mk: {} };
        for (const slot in src) {
          if (slot === 'mk' || !MODS[src[slot]] || MODS[src[slot]].slot !== slot) continue;
          m[slot] = src[slot];
          m.mk[slot] = clamp(Math.round((src.mk && src.mk[slot]) || 1), 1, MOD_MAX_TIER);
        }
        p.mods[id] = m;
      }
      for (const id in cpp.skins || {}) if (WEAPON_BY_ID[id]) p.skins[id] = cpp.skins[id].filter(k => SKINS[k]);
      for (const id in cpp.skin || {}) if (p.skins[id] && p.skins[id].includes(cpp.skin[id])) p.skin[id] = cpp.skin[id];
      // Bag: restore saved order; any owned weapon missing from it (older saves) fills free slots.
      p.bagLevel = clamp(cpp.bagLevel || 0, 0, BAG_LEVELS.length - 1);
      p.bag = Array(BAG_MAX).fill(null);
      (cpp.bag || []).slice(0, BAG_MAX).forEach((id, i) => { if (id && p.weapons[id] && !p.bag.includes(id)) p.bag[i] = id; });
      for (const id in p.weapons) {
        if (p.bag.includes(id)) continue;
        const free = p.bag.indexOf(null);
        if (free >= 0) p.bag[free] = id;
        while (Player.bagCount(p) > Player.bagCapacity(p) && p.bagLevel < BAG_LEVELS.length - 1) p.bagLevel++;
      }
      p.hotbar = (cpp.hotbar || []).slice(0, HOTBAR_SIZE).map(id => (id && p.weapons[id] ? id : null));
      while (p.hotbar.length < HOTBAR_SIZE) p.hotbar.push(null);
      for (const id in p.weapons) if (WEAPON_BY_ID[id].kind === 'gun') p.mags[id] = (cpp.mags && cpp.mags[id]) || WEAPON_BY_ID[id].mag;
      p.slot = p.hotbar[cpp.slot] ? cpp.slot : Math.max(0, p.hotbar.findIndex(Boolean));
      Save.restoreObjects(cp);
    }
    p.maxHp = Player.maxHp(p);
    p.hp = p.maxHp;

    Game.state = 'playing';
    Game.paused = false;
    Game.menuOpen = false;
    Game.buildMode = false;
    Game.camera.x = p.x - Game.viewW / 2;
    Game.camera.y = p.y - Game.viewH / 2;
    World.updateFlow(0, p.x, p.y);   // chest spawns need the pathfinding field
    if (!cp || !cp.chests) for (let i = 0; i < START_CHESTS; i++) Loot.spawnChest();

    Waves.startBreak(cp ? BREAK_TIME : FIRST_BREAK);
    Waves.saveCheckpoint(false);
    UI.hideScreen();
    UI.el.toasts.innerHTML = '';
    UI.el.hud.classList.remove('hidden');
    UI.dirty = true;
    if (cp && cp.wave > 0) UI.banner(`WAVE ${cp.wave + 1}`, 'CHECKPOINT LOADED &middot; GET READY');
    else UI.banner('YEAR 3030', 'LOOT CHESTS AND GATHER MATERIALS BEFORE WAVE 1');
  },

  // Multiplayer screens: lobby, room, and the end of an online game.
  mpAction(a) {
    const val = id => { const el = document.getElementById(id); return el ? el.value : ''; };
    const [cmd, arg] = a.split(':');
    if (cmd === 'mp') UI.showLobby();
    else if (cmd === 'mp-connect') {
      const url = val('mp-url').trim() || Net.defaultUrl(), name = val('mp-name').trim().toUpperCase().slice(0, 12) || 'SURVIVOR';
      try { localStorage.setItem('necrovanta_mp', JSON.stringify({ url, name })); } catch (e) { /* storage blocked */ }
      Net.connect(url, name);
      UI.refreshLobby();
    } else if (cmd === 'mp-refresh') Net.refresh();
    else if (cmd === 'mp-create') {
      const priv = document.getElementById('mp-priv') && document.getElementById('mp-priv').checked;
      Net.createRoom(val('mp-room').trim(), Number(val('mp-max')) || 4, priv, priv ? val('mp-newpass') : '');
    } else if (cmd === 'mp-join') Net.joinRoom(arg, val('mp-pass-' + arg));
    else if (cmd === 'mp-class') { Net.cls = CLASS_BY_ID[arg] ? arg : 'survivor'; UI.showRoom(); }
    else if (cmd === 'mp-start') Net.startRoom();
    else if (cmd === 'mp-leave') { Net.leaveRoom(); UI.showLobby(); }
    else if (cmd === 'mp-back') { Net.leaveRoom(); this.toTitle(); UI.showLobby(); }
  },

  setPaused(on) {
    Game.paused = on;
    if (on) UI.showPause(); else UI.hideScreen();
  },

  screenAction(a) {
    if (a.startsWith('mp')) { this.mpAction(a); return; }
    if (a === 'new') UI.showClassSelect();
    else if (a.startsWith('class:')) this.newGame(null, a.slice(6));
    else if (a === 'continue' && this.saved) this.newGame(this.saved);
    else if (a === 'retry') this.newGame(Game.checkpoint);
    else if (a === 'resume') this.setPaused(false);
    else if (a === 'mute') { Sound.toggleMute(); UI.showPause(); }
    else if (a === 'music') { Sound.toggleMusic(); UI.showPause(); }
    else if (a === 'title') { if (Net.active) Net.leaveRoom(); else Save.save(); this.toTitle(); }
  },

  handleKeys() {
    if (Input.wasPressed('m')) UI.toast(Sound.toggleMute() ? 'SOUND OFF' : 'SOUND ON', '#8a8aa8');
    if (Input.wasPressed('k')) UI.toast(Sound.toggleMusic() ? 'MUSIC ON' : 'MUSIC OFF', '#8a8aa8');
    const st = Game.state;
    if (st === 'title') {
      if (Input.wasPressed('enter')) { Sound.play('click'); this.saved ? this.newGame(this.saved) : UI.showClassSelect(); }
      return;
    }
    if (st === 'classpick' || st === 'lobby') {
      if (Input.wasPressed('escape')) this.toTitle();
      return;
    }
    if (st === 'room') {
      if (Input.wasPressed('escape')) { Net.leaveRoom(); UI.showLobby(); }
      return;
    }
    if (st === 'gameover' && Input.wasPressed('enter') && !Net.active) { this.newGame(Game.checkpoint); return; }
    if (st !== 'playing') return;

    if (Game.paused) {
      if (Input.wasPressed('escape', 'p')) this.setPaused(false);
      return;
    }
    const tabKey = Input.wasPressed('c') ? 'craft' : Input.wasPressed('u') ? 'forge' : Input.wasPressed('o') ? 'mods' : Input.wasPressed('i', 'tab') ? 'bag' : null;
    if (Game.menuOpen) {
      // In the bag, number keys put the hovered (or selected) weapon on that hotbar slot.
      if (UI.menuTab === 'bag') for (let i = 0; i < HOTBAR_SIZE; i++) if (Input.wasPressed(String(i + 1))) UI.bagHotkey(i);
      if (Input.wasPressed('escape')) UI.closeMenu();
      else if (tabKey) {
        if (UI.menuTab !== tabKey) { UI.menuTab = tabKey; UI.renderMenu(); }
        else UI.closeMenu();
      }
      return;
    }
    if (Input.wasPressed('escape')) {
      if (Game.buildMode) Build.toggle(); else this.setPaused(true);
    } else if (Input.wasPressed('p')) this.setPaused(true);
    else if (tabKey) UI.openMenu(tabKey);
    else if (Input.wasPressed('b')) Build.toggle();
  },

  updateCamera(dt) {
    let p = Game.player;
    if (p.dead) p = (Game.others || []).find(o => !o.dead) || p;   // spectate a teammate while down
    const tx = p.x - Game.viewW / 2, ty = p.y - Game.viewH / 2;
    const k = Math.min(1, dt * 12);
    Game.camera.x = lerp(Game.camera.x, tx, k);
    Game.camera.y = lerp(Game.camera.y, ty, k);
  },

  update(dt) {
    this.handleKeys();
    const st = Game.state;
    // Music follows the action: calm in breaks, full beat in waves, extra layer for bosses.
    Music.intensity = st !== 'playing' || Game.phase !== 'wave' ? 0
      : Game.zombies.some(z => z.type.boss) || Waves.inbound.some(e => ZOMBIE_TYPES[e.id].boss) ? 2 : 1;
    if (st === 'playing' || st === 'title') Sound.ambientTick(dt);
    if (st !== 'playing' || Game.paused || Game.menuOpen) Sound.stopLoops();
    // Night falls during waves and lifts a little during breaks.
    const dark = st === 'title' ? 0.55 : Game.phase === 'wave' ? 0.5 + Math.min(0.1, Game.wave * 0.001) : 0.3;
    Game.ambient += (dark - Game.ambient) * Math.min(1, dt * 0.8);

    if (st === 'title') {
      // Slow pan across the city behind the title screen.
      this.titleT += dt;
      Game.camera.x = World.spawnPoint.x - Game.viewW / 2 + Math.sin(this.titleT * 0.05) * 420;
      Game.camera.y = World.spawnPoint.y - Game.viewH / 2 + Math.cos(this.titleT * 0.04) * 300;
      return;
    }
    if (st === 'victory') {
      this.fireworkT -= dt;
      if (this.fireworkT <= 0) {
        this.fireworkT = 0.35;
        const x = Game.camera.x + rand(40, Game.viewW - 40), y = Game.camera.y + rand(30, Game.viewH * 0.6);
        const col = pick(RARITIES).color;
        FX.burst(x, y, col, 30, 110, 1.1, 2);
        FX.ring(x, y, 30, col, 0.6);
        Sound.play('pickup');
      }
      FX.update(dt);
      return;
    }
    if (st === 'dead') {
      Waves.updateDead(dt);
      FX.update(dt);
      return;
    }
    if (st !== 'playing') return;
    // Single player pauses for menus; online the world keeps going for everyone.
    const frozen = Game.paused || Game.menuOpen;
    if (frozen && !Net.active) { UI.update(0); return; }

    const p = Game.player;
    Game.time += dt;
    Input.updateWorldMouse();
    if (Net.role === 'guest') { this.updateGuest(dt, frozen); return; }
    if (Game.buildMode && !frozen) Build.update();
    if (!frozen && !p.dead) Player.update(p, dt);
    if (Game.state !== 'playing') return;
    World.update(dt, p);
    World.updateFlow(dt, p.x, p.y);
    Waves.update(dt);
    if (Game.state !== 'playing') return;
    Zombies.update(dt);
    Bosses.update(dt);
    for (const q of Net.players()) Weapons.updateDome(q);
    Structures.update(dt);
    Weapons.updateBullets(dt);
    Weapons.updateDrones(dt);
    Weapons.updateFields(dt);
    Weapons.updateTasks(dt);
    Save.update(dt);
    Weapons.updateEnemyShots(dt);
    Zombies.updateHazards(dt);
    Loot.updateChests(dt);
    Loot.updateDrops(dt);
    if (Net.role === 'host') Net.hostTick(dt);
    FX.update(dt);
    this.updateCamera(dt);
    UI.update(dt);
  },

  // Online guest: move your own survivor; the world itself comes from the host.
  updateGuest(dt, frozen) {
    const p = Game.player;
    if (Game.buildMode && !frozen) Build.update();
    if (!frozen && !p.dead) Player.update(p, dt);
    if (Game.state !== 'playing') return;
    World.update(dt, p);
    Net.guestTick(dt);
    FX.update(dt);
    this.updateCamera(dt);
    UI.update(dt);
  },

  loop(ts) {
    this.lastLoop = performance.now();
    const dt = Math.min(0.05, (ts - this.last) / 1000 || 0);
    this.last = ts;
    this.update(dt);
    Render.frame();
    Input.endFrame();
    requestAnimationFrame(t => this.loop(t));
  },
};

window.addEventListener('load', () => Main.init());
