import type { AudioEngine } from './AudioEngine';
import {
  chordDegrees,
  DAY_KEYS,
  degreeToMidi,
  type DayKey,
  midiToFreq,
  PhraseGenerator,
  PROGRESSION,
  StepScheduler,
  type ModeName,
} from './scales';
import { mulberry32 } from '../world/noise';

const BPM = 70;
const STEP = 60 / BPM / 2; // eighth notes: a slow, breathing grid
const STEPS_PER_CHORD = 16; // two bars
const LOOKAHEAD = 0.15; // s of audio scheduled ahead of the clock
const TIMER_MS = 25;

export interface MusicParams {
  speed: number; // 0..1
  altitude: number; // 0..1
  flow: number; // 0..1
  dayKey: number; // DayCycle keyframe index
  paused: boolean;
}

/**
 * Generative ambient score. A lookahead scheduler walks an eighth-note grid; on it we hang
 * slow detuned pads (lowpassed, brightness = speed), a sub drone, sparse FM bells, and layers
 * that fade in with flow (arpeggio, shimmer). Wisp pickups play the next note of a melodic
 * phrase quantized to the grid, so collecting literally writes the melody.
 */
export class Music {
  private sched: StepScheduler | null = null;
  private timer = 0;
  private readonly rand = mulberry32(2024);
  private readonly phrase = new PhraseGenerator(mulberry32(77), 8, 0, 9);
  private params: MusicParams = { speed: 0, altitude: 0.3, flow: 0, dayKey: 0, paused: false };
  // Harmony state
  private keys: DayKey[] = DAY_KEYS;
  private root = DAY_KEYS[0].root;
  private mode: ModeName = DAY_KEYS[0].mode;
  private shift = 0; // semitones added by lanterns ("modulation")
  private chordIndex = 0;
  private chordRoot = 0;
  private lastMelody = 0;
  private flourishPending = false;
  // Persistent nodes
  private padFilter!: BiquadFilterNode;
  private padBus!: GainNode;
  private drone!: OscillatorNode;
  private drone2!: OscillatorNode;
  private shimmer: OscillatorNode[] = [];
  private shimmerGain!: GainNode;
  private layerBus!: GainNode;

  constructor(private readonly engine: AudioEngine) {}

  start(): void {
    const ctx = this.engine.ctx!;
    const e = this.engine;
    this.padFilter = ctx.createBiquadFilter();
    this.padFilter.type = 'lowpass';
    this.padFilter.frequency.value = 500;
    this.padFilter.Q.value = 0.6;
    this.padBus = ctx.createGain();
    this.padBus.gain.value = 0.5;
    this.padFilter.connect(this.padBus);
    this.padBus.connect(e.musicBus);
    this.padBus.connect(e.reverbSend);

    // Sub drone: a sine on the root two octaves down, plus a quiet triangle an octave up for warmth.
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
    this.drone.start();
    this.drone2.start();

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
    this.shimmerGain.connect(e.reverbSend);

    this.layerBus = ctx.createGain();
    this.layerBus.gain.value = 0;
    this.layerBus.connect(e.musicBus);
    this.layerBus.connect(e.reverbSend);

    this.applyKey(ctx.currentTime, true);
    this.sched = new StepScheduler(STEP, ctx.currentTime + 0.1);
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
    this.bell(t, midi, 0.5 + flow * 0.3, (this.rand() - 0.5) * 0.4, 2.0, 0.17, true);
  }

