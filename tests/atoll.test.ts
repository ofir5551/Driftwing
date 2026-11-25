import { describe, expect, it } from 'vitest';
import { ATOLL_KEYS, MODES } from '../src/audio/scales';
import { ATOLL_MUSIC } from '../src/audio/styles';
import { Config } from '../src/core/Config';
import {
  AtollLayout,
  HUT_STRIDE,
  HUT_TOP,
  ROCK_SHAPES,
  rockProfile,
  type Rock,
} from '../src/world/atoll/AtollLayout';
import {
  AtollScatter,
  P,
  PATHS,
  PROP_STRIDE,
  pathPhase,
  pathRadius,
} from '../src/world/atoll/AtollScatter';
import { atollCover } from '../src/world/atoll/cover';
import type { CoverTuft } from '../src/world/GroundCover';
import { AtollWorld } from '../src/world/atoll/AtollWorld';
import { flyBot } from './helpers';

const L = new AtollLayout(1337);

/** Every rock centred in a square around the origin. */
function rocksAround(layout: AtollLayout, half: number): Rock[] {
  const C = Config.atoll.rockCell;
  const out: Rock[] = [];
  for (let j = Math.floor(-half / C); j <= Math.floor(half / C); j++)
    for (let i = Math.floor(-half / C); i <= Math.floor(half / C); i++)
      out.push(...layout.cell(i, j));
  return out;
}

