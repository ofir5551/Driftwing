import { describe, expect, it } from 'vitest';
import { MODES, RINGMOON_KEYS } from '../src/audio/scales';
import { LEVEL_LIST } from '../src/levels';
import { RINGMOON_MUSIC } from '../src/audio/styles';
import { Config } from '../src/core/Config';
import {
  BEACON,
  PROP_BEACON,
  PROP_CRYSTAL,
  PROP_POD,
  RingmoonLayout,
  SPIRE_REACH,
  SPIRE_SHAPES,
  spireProfile,
  type Prop,
  type Spire,
} from '../src/world/ringmoon/RingmoonLayout';
import { RingmoonWorld } from '../src/world/ringmoon/RingmoonWorld';
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
  it('ribbons never sit inside stone or hull, and an autopilot gathers them', () => {
    for (const seed of [42, 2024]) {
      const w = new RingmoonWorld(seed);
      const r = flyBot(
        w,
        w.layout.spawn,
        seed,
        120,
        (x, y, z) => w.layout.solidTop(x, y, z, 0) !== -Infinity,
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
