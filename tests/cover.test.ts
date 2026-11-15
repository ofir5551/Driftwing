import { describe, expect, it } from 'vitest';
import { Config } from '../src/core/Config';
import {
  COVER_STRIDE,
  scatterCover,
  type CoverLattice,
  type CoverStyle,
} from '../src/world/GroundCover';
import { createNoise2D } from '../src/world/noise';

/** A chunk lattice from a height function (chunk-local positions, grey ground). */
function lattice(
  ox: number,
  oz: number,
  size: number,
  res: number,
  h: (x: number, z: number) => number,
): CoverLattice {
  const n = res + 1;
  const positions = new Float32Array(n * n * 3);
  const colors = new Float32Array(n * n * 3).fill(0.5);
  const step = size / res;
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const k = (j * n + i) * 3;
      positions[k] = i * step;
      positions[k + 1] = h(ox + i * step, oz + j * step);
      positions[k + 2] = j * step;
    }
  return { ox, oz, size, res, positions, colors };
}

const style: CoverStyle = { tint: [1, 1.2, 0.8], height: 1, minY: 1, maxY: 50 };
const drift = createNoise2D(1);
const hue = createNoise2D(2);
const items = (arr: number[]) => {
  const out: number[][] = [];
  for (let k = 0; k < arr.length; k += COVER_STRIDE) out.push(arr.slice(k, k + COVER_STRIDE));
  return out;
};

describe('ground cover', () => {
  it('sits on the lattice surface, coloured from the ground and tinted', () => {
    const t: number[] = [];
    const f: number[] = [];
    scatterCover(
      lattice(0, 0, 40, 10, () => 5),
      style,
      7,
      drift,
      hue,
      [],
      t,
      f,
    );
    const all = items(t);
    // Every cell of the chunk at full density.
    expect(all.length).toBe(Math.ceil(40 / Config.cover.cell) ** 2);
    for (const [x, y, z, s, r, g, b, keep] of all) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(40 + Config.cover.cell);
      expect(z).toBeGreaterThanOrEqual(0);
      expect(y).toBeCloseTo(4.94);
      expect(s).toBeGreaterThan(0.6);
      expect([r, g, b].map((v) => +v.toFixed(3))).toEqual([0.5, 0.6, 0.4]);
      expect(keep).toBeGreaterThanOrEqual(0);
      expect(keep).toBeLessThan(1);
    }
    expect(f.length).toBe(0); // no flowers in this style
  });

  it('follows a slope (bilinear in the lattice cell)', () => {
    const t: number[] = [];
    scatterCover(
      lattice(0, 0, 40, 10, (x) => 2 + x * 0.1),
      style,
      7,
      drift,
      hue,
      [],
      t,
      [],
    );
    for (const [x, y] of items(t)) expect(y).toBeCloseTo(2 + x * 0.1 - 0.06, 3);
  });

  it('leaves water, the heights and steep rock bare', () => {
    const t: number[] = [];
    // Water below x = 10, a cliff from x = 25 to 30, high ground beyond.
    const h = (x: number) => (x < 10 ? -2 : x < 25 ? 5 : x < 30 ? 5 + (x - 25) * 20 : 105);
    scatterCover(lattice(0, 0, 40, 40, h), style, 7, drift, hue, [], t, []);
    expect(t.length).toBeGreaterThan(0);
    for (const [x] of items(t)) {
      expect(x).toBeGreaterThan(9);
      expect(x).toBeLessThan(26);
    }
  });

  it('honours the style rule and is deterministic', () => {
    const a: number[] = [];
    const b: number[] = [];
    const rule: CoverStyle = { ...style, accept: (x) => x > 20 };
    scatterCover(
      lattice(160, -160, 40, 10, () => 5),
      rule,
      3,
      drift,
      hue,
      [],
      a,
      [],
    );
    scatterCover(
      lattice(160, -160, 40, 10, () => 5),
      rule,
      3,
      drift,
      hue,
      [],
      b,
      [],
    );
    expect(a).toEqual(b);
    for (const [x] of items(a)) expect(x).toBeGreaterThan(20);
  });

  it('never doubles tufts across a chunk seam', () => {
    const a: number[] = [];
    const b: number[] = [];
    scatterCover(
      lattice(0, 0, 40, 10, () => 5),
      style,
      9,
      drift,
      hue,
      [],
      a,
      [],
    );
    scatterCover(
      lattice(40, 0, 40, 10, () => 5),
      style,
      9,
      drift,
      hue,
      [],
      b,
      [],
    );
    const keys = new Set(items(a).map(([x, , z]) => `${x},${z}`));
    for (const [x, , z] of items(b)) expect(keys.has(`${x},${z}`)).toBe(false);
  });

  it('grows flowers in drifts, in the style colours', () => {
    const t: number[] = [];
    const f: number[] = [];
    const petals = [1, 0, 0, 0, 0, 1];
    const flowery: CoverStyle = { ...style, flowers: { chance: 1, colors: ['#f00', '#00f'] } };
    scatterCover(
      lattice(0, 0, 160, 40, () => 5),
      flowery,
      5,
      drift,
      hue,
      petals,
      t,
      f,
    );
    const fl = items(f);
    expect(fl.length).toBeGreaterThan(10);
    expect(fl.length).toBeLessThan(items(t).length);
    for (const [, , , , r, g, b] of fl)
      expect([r, g, b]).toSatisfy((c: number[]) => c.join() === '1,0,0' || c.join() === '0,0,1');
  });
});

describe('ground cover paint hook', () => {
  it('lets a style leave spots bare, recolour, resize and read its extra attribute', () => {
    const lat = lattice(0, 0, 40, 10, () => 5);
    // An extra attribute that runs 0..40 along x (one component per vertex).
    const n = 11;
    const extra = new Float32Array(n * n);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) extra[j * n + i] = i * 4;
    const painted: CoverStyle = {
      ...style,
      paint: (x, _z, _y, t) => {
        expect(t.extra).toBeCloseTo(Math.min(x, 40), 3);
        if (x < 20) t.bare = true;
        else {
          t.r = 0.9;
          t.scale = 2;
        }
      },
    };
    const t: number[] = [];
    scatterCover({ ...lat, extra, extraSize: 1 }, painted, 4, drift, hue, [], t, []);
    expect(t.length).toBeGreaterThan(0);
    for (const [x, , , s, r] of items(t)) {
      expect(x).toBeGreaterThanOrEqual(20);
      expect(s).toBe(2);
      expect(r).toBe(0.9);
    }
  });
});
