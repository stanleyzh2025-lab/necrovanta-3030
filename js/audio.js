// ============================================================
// audio.js - synthesized sound with the Web Audio API (no audio files).
// Signal chain: voices -> stereo panner -> sfx bus (+ reverb send)
//               -> master -> compressor -> speakers.
// Sounds made in the world are panned and fade with distance from
// the camera. Music is a small procedural synthwave sequencer.
// ============================================================

const midiHz = n => 440 * Math.pow(2, (n - 69) / 12);

const Sound = {
  remoteGain: 1,
  ctx: null,
  master: null,
  sfxBus: null,
  musicBus: null,
  reverb: null,
  noiseBuf: null,
  brownBuf: null,
  muted: false,
  musicOn: true,
  voices: 0,
  last: {},          // name -> time last played (throttling)
  P: { pan: 0, gain: 1 },   // placement of the sound being played
  ambientT: 6,

  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const c = this.ctx = new AC();
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -16; comp.knee.value = 10; comp.ratio.value = 4;
    comp.attack.value = 0.003; comp.release.value = 0.2;
    comp.connect(c.destination);
    this.master = c.createGain();
    this.master.gain.value = this.muted ? 0 : 0.55;
    this.master.connect(comp);
    this.sfxBus = c.createGain();
    this.sfxBus.connect(this.master);
    this.musicBus = c.createGain();
    this.musicBus.gain.value = this.musicOn ? 0.5 : 0;
    this.musicBus.connect(this.master);

    // Noise: white (hits, hiss) and brown (rumbles, explosions).
    const len = c.sampleRate * 2;
    this.noiseBuf = c.createBuffer(1, len, c.sampleRate);
    this.brownBuf = c.createBuffer(1, len, c.sampleRate);
    const w = this.noiseBuf.getChannelData(0), b = this.brownBuf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      w[i] = Math.random() * 2 - 1;
      last = (last + 0.02 * w[i]) / 1.02;
      b[i] = last * 3.5;
    }
    // Generated room reverb (decaying stereo noise impulse).
    const irLen = Math.floor(c.sampleRate * 1.6), ir = c.createBuffer(2, irLen, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < irLen; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / irLen, 2.6);
    }
    this.reverb = c.createConvolver();
    this.reverb.buffer = ir;
    const wet = c.createGain();
    wet.gain.value = 0.32;
    this.reverb.connect(wet).connect(this.master);
    // Slapback echo bus (big guns bouncing off the ruined buildings).
    this.echo = c.createDelay(1);
    this.echo.delayTime.value = 0.13;
    const fb = c.createGain(), ef = c.createBiquadFilter(), ew = c.createGain();
    fb.gain.value = 0.32; ef.type = 'lowpass'; ef.frequency.value = 2200; ew.gain.value = 0.3;
    this.echo.connect(ef).connect(fb).connect(this.echo);
    ef.connect(ew).connect(this.master);
    // Soft clipper for explosions.
    this.shaper = c.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) { const x = i / 512 - 1; curve[i] = Math.tanh(x * 3); }
    this.shaper.curve = curve;
    this.shaper.connect(this.sfxBus);
    this.startWind();
    Music.start();
  },

  resume() {
    this.init();
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  },

  toggleMute() {
    this.muted = !this.muted;
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.55;
    return this.muted;
  },

  toggleMusic() {
    this.musicOn = !this.musicOn;
    if (this.musicBus) this.musicBus.gain.value = this.musicOn ? 0.5 : 0;
    return this.musicOn;
  },

  // Pan and volume for a sound at world position (x, y); none = centered on the player.
  place(x, y) {
    if (x === undefined) return { pan: 0, gain: 1 };
    const cx = Game.camera.x + Game.viewW / 2, cy = Game.camera.y + Game.viewH / 2;
    const dx = x - cx, d = Math.hypot(dx, y - cy);
    return { pan: clamp(dx / (Game.viewW * 0.55), -1, 1) * 0.85, gain: clamp(1 - (d - 140) / 560, 0, 1) };
  },

  // ---------- voices ----------
  // Oscillator voice. o: type f to dur vol at delay pan filt ffreq fto fq vib vibDepth detune send dist bus
  osc(o) {
    const c = this.ctx, t = c.currentTime + (o.delay || 0), dur = o.dur;
    const vol = o.vol * (o.bus ? 1 : this.P.gain);
    if (vol < 0.002 || this.voices > 56) return;
    const src = c.createOscillator();
    src.type = o.type || 'square';
    src.frequency.setValueAtTime(o.f, t);
    if (o.to) src.frequency.exponentialRampToValueAtTime(Math.max(20, o.to), t + dur);
    if (o.detune) src.detune.value = o.detune;
    if (o.fm) {
      // FM synthesis: a modulator wobbling the carrier's pitch -> metallic sci-fi tones.
      const [ratio, index, indexTo] = o.fm;
      const m = c.createOscillator(), mg = c.createGain();
      m.frequency.setValueAtTime(o.f * ratio, t);
      if (o.to) m.frequency.exponentialRampToValueAtTime(Math.max(20, o.to * ratio), t + dur);
      mg.gain.setValueAtTime(o.f * index, t);
      if (indexTo !== undefined) mg.gain.linearRampToValueAtTime(o.f * indexTo, t + dur);
      m.connect(mg).connect(src.frequency);
      m.start(t); m.stop(t + dur + 0.05);
    }
    if (o.vib) {
      const l = c.createOscillator(), lg = c.createGain();
      l.frequency.value = o.vib;
      lg.gain.value = o.vibDepth || o.f * 0.03;
      l.connect(lg).connect(src.frequency);
      l.start(t); l.stop(t + dur + 0.05);
    }
    this.finish(src, o, t, dur, vol);
  },

  // Noise voice. o: dur vol filt ffreq fto fq at delay pan send brown rate dist
  nz(o) {
    const c = this.ctx, t = c.currentTime + (o.delay || 0), dur = o.dur;
    const vol = o.vol * (o.bus ? 1 : this.P.gain);
    if (vol < 0.002 || this.voices > 56) return;
    const src = c.createBufferSource();
    src.buffer = o.brown ? this.brownBuf : this.noiseBuf;
    if (o.rate) src.playbackRate.value = o.rate;
    this.finish(src, Object.assign({ filt: 'bandpass', ffreq: 1500 }, o), t, dur, vol, Math.random() * 1.5);
  },

  // Shared tail: filter -> envelope -> pan -> bus (+ reverb send).
  finish(src, o, t, dur, vol, offset) {
    const c = this.ctx;
    let node = src;
    if (o.filt) {
      const f = c.createBiquadFilter();
      f.type = o.filt;
      f.frequency.setValueAtTime(o.ffreq, t);
      if (o.fto) f.frequency.exponentialRampToValueAtTime(Math.max(30, o.fto), t + dur);
      f.Q.value = o.fq || 0.9;
      node.connect(f);
      node = f;
    }
    const g = c.createGain();
    const at = o.at || 0.004;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + at);
    g.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(dur, at + 0.01));
    node.connect(g);
    let out = g;
    const pan = o.bus ? 0 : (o.pan || 0) + this.P.pan;
    if (pan && c.createStereoPanner) { const p = c.createStereoPanner(); p.pan.value = clamp(pan, -1, 1); out.connect(p); out = p; }
    out.connect(o.dist ? this.shaper : (o.bus || this.sfxBus));
    const send = o.send === undefined ? 0.12 : o.send;
    if (send > 0) { const s = c.createGain(); s.gain.value = send; out.connect(s); s.connect(this.reverb); }
    if (o.echo) { const e = c.createGain(); e.gain.value = o.echo; out.connect(e); e.connect(this.echo); }
    this.voices++;
    src.onended = () => { this.voices--; };
    if (offset !== undefined) src.start(t, offset); else src.start(t);
    src.stop(t + dur + 0.06);
  },

  // Short helpers used by the recipes below.
  t(type, f, to, dur, vol, extra) { this.osc(Object.assign({ type, f, to, dur, vol }, extra)); },
  n(filt, ffreq, dur, vol, extra) { this.nz(Object.assign({ filt, ffreq, dur, vol }, extra)); },
  arp(notes, step, type, vol, extra = {}) {
    notes.forEach((f, i) => this.t(type, f, null, step * 2.2, vol, Object.assign({ delay: i * step, at: 0.006 }, extra)));
  },

  ok(name, gap) {
    const now = this.ctx.currentTime;
    if (this.last[name] && now - this.last[name] < gap) return false;
    this.last[name] = now;
    return true;
  },

  // ---------- weapons ----------
  // Plays a weapon's sound layers from config (WEAPONS[].sfx) with a little random
  // pitch, a click transient, reverb, and a sub-bass thump for heavy weapons.
  sfx(layers, pitch = 1, key = null, rarity = 0) {
    if (!this.ctx || this.muted) return;
    if (key && !this.ok('w:' + key, 0.035)) return;
    this.P = { pan: 0, gain: 1 };
    const pv = pitch * rand(0.96, 1.04);
    for (const L of layers) {
      if (L[0] === 't') this.t(L[1], L[2] * pv, L[3] * pv, L[4], L[5], { delay: L[6] || 0, at: 0.003, filt: L[1] === 'sine' ? null : 'lowpass', ffreq: 7000, send: 0.1 });
      else this.n(L[1], L[2] * pv, L[3], L[4], { delay: L[5] || 0, send: 0.1 });
    }
    this.n('highpass', 3500, 0.02, 0.04, { send: 0 });
    if (rarity >= 3) this.t('sine', 110, 40, 0.16, 0.13, { send: 0.05 });
  },

  // ---------- named effects ----------
  play(name, x, y) {
    if (!this.ctx || this.muted) return;
    const gap = { hit: 0.035, zdie: 0.045, step: 0.08, drone: 0.05, turret: 0.05, gather: 0.05, laser: 0.06 }[name] || 0.03;
    if (!this.ok(name, gap)) return;
    this.P = this.place(x, y);
    if (this.P.gain <= 0.01) return;
    const r = rand(0.94, 1.06);   // pitch variation so repeats don't sound identical
    switch (name) {
      // --- impacts and gun handling ---
      case 'impact':
        this.n('bandpass', 2600 * r, 0.04, 0.06, { fq: 2, send: 0.05 });
        this.t('square', 900 * r, 300, 0.03, 0.02, { filt: 'lowpass', ffreq: 2500, send: 0 });
        break;
      case 'ping':
        this.t('triangle', 2600 * r, 2400, 0.28, 0.04, { send: 0.35 });
        this.t('triangle', 3900 * r, null, 0.18, 0.02, { send: 0.35 });
        break;
      case 'slice':
        this.n('bandpass', 3200 * r, 0.05, 0.08, { fq: 3, send: 0.03 });
        this.n('lowpass', 700, 0.08, 0.08, { delay: 0.01, send: 0 });
        break;
      case 'reload_mag':   // magazine release, mag out, new mag in
        this.n('bandpass', 2400, 0.025, 0.08, { fq: 4, send: 0 });
        this.n('lowpass', 1200, 0.05, 0.07, { delay: 0.08, send: 0 });
        this.n('bandpass', 1800, 0.03, 0.09, { fq: 5, delay: 0.32, send: 0 });
        this.t('square', 300, null, 0.02, 0.025, { delay: 0.33, send: 0 });
        break;
      case 'rack':         // charging handle / pump
        this.n('bandpass', 1500, 0.06, 0.1, { fq: 3, fto: 2600, send: 0 });
        this.n('bandpass', 2800, 0.03, 0.1, { fq: 5, delay: 0.09, send: 0.05 });
        break;
      case 'reload_cell':  // energy cell ejects with a hiss, power winds down
        this.t('sine', 900, 180, 0.3, 0.035, { send: 0.1 });
        this.n('highpass', 4000, 0.18, 0.04, { delay: 0.02, send: 0 });
        this.n('bandpass', 2000, 0.025, 0.07, { delay: 0.25, fq: 4, send: 0 });
        break;
      case 'powerup':      // new cell seated, capacitors charge up
        this.n('bandpass', 2200, 0.025, 0.07, { fq: 4, send: 0 });
        this.t('sine', 300, 1400, 0.22, 0.04, { fm: [2, 0.4], send: 0.15 });
        this.t('triangle', 1400, null, 0.08, 0.03, { delay: 0.2, send: 0.2 });
        break;
      case 'explode_big':
        this.n('highpass', 2500, 0.05, 0.14, { send: 0.05 });
        this.t('sine', 110 * r, 22, 0.9, 0.38, { send: 0.25 });
        this.n('lowpass', 1600, 1.0, 0.38, { brown: true, fto: 120, dist: true, send: 0.35, echo: 0.3 });
        [0.15, 0.3, 0.45].forEach(d => this.n('bandpass', 1800 * rand(0.6, 1.4), 0.05, 0.04, { delay: d }));   // debris
        break;
      // --- combat ---
      case 'hit':
        this.n('bandpass', 1800 * r, 0.05, 0.1, { fq: 1.2, send: 0.04 });
        this.t('square', 190 * r, 90, 0.045, 0.035, { filt: 'lowpass', ffreq: 1200, send: 0 });
        break;
      case 'zdie':
        this.n('bandpass', 900 * r, 0.2, 0.13, { fto: 260, fq: 2 });
        this.t('sawtooth', 230 * r, 65, 0.24, 0.06, { vib: 18, vibDepth: 25, filt: 'lowpass', ffreq: 900 });
        break;
      case 'titandie':
        this.n('lowpass', 500, 1.1, 0.35, { brown: true, fto: 80, dist: true });
        this.t('sawtooth', 110, 28, 1.3, 0.16, { vib: 6, vibDepth: 8, filt: 'lowpass', ffreq: 700, send: 0.4 });
        this.t('square', 55, 24, 1.0, 0.08, { dist: true });
        break;
      case 'hurt':
        this.t('square', 320 * r, 120, 0.17, 0.08, { filt: 'lowpass', ffreq: 1500 });
        this.t('sine', 150, 55, 0.14, 0.16, { send: 0 });
        this.n('bandpass', 600, 0.1, 0.07);
        break;
      case 'explode':
        this.t('sine', 130 * r, 28, 0.55, 0.32, { send: 0.2 });
        this.n('lowpass', 1400, 0.65, 0.34, { brown: true, fto: 160, dist: true, send: 0.3 });
        this.n('highpass', 3000, 0.25, 0.05, { delay: 0.04 });
        break;
      case 'zap':
        this.n('highpass', 5000, 0.14, 0.1);
        this.t('sawtooth', 2000 * r, 400, 0.13, 0.05, { vib: 60, vibDepth: 300 });
        break;
      case 'charge': this.t('triangle', 200, 1600, 0.45, 0.05, { vib: 12, vibDepth: 30, at: 0.05 }); break;
      case 'laser':
        this.t('square', 1600 * r, 300, 0.12, 0.05, { filt: 'lowpass', ffreq: 3000 });
        this.t('sine', 3200 * r, 600, 0.08, 0.02);
        break;
      case 'slam':
        this.n('lowpass', 320, 0.55, 0.38, { brown: true, dist: true, send: 0.3 });
        this.t('sine', 75, 26, 0.45, 0.28);
        break;
      case 'turret': this.t('square', 1000 * r, 500, 0.045, 0.035, { filt: 'lowpass', ffreq: 4000 }); this.n('highpass', 4000, 0.03, 0.03); break;
      case 'stun': this.n('highpass', 6000, 0.1, 0.08); this.t('square', 2400, 900, 0.07, 0.035); break;
      case 'freeze': [2600, 3400, 4200].forEach((f, i) => this.t('triangle', f * r, null, 0.18, 0.03, { delay: i * 0.03 })); this.n('highpass', 7000, 0.14, 0.05); break;
      case 'lift': this.t('sine', 300, 1200, 0.32, 0.06, { vib: 10, vibDepth: 40 }); break;
      case 'crit': this.t('square', 1800, 2600, 0.07, 0.05); this.t('triangle', 2600, null, 0.25, 0.04, { delay: 0.04, send: 0.3 }); break;
      case 'drone': this.t('square', 1400 * r, 1100, 0.03, 0.025); break;
      case 'arc': this.t('sawtooth', 900, 1800, 0.12, 0.05, { filt: 'lowpass', ffreq: 3500 }); this.n('bandpass', 2500, 0.08, 0.05); break;
      case 'blink':
        this.t('sine', 200, 2400, 0.22, 0.08, { send: 0.4 });
        this.n('bandpass', 800, 0.22, 0.08, { fto: 5000, fq: 2 });
        break;
      case 'dome':
        [392, 494, 587, 784].forEach((f, i) => this.t('triangle', f, null, 0.9, 0.035, { at: 0.08, delay: i * 0.05, send: 0.5 }));
        this.t('sine', 200, 400, 0.7, 0.06);
        break;
      case 'shockwave':
        this.n('lowpass', 900, 0.75, 0.38, { brown: true, fto: 120, dist: true, send: 0.35 });
        this.t('sawtooth', 180, 40, 0.65, 0.12, { filt: 'lowpass', ffreq: 900 });
        break;
      case 'gravity':
        this.t('sine', 160, 38, 0.65, 0.2, { vib: 8, vibDepth: 15, send: 0.3 });
        this.n('bandpass', 300, 0.55, 0.09, { fq: 3 });
        break;
      case 'stealth': this.t('sine', 600, 200, 0.25, 0.04, { send: 0.5 }); break;
      case 'shield':
        this.t('triangle', 1500 * r, null, 0.14, 0.05);
        this.t('triangle', 2300 * r, null, 0.12, 0.035);
        this.n('bandpass', 3000, 0.04, 0.06);
        break;
      // --- zombie specials ---
      case 'spit': this.n('bandpass', 900, 0.16, 0.11, { fto: 280, fq: 3 }); this.t('sine', 320, 110, 0.12, 0.06); break;
      case 'splat': this.n('lowpass', 800, 0.25, 0.14, { brown: true }); this.t('sine', 180, 60, 0.15, 0.06); break;
      case 'fuse': this.n('highpass', 3000, 0.6, 0.05); [0, 0.18, 0.36].forEach(d => this.t('square', 1300, null, 0.06, 0.04, { delay: d })); break;
      case 'rocket': this.n('bandpass', 1000, 0.5, 0.1, { fto: 3000 }); this.t('sawtooth', 200, 600, 0.4, 0.035, { filt: 'lowpass', ffreq: 2000 }); break;
      case 'roar':
        this.t('sawtooth', 120, 85, 0.75, 0.12, { vib: 9, vibDepth: 10, filt: 'lowpass', ffreq: 900, fq: 3, at: 0.05 });
        this.n('lowpass', 250, 0.6, 0.15, { brown: true });
        break;
      case 'summon':
        this.t('sine', 220, 440, 0.7, 0.05, { send: 0.7, at: 0.1 });
        this.t('sine', 233, 466, 0.7, 0.04, { send: 0.7, at: 0.1 });
        this.n('bandpass', 400, 0.7, 0.06, { fto: 2400, fq: 4 });
        break;
      case 'teleport': this.t('sine', 1200, 180, 0.28, 0.06, { send: 0.5 }); this.n('highpass', 2000, 0.25, 0.05, { fto: 9000 }); break;
      case 'skin':    // shimmering reveal when a skin is found or put on
        this.arp([1047, 1319, 1568, 2093, 2637], 0.05, 'triangle', 0.045, { send: 0.6 });
        this.n('highpass', 6000, 0.5, 0.03, { at: 0.05, fto: 12000 });
        break;
      case 'modattach':   // clamp, bolt, power-up
        this.n('bandpass', 2600, 0.03, 0.12, { fq: 5, send: 0 });
        this.n('bandpass', 1800, 0.03, 0.1, { fq: 5, delay: 0.09, send: 0 });
        this.t('square', 440, 880, 0.18, 0.035, { delay: 0.16, filt: 'lowpass', ffreq: 3000, send: 0.3 });
        this.t('triangle', 1320, null, 0.25, 0.03, { delay: 0.3, send: 0.5 });
        break;
      case 'shred':   // chainsword teeth biting
        this.n('bandpass', 1800 * r, 0.05, 0.06, { fq: 5, dist: true, send: 0 });
        this.t('square', 140 * r, 110, 0.05, 0.025, { filt: 'lowpass', ffreq: 1200 });
        break;
      case 'dash':    // katana dash: air rip plus a ringing plasma edge
        this.n('bandpass', 500, 0.2, 0.14, { fto: 6000, fq: 1.5 });
        this.t('sawtooth', 1400, 300, 0.22, 0.04, { fm: [2.5, 2], filt: 'lowpass', ffreq: 5000, send: 0.3 });
        this.t('triangle', 2600, null, 0.5, 0.03, { delay: 0.12, send: 0.5 });
        break;
      case 'beacon':  // orbital lock-on beeps before the meteors fall
        [1760, 1760, 2349].forEach((f, i) => this.t('square', f, null, 0.05, 0.03, { delay: i * 0.09, filt: 'lowpass', ffreq: 4000, send: 0.3 }));
        break;
      case 'souls':   // ghostly wail as the souls scatter
        this.t('sine', 520, 880, 0.6, 0.05, { vib: 7, vibDepth: 40, send: 0.7 });
        this.t('sine', 554, 830, 0.6, 0.04, { vib: 6, vibDepth: 35, send: 0.7, delay: 0.05 });
        this.n('bandpass', 900, 0.5, 0.05, { fto: 300, fq: 3 });
        break;
      // --- world / items ---
      case 'pickup':
        this.arp([880, 1320, 1760], 0.04, 'triangle', 0.05, { send: 0.2 });
        this.n('highpass', 8000, 0.06, 0.02);
        break;
      case 'gather_wood': this.n('bandpass', 700 * r, 0.07, 0.13, { fq: 2 }); this.t('triangle', 230 * r, 160, 0.06, 0.06); break;
      case 'gather_stone': this.n('bandpass', 2500 * r, 0.05, 0.1, { fq: 3 }); this.t('square', 900 * r, 700, 0.035, 0.03); break;
      case 'gather_metal': this.t('triangle', 1800 * r, 1760, 0.3, 0.04, { send: 0.25 }); this.t('triangle', 2750 * r, null, 0.22, 0.02); this.n('highpass', 3000, 0.04, 0.06); break;
      case 'gather_crystal': this.t('triangle', 2093 * r, null, 0.5, 0.04, { send: 0.5 }); this.t('triangle', 3136 * r, null, 0.4, 0.025, { delay: 0.02, send: 0.5 }); break;
      case 'heal':
        this.arp([523, 659, 784, 1047, 1319], 0.05, 'sine', 0.06, { send: 0.45 });
        this.n('highpass', 7000, 0.4, 0.015, { at: 0.1 });
        break;
      case 'build':
        this.t('sine', 170, 80, 0.13, 0.16);
        this.n('lowpass', 1500, 0.1, 0.1);
        this.n('highpass', 4000, 0.02, 0.06, { delay: 0.05 });
        break;
      case 'break':
        this.n('lowpass', 1400, 0.38, 0.24, { brown: true, fto: 200 });
        [0.05, 0.11, 0.19].forEach(d => this.n('bandpass', 2400 * rand(0.7, 1.3), 0.03, 0.05, { delay: d }));
        break;
      case 'throw': this.n('bandpass', 600, 0.18, 0.08, { fto: 2000, fq: 2 }); this.n('lowpass', 600, 0.08, 0.08, { delay: 0.25 }); break;
      case 'discover': this.arp([523, 784, 1047, 1568], 0.08, 'triangle', 0.06, { send: 0.55 }); break;
      case 'forge':
        [880, 1320, 2210].forEach((f, i) => this.t('triangle', f, null, 0.7, 0.05 - i * 0.01, { send: 0.4 }));
        this.n('bandpass', 3000, 0.08, 0.16);
        break;
      case 'upgrade':
        this.arp([523, 784, 1047, 1568, 2093], 0.055, 'square', 0.035, { filt: 'lowpass', ffreq: 4000, send: 0.35 });
        this.arp([262, 392, 523], 0.09, 'triangle', 0.05, { send: 0.3 });
        break;
      // --- gun handling ---
      case 'reload':
        this.n('highpass', 3000, 0.025, 0.07, { send: 0 });
        this.t('sawtooth', 400, 800, 0.08, 0.025, { delay: 0.05, filt: 'lowpass', ffreq: 1500, send: 0 });
        this.n('bandpass', 2200, 0.03, 0.06, { delay: 0.14, send: 0 });
        break;
      case 'reloaded':
        this.n('bandpass', 2000, 0.03, 0.07, { send: 0 });
        this.t('square', 600, null, 0.03, 0.03, { send: 0 });
        this.n('bandpass', 2600, 0.03, 0.07, { delay: 0.07, send: 0 });
        this.t('square', 900, null, 0.03, 0.03, { delay: 0.07, send: 0 });
        break;
      case 'empty': this.n('highpass', 4000, 0.02, 0.06, { send: 0 }); this.t('square', 120, null, 0.03, 0.035, { send: 0 }); break;
      // --- UI ---
      case 'click': this.t('triangle', 1200, null, 0.03, 0.035, { send: 0 }); this.t('triangle', 1800, null, 0.02, 0.02, { delay: 0.015, send: 0 }); break;
      case 'error':
        this.t('square', 180, null, 0.07, 0.05, { filt: 'lowpass', ffreq: 1200, send: 0 });
        this.t('square', 140, null, 0.08, 0.05, { delay: 0.07, filt: 'lowpass', ffreq: 1200, send: 0 });
        break;
      case 'chest0': case 'chest1': case 'chest2': case 'chest3': case 'chest4': case 'chest5': {
        const k = Number(name[5]);
        const scale = [523, 659, 784, 1047, 1319, 1568, 2093, 2637];
        this.n('lowpass', 900, 0.12, 0.12);   // lid creak / thump
        this.arp(scale.slice(0, 3 + k), 0.06 - k * 0.004, 'triangle', 0.05, { send: 0.35 });
        this.arp(scale.slice(0, 3 + k), 0.06 - k * 0.004, 'square', 0.02, { filt: 'lowpass', ffreq: 3000, detune: 7 });
        if (k >= 3) [523, 659, 784].forEach(f => this.t('sawtooth', f, null, 1.2, 0.015, { at: 0.3, filt: 'lowpass', ffreq: 1800, send: 0.6 }));
        if (k >= 4) this.n('highpass', 8000, 1.0, 0.03, { at: 0.2, send: 0.5 });
        break;
      }
      // --- waves ---
      case 'wavestart':
        this.t('sawtooth', 440, 880, 0.6, 0.06, { filt: 'lowpass', ffreq: 1800, at: 0.05, send: 0.4 });
        this.t('sawtooth', 880, 440, 0.6, 0.06, { delay: 0.6, filt: 'lowpass', ffreq: 1800, send: 0.4 });
        [0, 0.3, 0.6, 0.9].forEach(d => this.t('sine', 130, 40, 0.25, 0.25, { delay: d, send: 0.1 }));
        break;
      case 'boss':
        this.t('sawtooth', 92, 55, 1.5, 0.17, { vib: 7, vibDepth: 8, filt: 'lowpass', ffreq: 600, fq: 4, at: 0.1, send: 0.4 });
        this.t('square', 46, 30, 1.4, 0.07, { dist: true });
        this.n('lowpass', 200, 1.4, 0.25, { brown: true, at: 0.2 });
        break;
      case 'waveclear':
        this.arp([523, 659, 784, 1047, 784, 1047, 1319], 0.1, 'square', 0.04, { filt: 'lowpass', ffreq: 3500, send: 0.3 });
        this.arp([131, 165, 196, 262], 0.18, 'triangle', 0.08);
        this.n('highpass', 7000, 0.8, 0.03, { delay: 0.6, send: 0.4 });
        break;
      case 'gameover':
        this.arp([392, 349, 311, 262, 196, 131], 0.22, 'triangle', 0.08, { send: 0.6 });
        this.t('sawtooth', 65, 40, 1.8, 0.08, { filt: 'lowpass', ffreq: 400, delay: 0.3, send: 0.5 });
        break;
      case 'victory':
        this.arp([523, 523, 523, 659, 784, 659, 784, 1047, 1047, 1319, 1568], 0.14, 'square', 0.04, { filt: 'lowpass', ffreq: 4000, send: 0.35 });
        this.arp([262, 262, 330, 392, 330, 392, 523, 523, 659, 784, 784], 0.14, 'triangle', 0.07, { send: 0.3 });
        [0, 0.56, 1.12, 1.4].forEach(d => this.t('sine', 140, 45, 0.3, 0.2, { delay: d }));
        break;
    }
  },

  // ---------- guns ----------
  // Every gun has its own layered shot: a transient crack, the "body" of the
  // shot (resonant filter sweeps, FM), a sub-bass thump, and a tail/echo.
  gun(w, pitch = 1, key = w.id) {
    if (!this.ctx || this.muted) return;
    if (!this.ok('gun:' + key, key === 'gatling' || key === 'ion' ? 0.03 : 0.04)) return;
    this.P = { pan: 0, gain: this.remoteGain };   // remoteGain < 1: a teammate's shot
    const p = pitch * rand(0.97, 1.03), S = this;
    const crack = (f, v) => S.n('highpass', f, 0.03, v, { at: 0.001, send: 0.04 });
    const thump = (v, f = 120, d = 0.14) => S.t('sine', f, f * 0.3, d, v, { at: 0.002, send: 0.04 });
    const pew = (f0, f1, d, v, type = 'square', extra = {}) =>
      S.t(type, f0 * p, f1 * p, d, v, Object.assign({ filt: 'lowpass', ffreq: Math.min(12000, f0 * p * 3), fto: f1 * p * 2, fq: 6, at: 0.002 }, extra));
    const mech = (delay, f, v) => S.n('bandpass', f, 0.025, v, { delay, fq: 4, send: 0.02 });
    const casings = n => { for (let i = 0; i < n; i++) S.t('triangle', rand(2800, 4200), null, 0.05, 0.018, { delay: 0.22 + i * 0.07 + rand(0, 0.05), send: 0.1 }); };
    const recipe = {
      nova:     () => { crack(5200, 0.06); pew(1500, 450, 0.09, 0.07); S.t('sine', 2400 * p, 900 * p, 0.05, 0.025); thump(0.06, 160); },
      ion:      () => { crack(7000, 0.035); pew(2600, 1500, 0.035, 0.045, 'square', { fm: [2.01, 0.5] }); },
      scrap:    () => {
        crack(2500, 0.18);
        S.n('lowpass', 3200, 0.32, 0.34, { brown: true, fto: 260, dist: true, send: 0.3, echo: 0.35 });
        thump(0.32, 110, 0.22);
        mech(0.3, 1500, 0.09); mech(0.4, 2600, 0.1); casings(3);
      },
      echo:     () => { crack(4500, 0.04); pew(880, 1320, 0.12, 0.06, 'triangle'); S.t('sine', 440 * p, 660 * p, 0.14, 0.05, { echo: 0.8 }); },
      flare:    () => { S.n('bandpass', 1200, 0.07, 0.13); thump(0.14, 150); S.n('bandpass', 3000, 0.55, 0.05, { fto: 1400, at: 0.04, send: 0.2 }); S.t('sawtooth', 300 * p, 110 * p, 0.16, 0.03, { filt: 'lowpass', ffreq: 900 }); casings(1); },
      venom:    () => { pew(380, 140, 0.15, 0.07, 'sawtooth', { fq: 10 }); S.t('sine', 600 * p, 280 * p, 0.13, 0.04, { vib: 32, vibDepth: 90 }); S.n('bandpass', 900, 0.09, 0.05, { fq: 6 }); },
      sonic:    () => { S.t('sine', 155 * p, 52 * p, 0.38, 0.24, { vib: 22, vibDepth: 25, send: 0.3 }); S.n('bandpass', 420, 0.32, 0.11, { fq: 3, fto: 150 }); thump(0.16, 90, 0.22); },
      needle:   () => { crack(4000, 0.16); pew(3200, 700, 0.15, 0.06); thump(0.2, 130, 0.17); S.n('lowpass', 2500, 0.7, 0.06, { fto: 500, send: 0.4, echo: 0.55 }); casings(1); },
      ricochet: () => { crack(4800, 0.1); pew(1800, 900, 0.07, 0.05); S.t('triangle', 2400 * p, 2300 * p, 0.22, 0.025, { send: 0.3 }); thump(0.1, 140); casings(1); },
      prism:    () => { [1500, 1900, 2400].forEach((f, i) => S.t('triangle', f * p, f * 1.6 * p, 0.13, 0.035, { delay: i * 0.015, send: 0.3 })); S.n('highpass', 6000, 0.1, 0.03); },
      antigrav: () => { S.t('sine', 280 * p, 950 * p, 0.22, 0.09, { fm: [1.5, 1.2, 0.1] }); S.t('sine', 70, 55, 0.28, 0.1); },
      hive:     () => { thump(0.18, 160, 0.15); S.n('lowpass', 900, 0.13, 0.1); S.t('square', 600 * p, 900 * p, 0.2, 0.025, { fm: [3.03, 2], filt: 'lowpass', ffreq: 2500 }); },
      glacier:  () => { crack(6000, 0.08); S.t('triangle', 1800 * p, 700 * p, 0.17, 0.1); [2600, 3500].forEach((f, i) => S.t('triangle', f * p, null, 0.22, 0.02, { delay: 0.03 + i * 0.03, send: 0.4 })); S.n('highpass', 7000, 0.28, 0.04, { at: 0.02 }); thump(0.1, 120); },
      arcthrower: () => { S.t('sawtooth', 900 * p, 260 * p, 0.17, 0.06, { fm: [3.7, 4, 0.5], filt: 'lowpass', ffreq: 5000 }); for (let i = 0; i < 3; i++) S.n('highpass', 5000, 0.02, 0.05, { delay: rand(0, 0.1) }); },
      redshift: () => { crack(5000, 0.05); pew(820, 300, 0.06, 0.06, 'sawtooth', { fq: 8 }); },
      vortex:   () => { S.n('bandpass', 300, 0.55, 0.15, { fto: 2000, fq: 4, at: 0.1 }); S.t('sawtooth', 90 * p, 260 * p, 0.48, 0.06, { filt: 'lowpass', ffreq: 700 }); },
      rift:     () => {
        S.t('square', 500 * p, 1500 * p, 0.12, 0.04, { detune: 12, filt: 'lowpass', ffreq: 4000, pan: -0.25 });
        S.t('square', 505 * p, 1520 * p, 0.12, 0.04, { detune: -12, filt: 'lowpass', ffreq: 4000, pan: 0.25 });
        S.n('bandpass', 4000, 0.13, 0.05, { fto: 800 });
      },
      magma:    () => { thump(0.26, 130, 0.22); S.n('lowpass', 700, 0.42, 0.2, { brown: true, fto: 2000, at: 0.05 }); S.t('sawtooth', 160 * p, 60 * p, 0.26, 0.07, { filt: 'lowpass', ffreq: 600 }); },
      gatling:  () => { crack(5500, 0.04); pew(1500, 900, 0.03, 0.035); if (Math.random() < 0.3) casings(1); },
      mortar:   () => { thump(0.34, 170, 0.26); S.n('lowpass', 600, 0.32, 0.22, { brown: true, send: 0.3, echo: 0.3 }); mech(0.42, 1800, 0.06); },
      aurora:   () => {
        crack(3000, 0.1);
        S.t('sawtooth', 220 * p, 880 * p, 0.32, 0.08, { fm: [2, 3, 0.3], filt: 'lowpass', ffreq: 4000 });
        [660, 990, 1320].forEach(f => S.t('triangle', f * p, f * 1.5 * p, 0.38, 0.025, { send: 0.5 }));
        thump(0.24, 100, 0.24);
      },
      chrono:   () => {
        S.t('triangle', 1000 * p, 250 * p, 0.32, 0.1, { send: 0.5 });
        [0.08, 0.2].forEach(d => S.t('square', 1500, null, 0.03, 0.04, { delay: d, filt: 'bandpass', ffreq: 1500, fq: 8 }));
        S.n('highpass', 5000, 0.32, 0.03, { fto: 1000, at: 0.2 });
        thump(0.12, 110);
      },
      supernova: () => {
        for (let i = 0; i < 3; i++) {
          S.t('sine', 170 * p, 40 * p, 0.42, 0.2, { delay: i * 0.14 });
          S.n('lowpass', 900, 0.42, 0.16, { brown: true, delay: i * 0.14, dist: true, send: 0.3, echo: 0.2 });
        }
      },
      photon:   () => {
        crack(2500, 0.22);
        S.t('sawtooth', 3200 * p, 180 * p, 0.32, 0.08, { filt: 'lowpass', ffreq: 8000, fto: 400 });
        S.n('highpass', 1500, 0.42, 0.1, { fto: 6000, send: 0.5, echo: 0.45 });
        thump(0.32, 90, 0.32);
      },
      horizon:  () => {
        S.t('sine', 95 * p, 24 * p, 1.0, 0.27, { send: 0.3 });
        S.n('lowpass', 300, 0.8, 0.15, { brown: true, at: 0.3 });
        S.t('sawtooth', 60 * p, 30 * p, 0.8, 0.06, { fm: [0.5, 2], filt: 'lowpass', ffreq: 500 });
      },
      genesis:  () => { S.t('sine', 900 * p, 200 * p, 0.2, 0.08, { fm: [1.414, 2, 0.2] }); S.t('triangle', 1350 * p, 300 * p, 0.16, 0.05); thump(0.12, 140); },
      genesis_beam: () => {
        crack(2000, 0.2);
        [262, 392, 523, 784].forEach(f => S.t('sawtooth', f, f * 1.01, 0.6, 0.03, { filt: 'lowpass', ffreq: 3000, at: 0.02, send: 0.5 }));
        S.t('sine', 80, 30, 0.6, 0.3);
        S.n('highpass', 2000, 0.5, 0.08, { fto: 8000, send: 0.5, echo: 0.3 });
      },
      revolver: () => {
        crack(4200, 0.12);
        pew(1100, 320, 0.1, 0.07, 'sawtooth', { fq: 7 });
        thump(0.2, 120, 0.18);
        S.n('lowpass', 2200, 0.4, 0.05, { fto: 400, send: 0.35, echo: 0.4 });
        mech(0.12, 3400, 0.04);   // cylinder clicks round
      },
      shardsmg: () => { crack(7500, 0.03); S.t('triangle', 3000 * p, 1900 * p, 0.04, 0.03); S.t('triangle', 4200 * p, null, 0.03, 0.012, { delay: 0.01, send: 0.2 }); },
      scatter:  () => {
        S.n('lowpass', 2600, 0.26, 0.24, { brown: true, fto: 300, dist: true, send: 0.25 });
        pew(700, 160, 0.16, 0.06, 'sawtooth', { fq: 4 });
        S.t('sine', 1500 * p, 600 * p, 0.12, 0.03, { fm: [1.5, 3] });
        thump(0.26, 100, 0.2);
      },
      crossbow: () => {
        S.t('triangle', 300 * p, 120 * p, 0.12, 0.08, { vib: 40, vibDepth: 30 });   // string twang
        S.n('highpass', 3000, 0.06, 0.06, { at: 0.002 });
        S.t('sine', 1800 * p, 2600 * p, 0.08, 0.025, { send: 0.3 });
        mech(0.35, 2200, 0.05);
      },
      spike:    () => { crack(5000, 0.08); S.t('square', 900 * p, 2200 * p, 0.06, 0.035, { filt: 'lowpass', ffreq: 4000 }); thump(0.12, 150); S.t('triangle', 3300, null, 0.04, 0.02, { delay: 0.05 }); },
      inferno:  () => { S.n('bandpass', 900, 0.09, 0.05, { brown: true, fq: 0.8, fto: 1400 }); },
      starfall: () => {
        thump(0.22, 140, 0.2);
        S.t('sine', 400 * p, 2400 * p, 0.3, 0.06, { send: 0.5 });
        S.n('highpass', 3000, 0.25, 0.05, { fto: 9000 });
      },
      necrovanta: () => {
        S.t('sawtooth', 110 * p, 55 * p, 0.6, 0.1, { fm: [0.5, 3, 0.5], filt: 'lowpass', ffreq: 1800, send: 0.4 });
        S.t('sine', 440 * p, 220 * p, 0.5, 0.06, { vib: 9, vibDepth: 40, send: 0.6 });
        S.n('lowpass', 900, 0.5, 0.18, { brown: true, dist: true, send: 0.4, echo: 0.3 });
        thump(0.3, 80, 0.4);
      },
      seraph:   () => {
        for (let i = 0; i < 5; i++) {
          S.n('bandpass', 600, 0.36, 0.07, { fto: 3000, fq: 2.5, delay: i * 0.06, at: 0.1 });
          S.n('highpass', 4000, 0.03, 0.05, { delay: i * 0.06 });
        }
        thump(0.16, 120);
      },
    }[key];
    if (recipe) recipe();
    else this.sfx(w.sfx, pitch, null, w.rarity);
  },

  // Knife swings: an air whoosh shaped by the swing style, plus an energy hum for powered blades.
  swing(w, big = false) {
    if (!this.ctx || this.muted || w.style === 'saw' || !this.ok('swing', 0.05)) return;
    this.P = { pan: 0, gain: this.remoteGain };
    const style = w.style, r = rand(0.93, 1.07);
    if (style === 'flip') {
      // Balisong: the clack-clack of the handles, then a quick flick through the air.
      this.n('bandpass', 4200 * r, 0.012, 0.09, { fq: 6, send: 0 });
      this.n('bandpass', 3600 * r, 0.012, 0.08, { fq: 6, delay: 0.05, send: 0 });
      this.n('bandpass', 1400 * r, 0.08, 0.08, { fto: 4000, fq: 2.5, delay: 0.03 });
      if (w.rarity >= 1) this.t('sine', 1200 * r, 2000 * r, 0.1, 0.02, { send: 0.3, delay: 0.03 });
      if (big) this.t('triangle', 2400 * r, 3200 * r, 0.12, 0.03, { delay: 0.06, send: 0.4 });
      return;
    }
    if (style === 'hook') {
      // Karambit: a rising-then-falling hooked whoosh.
      this.n('bandpass', 900 * r, 0.14, 0.11, { fto: 2600 * r, fq: 2.5, at: 0.05 });
      this.n('bandpass', 2600 * r, 0.06, 0.05, { fto: 1200, fq: 3, delay: 0.09 });
      if (w.rarity >= 2) this.t('sawtooth', 300 * r, 150, 0.16, 0.025, { fm: [2, 1.5], filt: 'lowpass', ffreq: 2000 });
      if (big) { this.n('bandpass', 600, 0.3, 0.12, { fto: 3000, fq: 1.5 }); this.t('sine', 700, 1400, 0.3, 0.04, { send: 0.4 }); }
      return;
    }
    const base = (style === 'heavy' ? 450 : style === 'stab' ? 1800 : style === 'whip' ? 2400 : 1000) * r;
    const dur = style === 'heavy' ? 0.24 : style === 'stab' ? 0.09 : 0.14;
    this.n('bandpass', base * 0.6, dur, style === 'heavy' ? 0.16 : 0.11, { fto: base * 1.8, fq: 2.2, at: dur * 0.3, send: 0.05 });
    if (w.rarity >= 1 && w.id !== 'hammer' && w.id !== 'whip') {
      this.t('sawtooth', base * 0.25, base * 0.12, dur + 0.06, 0.03, { fm: [2.5, 1], filt: 'lowpass', ffreq: 2200 });
      this.t('sine', base * 0.5, base * 0.4, dur, 0.02, { send: 0.2 });
    }
    if (style === 'whip') this.n('highpass', 5000, 0.025, 0.1, { delay: 0.1 });   // the crack at the end
    if (style === 'heavy') this.t('sine', 110, 60, 0.2, 0.08);
  },

  // Mortar shell whistling down over its flight time.
  whistle(dur) {
    if (!this.ctx || this.muted) return;
    this.P = { pan: 0, gain: 1 };
    this.t('sine', 2300, 700, dur, 0.022, { delay: 0.05, at: dur * 0.4, send: 0.25 });
  },

  // Continuous voices (Gatling motor, charge whine). Call every frame with the target state.
  loops: {},
  loop(key, on, f, vol, type = 'sawtooth', ff = 1000) {
    if (!this.ctx) return;
    let L = this.loops[key];
    if (!L) {
      if (!on) return;
      const c = this.ctx, osc = c.createOscillator(), filt = c.createBiquadFilter(), g = c.createGain();
      osc.type = type; osc.frequency.value = f;
      filt.type = 'lowpass'; filt.frequency.value = ff;
      g.gain.value = 0;
      osc.connect(filt).connect(g).connect(this.sfxBus);
      osc.start();
      L = this.loops[key] = { osc, filt, g };
    }
    const t = this.ctx.currentTime;
    L.osc.frequency.setTargetAtTime(f, t, 0.05);
    L.filt.frequency.setTargetAtTime(ff, t, 0.05);
    L.g.gain.setTargetAtTime(on && !this.muted ? vol : 0, t, on ? 0.05 : 0.08);
  },
  stopLoops() { for (const k in this.loops) this.loop(k, false, 100, 0); },

  // ---------- creatures and footsteps ----------
  // Each zombie type has its own voice: base pitch, growl speed, filter "mouth" and extras.
  groanVoices: {
    normal: [110, 6, 700], armored: [95, 5, 600], hivequeen: [78, 9, 650, 'wet'], voltrax: [58, 4, 520, 'buzz'], deadking: [52, 3, 460, 'ghost'], crawler: [140, 9, 900], fast: [170, 11, 1100], spitter: [130, 7, 800, 'wet'],
    fire: [120, 6, 800, 'crackle'], bloater: [70, 4, 450, 'wet'], toxic: [115, 6, 750, 'wet'], riot: [100, 5, 650], electric: [125, 7, 900, 'buzz'],
    phantom: [300, 3, 1400, 'ghost'], cyber: [90, 12, 1200, 'buzz'], necro: [80, 3, 500, 'ghost'], freezing: [105, 5, 1000],
    brute: [60, 5, 450], titan: [52, 4, 380], leech: [700, 16, 2500], juggernaut: [58, 8, 500, 'buzz'], wraith: [220, 4, 1300, 'ghost'], omega: [38, 3, 300],
  },

  groan(type, x, y) {
    if (!this.ctx || this.muted || !this.ok('groan', 0.25)) return;
    this.P = this.place(x, y);
    if (this.P.gain <= 0.05) return;
    const [f, vib, mouth, extra] = this.groanVoices[type] || this.groanVoices.normal;
    const pf = f * rand(0.85, 1.15), dur = rand(0.55, 0.95);
    const big = f < 70;
    this.t('sawtooth', pf, pf * 0.7, dur, big ? 0.11 : 0.055, { vib, vibDepth: pf * 0.08, filt: 'lowpass', ffreq: mouth, fto: mouth * 0.6, fq: 4, at: 0.12, send: extra === 'ghost' ? 0.7 : 0.15 });
    if (big) this.n('lowpass', 200, dur, 0.1, { brown: true, at: 0.1 });
    if (extra === 'wet') this.n('bandpass', 500, dur * 0.6, 0.05, { fq: 4, delay: 0.1 });
    if (extra === 'crackle') for (let i = 0; i < 4; i++) this.n('highpass', 4000, 0.02, 0.04, { delay: rand(0, dur) });
    if (extra === 'buzz') this.t('square', pf * 4, pf * 3, dur * 0.7, 0.012, { vib: 30, vibDepth: 40 });
  },

  step(surface) {
    if (!this.ctx || this.muted) return;
    this.P = { pan: 0, gain: 1 };
    if (surface === 'hard') this.n('highpass', 2200 * rand(0.9, 1.1), 0.03, 0.028, { send: 0 });
    else if (surface === 'metal') this.t('triangle', 900 * rand(0.9, 1.1), null, 0.05, 0.015, { send: 0.1 });
    else this.n('lowpass', 650 * rand(0.85, 1.15), 0.05, 0.035, { send: 0 });
  },

  // ---------- ambience ----------
  startWind() {
    const c = this.ctx, src = c.createBufferSource();
    src.buffer = this.brownBuf;
    src.loop = true;
    const f = c.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.value = 500; f.Q.value = 0.7;
    const g = c.createGain();
    g.gain.value = 0.05;
    const lfo = c.createOscillator(), lg = c.createGain();
    lfo.frequency.value = 0.07; lg.gain.value = 300;
    lfo.connect(lg).connect(f.frequency);
    const lfo2 = c.createOscillator(), lg2 = c.createGain();
    lfo2.frequency.value = 0.045; lg2.gain.value = 0.03;
    lfo2.connect(lg2).connect(g.gain);
    src.connect(f).connect(g).connect(this.sfxBus);
    src.start(); lfo.start(); lfo2.start();
  },

  // Occasional far-off sounds: distant blasts and howls from the dead city.
  ambientTick(dt) {
    if (!this.ctx || this.muted) return;
    this.ambientT -= dt;
    if (this.ambientT > 0) return;
    this.ambientT = rand(9, 22);
    this.P = { pan: rand(-0.9, 0.9), gain: 1 };
    if (Math.random() < 0.5) this.n('lowpass', 300, 1.6, 0.07, { brown: true, at: 0.05, send: 0.8 });
    else this.t('sawtooth', rand(140, 220), rand(90, 130), 1.4, 0.012, { vib: 5, vibDepth: 8, filt: 'lowpass', ffreq: 600, at: 0.3, send: 0.9 });
  },
};

