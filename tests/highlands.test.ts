import { describe, expect, it } from 'vitest';
import { Config } from '../src/core/Config';
import { createHeightField } from '../src/world/Terrain';
import {
  HighlandsLayout,
  fieldCentre,
  fieldCoords,
  fieldKind,
} from '../src/world/highlands/HighlandsLayout';

const SEED = Config.world.seed;

describe('highlands geography', () => {
  const f = createHeightField(SEED);

  it('runs a river below the water along every valley floor, with a low flood plain beside it', () => {
    let centre = 0;
    let wet = 0;
    let plain = 0;
    let low = 0;
    for (let z = -3000; z <= 3000; z += 23)
      for (let x = -3000; x <= 3000; x += 23) {
        const d = Math.abs(f.riverDist(x, z));
        const y = f.height(x, z);
        if (d < 2) {
          centre++;
          if (y < Config.world.waterLevel) wet++;
        } else if (d > 14 && d < 18 && Math.hypot(x, z) > 600) {
          plain++;
          if (y < Config.highlands.plainHeight + 4) low++;
        }
      }
    expect(centre).toBeGreaterThan(50);
    expect(wet / centre).toBeGreaterThan(0.9);
    expect(low / plain).toBeGreaterThan(0.75);
  });

  it('farms the low, gentle country, and the woods stop at the fields', () => {
    let farmed = 0;
    for (let z = -2000; z <= 2000; z += 31)
      for (let x = -2000; x <= 2000; x += 31) {
        const a = f.farm(x, z);
        expect(a).toBeGreaterThanOrEqual(0);
        expect(a).toBeLessThanOrEqual(1);
        if (a > 0.45) {
          farmed++;
          expect(f.forest(x, z)).toBe(0);
          const y = f.height(x, z);
          expect(y).toBeGreaterThan(0.8);
          expect(y).toBeLessThan(40);
        }
      }
    expect(farmed).toBeGreaterThan(200);
  });

  it('keeps the spawn (45 m up) clear of the ground round it', () => {
    for (let a = 0; a < 6.28; a += 0.5)
      for (const r of [0, 50, 150])
        expect(f.height(Math.sin(a) * r, Math.cos(a) * r)).toBeLessThan(30);
  });
});

/** The shader's crop hash in float32 arithmetic, as the GPU does it. */
function glslKind(i: number, j: number): number {
  const f = Math.fround;
  const n = f(
    f(f(f(f(f(f(i * i) * 31) + f(f(j * j) * 17)) + f(f(i * j) * 7)) + f(i * 13)) + f(j * 29)),
  );
  const mod = (x: number, y: number) => f(x - f(y * Math.floor(f(x / y))));
  return mod(mod(n, 97), 6);
}

describe('highlands fields', () => {
  const layout = new HighlandsLayout(createHeightField(SEED));

  it('picks the same crop on the CPU as the shader does in float32', () => {
    for (let j = -300; j <= 300; j += 7)
      for (let i = -300; i <= 300; i += 3) expect(fieldKind(i, j)).toBe(glslKind(i, j));
  });

  it('maps field centres back onto their own field', () => {
    const at = { x: 0, z: 0 };
    const fc = { u: 0, w: 0 };
    for (const [i, j] of [
      [0, 0],
      [-5, 12],
      [40, -33],
    ]) {
      fieldCentre(i, j, at);
      fieldCoords(at.x, at.z, fc);
      expect([Math.floor(fc.u), Math.floor(fc.w)]).toEqual([i, j]);
    }
  });

  it('packs the 3x3 farmed flags round a field into its mask', () => {
    let some = 0;
    for (let j = -20; j <= 20; j++)
      for (let i = -20; i <= 20; i++) {
        const m = layout.farmMask(i, j);
        for (let dj = -1; dj <= 1; dj++)
          for (let di = -1; di <= 1; di++) {
            const bit = Math.floor(m / 2 ** ((dj + 1) * 3 + di + 1)) % 2;
            expect(bit === 1).toBe(layout.cellFarmed(i + di, j + dj));
          }
        if (layout.cellFarmed(i, j)) some++;
      }
    expect(some).toBeGreaterThan(50);
  });
});
