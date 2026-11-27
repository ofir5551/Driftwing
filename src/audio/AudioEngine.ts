/** The muffle filter's cutoff when the bird is in clear air (above hearing: no colour). */
const MUFFLE_OPEN = 18000;

/**
 * Web Audio plumbing: context (created on the first user gesture), master volume/mute,
 * music and SFX buses, and a shared reverb whose impulse response is synthesized, not loaded.
 *
 *   music --+--> musicBus --> musicGate --+
 *           \--> musicSend --+                                  |
 *                             +--> reverbSend --> convolver --> reverbReturn --+--> master --> muffle --> compressor --> out
 *           /--> sfxSend ----+                                  |
 *   sfx ----+--> sfxBus ----> sfxGate ----+
 *
 * The gates (and their reverb sends) are the Music and Sound effects switches; the music's
 * pause duck stays on musicBus so the two never fight over one gain.
 *
 * `muffle` is a lowpass left wide open, closed while the bird is inside a cloud.
 */
export class AudioEngine {
  ctx: AudioContext | null = null;
  master!: GainNode;
  musicBus!: GainNode;
  sfxBus!: GainNode;
  /** Where music and SFX send to the shared reverb (gated with their switch). */
  musicSend!: GainNode;
  sfxSend!: GainNode;
  private musicGate!: GainNode;
  private sfxGate!: GainNode;
  private musicOn = true;
  private sfxOn = true;
  reverbSend!: GainNode;
  private muffleFilter!: BiquadFilterNode;
  /** Shared white-noise buffer for SFX (wind, whoosh, splash). */
  noise!: AudioBuffer;
  private volume = 0.8;
  private readyCbs: (() => void)[] = [];

  get ready(): boolean {
    return this.ctx !== null;
  }

  onReady(cb: () => void): void {
    if (this.ctx) cb();
    else this.readyCbs.push(cb);
  }

  /** Must be called from a user gesture (browsers block audio until then). Idempotent. */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const Ctx =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx({ latencyHint: 'playback' });
    this.ctx = ctx;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.ratio.value = 3;
    comp.attack.value = 0.02;
    comp.release.value = 0.3;
    comp.connect(ctx.destination);
    this.master = ctx.createGain();
    this.master.gain.value = 0;
    this.muffleFilter = ctx.createBiquadFilter();
    this.muffleFilter.type = 'lowpass';
    this.muffleFilter.frequency.value = MUFFLE_OPEN;
    this.muffleFilter.Q.value = 0.5;
    this.master.connect(this.muffleFilter).connect(comp);
    this.musicGate = ctx.createGain();
    this.musicGate.gain.value = this.musicOn ? 1 : 0;
    this.musicGate.connect(this.master);
    this.musicBus = ctx.createGain();
    this.musicBus.connect(this.musicGate);
    this.sfxGate = ctx.createGain();
    this.sfxGate.gain.value = this.sfxOn ? 1 : 0;
    this.sfxGate.connect(this.master);
    this.sfxBus = ctx.createGain();
    this.sfxBus.gain.value = 0.8;
    this.sfxBus.connect(this.sfxGate);

    const convolver = ctx.createConvolver();
    convolver.buffer = this.makeImpulse(ctx, 5.5);
    this.reverbSend = ctx.createGain();
    const ret = ctx.createGain();
    ret.gain.value = 0.9;
    this.reverbSend.connect(convolver).connect(ret).connect(this.master);
    this.musicSend = ctx.createGain();
    this.musicSend.gain.value = this.musicOn ? 1 : 0;
    this.musicSend.connect(this.reverbSend);
    this.sfxSend = ctx.createGain();
    this.sfxSend.gain.value = this.sfxOn ? 1 : 0;
    this.sfxSend.connect(this.reverbSend);

    this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;

    this.applyVolume(1.5); // fade in gently instead of popping on
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) void ctx.suspend();
      else void ctx.resume();
    });
    for (const cb of this.readyCbs) cb();
    this.readyCbs.length = 0;
  }

  /**
   * Synthetic hall: stereo decorrelated noise with an exponential decay, darkening over time
   * (high frequencies die faster in real rooms) and a short pre-delay so notes stay clear.
   */
  private makeImpulse(ctx: AudioContext, seconds: number): AudioBuffer {
    const rate = ctx.sampleRate;
    const len = Math.floor(rate * seconds);
    const buf = ctx.createBuffer(2, len, rate);
    const pre = Math.floor(rate * 0.025);
    for (let ch = 0; ch < 2; ch++) {
      const data = buf.getChannelData(ch);
      let lp = 0;
      for (let i = pre; i < len; i++) {
        const t = (i - pre) / (len - pre);
        const n = Math.random() * 2 - 1;
        // One-pole lowpass whose coefficient closes as the tail ages.
        const k = 0.9 - t * 0.75;
        lp += (n - lp) * k;
        data[i] = lp * Math.pow(1 - t, 2.2) * (1 - Math.exp(-(i - pre) / (rate * 0.01)));
      }
    }
    return buf;
  }

  /**
   * 0 = clear, 1 = deep in cloud: the whole mix through a closing lowpass. The cutoff moves
   * exponentially (equal steps in pitch), so the closing sounds even rather than sudden at the end.
   */
  setMuffle(k: number, closed: number, smooth: number): void {
    if (!this.ctx) return;
    const f = MUFFLE_OPEN * Math.pow(closed / MUFFLE_OPEN, Math.max(0, Math.min(1, k)));
    this.muffleFilter.frequency.setTargetAtTime(f, this.ctx.currentTime, smooth);
  }

  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v));
    this.applyVolume();
  }

  /** The Settings switches: each fades its bus and its reverb send (what is already ringing in
   *  the reverb dies away on its own). */
  setMusic(on: boolean): void {
    this.musicOn = on;
    if (this.ctx) this.gate([this.musicGate, this.musicSend], on);
  }

  setSfx(on: boolean): void {
    this.sfxOn = on;
    if (this.ctx) this.gate([this.sfxGate, this.sfxSend], on);
  }

  private gate(nodes: GainNode[], on: boolean): void {
    const t = this.ctx!.currentTime;
    for (const n of nodes) {
      n.gain.cancelScheduledValues(t);
      n.gain.setTargetAtTime(on ? 1 : 0, t, 0.05);
    }
  }

  get level(): number {
    return this.volume;
  }

  private applyVolume(fade = 0.15): void {
    if (!this.ctx) return;
    // Squared for a perceptual-ish fader curve; x3 makeup gain (the compressor catches peaks).
    const target = this.volume * this.volume * 3;
    this.master.gain.cancelScheduledValues(this.ctx.currentTime);
    this.master.gain.setTargetAtTime(target, this.ctx.currentTime, fade / 3);
  }

  /** Random stereo pan node helper. */
  panner(pan: number): StereoPannerNode {
    const p = this.ctx!.createStereoPanner();
    p.pan.value = pan;
    return p;
  }
}
