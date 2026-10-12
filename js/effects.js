// ============================================================
// effects.js - lightweight visual effects: pixel particles,
// explosion rings, lightning bolts, melee slashes, floating text.
// ============================================================

const MAX_PARTICLES = 450;

const FX = {
  particles: [],
  rings: [],
  bolts: [],
  slashes: [],
  beams: [],
  lights: [],       // short-lived light flashes (muzzle flashes, explosions)
  floaters: [],

  clear() {
    this.particles.length = 0;
    this.rings.length = 0;
    this.bolts.length = 0;
    this.slashes.length = 0;
    this.beams.length = 0;
    this.lights.length = 0;
    this.floaters.length = 0;
  },

  burst(x, y, color, count = 6, speed = 60, life = 0.4, size = 1) {
    for (let i = 0; i < count; i++) {
      if (this.particles.length >= MAX_PARTICLES) this.particles.shift();
      const a = Math.random() * Math.PI * 2, s = speed * (0.3 + Math.random() * 0.7);
      this.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: life * (0.5 + Math.random() * 0.5), max: life, color, size });
    }
  },

  // A single drifting particle (flames, toxic drips, sparks).
  puff(x, y, color, vy = -20, life = 0.5) {
    if (this.particles.length >= MAX_PARTICLES) return;
    this.particles.push({ x: x + rand(-3, 3), y: y + rand(-3, 3), vx: rand(-8, 8), vy, life, max: life, color, size: 1 });
  },

  ring(x, y, radius, color, life = 0.3) {
    this.rings.push({ x, y, r: radius, color, life, max: life });
  },

  bolt(x1, y1, x2, y2, color = '#fff060', life = 0.15) {
    // Pre-compute a jagged path so it doesn't jitter every frame.
    const pts = [[x1, y1]];
    const segs = Math.max(3, Math.floor(dist(x1, y1, x2, y2) / 8));
    for (let i = 1; i < segs; i++) {
      const t = i / segs;
      pts.push([lerp(x1, x2, t) + rand(-4, 4), lerp(y1, y2, t) + rand(-4, 4)]);
    }
    pts.push([x2, y2]);
    this.bolts.push({ pts, color, life, max: life });
  },

  // style: 'slash' arc, 'stab' thrust, 'claw' three rakes, 'heavy' wide thick arc,
  // 'flip' double-arc flick, 'hook' arc curling inward, 'spin' full circle, 'saw' sparks.
  slash(x, y, angle, arc, reach, color, style = 'slash') {
    if (style === 'saw') {   // chainsword: a spray of sparks at the bar instead of an arc
      this.burst(x + Math.cos(angle) * reach * 0.75, y + Math.sin(angle) * reach * 0.75, Math.random() < 0.5 ? '#ffffff' : color, 3, 90, 0.18);
      return;
    }
    const life = style === 'heavy' || style === 'spin' ? 0.22 : style === 'flip' ? 0.12 : 0.14;
    this.slashes.push({ x, y, angle, arc, reach, color, style, life, max: life });
  },

  beam(x1, y1, x2, y2, color, glow, width, life = 0.2) {
    this.beams.push({ x1, y1, x2, y2, color, glow, width, life, max: life });
  },

  float(x, y, text, color = '#ffffff', life = 0.8, big = false) {
    if (this.floaters.length > 60) this.floaters.shift();
    this.floaters.push({ x, y, text: String(text), color, life, max: life, big });
  },

  light(x, y, r, color, life = 0.1) {
    if (this.lights.length > 40) this.lights.shift();
    this.lights.push({ x, y, r, color, life, max: life });
  },

  shake(amount) {
    Game.camera.shake = Math.max(Game.camera.shake, amount);
  },

  update(dt) {
    const step = (list, fn) => {
      for (let i = list.length - 1; i >= 0; i--) {
        const e = list[i];
        e.life -= dt;
        if (e.life <= 0) { list.splice(i, 1); continue; }
        if (fn) fn(e);
      }
    };
    step(this.particles, p => { p.x += p.vx * dt; p.y += p.vy * dt; p.vx *= 0.92; p.vy *= 0.92; });
    step(this.rings);
    step(this.bolts);
    step(this.slashes);
    step(this.beams);
    step(this.lights);
    step(this.floaters, f => { f.y -= 18 * dt; });
    Game.camera.shake = Math.max(0, Game.camera.shake - dt * 12);
  },

  draw(g, cam) {
    for (const r of this.rings) {
      const t = 1 - r.life / r.max;
      const rad = r.r * (0.3 + t * 0.7);
      g.globalAlpha = 1 - t;
      g.strokeStyle = r.color;
      g.lineWidth = 2;
      g.beginPath();
      g.arc(Math.round(r.x - cam.x), Math.round(r.y - cam.y), rad, 0, Math.PI * 2);
      g.stroke();
      if (t < 0.35) {
        g.globalAlpha = 0.35 * (1 - t / 0.35);
        g.fillStyle = r.color;
        g.fill();
      }
    }
    g.globalAlpha = 1;

    for (const s of this.slashes) {
      const t = 1 - s.life / s.max;
      const sx = Math.round(s.x - cam.x), sy = Math.round(s.y - cam.y);
      g.globalAlpha = 1 - t * 0.7;
      if (s.style === 'whip') {
        // A rippling chain lash that snaps outward.
        const len = s.reach * Math.min(1, t * 2.5), dx = Math.cos(s.angle), dy = Math.sin(s.angle);
        g.strokeStyle = s.color; g.lineWidth = 2;
        g.beginPath();
        for (let d = 0; d <= len; d += 3) {
          const wob = Math.sin(d * 0.35 - t * 20) * 3 * (1 - d / s.reach);
          const px2 = sx + dx * d - dy * wob, py2 = sy + dy * d + dx * wob;
          if (d === 0) g.moveTo(px2, py2); else g.lineTo(px2, py2);
        }
        g.stroke();
        g.lineWidth = 1;
      } else if (s.style === 'stab') {
        // Straight thrust line that extends then fades.
        const len = s.reach * Math.min(1, t * 3);
        const dx = Math.cos(s.angle), dy = Math.sin(s.angle);
        g.strokeStyle = s.color; g.lineWidth = 3;
        g.beginPath(); g.moveTo(sx + dx * 6, sy + dy * 6); g.lineTo(sx + dx * len, sy + dy * len); g.stroke();
        g.strokeStyle = '#ffffff'; g.lineWidth = 1; g.stroke();
      } else if (s.style === 'hook' || s.style === 'spin') {
        // Hook: the arc curls inward like the karambit's claw. Spin: a full ring.
        const n = 14, sweep = (s.style === 'spin' ? Math.PI * 2 : s.arc) * Math.min(1, t * 2.5);
        const a0 = s.style === 'spin' ? s.angle : s.angle - s.arc / 2;
        for (const [col, lw] of [[s.color, 3], ['#ffffff', 1]]) {
          g.strokeStyle = col; g.lineWidth = lw;
          g.beginPath();
          for (let i = 0; i <= n; i++) {
            const u = i / n, a = a0 + sweep * u;
            const r = s.reach * (s.style === 'hook' ? 0.85 - 0.35 * u * u : 0.85);
            if (i === 0) g.moveTo(sx + Math.cos(a) * r, sy + Math.sin(a) * r); else g.lineTo(sx + Math.cos(a) * r, sy + Math.sin(a) * r);
          }
          g.stroke();
        }
        g.lineWidth = 1;
      } else {
        const rakes = s.style === 'claw' ? [-4, 0, 4] : s.style === 'flip' ? [-2, 2] : [0];
        for (const off of rakes) {
          g.strokeStyle = s.color;
          g.lineWidth = s.style === 'heavy' ? 5 : s.style === 'claw' || s.style === 'flip' ? 2 : 3;
          g.beginPath();
          const a0 = s.angle - s.arc / 2, a1 = a0 + s.arc * Math.min(1, t * 2.5);
          g.arc(sx, sy, s.reach * 0.8 + off, a0, a1);
          g.stroke();
          g.strokeStyle = '#ffffff';
          g.lineWidth = 1;
          g.stroke();
        }
      }
    }
    g.globalAlpha = 1;

    for (const b of this.beams) {
      const k = b.life / b.max;
      const x1 = b.x1 - cam.x, y1 = b.y1 - cam.y, x2 = b.x2 - cam.x, y2 = b.y2 - cam.y;
      g.lineCap = 'round';
      g.globalAlpha = 0.35 * k;
      g.strokeStyle = b.color; g.lineWidth = b.width * 2.2 * (0.6 + k * 0.4);
      g.beginPath(); g.moveTo(x1, y1); g.lineTo(x2, y2); g.stroke();
      g.globalAlpha = k;
      g.strokeStyle = Math.floor(Game.time * 40) % 2 ? b.color : b.glow; g.lineWidth = b.width * k + 1;
      g.stroke();
      g.strokeStyle = '#ffffff'; g.lineWidth = Math.max(1, b.width * 0.4 * k);
      g.stroke();
      g.lineCap = 'butt';
    }
    g.globalAlpha = 1;

    for (const b of this.bolts) {
      g.globalAlpha = b.life / b.max;
      for (let i = 1; i < b.pts.length; i++) {
        pxLine(g, b.pts[i - 1][0] - cam.x, b.pts[i - 1][1] - cam.y, b.pts[i][0] - cam.x, b.pts[i][1] - cam.y, b.color);
      }
    }
    g.globalAlpha = 1;

    for (const p of this.particles) {
      g.globalAlpha = Math.min(1, (p.life / p.max) * 1.5);
      g.fillStyle = p.color;
      g.fillRect(Math.round(p.x - cam.x), Math.round(p.y - cam.y), p.size, p.size);
    }
    g.globalAlpha = 1;
  },

  drawFloaters(g, cam) {
    for (const f of this.floaters) {
      const img = Sprites.text(f.text, f.color), k = f.big ? 2 : 1;
      // Big hits pop in larger then settle.
      const pop = f.big ? 1 + Math.max(0, (f.life / f.max - 0.75)) * 2 : 1;
      const w = Math.round(img.width * k * pop), h = Math.round(img.height * k * pop);
      g.globalAlpha = Math.min(1, f.life / f.max * 2);
      g.drawImage(img, Math.round(f.x - cam.x - w / 2), Math.round(f.y - cam.y - (h - img.height)), w, h);
    }
    g.globalAlpha = 1;
  },
};
