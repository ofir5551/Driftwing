import { describe, expect, it } from 'vitest';
import { MODES, RINGMOON_KEYS } from '../src/audio/scales';
import { LEVEL_LIST } from '../src/levels';
import { RINGMOON_MUSIC } from '../src/audio/styles';
import { Config } from '../src/core/Config';
import {
  BEACON,
  FLOATER,
  FLOATER_CLEAR,
  LAMP_GROUND,
  LIFE_PATHS,
  lifePhase,
  lifeRadius,
  OUT_HAB,
  OUT_LAMP,
  OUT_MAST,
  OUT_SKIFF,
  OUT_STRIDE,
  OUT_TOP,
  PROP_BEACON,
  PROP_CRYSTAL,
  PROP_POD,
  RingmoonLayout,
  SPIRE_REACH,
  SPIRE_SHAPES,
  spireProfile,
  type Floater,
  type Outpost,
  type Prop,
  type Spire,
} from '../src/world/ringmoon/RingmoonLayout';
import { ANIM, P, PROP_STRIDE, RingmoonScatter } from '../src/world/ringmoon/RingmoonScatter';
import { RingmoonWorld } from '../src/world/ringmoon/RingmoonWorld';
import { ringCover } from '../src/world/ringmoon/cover';
import type { CoverTuft } from '../src/world/GroundCover';
import { flyBot } from './helpers';

const L = new RingmoonLayout(1337);

/** Every spire centred in a square around the origin. */
function spiresAround(layout: RingmoonLayout, half: number): Spire[] {
  const C = Config.ringmoon.spireCell;
  const out: Spire[] = [];
  for (let j = Math.floor(-half / C); j <= Math.floor(half / C); j++)
    for (let i = Math.floor(-half / C); i <= Math.floor(half / C); i++)
      out.push(...layout.cell(i, j));
  return out;
}

