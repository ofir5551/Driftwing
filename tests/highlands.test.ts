import { describe, expect, it } from 'vitest';
import { Config } from '../src/core/Config';
import { createHeightField } from '../src/world/Terrain';

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
