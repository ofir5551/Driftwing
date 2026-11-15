import { describe, expect, it } from 'vitest';
import { Config } from '../src/core/Config';
import { HighlandsWorld } from '../src/levels/Highlands';
import { createHeightField } from '../src/world/Terrain';
import { HighlandsScatter } from '../src/world/highlands/HighlandsScatter';
import { highlandsCover } from '../src/world/highlands/crops';
import { flyBot } from './helpers';
import {
  BUILT_SIZE,
  Field,
  HighlandsLayout,
  P,
  PROP_STRIDE,
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
  const layout = new HighlandsLayout(createHeightField(SEED), SEED);

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

describe('highlands scenery', () => {
  const f = createHeightField(SEED);
  const layout = new HighlandsLayout(f, SEED);
  const scatter = new HighlandsScatter(layout);
  const size = Config.world.chunkSize;

  /** Every building within `r` chunks of the origin. */
  const buildings = (r: number) => {
    const out: number[][] = [];
    for (let cz = -r; cz <= r; cz++)
      for (let cx = -r; cx <= r; cx++) {
        const b = layout.built(cx, cz);
        for (let k = 0; k < b.length; k += PROP_STRIDE) out.push(b.slice(k, k + PROP_STRIDE));
      }
    return out;
  };

  it('builds villages along the roads and farmsteads in the fields, on dry, gentle ground', () => {
    const all = buildings(6);
    expect(all.length).toBeGreaterThan(40);
    expect(all.some((b) => b[0] === P.Windmill)).toBe(true);
    for (const [kind, x, y, z] of all) {
      expect(kind).toBeLessThanOrEqual(P.Windmill);
      expect(y).toBeGreaterThan(1);
      // Never on the road itself.
      expect(layout.roadDist(x, z)).toBeGreaterThan(Config.highlands.roadWidth + 3);
    }
  });

  it('lifts the flight floor (and so the wisps) clear over every roof, and only near them', () => {
    expect(layout.builtLift(5000.5, 5000.5, -100)).toBe(-100); // open water: no buildings
    for (const [kind, x, y, z] of buildings(4)) {
      const roof = y + BUILT_SIZE[kind][1];
      expect(layout.builtLift(x, z, f.height(x, z))).toBeGreaterThanOrEqual(roof - 1e-6);
    }
  });

  it('keeps trees off the roads and out of the houses', () => {
    const trees: number[] = [];
    for (let cz = -3; cz <= 3; cz++)
      for (let cx = -3; cx <= 3; cx++) {
        const built = layout.built(cx, cz);
        scatter.trees(cx * size, cz * size, size, built, trees);
        for (let k = 0; k < trees.length; k += 7) {
          const x = trees[k + 1];
          const z = trees[k + 3];
          expect(layout.roadDist(x, z)).toBeGreaterThan(Config.highlands.roadWidth + 2);
          for (let b = 0; b < built.length; b += PROP_STRIDE)
            expect(Math.hypot(x - built[b + 1], z - built[b + 3])).toBeGreaterThan(
              BUILT_SIZE[built[b]][0],
            );
        }
      }
  });

  it('walls and fences only round farmed fields, hay and sheep inside them', () => {
    const props: number[] = [];
    const hedge: number[] = [];
    const fc = { u: 0, w: 0 };
    let walls = 0;
    let animals = 0;
    for (let cz = -3; cz <= 3; cz++)
      for (let cx = -3; cx <= 3; cx++) {
        scatter.props(cx * size, cz * size, size, layout.built(cx, cz), props, hedge);
        for (let k = 0; k < props.length; k += PROP_STRIDE) {
          const kind = props[k];
          const x = props[k + 1];
          const z = props[k + 3];
          if (kind === P.Wall || kind === P.Fence) {
            walls++;
            // A wall piece is on the edge of a farmed field: one of the fields either side.
            layout.fieldAt(x + 0.8, z + 0.8, fc);
            const a = layout.cellFarmed(fc.u, fc.w);
            layout.fieldAt(x - 0.8, z - 0.8, fc);
            expect(a || layout.cellFarmed(fc.u, fc.w)).toBe(true);
          }
          if (kind === P.Hay) {
            animals++;
            layout.fieldAt(x, z, fc);
            expect(layout.cellFarmed(fc.u, fc.w)).toBe(true);
            expect(fieldKind(fc.u, fc.w)).toBe(Field.Wheat);
          }
        }
      }
    expect(walls).toBeGreaterThan(100);
    expect(animals).toBeGreaterThan(10);
  });

  it('an autopilot flies the wisps over villages and roads: none inside a house or the ground', () => {
    const world = new HighlandsWorld(SEED);
    const inHouse = (x: number, y: number, z: number) => {
      const size = Config.world.chunkSize;
      const b = layout.built(Math.floor(x / size), Math.floor(z / size));
      for (let k = 0; k < b.length; k += PROP_STRIDE) {
        const [r, h] = BUILT_SIZE[b[k]];
        if (Math.hypot(x - b[k + 1], z - b[k + 3]) < r && y < b[k + 2] + h) return true;
      }
      return false;
    };
    const r = flyBot(
      world,
      { x: 0, y: 45, z: 0, yaw: 0 },
      SEED,
      90,
      (x, y, z) => y < f.height(x, z) || inHouse(x, y, z),
    );
    expect(r.inside).toBe(0);
    expect(r.got).toBeGreaterThan(80);
  }, 60_000);
});

describe('highlands crops', () => {
  const layout = new HighlandsLayout(createHeightField(SEED), SEED);
  const style = highlandsCover(layout);
  const tuft = () => ({
    r: 0.3,
    g: 0.5,
    b: 0.2,
    scale: 1,
    bare: false,
    bloom: -1,
    petal: -1,
    extra: 999,
  });

  it('ploughs bare, stands wheat tall and golden, leaves the road bare', () => {
    const at = { x: 0, z: 0 };
    const seen = new Set<number>();
    for (let j = -30; j <= 30; j++)
      for (let i = -30; i <= 30; i++) {
        if (!layout.cellFarmed(i, j)) continue;
        const kind = fieldKind(i, j);
        fieldCentre(i, j, at);
        const t = tuft();
        style.paint!(at.x, at.z, 5, t);
        if (kind === Field.Plough) expect(t.bare).toBe(true);
        if (kind === Field.Wheat)
          expect([t.bare, t.scale > 1.3, t.r > t.b]).toEqual([false, true, true]);
        if (kind === Field.Meadow) expect(t).toEqual(tuft());
        seen.add(kind);
      }
    expect(seen.size).toBe(6);
    const road = tuft();
    road.extra = Config.highlands.roadOffset + 0.5;
    style.paint!(9999.5, 9999.5, 5, road);
    expect(road.bare).toBe(true);
  });
});
