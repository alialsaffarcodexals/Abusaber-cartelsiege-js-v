// ============================================================================
//  audio.js — AudioEngine.
//  Hybrid: procedural Web Audio synthesis for per-weapon gunfire, footsteps,
//  explosions and UI, layered with real (Mixkit, license-free) samples for
//  reloads, weapon handling and shotgun pumps, plus streamed music tracks
//  with per-level / combat / boss selection and crossfading.
//  SFX are spatialised by a distance + stereo-pan model around the listener.
// ============================================================================

import { clamp } from './utils.js';

const SFX_FILES = {
  reload_a: 'reload_a.mp3', reload_b: 'reload_b.mp3', switch: 'switch.mp3',
  shotgun_pump: 'shotgun_pump.mp3', empty: 'empty.mp3',
  enemy_hurt: 'enemy_hurt.mp3', enemy_attack: 'enemy_attack.mp3', enemy_death: 'enemy_death.mp3',
  radio_beep: 'radio_beep.mp3', inv_open: 'inv_open.mp3', item_drop: 'item_drop.mp3',
};
const MUSIC_FILES = {
  menu: 'menu.mp3', explore_low: 'explore_low.mp3', explore_mid: 'explore_mid.mp3',
  explore_high: 'explore_high.mp3', combat: 'combat.mp3', boss: 'boss.mp3',
};

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.sfxBus = null;
    this.musicBus = null;
    this.uiBus = null;
    this.ready = false;
    this.volumes = { master: 0.9, sfx: 1.0, music: 0.55, ui: 0.8 };
    this.noiseBuffer = null;
    // listener
    this.lx = 0; this.lz = 0; this.fx = 0; this.fz = -1; this.rx = 1; this.rz = 0;
    // music state
    this.musicState = 'none';
    this._alarm = null;
    this._ambient = null;
    // real samples (decoded AudioBuffers) + streamed music channels
    this.samples = {};
    this._mChan = null;
    this._mActive = -1;
    this._mKey = null;
    this._mFloor = 1;
    this._mTargetVol = 0.42;
    this._mFade = null;
    this._footChan = null;      // looping player footstep elements (walk/run)
    this._voice = undefined;    // chosen TTS voice
    this._lastSpeak = 0;        // global voice-bark cooldown
  }

  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volumes.master;
    this.master.connect(this.ctx.destination);

    this.sfxBus = this.ctx.createGain();
    this.sfxBus.gain.value = this.volumes.sfx;
    this.sfxBus.connect(this.master);

    this.musicBus = this.ctx.createGain();
    this.musicBus.gain.value = this.volumes.music;
    this.musicBus.connect(this.master);

    this.uiBus = this.ctx.createGain();
    this.uiBus.gain.value = this.volumes.ui;
    this.uiBus.connect(this.master);

    // shared white-noise buffer
    const len = this.ctx.sampleRate * 2;
    this.noiseBuffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = this.noiseBuffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

    this.ready = true;
    this._loadSamples();
    this._initMusic();
    this._initFootsteps();
    // refresh available TTS voices when the browser populates them
    if (typeof speechSynthesis !== 'undefined') {
      try { speechSynthesis.onvoiceschanged = () => { this._voice = undefined; }; } catch (e) {}
    }
  }

  // -------------------------------------------------------------------------
  //  PLAYER FOOTSTEPS — real looping walk/run samples, gain by movement state
  // -------------------------------------------------------------------------
  _initFootsteps() {
    if (this._footChan) return;
    this._footChan = {
      walk: new Audio('./assets/audio/sfx/foot_walk.mp3'),
      run: new Audio('./assets/audio/sfx/foot_run.mp3'),
    };
    for (const k of ['walk', 'run']) { const a = this._footChan[k]; a.loop = true; a.preload = 'auto'; a.volume = 0; }
  }

  // state: 'walk' | 'run' | 'crouch' | null(idle). Called every frame.
  footMove(state) {
    if (!this.ready || !this._footChan) return;
    const sfxv = this.volumes.sfx;
    const want = { walk: 0, run: 0 };
    if (state === 'walk') want.walk = 0.5;
    else if (state === 'crouch') want.walk = 0.16;
    else if (state === 'run') want.run = 0.6;
    for (const k of ['walk', 'run']) {
      const a = this._footChan[k];
      const target = Math.min(1, want[k] * sfxv);
      if (target > 0.001 && a.paused) { const p = a.play(); if (p && p.catch) p.catch(() => {}); }
      a.volume = clamp(a.volume + (target - a.volume) * 0.25, 0, 1);
      a.playbackRate = k === 'walk' && state === 'crouch' ? 0.8 : 1.0;
    }
  }
  stopFootsteps() { if (this._footChan) for (const k of ['walk', 'run']) { const a = this._footChan[k]; a.pause(); a.volume = 0; } }

  // -------------------------------------------------------------------------
  //  ENEMY VOCALS (real male samples) + spoken barks (Web Speech API)
  // -------------------------------------------------------------------------
  enemyHurt(x, z) { this.playSample('enemy_hurt', x, z, { vol: 0.8, rate: 0.95 + Math.random() * 0.1, refDist: 12, maxDist: 45 }); }
  // player pain grunt (non-spatial, higher-pitched so it's distinct from enemies)
  playerHurt() { this.playSample('enemy_hurt', undefined, undefined, { vol: 0.75, rate: 1.18 }); }
  enemyAttack(x, z) { this.playSample('enemy_attack', x, z, { vol: 0.7, rate: 0.95 + Math.random() * 0.1, refDist: 12, maxDist: 45 }); }
  enemyDeath(x, z) { this.playSample('enemy_death', x, z, { vol: 0.85, rate: 0.95 + Math.random() * 0.1, refDist: 14, maxDist: 50 }); }

  _pickVoice() {
    if (this._voice !== undefined) return this._voice;
    let vs = [];
    try { vs = speechSynthesis.getVoices() || []; } catch (e) {}
    this._voice = vs.find((v) => /^en/i.test(v.lang) && /male|david|mark|daniel|alex|fred|google uk english male/i.test(v.name))
      || vs.find((v) => /^en/i.test(v.lang)) || vs[0] || null;
    return this._voice;
  }

  // Spoken bark. Spatial volume by distance; globally throttled (single queue).
  // opts: { pitch, rate, minGap, vol } — enemies use a gruff low pitch, allies
  // a clearer friendlier voice.
  speak(text, x, z, opts = {}) {
    if (!this.ready || this.volumes.sfx <= 0.02) return;
    if (typeof speechSynthesis === 'undefined') return;
    const now = performance.now();
    if (now - this._lastSpeak < (opts.minGap || 2100)) return; // don't overlap barks
    if (speechSynthesis.speaking || speechSynthesis.pending) return;
    let vol = opts.vol != null ? opts.vol : 0.9;
    if (x !== undefined) { const sp = this._spatial(x, z, 12, 45); if (sp.gain < 0.14) return; vol *= sp.gain; }
    this._lastSpeak = now;
    try {
      const u = new SpeechSynthesisUtterance(text);
      u.rate = opts.rate || 0.98; u.pitch = opts.pitch != null ? opts.pitch : 0.6;
      u.volume = clamp(vol * this.volumes.sfx, 0, 1);
      const v = this._pickVoice(); if (v) u.voice = v;
      speechSynthesis.speak(u);
    } catch (e) {}
  }

  // Friendly squad callout — clearer voice + a comms beep, heard over the radio
  // (non-spatial: your teammates come through your earpiece).
  speakAlly(text) {
    this.radioBeep();
    this.speak(text, undefined, undefined, { pitch: 1.0, rate: 1.02, vol: 1.0, minGap: 1800 });
  }

  radioBeep() { this.playSample('radio_beep', undefined, undefined, { vol: 0.35 }); }

  // inventory UI
  invOpen() { if (!this.playSample('inv_open', undefined, undefined, { vol: 0.5 })) this.uiClick(); }
  invClose() { if (!this.playSample('inv_open', undefined, undefined, { vol: 0.45, rate: 0.85 })) this.uiBack(); }
  itemDrop() { if (!this.playSample('item_drop', undefined, undefined, { vol: 0.6 })) this.beep(200, 0.08, 0.2, 'triangle', this.sfxBus); }

  // -------------------------------------------------------------------------
  //  REAL SAMPLES (decoded into AudioBuffers; procedural fallback if missing)
  // -------------------------------------------------------------------------
  _loadSamples() {
    for (const [name, file] of Object.entries(SFX_FILES)) {
      fetch('./assets/audio/sfx/' + file)
        .then((r) => r.arrayBuffer())
        .then((b) => this.ctx.decodeAudioData(b))
        .then((buf) => { this.samples[name] = buf; })
        .catch(() => {});
    }
  }

  // Spatialised one-shot of a decoded sample. Returns false if not loaded yet
  // so callers can fall back to procedural synthesis.
  playSample(name, x, z, opts = {}) {
    if (!this.ready) return false;
    const buf = this.samples[name];
    if (!buf) return false;
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = opts.rate || 1;
    const g = this.ctx.createGain();
    let gain = opts.vol != null ? opts.vol : 1;
    let pan = 0;
    if (x !== undefined) {
      const sp = this._spatial(x, z, opts.refDist || 14, opts.maxDist || 70);
      if (sp.gain < 0.01) return true;
      gain *= sp.gain; pan = sp.pan;
    }
    g.gain.value = gain;
    const p = this._panner(pan);
    src.connect(g); g.connect(p); p.connect(this.sfxBus);
    src.start();
    return true;
  }

  // -------------------------------------------------------------------------
  //  STREAMED MUSIC (real tracks, crossfaded, per level / combat / boss)
  // -------------------------------------------------------------------------
  _initMusic() {
    if (this._mChan) return;
    this._mChan = [new Audio(), new Audio()];
    this._mChan.forEach((a) => { a.loop = true; a.preload = 'auto'; a.volume = 0; });
  }

  setFloor(n) { this._mFloor = n; }

  _trackForState(state) {
    if (state === 'menu' || state === 'victory') return 'menu';
    if (state === 'combat') return 'combat';
    if (state === 'boss') return 'boss';
    const f = this._mFloor;            // calm / exploration → per-area track
    return f <= 2 ? 'explore_low' : f <= 4 ? 'explore_mid' : 'explore_high';
  }

  setMusicState(state) {
    this.musicState = state;
    if (!this.ready) return;
    const key = this._trackForState(state);
    if (key === this._mKey) return;
    this._mKey = key;
    const target = (state === 'combat' || state === 'boss') ? 0.5 : 0.42;
    this._crossfadeTo(MUSIC_FILES[key], target);
  }

  _crossfadeTo(file, targetVol) {
    if (!this._mChan) return;
    const next = (this._mActive + 1) % 2;
    const a = this._mChan[next];
    const prev = this._mActive >= 0 ? this._mChan[this._mActive] : null;
    a.src = './assets/audio/music/' + file;
    a.volume = 0;
    const pp = a.play();
    if (pp && pp.catch) pp.catch(() => {});
    this._mActive = next;
    this._mTargetVol = targetVol;
    if (this._mFade) clearInterval(this._mFade);
    const dur = 1200, t0 = performance.now();
    const startPrev = prev ? prev.volume : 0;
    this._mFade = setInterval(() => {
      const k = Math.min(1, (performance.now() - t0) / dur);
      const mv = this.volumes.music;
      a.volume = clamp(k * targetVol * mv, 0, 1);
      if (prev) prev.volume = clamp((1 - k) * startPrev, 0, 1);
      if (k >= 1) { clearInterval(this._mFade); this._mFade = null; if (prev) prev.pause(); }
    }, 40);
  }

  stopMusic() {
    if (this._mFade) { clearInterval(this._mFade); this._mFade = null; }
    if (this._mChan) this._mChan.forEach((a) => { a.pause(); a.volume = 0; });
    this._mKey = null; this._mActive = -1; this.musicState = 'none';
  }

  stingerVictory() { this.setMusicState('victory'); }

  // -------------------------------------------------------------------------
  //  WEAPON HANDLING (real samples, procedural fallback)
  // -------------------------------------------------------------------------
  weaponSwitch() {
    if (!this.playSample('switch', undefined, undefined, { vol: 0.7 })) this.reload(0);
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }

  setVolume(kind, v) {
    this.volumes[kind] = v;
    if (!this.ready) return;
    const bus = { master: this.master, sfx: this.sfxBus, music: this.musicBus, ui: this.uiBus }[kind];
    if (bus) bus.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
    // streamed music tracks aren't on the Web Audio graph — set element volume
    if (kind === 'music' && this._mChan && this._mActive >= 0 && !this._mFade) {
      this._mChan[this._mActive].volume = clamp(this._mTargetVol * v, 0, 1);
    }
  }

  setListener(pos, forward) {
    this.lx = pos.x; this.lz = pos.z;
    this.fx = forward.x; this.fz = forward.z;
    // right vector = forward rotated -90° about Y
    this.rx = -forward.z; this.rz = forward.x;
  }

  // returns {gain, pan} for a world position
  _spatial(x, z, refDist = 14, maxDist = 70) {
    const dx = x - this.lx, dz = z - this.lz;
    const dist = Math.hypot(dx, dz);
    let gain = refDist / (refDist + Math.max(0, dist - refDist));
    if (dist > maxDist) gain *= clamp(1 - (dist - maxDist) / maxDist, 0, 1);
    let pan = 0;
    if (dist > 0.001) {
      pan = clamp((dx * this.rx + dz * this.rz) / dist, -1, 1);
    }
    return { gain: clamp(gain, 0, 1), pan, dist };
  }

  _noise() {
    const n = this.ctx.createBufferSource();
    n.buffer = this.noiseBuffer;
    n.loop = true;
    n.playbackRate.value = 0.8 + Math.random() * 0.4;
    return n;
  }

  _panner(pan) {
    const p = this.ctx.createStereoPanner();
    p.pan.value = pan;
    return p;
  }

  // -------------------------------------------------------------------------
  //  WEAPONS
  // -------------------------------------------------------------------------
  gunshot(snd, x, z, opts = {}) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const sp = (x === undefined) ? { gain: 1, pan: 0 } : this._spatial(x, z);
    if (sp.gain < 0.01) return;
    const out = this.ctx.createGain();
    out.gain.value = (snd.vol || 0.8) * sp.gain * (opts.volMult || 1);
    const pan = this._panner(sp.pan);
    out.connect(pan); pan.connect(this.sfxBus);

    // body — low filtered noise punch
    const body = this._noise();
    const bf = this.ctx.createBiquadFilter();
    bf.type = 'lowpass';
    bf.frequency.setValueAtTime(snd.freq * 6, t);
    bf.frequency.exponentialRampToValueAtTime(Math.max(60, snd.freq), t + snd.dur);
    const bg = this.ctx.createGain();
    bg.gain.setValueAtTime(1.0, t);
    bg.gain.exponentialRampToValueAtTime(0.001, t + snd.dur);
    body.connect(bf); bf.connect(bg); bg.connect(out);

    // crack/snap — high transient
    const snap = this._noise();
    const sf = this.ctx.createBiquadFilter();
    sf.type = 'highpass';
    sf.frequency.value = snd.snap || 1600;
    const sg = this.ctx.createGain();
    sg.gain.setValueAtTime(0.7, t);
    sg.gain.exponentialRampToValueAtTime(0.001, t + snd.dur * 0.45);
    snap.connect(sf); sf.connect(sg); sg.connect(out);

    // low thump oscillator for weight
    const osc = this.ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(snd.freq * 1.4, t);
    osc.frequency.exponentialRampToValueAtTime(snd.freq * 0.5, t + snd.dur);
    const og = this.ctx.createGain();
    og.gain.setValueAtTime(0.5, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + snd.dur);
    osc.connect(og); og.connect(out);

    // mechanical action transient (bolt / slide) — sharpens each weapon's voice
    const mech = this._noise();
    const mf = this.ctx.createBiquadFilter();
    mf.type = 'bandpass'; mf.frequency.value = (snd.snap || 1600) * 1.25; mf.Q.value = 3;
    const mg = this.ctx.createGain();
    mg.gain.setValueAtTime(0.0001, t);
    mg.gain.linearRampToValueAtTime(0.16, t + 0.004);
    mg.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
    mech.connect(mf); mf.connect(mg); mg.connect(out);

    body.start(t); snap.start(t); osc.start(t); mech.start(t);
    const stop = t + snd.dur + 0.05;
    body.stop(stop); snap.stop(stop); osc.stop(stop); mech.stop(t + 0.06);

    // distant tail for far shots
    if (sp.dist > 22) this._tail(t, sp.pan, snd.freq, sp.gain * 0.4);

    // pump-action shotgun: rack the slide shortly after the blast (real sample)
    if (snd.type === 'shotgun') setTimeout(() => this.playSample('shotgun_pump', x, z, { vol: 0.45 }), 170);
  }

  _tail(t, pan, freq, gain) {
    const n = this._noise();
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.value = freq * 1.5; f.Q.value = 0.6;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain * 0.5, t + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
    const p = this._panner(pan);
    n.connect(f); f.connect(g); g.connect(p); p.connect(this.sfxBus);
    n.start(t); n.stop(t + 0.55);
  }

  emptyClick() {
    if (this.playSample('empty', undefined, undefined, { vol: 0.6 })) return; // real dry-fire
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = 'square'; o.frequency.value = 1200;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.18, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
    o.connect(g); g.connect(this.sfxBus);
    o.start(t); o.stop(t + 0.05);
  }

  reload(stage = 0) {
    if (!this.ready) return;
    const t = this.ctx.currentTime + stage;
    // mechanical click — short filtered noise burst
    const n = this._noise();
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.value = 2200 + Math.random() * 800; f.Q.value = 2;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.3, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.07);
    n.connect(f); f.connect(g); g.connect(this.sfxBus);
    n.start(t); n.stop(t + 0.09);
  }

  reloadSequence(duration, cls) {
    // real reload samples (shotgun racks twice; others: mag-out then charge)
    if (cls === 'Shotgun') {
      if (this.playSample('shotgun_pump', undefined, undefined, { vol: 0.75 })) {
        setTimeout(() => this.playSample('shotgun_pump', undefined, undefined, { vol: 0.75 }), Math.max(250, duration * 1000 * 0.55));
        return;
      }
    } else if (this.playSample('reload_a', undefined, undefined, { vol: 0.85 })) {
      setTimeout(() => this.playSample('reload_b', undefined, undefined, { vol: 0.85 }), Math.max(220, duration * 1000 * 0.55));
      return;
    }
    // procedural fallback (samples not loaded yet)
    this.reload(0.05);
    this.reload(duration * 0.45);
    this.reload(duration * 0.85);
  }

  // -------------------------------------------------------------------------
  //  IMPACTS / EXPLOSIONS
  // -------------------------------------------------------------------------
  impact(kind, x, z) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const sp = this._spatial(x, z, 10, 50);
    if (sp.gain < 0.02) return;
    const out = this.ctx.createGain();
    out.gain.value = 0.5 * sp.gain;
    const pan = this._panner(sp.pan);
    out.connect(pan); pan.connect(this.sfxBus);
    const n = this._noise();
    const f = this.ctx.createBiquadFilter();
    if (kind === 'flesh') { f.type = 'lowpass'; f.frequency.value = 600; }
    else if (kind === 'metal') { f.type = 'bandpass'; f.frequency.value = 3500; f.Q.value = 3; }
    else { f.type = 'bandpass'; f.frequency.value = 1600; f.Q.value = 1; }
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.6, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
    n.connect(f); f.connect(g); g.connect(out);
    n.start(t); n.stop(t + 0.1);
  }

  explosion(x, z) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const sp = (x === undefined) ? { gain: 1, pan: 0 } : this._spatial(x, z, 18, 90);
    const out = this.ctx.createGain();
    out.gain.value = 1.1 * sp.gain;
    const pan = this._panner(sp.pan);
    out.connect(pan); pan.connect(this.sfxBus);

    // sub boom
    const osc = this.ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(120, t);
    osc.frequency.exponentialRampToValueAtTime(28, t + 0.7);
    const og = this.ctx.createGain();
    og.gain.setValueAtTime(1.0, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.8);
    osc.connect(og); og.connect(out);

    // noise blast
    const n = this._noise();
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(2500, t);
    f.frequency.exponentialRampToValueAtTime(200, t + 0.6);
    const ng = this.ctx.createGain();
    ng.gain.setValueAtTime(0.9, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
    n.connect(f); f.connect(ng); ng.connect(out);

    osc.start(t); n.start(t);
    osc.stop(t + 0.85); n.stop(t + 0.7);
  }

  flashbang(x, z) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const sp = (x === undefined) ? { gain: 1, pan: 0 } : this._spatial(x, z, 16, 80);
    // sharp crack
    const n = this._noise();
    const f = this.ctx.createBiquadFilter();
    f.type = 'highpass'; f.frequency.value = 1000;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(1.0 * sp.gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
    const pan = this._panner(sp.pan);
    n.connect(f); f.connect(g); g.connect(pan); pan.connect(this.sfxBus);
    n.start(t); n.stop(t + 0.3);
    // ringing tone (only if close)
    if (sp.gain > 0.5) this.ringing();
  }

  ringing() {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = 'sine'; o.frequency.value = 4400;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.15, t + 0.05);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 3.0);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + 3.0);
  }

  // -------------------------------------------------------------------------
  //  MOVEMENT / MELEE
  // -------------------------------------------------------------------------
  footstep(intensity, x, z) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    let sp = (x === undefined) ? { gain: 1, pan: 0 } : this._spatial(x, z, 8, 30);
    if (x !== undefined && sp.gain < 0.03) return;   // skip inaudible distant steps
    const n = this._noise();
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = 350 + Math.random() * 200;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.12 * intensity * sp.gain, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
    const pan = this._panner(sp.pan);
    n.connect(f); f.connect(g); g.connect(pan); pan.connect(this.sfxBus);
    n.start(t); n.stop(t + 0.12);
  }

  melee() {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const n = this._noise();
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.setValueAtTime(1800, t);
    f.frequency.exponentialRampToValueAtTime(400, t + 0.15); f.Q.value = 1.2;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.4, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.16);
    n.connect(f); f.connect(g); g.connect(this.sfxBus);
    n.start(t); n.stop(t + 0.18);
  }

  takedown() {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    // thud + slash
    this.melee();
    const o = this.ctx.createOscillator();
    o.type = 'sine'; o.frequency.setValueAtTime(140, t);
    o.frequency.exponentialRampToValueAtTime(50, t + 0.25);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.5, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    o.connect(g); g.connect(this.sfxBus);
    o.start(t); o.stop(t + 0.32);
  }

  // -------------------------------------------------------------------------
  //  UI / FEEDBACK
  // -------------------------------------------------------------------------
  beep(freq, dur, vol, type = 'sine', bus = this.uiBus) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = type; o.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(bus);
    o.start(t); o.stop(t + dur + 0.02);
  }

  hitmarker() { this.beep(900, 0.05, 0.18, 'square', this.sfxBus); }
  headshot() { this.beep(1500, 0.06, 0.22, 'square', this.sfxBus); this.beep(1100, 0.05, 0.12, 'square', this.sfxBus); }
  kill() { this.beep(700, 0.05, 0.2, 'square', this.sfxBus); setTimeout(() => this.beep(1050, 0.06, 0.18, 'square', this.sfxBus), 50); }
  uiClick() { this.beep(660, 0.05, 0.2, 'triangle'); }
  uiHover() { this.beep(440, 0.03, 0.08, 'sine'); }
  uiConfirm() { this.beep(520, 0.07, 0.2, 'triangle'); setTimeout(() => this.beep(780, 0.09, 0.2, 'triangle'), 70); }
  uiBack() { this.beep(330, 0.06, 0.16, 'triangle'); }
  uiAlert() { this.beep(880, 0.12, 0.25, 'sawtooth'); setTimeout(() => this.beep(660, 0.14, 0.2, 'sawtooth'), 130); }
  pickup() { this.beep(700, 0.06, 0.2, 'sine'); setTimeout(() => this.beep(1050, 0.08, 0.18, 'sine'), 60); }
  money() { this.beep(1200, 0.05, 0.16, 'sine'); setTimeout(() => this.beep(1600, 0.05, 0.14, 'sine'), 45); }
  damage() { this.beep(180, 0.12, 0.25, 'sawtooth', this.sfxBus); }
  lowHealthBeat() { this.beep(120, 0.18, 0.2, 'sine', this.sfxBus); }
  objective() { this.beep(560, 0.1, 0.2, 'triangle'); setTimeout(() => this.beep(840, 0.14, 0.22, 'triangle'), 110); }

  // -------------------------------------------------------------------------
  //  ALARM (loopable)
  // -------------------------------------------------------------------------
  startAlarm() {
    if (!this.ready || this._alarm) return;
    const o = this.ctx.createOscillator();
    o.type = 'sawtooth';
    const lfo = this.ctx.createOscillator();
    lfo.type = 'sine'; lfo.frequency.value = 1.4;
    const lfoGain = this.ctx.createGain(); lfoGain.gain.value = 180;
    o.frequency.value = 620;
    lfo.connect(lfoGain); lfoGain.connect(o.frequency);
    const g = this.ctx.createGain(); g.gain.value = 0.06;
    o.connect(g); g.connect(this.sfxBus);
    o.start(); lfo.start();
    this._alarm = { o, lfo, g };
  }
  stopAlarm() {
    if (!this._alarm) return;
    const t = this.ctx.currentTime;
    this._alarm.g.gain.setTargetAtTime(0, t, 0.2);
    const a = this._alarm; this._alarm = null;
    setTimeout(() => { try { a.o.stop(); a.lfo.stop(); } catch (e) {} }, 600);
  }

  // -------------------------------------------------------------------------
  //  AMBIENCE — low building hum bed
  // -------------------------------------------------------------------------
  startAmbient() {
    if (!this.ready || this._ambient) return;
    const n = this._noise();
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass'; f.frequency.value = 200;
    const g = this.ctx.createGain(); g.gain.value = 0.0;
    n.connect(f); f.connect(g); g.connect(this.musicBus);
    n.start();
    g.gain.setTargetAtTime(0.08, this.ctx.currentTime, 2);
    // faint electrical buzz
    const o = this.ctx.createOscillator();
    o.type = 'sawtooth'; o.frequency.value = 60;
    const og = this.ctx.createGain(); og.gain.value = 0.015;
    o.connect(og); og.connect(this.musicBus); o.start();
    this._ambient = { n, g, o, og };
  }
  stopAmbient() {
    if (!this._ambient) return;
    const a = this._ambient; this._ambient = null;
    a.g.gain.setTargetAtTime(0, this.ctx.currentTime, 1);
    a.og.gain.setTargetAtTime(0, this.ctx.currentTime, 1);
    setTimeout(() => { try { a.n.stop(); a.o.stop(); } catch (e) {} }, 1500);
  }

}