  /** Swap the per-time-of-day key table (a level change); lands on the next chord boundary. */
  setKeys(keys: DayKey[]): void {
    this.keys = keys;
    this.shift = 0;
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

  private applyKey(t: number, immediate = false): void {
    const k = this.keys[this.params.dayKey % this.keys.length];
    this.root = k.root;
    this.mode = k.mode;
    const base = this.root + this.shift;
    const tc = immediate ? 0.01 : 2;
    this.drone.frequency.setTargetAtTime(midiToFreq(base - 24), t, tc);
    this.drone2.frequency.setTargetAtTime(midiToFreq(base - 12), t, tc);
  }

  private onStep(step: number, t: number): void {
    const p = this.params;
    if (step % STEPS_PER_CHORD === 0) {
      // Key and mode drift with the time of day; changes land on chord boundaries.
      this.applyKey(t);
      this.chordRoot = PROGRESSION[this.chordIndex % PROGRESSION.length];
      this.chordIndex++;
      // Altitude shifts the voicing: low = close and dark, high = open and airy.
      const spread = p.altitude > 0.55 ? 3 : 2;
      const octave = p.altitude < 0.3 ? -12 : 0;
      const degs = chordDegrees(this.chordRoot, 4, spread);
      const notes = degs.map(
        (d) => degreeToMidi(this.root + this.shift, this.mode, d) - 12 + octave,
      );
      this.pad(t, notes, STEP * STEPS_PER_CHORD);
      const top = degreeToMidi(this.root + this.shift, this.mode, this.chordRoot + 7) + 12;
      this.shimmer[0].frequency.setTargetAtTime(midiToFreq(top), t, 1);
      this.shimmer[1].frequency.setTargetAtTime(midiToFreq(top + 7), t, 1);
      if (this.flourishPending) {
        this.flourishPending = false;
        for (let i = 0; i < 6; i++) {
          const m = degreeToMidi(this.root + this.shift, this.mode, this.chordRoot + i * 2) + 12;
          this.bell(t + i * (STEP / 2), m, 0.6, (i / 5 - 0.5) * 0.8, 3, 0.12, false);
        }
      }
    }
    if (p.paused) return;
    // Sparse bells: rarer off the beat, favouring chord tones.
    const downbeat = step % 4 === 0;
    if (this.rand() < (downbeat ? 0.22 : 0.08) + p.flow * 0.06) {
      const deg = this.chordRoot + Math.floor(this.rand() * 4) * (this.rand() < 0.7 ? 2 : 1);
      const midi =
        degreeToMidi(this.root + this.shift, this.mode, deg) + (this.rand() < 0.5 ? 0 : 12);
      this.bell(t, midi, 0.25 + this.rand() * 0.2, (this.rand() - 0.5) * 1.2, 3.2, 0.09, false);
    }
    // Arpeggio layer (gain follows flow via layerBus): two sixteenths per step.
    if (p.flow > 0.2) {
      for (let h = 0; h < 2; h++) {
        const i = (step * 2 + h) % 8;
        const deg = this.chordRoot + [0, 2, 4, 6, 4, 2, 5, 3][i];
        const midi = degreeToMidi(this.root + this.shift, this.mode, deg);
        this.pluck(t + (h * STEP) / 2, midi, h === 0 ? 0.6 : 0.4, i % 2 ? 0.3 : -0.3);
      }
    }
  }

  /** Slow detuned pad chord: two saws per note, long attack and release, into the shared lowpass. */
  private pad(t: number, notes: number[], dur: number): void {
    const ctx = this.engine.ctx!;
    const attack = 2.2;
    const release = 3.5;
    for (const n of notes) {
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.045, t + attack);
      g.gain.setValueAtTime(0.045, t + dur);
      g.gain.linearRampToValueAtTime(0, t + dur + release);
      g.connect(this.padFilter);
      for (const det of [-8, 8]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = midiToFreq(n);
        o.detune.value = det + (this.rand() - 0.5) * 4;
        o.connect(g);
        o.start(t);
        o.stop(t + dur + release + 0.1);
      }
    }
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
    const pn = this.engine.panner(pan);
    car.connect(env).connect(pn);
    pn.connect(this.engine.musicBus);
    pn.connect(this.engine.reverbSend);
    car.start(t);
    mod.start(t);
    car.stop(t + dur + 0.05);
    mod.stop(t + dur + 0.05);
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
}

function smooth(e0: number, e1: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0)));
  return t * t * (3 - 2 * t);
}
