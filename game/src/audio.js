// Neon Harbor — all sound is synthesized with WebAudio. No audio files, no network:
// engine hum, two-tone siren, gunshot, punch, pickup blips, a mission jingle and a
// slow bass loop. Everything is guarded so a missing or suspended AudioContext
// never breaks the game (headless screenshots run silent).

export class AudioSys {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.engineOsc = null;
    this.engineGain = null;
    this.sirenOsc = null;
    this.sirenGain = null;
    this.sirenOn = false;
    this.musicTimer = null;
    this.musicStep = 0;
    this.muted = false;
  }

  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
      return;
    }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.42;
      this.master.connect(this.ctx.destination);
      this._startEngine();
      this._startMusic();
    } catch {
      this.ctx = null;
    }
  }

  _startEngine() {
    const ctx = this.ctx;
    this.engineOsc = ctx.createOscillator();
    this.engineOsc.type = 'sawtooth';
    this.engineOsc.frequency.value = 55;
    const sub = ctx.createOscillator();
    sub.type = 'square'; sub.frequency.value = 28;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass'; filter.frequency.value = 320;
    this.engineGain = ctx.createGain();
    this.engineGain.gain.value = 0.0;
    this.engineOsc.connect(filter); sub.connect(filter);
    filter.connect(this.engineGain); this.engineGain.connect(this.master);
    this.engineOsc.start(); sub.start();
    this._engineSub = sub;
  }

  // speed01: 0 at rest, 1 at top speed. Called every frame while driving.
  setEngine(speed01, driving) {
    if (!this.ctx || !this.engineOsc) return;
    const t = this.ctx.currentTime;
    const vol = driving ? 0.05 + speed01 * 0.075 : 0.0;
    this.engineGain.gain.setTargetAtTime(vol, t, 0.08);
    this.engineOsc.frequency.setTargetAtTime(55 + speed01 * 95, t, 0.1);
    if (this._engineSub) this._engineSub.frequency.setTargetAtTime(28 + speed01 * 48, t, 0.1);
  }

  setSiren(on) {
    if (!this.ctx || on === this.sirenOn) return;
    this.sirenOn = on;
    if (!on) {
      if (this.sirenOsc) { try { this.sirenOsc.stop(); } catch {} this.sirenOsc = null; }
      if (this.sirenGain) { this.sirenGain.gain.value = 0; }
      return;
    }
    const ctx = this.ctx;
    this.sirenOsc = ctx.createOscillator();
    this.sirenOsc.type = 'triangle';
    this.sirenOsc.frequency.value = 820;
    const lfo = ctx.createOscillator();
    lfo.type = 'square'; lfo.frequency.value = 0.9;
    const lfoGain = ctx.createGain(); lfoGain.gain.value = 180;
    lfo.connect(lfoGain); lfoGain.connect(this.sirenOsc.frequency);
    this.sirenGain = ctx.createGain();
    this.sirenGain.gain.value = 0.045;
    this.sirenOsc.connect(this.sirenGain); this.sirenGain.connect(this.master);
    this.sirenOsc.start(); lfo.start();
    this._sirenLfo = lfo;
  }

  sirenBurst() {
    // One short whoop for ambushes and heists.
    if (!this.ctx) return;
    const was = this.sirenOn;
    this.setSiren(true);
    window.setTimeout(() => { if (!was) this.setSiren(false); }, 1600);
  }

  _noiseBuffer(seconds) {
    const ctx = this.ctx;
    const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  _blip(freq, dur, type, vol, slideTo) {
    if (!this.ctx) return;
    try {
      const ctx = this.ctx, t = ctx.currentTime;
      const osc = ctx.createOscillator();
      osc.type = type || 'sine';
      osc.frequency.setValueAtTime(freq, t);
      if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
      const g = ctx.createGain();
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      osc.connect(g); g.connect(this.master);
      osc.start(t); osc.stop(t + dur + 0.02);
    } catch {}
  }

  _noise(dur, vol, filterFreq) {
    if (!this.ctx) return;
    try {
      const ctx = this.ctx, t = ctx.currentTime;
      const src = ctx.createBufferSource();
      src.buffer = this._noiseBuffer(dur + 0.05);
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass'; filter.frequency.value = filterFreq;
      const g = ctx.createGain();
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      src.connect(filter); filter.connect(g); g.connect(this.master);
      src.start(t); src.stop(t + dur + 0.05);
    } catch {}
  }

  gunshot() { this._noise(0.16, 0.5, 2400); this._blip(160, 0.1, 'square', 0.25, 50); }
  punch() { this._blip(150, 0.12, 'sine', 0.4, 55); this._noise(0.08, 0.2, 700); }
  pickup() { this._blip(880, 0.09, 'sine', 0.3); window.setTimeout(() => this._blip(1318, 0.12, 'sine', 0.3), 90); }
  click() { this._blip(1400, 0.04, 'square', 0.15); }
  thud() { this._blip(90, 0.25, 'sine', 0.5, 40); }
  crash() { this._noise(0.35, 0.45, 900); this._blip(70, 0.3, 'sine', 0.4, 35); }
  yelp() { this._blip(700, 0.16, 'sine', 0.2, 320); }
  jingle() {
    const notes = [523, 659, 784, 1046];
    notes.forEach((n, i) => window.setTimeout(() => this._blip(n, 0.22, 'triangle', 0.3), i * 110));
  }

  // Slow bass loop: A-minor walk, one note every 260 ms, quiet under everything.
  _startMusic() {
    const bass = [55, 55, 65.4, 49, 55, 55, 82.4, 65.4];
    this.musicTimer = window.setInterval(() => {
      if (!this.ctx || this.muted) return;
      if (this.ctx.state !== 'running') return;
      const note = bass[this.musicStep % bass.length];
      this.musicStep += 1;
      this._blip(note, 0.24, 'triangle', 0.12);
      if (this.musicStep % 8 === 4) this._blip(note * 2, 0.1, 'sine', 0.05);
    }, 260);
  }
}
