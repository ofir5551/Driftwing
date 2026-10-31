import { describe, expect, it } from 'vitest';
import {
  chordDegrees,
  degreeToMidi,
  midiToFreq,
  MODES,
  PhraseGenerator,
  StepScheduler,
} from '../src/audio/scales';
import {
  CANYON_MUSIC,
  CITY_MUSIC,
  FJORD_MUSIC,
  HIGHLANDS_MUSIC,
  JERUSALEM_MUSIC,
  KARST_MUSIC,
} from '../src/audio/styles';
import { mulberry32 } from '../src/world/noise';

describe('scales', () => {
  it('converts MIDI to frequency', () => {
    expect(midiToFreq(69)).toBeCloseTo(440);
    expect(midiToFreq(81)).toBeCloseTo(880);
  });

  it('maps degrees across octaves, including negatives', () => {
    expect(degreeToMidi(60, 'majorPenta', 0)).toBe(60);
    expect(degreeToMidi(60, 'majorPenta', 4)).toBe(69);
    expect(degreeToMidi(60, 'majorPenta', 5)).toBe(72);
    expect(degreeToMidi(60, 'majorPenta', -1)).toBe(57);
    expect(degreeToMidi(60, 'minorPenta', 1)).toBe(63);
  });

  it('every generated note stays in the scale and range', () => {
    const g = new PhraseGenerator(mulberry32(3), 8, 0, 9);
    const scale = MODES.majorPenta as readonly number[];
    for (let i = 0; i < 200; i++) {
      const d = g.next();
      expect(d).toBeGreaterThanOrEqual(0);
      expect(d).toBeLessThanOrEqual(9);
      expect(scale).toContain(((degreeToMidi(0, 'majorPenta', d) % 12) + 12) % 12);
    }
  });

  it('phrases resolve to the tonic on their last note and are deterministic', () => {
    const a = new PhraseGenerator(mulberry32(9));
    const b = new PhraseGenerator(mulberry32(9));
    const seqA = Array.from({ length: 24 }, () => a.next());
    const seqB = Array.from({ length: 24 }, () => b.next());
    expect(seqA).toEqual(seqB);
    for (let i = 7; i < 24; i += 8) expect([0, 5]).toContain(seqA[i]);
  });

  it('chords stack every other degree', () => {
    expect(chordDegrees(1, 3)).toEqual([1, 3, 5]);
  });
});

describe('StepScheduler', () => {
  it('schedules every step inside the lookahead exactly once, at exact times', () => {
    const s = new StepScheduler(0.5, 1);
    const seen: [number, number][] = [];
    // Irregular timer ticks, like a jittery setInterval.
    for (const now of [0.9, 1.02, 1.3, 1.31, 2.2, 2.25, 3.0])
      s.advance(now, 0.2, (st, t) => seen.push([st, t]));
    expect(seen.map((x) => x[0])).toEqual([0, 1, 2, 3, 4]);
    seen.forEach(([st, t]) => expect(t).toBeCloseTo(1 + st * 0.5, 9));
  });

  it('skips steps after a long stall instead of bursting them', () => {
    const s = new StepScheduler(0.25, 0);
    let count = 0;
    s.advance(0, 0.1, () => count++);
    s.advance(30, 0.1, () => count++);
    expect(count).toBeLessThan(4);
    expect(s.nextTime).toBeGreaterThanOrEqual(30 - 0.25);
  });

  it('quantizes to the subdivided grid and never double-books a slot', () => {
    const s = new StepScheduler(0.5, 10);
    const q1 = s.quantize(10.01, 2, 0.05);
    expect(q1).toBeCloseTo(10.25, 9);
    const q2 = s.quantize(10.02, 2, 0.05, q1);
    expect(q2).toBeCloseTo(10.5, 9);
    // Already on the grid with enough lead: keep it.
    expect(s.quantize(10.45, 2, 0.05)).toBeCloseTo(10.5, 9);
  });

  it('a tempo change inside a step callback respaces the following steps seamlessly', () => {
    const s = new StepScheduler(0.5, 0);
    const times: number[] = [];
    s.advance(0, 3, (st, t) => {
      times.push(t);
      if (st === 2) s.stepDur = 0.25;
    });
    expect(times.slice(0, 4)).toEqual([0, 0.5, 1, 1.25]);
    // The quantize grid follows the new tempo.
    expect(s.quantize(s.nextTime + 0.01, 1, 0) - s.nextTime).toBeCloseTo(0.25, 9);
  });
});

describe('level music styles', () => {
  const styles = {
    HIGHLANDS_MUSIC,
    CITY_MUSIC,
    KARST_MUSIC,
    FJORD_MUSIC,
    JERUSALEM_MUSIC,
    CANYON_MUSIC,
  };

  it.each(Object.entries(styles))('%s is a playable style', (_, st) => {
    expect(st.keys).toHaveLength(5);
    for (const k of st.keys) expect(MODES[k.mode]).toBeDefined();
    expect(st.bpm).toBeGreaterThanOrEqual(50);
    expect(st.bpm).toBeLessThanOrEqual(90);
    expect(st.progression.length).toBeGreaterThan(0);
    for (const d of st.progression) expect(d).toBeGreaterThanOrEqual(0);
    for (const d of st.progression) expect(d).toBeLessThan(5);
    expect(st.pad.attack + st.pad.release).toBeLessThan((60 / st.bpm / 2) * 16 * 2);
    for (const d of st.arp?.pattern ?? []) expect(d).toBeLessThanOrEqual(8);
  });

  it('every level sounds different: no two share tempo and voice', () => {
    const sig = Object.values(styles).map((s) => `${s.bpm}/${s.voice}`);
    expect(new Set(sig).size).toBe(sig.length);
  });
});