describe('ringmoon layout', () => {
  it('is deterministic per seed', () => {
    const a = new RingmoonLayout(42);
    const b = new RingmoonLayout(42);
    expect(a.cell(3, 5)).toEqual(b.cell(3, 5));
    expect(a.cell(-7, 2)).toEqual(b.cell(-7, 2));
    expect(a.height(123, -456)).toBe(b.height(123, -456));
    expect(a.ship).toEqual(b.ship);
  });

  it('starts the bird over open water facing the ship, with a clear run under its belly', () => {
    for (const seed of [1337, 42, 7, 2024]) {
      const l = new RingmoonLayout(seed);
      const s = l.spawn;
      const S = l.ship;
      expect(l.height(s.x, s.z)).toBeLessThan(-2);
      expect(Math.abs(Math.atan2(S.x - s.x, S.z - s.z) - s.yaw)).toBeLessThan(0.1);
      // Straight at the ship a little over the water: nothing solid all the way under it.
      const D = Math.hypot(S.x - s.x, S.z - s.z) + 120;
      const h = Math.atan2(S.x - s.x, S.z - s.z);
      for (let d = 0; d < D; d += 3) {
        const x = s.x + Math.sin(h) * d;
        const z = s.z + Math.cos(h) * d;
        expect(l.solidTop(x, 12, z, 3)).toBe(-Infinity);
        expect(l.height(x, z)).toBeLessThan(0);
      }
      // But the hull is right overhead at its middle, and the belly leaves room beneath.
      expect(l.solidTop(S.x, S.y, S.z, 0)).toBeGreaterThan(S.y);
      expect(S.y - S.c).toBeGreaterThan(22);
    }
  });

  it('grows islets that are low tables, kept off the opening run and the ship', () => {
    let land = 0;
    let n = 0;
    for (let z = -2000; z < 2000; z += 37)
      for (let x = -2000; x < 2000; x += 41) {
        n++;
        const y = L.height(x, z);
        if (L.mainland(x, z) === 0) expect(y).toBeLessThan(10);
        if (y > 1) {
          land++;
          expect(L.openness(x, z, 100)).toBeLessThan(1);
          expect(L.shipZone(x, z, 0)).toBeGreaterThan(1.2);
        }
      }
    // Islets and mainland together: more land than sea, but channels and open water remain.
    expect(land / n).toBeGreaterThan(0.45);
    expect(land / n).toBeLessThan(0.75);
  });

  it('raises broad mainland with rolling hills, clear of the start and the ship', () => {
    let main = 0;
    let hills = 0;
    let top = 0;
    let n = 0;
    for (let z = -4000; z < 4000; z += 31)
      for (let x = -4000; x < 4000; x += 37) {
        n++;
        if (L.mainland(x, z) < 0.5) continue;
        main++;
        const y = L.height(x, z);
        if (y > 15) hills++;
        top = Math.max(top, y);
        expect(L.openness(x, z, 160)).toBeLessThan(1);
        expect(L.shipZone(x, z, 0)).toBeGreaterThan(2.3);
        // Never a cliff: the ground rises no steeper than ~1.3 in 1.
        expect(Math.abs(L.height(x + 2, z) - y)).toBeLessThan(2.6);
      }
    expect(main / n).toBeGreaterThan(0.12);
    expect(main / n).toBeLessThan(0.35);
    expect(hills / main).toBeGreaterThan(0.3);
    expect(top).toBeGreaterThan(35);
    expect(top).toBeLessThan(Config.ringmoon.hillHeight + 10);
  });

  it('stands spires in groves, clear of the opening run and the ship', () => {
    const ss = spiresAround(L, 1500);
    expect(ss.length).toBeGreaterThan(80);
    let tall = 0;
    for (const p of ss) {
      if (p.h > 100) tall++;
      // A spire on a hill stands on it (its foot buried a little), so its top rises with it.
      expect(p.top).toBeLessThan(Config.ringmoon.spireHigh + Config.ringmoon.hillHeight);
      expect(p.y0).toBeGreaterThan(L.height(p.x, p.z) - 9);
      expect(p.y0).toBeLessThan(L.height(p.x, p.z));
      if (L.gate.includes(p)) continue;
      expect(L.nearOpening(p.x, p.z, 40)).toBe(false);
      expect(L.shipZone(p.x, p.z, 60)).toBeGreaterThanOrEqual(1);
    }
    expect(tall).toBeGreaterThan(3);
    // The two gate spires flank the ship.
    expect(L.gate).toHaveLength(2);
    for (const g of L.gate) expect(ss).toContain(g);
  });

  it('profiles a flared foot, knuckles and a closing crown, within its reach', () => {
    for (const sh of SPIRE_SHAPES) {
      expect(spireProfile(sh, 0.001)).toBeGreaterThan(1.1);
      expect(spireProfile(sh, 0.999)).toBeLessThan(0.15);
      expect(spireProfile(sh, 1)).toBe(0);
      for (let t = 0; t < 1; t += 0.01)
        expect(spireProfile(sh, t)).toBeLessThanOrEqual(SPIRE_REACH);
    }
  });

  it('follows a spire’s lean, and pushes a point sideways off its flank and up off its tip', () => {
    const p = spiresAround(L, 900).find((q) => Math.hypot(q.lx, q.lz) > 0.08 && q.h > 60)!;
    const n = { x: 0, y: 0, z: 0 };
    const y = p.y0 + p.h * 0.6;
    const ax = p.x + p.lx * (y - p.y0);
    const az = p.z + p.lz * (y - p.y0);
    // Solid at the leaning axis, open at the base's axis that high up.
    expect(L.solidTop(ax, y, az, 0)).toBe(p.top);
    const r = L.radiusAt(p, y);
    const flank = { x: ax + r - 0.5, y, z: az };
    expect(L.pushPoint(flank, 1, n)).toBeGreaterThan(0);
    expect(n.x).toBeGreaterThan(0.9);
    expect(n.y).toBe(0);
    expect(L.solidTop(flank.x, flank.y, flank.z, 0.99)).toBe(-Infinity);
    const tip = { x: p.x + p.lx * p.h, y: p.top - 0.3, z: p.z + p.lz * p.h };
    L.pushPoint(tip, 1, n);
    expect(n.y).toBe(1);
    expect(tip.y).toBeGreaterThanOrEqual(p.top);
    for (const v of [flank.x, flank.y, flank.z, tip.x, tip.y, tip.z])
      expect(Number.isFinite(v)).toBe(true);
  });

  it('pushes out of the hull down under the belly and up over the back, and off a leg', () => {
    const S = L.ship;
    const n = { x: 0, y: 0, z: 0 };
    const under = { x: S.x, y: S.y - S.c + 1, z: S.z };
    expect(L.pushPoint(under, 1, n)).toBeGreaterThan(0);
    expect(n.y).toBeLessThan(-0.9);
    expect(under.y).toBeLessThan(S.y - S.c - 0.9);
    const back = { x: S.x, y: S.y + S.c - 1, z: S.z };
    L.pushPoint(back, 1, n);
    expect(n.y).toBeGreaterThan(0.9);
    const centre = { x: S.x, y: S.y, z: S.z };
    L.pushPoint(centre, 1, n);
    expect(Number.isFinite(centre.y)).toBe(true);
    // A leg, half way down.
    const lg = S.legs;
    const leg = { x: (lg[0] + lg[3]) / 2 + 1, y: (lg[1] + lg[4]) / 2, z: (lg[2] + lg[5]) / 2 };
    expect(L.solidTop(leg.x, leg.y, leg.z, 0)).toBe(lg[1]);
    L.pushPoint(leg, 1, n);
    expect(n.y).toBe(0);
    expect(L.solidTop(leg.x, leg.y, leg.z, 0.99)).toBe(-Infinity);
    // The look-ahead sees the belly's underside above the bird, so it eases under.
    expect(L.solidTop(S.x, S.y - S.c - 1, S.z, 2)).toBeGreaterThan(S.y);
    expect(L.hit[1]).toBeGreaterThan(S.y - S.c - 2);
  });

  it('makes the islets soft ground for the flight model, not solid', () => {
    const w = new RingmoonWorld(1337);
    let found = false;
    for (let x = -1500; x < 1500 && !found; x += 13) {
      const z = 700;
      const g = L.height(x, z);
      if (g > 3) {
        found = true;
        expect(w.flightGround(x, z)).toBeGreaterThan(g + 6);
        expect(L.solidTop(x, g + 1, z, 2)).toBe(-Infinity);
      }
    }
    expect(found).toBe(true);
    w.dispose();
  });
});

