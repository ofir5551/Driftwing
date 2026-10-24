/**
 * Pure music theory + timing helpers (no Web Audio), unit-tested.
 */

/** Pentatonic flavours as semitone offsets from the root. */
export const MODES = {
  majorPenta: [0, 2, 4, 7, 9],
  minorPenta: [0, 3, 5, 7, 10],
  // "Suspended" pentatonic (no third): open and floating, good for dawn and twilight.
  susPenta: [0, 2, 5, 7, 10],
  // Japanese pentatonics for the city. Yo (min-yo folk scale) has no semitones, so stacked
  // chords stay open; hirajoshi (koto tuning) has two, giving dusk its bittersweet colour.
  yo: [0, 2, 5, 7, 9],
  hirajoshi: [0, 2, 3, 7, 8],
  // The five Chinese modes are the rotations of one pentatonic: gong is majorPenta, shang is
  // susPenta, zhi is yo and yu is minorPenta. Jue, the odd one out, adds the minor sixth.
  jue: [0, 3, 5, 8, 10],
  // Minor third with a major sixth: the dorian colour of Nordic folk tunes, in five notes.
  dorianPenta: [0, 2, 3, 7, 9],
  // Maqam colours for the City of Gold, in five notes: hijaz's lower jins (the semitone and
  // the augmented second) and its fifth; nahawand's minor tetrachord and fifth.
  hijaz: [0, 1, 4, 5, 7],
  nahawand: [0, 2, 3, 5, 7],
} as const;

export type ModeName = keyof typeof MODES;

export interface DayKey {
  root: number;
  mode: ModeName;
}

/** Key and mode per day-cycle keyframe (dawn, day, golden, dusk, twilight). Roots as MIDI. */
export const DAY_KEYS: DayKey[] = [
  { root: 62, mode: 'susPenta' }, // D, dawn
  { root: 64, mode: 'majorPenta' }, // E, day
  { root: 57, mode: 'majorPenta' }, // A, golden hour
  { root: 66, mode: 'minorPenta' }, // F#, dusk
  { root: 62, mode: 'minorPenta' }, // D, twilight
];

/** The city's keys: bright yo by day, hirajoshi once the neon comes on. */
export const CITY_KEYS: DayKey[] = [
  { root: 62, mode: 'yo' }, // D, dawn
  { root: 64, mode: 'yo' }, // E, day
  { root: 57, mode: 'yo' }, // A, golden hour
  { root: 64, mode: 'hirajoshi' }, // E, dusk
  { root: 61, mode: 'hirajoshi' }, // C#, twilight
];

/**
 * Jade River's keys walk the Chinese modes through the day, like a guqin player retuning:
 * shang at first light, gong by day, zhi in the golden hour, jue at dusk, yu at night.
 */
export const KARST_KEYS: DayKey[] = [
  { root: 62, mode: 'susPenta' }, // D shang, dawn
  { root: 60, mode: 'majorPenta' }, // C gong, day
  { root: 57, mode: 'yo' }, // A zhi, golden hour
  { root: 59, mode: 'jue' }, // B jue, dusk
  { root: 62, mode: 'minorPenta' }, // D yu, twilight
];

/**
 * Aurora Fjords' keys: a cold, open dorian under the aurora, opening out to major by day and
 * settling to minor as the light goes, like a hardanger fiddle in the next room.
 */
export const FJORD_KEYS: DayKey[] = [
  { root: 62, mode: 'susPenta' }, // D, dawn
  { root: 64, mode: 'majorPenta' }, // E, day
  { root: 57, mode: 'dorianPenta' }, // A, golden hour
  { root: 62, mode: 'minorPenta' }, // D, dusk
  { root: 59, mode: 'dorianPenta' }, // B, twilight (the aurora)
];

/**
 * City of Gold's keys: hijaz in the golden hour it opens on and after dark, the softer
 * nahawand at dawn and dusk, an open major pentatonic in the bright midday.
 */
export const JERUSALEM_KEYS: DayKey[] = [
  { root: 62, mode: 'nahawand' }, // D, dawn
  { root: 60, mode: 'majorPenta' }, // C, day
  { root: 64, mode: 'hijaz' }, // E, golden hour
  { root: 57, mode: 'nahawand' }, // A, dusk
  { root: 62, mode: 'hijaz' }, // D, twilight
];

export const midiToFreq = (m: number): number => 440 * Math.pow(2, (m - 69) / 12);

/** MIDI note for a scale degree (can be negative or beyond one octave). */
export function degreeToMidi(root: number, mode: ModeName, degree: number): number {
  const s = MODES[mode];
  const oct = Math.floor(degree / s.length);
  const idx = ((degree % s.length) + s.length) % s.length;
  return root + oct * 12 + s[idx];
}

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