describe('atoll layout', () => {
  it('is deterministic per seed', () => {
    const a = new AtollLayout(42);
    const b = new AtollLayout(42);
    expect(a.atoll(2, -1)).toEqual(b.atoll(2, -1));
    expect(a.cell(3, 5)).toEqual(b.cell(3, 5));
    expect(a.height(123, -456)).toBe(b.height(123, -456));
  });

  it('starts the bird over the home lagoon, facing the high island with open water ahead', () => {
    for (const seed of [1337, 42, 7, 2024]) {
      const l = new AtollLayout(seed);
      const s = l.spawn;
      const home = l.atoll(0, 0)!;
      expect(home.island).not.toBeNull();
      l.ring(s.x, s.z);
      expect(l.ra).toBe(home);
      expect(l.rs).toBeLessThan(-home.w - 60);
      expect(l.height(s.x, s.z)).toBeLessThan(-3);
      // The fang is ahead (within 0.3 rad of the spawn's heading) and rises well up.
      const I = home.island!;
      expect(Math.abs(Math.atan2(I.tx - s.x, I.tz - s.z) - s.yaw)).toBeLessThan(0.3);
      expect(l.height(I.tx, I.tz)).toBeGreaterThan(140);
      for (let d = 0; d < 220; d += 3) {
        const x = s.x + Math.sin(s.yaw) * d;
        const z = s.z + Math.cos(s.yaw) * d;
        expect(l.solidTop(x, s.y, z, 3)).toBe(-Infinity);
        expect(l.height(x, z)).toBeLessThan(0);
      }
    }
  });

  it('rings every atoll with a reef that carries islets and is cut by passes', () => {
    let atolls = 0;
    for (let j = -3; j <= 3; j++)
      for (let i = -3; i <= 3; i++) {
        const a = L.atoll(i, j);
        if (!a) continue;
        atolls++;
        expect(a.passes.length).toBeGreaterThan(0);
        // Islets above the water somewhere round the ring, none in a pass.
        let land = 0;
        for (let k = 0; k < 180; k++) {
          const th = (k / 180) * Math.PI * 2;
          const R = L.ringR(a, th) - a.w * 0.15;
          if (L.height(a.x + Math.sin(th) * R, a.z + Math.cos(th) * R) > 1) land++;
        }
        expect(land).toBeGreaterThan(20);
        expect(land).toBeLessThan(160);
        for (const pa of a.passes) {
          const R = L.ringR(a, pa);
          expect(L.height(a.x + Math.sin(pa) * R, a.z + Math.cos(pa) * R)).toBeLessThan(-4);
        }
        // Deep ocean outside (round most of the ring: a neighbour's slope may reach the rest).
        let deep = 0;
        for (let k = 0; k < 12; k++) {
          const th = (k / 12) * Math.PI * 2;
          const R = L.ringR(a, th) + a.w + 160;
          if (L.height(a.x + Math.sin(th) * R, a.z + Math.cos(th) * R) < -25) deep++;
        }
        expect(deep).toBeGreaterThan(8);
      }
    expect(atolls).toBeGreaterThan(30);
  });

  it('lets the bird dive under deep water only, clear of reef, rock and stilts', () => {
    const A = Config.atoll;
    const sea = Config.world.waterLevel;
    let deep = 0;
    let n = 0;
    for (let z = -2000; z <= 2000; z += 29)
      for (let x = -2000; x <= 2000; x += 31) {
        const k = L.softness(x, z);
        expect(k).toBeGreaterThanOrEqual(0);
        expect(k).toBeLessThanOrEqual(1);
        n++;
        if (k >= 1) deep++;
        // Never where the water under the bird is shallower than the threshold.
        if (sea - L.height(x, z) < A.diveShallow) expect(k).toBe(0);
        // Nor by a rock (its stem runs on down under the water) or under a hut or pier.
        if (L.skyline(x, z, A.diveNear) !== -Infinity) expect(k).toBe(0);
        if (L.roofAt(x, z) > -Infinity) expect(k).toBe(0);
      }
    // The open ocean between the atolls is most of the sea.
    expect(deep / n).toBeGreaterThan(0.4);
  });

  it('keeps neighbouring reefs apart', () => {
    for (let j = -3; j <= 3; j++)
      for (let i = -3; i <= 3; i++) {
        const a = L.atoll(i, j);
        const b = L.atoll(i + 1, j);
        const c = L.atoll(i, j + 1);
        for (const o of [b, c])
          if (a && o) {
            const d = Math.hypot(a.x - o.x, a.z - o.z);
            expect(d).toBeGreaterThan(a.R * 1.2 + o.R * 1.2 + a.w + o.w + 60);
          }
      }
  });

  it('stands mushroom rocks inside the lagoons only, clear of islands and piers', () => {
    const rs = rocksAround(L, 1500);
    expect(rs.length).toBeGreaterThan(30);
    for (const r of rs) {
      L.ring(r.x, r.z);
      const a = L.ra!;
      expect(L.rs).toBeLessThan(-a.w - 40);
      expect(L.height(r.x, r.z)).toBeLessThan(-3);
      expect(r.y0).toBeLessThan(L.height(r.x, r.z));
      if (a.island)
        expect(Math.hypot(r.x - a.island.x, r.z - a.island.z)).toBeGreaterThan(a.island.r);
      expect(L.nearOpening(r.x, r.z, 40)).toBe(false);
    }
  });

  it('profiles a notch at the waterline under an overhanging, domed cap', () => {
    for (const sh of ROCK_SHAPES) {
      const tw = 9 / sh.H;
      expect(rockProfile(sh, tw + 0.02)).toBeLessThan(rockProfile(sh, sh.cap) * 0.8);
      expect(rockProfile(sh, sh.cap)).toBeCloseTo(1, 5);
      expect(rockProfile(sh, 0.999)).toBeLessThan(0.1);
      expect(rockProfile(sh, 1)).toBe(0);
    }
  });

  it('pushes a point out of a rock: sideways on the flank, up on the cap', () => {
    const p = rocksAround(L, 900).find((q) => q.h > 25)!;
    const n = { x: 0, y: 0, z: 0 };
    // Just over the water: the stem, under the dome (on the dome the margin also reaches up).
    const mid = 1;
    const r = L.radiusAt(p, mid);
    const flank = { x: p.x + r - 1.5, y: mid, z: p.z };
    expect(L.pushPoint(flank, 1, n)).toBeGreaterThan(0);
    expect(n.x).toBeGreaterThan(0.9);
    expect(n.y).toBe(0);
    expect(L.solidTop(flank.x, flank.y, flank.z, 0.99)).toBe(-Infinity);
    const top = { x: p.x, y: p.y0 + p.h - 1, z: p.z };
    L.pushPoint(top, 1, n);
    expect(n.y).toBe(1);
    expect(top.y).toBeGreaterThanOrEqual(p.top);
    for (const v of [flank.x, flank.y, flank.z, top.x, top.y, top.z])
      expect(Number.isFinite(v)).toBe(true);
  });

  it('builds a pier of bungalows off the home island, standing in the water', () => {
    const home = L.atoll(0, 0)!;
    expect(home.bungalows.length / 3).toBeGreaterThanOrEqual(8);
    for (let k = 0; k < home.bungalows.length; k += 3) {
      expect(L.height(home.bungalows[k], home.bungalows[k + 1])).toBeLessThan(-1.5);
      expect(L.bungalowAt(home.bungalows[k], home.bungalows[k + 1])).toBeGreaterThan(5);
    }
  });

  it('reports the high island as solid to the look-ahead, and the islets as soft ground', () => {
    const I = L.atoll(0, 0)!.island!;
    expect(L.solidTop(I.tx, 60, I.tz, 2)).toBeGreaterThan(60);
    expect(L.hit[1]).toBe(-Infinity);
    const w = new AtollWorld(1337);
    // Somewhere on a motu: the palms make soft canopy above the sand.
    const a = L.atoll(1, 0) ?? L.atoll(0, 1)!;
    let found = false;
    for (let k = 0; k < 360 && !found; k++) {
      const th = (k / 360) * Math.PI * 2;
      const R = L.ringR(a, th) - a.w * 0.15;
      const x = a.x + Math.sin(th) * R;
      const z = a.z + Math.cos(th) * R;
      const g = L.height(x, z);
      if (g > 2) {
        found = true;
        expect(w.flightGround(x, z)).toBeGreaterThan(g + 4);
        expect(L.solidTop(x, g + 1, z, 2)).toBe(-Infinity);
      }
    }
    expect(found).toBe(true);
    w.dispose();
  });
});