describe('ringmoon wisps', () => {
  it('ribbons never sit inside stone, hull or a floater, and an autopilot gathers them', () => {
    for (const seed of [42, 2024]) {
      const w = new RingmoonWorld(seed);
      const r = flyBot(
        w,
        w.layout.spawn,
        seed,
        120,
        (x, y, z) =>
          w.layout.solidTop(x, y, z, 0) !== -Infinity || w.layout.floaterNear(x, y, z, 0),
      );
      expect(r.inside).toBe(0);
      expect(r.got).toBeGreaterThan(150);
      expect(r.glances).toBeLessThanOrEqual(2);
    }
  });
});

describe('ringmoon level and music', () => {
  it('is on the title, slow and vast, on its own horn and tempo', () => {
    expect(LEVEL_LIST.map((l) => l.id)).toContain('ringmoon');
    expect(RINGMOON_KEYS).toHaveLength(5);
    for (const k of RINGMOON_KEYS) expect(MODES[k.mode]).toBeDefined();
    expect(RINGMOON_MUSIC.voice).toBe('horn');
    for (const l of LEVEL_LIST)
      if (l.id !== 'ringmoon') expect(l.music.bpm).toBeGreaterThan(RINGMOON_MUSIC.bpm);
  });
});

describe('ringmoon alien things', () => {
  /** Every prop centred in a square around the origin. */
  function propsAround(layout: RingmoonLayout, half: number): Prop[] {
    const C = Config.ringmoon.propCell;
    const out: Prop[] = [];
    for (let j = Math.floor(-half / C); j <= Math.floor(half / C); j++)
      for (let i = Math.floor(-half / C); i <= Math.floor(half / C); i++)
        out.push(...layout.props(i, j));
    return out;
  }

  it('sets landers, crystals and beacons on the land, clear of the run, the ship and the stone', () => {
    const ps = propsAround(L, 3000);
    const count = [0, 0, 0];
    for (const p of ps) {
      count[p.type]++;
      expect(L.height(p.x, p.z)).toBeGreaterThan(1.8);
      expect(L.nearOpening(p.x, p.z, 45)).toBe(false);
      expect(L.shipZone(p.x, p.z, 40)).toBeGreaterThanOrEqual(1);
      expect(L.spiresNear(p.x, p.z, 10)).toBe(0);
      // Landers and crystals stay under the frond canopy: the bird glides over them.
      if (p.type !== PROP_BEACON)
        expect(p.top).toBeLessThanOrEqual(L.height(p.x, p.z) + Config.ringmoon.canopy + 0.5);
    }
    expect(count[PROP_POD]).toBeGreaterThan(40);
    expect(count[PROP_CRYSTAL]).toBeGreaterThan(40);
    expect(count[PROP_BEACON]).toBeGreaterThan(4);
    expect(L.props(3, -2)).toEqual(new RingmoonLayout(1337).props(3, -2));
  });

  it('makes a beacon solid: wide at its rings, slim at its mast, pushed out sideways', () => {
    const b = propsAround(L, 3000).find((p) => p.type === PROP_BEACON)!;
    const H = b.top - b.y0;
    const ringY = b.y0 + H * 0.73;
    const mastY = b.y0 + H * 0.35;
    expect(L.solidTop(b.x + BEACON.ring * b.s - 0.5, ringY, b.z, 0)).toBe(b.top);
    expect(L.solidTop(b.x + BEACON.ring * b.s - 0.5, mastY, b.z, 0)).toBe(-Infinity);
    expect(L.solidTop(b.x + 0.5, mastY, b.z, 0)).toBe(b.top);
    const n = { x: 0, y: 0, z: 0 };
    const pt = { x: b.x + 2, y: ringY, z: b.z };
    expect(L.pushPoint(pt, 1, n)).toBeGreaterThan(0);
    expect(n.x).toBeGreaterThan(0.9);
    expect(L.solidTop(pt.x, pt.y, pt.z, 0.99)).toBe(-Infinity);
    expect(L.skyline(b.x, b.z, 5)).toBeGreaterThanOrEqual(b.top);
  });
});

