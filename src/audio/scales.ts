/**
 * Pure music theory + timing helpers (no Web Audio), unit-tested.
 */

/** Pentatonic flavours as semitone offsets from the root. */
export const MODES = {
  majorPenta: [0, 2, 4, 7, 9],
  minorPenta: [0, 3, 5, 7, 10],
  // "Suspended" pentatonic (no third): open and floating, good for dawn and twilight.
  susPenta: [0, 2, 5, 7, 10],
} as const;

export type ModeName = keyof typeof MODES;

/** Key and mode per day-cycle keyframe (dawn, day, golden, dusk, twilight). Roots as MIDI. */
export const DAY_KEYS: { root: number; mode: ModeName }[] = [
  { root: 62, mode: 'susPenta' }, // D, dawn
  { root: 64, mode: 'majorPenta' }, // E, day
  { root: 57, mode: 'majorPenta' }, // A, golden hour
  { root: 66, mode: 'minorPenta' }, // F#, dusk
  { root: 62, mode: 'minorPenta' }, // D, twilight
];

export const midiToFreq = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);

/** MIDI note for a scale degree (can be negative or beyond one octave). */
export function degreeToMidi(root: number, mode: ModeName, degree: number): number {
  const s = MODES[mode];
  const oct = Math.floor(degree / s.length);
  const idx = ((degree % s.length) + s.length) % s.length;
  return root + oct * 12 + s[idx];
}

/** Chord progression in scale degrees (root of each chord), two bars each. */
export const PROGRESSION = [0, 3, 1, 4, 0, 2, 3, 4];

/** Stack every other scale degree from `rootDegree` (pentatonic "triads" sound open, never sour). */
export function chordDegrees(rootDegree: number, voices: number, spread = 2): number[] {
  const out: number[] = [];
  for (let i = 0; i < voices; i++) out.push(rootDegree + i * spread);
  return out;
}

/**
 * Melodic phrase generator: a gentle random walk over scale degrees, mostly steps, the odd
 * leap, and every phrase of `length` notes comes home to the tonic so collecting a run of
 * wisps sounds like a complete musical sentence.
 */
export class PhraseGenerator {
  private degree = 2;
  private index = 0;

  constructor(
    private readonly rand: () => number,
    readonly length = 8,
    private readonly lo = 0,
    private readonly hi = 9,
  ) {}

  next(): number {
    const pos = this.index % this.length;
    this.index++;
    if (pos === this.length - 1) {
      // Cadence: resolve to the tonic (or its octave, whichever is nearer).
      this.degree = Math.abs(this.degree - 5) < Math.abs(this.degree) ? 5 : 0;
      return this.degree;
    }
    const r = this.rand();
    let step = r < 0.7 ? 1 : r < 0.92 ? 2 : 3;
    // Arch contour: rise in the first half, fall in the second.
    let dir = pos < this.length / 2 ? 1 : -1;
    if (this.rand() < 0.3) dir = -dir;
    if (this.degree + dir * step > this.hi || this.degree + dir * step < this.lo) dir = -dir;
    step = Math.min(step, Math.max(1, Math.abs((dir > 0 ? this.hi : this.lo) - this.degree)));
    this.degree += dir * step;
    return this.degree;
  }

  reset(): void {
    this.index = 0;
  }
}

/**
 * Lookahead step scheduler ("A Tale of Two Clocks"). The audio clock is sample-accurate but
 * JS timers are not, so a cheap timer wakes often and schedules every grid step that falls
 * inside the next `ahead` seconds at its exact audio time. Dropped frames or a slow timer
 * only shrink the safety margin; they never shift a note.
 */
export class StepScheduler {
  step = 0;
  nextTime: number;

  constructor(
    public stepDur: number,
    startTime: number,
  ) {
    this.nextTime = startTime;
  }

  /** Call often. Invokes `cb` for every step with time < now + ahead. */
  advance(now: number, ahead: number, cb: (step: number, time: number) => void): void {
    // If we fell far behind (tab was suspended), skip missed steps rather than burst them.
    if (this.nextTime < now - this.stepDur) {
      const missed = Math.ceil((now - this.nextTime) / this.stepDur);
      this.step += missed;
      this.nextTime += missed * this.stepDur;
    }
    while (this.nextTime < now + ahead) {
      cb(this.step, this.nextTime);
      this.step++;
      this.nextTime += this.stepDur;
    }
  }

  /**
   * Earliest grid time (on a `div`-subdivided grid) at or after `t + minLead` that is not
   * already taken (> `after`). Used to quantize wisp notes so rapid pickups form a rhythm.
   */
  quantize(t: number, div: number, minLead: number, after = -Infinity): number {
    const g = this.stepDur / div;
    const origin = this.nextTime - this.stepDur * 64; // any grid-aligned time in the past
    let q = origin + Math.ceil((t + minLead - origin) / g - 1e-9) * g;
    while (q <= after + 1e-6) q += g;
    return q;
  }
}
