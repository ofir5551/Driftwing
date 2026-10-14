import type { AudioEngine } from './AudioEngine';
import {
  chordDegrees,
  degreeToMidi,
  midiToFreq,
  PhraseGenerator,
  StepScheduler,
  type ModeName,
} from './scales';
import { HIGHLANDS_MUSIC, type MusicStyle } from './styles';
import { mulberry32 } from '../world/noise';
import type { TrickKind } from '../player/Tricks';

const STEPS_PER_CHORD = 16; // two bars of eighth notes
const LOOKAHEAD = 0.15; // s of audio scheduled ahead of the clock
const TIMER_MS = 25;

/** Eighth-note duration: a slow, breathing grid. */
const eighth = (bpm: number): number => 60 / bpm / 2;

export interface MusicParams {
  speed: number; // 0..1
  altitude: number; // 0..1
  flow: number; // 0..1
  dayKey: number; // DayCycle keyframe index
  paused: boolean;
}

/**
 * Generative ambient score. A lookahead scheduler walks an eighth-note grid; on it we hang
 * slow detuned pads (lowpassed, brightness = speed), a sub drone, sparse struck notes, and
 * layers that fade in with flow (arpeggio, shimmer, the city's beat). Wisp pickups play the
 * next note of a melodic phrase quantized to the grid, so collecting literally writes the
 * melody. The level's `MusicStyle` picks tempo, progression, instruments and space.
 */
export class Music {
  private sched: StepScheduler | null = null;
  private timer = 0;
  private readonly rand = mulberry32(2024);
  private readonly phrase = new PhraseGenerator(mulberry32(77), 8, 0, 9);
  private params: MusicParams = { speed: 0, altitude: 0.3, flow: 0, dayKey: 0, paused: false };
  // Harmony state
  private style: MusicStyle = HIGHLANDS_MUSIC;
  private pending: MusicStyle | null = null;
  private root = HIGHLANDS_MUSIC.keys[0].root;
  private mode: ModeName = HIGHLANDS_MUSIC.keys[0].mode;
  private shift = 0; // semitones added by lanterns ("modulation")
  private chordIndex = 0;
  private chordRoot = 0;
  private lastMelody = 0;
  private flourishPending = false;
  // Persistent nodes
  private padFilter!: BiquadFilterNode;
  private padBus!: GainNode;
  private wet!: GainNode;
  private drone!: OscillatorNode;
  private drone2!: OscillatorNode;
  private droneFifth!: OscillatorNode;
  private droneFifthGain!: GainNode;
  private shimmer: OscillatorNode[] = [];
  private shimmerGain!: GainNode;
  private layerBus!: GainNode;
  private pulseBus!: GainNode;

  constructor(private readonly engine: AudioEngine) {}

  start(): void {
    const ctx = this.engine.ctx!;
    const e = this.engine;
    // Every music send to the shared reverb goes through `wet`, so a level sets its own space.
    this.wet = ctx.createGain();
    this.wet.gain.value = this.style.reverb;
    this.wet.connect(e.reverbSend);

    this.padFilter = ctx.createBiquadFilter();
    this.padFilter.type = 'lowpass';
    this.padFilter.frequency.value = 500;
    this.padFilter.Q.value = 0.6;
    this.padBus = ctx.createGain();
    this.padBus.gain.value = 0.5;
    this.padFilter.connect(this.padBus);
    this.padBus.connect(e.musicBus);
    this.padBus.connect(this.wet);

    // Sub drone: a sine on the root two octaves down, plus a quiet triangle an octave up for
    // warmth, plus an optional open fifth above that (a fiddle's drone strings).
    const droneGain = ctx.createGain();
    droneGain.gain.value = 0.035;
    droneGain.connect(e.musicBus);
    this.drone = ctx.createOscillator();
    this.drone.type = 'sine';
    this.drone2 = ctx.createOscillator();
    this.drone2.type = 'triangle';
    const d2g = ctx.createGain();
    d2g.gain.value = 0.9; // the octave carries the drone on small speakers
    this.drone.connect(droneGain);
    this.drone2.connect(d2g).connect(droneGain);
    this.droneFifth = ctx.createOscillator();
    this.droneFifth.type = 'triangle';
    this.droneFifthGain = ctx.createGain();
    this.droneFifthGain.gain.value = this.style.droneFifth * 0.7;
    this.droneFifth.connect(this.droneFifthGain).connect(droneGain);
    this.drone.start();
    this.drone2.start();
    this.droneFifth.start();

    // Shimmer: two high sines with a slow tremolo, faded in only at high flow.
    this.shimmerGain = ctx.createGain();
    this.shimmerGain.gain.value = 0;
    const trem = ctx.createGain();
    trem.gain.value = 0.6;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 4.7;
    const lfoDepth = ctx.createGain();
    lfoDepth.gain.value = 0.4;
    lfo.connect(lfoDepth).connect(trem.gain);
    lfo.start();
    for (let i = 0; i < 2; i++) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.detune.value = i === 0 ? -6 : 6;
      o.connect(trem);
      o.start();
      this.shimmer.push(o);
    }
    trem.connect(this.shimmerGain);
    this.shimmerGain.connect(e.musicBus);
    this.shimmerGain.connect(this.wet);