/** Every outpost round the origin. */
function outpostsAround(layout: RingmoonLayout, half: number): Outpost[] {
  const C = Config.ringmoon.propCell;
  const out: Outpost[] = [];
  for (let j = Math.floor(-half / C); j <= Math.floor(half / C); j++)
    for (let i = Math.floor(-half / C); i <= Math.floor(half / C); i++) {
      const o = layout.outpost(i, j);
      if (o) out.push(o);
    }
  return out;
}

/** A part stands on its ground and under the flight floor (soft, glided over). */
function expectSoftPart(layout: RingmoonLayout, kind: number, x: number, z: number, s: number) {
  const g = layout.height(x, z);
  expect(g).toBeGreaterThanOrEqual(kind === OUT_LAMP ? LAMP_GROUND : 2.6);
  expect(OUT_TOP[kind] * s).toBeLessThanOrEqual(layout.canopy(g) + 0.01);
  expect(layout.solidTop(x, g + 1, z, 1)).toBe(-Infinity);
}

describe('ringmoon explorers', () => {
  it('raises the camp on a sand spit beside the ship, clear of the opening run', () => {
    for (const seed of [1337, 42, 1]) {
      const l = new RingmoonLayout(seed);
      const c = l.camp;
      expect(l.height(c.x, c.z)).toBeGreaterThan(2.6);
      expect(l.nearOpening(c.x, c.z, 60)).toBe(false);
      expect(l.shipZone(c.x, c.z, 0)).toBeGreaterThan(1.9);
      const Q = l.campSite.parts;
      const kinds = new Set<number>();
      for (let k = 0; k < Q.length; k += OUT_STRIDE) {
        kinds.add(Q[k]);
        if (Q[k] === OUT_SKIFF) expect(l.height(Q[k + 1], Q[k + 2])).toBeLessThan(-0.5);
        else if (Q[k] <= OUT_LAMP) expectSoftPart(l, Q[k], Q[k + 1], Q[k + 2], Q[k + 4]);
        expect(l.solidTop(Q[k + 1], 4, Q[k + 2], 2)).toBe(-Infinity);
      }
      for (const k of [OUT_HAB, OUT_MAST, OUT_LAMP, OUT_SKIFF]) expect(kinds.has(k)).toBe(true);
      // The lit path runs through the middle of the camp.
      expect(l.pathDist(c.x, c.z)).toBeLessThan(10);
    }
  });

  it('sets outposts by the landers: habs, masts and lit paths on level moss, soft', () => {
    const os = outpostsAround(L, 2500);
    expect(os.length).toBeGreaterThan(15);
    let habs = 0;
    let lamps = 0;
    for (const o of os) {
      const Q = o.parts;
      for (let k = 0; k < Q.length; k += OUT_STRIDE) {
        const kind = Q[k];
        const x = Q[k + 1];
        const z = Q[k + 2];
        expectSoftPart(L, kind, x, z, Q[k + 4]);
        expect(L.nearOpening(x, z, 45)).toBe(false);
        expect(L.spiresNear(x, z, 10)).toBe(0);
        if (kind === OUT_HAB) habs++;
        if (kind === OUT_LAMP) lamps++;
        // On or beside the path, never on a lander, a crystal or a beacon.
        if (kind !== OUT_LAMP) expect(L.propNear(x, z, 4)).toBe(false);
        expect(L.pathDist(x, z)).toBeLessThan(3);
      }
      // The pods it serves stand round its middle.
      expect(L.propNear(o.x, o.z, 16)).toBe(true);
    }
    expect(habs).toBeGreaterThan(15);
    expect(lamps).toBeGreaterThan(40);
    expect(L.outpost(-1, -3)).toEqual(new RingmoonLayout(1337).outpost(-1, -3));
  });

  it('lifts sand bars in the shallows just clear of the water, never on the opening run', () => {
    let bars = 0;
    let dry = 0;
    for (let z = -2500; z < 2500; z += 13)
      for (let x = -2500; x < 2500; x += 17) {
        const b = L.sandbar(x, z);
        if (b < 0.9) continue;
        if (L.mainland(x, z) > 0 || L.isle(x, z) > 0 || L.campMask(x, z) > 0) continue;
        bars++;
        const y = L.height(x, z);
        expect(y).toBeLessThan(0.5);
        if (y > 0) dry++;
        expect(L.openness(x, z, 90)).toBeLessThan(1);
      }
    expect(bars).toBeGreaterThan(50);
    expect(dry).toBeGreaterThan(5);
    expect(dry / bars).toBeLessThan(0.7);
  });
});

