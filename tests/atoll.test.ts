import { describe, expect, it } from 'vitest';
import { ATOLL_KEYS, MODES } from '../src/audio/scales';
import { ATOLL_MUSIC } from '../src/audio/styles';
import { Config } from '../src/core/Config';
import { AtollLayout, ROCK_SHAPES, rockProfile, type Rock } from '../src/world/atoll/AtollLayout';
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

describe('atoll music', () => {
  it('stays sunny through the day, on a marimba with an island beat', () => {
    expect(ATOLL_KEYS).toHaveLength(5);
    for (const k of ATOLL_KEYS) expect(MODES[k.mode]).toBeDefined();
    expect(ATOLL_MUSIC.voice).toBe('marimba');
    expect(ATOLL_MUSIC.beat).toBe('island');
  });
});
