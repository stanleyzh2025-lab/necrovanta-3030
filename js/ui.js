// ============================================================
// ui.js - HTML overlay: HUD, hotbar, minimap, toasts, banners,
// the menu (Bag / Supplies / Craft / Forge / Survivor), and full screens.
// ============================================================

const $ = id => document.getElementById(id);
// Text from other players (names, room names) goes through this before it touches the page.
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const MINIMAP_W = 80, MINIMAP_H = 50;   // tiles shown on the minimap

const UI = {
  dirty: true,
  hintText: null,
  subText: null,
  weaponText: null,
  bannerTimer: 0,
  minimapTimer: 0,
  menuTab: 'bag',
  bagSel: null,          // weapon id selected in the bag
  modSel: null,          // weapon id selected in the MODS tab
  hoverId: null,         // weapon id under the mouse in the bag (for 1-9 hotkeys)
  dragId: null,
  throwConfirm: null,
  ghostHp: 1,            // trailing "damage taken" bar
  slotCache: [],
  el: {},

  init() {
    for (const id of ['hud', 'hp-fill', 'hp-ghost', 'hp-text', 'hp-icon', 'status', 'resources', 'wave-label', 'wave-sub', 'wave-fill',
      'minimap', 'score-line', 'banner', 'hint', 'toasts', 'hotbar', 'build-bar', 'menu', 'menu-body', 'screen', 'bottom',
      'zone-line', 'weapon-name', 'bag-count', 'boss-bar', 'boss-fill', 'boss-ghost']) this.el[id] = $(id);
    this.el['hp-icon'].src = iconUrl('icon', 'heart');

    this.el.hotbar.innerHTML = Array.from({ length: HOTBAR_SIZE }, (_, i) =>
      `<div class="slot" data-slot="${i}"><span class="num">${i + 1}</span><img alt=""><span class="lvl"></span><div class="ammo"><i></i></div><div class="cd"></div></div>`).join('');
    this.el.buildBar = this.el['build-bar'];
    this.el.buildBar.innerHTML = STRUCTURES.map((s, i) =>
      `<div class="slot" data-build="${i}"><span class="num">${i + 1}</span><img src="${iconUrl('struct', s.id, 18)}" alt=""><span class="cost">${Object.entries(s.cost).map(([k, v]) => v + k[0].toUpperCase()).join(' ')}</span></div>`).join('');
    this.el.weaponName = this.el['weapon-name'];

    this.el.minimap.width = MINIMAP_W;
    this.el.minimap.height = MINIMAP_H;
    this.mm = this.el.minimap.getContext('2d');

    // Menu tabs + buttons (event delegation).
    const menu = this.el.menu;
    menu.addEventListener('click', e => {
      const tab = e.target.closest('[data-tab]');
      if (tab) { this.menuTab = tab.dataset.tab; Sound.play('click'); this.renderMenu(); return; }
      if (e.target.closest('[data-close]')) { this.closeMenu(); return; }
      const act = e.target.closest('[data-action]');
      if (act && !act.disabled) this.menuAction(act.dataset.action);
    });
    // Bag drag & drop: drag weapons onto hotbar slots, other bag slots, or the throw zone.
    menu.addEventListener('dragstart', e => {
      const s = e.target.closest('[data-id]');
      if (!s) return;
      this.dragId = s.dataset.id;
      e.dataTransfer.setData('text/plain', this.dragId);
      e.dataTransfer.effectAllowed = 'move';
    });
    menu.addEventListener('dragover', e => {
      const t = e.target.closest('[data-hot],[data-bagslot],[data-drop]');
      if (!t || !this.dragId) return;
      e.preventDefault();
      for (const o of menu.querySelectorAll('.over')) if (o !== t) o.classList.remove('over');
      t.classList.add('over');
    });
    menu.addEventListener('dragend', () => { this.dragId = null; for (const o of menu.querySelectorAll('.over')) o.classList.remove('over'); });
    menu.addEventListener('drop', e => {
      const t = e.target.closest('[data-hot],[data-bagslot],[data-drop]');
      const id = this.dragId;
      this.dragId = null;
      if (!t || !id) return;
      e.preventDefault();
      const p = Game.player;
      if (t.dataset.hot !== undefined) Player.assignHotbar(p, id, Number(t.dataset.hot));
      else if (t.dataset.bagslot !== undefined) this.moveInBag(id, Number(t.dataset.bagslot));
      else if (t.dataset.drop === 'throw') { if (Player.throwWeapon(p, id) && this.bagSel === id) this.bagSel = null; }
      this.renderMenu();
    });
    menu.addEventListener('mouseover', e => {
      const s = e.target.closest('[data-id]');
      this.hoverId = s ? s.dataset.id : null;
    });
    this.el.screen.addEventListener('click', e => {
      const b = e.target.closest('[data-screen]');
      if (b) { Sound.resume(); Sound.play('click'); Main.screenAction(b.dataset.screen); }
    });
  },

  setScale(scale) {
    document.documentElement.style.setProperty('--u', scale + 'px');
  },

  // ---------- per-frame HUD ----------
  update(dt) {
    const p = Game.player;
    if (!p) return;
    const hpFrac = clamp(p.hp / p.maxHp, 0, 1);
    this.ghostHp = hpFrac > this.ghostHp ? hpFrac : Math.max(hpFrac, this.ghostHp - dt * 0.35);
    this.setStyle(this.el['hp-fill'], 'width', (hpFrac * 100).toFixed(1) + '%');
    this.setStyle(this.el['hp-ghost'], 'width', (this.ghostHp * 100).toFixed(1) + '%');
    this.el['hp-fill'].classList.toggle('low', hpFrac < 0.3);
    this.setText(this.el['hp-text'], `${Math.ceil(p.hp)} / ${p.maxHp}`);

    let sub, frac;
    if (Game.phase === 'break') {
      sub = `${Game.wave === 0 ? 'FIRST WAVE' : 'NEXT WAVE'} IN ${Math.ceil(Game.breakTimer)}s &middot; <span class="key">N</span> TO START`;
      frac = Game.breakTimer / (Game.wave === 0 ? FIRST_BREAK : BREAK_TIME);
    } else {
      const left = Waves.remaining(), inc = Waves.incoming();
      sub = `<span class="skull"></span> ${left} ZOMBIES LEFT${inc ? ` &middot; <span class="inc">${inc} INCOMING</span>` : ''}`;
      frac = Waves.total ? left / Waves.total : 0;
    }
    if (sub !== this.subText) { this.subText = sub; this.el['wave-sub'].innerHTML = sub; }
    this.setStyle(this.el['wave-fill'], 'width', (clamp(frac, 0, 1) * 100).toFixed(1) + '%');
    this.el['wave-fill'].classList.toggle('brk', Game.phase === 'break');
    this.setText(this.el['wave-label'], Game.wave === MAX_WAVE && Game.phase === 'wave' ? 'FINAL WAVE' : `WAVE ${Game.wave} / ${MAX_WAVE}`);

    const status = [];
    if (p.burnT > 0) status.push('<span class="tag" style="--c:#ffaa20">BURNING</span>');
    if (p.poisonT > 0) status.push('<span class="tag" style="--c:#9aff40">POISONED</span>');
    if (p.slowT > 0) status.push('<span class="tag" style="--c:#9fe8ff">SLOWED</span>');
    if (p.domeT > 0) status.push(`<span class="tag" style="--c:#fff27a">DOME ${Math.ceil(p.domeT)}s</span>`);
    if (p.combo > 0) status.push(`<span class="tag" style="--c:#ff5cf0">COMBO X${p.combo} +${Math.round(Classes.stat(p, 'combo') * p.combo * 100)}%</span>`);
    if (p.quickdraw) status.push('<span class="tag" style="--c:#ffb84a">QUICKDRAW READY</span>');
    if (p.dead) { status.push('<span class="tag" style="--c:#ff3d4e">DOWN - SPECTATING</span>'); this.setHint('YOU ARE DOWN - YOU COME BACK WHEN YOUR TEAM CLEARS THIS WAVE'); }
    this.updateTeam(p, dt);
    if (Game.buildMode) status.push('<span class="tag" style="--c:#3ff0ff">BUILD MODE</span>');
    const st = status.join('');
    if (this.el.status.innerHTML !== st) this.el.status.innerHTML = st;

    const cls = Classes.get(p);
    const score = `<div><span>CLASS</span><b style="color:${cls.color}">${cls.name.toUpperCase()}</b></div><div><span>SCORE</span><b>${Game.score}</b></div><div><span>KILLS</span><b>${Game.kills}</b></div><div><span>TIME</span><b>${formatTime(Game.time)}</b></div>`;
    if (this.el['score-line'].innerHTML !== score) this.el['score-line'].innerHTML = score;

    // Final boss health bar across the top of the screen.
    const boss = Game.zombies.find(z => (z.type.final || z.type.named) && !z.dead);
    this.el['boss-bar'].classList.toggle('hidden', !boss);
    if (boss) {
      if (this.bossName !== boss.type.name) { this.bossName = boss.type.name; this.el['boss-bar'].querySelector('.bb-name').textContent = boss.type.name; }
      this.el['boss-bar'].classList.toggle('shielded', !!boss.shielded);
      const f = clamp(boss.hp / boss.maxHp, 0, 1);
      this.bossGhost = Math.max(f, (this.bossGhost === undefined ? 1 : this.bossGhost) - dt * 0.15);
      this.setStyle(this.el['boss-fill'], 'width', (f * 100).toFixed(1) + '%');
      this.setStyle(this.el['boss-ghost'], 'width', (this.bossGhost * 100).toFixed(1) + '%');
    }

    const wt = this.weaponLine(p);
    if (wt !== this.weaponText) { this.weaponText = wt; this.el.weaponName.innerHTML = wt; }
    this.updateHotbarMeters(p);

    if (this.bannerTimer > 0) {
      this.bannerTimer -= dt;
      if (this.bannerTimer <= 0) this.el.banner.classList.remove('show');
    }
    this.minimapTimer -= dt;
    if (this.minimapTimer <= 0) { this.minimapTimer = 0.15; this.drawMinimap(); }
    if (this.dirty) { this.dirty = false; this.refresh(); }
  },

  // Online: everyone in the room with their health.
  updateTeam(p, dt) {
    if (!this.el.team) {
      this.el.team = document.createElement('div');
      this.el.team.id = 'team';
      $('hud-right').appendChild(this.el.team);
    }
    this.teamT = (this.teamT || 0) - dt;
    if (this.teamT > 0) return;
    this.teamT = 0.25;
    if (!Net.active) { if (this.el.team.innerHTML) this.el.team.innerHTML = ''; return; }
    const row = (name, hp, max, dead, you) => `<div class="tm${dead ? ' down' : ''}"><span>${esc(name)}${you ? ' (YOU)' : ''}</span>
      <i><b style="width:${dead ? 0 : Math.round(clamp(hp / max, 0, 1) * 100)}%"></b></i></div>`;
    let h = `<div class="tm-title">${esc(Net.room ? Net.room.name : 'ONLINE')}${Net.role === 'host' ? ' &middot; HOST' : ''}</div>`;
    h += row(Net.name, p.hp, p.maxHp, p.dead, true);
    for (const o of Game.others) h += row(o.name, o.hp, o.maxHp, o.dead, false);
    if (this.el.team.innerHTML !== h) this.el.team.innerHTML = h;
  },

  // Only touch the DOM when a value actually changes.
  setText(el, v) { if (el.textContent !== v) el.textContent = v; },
  setStyle(el, prop, v) { if (el.style[prop] !== v) el.style[prop] = v; },

  // Ammo bar + reload sweep on each hotbar slot.
  updateHotbarMeters(p) {
    const slots = this.el.hotbar.children;
    for (let i = 0; i < HOTBAR_SIZE; i++) {
      const w = WEAPON_BY_ID[p.hotbar[i]];
      let ammo = '0%', cd = '0%';
      if (w && w.kind === 'gun') ammo = Math.round((p.mags[w.id] || 0) / Weapons.magSize(p, w) * 100) + '%';
      if (w && i === p.slot && p.reloadT > 0) cd = Math.round(p.reloadT / p.reloadMax * 100) + '%';
      else if (w && w.altCd && (p.altCd[w.id] || 0) > 0) cd = Math.round(p.altCd[w.id] / Weapons.altCd(p, w) * 100) + '%';
      const key = ammo + cd;
      if (this.slotCache[i] === key) continue;
      this.slotCache[i] = key;
      slots[i].querySelector('.ammo i').style.width = ammo;
      slots[i].querySelector('.cd').style.height = cd;
    }
  },

  weaponLine(p) {
    if (Game.buildMode) {
      const s = STRUCTURES[Build.selected];
      return `<span class="wn" style="color:#3ff0ff">${s.name.toUpperCase()}</span><span class="sep"></span>${costText(s.cost)}`;
    }
    const w = Player.weapon(p);
    if (!w) return 'EMPTY SLOT';
    const lvl = p.weapons[w.id];
    let txt = `<span class="wn" style="color:${RARITIES[w.rarity].color}">${w.name.toUpperCase()}</span><span class="lv">LV${lvl}</span><span class="sep"></span>DMG ${Math.round(w.dmg * levelDamageMult(lvl))}`;
    if (w.kind === 'gun') {
      const reserve = w.ammo ? p.inv[w.ammo] : '&infin;';
      const ammoCol = w.ammo ? AMMO[w.ammo].color : '#ffffff';
      txt += p.reloadT > 0
        ? `<span class="sep"></span><span style="color:#3ff0ff">RELOADING</span>`
        : `<span class="sep"></span><b>${p.mags[w.id] || 0}</b>/${Weapons.magSize(p, w)} <span style="color:${ammoCol}">&nbsp;${reserve} ${w.ammo ? AMMO[w.ammo].short : ''}</span>`;
      if (w.id === 'redshift') txt += `<span class="sep"></span><span style="color:#ff9a5a">x${(1 / (1 - 0.06 * Weapons.ws(p, 'redshift').stacks)).toFixed(1)} RATE</span>`;
    } else {
      txt += `<span class="sep"></span>${(1 / w.cd).toFixed(1)} HITS/s`;
    }
    if (w.altCd) {
      const cd = p.altCd[w.id] || 0;
      txt += cd > 0 ? `<span class="sep"></span><span style="color:#8a8aa8">ABILITY ${Math.ceil(cd)}s</span>` : '<span class="sep"></span><span style="color:#5fe05f">ABILITY READY [RMB]</span>';
    }
    return txt;
  },

  // Slower-changing HUD parts: resources, hotbar, build bar, bag count.
  refresh() {
    const p = Game.player;
    const inv = p.inv;
    const res = (icon, n, cls = '') => `<div class="res ${cls}${n ? '' : ' zero'}"><img src="${iconUrl('icon', icon)}" alt="">${n}</div>`;
    const heals = inv.bandage + inv.medkit + inv.serum;
    this.el.resources.innerHTML =
      res('wood', inv.wood) + res('stone', inv.stone) + res('metal', inv.metal) + res('techshard', inv.techshard) +
      res('diamond', inv.diamond) + res('plasmacore', inv.plasmacore) + res('voidcrystal', inv.voidcrystal) +
      `<div class="res heal${heals ? '' : ' zero'}"><img src="${iconUrl('icon', 'medkit')}" alt="">${heals}<span class="k">Q</span></div>`;

    const slots = this.el.hotbar.children;
    for (let i = 0; i < HOTBAR_SIZE; i++) {
      const id = p.hotbar[i], w = WEAPON_BY_ID[id];
      const img = slots[i].querySelector('img');
      slots[i].className = 'slot' + (w ? ' r-' + RARITIES[w.rarity].id : ' empty') + (i === p.slot && !Game.buildMode ? ' active' : '') + (w && w.kind === 'gun' ? ' gun' : '');
      if (w) {
        const url = iconUrl('weapon', id, 26);
        if (img.getAttribute('src') !== url) img.src = url;
        img.style.visibility = 'visible';
      } else {
        img.style.visibility = 'hidden';
      }
      slots[i].querySelector('.lvl').textContent = w ? 'LV' + p.weapons[id] : '';
    }
    this.slotCache = [];

    const cnt = Player.bagCount(p), cap = Player.bagCapacity(p);
    this.el['bag-count'].innerHTML = `<img src="${iconUrl('icon', 'bag')}" alt=""><span>${cnt}/${cap}</span><small>BAG [I]</small>`;
    this.el['bag-count'].classList.toggle('full', cnt >= cap);

    this.el.buildBar.classList.toggle('hidden', !Game.buildMode);
    const bslots = this.el.buildBar.children;
    for (let i = 0; i < STRUCTURES.length; i++) {
      bslots[i].classList.toggle('active', i === Build.selected);
      bslots[i].classList.toggle('locked', !canAfford(inv, STRUCTURES[i].cost));
    }
  },

  // Minimap of the area around the player, stitched from per-chunk images.
  drawMinimap() {
    const g = this.mm, p = Game.player;
    const ox = toTile(p.x) - (MINIMAP_W >> 1), oy = toTile(p.y) - (MINIMAP_H >> 1);
    g.fillStyle = '#000';
    g.fillRect(0, 0, MINIMAP_W, MINIMAP_H);
    const cx0 = Math.floor(ox / CHUNK), cx1 = Math.floor((ox + MINIMAP_W) / CHUNK);
    const cy0 = Math.floor(oy / CHUNK), cy1 = Math.floor((oy + MINIMAP_H) / CHUNK);
    for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) {
      g.drawImage(World.miniFor(World.chunk(cx, cy)), cx * CHUNK - ox, cy * CHUNK - oy);
    }
    // Darken the map a touch so markers pop.
    g.fillStyle = 'rgba(0,0,10,0.25)';
    g.fillRect(0, 0, MINIMAP_W, MINIMAP_H);
    g.fillStyle = '#9a9aa6';
    for (const s of Game.structures) g.fillRect(s.tx - ox, s.ty - oy, 1, 1);
    const blink = Math.floor(Game.time * 3) % 2;
    for (const c of Game.chests) {
      if (c.opened) continue;
      const x = c.tx - ox, y = c.ty - oy;
      if (x < -2 || y < -2 || x > MINIMAP_W || y > MINIMAP_H) continue;
      g.fillStyle = RARITIES[c.rarity].color;
      const big = blink && (c.rarity >= 3 || c.cache);
      g.fillRect(x - (big ? 1 : 0), y, big ? 3 : 2, 2);
    }
    for (const gw of Game.groundWeapons) {
      g.fillStyle = blink ? '#ffffff' : RARITIES[WEAPON_BY_ID[gw.id].rarity].color;
      g.fillRect(toTile(gw.x) - ox, toTile(gw.y) - oy, 2, 1);
    }
    g.fillStyle = '#ff3040';
    for (const z of Game.zombies) g.fillRect(toTile(z.x) - ox, toTile(z.y) - oy, z.type.boss ? 2 : 1, z.type.boss ? 2 : 1);
    // Marker toward the base (on the edge when it's off the minimap).
    const bx = toTile(World.spawnPoint.x) - ox, by = toTile(World.spawnPoint.y) - oy;
    g.fillStyle = '#3ff0ff';
    if (bx < 0 || by < 0 || bx >= MINIMAP_W || by >= MINIMAP_H) {
      const a = Math.atan2(by - MINIMAP_H / 2, bx - MINIMAP_W / 2);
      g.fillRect(Math.round(MINIMAP_W / 2 + Math.cos(a) * 21) - 1, Math.round(MINIMAP_H / 2 + Math.sin(a) * 21) - 1, 3, 3);
    } else {
      g.fillRect(bx - 1, by - 1, 3, 3);
    }
    g.fillStyle = '#ffffff';
    g.fillRect((MINIMAP_W >> 1) - 1, (MINIMAP_H >> 1) - 1, 2, 2);

    const c = World.chunkAtPx(p.x, p.y), z = ZONES[c.zone];
    const zt = `${z.name}<br><span>${c.dist === 0 ? 'HOME BASE' : `${c.dist} BLOCK${c.dist > 1 ? 'S' : ''} FROM BASE`}</span>`;
    if (this.el['zone-line'].innerHTML !== zt) {
      this.el['zone-line'].innerHTML = zt;
      this.el['zone-line'].style.color = z.color || '#e8e8f0';
    }
  },

  setHint(text) {
    if (text === this.hintText) return;
    this.hintText = text;
    this.el.hint.textContent = text;
  },

  toast(text, color = '#3ff0ff') {
    const t = document.createElement('div');
    t.className = 'toast';
    t.style.setProperty('--c', color);
    t.textContent = text;
    this.el.toasts.prepend(t);
    while (this.el.toasts.children.length > 5) this.el.toasts.lastChild.remove();
    setTimeout(() => t.classList.add('out'), 2900);
    setTimeout(() => t.remove(), 3300);
  },

  banner(title, subHtml = '') {
    const b = this.el.banner;
    b.innerHTML = `<div class="big">${title}</div>${subHtml ? `<small>${subHtml}</small>` : ''}`;
    b.classList.remove('show');
    void b.offsetWidth;   // restart the entrance animation
    b.classList.add('show');
    this.bannerTimer = 3;
  },

  // ---------- menu ----------
  openMenu(tab) {
    if (Game.state !== 'playing') return;
    Game.menuOpen = true;
    this.menuTab = tab;
    this.throwConfirm = null;
    this.el.menu.classList.remove('hidden');
    Sound.play('click');
    this.renderMenu();
  },

  closeMenu() {
    Game.menuOpen = false;
    this.el.menu.classList.add('hidden');
    Sound.play('click');
  },

  renderMenu() {
    for (const b of this.el.menu.querySelectorAll('[data-tab]')) b.classList.toggle('active', b.dataset.tab === this.menuTab);
    const body = this.el['menu-body'], scroll = body.scrollTop;
    body.innerHTML = this['tab_' + this.menuTab]();
    body.scrollTop = scroll;
  },

  costHtml(cost) {
    const inv = Game.player.inv;
    return Object.entries(cost).map(([k, v]) =>
      `<span class="${(inv[k] || 0) >= v ? 'ok' : 'bad'}">${v} ${itemName(k).toUpperCase()}</span>`).join(' + ');
  },

  card(icon, title, desc, costHtml, button, extraClass = '') {
    // icon is a URL, or { src, cls } for weapon pictures that need a wider box.
    const src = icon && (icon.src || icon), cls = icon && icon.cls ? ' ' + icon.cls : '';
    return `<div class="card ${extraClass}">${icon ? `<div class="pic"><img class="icon${cls}" src="${src}" alt=""></div>` : ''}
      <div class="info"><div class="title">${title}</div><div class="desc">${desc}</div>${costHtml ? `<div class="cost-line">${costHtml}</div>` : ''}</div>${button || ''}</div>`;
  },

  weaponPic(id) { return { src: iconUrl('weapon', id, 'wide'), cls: 'wicon' }; },
  rarityTag(r) { return `<span class="rarity-${RARITIES[r].id}">${RARITIES[r].name}</span>`; },

  weaponStats(w, lvl) {
    const dmg = Math.round(w.dmg * levelDamageMult(lvl));
    if (w.kind === 'knife') return `DMG ${dmg} &middot; ${(1 / w.cd).toFixed(1)}/s &middot; REACH ${w.reach}`;
    return `DMG ${dmg} &middot; ${(1 / w.cd).toFixed(1)}/s &middot; MAG ${Weapons.magSize(Game.player, w)} &middot; ${w.ammo ? AMMO[w.ammo].short : 'UNLIMITED'}`;
  },

  // ---------- BAG tab: 30-slot weapon bag ----------
  moveInBag(id, to) {
    const p = Game.player, from = p.bag.indexOf(id);
    if (from < 0 || to >= Player.bagCapacity(p) || from === to) return;
    [p.bag[from], p.bag[to]] = [p.bag[to], p.bag[from]];
    Sound.play('click');
  },

  bagHotkey(i) {
    const id = this.hoverId || this.bagSel;
    if (!id || !Game.player.weapons[id]) return;
    Player.assignHotbar(Game.player, id, i);
    this.renderMenu();
  },

  bagSlotHtml(id, i, attrs) {
    const p = Game.player, w = WEAPON_BY_ID[id];
    if (!w) return `<div class="bslot empty" ${attrs}></div>`;
    const hot = p.hotbar.indexOf(id);
    return `<div class="bslot r-${RARITIES[w.rarity].id}${this.bagSel === id ? ' sel' : ''}" ${attrs} data-id="${id}" draggable="true" data-action="bagsel:${id}" title="${w.name}">
      <img src="${iconUrl('weapon', id, 26)}" alt="" draggable="false"><span class="lv">${p.weapons[id]}</span>${hot >= 0 ? `<span class="hk">${hot + 1}</span>` : ''}</div>`;
  },

  tab_bag() {
    const p = Game.player, cap = Player.bagCapacity(p), cnt = Player.bagCount(p);
    if (this.bagSel && !p.weapons[this.bagSel]) this.bagSel = null;
    const next = BAG_LEVELS[p.bagLevel + 1];
    let h = '<div class="bag"><div class="bag-main">';
    h += `<div class="bag-head"><div><span class="bag-title">WEAPON BAG</span> <span class="bag-cnt ${cnt >= cap ? 'full' : ''}">${cnt} / ${cap}</span></div>`;
    h += next
      ? `<div class="bag-up"><span>UPGRADE TO ${next.slots} SLOTS: ${this.costHtml(next.cost)}</span><button class="btn" data-action="bagup" ${canAfford(p.inv, next.cost) ? '' : 'disabled'}>UPGRADE BAG</button></div>`
      : '<div class="bag-up"><span class="ok">BAG FULLY UPGRADED (30 SLOTS)</span></div>';
    h += '</div><div class="bag-grid">';
    for (let i = 0; i < BAG_MAX; i++) {
      if (i >= cap) { h += `<div class="bslot locked"><img src="${iconUrl('icon', 'lock')}" alt=""></div>`; continue; }
      h += this.bagSlotHtml(p.bag[i], i, `data-bagslot="${i}"`);
    }
    h += '</div><div class="bag-sub">HOTBAR &middot; DRAG WEAPONS HERE, OR HOVER A WEAPON AND PRESS 1-9</div><div class="bag-hot">';
    for (let i = 0; i < HOTBAR_SIZE; i++) {
      const id = p.hotbar[i];
      h += id ? this.bagSlotHtml(id, i, `data-hot="${i}"`) : `<div class="bslot empty" data-hot="${i}"><span class="hk">${i + 1}</span></div>`;
    }
    h += '</div><div class="throw-zone" data-drop="throw">DRAG A WEAPON HERE TO THROW IT AWAY</div></div>';
    h += `<div class="bag-side">${this.weaponDetails(this.bagSel)}</div></div>`;
    return h;
  },

  weaponDetails(id) {
    const p = Game.player, w = WEAPON_BY_ID[id];
    if (!w) {
      return `<div class="wd none"><div class="wd-name">SELECT A WEAPON</div>
        <div class="desc">Click a weapon to see its stats.<br><br>&bull; Only weapons use bag slots.<br>&bull; Full bag? Throw a weapon or upgrade the bag.<br>&bull; Thrown weapons stay on the ground: press E to pick them back up.<br>&bull; Duplicates from chests level the weapon up instead of using a slot.</div></div>`;
    }
    const lvl = p.weapons[id], r = RARITIES[w.rarity], hot = p.hotbar.indexOf(id);
    const rows = [['DAMAGE', Math.round(w.dmg * levelDamageMult(lvl)) + (lvl < MAX_LEVEL ? ` <span class="dim">(&gt;${Math.round(w.dmg * levelDamageMult(lvl + 1))})</span>` : '')],
      [w.kind === 'gun' ? 'FIRE RATE' : 'SWING RATE', (1 / w.cd).toFixed(1) + ' / s']];
    if (w.kind === 'gun') {
      rows.push(['MAGAZINE', `${p.mags[id] || 0} / ${Weapons.magSize(p, w)}`], ['RELOAD', (w.reload * (Weapons.mods(p, id).mag === 'extmag' ? 0.8 : 1)).toFixed(1) + 's'],
        ['AMMO', w.ammo ? `<span style="color:${AMMO[w.ammo].color}">${AMMO[w.ammo].short}</span> (${p.inv[w.ammo]})` : 'UNLIMITED']);
    } else {
      rows.push(['REACH', w.reach + ' px'], ['STYLE', w.style.toUpperCase()]);
    }
    const md = Weapons.mods(p, id), modNames = MOD_SLOTS[w.kind].map(([slot]) => md[slot]).filter(Boolean);
    const mkOf = m => MK_NAMES[Weapons.modTier(p, id, MODS[m].slot)];
    rows.push(['MODS', modNames.length ? modNames.map(m => `<span style="color:${MODS[m].color}">${MODS[m].name.toUpperCase()} ${mkOf(m)}</span>`).join(', ') : '<span class="dim">NONE [O]</span>']);
    if (p.skin[id]) rows.push(['SKIN', `<span style="color:${SKINS[p.skin[id]].color}">${SKINS[p.skin[id]].name.toUpperCase()}</span>`]);
    const pips = Array.from({ length: MAX_LEVEL }, (_, i) => `<i class="${i < lvl ? 'on' : ''}"></i>`).join('');
    const throwLabel = this.throwConfirm === id ? 'CLICK AGAIN TO THROW' : 'THROW AWAY';
    return `<div class="wd r-${r.id}">
      <div class="wd-pic"><img src="${iconUrl('weapon', id, 'wide')}" alt=""></div>
      <div class="wd-name" style="color:${r.color}">${w.name}</div>
      <div class="wd-tags"><span class="rarity-${r.id}">${r.name}</span> &middot; ${w.kind === 'gun' ? 'GUN' : 'KNIFE'}</div>
      <div class="wd-level"><span>LV ${lvl}</span><div class="pips">${pips}</div></div>
      <table class="wd-stats">${rows.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('')}</table>
      <div class="wd-ability">${w.ability}</div>
      <div class="wd-label">PUT IN HOTBAR SLOT</div>
      <div class="wd-hot">${Array.from({ length: HOTBAR_SIZE }, (_, i) => `<button class="btn tiny ${hot === i ? 'on' : ''}" data-action="hot:${id}:${i}">${i + 1}</button>`).join('')}</div>
      <div class="wd-actions">${hot >= 0 ? `<button class="btn small" data-action="unhot:${id}">REMOVE FROM HOTBAR</button>` : ''}
      <button class="btn small danger" data-action="throw:${id}">${throwLabel}</button></div>
    </div>`;
  },

  // ---------- SUPPLIES tab ----------
  tab_supplies() {
    const p = Game.player, inv = p.inv;
    const item = (icon, name, n, color) => `<div class="supply ${n ? '' : 'zero'}" style="--c:${color}"><img src="${iconUrl('icon', icon)}" alt=""><div><div class="sn">${name}</div><div class="sv">${n}</div></div></div>`;
    let h = '<div class="section-title">MATERIALS</div><div class="supplies">';
    for (const k in MATERIALS) h += item(k, MATERIALS[k].name.toUpperCase(), inv[k], MATERIALS[k].color);
    h += '</div><div class="section-title">AMMUNITION</div><div class="supplies">';
    for (const k in AMMO) h += item(k, AMMO[k].name.toUpperCase(), inv[k], AMMO[k].color);
    h += '</div><div class="section-title">HEALING (Q USES THE BEST FIT)</div><div class="supplies">';
    for (const k in HEAL_ITEMS) h += item(k, HEAL_ITEMS[k].name.toUpperCase(), inv[k], '#5fe05f');
    h += '</div><div class="section-title">SURVIVOR</div><div class="statline">';
    h += `<div><span>MAX HP</span><b>${p.maxHp}</b></div><div><span>ARMOR</span><b>${Math.round((1 - Player.damageTaken(p)) * 100)}%</b></div><div><span>SPEED</span><b>${Math.round(Player.speed({ upgrades: p.upgrades, slowT: 0, cls: p.cls }))}</b></div>`;
    h += `<div><span>WAVE</span><b>${Game.wave}</b></div><div><span>KILLS</span><b>${Game.kills}</b></div><div><span>WEAPONS FOUND</span><b>${Object.keys(p.weapons).length}/${WEAPONS.length}</b></div><div><span>BLOCKS EXPLORED</span><b>${Game.explored || 0}</b></div></div>`;
    return h;
  },

  tab_craft() {
    const inv = Game.player.inv;
    let h = '<div class="section-title">CRAFT ITEMS &amp; AMMO</div><div class="grid2">';
    for (const r of RECIPES) {
      h += this.card(iconUrl('icon', r.id, 10), r.name.toUpperCase(), r.desc, this.costHtml(r.cost),
        `<button class="btn" data-action="craft:${r.id}" ${canAfford(inv, r.cost) ? '' : 'disabled'}>CRAFT</button>`);
    }
    h += '</div><div class="section-title">STRUCTURES - PRESS B TO BUILD</div><div class="grid2">';
    for (const s of STRUCTURES) h += this.card(iconUrl('struct', s.id, 18), s.name.toUpperCase(), `${s.desc} &middot; ${s.hp} HP`, this.costHtml(s.cost));
    h += '</div><div class="desc" style="margin-top:12px;color:#8a8aa8">Weapons are forged and upgraded at a Tech Anvil (FORGE tab).</div>';
    return h;
  },

  // Forge: upgrade owned weapons and craft new ones. Needs an anvil nearby.
  tab_forge() {
    const p = Game.player, anvil = Structures.nearAnvil(p);
    let h = anvil ? '<div class="notice good">TECH ANVIL IN RANGE - FORGE READY</div>'
      : `<div class="notice">STAND NEXT TO A TECH ANVIL TO FORGE OR UPGRADE. BUILD ONE WITH B (${costText(STRUCT_BY_ID.anvil.cost)}).</div>`;
    h += '<div class="section-title">UPGRADE (+10% DAMAGE PER LEVEL, MAX LV10)</div><div class="grid2">';
    for (const w of WEAPONS) {
      const lvl = p.weapons[w.id];
      if (!lvl) continue;
      const name = `<span class="rarity-${RARITIES[w.rarity].id}">${w.name}</span>`;
      if (lvl >= MAX_LEVEL) { h += this.card(this.weaponPic(w.id), `${name} <span class="stars">MAX</span>`, this.weaponStats(w, lvl), '', '', 'r-' + RARITIES[w.rarity].id); continue; }
      const cost = upgradeCost(w, lvl), ok = anvil && canAfford(p.inv, cost);
      h += this.card(this.weaponPic(w.id), `${name} <span class="stars">LV${lvl}&gt;${lvl + 1}</span>`,
        `DMG ${Math.round(w.dmg * levelDamageMult(lvl))}&gt;${Math.round(w.dmg * levelDamageMult(lvl + 1))}`, this.costHtml(cost),
        `<button class="btn" data-action="upgrade:${w.id}" ${ok ? '' : 'disabled'}>UPGRADE</button>`, 'r-' + RARITIES[w.rarity].id);
    }
    const full = Player.bagFree(p) < 0;
    h += `</div><div class="section-title">FORGE NEW WEAPONS${full ? ' <span class="bad">(BAG FULL)</span>' : ''}</div><div class="grid2">`;
    for (const w of WEAPONS) {
      if (p.weapons[w.id]) continue;
      const cost = weaponRecipe(w), ok = anvil && !full && canAfford(p.inv, cost);
      h += this.card(this.weaponPic(w.id), `${this.rarityTag(w.rarity)} ${w.name}`, w.ability, this.costHtml(cost),
        `<button class="btn" data-action="forge:${w.id}" ${ok ? '' : 'disabled'}>FORGE</button>`, 'r-' + RARITIES[w.rarity].id);
    }
    return h + '</div>';
  },

  // ---------- MODS tab: attach mods at an anvil, switch skins anywhere ----------
  tab_mods() {
    const p = Game.player, anvil = Structures.nearAnvil(p);
    const owned = p.bag.filter(id => id && p.weapons[id]);
    if (!this.modSel || !p.weapons[this.modSel]) this.modSel = p.weapons[p.hotbar[p.slot]] ? p.hotbar[p.slot] : owned[0];
    let h = '<div class="bag"><div class="bag-main">';
    h += anvil ? '<div class="notice good">TECH ANVIL IN RANGE<br>MODS READY</div>'
      : '<div class="notice">STAND NEXT TO A TECH ANVIL TO ATTACH MODS. SKINS SWITCH ANYWHERE.</div>';
    h += '<div class="bag-grid">';
    for (const id of owned) {
      const w = WEAPON_BY_ID[id], md = Weapons.mods(p, id);
      const pips = MOD_SLOTS[w.kind].map(([slot]) => md[slot] ? `<i style="--c:${MODS[md[slot]].color}"></i>` : '<i></i>').join('');
      const sk = p.skin[id];
      h += `<div class="bslot r-${RARITIES[w.rarity].id}${this.modSel === id ? ' sel' : ''}" data-action="modsel:${id}" title="${w.name}">
        <img src="${iconUrl('weapon', id, 26)}" alt=""><span class="mpips">${pips}</span>${sk ? `<span class="skin-dot" style="--c:${SKINS[sk].color}"></span>` : ''}</div>`;
    }
    h += '</div></div>';
    h += `<div class="bag-side">${this.modDetails(this.modSel, anvil)}</div></div>`;
    return h;
  },

  modDetails(id, anvil) {
    const p = Game.player, w = WEAPON_BY_ID[id];
    if (!w) return '<div class="wd none"><div class="wd-name">NO WEAPONS</div></div>';
    const r = RARITIES[w.rarity], md = Weapons.mods(p, id);
    let h = `<div class="wd r-${r.id}">
      <div class="wd-pic"><img src="${iconUrl('weapon', id, 'wide')}" alt=""></div>
      <div class="wd-name" style="color:${r.color}">${w.name}</div>
      <div class="wd-tags"><span class="rarity-${r.id}">${r.name}</span> &middot; LV ${p.weapons[id]} &middot; SWAPPING A MOD DESTROYS THE OLD ONE</div>
      <div class="modkits"><img src="${iconUrl('icon', 'modkit')}" alt=""><span>MOD KITS <b>${p.inv.modkit || 0}</b></span><small>TITANS DROP THEM &middot; NEEDED FOR MK II / MK III</small></div>`;
    for (const [slot, label] of MOD_SLOTS[w.kind]) {
      const cur = md[slot], tier = Weapons.modTier(p, id, slot);
      const pips = cur ? `<span class="mk">${[1, 2, 3].map(t => `<i class="${t <= tier ? 'on' : ''}"></i>`).join('')}</span>` : '';
      h += `<div class="mod-slot"><div class="mod-head"><span>${label}</span>`;
      h += cur ? `<b style="color:${MODS[cur].color}">${MODS[cur].name.toUpperCase()} ${MK_NAMES[tier]}</b>${pips}<button class="btn small" data-action="unmod:${id}:${slot}">REMOVE</button>` : '<b class="dim">EMPTY</b>';
      h += '</div>';
      // Upgrade the attached mod to the next Mk.
      if (cur && tier < MOD_MAX_TIER) {
        const m = MODS[cur], cost = modTierCost(m, w, tier + 1), ok = anvil && canAfford(p.inv, cost);
        h += `<div class="mod-up" style="--c:${m.color}"><div class="mo-info"><div class="mo-name">UPGRADE TO ${MK_NAMES[tier + 1]}</div>
          <div class="mo-desc">${m.text(m.mk[tier])}</div><div class="cost-line">${this.costHtml(cost)}</div></div>
          <button class="btn small" data-action="modup:${id}:${slot}" ${ok ? '' : 'disabled'}>UPGRADE</button></div>`;
      } else if (cur) h += `<div class="mod-up max" style="--c:${MODS[cur].color}"><div class="mo-name">MK III &middot; FULLY UPGRADED</div></div>`;
      for (const mid in MODS) {
        const m = MODS[mid];
        if (m.slot !== slot) continue;
        const cost = modCost(m, w), on = cur === mid, ok = anvil && !on && canAfford(p.inv, cost);
        h += `<div class="mod-opt${on ? ' on' : ''}" style="--c:${m.color}"><i></i><div class="mo-info"><div class="mo-name">${m.name.toUpperCase()} ${on ? MK_NAMES[tier] : 'MK I'}</div>
          <div class="mo-desc">${m.text(m.mk[on ? tier - 1 : 0])}</div>${on ? '' : `<div class="cost-line">${this.costHtml(cost)}</div>`}</div>
          <button class="btn small" data-action="mod:${id}:${mid}" ${ok ? '' : 'disabled'}>${on ? 'ON' : cur ? 'SWAP' : 'ATTACH'}</button></div>`;
      }
      h += '</div>';
    }
    const have = p.skins[id] || [], cur = p.skin[id] || '';
    h += `<div class="mod-slot"><div class="mod-head"><span>SKIN</span><b style="color:${cur ? SKINS[cur].color : 'var(--text)'}">${cur ? SKINS[cur].name.toUpperCase() : 'DEFAULT'}</b></div><div class="skin-row">`;
    h += `<button class="btn small ${cur ? '' : 'on'}" data-action="skin:${id}:">DEFAULT</button>`;
    for (const sk in SKINS) {
      const found = have.includes(sk);
      h += `<button class="btn small skin-${sk} ${cur === sk ? 'on' : ''}" data-action="skin:${id}:${sk}" ${found ? '' : 'disabled'}>${SKINS[sk].name.toUpperCase()}${found ? '' : ' &middot; NOT FOUND'}</button>`;
    }
    h += `</div><div class="mo-desc">${have.length < Object.keys(SKINS).length ? 'Skins drop from mythic chests (and sometimes legendary ones) for a weapon you own.' : 'Every skin found for this weapon.'}</div></div></div>`;
    return h;
  },

  tab_survivor() {
    const p = Game.player, cls = Classes.get(p);
    let h = `<div class="cls-now" style="--c:${cls.color}"><img src="${iconUrl('class', cls.id)}" alt=""><div><div class="cls-name">${cls.name.toUpperCase()}</div>
      <ul>${cls.perks.map(t => `<li>${t}</li>`).join('')}</ul></div></div>`;
    h += Game.phase === 'break' ? '' : '<div class="notice">SURVIVOR UPGRADES ARE ONLY AVAILABLE BETWEEN WAVES</div>';
    h += '<div class="grid2">';
    for (const u of SURVIVOR_UPGRADES) {
      const n = p.upgrades[u.id];
      if (n >= u.max) { h += this.card(null, `${u.name.toUpperCase()} <span class="stars">MAX</span>`, u.desc); continue; }
      const cost = u.cost(n), ok = Game.phase === 'break' && canAfford(p.inv, cost);
      h += this.card(null, `${u.name.toUpperCase()} <span class="stars">${n}/${u.max}</span>`, u.desc, this.costHtml(cost),
        `<button class="btn" data-action="survivor:${u.id}" ${ok ? '' : 'disabled'}>BUY</button>`);
    }
    return h + '</div>';
  },

  menuAction(action) {
    const [kind, id, arg] = action.split(':');
    const p = Game.player;
    if (kind !== 'throw') this.throwConfirm = null;
    if (kind === 'modsel') {
      this.modSel = id;
      Sound.play('click');
    } else if (kind === 'mod') {
      const w = WEAPON_BY_ID[id], m = MODS[arg], cost = modCost(m, w), md = Weapons.mods(p, id);
      if (!Structures.nearAnvil(p) || md[m.slot] === arg || !canAfford(p.inv, cost)) return Sound.play('error');
      payCost(p.inv, cost);
      p.mods[id] = Object.assign({}, md, { [m.slot]: arg, mk: Object.assign({}, md.mk, { [m.slot]: 1 }) });
      Sound.play('modattach');
      this.toast(`${m.name.toUpperCase()} ATTACHED TO ${w.name.toUpperCase()}`, m.color);
    } else if (kind === 'modup') {
      const w = WEAPON_BY_ID[id], md = Weapons.mods(p, id), m = MODS[md[arg]], tier = Weapons.modTier(p, id, arg);
      if (!m || tier >= MOD_MAX_TIER) return Sound.play('error');
      const cost = modTierCost(m, w, tier + 1);
      if (!Structures.nearAnvil(p) || !canAfford(p.inv, cost)) return Sound.play('error');
      payCost(p.inv, cost);
      p.mods[id] = Object.assign({}, md, { mk: Object.assign({}, md.mk, { [arg]: tier + 1 }) });
      Sound.play('modattach'); Sound.play('upgrade');
      this.toast(`${m.name.toUpperCase()} NOW ${MK_NAMES[tier + 1]}`, m.color);
    } else if (kind === 'unmod') {
      const md = Object.assign({}, Weapons.mods(p, id));
      delete md[arg];
      md.mk = Object.assign({}, md.mk);
      delete md.mk[arg];
      p.mods[id] = md;
      if (p.mags[id] !== undefined) p.mags[id] = Math.min(p.mags[id], Weapons.magSize(p, WEAPON_BY_ID[id]));
      Sound.play('break');
    } else if (kind === 'skin') {
      if (arg && !(p.skins[id] || []).includes(arg)) return Sound.play('error');
      if (arg) p.skin[id] = arg; else delete p.skin[id];
      Sound.play(arg ? 'skin' : 'click');
    } else if (kind === 'bagsel') {
      this.bagSel = this.bagSel === id ? null : id;
      Sound.play('click');
    } else if (kind === 'hot') {
      Player.assignHotbar(p, id, Number(arg));
    } else if (kind === 'unhot') {
      Player.unassignHotbar(p, id);
    } else if (kind === 'throw') {
      if (this.throwConfirm !== id) { this.throwConfirm = id; Sound.play('click'); }
      else { this.throwConfirm = null; if (Player.throwWeapon(p, id)) this.bagSel = null; }
    } else if (kind === 'bagup') {
      Player.upgradeBag(p);
    } else if (kind === 'craft') {
      const r = RECIPES.find(x => x.id === id);
      if (!canAfford(p.inv, r.cost)) return Sound.play('error');
      payCost(p.inv, r.cost);
      for (const k in r.give) p.inv[k] += r.give[k];
      Sound.play('build');
      this.toast(`CRAFTED ${r.name.toUpperCase()}`, '#5fe05f');
    } else if (kind === 'upgrade') {
      const w = WEAPON_BY_ID[id], lvl = p.weapons[id], cost = upgradeCost(w, lvl);
      if (!Structures.nearAnvil(p) || lvl >= MAX_LEVEL || !canAfford(p.inv, cost)) return Sound.play('error');
      payCost(p.inv, cost);
      p.weapons[id]++;
      Sound.play('forge');
      this.toast(`${w.name.toUpperCase()} NOW LV${p.weapons[id]}`, RARITIES[w.rarity].color);
    } else if (kind === 'forge') {
      const w = WEAPON_BY_ID[id], cost = weaponRecipe(w);
      if (!Structures.nearAnvil(p) || p.weapons[id] || !canAfford(p.inv, cost)) return Sound.play('error');
      if (Player.bagFree(p) < 0) { this.toast('BAG FULL! THROW A WEAPON OR UPGRADE YOUR BAG', '#ff3d4e'); return Sound.play('error'); }
      payCost(p.inv, cost);
      Player.giveWeapon(p, id);
      Sound.play('forge');
      Sound.play('upgrade');
      this.toast(`FORGED ${w.name.toUpperCase()}!`, RARITIES[w.rarity].color);
    } else if (kind === 'survivor') {
      const u = SURVIVOR_UPGRADES.find(x => x.id === id), n = p.upgrades[id], cost = u.cost(n);
      if (Game.phase !== 'break' || n >= u.max || !canAfford(p.inv, cost)) return Sound.play('error');
      payCost(p.inv, cost);
      p.upgrades[id]++;
      if (id === 'vitality') { p.maxHp = Player.maxHp(p); p.hp += 20; }
      Sound.play('upgrade');
      this.toast(`${u.name.toUpperCase()} ${p.upgrades[id]}/${u.max}`, '#ffd040');
    }
    this.dirty = true;
    Save.touch();
    this.renderMenu();
  },

  // ---------- full screens ----------
  showScreen(html, cls = '') {
    this.el.screen.className = cls;
    this.el.screen.innerHTML = html;
    this.el.screen.classList.remove('hidden');
  },
  hideScreen() { this.el.screen.classList.add('hidden'); },

  controlsHtml() {
    const k = (key, what) => `<div><b>${key}</b><span>${what}</span></div>`;
    return `<div class="controls">
      ${k('WASD', 'MOVE')}${k('MOUSE', 'AIM')}${k('CLICK', 'ATTACK')}${k('RMB / F', 'ABILITY')}${k('R', 'RELOAD')}${k('1-9', 'HOTBAR')}
      ${k('E', 'OPEN / GATHER')}${k('Q', 'HEAL')}${k('B', 'BUILD')}${k('I', 'WEAPON BAG')}${k('C', 'CRAFT')}${k('U', 'FORGE')}${k('O', 'MODS')}
      ${k('N', 'NEXT WAVE')}${k('P', 'PAUSE')}${k('M', 'MUTE')}${k('K', 'MUSIC')}</div>`;
  },

  logoHtml() {
    return `<div class="logo"><div class="l1">NECROVANTA</div><div class="l2">:3030</div><div class="l3"><span></span>THE LAST CITY ON EARTH<span></span></div></div>`;
  },

  showTitle(saved) {
    const cont = saved
      ? `<button class="btn big" data-screen="continue">CONTINUE <small>WAVE ${saved.wave + 1}</small></button>` : '';
    this.showScreen(`${this.logoHtml()}
      <div class="tagline">THE YEAR IS 3030. THE DEAD HAVE RISEN. SURVIVE 100 WAVES.</div>
      <div class="features"><span>${WEAPONS.length} WEAPONS</span><span>ENDLESS WORLD</span><span>LOOT &middot; BUILD &middot; FORGE</span></div>
      <div class="buttons"><button class="btn big" data-screen="new">NEW GAME</button>${cont}<button class="btn big mpbtn" data-screen="mp">MULTIPLAYER</button></div>
      <div class="blink press">PRESS ENTER TO ${cont ? 'CONTINUE' : 'START'}</div>
      ${this.controlsHtml()}`, 'title');
  },

  // ---------- multiplayer screens ----------
  showLobby(msg = '') {
    Game.state = 'lobby';
    this.el.hud.classList.add('hidden');
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem('necrovanta_mp') || '{}') || {}; } catch (e) { /* none */ }
    const url = Net.url || saved.url || Net.defaultUrl(), name = Net.name || saved.name || 'SURVIVOR';
    this.showScreen(`<h1 class="cyan">MULTIPLAYER</h1>
      ${msg ? `<div class="mp-msg">${esc(msg)}</div>` : ''}
      <div class="mp">
        <div class="mp-row"><label>SERVER<input id="mp-url" value="${esc(url)}" spellcheck="false"></label>
          <label>YOUR NAME<input id="mp-name" value="${esc(name)}" maxlength="12" spellcheck="false"></label>
          <button class="btn" data-screen="mp-connect">CONNECT</button></div>
        <div class="mp-status" id="mp-status"></div>
        <div class="mp-cols">
          <div class="mp-panel"><div class="section-title">ROOMS <button class="btn tiny wide" data-screen="mp-refresh">REFRESH</button></div><div id="mp-rooms"></div></div>
          <div class="mp-panel"><div class="section-title">CREATE A ROOM</div>
            <label>ROOM NAME<input id="mp-room" maxlength="20" placeholder="${esc(name)} ROOM" spellcheck="false"></label>
            <label>PLAYERS<select id="mp-max"><option>2</option><option>3</option><option selected>4</option></select></label>
            <label class="mp-check"><input type="checkbox" id="mp-priv"> PRIVATE (NEEDS A PASSWORD)</label>
            <label>PASSWORD<input id="mp-newpass" type="password" maxlength="32" placeholder="FOR PRIVATE ROOMS"></label>
            <button class="btn" data-screen="mp-create">CREATE ROOM</button></div>
        </div>
        <div class="mp-error" id="mp-error"></div>
        <div class="note">THE ROOM'S HOST RUNS THE WORLD. START THE SERVER WITH: NODE SERVER.JS (SEE README)</div>
        <div class="buttons"><button class="btn" data-screen="title">BACK</button></div>
      </div>`, 'lobby');
    this.refreshLobby();
    clearInterval(this.lobbyTimer);
    this.lobbyTimer = setInterval(() => { if (Game.state === 'lobby') Net.refresh(); else clearInterval(this.lobbyTimer); }, 3000);
  },

  // Just the live parts of the lobby (so typing isn't interrupted).
  refreshLobby() {
    if (Game.state !== 'lobby') return;
    const st = $('mp-status'), list = $('mp-rooms'), err = $('mp-error');
    if (st) st.innerHTML = `<span class="${Net.connected() ? 'ok' : 'bad'}">${esc(Net.status)}</span>${Net.connected() ? ` &middot; AS ${esc(Net.name)}` : ''}`;
    if (err) err.textContent = Net.error;
    if (!list) return;
    if (!Net.connected()) { list.innerHTML = '<div class="desc">CONNECT TO A SERVER TO SEE ITS ROOMS.</div>'; return; }
    if (!Net.rooms.length) { list.innerHTML = '<div class="desc">NO ROOMS YET - CREATE ONE!</div>'; return; }
    const focused = document.activeElement && document.activeElement.id;
    const typed = {};
    for (const r of Net.rooms) { const el = $('mp-pass-' + r.id); if (el) typed[r.id] = el.value; }
    list.innerHTML = Net.rooms.map(r => {
      const id = esc(r.id), full = r.count >= r.max;
      return `<div class="mp-roomrow">
        <div class="mp-rn">${r.priv ? '<span class="lock">LOCKED</span> ' : ''}${esc(r.name)}<small>HOST ${esc(r.host)} &middot; ${r.count}/${r.max} &middot; ${r.started ? 'IN GAME, WAVE ' + (Number(r.wave) | 0) : 'IN LOBBY'}</small></div>
        ${r.priv ? `<input id="mp-pass-${id}" type="password" maxlength="32" placeholder="PASSWORD" value="${esc(typed[r.id] || '')}">` : ''}
        <button class="btn small" data-screen="mp-join:${id}" ${full ? 'disabled' : ''}>${full ? 'FULL' : 'JOIN'}</button></div>`;
    }).join('');
    if (focused && $(focused)) $(focused).focus();
  },

  showRoom() {
    const r = Net.room;
    if (!r) { this.showLobby(); return; }
    Game.state = 'room';
    const host = r.host === Net.id;
    const players = r.players.map(pl => `<div class="mp-pl">${pl.id === r.host ? '<span class="crown">HOST</span>' : ''}${esc(pl.name)}${pl.id === Net.id ? ' <small>(YOU)</small>' : ''}</div>`).join('');
    const classes = CLASSES.map(c => `<button class="mp-cls${Net.cls === c.id ? ' on' : ''}" data-screen="mp-class:${c.id}" style="--c:${c.color}" title="${esc(c.tag)}">
      <img src="${iconUrl('class', c.id)}" alt=""><span>${c.name.toUpperCase()}</span></button>`).join('');
    this.showScreen(`<h1 class="cyan">${esc(r.name)}</h1>
      <div class="mp-msg">${r.priv ? 'PRIVATE ROOM' : 'PUBLIC ROOM'} &middot; ${r.players.length}/${r.max} SURVIVORS${r.started ? ' &middot; GAME IN PROGRESS' : ''}</div>
      <div class="mp-room">
        <div class="mp-panel"><div class="section-title">SURVIVORS</div>${players}</div>
        <div class="mp-panel"><div class="section-title">YOUR CLASS</div><div class="mp-clsgrid">${classes}</div>
          <div class="desc">${CLASS_BY_ID[Net.cls].perks.map(esc).join(' &middot; ')}</div></div>
      </div>
      <div class="mp-error">${esc(Net.error)}</div>
      <div class="buttons">${host ? `<button class="btn big" data-screen="mp-start">START GAME</button>` : '<div class="note">WAITING FOR THE HOST TO START...</div>'}
        <button class="btn big" data-screen="mp-leave">LEAVE</button></div>`, 'room');
  },

  showMpGameOver(stats) {
    this.el.hud.classList.add('hidden');
    const n = v => Number(v) | 0;
    this.showScreen(`<h1>THE HORDE WON</h1><h2>YOUR WHOLE TEAM FELL ON WAVE ${n(stats.wave)}</h2>
      <div class="stats"><div><span>ZOMBIES DEFEATED</span><b>${n(stats.kills)}</b></div><div><span>TEAM SCORE</span><b>${n(stats.score)}</b></div></div>
      <div class="buttons"><button class="btn big" data-screen="mp-back">BACK TO LOBBY</button><button class="btn big" data-screen="title">TITLE</button></div>`, 'dead');
  },

  // New game: pick a survivor class (click a card).
  showClassSelect() {
    Game.state = 'classpick';
    this.el.hud.classList.add('hidden');
    const cards = CLASSES.map(c => {
      const kit = c.start.weapons.map(id => `<img src="${iconUrl('wbase', id, 'wide')}" alt="" title="${WEAPON_BY_ID[id].name}">`).join('');
      return `<button class="cls" data-screen="class:${c.id}" style="--c:${c.color}">
        <img class="cls-pic" src="${iconUrl('class', c.id)}" alt="">
        <div class="cls-name">${c.name.toUpperCase()}</div><div class="cls-tag">${c.tag}</div>
        <ul>${c.perks.map(t => `<li>${t}</li>`).join('')}</ul>
        <div class="cls-kit">${kit}</div></button>`;
    }).join('');
    this.showScreen(`<h1 class="cyan">CHOOSE YOUR SURVIVOR</h1><div class="cls-grid">${cards}</div>
      <div class="note">CLICK A SURVIVOR TO START &middot; ESC TO GO BACK</div>`, 'classpick');
  },

  showPause() {
    this.showScreen(`<h1 class="cyan">PAUSED</h1>
      <div class="stats"><div><span>WAVE</span><b>${Game.wave}</b></div><div><span>KILLS</span><b>${Game.kills}</b></div><div><span>SCORE</span><b>${Game.score}</b></div></div>
      <div class="buttons"><button class="btn big" data-screen="resume">RESUME</button>
      <button class="btn big" data-screen="mute">${Sound.muted ? 'UNMUTE' : 'MUTE'}</button>
      <button class="btn big" data-screen="music">MUSIC ${Sound.musicOn ? 'OFF' : 'ON'}</button>
      <button class="btn big" data-screen="title">QUIT</button></div>
      <div class="note">PROGRESS SAVES AUTOMATICALLY (EVERY WAVE, YOUR BUILDS, LOOT AND UPGRADES)</div>
      ${this.controlsHtml()}`, 'pause');
  },

  showGameOver() {
    this.el.hud.classList.add('hidden');
    const cp = Game.checkpoint;
    const retry = cp ? `<button class="btn big" data-screen="retry">RETRY <small>WAVE ${cp.wave + 1}</small></button>` : '';
    this.showScreen(`<h1>YOU DIED</h1><h2>THE HORDE GOT YOU ON WAVE ${Game.wave}</h2>
      <div class="stats"><div><span>ZOMBIES DEFEATED</span><b>${Game.kills}</b></div><div><span>WAVES SURVIVED</span><b>${Math.max(0, Game.wave - 1)}</b></div><div><span>SCORE</span><b>${Game.score}</b></div></div>
      <div class="buttons">${retry}<button class="btn big" data-screen="new">NEW GAME</button><button class="btn big" data-screen="title">TITLE</button></div>`, 'dead');
  },

  showVictory() {
    this.el.hud.classList.add('hidden');
    this.showScreen(`<h1 class="win">YOU MADE IT!</h1><h2>NECROVANTA:3030 &middot; ALL 100 WAVES SURVIVED</h2>
      <div class="stats"><div><span>ZOMBIES DEFEATED</span><b>${Game.kills}</b></div><div><span>WAVES SURVIVED</span><b>${MAX_WAVE}</b></div><div><span>FINAL SCORE</span><b>${Game.score}</b></div><div><span>TIME</span><b>${formatTime(Game.time)}</b></div></div>
      <div class="buttons"><button class="btn big" data-screen="new">PLAY AGAIN</button><button class="btn big" data-screen="title">TITLE</button></div>`, 'victory');
  },
};