describe('ringmoon floaters', () => {
  /** Every floater round the origin. */
  function floatersAround(layout: RingmoonLayout, half: number): Floater[] {
    const C = Config.ringmoon.floaterCell;
    const out: Floater[] = [];
    for (let j = Math.floor(-half / C); j <= Math.floor(half / C); j++)
      for (let i = Math.floor(-half / C); i <= Math.floor(half / C); i++) {
        const f = layout.floater(i, j);
        if (f) out.push(f);
      }
    return out;
  }

  it('drift high on circles clear of stone, the ship and the opening run', () => {
    const fs = floatersAround(L, 3000);
    expect(fs.length).toBeGreaterThan(15);
    for (const f of fs) {
      expect(f.r).toBeCloseTo(lifeRadius(ANIM.Floater, f.x, f.z), 6);
      expect(L.nearOpening(f.x, f.z, 120)).toBe(false);
      const low = f.y - FLOATER.down * f.s;
      for (let n = 0; n < 24; n++) {
        const a = (n / 24) * Math.PI * 2;
        const px = f.x + Math.cos(a) * f.r;
        const pz = f.z + Math.sin(a) * f.r;
        const g = L.height(px, pz);
        expect(low).toBeGreaterThan(Math.max(g + L.canopy(g), 0) + 15);
        for (const y of [low, f.y, f.y + FLOATER.up * f.s])
          expect(L.solidTop(px, y, pz, FLOATER.out * f.s + 2)).toBe(-Infinity);
        // The planner sees it (no ribbon runs through), the flight model doesn't (soft).
        expect(L.floaterNear(px, f.y, pz, 0)).toBe(true);
        expect(L.clear(px, f.y, pz, 1, 2)).toBe(false);
      }
      const out = f.x + f.r + FLOATER.out * f.s + FLOATER_CLEAR + 1;
      expect(L.floaterNear(out, f.y, f.z, FLOATER_CLEAR)).toBe(false);
    }
  });
});

