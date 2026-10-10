/**
 * Web Audio plumbing: context (created on the first user gesture), master volume/mute,
 * music and SFX buses, and a shared reverb whose impulse response is synthesized, not loaded.
 *
 *   music --+--> musicBus --+
 *           \--> reverbSend --> convolver --> reverbReturn --+--> master --> compressor --> out
 *   sfx ----+--> sfxBus ----+
 */
export class AudioEngine {
  ctx: AudioContext | null = null;
  master!: GainNode;
  musicBus!: GainNode;
  sfxBus!: GainNode;
  reverbSend!: GainNode;
  /** Shared white-noise buffer for SFX (wind, whoosh, splash). */
  noise!: AudioBuffer;
  private volume = 0.8;
  private muted = false;
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
    this.master.connect(comp);
    this.musicBus = ctx.createGain();
    this.musicBus.connect(this.master);
    this.sfxBus = ctx.createGain();
    this.sfxBus.gain.value = 0.8;
    this.sfxBus.connect(this.master);

    const convolver = ctx.createConvolver();
    convolver.buffer = this.makeImpulse(ctx, 5.5);
    this.reverbSend = ctx.createGain();
    const ret = ctx.createGain();
    ret.gain.value = 0.9;
    this.reverbSend.connect(convolver).connect(ret).connect(this.master);

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

  setVolume(v: number): void {
    this.volume = Math.max(0, Math.min(1, v));
    this.applyVolume();
  }

  setMuted(m: boolean): void {
    this.muted = m;
    this.applyVolume();
  }

  get isMuted(): boolean {
    return this.muted;
  }

  get level(): number {
    return this.volume;
  }

  private applyVolume(fade = 0.15): void {
    if (!this.ctx) return;
    // Squared for a perceptual-ish fader curve; x3 makeup gain (the compressor catches peaks).
    const target = this.muted ? 0 : this.volume * this.volume * 3;
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