    this.layerBus = ctx.createGain();
    this.layerBus.gain.value = 0;
    this.layerBus.connect(e.musicBus);
    this.layerBus.connect(this.wet);

    this.pulseBus = ctx.createGain();
    this.pulseBus.gain.value = 0;
    this.pulseBus.connect(e.musicBus);
    this.pulseBus.connect(this.wet);

    this.applyKey(ctx.currentTime, true);
    this.sched = new StepScheduler(eighth(this.style.bpm), ctx.currentTime + 0.1);
    this.timer = window.setInterval(() => this.tick(), TIMER_MS);
  }

  stop(): void {
    clearInterval(this.timer);
  }

  setParams(p: MusicParams): void {
    this.params = p;
    const ctx = this.engine.ctx;
    if (!ctx || !this.sched) return;
    const t = ctx.currentTime;
    // Speed opens the pad filter: diving literally brightens the music.
    const cutoff = 380 + p.speed * 2300 + p.flow * 500;
    this.padFilter.frequency.setTargetAtTime(cutoff, t, 0.4);
    this.layerBus.gain.setTargetAtTime(smooth(0.25, 0.6, p.flow) * 0.9, t, 0.8);
    this.shimmerGain.gain.setTargetAtTime(smooth(0.6, 0.95, p.flow) * 0.02, t, 1.2);
    // The beat is always faintly there where a level has one, and steps forward with flow.
    const pulse = this.style.pulse * (0.4 + 0.6 * smooth(0, 0.6, p.flow));
    this.pulseBus.gain.setTargetAtTime(pulse, t, 1);
    this.engine.musicBus.gain.setTargetAtTime(p.paused ? 0.45 : 1, t, 0.5);
  }

  /** Wisp pickup: next phrase note, quantized to the sixteenth grid. */
  playWispNote(flow: number): void {
    const ctx = this.engine.ctx;
    if (!ctx || !this.sched) return;
    const now = ctx.currentTime;
    const t = this.sched.quantize(now, 2, 0.02, this.lastMelody);
    if (t - now > 1.2) return; // a backlog would sound late and mushy; drop instead
    this.lastMelody = t;
    const deg = this.phrase.next() + this.chordRoot;
    const midi = degreeToMidi(this.root + this.shift, this.mode, deg) + 12;
    this.note(t, midi, 0.5 + flow * 0.3, (this.rand() - 0.5) * 0.4, 2.0, 0.17, true);
  }

  /**
   * A trick's phrase in the level's voice, on the grid: a quick scale run for a roll (rising to
   * the right, falling to the left), an arc up and back down for a loop, a short fall for a
   * dive-bomb. Played as the trick starts, so the music moves with the bird.
   */
  trick(kind: TrickKind): void {
    const ctx = this.engine.ctx;
    if (!ctx || !this.sched) return;
    const d = this.sched.stepDur;
    const t0 = this.sched.quantize(ctx.currentTime, 4, 0.01);
    const key = this.root + this.shift;
    const run = (degs: number[], gap: number, vel: number): void => {
      degs.forEach((deg, i) => {
        const m = degreeToMidi(key, this.mode, this.chordRoot + deg) + 12;
        this.note(t0 + i * gap, m, vel, (i / (degs.length - 1) - 0.5) * 0.6, 1.4, 0.1, false);
      });
    };
    if (kind === 'rollR') run([0, 1, 2, 3, 4], d / 4, 0.45);
    else if (kind === 'rollL') run([4, 3, 2, 1, 0], d / 4, 0.45);
    else if (kind === 'loop') run([0, 2, 4, 6, 7, 6, 4, 2], d / 2, 0.5);
    else run([4, 2, 0], d / 4, 0.35);
  }

  /** A trick landed: a bright high note after a dive-bomb, a flourish through an arch. */
  land(kind: TrickKind, atArch: boolean): void {
    const ctx = this.engine.ctx;
    if (!ctx || !this.sched) return;
    const t = this.sched.quantize(ctx.currentTime, 2, 0.01);
    const key = this.root + this.shift;
    if (kind === 'dive')
      this.note(t, degreeToMidi(key, this.mode, this.chordRoot + 9) + 12, 0.6, 0, 2.4, 0.14, true);
    if (atArch) this.flourishPending = true;
  }

  /** Through an arch: one soft chord tone, like passing under a bell. */
  arch(): void {
    const ctx = this.engine.ctx;
    if (!ctx || !this.sched) return;
    const t = this.sched.quantize(ctx.currentTime, 2, 0.01);
    const m = degreeToMidi(this.root + this.shift, this.mode, this.chordRoot + 4) + 12;
    this.note(t, m, 0.5, 0, 3, 0.12, false);
  }

  /** Swap the level's style; it lands on the next chord boundary (tempo, keys, voices). */
  setStyle(style: MusicStyle): void {
    if (style === this.style && !this.pending) return;
    if (!this.sched) {
      this.style = style; // not started yet: start() builds with it
      this.shift = 0;
      return;
    }
    this.pending = style;
  }

  /** Lantern lit: modulate up a fourth at the next chord and play a rising flourish. */
  lantern(): void {
    this.shift = ((this.shift + 5 + 6) % 12) - 6; // stay within +-6 semitones of home
    this.flourishPending = true;
  }

  private tick(): void {
    const ctx = this.engine.ctx;
    if (!ctx || !this.sched || ctx.state !== 'running') return;
    this.sched.advance(ctx.currentTime, LOOKAHEAD, (step, t) => this.onStep(step, t));
  }

  private applyStyle(t: number): void {
    this.style = this.pending!;
    this.pending = null;
    this.shift = 0;
    this.chordIndex = 0;
    // Called from inside advance(): the next step is spaced by the new tempo, so the change is
    // seamless and the quantize grid follows.
    this.sched!.stepDur = eighth(this.style.bpm);
    this.wet.gain.setTargetAtTime(this.style.reverb, t, 1.5);
    this.droneFifthGain.gain.setTargetAtTime(this.style.droneFifth * 0.7, t, 2);
  }

  private applyKey(t: number, immediate = false): void {
    const keys = this.style.keys;
    const k = keys[this.params.dayKey % keys.length];
    this.root = k.root;
    this.mode = k.mode;
    const base = this.root + this.shift;
    const tc = immediate ? 0.01 : 2;
    this.drone.frequency.setTargetAtTime(midiToFreq(base - 24), t, tc);
    this.drone2.frequency.setTargetAtTime(midiToFreq(base - 12), t, tc);
    this.droneFifth.frequency.setTargetAtTime(midiToFreq(base - 5), t, tc);
  }

  private onStep(step: number, t: number): void {
    const p = this.params;
    if (step % STEPS_PER_CHORD === 0) {
      if (this.pending) this.applyStyle(t);
      // Key and mode drift with the time of day; changes land on chord boundaries.
      this.applyKey(t);
      const prog = this.style.progression;
      this.chordRoot = prog[this.chordIndex % prog.length];
      this.chordIndex++;
      // Altitude shifts the voicing: low = close and dark, high = open and airy.
      const spread = p.altitude > 0.55 ? 3 : 2;
      const octave = p.altitude < 0.3 ? -12 : 0;
      const degs = chordDegrees(this.chordRoot, 4, spread);
      const notes = degs.map(
        (d) => degreeToMidi(this.root + this.shift, this.mode, d) - 12 + octave,
      );
      this.pad(t, notes, this.sched!.stepDur * STEPS_PER_CHORD);
      const top = degreeToMidi(this.root + this.shift, this.mode, this.chordRoot + 7) + 12;
      this.shimmer[0].frequency.setTargetAtTime(midiToFreq(top), t, 1);
      this.shimmer[1].frequency.setTargetAtTime(midiToFreq(top + 7), t, 1);
      if (this.flourishPending) {
        this.flourishPending = false;
        const half = this.sched!.stepDur / 2;
        for (let i = 0; i < 6; i++) {
          const m = degreeToMidi(this.root + this.shift, this.mode, this.chordRoot + i * 2) + 12;
          this.note(t + i * half, m, 0.6, (i / 5 - 0.5) * 0.8, 3, 0.12, false);
        }
      }
    }
    if (p.paused) return;
    const s = this.style;
    const dur = this.sched!.stepDur;
    // Sparse ambient notes: rarer off the beat, favouring chord tones.
    const downbeat = step % 4 === 0;
    if (this.rand() < (downbeat ? 0.22 : 0.08) * s.density + p.flow * 0.06) {
      const deg = this.chordRoot + Math.floor(this.rand() * 4) * (this.rand() < 0.7 ? 2 : 1);
      const oct = this.rand() < 0.5 ? 0 : 12;
      const pan = (this.rand() - 0.5) * 1.2;
      const vel = 0.25 + this.rand() * 0.2;
      let at = t;
      if (this.rand() < s.grace) {
        // Ornament: a quick falling grace note from the scale step above.
        const g = degreeToMidi(this.root + this.shift, this.mode, deg + 1) + oct;
        this.note(t, g, vel * 0.6, pan, 1.6, 0.09, false);
        at = t + dur / 2;
      }
      const midi = degreeToMidi(this.root + this.shift, this.mode, deg) + oct;
      this.note(at, midi, vel, pan, 3.2, 0.09, false);
    }
    // Arpeggio layer (gain follows flow via layerBus).
    const arp = s.arp;
    if (arp && p.flow > 0.2) {
      for (let h = 0; h < arp.perStep; h++) {
        const i = (step * arp.perStep + h) % arp.pattern.length;
        const deg = this.chordRoot + arp.pattern[i];
        const midi = degreeToMidi(this.root + this.shift, this.mode, deg) + arp.octave;
        this.pluck(t + (h * dur) / arp.perStep, midi, h === 0 ? 0.6 : 0.4, i % 2 ? 0.3 : -0.3);
      }
    }
    // Lo-fi beat over a bar of eight eighths: kick on 1 and the "and" of 3, rim on 2 and 4,
    // swung hats once the player is in flow.
    if (s.pulse > 0) {
      const b = step % 8;
      if (b === 0 || b === 5) this.kick(t);
      if (b === 2 || b === 6) this.rim(t);
      if (p.flow > 0.3) this.hat(b % 2 ? t + dur * 0.12 : t, b % 2 ? 0.6 : 1);
    }
  }

  /** Slow detuned pad chord: two oscillators per note, long attack and release, into the lowpass. */
  private pad(t: number, notes: number[], dur: number): void {
    const ctx = this.engine.ctx!;
    const { wave, detune, attack, release, level } = this.style.pad;
    for (const n of notes) {
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(level, t + attack);
      g.gain.setValueAtTime(level, t + dur);
      g.gain.linearRampToValueAtTime(0, t + dur + release);
      g.connect(this.padFilter);
      for (const det of [-detune, detune]) {
        const o = ctx.createOscillator();
        o.type = wave;
        o.frequency.value = midiToFreq(n);
        o.detune.value = det + (this.rand() - 0.5) * 4;
        o.connect(g);
        o.start(t);
        o.stop(t + dur + release + 0.1);
      }
    }
  }

  /** A struck/plucked note in the level's voice. */
  private note(
    t: number,
    midi: number,
    vel: number,
    pan: number,
    dur: number,
    level: number,
    bright: boolean,
  ): void {
    switch (this.style.voice) {
      case 'bell':
        return this.bell(t, midi, vel, pan, dur, level, bright);
      case 'koto':
        return this.koto(t, midi, vel, pan, dur, level);
      case 'guqin':
        return this.guqin(t, midi, vel, pan, dur, level);
      case 'glass':
        return this.glass(t, midi, vel, pan, dur, level);
    }
  }

  /** Pan a voice into the dry bus and the level's reverb send. */
  private out(node: AudioNode, pan: number): void {
    const pn = this.engine.panner(pan);
    node.connect(pn);
    pn.connect(this.engine.musicBus);
    pn.connect(this.wet);
  }

  /**
   * FM bell: a sine carrier modulated by a sine at a slightly inharmonic ratio, with the
   * modulation index decaying faster than the amplitude, the classic struck-metal shimmer.
   */
  private bell(
    t: number,
    midi: number,
    vel: number,
    pan: number,
    dur: number,
    level: number,
    bright: boolean,
  ): void {
    const ctx = this.engine.ctx!;
    const f = midiToFreq(midi);
    const car = ctx.createOscillator();
    const mod = ctx.createOscillator();
    const modGain = ctx.createGain();
    const env = ctx.createGain();
    car.frequency.value = f;
    mod.frequency.value = f * (bright ? 2.0 : 3.01);
    modGain.gain.setValueAtTime(f * (bright ? 1.6 : 2.4) * vel, t);
    modGain.gain.exponentialRampToValueAtTime(f * 0.05 + 1, t + dur * 0.5);
    mod.connect(modGain).connect(car.frequency);
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(level * vel, t + 0.006);
    env.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    car.connect(env);
    this.out(env, pan);
    car.start(t);
    mod.start(t);
    car.stop(t + dur + 0.05);
    mod.stop(t + dur + 0.05);
  }

  /**
   * Koto: a saw through a resonant lowpass that closes fast, the bright pluck of a silk
   * string. It starts a little sharp and settles, as a plucked string does once the extra
   * tension of the pluck lets go.
   */
  private koto(
    t: number,
    midi: number,
    vel: number,
    pan: number,
    dur: number,
    level: number,
  ): void {
    const ctx = this.engine.ctx!;
    const f = midiToFreq(midi);
    const end = t + dur * 0.6;
    const o = ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.value = f;
    o.detune.setValueAtTime(25, t);
    o.detune.setTargetAtTime(0, t, 0.03);
    const flt = ctx.createBiquadFilter();
    flt.type = 'lowpass';
    flt.Q.value = 3;
    flt.frequency.setValueAtTime(Math.min(f * 10, 12000), t);
    flt.frequency.exponentialRampToValueAtTime(f * 1.3, t + 0.5);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(level * vel * 0.6, t + 0.003);
    env.gain.exponentialRampToValueAtTime(0.0001, end);
    o.connect(flt).connect(env);
    this.out(env, pan);
    o.start(t);
    o.stop(end + 0.05);
  }

  /**
   * Guqin: a soft triangle that slides up into its note from a whole tone below (the
   * player's left hand gliding along the string), then blooms a slow vibrato as it rings.
   */
  private guqin(
    t: number,
    midi: number,
    vel: number,
    pan: number,
    dur: number,
    level: number,
  ): void {
    const ctx = this.engine.ctx!;
    const f = midiToFreq(midi);
    const end = t + dur * 1.3;
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(f * 0.8909, t); // 2^(-2/12)
    o.frequency.exponentialRampToValueAtTime(f, t + 0.14);
    const vib = ctx.createOscillator();
    vib.frequency.value = 5;
    const vibDepth = ctx.createGain();
    vibDepth.gain.setValueAtTime(0, t);
    vibDepth.gain.linearRampToValueAtTime(9, t + 0.9); // cents
    vib.connect(vibDepth).connect(o.detune);
    const flt = ctx.createBiquadFilter();
    flt.type = 'lowpass';
    flt.frequency.value = Math.min(f * 5, 9000);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(level * vel * 1.3, t + 0.01);
    env.gain.exponentialRampToValueAtTime(0.0001, end);
    o.connect(flt).connect(env);
    this.out(env, pan);
    o.start(t);
    vib.start(t);
    o.stop(end + 0.05);
    vib.stop(end + 0.05);
  }

  /**
   * Glass: FM at an inharmonic 3.5 ratio struck hard and damped within a quarter second, so
   * the attack chimes like a celesta and the long tail rings almost pure, like cold glass.
   */
  private glass(
    t: number,
    midi: number,
    vel: number,
    pan: number,
    dur: number,
    level: number,
  ): void {
    const ctx = this.engine.ctx!;
    const f = midiToFreq(midi);
    const end = t + dur * 1.6;
    const car = ctx.createOscillator();
    const mod = ctx.createOscillator();
    const modGain = ctx.createGain();
    car.frequency.value = f;
    mod.frequency.value = f * 3.5;
    modGain.gain.setValueAtTime(f * 0.9 * vel, t);
    modGain.gain.exponentialRampToValueAtTime(f * 0.01 + 1, t + 0.25);
    mod.connect(modGain).connect(car.frequency);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(level * vel * 0.9, t + 0.004);
    env.gain.exponentialRampToValueAtTime(0.0001, end);
    car.connect(env);
    this.out(env, pan);
    car.start(t);
    mod.start(t);
    car.stop(end + 0.05);
    mod.stop(t + 0.3);
  }

  /** Soft plucked note for the arpeggio layer: triangle through a closing lowpass. */
  private pluck(t: number, midi: number, vel: number, pan: number): void {
    const ctx = this.engine.ctx!;
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.value = midiToFreq(midi);
    const flt = ctx.createBiquadFilter();
    flt.type = 'lowpass';
    flt.frequency.setValueAtTime(3200, t);
    flt.frequency.exponentialRampToValueAtTime(500, t + 0.4);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(0.05 * vel, t + 0.005);
    env.gain.exponentialRampToValueAtTime(0.0001, t + 0.7);
    const pn = this.engine.panner(pan);
    o.connect(flt).connect(env).connect(pn).connect(this.layerBus);
    o.start(t);
    o.stop(t + 0.75);
  }

  /** Soft kick: a sine dropping from 110 to 42 Hz, more felt than heard. */
  private kick(t: number): void {
    const ctx = this.engine.ctx!;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(110, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.18);
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t);
    env.gain.linearRampToValueAtTime(0.35, t + 0.004);
    env.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
    o.connect(env).connect(this.pulseBus);
    o.start(t);
    o.stop(t + 0.45);
  }

  /** Rim/snare: band-passed noise, short and dusty. */
  private rim(t: number): void {
    this.noiseHit(t, 'bandpass', 1700, 0.09, 0.12);
  }

  private hat(t: number, vel: number): void {
    this.noiseHit(t, 'highpass', 6500, 0.025 * vel, 0.045);
  }

  private noiseHit(
    t: number,
    type: BiquadFilterType,
    freq: number,
    level: number,
    len: number,
  ): void {
    const ctx = this.engine.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.engine.noise;
    const flt = ctx.createBiquadFilter();
    flt.type = type;
    flt.frequency.value = freq;
    const env = ctx.createGain();
    env.gain.setValueAtTime(level, t);
    env.gain.exponentialRampToValueAtTime(0.0001, t + len);
    src.connect(flt).connect(env).connect(this.pulseBus);
    src.start(t, this.rand() * 1.5, len + 0.02);
  }
}

function smooth(e0: number, e1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}