describe('ringmoon scatter', () => {
  const S = new RingmoonScatter(L);
  const size = Config.world.chunkSize;
  const life: number[] = [];
  const sites: number[] = [];
  const plants: number[] = [];
  for (let cz = -8; cz <= 8; cz++)
    for (let cx = -8; cx <= 8; cx++) {
      S.props(cx * size, cz * size, size, life);
      S.sites(cx * size, cz * size, size, sites);
    }
  for (let cz = -3; cz <= 1; cz++)
    for (let cx = -2; cx <= 1; cx++) S.plants(cx * size, cz * size, size, plants);

  it('is deterministic', () => {
    for (const [ox, oz] of [
      [160, 320],
      [-320, -480],
    ]) {
      const a: number[] = [];
      const b: number[] = [];
      new RingmoonScatter(new RingmoonLayout(1337)).props(ox, oz, size, a);
      new RingmoonScatter(new RingmoonLayout(1337)).props(ox, oz, size, b);
      expect(a).toEqual(b);
      const c: number[] = [];
      const d: number[] = [];
      S.sites(ox, oz, size, c);
      new RingmoonScatter(new RingmoonLayout(1337)).sites(ox, oz, size, d);
      expect(c).toEqual(d);
    }
  });

  it('puts bulbs and steps on the land, fish in the water and grazers on the hills', () => {
    const seen = new Set<number>();
    const grazers: number[][] = [];
    for (let k = 0; k < life.length; k += PROP_STRIDE) {
      const kind = life[k];
      const x = life[k + 1];
      const y = life[k + 2];
      const z = life[k + 3];
      seen.add(kind);
      const g = L.height(x, z);
      if (kind === P.Bulbs) {
        expect(g).toBeGreaterThan(1.4);
        expect(L.pathDist(x, z)).toBeGreaterThan(2.4);
        expect(L.skyline(x, z, 2)).toBe(-Infinity);
      } else if (kind === P.Steps) {
        expect(g).toBeGreaterThan(2.3);
        expect(L.mainland(x, z)).toBeLessThan(0.21);
        expect(L.skyline(x, z, 3)).toBe(-Infinity);
      } else if (kind === P.Fish) {
        // The whole circle it follows stays in water deeper than it swims, clear of stone.
        const r = lifeRadius(ANIM.Fish, x, z);
        for (let n = 0; n < 24; n++) {
          const a = (n / 24) * Math.PI * 2;
          const px = x + Math.cos(a) * r;
          const pz = z + Math.sin(a) * r;
          expect(L.height(px, pz)).toBeLessThan(y - 0.4);
          expect(L.solidTop(px, -0.5, pz, 1)).toBe(-Infinity);
        }
      } else if (kind === P.Grazer) {
        const r = lifeRadius(ANIM.Grazer, x, z);
        for (let n = 0; n < 24; n++) {
          const a = (n / 24) * Math.PI * 2;
          const px = x + Math.cos(a) * r;
          const pz = z + Math.sin(a) * r;
          // Feet on the moss: at most 0.75 m off the ground either way, all round.
          expect(Math.abs(L.height(px, pz) - y)).toBeLessThan(0.75);
          for (const h of [1, 3]) expect(L.solidTop(px, y + h, pz, 2.5)).toBe(-Infinity);
          expect(L.propNear(px, pz, 3)).toBe(false);
        }
        for (const [ox, oz] of grazers)
          expect(Math.hypot(x - ox, z - oz)).toBeGreaterThan(
            r + lifeRadius(ANIM.Grazer, ox, oz) + 4,
          );
        grazers.push([x, z]);
      }
    }
    for (const k of [P.Bulbs, P.Steps, P.Fish, P.Grazer]) expect(seen.has(k)).toBe(true);
    expect(grazers.length).toBeGreaterThan(10);
  });

  it('keeps the plants off the paths and the habs, and lists every outpost part once', () => {
    for (let k = 0; k < plants.length; k += 7)
      expect(L.pathDist(plants[k + 1], plants[k + 3])).toBeGreaterThanOrEqual(4);
    const keys = new Set<string>();
    for (let k = 0; k < sites.length; k += PROP_STRIDE) {
      const kind = sites[k];
      const key = `${kind}:${sites[k + 1].toFixed(2)}:${sites[k + 3].toFixed(2)}`;
      expect(keys.has(key)).toBe(false);
      keys.add(key);
      if (kind === OUT_HAB || kind === OUT_MAST || kind === OUT_LAMP)
        expect(sites[k + 2]).toBeLessThan(L.height(sites[k + 1], sites[k + 3]));
    }
  });

  it("agrees with the shader on a moving thing's circle", () => {
    for (const [x, z] of [
      [0, 0],
      [123.4, -987.6],
      [4000, 2500],
    ]) {
      const ph = lifePhase(x, z);
      expect(ph).toBeGreaterThanOrEqual(0);
      expect(ph).toBeLessThan(1);
      // float32, as the GPU sees it
      const f = Math.fround(
        Math.fround(x) * Math.fround(0.0137) + Math.fround(z) * Math.fround(0.0291),
      );
      expect(Math.abs(f - Math.floor(f) - ph)).toBeLessThan(1e-3);
    }
    expect(Object.keys(LIFE_PATHS).map(Number)).toEqual([ANIM.Fish, ANIM.Grazer, ANIM.Floater]);
  });

  it('grows sea moss in the beds, none on the sand, the bars, the paths or the wet sand', () => {
    const style = ringCover();
    const tuft = (r: number, extras: [number, number, number, number]): CoverTuft => ({
      r,
      g: r,
      b: r,
      scale: 1,
      bare: false,
      bloom: -1,
      petal: -1,
      extra: extras[0],
      extras,
      shape: 0,
    });
    let moss = 0;
    let land = 0;
    const shapes = new Set<number>();
    for (let i = 0; i < 400; i++) {
      const x = 900 + i * 0.37;
      const bed = tuft(0.3, [2, 0, 0, 0]);
      style.paint!(x, 50, -1.5, bed);
      if (!bed.bare) moss++;
      for (const t of [tuft(0.8, [2, 0, 0, 0]), tuft(0.3, [2, 0.9, 0, 0])]) {
        style.paint!(x, 50, -1.5, t);
        expect(t.bare).toBe(true); // sand, a bar
      }
      const wet = tuft(0.4, [2, 0, 0, 1]);
      style.paint!(x, 50, 0.8, wet);
      expect(wet.bare).toBe(true);
      const path = tuft(0.4, [0.2, 0, 0, 1]);
      style.paint!(x, 50, 4, path);
      expect(path.bare).toBe(true);
      const turf = tuft(0.4, [2, 0, 0, 1]);
      style.paint!(x, 50, 4, turf);
      if (!turf.bare) {
        land++;
        shapes.add(turf.shape);
      }
    }
    expect(moss).toBeGreaterThan(120);
    expect(land).toBeGreaterThan(150);
    expect([...shapes].sort()).toEqual([0, 1, 2, 3]);
  });
});