// ============================================================
// Music: a 4-bar synthwave loop in A minor (Am - F - C - G).
// Intensity 0 = calm pad + sparse bass (title, breaks),
// 1 = full beat and arpeggio (waves), 2 = boss layer on top.
// ============================================================
const Music = {
  intensity: 0,
  step: 0,
  next: 0,
  timer: null,
  bpm: 112,
  chords: [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]],
  lead: [76, 74, 72, 71, 72, 74, 76, 79, 77, 76, 74, 72, 71, 72, 74, 71],

  start() {
    if (this.timer) return;
    this.next = Sound.ctx.currentTime + 0.2;
    this.timer = setInterval(() => this.schedule(), 40);
  },

  schedule() {
    const c = Sound.ctx;
    if (!c || !Sound.musicOn || Sound.muted) { if (c) this.next = c.currentTime + 0.05; return; }
    if (this.next < c.currentTime - 0.25) this.next = c.currentTime + 0.05;   // tab was asleep
    const sixteenth = 60 / this.bpm / 4;
    while (this.next < c.currentTime + 0.15) {
      this.playStep(this.step, this.next - c.currentTime, sixteenth);
      this.next += sixteenth;
      this.step = (this.step + 1) % 64;
    }
  },

  voice(type, note, delay, dur, vol, extra = {}) {
    Sound.osc(Object.assign({ type, f: midiHz(note), dur, vol, delay, bus: Sound.musicBus, send: 0.15 }, extra));
  },

  drum(kind, delay) {
    const o = { bus: Sound.musicBus, delay, send: 0.05 };
    if (kind === 'kick') Sound.osc(Object.assign({ type: 'sine', f: 140, to: 40, dur: 0.22, vol: 0.32 }, o));
    else if (kind === 'snare') Sound.nz(Object.assign({ filt: 'bandpass', ffreq: 1800, fq: 0.8, dur: 0.14, vol: 0.12 }, o));
    else Sound.nz(Object.assign({ filt: 'highpass', ffreq: 8000, dur: 0.035, vol: 0.05 }, o));
  },

  playStep(s, d, sixteenth) {
    const bar = Math.floor(s / 16), b = s % 16, chord = this.chords[bar], I = this.intensity;
    if (b === 0) chord.forEach(n => this.voice('triangle', n, d, sixteenth * 16, 0.022, { at: 0.5, filt: 'lowpass', ffreq: 1400, send: 0.4 }));
    const root = chord[0] - 24;
    if (I === 0) {
      if (b === 0 || b === 10) this.voice('sawtooth', root, d, sixteenth * 5, 0.05, { filt: 'lowpass', ffreq: 380 });
      if (b % 8 === 4) this.drum('hat', d);
      return;
    }
    if ([0, 3, 6, 8, 11, 14].includes(b)) this.voice('sawtooth', b === 6 ? root + 12 : root, d, sixteenth * 1.8, 0.07, { filt: 'lowpass', ffreq: 520, fto: 300 });
    if (b % 4 === 0 || (I === 2 && b === 10)) this.drum('kick', d);
    if (b === 4 || b === 12) this.drum('snare', d);
    if (I === 2 || b % 2 === 1) this.drum('hat', d);
    const arp = [chord[0] + 12, chord[1] + 12, chord[2] + 12, chord[1] + 24];
    this.voice('square', arp[b % 4], d, sixteenth * 0.9, 0.018, { filt: 'lowpass', ffreq: 2600, send: 0.35 });
    if (I === 2 && b % 2 === 0) this.voice('sawtooth', this.lead[(bar * 4 + b / 2) % 16], d, sixteenth * 1.9, 0.03, { filt: 'lowpass', ffreq: 2200, detune: 8, vib: 5, vibDepth: 4, send: 0.3 });
  },
};
