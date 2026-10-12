// ============================================================
// input.js - keyboard + mouse state.
// Input.down[key] is held keys; Input.pressed holds keys pressed this frame.
// ============================================================

const Input = {
  down: {},
  pressed: new Set(),
  mouse: { sx: 0, sy: 0, x: 0, y: 0, left: false, right: false, leftClick: false, rightClick: false },
  wheel: 0,

  init(canvas) {
    window.addEventListener('keydown', e => {
      if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;   // typing a name or password
      const k = e.key.toLowerCase();
      if (['tab', ' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(k)) e.preventDefault();
      if (!this.down[k]) this.pressed.add(k);
      this.down[k] = true;
      Sound.resume();
    });
    window.addEventListener('keyup', e => { this.down[e.key.toLowerCase()] = false; });
    window.addEventListener('blur', () => { this.down = {}; this.mouse.left = this.mouse.right = false; });

    canvas.addEventListener('mousemove', e => {
      this.mouse.sx = e.clientX / Game.scale;
      this.mouse.sy = e.clientY / Game.scale;
    });
    canvas.addEventListener('mousedown', e => {
      Sound.resume();
      if (e.button === 0) { this.mouse.left = true; this.mouse.leftClick = true; }
      if (e.button === 2) { this.mouse.right = true; this.mouse.rightClick = true; }
    });
    window.addEventListener('mouseup', e => {
      if (e.button === 0) this.mouse.left = false;
      if (e.button === 2) this.mouse.right = false;
    });
    canvas.addEventListener('contextmenu', e => e.preventDefault());
    canvas.addEventListener('wheel', e => {
      e.preventDefault();
      this.wheel += Math.sign(e.deltaY);
    }, { passive: false });
  },

  // Convert the mouse's screen position into world coordinates.
  updateWorldMouse() {
    this.mouse.x = this.mouse.sx + Game.camera.x;
    this.mouse.y = this.mouse.sy + Game.camera.y;
  },

  isDown(...keys) { return keys.some(k => this.down[k]); },
  wasPressed(...keys) { return keys.some(k => this.pressed.has(k)); },

  endFrame() {
    this.pressed.clear();
    this.mouse.leftClick = false;
    this.mouse.rightClick = false;
    this.wheel = 0;
  },
};