describe('atoll villages', () => {
  it('builds a village off the home island, ahead and to the left, clear of the opening run', () => {
    for (const seed of [1, 1337, 42]) {
      const l = new AtollLayout(seed);
      const v = l.atoll(0, 0)!.village!;
      expect(v).not.toBeNull();
      expect(v.huts.length / HUT_STRIDE).toBeGreaterThanOrEqual(8);
      // Left of the spawn (+x is the bird's left facing +z) and ahead of it.
      expect(v.x).toBeGreaterThan(l.spawn.x + 60);
      expect(v.z).toBeGreaterThan(l.spawn.z + 200);
      for (let k = 0; k < v.huts.length; k += HUT_STRIDE)
        expect(l.nearOpening(v.huts[k], v.huts[k + 1], 60)).toBe(false);
    }
  });

  it('stands huts on stilts over shallow water or on the sand, clear of the rocks', () => {
    let water = 0;
    let land = 0;
    let villages = 0;
    for (let j = -3; j <= 3; j++)
      for (let i = -3; i <= 3; i++) {
        const v = L.atoll(i, j)?.village;
        if (!v) continue;
        villages++;
        for (let k = 0; k < v.huts.length; k += HUT_STRIDE) {
          const x = v.huts[k];
          const z = v.huts[k + 1];
          const y0 = v.huts[k + 3];
          const g = L.height(x, z);
          if (y0 === 0) {
            water++;
            expect(g).toBeLessThan(-0.6);
            expect(g).toBeGreaterThan(-3); // the shelf: short stilts
          } else {
            land++;
            expect(Math.abs(g - y0)).toBeLessThan(0.01);
            expect(y0).toBeGreaterThan(0.6);
          }
          expect(L.skyline(x, z, 12)).toBe(-Infinity);
          // No two huts overlap.
          for (let n = k + HUT_STRIDE; n < v.huts.length; n += HUT_STRIDE)
            expect(Math.hypot(x - v.huts[n], z - v.huts[n + 1])).toBeGreaterThan(9);
        }
      }
    expect(villages).toBeGreaterThan(8);
    expect(water).toBeGreaterThan(villages * 4);
    expect(land).toBeGreaterThan(villages);
  });

  it('keeps the huts and walkways under the flight floor (soft roofs)', () => {
    const w = new AtollWorld(1337);
    const v = w.layout.atoll(0, 0)!.village!;
    for (let k = 0; k < v.huts.length; k += HUT_STRIDE) {
      const top = v.huts[k + 3] + HUT_TOP * v.huts[k + 4];
      expect(w.flightGround(v.huts[k], v.huts[k + 1])).toBeGreaterThanOrEqual(top);
      expect(w.layout.solidTop(v.huts[k], top - 1, v.huts[k + 1], 1)).toBe(-Infinity);
    }
    for (let k = 0; k < v.walks.length; k += 4)
      expect(w.flightGround(v.walks[k], v.walks[k + 1])).toBeGreaterThan(2.2);
    w.dispose();
  });

  it('lifts sand bars just clear of the water, never on the opening run', () => {
    let bars = 0;
    for (let j = -2; j <= 2; j++)
      for (let i = -2; i <= 2; i++) {
        const a = L.atoll(i, j);
        if (!a) continue;
        for (let k = 0; k < 720; k++) {
          const th = (k / 720) * Math.PI * 2;
          for (const d of [30, 50, 70]) {
            const R = L.ringR(a, th) - a.w - d;
            const y = L.height(a.x + Math.sin(th) * R, a.z + Math.cos(th) * R);
            if (
              y > 0.05 &&
              !(
                a.island &&
                Math.hypot(
                  a.x + Math.sin(th) * R - a.island.x,
                  a.z + Math.cos(th) * R - a.island.z,
                ) <
                  a.island.r * 1.4
              )
            ) {
              bars++;
              expect(y).toBeLessThan(0.9);
            }
          }
        }
      }
    expect(bars).toBeGreaterThan(20);
    const s = L.spawn;
    for (let d = 0; d < 300; d += 3) expect(L.height(s.x, s.z + d)).toBeLessThan(0);
  });
});

