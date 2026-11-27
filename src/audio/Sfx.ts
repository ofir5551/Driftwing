import type { AudioEngine } from './AudioEngine';

/** Soft procedural SFX: everything is filtered noise or a sine, shaped by envelopes. */
export class Sfx {
  private windGain!: GainNode;
  private windFilter!: BiquadFilterNode;
  private lastSplash = 0;

  constructor(private readonly engine: AudioEngine) {}

  start(): void {
    const ctx = this.engine.ctx!;
    // Wind loop: looping noise through a bandpass; speed raises both pitch and level.
    const src = ctx.createBufferSource();
    src.buffer = this.engine.noise;
    src.loop = true;
    this.windFilter = ctx.createBiquadFilter();
    this.windFilter.type = 'bandpass';
    this.windFilter.frequency.value = 400;
    this.windFilter.Q.value = 0.8;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2200;
    this.windGain = ctx.createGain();
    this.windGain.gain.value = 0;
    // Gusts: a very slow LFO multiplying the wind level (+-35%) so it never sounds like a
    // static hiss, and stays silent when the level is zero.
    const gustGain = ctx.createGain();
    const gust = ctx.createOscillator();
    gust.frequency.value = 0.11;
    const gustDepth = ctx.createGain();
    gustDepth.gain.value = 0.35;
    gust.connect(gustDepth).connect(gustGain.gain);
    gust.start();
    src
      .connect(this.windFilter)
      .connect(lp)
      .connect(gustGain)
      .connect(this.windGain)
      .connect(this.engine.sfxBus);
    src.start();
  }

  update(speed: number, paused: boolean): void {
    const ctx = this.engine.ctx;
    if (!ctx || !this.windGain) return;
    const t = ctx.currentTime;
    const level = paused ? 0 : 0.025 + Math.pow(speed, 1.5) * 0.16;
    this.windGain.gain.setTargetAtTime(level, t, 0.3);
    this.windFilter.frequency.setTargetAtTime(320 + speed * 1100, t, 0.3);
  }

  /** Noise burst through a sweeping filter: the basic whoosh shape. */
  private burst(
    type: BiquadFilterType,
    f0: number,
    f1: number,
    q: number,
    level: number,
    dur: number,
    attack = 0.02,
  ): void {
    const ctx = this.engine.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + 0.005;
    const src = ctx.createBufferSource();
    src.buffer = this.engine.noise;
    const flt = ctx.createBiquadFilter();
    flt.type = type;
    flt.Q.value = q;
    flt.frequency.setValueAtTime(f0, t);
    flt.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(level, t + attack);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(flt).connect(env).connect(this.engine.sfxBus);
    src.start(t, Math.random() * 1.5);
    src.stop(t + dur + 0.05);
  }

  flap(): void {
    this.burst('bandpass', 380, 1500, 1.4, 0.22, 0.32, 0.04);
  }

  /** Climb wingbeat: a quieter, shorter, lower cousin of the flap. */
  wingbeat(): void {
    this.burst('bandpass', 320, 1100, 1.4, 0.07, 0.2, 0.03);
  }

  /** Dive-bomb: the wings fold and the air roars, falling in pitch as the stoop steepens. */
  dive(): void {
    this.burst('bandpass', 700, 260, 1.1, 0.2, 1.1, 0.12);
  }

  /** Barrel roll: a quick swish. */
  roll(): void {
    this.burst('bandpass', 600, 1600, 1.6, 0.1, 0.4, 0.05);
  }

  /**
   * Into the cloud: a soft, falling 'fwump' as the vapour closes over the bird. Out: a rising
   * rush as it bursts free. Louder the harder it went in or came out.
   */
  cloud(inside: boolean, strength: number): void {
    const s = Math.min(1, 0.4 + strength * 0.05);
    if (inside) {
      this.burst('lowpass', 1600, 220, 0.9, 0.26 * s, 0.75, 0.015);
      this.burst('bandpass', 900, 380, 1.2, 0.1 * s, 0.5, 0.01);
    } else this.burst('bandpass', 260, 1500, 1.1, 0.18 * s, 0.65, 0.06);
  }

  /**
   * Into deep water: a splash over a low "bloop" as the water closes. Out: a lighter splash and
   * a patter of droplets falling back. Louder the harder it went in or came out.
   */
  waterDive(inside: boolean, strength: number): void {
    const ctx = this.engine.ctx;
    if (!ctx) return;
    const s = Math.min(1, 0.45 + strength * 0.05);
    if (inside) {
      this.burst('highpass', 2200, 700, 0.7, 0.16 * s, 0.5, 0.005);
      this.blip(170, 70, 0.14 * s, 0.32);
    } else {
      this.burst('highpass', 1600, 1000, 0.7, 0.1 * s, 0.4, 0.01);
      for (let i = 0; i < 4; i++)
        this.blip(900 + Math.random() * 1100, 0.5, 0.035 * s, 0.09, 0.1 + Math.random() * 0.35);
    }
  }

  /** One bubble rising past the bird under water: a quick upward chirp, soft and close. */
  bubble(): void {
    const f = 380 + Math.random() * 420;
    this.blip(f, 1.9, 0.04, 0.07);
  }

  /** A sine swept from f0 by `ratio` (a number) or to f1 (over 1), as a short blip. */
  private blip(f0: number, to: number, level: number, dur: number, delay = 0): void {
    const ctx = this.engine.ctx;
    if (!ctx) return;
    const t = ctx.currentTime + 0.005 + delay;
    const f1 = to > 10 ? to : f0 * to;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(level, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g).connect(this.engine.sfxBus);
    g.connect(this.engine.sfxSend);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  thermal(inside: boolean): void {
    if (inside) this.burst('bandpass', 250, 1300, 2, 0.12, 1.6, 0.5);
  }

  contact(kind: 'ground' | 'water', strength: number): void {
    const ctx = this.engine.ctx;
    if (!ctx || ctx.currentTime - this.lastSplash < 0.3) return;
    this.lastSplash = ctx.currentTime;
    const s = Math.min(1, 0.35 + strength * 0.08);
    if (kind === 'water') {
      this.burst('highpass', 1800, 900, 0.7, 0.16 * s, 0.45, 0.005);
      // A few droplets: quick downward-pitched sine blips.
      for (let i = 0; i < 3; i++) {
        const t = ctx.currentTime + 0.03 + Math.random() * 0.25;
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        const f = 700 + Math.random() * 900;
        o.frequency.setValueAtTime(f, t);
        o.frequency.exponentialRampToValueAtTime(f * 0.5, t + 0.08);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.05 * s, t + 0.005);
        g.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
        o.connect(g).connect(this.engine.sfxBus);
        g.connect(this.engine.sfxSend);
        o.start(t);
        o.stop(t + 0.12);
      }
    } else {
      this.burst('lowpass', 900, 250, 0.7, 0.14 * s, 0.4, 0.01);
    }
  }
}
