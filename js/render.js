// ============================================================
// render.js - draws the world to the low-res canvas each frame.
// Order: ground chunks > floor objects > y-sorted actors >
// shots/FX > overlays.
// ============================================================

const GUN_GRIP = 5;   // px from the hand to the start of a gun sprite (puts the grip in the hand)

const Render = {
  canvas: null,
  g: null,
  vignette: null,
  glowNodes: [],

  init(canvas) {
    this.canvas = canvas;
    this.g = canvas.getContext('2d');
    this.buildLightTextures();
    this.ash = Array.from({ length: 45 }, () => this.newAsh(true));
  },

  // ---------- lighting ----------
  // The world is drawn normally, then a darkness layer is laid on top with
  // soft holes cut out wherever there is light; colored glows are added on top.
  buildLightTextures() {
    const S = 128, t = makeCanvas(S, S), g = t.getContext('2d');
    const grad = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.45, 'rgba(255,255,255,0.7)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, S, S);
    this.lightTex = t;
    // Flashlight cone pointing right from its left-middle edge.
    const W = 170, H = 120, c = makeCanvas(W, H), cg = c.getContext('2d');
    cg.beginPath(); cg.moveTo(0, H / 2); cg.lineTo(W, 0); cg.lineTo(W, H); cg.closePath(); cg.clip();
    const cgrad = cg.createRadialGradient(0, H / 2, 0, 0, H / 2, W);
    cgrad.addColorStop(0, 'rgba(255,255,255,0.95)');
    cgrad.addColorStop(0.6, 'rgba(255,255,255,0.45)');
    cgrad.addColorStop(1, 'rgba(255,255,255,0)');
    cg.fillStyle = cgrad;
    cg.fillRect(0, 0, W, H);
    this.coneTex = c;
    this.glowCache = {};
  },

  glowTex(color) {
    let t = this.glowCache[color];
    if (t) return t;
    t = makeCanvas(64, 64);
    const g = t.getContext('2d'), grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, color);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    return (this.glowCache[color] = t);
  },

  drawLighting(g, cam, visible) {
    const W = Game.viewW, H = Game.viewH, L = this.lightCanvas, lg = this.lightCtx;
    lg.globalCompositeOperation = 'source-over';
    lg.clearRect(0, 0, W, H);
    lg.fillStyle = `rgba(4,3,18,${Game.ambient.toFixed(3)})`;
    lg.fillRect(0, 0, W, H);
    lg.globalCompositeOperation = 'destination-out';
    const glows = [];
    const add = (x, y, r, i, color) => {
      const sx = x - cam.x, sy = y - cam.y;
      if (sx < -r || sy < -r || sx > W + r || sy > H + r || i <= 0) return;
      lg.globalAlpha = Math.min(1, i);
      lg.drawImage(this.lightTex, sx - r, sy - r, r * 2, r * 2);
      if (color) glows.push(sx, sy, r * 0.55, i * 0.32, color);
    };
    const t = Game.time;
    const flick = (x) => (Math.sin(t * 17 + x * 0.37) + Math.sin(t * 31 + x)) > 1.1 ? 0.25 : 1;

    // Static lights of the chunks on screen.
    const cx0 = Math.floor((cam.x - 64) / CHUNK_PX), cx1 = Math.floor((cam.x + W + 64) / CHUNK_PX);
    const cy0 = Math.floor((cam.y - 64) / CHUNK_PX), cy1 = Math.floor((cam.y + H + 64) / CHUNK_PX);
    for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) {
      for (const l of World.chunk(cx, cy).lights) add(l.x, l.y, l.r, l.i * (l.flicker ? flick(l.x + l.y) : 1), l.color);
    }
    // The survivor: soft glow plus a flashlight cone toward the aim.
    const p = Game.player;
    if (p && Game.state === 'playing') {
      add(p.x, p.y - 4, 62, 0.9, null);
      lg.globalAlpha = 0.85;
      lg.save();
      lg.translate(Math.round(p.x - cam.x), Math.round(p.y - 4 - cam.y));
      lg.rotate(p.aim);
      lg.drawImage(this.coneTex, 4, -this.coneTex.height / 2);
      lg.restore();
      if (p.domeT > 0) add(p.x, p.y, 50, 0.6, '#fff27a');
    }
    for (const l of FX.lights) add(l.x, l.y, l.r, l.life / l.max, l.color);
    for (const b of Game.bullets) if (b.delay <= 0) add(b.x, b.y, 12 + b.size * 3, 0.65, b.color);
    for (const s of Game.enemyShots) add(s.x, s.y - (s.h || 0), s.kind === 'rocket' ? 22 : 14, 0.6, s.color);
    for (const d of Game.drones) add(d.x, d.y, 12, 0.5, '#ffd040');
    Bosses.lights(add);
    for (const f of Game.fields) add(f.x, f.y, f.r, 0.4 * Math.min(1, f.life / f.max * 3), f.kind === 'chrono' ? '#ffe08a' : '#b05cff');
    for (const h of Game.hazards) {
      if (h.kind === 'flare') add(h.x, h.y, 100, 0.95 * Math.min(1, h.life / h.max * 3) * (0.85 + Math.random() * 0.15), '#ff8a4a');
      else add(h.x, h.y, h.r * 2.2, 0.55 * Math.min(1, h.life / h.max * 2), h.kind === 'toxic' ? '#5aff30' : '#ff7a1a');
    }
    for (const c of Game.chests) {
      if (!visible(c.x, c.y)) continue;
      if (c.opened) add(c.x, c.y - 10, 40, c.openT / 2.5, RARITIES[c.rarity].light);
      else if (c.rarity >= 1 || c.cache) add(c.x, c.y, 18 + c.rarity * 5, 0.45 + c.rarity * 0.08, RARITIES[c.rarity].color);
    }
    for (const gw of Game.groundWeapons) add(gw.x, gw.y, 24, 0.7, RARITIES[WEAPON_BY_ID[gw.id].rarity].color);
    for (const n of this.glowNodes) {
      const col = n.kind === 'crystal' ? '#9ff8ff' : n.kind === 'voidcrystal' ? '#b05cff' : n.kind === 'core' ? '#ff5cf0' : '#3ff0ff';
      add((n.tx + 0.5) * TILE, (n.ty + 0.5) * TILE, n.kind === 'techdebris' ? 14 : 30, n.kind === 'techdebris' ? 0.4 : 0.65, col);
    }
    for (const s of Game.structures) {
      if (s.def.id === 'anvil') add(s.x, s.y, 26, 0.6, '#3ff0ff');
      else if (s.def.id === 'turret') add(s.x, s.y, 14, 0.4, '#ff3d4e');
    }
    for (const z of Game.zombies) {
      if (z.spawnT > 0 || !visible(z.x, z.y)) continue;
      const id = z.id;
      if (id === 'fire') add(z.x, z.y - 6, 30, 0.75 * flick(z.x), '#ff8a20');
      else if (id === 'electric') add(z.x, z.y - 6, 20 + (z.chargeT > 0 ? 20 : 0), 0.5, '#fff060');
      else if (id === 'toxic') add(z.x, z.y - 4, 16, 0.4, '#9aff40');
      else if (id === 'freezing') add(z.x, z.y - 4, 16, 0.4, '#9fe8ff');
      else if (id === 'cyber') add(z.x, z.y - 8, 10, 0.45, '#ff2040');
      else if (id === 'titan') add(z.x, z.y - 20, 22, 0.45, '#ff4000');
      else if (id === 'omega') add(z.x, z.y - 30, 70, 0.7, '#ff5cf0');
      else if (id === 'necro') add(z.x + 6, z.y - 16, 16, 0.5, '#c060ff');
      else if (id === 'wraith') add(z.x, z.y - 8, 14, 0.4, '#ff5cf0');
      else if (id === 'riot') add(z.x + Math.cos(z.shieldA) * 8, z.y - 5 + Math.sin(z.shieldA) * 8, 12, 0.4, '#3ff0ff');
      else if (id === 'spitter') add(z.x, z.y - 6, 10, 0.3, '#c8ff40');
      if (z.mode === 'windup') add(z.x, z.y, 30, 0.6, '#ff3a20');
      if (z.fuse > 0) add(z.x, z.y - 6, 30, 0.7, '#ffb040');
    }
    lg.globalAlpha = 1;
    lg.globalCompositeOperation = 'source-over';
    g.drawImage(L, 0, 0);

    // Additive colored glow so lights tint the scene.
    g.globalCompositeOperation = 'lighter';
    for (let i = 0; i < glows.length; i += 5) {
      const r = glows[i + 2];
      g.globalAlpha = glows[i + 3];
      g.drawImage(this.glowTex(glows[i + 4]), glows[i] - r, glows[i + 1] - r, r * 2, r * 2);
    }
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;
  },

  // Drifting ash and embers in screen space for atmosphere.
  newAsh(anywhere) {
    return {
      x: Math.random() * Game.viewW, y: anywhere ? Math.random() * Game.viewH : -4,
      vx: rand(4, 14), vy: rand(6, 16), ember: Math.random() < 0.18, t: Math.random() * 6,
    };
  },

  drawAsh(g) {
    const dt = 1 / 60;
    for (let i = 0; i < this.ash.length; i++) {
      const a = this.ash[i];
      a.t += dt;
      a.x += (a.vx + Math.sin(a.t * 2) * 6) * dt;
      a.y += a.vy * dt;
      if (a.y > Game.viewH + 4 || a.x > Game.viewW + 4) { this.ash[i] = this.newAsh(false); if (Math.random() < 0.5) { this.ash[i].x = -4; this.ash[i].y = Math.random() * Game.viewH; } continue; }
      g.fillStyle = a.ember ? (Math.sin(a.t * 9) > 0 ? '#ff9a3a' : '#ff5a10') : 'rgba(170,165,160,0.55)';
      g.fillRect(Math.round(a.x), Math.round(a.y), 1, 1);
    }
  },

  drawGroundWeapon(g, cam, gw) {
    gw.t += 1 / 60;
    const w = WEAPON_BY_ID[gw.id], r = RARITIES[w.rarity], img = Sprites.weapons[gw.id];
    const x = Math.round(gw.x - cam.x), y = Math.round(gw.y - cam.y);
    const bob = Math.round(Math.sin(gw.t * 3) * 1.5);
    g.globalAlpha = 0.35 + Math.sin(gw.t * 4) * 0.12;
    g.fillStyle = r.color;
    g.beginPath(); g.ellipse(x, y + 2, 10, 3.5, 0, 0, Math.PI * 2); g.fill();
    if (w.rarity >= 2) { g.globalAlpha = 0.18; g.fillRect(x - 2, y - 26, 4, 26); }   // loot beam
    g.globalAlpha = 1;
    this.shadow(g, x, y + 2, 10);
    g.drawImage(img, x - Math.round(img.width / 2), y - img.height - 1 + bob);
  },

  resize() {
    this.canvas.width = Game.viewW;
    this.canvas.height = Game.viewH;
    this.g.imageSmoothingEnabled = false;
    this.lightCanvas = makeCanvas(Game.viewW, Game.viewH);
    this.lightCtx = this.lightCanvas.getContext('2d');
    // Pre-rendered vignette for atmosphere.
    const v = makeCanvas(Game.viewW, Game.viewH), vg = v.getContext('2d');
    const grad = vg.createRadialGradient(Game.viewW / 2, Game.viewH / 2, Game.viewH * 0.35, Game.viewW / 2, Game.viewH / 2, Game.viewW * 0.65);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, 'rgba(5,0,15,0.55)');
    vg.fillStyle = grad;
    vg.fillRect(0, 0, Game.viewW, Game.viewH);
    this.vignette = v;
  },

  frame() {
    const g = this.g;
    const shake = Game.camera.shake;
    const cam = {
      x: Math.round(Game.camera.x + (shake ? rand(-shake, shake) : 0)),
      y: Math.round(Game.camera.y + (shake ? rand(-shake, shake) : 0)),
    };
    g.fillStyle = '#0b0b12';
    g.fillRect(0, 0, Game.viewW, Game.viewH);
    this.drawGround(g, cam);

    const view = { x0: cam.x - 32, y0: cam.y - 32, x1: cam.x + Game.viewW + 32, y1: cam.y + Game.viewH + 32 };
    const visible = (x, y) => x > view.x0 && x < view.x1 && y > view.y0 && y < view.y1;

    if (visible(World.monument.x, World.monument.y)) this.drawMonumentGlow(g, cam);
    this.drawHazards(g, cam, visible);
    this.drawFields(g, cam, visible);
    Bosses.drawGround(g, cam);

    // Flat things on the floor: spike traps, chests, drops.
    for (const s of Game.structures) if (!s.def.solid && visible(s.x, s.y)) this.drawStructure(g, cam, s);
    for (const c of Game.chests) if (visible(c.x, c.y)) this.drawChest(g, cam, c);
    for (const d of Game.drops) if (visible(d.x, d.y)) this.drawDrop(g, cam, d);
    for (const gw of Game.groundWeapons) if (visible(gw.x, gw.y)) this.drawGroundWeapon(g, cam, gw);

    // Y-sorted actors and tall objects.
    const list = [];
    const tx0 = toTile(view.x0), tx1 = toTile(view.x1), ty0 = toTile(view.y0), ty1 = toTile(view.y1);
    this.glowNodes = [];
    for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
      const n = World.nodeAt(tx, ty);
      if (!n) continue;
      list.push({ y: (ty + 1) * TILE - 1, kind: 'node', o: n });
      if (n.uses > 0 && (n.kind === 'crystal' || n.kind === 'voidcrystal' || n.kind === 'core' || n.kind === 'techdebris')) this.glowNodes.push(n);
    }
    for (const s of Game.structures) if (s.def.solid && visible(s.x, s.y)) list.push({ y: s.y + 7, kind: 'struct', o: s });
    for (const z of Game.zombies) if (visible(z.x, z.y)) list.push({ y: z.y + 4, kind: 'zombie', o: z });
    const p = Game.player;
    if (p && Game.state === 'playing' && !p.dead) list.push({ y: p.y + 4, kind: 'player', o: p });
    for (const o of Game.others) if (!o.dead && visible(o.x, o.y)) list.push({ y: o.y + 4, kind: 'player', o });   // online teammates
    list.sort((a, b) => a.y - b.y);
    for (const it of list) {
      if (it.kind === 'node') this.drawNode(g, cam, it.o);
      else if (it.kind === 'struct') this.drawStructure(g, cam, it.o);
      else if (it.kind === 'zombie') this.drawZombie(g, cam, it.o);
      else this.drawPlayer(g, cam, it.o);
    }

    this.drawBullets(g, cam);
    this.drawDrones(g, cam);
    FX.draw(g, cam);
    Bosses.drawTop(g, cam);
    if (p && Game.state === 'playing' && p.domeT > 0) this.drawDome(g, cam, p);
    this.drawAsh(g);
    this.drawLighting(g, cam, visible);
    for (const z of Game.zombies) if (visible(z.x, z.y)) this.drawZombieBar(g, cam, z);
    // Teammates' names and health.
    for (const o of Game.others) {
      if (!visible(o.x, o.y)) continue;
      const img = Sprites.text(o.dead ? o.name + ' DOWN' : o.name, o.dead ? '#ff3d4e' : '#9ae8ff');
      g.drawImage(img, Math.round(o.x - cam.x - img.width / 2), Math.round(o.y - cam.y - (o.dead ? 8 : 26)));
      if (!o.dead) this.drawBar(g, o.x - cam.x - 6, o.y - cam.y - 18, 12, o.hp / o.maxHp, '#5fe05f');
    }
    for (const s of Game.structures) if (s.hp < s.maxHp && visible(s.x, s.y)) this.drawBar(g, s.x - cam.x - 6, s.y - cam.y - 10, 12, s.hp / s.maxHp, '#ffd040');
    if (p && Game.state === 'playing' && p.reloadT > 0) this.drawBar(g, p.x - cam.x - 8, p.y - cam.y - 18, 16, 1 - p.reloadT / p.reloadMax, '#3ff0ff');
    FX.drawFloaters(g, cam);

    if (Game.state === 'playing' && Game.buildMode && !Game.menuOpen) this.drawBuildGhost(g, cam);
    g.drawImage(this.vignette, 0, 0);
    if (p && Game.state === 'playing') this.drawDamageOverlay(g, p);
    if (p && Game.state === 'playing' && Waves.inbound.length) this.drawIncoming(g);
    if (Game.state === 'playing' && !Game.menuOpen && !Game.paused) this.drawCrosshair(g);
  },

  // Draw the pre-rendered chunk images that overlap the view (rendering any new ones).
  drawGround(g, cam) {
    const cx0 = Math.floor(cam.x / CHUNK_PX), cx1 = Math.floor((cam.x + Game.viewW) / CHUNK_PX);
    const cy0 = Math.floor(cam.y / CHUNK_PX), cy1 = Math.floor((cam.y + Game.viewH) / CHUNK_PX);
    for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) {
      const c = World.chunk(cx, cy);
      const img = c.canvas || World.renderChunk(c);
      g.drawImage(img, cx * CHUNK_PX - cam.x, cy * CHUNK_PX - cam.y);
    }
  },

  shadow(g, x, y, w) {
    g.fillStyle = 'rgba(0,0,0,0.35)';
    g.fillRect(Math.round(x - w / 2), Math.round(y), w, 2);
    g.fillRect(Math.round(x - w / 2 + 1), Math.round(y - 1), w - 2, 1);
  },

  drawBar(g, x, y, w, pct, color) {
    x = Math.round(x); y = Math.round(y);
    g.fillStyle = '#000';
    g.fillRect(x - 1, y - 1, w + 2, 3);
    g.fillStyle = '#400';
    g.fillRect(x, y, w, 1);
    g.fillStyle = color;
    g.fillRect(x, y, Math.max(1, Math.round(w * clamp(pct, 0, 1))), 1);
  },

  drawMonumentGlow(g, cam) {
    const m = World.monument;
    const flicker = Math.random() < 0.08 ? 0.15 : 0.45 + Math.sin(Game.time * 3) * 0.15;
    g.globalAlpha = flicker;
    g.fillStyle = '#3ff0ff';
    g.fillRect(m.x + 13 - cam.x, m.y + 8 - cam.y, 6, 8);
    g.globalAlpha = flicker * 0.3;
    g.fillRect(m.x + 10 - cam.x, m.y + 5 - cam.y, 12, 14);
    g.globalAlpha = 1;
  },

  drawHazards(g, cam, visible) {
    for (const h of Game.hazards) {
      if (!visible(h.x, h.y)) continue;
      const a = Math.min(1, h.life / h.max * 2);
      const col = h.kind === 'toxic' ? '#5aff30' : h.kind === 'fire' ? '#ff5a10' : '#ff9a20';
      const x = Math.round(h.x - cam.x), y = Math.round(h.y - cam.y);
      g.globalAlpha = 0.3 * a;
      g.fillStyle = col;
      g.beginPath();
      g.ellipse(x, y, h.r, h.r * 0.6, 0, 0, Math.PI * 2);
      g.fill();
      g.globalAlpha = 0.6 * a;
      for (let i = 0; i < 6; i++) {
        const ang = i + Game.time * (h.kind === 'toxic' ? 0.5 : 2);
        g.fillRect(Math.round(x + Math.cos(ang) * h.r * 0.6), Math.round(y + Math.sin(ang * 1.3) * h.r * 0.35), 2, 1);
      }
      g.globalAlpha = 1;
    }
  },

  // Event Horizon singularities and Chrono Shatter time fields.
  drawFields(g, cam, visible) {
    for (const f of Game.fields) {
      if (!visible(f.x, f.y)) continue;
      const x = Math.round(f.x - cam.x), y = Math.round(f.y - cam.y);
      const a = Math.min(1, f.life / f.max * 3);
      if (f.kind === 'nebula') {
        // Drifting violet star-dust cloud.
        for (let i = 0; i < 7; i++) {
          const ang = i * 0.9 + Game.time * (0.4 + i * 0.05), rr = f.r * (0.3 + (i % 3) * 0.25);
          g.globalAlpha = 0.16 * a;
          g.fillStyle = i % 2 ? '#c88aff' : '#ff5cf0';
          g.beginPath(); g.arc(x + Math.cos(ang) * rr, y + Math.sin(ang) * rr * 0.6, 7 + (i % 3) * 2, 0, Math.PI * 2); g.fill();
        }
        g.globalAlpha = 0.9 * a; g.fillStyle = '#ffffff';
        for (let i = 0; i < 5; i++) {
          const ang = i * 1.7 + Game.time * 0.8;
          if (Math.floor(Game.time * 6 + i) % 3) g.fillRect(Math.round(x + Math.cos(ang) * f.r * 0.6), Math.round(y + Math.sin(ang) * f.r * 0.35), 1, 1);
        }
      } else if (f.kind === 'chrono') {
        g.globalAlpha = 0.15 * a;
        g.fillStyle = '#ffe08a';
        g.beginPath(); g.arc(x, y, f.r, 0, Math.PI * 2); g.fill();
        g.globalAlpha = 0.6 * a;
        g.strokeStyle = '#9ff8ff'; g.lineWidth = 1;
        g.beginPath(); g.arc(x, y, f.r, 0, Math.PI * 2); g.stroke();
        // Slow-turning clock hands.
        g.strokeStyle = '#ffe08a';
        for (const [len, sp] of [[f.r * 0.7, 0.6], [f.r * 0.45, 0.15]]) {
          const ang = Game.time * sp;
          g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(ang) * len, y + Math.sin(ang) * len); g.stroke();
        }
      } else {
        const pulse = 1 + Math.sin(Game.time * 12) * 0.15;
        g.globalAlpha = 0.1 * a;
        g.fillStyle = '#b05cff';
        g.beginPath(); g.arc(x, y, f.r, 0, Math.PI * 2); g.fill();
        g.globalAlpha = a;
        g.strokeStyle = '#ff9cf0'; g.lineWidth = 2;
        g.beginPath(); g.arc(x, y, 9 * pulse, 0, Math.PI * 2); g.stroke();
        g.fillStyle = '#05000a';
        g.beginPath(); g.arc(x, y, 7, 0, Math.PI * 2); g.fill();
      }
      g.globalAlpha = 1;
    }
  },

  drawNode(g, cam, n) {
    const alive = n.uses > 0;
    const set = Sprites.nodes[alive ? n.kind : n.kind + '_dead'];
    const img = set[n.variant % set.length];
    const shakeX = n.shake > 0 ? Math.round(Math.sin(Game.time * 60) * 1) : 0;
    n.shake = Math.max(0, n.shake - 1 / 60);
    const tall = n.kind === 'tree' || n.kind === 'deadtree' || n.kind === 'crystal' || n.kind === 'voidcrystal';
    const x = n.tx * TILE + (TILE - img.width) / 2 + shakeX - cam.x;
    const y = (n.ty + 1) * TILE - img.height - cam.y + (tall ? 1 : -1);
    if (alive && tall) this.shadow(g, n.tx * TILE + 8 - cam.x, (n.ty + 1) * TILE - 2 - cam.y, 10);
    g.drawImage(img, Math.round(x), Math.round(y));
    // Glowing resources pulse so they are easy to spot.
    if (alive && (n.kind === 'crystal' || n.kind === 'voidcrystal' || n.kind === 'core')) {
      g.globalAlpha = 0.25 + Math.sin(Game.time * 4 + n.tx) * 0.15;
      g.fillStyle = n.kind === 'crystal' ? '#9ff8ff' : n.kind === 'core' ? '#ff5cf0' : '#b05cff';
      g.beginPath(); g.arc(Math.round(n.tx * TILE + 8 - cam.x), Math.round(n.ty * TILE + 8 - cam.y), 9, 0, Math.PI * 2); g.fill();
      g.globalAlpha = 1;
    }
  },

  drawStructure(g, cam, s) {
    const x = s.tx * TILE - cam.x, y = s.ty * TILE - cam.y;
    g.drawImage(Sprites.structures[s.def.id], x, y);
    if (s.hp < s.maxHp * 0.5) {
      pxLine(g, x + 3, y + 2, x + 8, y + 9, '#1a1410');
      if (s.hp < s.maxHp * 0.25) pxLine(g, x + 12, y + 3, x + 7, y + 13, '#1a1410');
    }
    if (s.def.id === 'turret') {
      g.save();
      g.translate(x + 8, y + 7);
      g.rotate(s.angle);
      g.drawImage(Sprites.turretBarrel, -3, -3);
      g.restore();
    }
    if (s.def.id === 'anvil') {
      g.globalAlpha = 0.4 + Math.sin(Game.time * 3) * 0.3;
      g.fillStyle = '#3ff0ff';
      g.fillRect(x + 5, y + 6, 6, 1);
      g.globalAlpha = 1;
    }
    if (s.flashT > 0) { g.globalAlpha = 0.5; g.fillStyle = '#fff'; g.fillRect(x, y, 16, 16); g.globalAlpha = 1; }
  },

  drawChest(g, cam, c) {
    const r = RARITIES[c.rarity];
    const x = Math.round(c.x - cam.x), y = Math.round(c.y - cam.y);
    if ((c.rarity >= 1 || c.cache) && !c.opened) {
      g.globalAlpha = 0.25 + Math.sin(c.bob * 1.5) * 0.12 + c.rarity * 0.03;
      g.fillStyle = r.color;
      g.beginPath();
      g.ellipse(x, y + 2, 9 + c.rarity, 4 + c.rarity * 0.5, 0, 0, Math.PI * 2);
      g.fill();
      g.globalAlpha = 1;
    }
    this.shadow(g, x, y + 3, 12);
    const spr = Sprites.chests[c.rarity][c.opened ? 'open' : 'closed'];
    if (c.opened) {
      const a = clamp(c.openT / 2.5, 0, 1);
      g.globalAlpha = a * 0.5;
      g.fillStyle = r.light;
      g.fillRect(x - 4, y - 30, 8, 26);
      g.globalAlpha = a;
    }
    g.drawImage(spr, x - 6, y - 7);
    if (c.cache && !c.opened) {   // weapon caches show a small gun icon above
      const icon = Sprites.weapons.nova;
      g.globalAlpha = 0.7 + Math.sin(c.bob * 2) * 0.3;
      g.drawImage(icon, x - Math.round(icon.width / 2), y - 18 + Math.round(Math.sin(c.bob) * 1.5));
    }
    g.globalAlpha = 1;
  },

  drawDrop(g, cam, d) {
    if (d.t > 25 && Math.floor(d.t * 8) % 2) return;
    const icon = Sprites.icons[d.kind === 'heal' ? 'heart' : d.kind];
    const bob = Math.round(Math.sin(d.t * 5) * 1.5);
    this.shadow(g, d.x - cam.x, d.y - cam.y + 3, 6);
    if (d.kind === 'modkit') {   // rare Titan drop: pulsing pink beacon
      g.strokeStyle = '#ff5cf0'; g.globalAlpha = 0.4 + Math.sin(d.t * 6) * 0.3;
      g.beginPath(); g.arc(Math.round(d.x - cam.x), Math.round(d.y - cam.y - 2 + bob), 7 + Math.sin(d.t * 6) * 1.5, 0, Math.PI * 2); g.stroke();
      g.globalAlpha = 1;
    }
    g.drawImage(icon, Math.round(d.x - cam.x - 4), Math.round(d.y - cam.y - 6 + bob));
  },

  drawZombie(g, cam, z) {
    if (z.burrowed) return;   // the Hive Queen is underground
    const set = Sprites.zombies[z.id];
    const disabled = z.freezeT > 0 || z.stunT > 0 || z.liftT > 0;
    const frame = disabled ? 0 : 1 + (Math.floor(z.anim) % 2);
    const img = z.flashT > 0 ? set.flash[frame] : set.frames[frame];
    const sc = z.type.scale || 1;
    const w = img.width * sc, h = img.height * sc;
    const lunge = z.lunge > 0 ? z.facing * 2 * sc : 0;
    const lift = z.liftT > 0 ? Math.round(6 + Math.sin(Game.time * 6) * 1.5) : 0;
    const x = Math.round(z.x - cam.x), y = Math.round(z.y - cam.y);
    this.shadow(g, x, y + 3, (z.liftT > 0 ? 5 : 8) * sc);
    let visH = img.height;
    if (z.spawnT > 0) visH = Math.max(1, Math.round(img.height * (1 - z.spawnT / 0.5)));   // rising out of the ground
    // Wraith teleport target: a swirling void marker where it will appear.
    if (z.tp) {
      const tx = Math.round(z.tp.x - cam.x), ty = Math.round(z.tp.y - cam.y);
      g.strokeStyle = '#ff5cf0'; g.globalAlpha = 0.5 + Math.sin(Game.time * 30) * 0.3;
      g.beginPath(); g.ellipse(tx, ty + 2, 8 * (1 - z.tp.t), 3 * (1 - z.tp.t) + 1, 0, 0, Math.PI * 2); g.stroke();
      g.globalAlpha = 1;
    }
    // Brute wind-up: a red ground warning in the charge direction.
    if (z.mode === 'windup') {
      g.globalAlpha = 0.25 + Math.sin(Game.time * 25) * 0.15;
      g.strokeStyle = '#ff3a20'; g.lineWidth = 6;
      g.beginPath(); g.moveTo(x, y + 2); g.lineTo(x + Math.cos(z.chDir) * 90, y + 2 + Math.sin(z.chDir) * 90); g.stroke();
      g.lineWidth = 1; g.globalAlpha = 1;
    }
    let alpha = 1;
    if (z.type.phases) alpha = 0.45 + Math.sin(Game.time * 5 + z.x) * 0.15;
    if (z.tp) alpha = Math.max(0.2, z.tp.t / 0.55);
    const swell = z.fuse > 0 ? 1 + (0.65 - z.fuse) * 0.25 : 1;   // bloater about to burst
    g.save();
    g.globalAlpha = alpha;
    g.translate(x + lunge, y + 4 - lift - (h - (img.height - visH) * sc) * swell);
    if (z.facing < 0) g.scale(-1, 1);
    g.drawImage(img, 0, 0, img.width, visH, -w / 2 * swell, 0, w * swell, visH * sc * swell);
    const icy = z.freezeT > 0 ? 0.75 : (z.slowT > 0 || z.chronoT > 0) && z.type.immune !== 'slow' ? 0.4 : 0;
    if (icy) {
      g.globalAlpha = icy;
      g.drawImage(set.ice[frame], 0, 0, img.width, visH, -w / 2, 0, w, visH * sc);
      g.globalAlpha = 1;
    }
    g.restore();
    // Riot shield: a glowing energy arc on the side facing the player.
    if (z.type.shield && z.spawnT <= 0) {
      g.strokeStyle = '#3ff0ff'; g.lineWidth = 2; g.globalAlpha = 0.75;
      g.beginPath(); g.arc(x, y - 5, 9, z.shieldA - 0.9, z.shieldA + 0.9); g.stroke();
      g.strokeStyle = '#ffffff'; g.lineWidth = 1; g.globalAlpha = 0.6;
      g.beginPath(); g.arc(x, y - 5, 9, z.shieldA - 0.5, z.shieldA + 0.5); g.stroke();
      g.globalAlpha = 1;
    }
    if (z.type.named) {   // named boss: a colored ring at its feet
      g.strokeStyle = z.type.arena.color; g.globalAlpha = 0.35 + Math.sin(Game.time * 4) * 0.2;
      g.beginPath(); g.ellipse(x, y + 3, 18, 6, 0, 0, Math.PI * 2); g.stroke();
      g.globalAlpha = 1;
    }
    // Omega Titan: pulsing aura ring.
    if (z.type.final) {
      g.strokeStyle = '#ff5cf0'; g.globalAlpha = 0.35 + Math.sin(Game.time * 4) * 0.2;
      g.beginPath(); g.ellipse(x, y + 3, 26, 9, 0, 0, Math.PI * 2); g.stroke();
      g.globalAlpha = 1;
    }
    if (z.liftT > 0) {
      g.strokeStyle = '#8ab8ff'; g.globalAlpha = 0.6;
      g.beginPath(); g.ellipse(x, y + 3, 7 * sc, 2, 0, 0, Math.PI * 2); g.stroke();
      g.globalAlpha = 1;
    }
    if (z.marks > 0) {   // Singularity Balisong marks: violet pips above the head
      for (let i = 0; i < z.marks; i++) {
        g.fillStyle = i % 2 ? '#ff9cf0' : '#b05cff';
        g.fillRect(x - z.marks * 2 + i * 4 + 1, Math.round(y - h - 1), 2, 2);
      }
    }
    if (z.stickT > 0) {   // Railspike charge blinking faster before it blows
      g.fillStyle = Math.floor(Game.time * (6 + (1 - z.stickT) * 20)) % 2 ? '#ff3d4e' : '#ffd0d0';
      g.fillRect(x - 1, Math.round(y - h / 2) - 1, 3, 2);
    }
    if (z.stunT > 0) {   // little orbiting sparks
      for (let i = 0; i < 3; i++) {
        const a = Game.time * 8 + i * 2.1;
        g.fillStyle = '#fff060';
        g.fillRect(Math.round(x + Math.cos(a) * 5), Math.round(y - h + 2 + Math.sin(a) * 2), 1, 1);
      }
    }
    if (z.chargeT > 0 && Math.floor(Game.time * 20) % 2) {
      g.strokeStyle = '#fff060';
      g.lineWidth = 1;
      g.beginPath();
      g.arc(x, y - 4, 9, 0, Math.PI * 2);
      g.stroke();
    }
  },

  drawZombieBar(g, cam, z) {
    if (z.spawnT > 0 || z.type.final || z.type.named) return;
    const boss = !!z.type.boss;
    if (!boss && z.hp >= z.maxHp) return;
    const w = boss ? 24 : 12;
    this.drawBar(g, z.x - cam.x - w / 2, z.y - cam.y - (boss ? 28 : 15), w, z.hp / z.maxHp, boss ? '#ff8a20' : '#ff3040');
  },

  drawPlayer(g, cam, p) {
    if (p.invT > 0 && Math.floor(p.invT * 30) % 2) return;   // hit blink
    const frame = p.moving ? 1 + (Math.floor(p.anim) % 2) : 0;
    const set = Sprites.playerFor(p.cls), img = p.hurtT > 0 ? set.flash[frame] : set.frames[frame];
    const x = Math.round(p.x - cam.x), y = Math.round(p.y - cam.y);
    const bob = p.moving && Math.floor(p.anim) % 2 ? -1 : 0;
    const aimUp = Math.sin(p.aim) < -0.3;
    const w = Player.weapon(p);
    // Shadow Piercer stealth: the survivor shimmers when a stealth strike is ready.
    const stealthy = w && w.id === 'shadow' && Game.time - p.lastAttackT >= w.stealthTime && Game.time - (p.lastHurtT || -99) >= w.stealthTime;
    this.shadow(g, x, y + 3, 9);
    if (stealthy) g.globalAlpha = 0.45 + Math.sin(Game.time * 10) * 0.1;
    if (aimUp) this.drawHeldWeapon(g, p, x, y + bob);
    g.save();
    g.translate(x, y - 11 + bob);
    if (p.facing < 0) g.scale(-1, 1);
    g.drawImage(img, -7, 0);
    g.restore();
    if (!aimUp) this.drawHeldWeapon(g, p, x, y + bob);
    g.globalAlpha = 1;
  },

  drawHeldWeapon(g, p, x, y) {
    const w = Player.weapon(p);
    if (!w) return;
    const L = Weapons.look(p, w), img = L.img, glow = L.glow, fx = L.fx;   // skin + mods
    let angle = p.aim, push = 0;
    if (w.kind === 'knife') {
      const t = p.swingT > 0 ? 1 - p.swingT / p.swingMax : 1;
      if (p.spinT > 0) angle = p.aim + p.swingDir * (1 - p.spinT / 0.3) * Math.PI * 2;   // 360 spin slash
      else if (p.swingT > 0 && w.style === 'stab') { push = Math.sin(t * Math.PI) * 7; angle = p.aim; }
      else if (w.style === 'saw' && Game.time - p.lastAttackT < 0.25) { angle = p.aim + Math.sin(Game.time * 55) * 0.05; push = 2 + Math.sin(Game.time * 40); }
      else if (p.swingT > 0 && w.style === 'hook') angle = p.aim + p.swingDir * (w.arc / 2) * (1 - 2 * t) + Math.sin(t * Math.PI) * 0.5 * p.swingDir;
      else if (p.swingT > 0) angle = p.aim + p.swingDir * (w.arc / 2) * (1 - 2 * t);
      else angle = p.aim - p.facing * 0.7;
    }
    if (p.reloadT > 0) angle += p.facing * 0.7;   // tilt the gun down while reloading
    g.save();
    g.translate(x + p.facing * 2, y - 3);
    g.rotate(angle);
    if (Math.cos(angle) < 0) g.scale(1, -1);
    const back = (w.kind === 'knife' ? 4 : GUN_GRIP + p.recoil) - push;
    const oy = -(fx && fx.holdY !== undefined ? fx.holdY : Math.floor(img.height / 2));
    const pulse = 0.35 + Math.sin(Game.time * 6) * 0.2 + (p.charged ? 0.4 : 0);
    if (fx && fx.bali) this.drawBalisong(g, p, w, fx.bali, -back, oy, pulse);
    else {
      g.drawImage(img, -back, oy);
      // Pulsing additive glow on the weapon's energy parts.
      g.globalCompositeOperation = 'lighter';
      g.globalAlpha = pulse;
      g.drawImage(glow, -back, oy);
      if ((L.skin === 'gold' || L.skin === 'frost') && L.shine) {
        // A glint sweeps along gold and frost weapons every couple of seconds.
        const k = Math.floor((Game.time * 40) % ((img.width + 24) * 2)) - 12;
        if (k >= 0 && k < img.width - 1) { g.globalAlpha = L.skin === 'gold' ? 0.75 : 0.5; g.drawImage(L.shine, k, 0, 2, img.height, -back + k, oy, 2, img.height); }
      } else if (L.skin === 'neon') {
        g.globalAlpha = 0.3 + Math.sin(Game.time * 9) * 0.2;   // neon throb
        g.drawImage(glow, -back, oy);
      }
      if ((L.skin === 'void' || L.skin === 'frost') && L.pts) {
        // Twinkling stars (void) or ice glitter (frost) across the weapon.
        for (let i = 0; i < 3; i++) {
          const ph = Game.time * 2.2 + i * 1.7, k = Math.floor(ph), a = Math.sin((ph - k) * Math.PI);
          const [sx, sy] = L.pts[(k * 7919 + i * 104729) % L.pts.length];
          g.fillStyle = L.skin === 'void' && i % 2 ? '#ff9cf0' : '#ffffff';
          g.globalAlpha = a * 0.9; g.fillRect(-back + sx, oy + sy, 1, 1);
          if (a > 0.75) { g.globalAlpha = (a - 0.75) * 2; g.fillRect(-back + sx - 1, oy + sy, 3, 1); g.fillRect(-back + sx, oy + sy - 1, 1, 3); }
        }
      }
      if (L.skin === 'blood' && L.drips) {
        // Blood beads on the underside and drips off (always downward on screen).
        const flip = Math.cos(angle) < 0 ? -1 : 1, list = flip > 0 ? L.drips.bot : L.drips.top;
        g.globalCompositeOperation = 'source-over';
        for (let i = 0; i < 2; i++) {
          const ph = Game.time * 0.9 + i * 0.5, k = Math.floor(ph), u = ph - k;
          const [sx, sy] = list[(k * 7919 + i * 131) % list.length];
          const fall = u < 0.45 ? 0 : Math.round((u - 0.45) * 12);
          g.globalAlpha = u < 0.7 ? 1 : 1 - (u - 0.7) / 0.3;
          g.fillStyle = '#c8102a';
          g.fillRect(-back + sx, oy + sy + flip * fall, 1, 1);
          if (fall > 0) { g.fillStyle = '#7a0a14'; g.fillRect(-back + sx, oy + sy + flip * (fall - 1), 1, 1); }
        }
        g.globalCompositeOperation = 'lighter';
      }
    }
    g.globalCompositeOperation = 'lighter';
    if (fx) {
      // Chainsword teeth racing around the guide bar.
      if (fx.saw) {
        const [sx, sy, sw, sh] = fx.saw, fast = Game.time - p.lastAttackT < 0.25;
        const k = Math.floor(Game.time * (fast ? 45 : 4)) % 3;
        g.fillStyle = '#ffffff'; g.globalAlpha = fast ? 0.9 : 0.4;
        for (let i = k; i < sw; i += 3) { g.fillRect(-back + sx + i, oy + sy, 1, 1); g.fillRect(-back + sx + sw - 1 - i, oy + sy + sh - 1, 1, 1); }
      }
      // Energy pulses flowing along the glow channels toward the muzzle.
      g.fillStyle = '#ffffff';
      for (const [lx, ly, lw] of fx.lines) {
        const k = Math.floor((Game.time * 18 + lx * 3) % (lw + 5));
        if (k < lw) { g.globalAlpha = 0.85; g.fillRect(-back + lx + k, oy + ly, 1, 1); }
      }
      // Gatling barrels visibly spin while it winds up.
      const spin = w.id === 'gatling' ? Weapons.ws(p, 'gatling').spin : 0;
      if (fx.drum && spin > 0.05) {
        g.globalAlpha = 0.5 + spin * 0.4;
        const k = Math.floor(Game.time * 50 * spin) % fx.drum[3];
        g.fillRect(-back + fx.drum[0], oy + fx.drum[1] + k, fx.drum[2] + 12, 1);
      }
      // Muzzle flash at the barrel tip.
      if (p.flashT > 0 && w.kind === 'gun') {
        const f = Sprites.flashSprite(Weapons.colors(p, w)[0]);
        g.globalAlpha = 1;
        g.drawImage(f, -back + fx.muzzle[0] - 1, oy + fx.muzzle[1] - 3);
      }
    }
    g.globalCompositeOperation = 'source-over';
    g.globalAlpha = 1;
    g.restore();
  },

  // Balisong: the handle stays in the hand while the blade spins around the
  // pivot pin - a full flip on every strike, folding shut when idle.
  drawBalisong(g, p, w, b, ox, oy, pulse) {
    let rot = 0;
    if (p.swingT > 0) rot = (p.swingT / p.swingMax) * Math.PI * 2 * p.swingDir;
    else {
      const idle = Game.time - p.lastAttackT - 1.2;
      if (idle > 0) rot = Math.min(1, idle / 0.2) * Math.PI;
    }
    const folded = Math.cos(rot) < 0;
    const blade = () => {
      g.save();
      g.translate(ox + b.pivot[0], oy + b.pivot[1]);
      g.rotate(rot);
      g.drawImage(b.blade, -b.pivot[0], -b.pivot[1]);
      g.globalCompositeOperation = 'lighter'; g.globalAlpha = pulse;
      g.drawImage(b.bladeGlow, -b.pivot[0], -b.pivot[1]);
      g.restore();
    };
    if (folded) blade();   // closed: the blade hides between the handles
    g.drawImage(b.handle, ox, oy);
    g.globalCompositeOperation = 'lighter'; g.globalAlpha = pulse;
    g.drawImage(b.handleGlow, ox, oy);
    g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1;
    if (!folded) blade();
  },

  drawDome(g, cam, p) {
    const x = Math.round(p.x - cam.x), y = Math.round(p.y - cam.y - 3);
    const k = Math.min(1, p.domeT);
    g.globalAlpha = 0.15 * k;
    g.fillStyle = '#fff27a';
    g.beginPath(); g.arc(x, y, 26, 0, Math.PI * 2); g.fill();
    g.globalAlpha = (0.6 + Math.sin(Game.time * 10) * 0.2) * k;
    g.strokeStyle = '#fff27a'; g.lineWidth = 1;
    g.beginPath(); g.arc(x, y, 26, 0, Math.PI * 2); g.stroke();
    // Hex shimmer dots around the rim.
    g.fillStyle = '#ffffff';
    for (let i = 0; i < 10; i++) {
      const a = i / 10 * Math.PI * 2 + Game.time;
      g.fillRect(Math.round(x + Math.cos(a) * 26), Math.round(y + Math.sin(a) * 26), 1, 1);
    }
    g.globalAlpha = 1;
  },

  drawDrones(g, cam) {
    for (const d of Game.drones) {
      const x = Math.round(d.x - cam.x - 3), y = Math.round(d.y - cam.y - 2);
      g.drawImage(Sprites.drone, x, y);
      if (Math.floor(d.t * 20) % 2) { g.fillStyle = '#fff0a0'; g.fillRect(x - 1, y + 2, 1, 1); g.fillRect(x + 7, y + 2, 1, 1); }
    }
  },

  drawBullets(g, cam) {
    for (const b of Game.bullets) {
      if (b.delay > 0) continue;
      // Shots start inside the gun (for point-blank hits); show them once they leave the barrel.
      if (b.hideD && b.t * Math.hypot(b.vx, b.vy) < b.hideD) continue;
      const x = b.x - cam.x, y = b.y - cam.y;
      const s = Math.max(1, Math.round(b.size));
      const dx = Math.cos(b.angle), dy = Math.sin(b.angle);
      switch (b.proj) {
        case 'wave': case 'shockwave': {
          // Arc of energy facing the direction of travel.
          g.strokeStyle = b.color; g.lineWidth = b.proj === 'shockwave' ? 3 : 2;
          g.globalAlpha = b.proj === 'shockwave' ? Math.min(1, b.life * 2) : 1;
          g.beginPath(); g.arc(x - dx * s, y - dy * s, s, b.angle - 1, b.angle + 1); g.stroke();
          g.strokeStyle = '#ffffff'; g.lineWidth = 1; g.stroke();
          g.globalAlpha = 1;
          break;
        }
        case 'cyclone': {
          for (let i = 0; i < 6; i++) {
            const a = b.t * 16 + i * (Math.PI / 3), r = 3 + (i % 3) * 2;
            g.fillStyle = i % 2 ? b.color : b.glow;
            g.fillRect(Math.round(x + Math.cos(a) * r), Math.round(y + Math.sin(a) * r * 0.7), 2, 2);
          }
          g.globalAlpha = 0.25; g.fillStyle = b.color;
          g.beginPath(); g.arc(x, y, s + 2, 0, Math.PI * 2); g.fill();
          g.globalAlpha = 1;
          break;
        }
        case 'needle':
          pxLine(g, x - b.vx * 0.04, y - b.vy * 0.04, x, y, b.color);
          g.fillStyle = '#ffffff'; g.fillRect(Math.round(x), Math.round(y), 1, 1);
          break;
        case 'horizon': {
          g.globalAlpha = 0.4; g.fillStyle = b.color;
          g.beginPath(); g.arc(x, y, s + 3, 0, Math.PI * 2); g.fill();
          g.globalAlpha = 1; g.fillStyle = '#05000a';
          g.beginPath(); g.arc(x, y, s, 0, Math.PI * 2); g.fill();
          g.strokeStyle = '#ff9cf0'; g.lineWidth = 1;
          g.beginPath(); g.arc(x, y, s + 1, b.t * 10, b.t * 10 + 4); g.stroke();
          break;
        }
        case 'chrono': {
          g.strokeStyle = b.color; g.lineWidth = 1;
          g.beginPath(); g.arc(x, y, s + 1, 0, Math.PI * 2); g.stroke();
          g.strokeStyle = b.glow;
          g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(b.t * 20) * (s + 1), y + Math.sin(b.t * 20) * (s + 1)); g.stroke();
          break;
        }
        case 'shell': {
          // Mortar shell: shadow on the ground, glowing shell up in the air.
          this.shadow(g, x, y + 1, 5);
          g.fillStyle = b.color;
          g.fillRect(Math.round(x) - 2, Math.round(y - b.h) - 2, 4, 4);
          g.fillStyle = '#ffffff';
          g.fillRect(Math.round(x) - 1, Math.round(y - b.h) - 1, 2, 2);
          // landing marker
          g.strokeStyle = b.color; g.globalAlpha = 0.5;
          g.beginPath(); g.ellipse(Math.round(b.tx - cam.x), Math.round(b.ty - cam.y), b.aoe * 0.6, b.aoe * 0.25, 0, 0, Math.PI * 2); g.stroke();
          g.globalAlpha = 1;
          break;
        }
        case 'meteor': {
          // Burning meteor dropping out of orbit, with a target ring on the ground.
          this.shadow(g, x, y + 1, 6);
          const k = 1 - b.h / 150;
          g.strokeStyle = '#ffb040'; g.globalAlpha = 0.3 + k * 0.5;
          g.beginPath(); g.ellipse(Math.round(x), Math.round(y), b.aoe * (0.9 - k * 0.4), b.aoe * 0.35, 0, 0, Math.PI * 2); g.stroke();
          g.globalAlpha = 1;
          const mx = Math.round(x), my = Math.round(y - b.h);
          pxLine(g, mx - 10, my - 10, mx, my, '#ff7a1a');
          pxLine(g, mx - 6, my - 7, mx, my, '#ffd040');
          g.fillStyle = '#ffd040'; g.fillRect(mx - 2, my - 2, 4, 4);
          g.fillStyle = '#ffffff'; g.fillRect(mx - 1, my - 1, 2, 2);
          break;
        }
        case 'beacon':
          g.fillStyle = Math.floor(b.t * 16) % 2 ? '#ffffff' : b.color;
          g.fillRect(Math.round(x) - 1, Math.round(y) - 1, 3, 3);
          g.strokeStyle = b.color; g.globalAlpha = 0.6;
          g.beginPath(); g.arc(x, y, 4 + (b.t * 12) % 4, 0, Math.PI * 2); g.stroke();
          g.globalAlpha = 1;
          break;
        case 'flame': {
          // Billowing fire: white-hot core cooling to red smoke as it grows.
          const age = Math.min(1, b.t / 0.5);
          const col = age < 0.25 ? '#fff0a0' : age < 0.55 ? '#ffb020' : age < 0.8 ? '#ff5a10' : '#8a2a1a';
          g.globalAlpha = 0.85 - age * 0.5;
          g.fillStyle = col;
          g.beginPath(); g.arc(x, y, Math.max(1.5, b.size * 0.6), 0, Math.PI * 2); g.fill();
          g.globalAlpha = 1;
          break;
        }
        case 'soul': {
          // A green soul orb with a wailing face and a ghostly tail.
          g.globalAlpha = 0.3; g.fillStyle = b.color;
          g.beginPath(); g.arc(x, y, s + 3 + Math.sin(b.t * 20), 0, Math.PI * 2); g.fill();
          g.globalAlpha = 1;
          for (let i = 1; i <= 4; i++) { g.fillStyle = i % 2 ? b.color : b.glow; g.fillRect(Math.round(x - dx * i * 3 + Math.sin(b.t * 25 + i) * 1.5), Math.round(y - dy * i * 3), 2, 2); }
          g.fillStyle = '#e0ffe8'; g.beginPath(); g.arc(x, y, s, 0, Math.PI * 2); g.fill();
          g.fillStyle = '#0a1a10';
          g.fillRect(Math.round(x) - 2, Math.round(y) - 1, 1, 1); g.fillRect(Math.round(x) + 1, Math.round(y) - 1, 1, 1);
          g.fillRect(Math.round(x) - 1, Math.round(y) + 1, 2, 1);
          break;
        }
        case 'wisp':
          g.fillStyle = b.color; g.fillRect(Math.round(x) - 1, Math.round(y) - 1, 3, 3);
          g.fillStyle = '#ffffff'; g.fillRect(Math.round(x), Math.round(y), 1, 1);
          g.fillStyle = b.glow; g.fillRect(Math.round(x - dx * 3), Math.round(y - dy * 3), 1, 1);
          break;
        case 'bolt': case 'spike': case 'kunai': {
          // Physical projectiles drawn as little darts pointing along their flight.
          const len = b.proj === 'bolt' ? 7 : 5;
          pxLine(g, x - dx * len, y - dy * len, x, y, b.proj === 'kunai' ? '#9aa4b6' : '#c8c8d0');
          g.fillStyle = b.color; g.fillRect(Math.round(x) - 1, Math.round(y) - 1, 2, 2);
          if (b.proj === 'bolt') { g.fillStyle = b.glow; g.fillRect(Math.round(x - dx * len), Math.round(y - dy * len), 1, 1); }
          break;
        }
        case 'shard': case 'shardlet':
          g.fillStyle = b.color;
          g.fillRect(Math.round(x), Math.round(y) - 1, 1, 3); g.fillRect(Math.round(x) - 1, Math.round(y), 3, 1);
          g.fillStyle = '#ffffff'; g.fillRect(Math.round(x), Math.round(y), 1, 1);
          break;
        case 'plasmaball':
          g.globalAlpha = 0.35; g.fillStyle = b.color;
          g.fillRect(Math.round(x) - 2, Math.round(y) - 2, 5, 5);
          g.globalAlpha = 1;
          g.fillStyle = Math.floor(b.t * 30) % 2 ? b.glow : '#ff7a3a';
          g.fillRect(Math.round(x) - 1, Math.round(y) - 1, 3, 3);
          break;
        case 'missile':
          g.fillStyle = '#e8e0c8';
          g.fillRect(Math.round(x - dx * 2) - 1, Math.round(y - dy * 2) - 1, 2, 2);
          g.fillStyle = '#ffd040';
          g.fillRect(Math.round(x) - 1, Math.round(y) - 1, 2, 2);
          g.fillStyle = '#ff6a20';
          g.fillRect(Math.round(x - dx * 4), Math.round(y - dy * 4), 1, 1);
          break;
        case 'flare':
          pxLine(g, x - b.vx * 0.05, y - b.vy * 0.05, x, y, '#ff9a3a');
          g.fillStyle = Math.floor(b.t * 30) % 2 ? '#ffffff' : '#ffd0a0';
          g.fillRect(Math.round(x) - 1, Math.round(y) - 1, 3, 3);
          break;
        case 'ice':
          pxLine(g, x - b.vx * 0.03, y - b.vy * 0.03, x, y, '#ffffff');
          g.fillStyle = b.color;
          g.fillRect(Math.round(x) - 1, Math.round(y) - 2, 3, 5); g.fillRect(Math.round(x) - 2, Math.round(y) - 1, 5, 3);
          g.fillStyle = '#ffffff'; g.fillRect(Math.round(x), Math.round(y), 1, 1);
          break;
        default: {
          const tl = b.proj === 'redshift' ? 0.04 : 0.025;
          pxLine(g, x - b.vx * tl, y - b.vy * tl, x, y, b.color);
          if (b.proj === 'magma' || b.proj === 'genesis' || b.proj === 'grav' || b.proj === 'rift' || b.proj === 'prism') {
            g.globalAlpha = 0.35;
            g.fillStyle = b.proj === 'prism' ? ['#ff5a5a', '#5aff8a', '#5ab0ff'][Math.floor(b.t * 20) % 3] : b.color;
            g.fillRect(Math.round(x - s - 1), Math.round(y - s - 1), s * 2 + 2, s * 2 + 2);
            g.globalAlpha = 1;
          }
          g.fillStyle = b.color;
          g.fillRect(Math.round(x - s / 2), Math.round(y - s / 2), s, s);
          g.fillStyle = b.glow;
          g.fillRect(Math.round(x - s / 4), Math.round(y - s / 4), Math.max(1, s >> 1), Math.max(1, s >> 1));
        }
      }
    }
    for (const s of Game.enemyShots) {
      const x = s.x - cam.x, y = s.y - cam.y;
      if (s.kind === 'glob') {
        // Acid glob in flight + a warning ring where it will land.
        const k = s.t / s.dur;
        g.strokeStyle = '#b0ff40'; g.globalAlpha = 0.3 + k * 0.5;
        g.beginPath(); g.ellipse(Math.round(s.tx - cam.x), Math.round(s.ty - cam.y), 6 + k * 8, 3 + k * 3, 0, 0, Math.PI * 2); g.stroke();
        g.globalAlpha = 1;
        this.shadow(g, x, y + 1, 4);
        g.fillStyle = '#7acc3a'; g.fillRect(Math.round(x) - 2, Math.round(y - s.h) - 2, 4, 4);
        g.fillStyle = '#d8ff80'; g.fillRect(Math.round(x) - 1, Math.round(y - s.h) - 2, 2, 2);
        continue;
      }
      if (s.kind === 'orb') {   // crackling ball lightning
        g.globalAlpha = 0.35; g.fillStyle = '#fff060';
        g.beginPath(); g.arc(x, y, 5 + Math.sin(Game.time * 30) * 1, 0, Math.PI * 2); g.fill();
        g.globalAlpha = 1;
        g.fillStyle = '#ffffff'; g.fillRect(Math.round(x) - 1, Math.round(y) - 1, 3, 3);
        for (let i = 0; i < 3; i++) { const a = Math.random() * Math.PI * 2; g.fillStyle = '#fff060'; g.fillRect(Math.round(x + Math.cos(a) * 4), Math.round(y + Math.sin(a) * 4), 1, 1); }
        continue;
      }
      if (s.kind === 'rocket') {
        const a = Math.atan2(s.vy, s.vx), cx = Math.cos(a), cy = Math.sin(a);
        g.fillStyle = '#9aa4b6'; g.fillRect(Math.round(x - cx * 2) - 1, Math.round(y - cy * 2) - 1, 3, 3);
        g.fillStyle = '#ff3d4e'; g.fillRect(Math.round(x + cx) , Math.round(y + cy), 1, 1);
        g.fillStyle = Math.floor(Game.time * 30) % 2 ? '#ffd040' : '#ff7a1a';
        g.fillRect(Math.round(x - cx * 4), Math.round(y - cy * 4), 2, 2);
        continue;
      }
      pxLine(g, x - s.vx * 0.03, y - s.vy * 0.03, x, y, s.color);
      g.fillStyle = '#ffffff';
      g.fillRect(Math.round(x), Math.round(y), 1, 1);
    }
  },

  // Red chevrons on a ring around the survivor pointing at incoming hordes, with counts.
  drawIncoming(g) {
    const p = Game.player, cx = p.x - Game.camera.x, cy = p.y - 4 - Game.camera.y;
    const sectors = Waves.incomingSectors();
    const pulse = 0.55 + Math.sin(Game.time * 6) * 0.3;
    sectors.forEach((n, i) => {
      if (!n) return;
      const a = i / sectors.length * Math.PI * 2, dx = Math.cos(a), dy = Math.sin(a);
      const x = Math.round(cx + dx * 58), y = Math.round(cy + dy * 46);
      g.save();
      g.translate(x, y);
      g.rotate(a);
      g.globalAlpha = pulse;
      g.fillStyle = '#000';
      g.beginPath(); g.moveTo(6, 0); g.lineTo(-4, -6); g.lineTo(-1, 0); g.lineTo(-4, 6); g.closePath(); g.fill();
      g.fillStyle = '#ff3040';
      g.beginPath(); g.moveTo(5, 0); g.lineTo(-3, -4.5); g.lineTo(-0.5, 0); g.lineTo(-3, 4.5); g.closePath(); g.fill();
      g.restore();
      const img = Sprites.text(String(n), '#ff8a90');
      g.globalAlpha = 0.9;
      g.drawImage(img, Math.round(x + dx * 10 - img.width / 2), Math.round(y + dy * 9 - 3));
    });
    g.globalAlpha = 1;
  },

  drawBuildGhost(g, cam) {
    const gh = Build.ghost;
    if (!gh) return;
    const p = Game.player;
    g.globalAlpha = 0.15;
    g.strokeStyle = '#3ff0ff';
    g.beginPath();
    g.arc(Math.round(p.x - cam.x), Math.round(p.y - cam.y), BUILD_RANGE, 0, Math.PI * 2);
    g.stroke();
    const x = gh.tx * TILE - cam.x, y = gh.ty * TILE - cam.y;
    if (gh.action === 'place') {
      g.globalAlpha = 0.55;
      g.drawImage(Sprites.structures[STRUCTURES[Build.selected].id], x, y);
    }
    g.globalAlpha = 1;
    g.strokeStyle = gh.valid ? '#5fe05f' : '#ff3d4e';
    g.lineWidth = 1;
    g.strokeRect(x + 0.5, y + 0.5, TILE - 1, TILE - 1);
    if (gh.action === 'repair') {
      const img = Sprites.text('REPAIR ' + costText(Build.repairCost(gh.existing)), '#5fe05f');
      g.drawImage(img, Math.round(x + 8 - img.width / 2), y - 8);
    }
  },

  drawDamageOverlay(g, p) {
    if (p.hurtT > 0) {
      g.globalAlpha = p.hurtT * 1.2;
      g.fillStyle = '#ff0020';
      g.fillRect(0, 0, Game.viewW, Game.viewH);
    }
    const pct = p.hp / p.maxHp;
    if (pct < 0.3) {
      g.globalAlpha = (0.3 - pct) * (1.2 + Math.sin(Game.time * 6) * 0.6);
      g.strokeStyle = '#ff0020';
      g.lineWidth = 8;
      g.strokeRect(0, 0, Game.viewW, Game.viewH);
    }
    g.globalAlpha = 1;
  },

  drawCrosshair(g) {
    const x = Math.round(Input.mouse.sx), y = Math.round(Input.mouse.sy);
    const col = Game.buildMode ? '#3ff0ff' : '#ffffff';
    g.fillStyle = '#000';
    g.fillRect(x - 4, y - 1, 3, 3); g.fillRect(x + 2, y - 1, 3, 3);
    g.fillRect(x - 1, y - 4, 3, 3); g.fillRect(x - 1, y + 2, 3, 3);
    g.fillStyle = col;
    g.fillRect(x - 3, y, 2, 1); g.fillRect(x + 2, y, 2, 1);
    g.fillRect(x, y - 3, 1, 2); g.fillRect(x, y + 2, 1, 2);
  },
};