describe('atoll scatter', () => {
  const S = new AtollScatter(L);
  const all: number[] = [];
  const size = Config.world.chunkSize;
  for (let cz = -2; cz <= 5; cz++)
    for (let cx = -4; cx <= 4; cx++) S.props(cx * size, cz * size, size, all);

  it('is deterministic', () => {
    const a: number[] = [];
    const b: number[] = [];
    new AtollScatter(new AtollLayout(1337)).props(160, 320, size, a);
    new AtollScatter(new AtollLayout(1337)).props(160, 320, size, b);
    expect(a).toEqual(b);
    const t1: number[] = [];
    const t2: number[] = [];
    S.sites(160, 320, size, t1);
    new AtollScatter(new AtollLayout(1337)).sites(160, 320, size, t2);
    expect(t1).toEqual(t2);
  });

  it('puts canoes on the beaches, nets and life in the water, birds in the air', () => {
    const seen = new Set<number>();
    for (let k = 0; k < all.length; k += PROP_STRIDE) {
      const kind = all[k];
      const x = all[k + 1];
      const y = all[k + 2];
      const z = all[k + 3];
      seen.add(kind);
      const g = L.height(x, z);
      if (kind === P.Canoe) {
        expect(g).toBeGreaterThan(0.2);
        expect(g).toBeLessThan(1.05);
      } else if (kind === P.Net) {
        expect(g).toBeLessThan(-0.3);
        expect(L.skyline(x, z, 10)).toBe(-Infinity);
      } else if (kind === P.Coral) {
        expect(y).toBeLessThan(-1.2);
        expect(Math.abs(y + 0.1 - g)).toBeLessThan(0.01);
      } else if (kind === P.Bird) {
        expect(y).toBeGreaterThan(Math.max(g, 0) + 8);
      } else if (kind === P.Fish || kind === P.Turtle || kind === P.Ray || kind === P.Paddler) {
        // The whole circle it follows stays in water deeper than it swims, clear of rock.
        const anim = { [P.Fish]: 2, [P.Turtle]: 3, [P.Ray]: 4, [P.Paddler]: 5 }[kind]!;
        const r = pathRadius(anim, x, z);
        for (let n = 0; n < 24; n++) {
          const a = (n / 24) * Math.PI * 2;
          const px = x + Math.cos(a) * r;
          const pz = z + Math.sin(a) * r;
          expect(L.height(px, pz)).toBeLessThan(Math.min(y, 0) - 0.4);
          expect(L.solidTop(px, -0.5, pz, 1)).toBe(-Infinity);
        }
      }
    }
    for (const k of [P.Canoe, P.Net, P.Coral, P.Fish, P.Bird]) expect(seen.has(k)).toBe(true);
  });

  it("agrees with the shader on a moving thing's circle", () => {
    for (const [x, z] of [
      [0, 0],
      [123.4, -987.6],
      [4000, 2500],
    ]) {
      const ph = pathPhase(x, z);
      expect(ph).toBeGreaterThanOrEqual(0);
      expect(ph).toBeLessThan(1);
      // float32, as the GPU sees it
      const f = Math.fround(
        Math.fround(x) * Math.fround(0.0137) + Math.fround(z) * Math.fround(0.0291),
      );
      expect(Math.abs(f - Math.floor(f) - ph)).toBeLessThan(1e-3);
    }
    expect(Object.keys(PATHS).length).toBe(5);
  });

  it('keeps trees off the huts', () => {
    const v = L.atoll(0, 0)!.village!;
    const trees: number[] = [];
    for (let cz = 1; cz <= 3; cz++)
      for (let cx = 0; cx <= 2; cx++) S.trees(cx * size, cz * size, size, trees);
    for (let k = 0; k < trees.length; k += 7)
      for (let n = 0; n < v.huts.length; n += HUT_STRIDE)
        expect(Math.hypot(trees[k + 1] - v.huts[n], trees[k + 3] - v.huts[n + 1])).toBeGreaterThan(
          3.5,
        );
  });

  it('grows seagrass under the water and shells only on the wet sand', () => {
    const style = atollCover(L);
    const tuft = (_y: number, extras: [number, number, number, number]): CoverTuft => {
      const t: CoverTuft = {
        r: 0.5,
        g: 0.5,
        b: 0.4,
        scale: 1,
        bare: false,
        bloom: -1,
        petal: -1,
        extra: extras[0],
        extras,
        shape: 0,
      };
      return t;
    };
    let grass = 0;
    let shells = 0;
    for (let i = 0; i < 400; i++) {
      const x = 900 + i * 0.37;
      const t = tuft(-1.5, [0, 0, 0.9, 0]);
      style.paint!(x, 50, -1.5, t);
      if (!t.bare) grass++;
      const r = tuft(-1.5, [0, 0, 0, 0]);
      style.paint!(x, 50, -1.5, r);
      expect(r.bare).toBe(true); // no meadow, no seagrass
      const w = tuft(0.3, [0, 0, 0, 0]);
      style.paint!(x, 50, 0.3, w);
      if (!w.bare) {
        expect([2, 3]).toContain(w.shape);
        shells++;
      }
      const reef = tuft(0.2, [0.9, 0, 0, 0]);
      style.paint!(x, 50, 0.2, reef);
      expect(reef.bare).toBe(true);
    }
    expect(grass).toBeGreaterThan(200);
    expect(shells).toBeGreaterThan(0);
    expect(shells).toBeLessThan(60);
  });
});

describe('atoll wisps', () => {
  it('ribbons never sit inside the rock, and an autopilot skims them across the lagoons', () => {
    for (const seed of [42, 2024]) {
      const w = new AtollWorld(seed);
      const r = flyBot(
        w,
        w.layout.spawn,
        seed,
        120,
        (x, y, z) => w.layout.solidTop(x, y, z, 0) !== -Infinity && y > w.layout.height(x, z) - 50,
      );
      expect(r.inside).toBe(0);
      expect(r.got).toBeGreaterThan(150);
      expect(r.glances).toBeLessThanOrEqual(2);
    }
  });
});

describe('atoll wisps over a village', () => {
  it('ribbons ride over the huts and walkways, never through them', () => {
    for (const seed of [1, 1337]) {
      const w = new AtollWorld(seed);
      const L2 = w.layout;
      const v = L2.atoll(0, 0)!.village!;
      // Out over the lagoon beyond the village, heading back across it toward the island.
      const spawn = {
        x: v.x + Math.sin(v.yaw) * 150,
        y: 10,
        z: v.z + Math.cos(v.yaw) * 150,
        yaw: v.yaw + Math.PI,
      };
      let over = 0;
      const r = flyBot(
        w,
        spawn,
        seed,
        40,
        (x, y, z) =>
          (L2.solidTop(x, y, z, 0) !== -Infinity && y > L2.height(x, z) - 50) ||
          y < L2.roofAt(x, z),
        undefined,
        (x, _y, z) => {
          if (L2.villageAt(x, z) !== -Infinity) over++;
        },
      );
      expect(r.inside).toBe(0);
      expect(r.glances).toBeLessThanOrEqual(1);
      expect(over).toBeGreaterThan(0); // the bird did cross the village
    }
  });
});

describe('atoll music', () => {
  it('stays sunny through the day, on a marimba with an island beat', () => {
    expect(ATOLL_KEYS).toHaveLength(5);
    for (const k of ATOLL_KEYS) expect(MODES[k.mode]).toBeDefined();
    expect(ATOLL_MUSIC.voice).toBe('marimba');
    expect(ATOLL_MUSIC.beat).toBe('island');
  });
});
