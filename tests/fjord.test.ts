import { describe, expect, it } from 'vitest';
import { FJORD_KEYS, MODES } from '../src/audio/scales';
import { Config } from '../src/core/Config';
import { FjordLayout, softAbs } from '../src/world/fjord/FjordLayout';
import { FjordWorld } from '../src/world/fjord/FjordWorld';
import { FjordScatter, T } from '../src/world/fjord/FjordScatter';
import { FOOT, P, PROP_STRIDE, STREET_BANK } from '../src/world/fjord/FjordSites';
import { strandPath } from '../src/world/fjord/Waterfalls';
import { fjordCover } from '../src/world/fjord/cover';
import { FOG_STRIDE, fogSpots } from '../src/world/fjord/atmosphere';
import { flyBot } from './helpers';

const L = new FjordLayout(1337);

describe('fjord layout', () => {
  it('is deterministic per seed', () => {
    const a = new FjordLayout(42);
    const b = new FjordLayout(42);
    expect(a.spawn).toEqual(b.spawn);
    expect(a.lighthouse).toEqual(b.lighthouse);
    expect(a.berg(3, -2)).toEqual(b.berg(3, -2));
    expect(a.height(123, -456)).toBe(b.height(123, -456));
  });

  it('starts the bird mid-fjord, facing along it with open water ahead', () => {
    for (const seed of [1337, 42, 7, 2024]) {
      const l = new FjordLayout(seed);
      const s = l.spawn;
      expect(l.fjord(s.x, s.z)).toBeLessThan(-40);
      for (let d = 0; d < 200; d += 4) {
        const x = s.x + Math.sin(s.yaw) * d;
        const z = s.z + Math.cos(s.yaw) * d;
        expect(l.height(x, z)).toBeLessThan(0);
        expect(l.ice(x, z)).toBe(0);
        expect(l.solidTop(x, s.y, z, 3)).toBe(-Infinity);
      }
    }
  });

  it('raises tall walls to a snowy plateau beside the water', () => {
    const s = L.spawn;
    // Straight across the fjord from the spawn, on either side, the ground climbs high.
    for (const side of [1, -1]) {
      let top = -Infinity;
      for (let d = 0; d < 500; d += 10)
        top = Math.max(
          top,
          L.height(s.x + Math.cos(s.yaw) * d * side, s.z - Math.sin(s.yaw) * d * side),
        );
      expect(top).toBeGreaterThan(100);
    }
  });

  it('floats icebergs only on open water, and puts the lighthouse on the shore', () => {
    let n = 0;
    for (let j = -12; j <= 12; j++)
      for (let i = -12; i <= 12; i++) {
        const b = L.berg(i, j);
        if (!b) continue;
        n++;
        expect(L.fjord(b.x, b.z)).toBeLessThan(-b.r);
      }
    expect(n).toBeGreaterThan(3);
    const h = L.lighthouse;
    expect(L.fjord(h.x, h.z)).toBeGreaterThan(0);
    expect(h.y0).toBeGreaterThan(-1);
  });

  it('pushes a point out of the lighthouse: sideways on the tower, up over the top', () => {
    const h = L.lighthouse;
    const n = { x: 0, y: 0, z: 0 };
    const side = { x: h.x + h.r - 1, y: h.y0 + 10, z: h.z };
    expect(L.pushPoint(side, 1, n)).toBeGreaterThan(0);
    expect(n.x).toBeGreaterThan(0.9);
    expect(side.x).toBeGreaterThanOrEqual(h.x + h.r + 1 - 1e-9);
    const top = { x: h.x, y: h.y0 + h.h - 0.5, z: h.z };
    L.pushPoint(top, 1, n);
    expect(n.y).toBe(1);
    expect(top.y).toBeGreaterThanOrEqual(h.y0 + h.h);
  });
});

describe('fjord wisps', () => {
  it('ribbons never sit inside rock or ice, and an autopilot flies them down the fjords', () => {
    for (const seed of [42, 2024]) {
      const w = new FjordWorld(seed);
      const r = flyBot(
        w,
        w.layout.spawn,
        seed,
        120,
        (x, y, z) => y < w.layout.ground(x, z) || w.layout.solidTop(x, y, z, 0) > y,
      );
      expect(r.inside).toBe(0);
      expect(r.got).toBeGreaterThan(150);
      expect(r.glances).toBeLessThanOrEqual(2);
    }
  });
});

describe('fjord ground', () => {
  it('rounds the crag ridges: no crease for the lattice to saw', () => {
    expect(softAbs(0, 0.04)).toBe(0);
    // The slope through zero is continuous (|n| jumps from -1 to 1 there).
    const d = (n: number) => (softAbs(n + 1e-4, 0.04) - softAbs(n - 1e-4, 0.04)) / 2e-4;
    expect(Math.abs(d(0))).toBeLessThan(1e-3);
    expect(softAbs(0.8, 0.04)).toBeGreaterThan(0.6);
  });

  it('lays snow above a ragged snowline and in snowfields, not on the strand', () => {
    let hi = 0;
    let lo = 0;
    for (let i = 0; i < 200; i++) {
      const x = i * 37.3;
      const z = -i * 21.7;
      hi += L.snow(x, z, Config.fjord.snowline + 80);
      lo += L.snow(x, z, 3);
    }
    expect(hi / 200).toBeGreaterThan(0.95);
    expect(lo).toBe(0);
  });
});

describe('fjord villages', () => {
  it('are deterministic per seed', () => {
    const a = new FjordLayout(42).sites;
    const b = new FjordLayout(42).sites;
    expect(a.plan(a.homeVillage)).toEqual(b.plan(b.homeVillage));
    expect(a.homeFall).toEqual(b.homeFall);
    expect(a.village(2, -1)).toEqual(b.village(2, -1));
  });

  it('builds a home village on the strand ahead of the spawn, on the right', () => {
    for (const seed of [1337, 42, 7, 2024, 1]) {
      const l = new FjordLayout(seed);
      const v = l.sites.homeVillage;
      const s = l.spawn;
      const ahead = (v.x - s.x) * Math.sin(s.yaw) + (v.z - s.z) * Math.cos(s.yaw);
      const right = -(v.x - s.x) * Math.cos(s.yaw) + (v.z - s.z) * Math.sin(s.yaw);
      expect(ahead).toBeGreaterThan(60);
      expect(right).toBeGreaterThan(0);
      expect(Math.abs(l.fjord(v.x, v.z) - STREET_BANK)).toBeLessThan(2);
      // The strand round it is wide and nearly level: the wall stands back behind the houses.
      expect(l.height(v.x, v.z)).toBeLessThan(3);
      const parts = l.sites.plan(v);
      const n = new Map<number, number>();
      for (let k = 0; k < parts.length; k += PROP_STRIDE)
        n.set(parts[k], (n.get(parts[k]) ?? 0) + 1);
      expect(n.get(P.House)).toBeGreaterThan(5);
      expect(n.get(P.Church)).toBe(1);
      expect(n.get(P.Jetty)).toBeGreaterThan(0);
      expect(n.get(P.Boathouse)).toBeGreaterThan(0);
      expect(n.get(P.Rack)).toBeGreaterThan(0);
    }
  });

  it('stands houses on dry land, boathouses at the water and jetties out over it', () => {
    let villages = 0;
    for (let j = -3; j <= 3; j++)
      for (let i = -3; i <= 3; i++) {
        const v = L.sites.village(i, j);
        if (!v) continue;
        villages++;
        const parts = L.sites.plan(v);
        for (let k = 0; k < parts.length; k += PROP_STRIDE) {
          const [kind, x, , z] = parts.slice(k, k + 4);
          const bank = L.fjord(x, z);
          if (kind === P.House || kind === P.Church || kind === P.Rack)
            expect(bank).toBeGreaterThan(5);
          if (kind === P.Boathouse) expect(Math.abs(bank - 1)).toBeLessThan(3);
          if (kind === P.Jetty) expect(bank).toBeLessThan(0);
          if (kind === P.Boat) expect(bank).toBeLessThan(-6);
        }
      }
    expect(villages).toBeGreaterThan(5);
  });

  it('keeps every roof under the flight floor', () => {
    for (const seed of [1337, 1]) {
      const l = new FjordLayout(seed);
      const vs = [l.sites.homeVillage];
      for (let j = -2; j <= 2; j++)
        for (let i = -2; i <= 2; i++) {
          const v = l.sites.village(i, j);
          if (v) vs.push(v);
        }
      for (const v of vs) {
        const parts = l.sites.plan(v);
        for (let k = 0; k < parts.length; k += PROP_STRIDE) {
          const kind = parts[k];
          const f = FOOT[kind];
          if (!f) continue;
          const [x, y, z, yaw] = parts.slice(k + 1, k + 5);
          const [sx, sy, sz] = parts.slice(k + 6, k + 9);
          const top = y + f[2] * sy;
          const c = Math.cos(yaw);
          const sn = Math.sin(yaw);
          for (const [a, b] of [
            [0, 0],
            [-1, -1],
            [1, -1],
            [-1, 1],
            [1, 1],
          ]) {
            const lx = a * f[0] * sx;
            const lz = b * f[1] * sz;
            const px = x + lx * c + lz * sn;
            const pz = z - lx * sn + lz * c;
            expect(l.ground(px, pz)).toBeGreaterThanOrEqual(top - 1e-6);
          }
        }
      }
    }
  });
});

describe('fjord waterfalls', () => {
  it('drops a waterfall down a tall wall ahead of the spawn, and more along the fjords', () => {
    for (const seed of [1337, 42, 7, 1]) {
      const l = new FjordLayout(seed);
      const f = l.sites.homeFall!;
      expect(f).not.toBeNull();
      expect(l.height(f.x0, f.z0) - l.height(f.x1, f.z1)).toBeGreaterThan(Config.fjord.fallDrop);
      expect(l.fjord(f.x2, f.z2)).toBeGreaterThan(-1);
      expect(l.fjord(f.x2, f.z2)).toBeLessThan(5);
    }
    let n = 0;
    for (let j = -5; j <= 5; j++) for (let i = -5; i <= 5; i++) if (L.sites.fall(i, j)) n++;
    expect(n).toBeGreaterThan(8);
  });

  it('hangs the water in front of the rock, never inside it', () => {
    const out = new Float32Array(29 * 7);
    for (let j = -3; j <= 3; j++)
      for (let i = -3; i <= 3; i++) {
        const f = L.sites.fall(i, j);
        if (!f) continue;
        for (const s of f.strands > 1 ? [-1, 1] : [0]) {
          strandPath(L, f, s, out);
          for (let k = 0; k < 29; k++) {
            const [x, y, z] = [out[k * 7], out[k * 7 + 1], out[k * 7 + 2]];
            expect(y).toBeGreaterThan(L.height(x, z) - 0.5);
          }
        }
      }
  });
});

describe('fjord scenery', () => {
  const size = Config.world.chunkSize;
  const sc = new FjordScatter(L);
  const all = (fn: (ox: number, oz: number, out: number[]) => void, r: number) => {
    const out: number[] = [];
    for (let cz = -r; cz <= r; cz++) for (let cx = -r; cx <= r; cx++) fn(cx * size, cz * size, out);
    return out;
  };

  it('is deterministic per seed', () => {
    const b = new FjordScatter(new FjordLayout(1337));
    for (const [ox, oz] of [
      [0, 0],
      [-320, 160],
    ]) {
      const [p1, p2, t1, t2, s1, s2]: number[][] = [[], [], [], [], [], []];
      sc.props(ox, oz, size, p1);
      b.props(ox, oz, size, p2);
      sc.trees(ox, oz, size, t1);
      b.trees(ox, oz, size, t2);
      sc.sites(ox, oz, size, s1);
      b.sites(ox, oz, size, s2);
      expect(p1).toEqual(p2);
      expect(t1).toEqual(t2);
      expect(s1).toEqual(s2);
    }
  });

  it('grows spruce and birch on land, and keeps boats, ice and seals on the water', () => {
    const trees = all((ox, oz, out) => sc.trees(ox, oz, size, out), 3);
    let birch = 0;
    for (let k = 0; k < trees.length; k += 7) {
      expect(L.height(trees[k + 1], trees[k + 3])).toBeGreaterThan(1);
      if (trees[k] === T.Birch) birch++;
    }
    expect(trees.length / 7).toBeGreaterThan(150);
    expect(birch).toBeGreaterThan(30);
    const props = all((ox, oz, out) => {
      sc.props(ox, oz, size, out);
      sc.sites(ox, oz, size, out);
    }, 3);
    const kinds = new Set<number>();
    for (let k = 0; k < props.length; k += PROP_STRIDE) {
      const kind = props[k];
      kinds.add(kind);
      const x = props[k + 1];
      const z = props[k + 3];
      const bank = L.fjord(x, z);
      if (kind === P.Boulder) {
        expect(bank).toBeGreaterThan(-2);
        expect(L.sites.street(x, z, bank)).toBeGreaterThan(1);
      }
      if (kind === P.Floe || kind === P.Seal) expect(bank).toBeLessThan(-5);
      if (kind === P.Boat && props[k + 5] !== 0) {
        // A working boat's whole circle is open water.
        const r = Math.abs(props[k + 5]);
        for (let a = 0; a < 6.28; a += 0.5)
          expect(L.fjord(x + Math.sin(a) * r, z + Math.cos(a) * r)).toBeLessThan(-5);
      }
    }
    for (const k of [P.House, P.Boulder, P.Floe, P.Bird, P.Jetty]) expect(kinds.has(k)).toBe(true);
  });

  it('keeps the wisps an autopilot flies clear of every building, boat and rock', () => {
    const w = new FjordWorld(1337);
    const seen: number[] = [];
    const r = flyBot(w, w.layout.spawn, 1337, 60, (x, y, z) => {
      seen.push(x, y, z);
      return false;
    });
    expect(r.got).toBeGreaterThan(60);
    const s2 = new FjordScatter(w.layout);
    const cache = new Map<number, number[]>();
    const list = (cx: number, cz: number) => {
      const key = cx * 10000 + cz;
      let out = cache.get(key);
      if (!out) {
        out = [];
        s2.props(cx * size, cz * size, size, out);
        s2.sites(cx * size, cz * size, size, out);
        cache.set(key, out);
      }
      return out;
    };
    for (let k = 0; k < seen.length; k += 3) {
      const [x, y, z] = [seen[k], seen[k + 1], seen[k + 2]];
      const cx = Math.floor(x / size);
      const cz = Math.floor(z / size);
      for (let dz = -1; dz <= 1; dz++)
        for (let dx = -1; dx <= 1; dx++) {
          const l = list(cx + dx, cz + dz);
          for (let i = 0; i < l.length; i += PROP_STRIDE) {
            const kind = l[i];
            if (kind === P.Bird || kind === P.Floe || kind === P.Seal) continue;
            const reach = (FOOT[kind]?.[0] ?? 2) + 3;
            const r0 = kind === P.Boat ? Math.abs(l[i + 5]) : 0;
            const d = Math.hypot(x - l[i + 1], z - l[i + 3]);
            // A boat may be anywhere on its circle; it stands ~7 m from keel to masthead.
            if (d < reach || (r0 > 0 && Math.abs(d - r0) < 6))
              expect(y).toBeGreaterThan(l[i + 2] + (FOOT[kind]?.[2] ?? 7) * l[i + 7]);
          }
        }
    }
  }, 60_000);
});

describe('fjord ground cover and atmosphere', () => {
  const style = fjordCover();
  const tuft = (bank: number, street: number, wet: number, snow: number) => ({
    r: 0.2,
    g: 0.3,
    b: 0.1,
    scale: 1,
    bare: false,
    bloom: -1,
    petal: -1,
    extra: bank,
    extras: [bank, street, wet, snow] as [number, number, number, number],
    shape: 0,
  });

  it('leaves the beach, the streets and the snow bare; grows heath, crowberry and moss', () => {
    for (const [b, s, w, sn] of [
      [2, 9, 9, 0],
      [20, 0.5, 9, 0],
      [60, 9, 9, 0.9],
    ]) {
      const t = tuft(b, s, w, sn);
      style.paint!(10.5, 3.5, 30, t);
      expect(t.bare).toBe(true);
    }
    const shapes = new Set<number>();
    let heather = 0;
    for (let i = 0; i < 400; i++) {
      const t = tuft(40, 9, 9, 0);
      style.paint!(i * 0.37, i * 0.53, 80, t);
      if (t.bare) continue;
      shapes.add(t.shape);
      if (t.bloom > 0.5) heather++;
    }
    expect([...shapes].sort()).toEqual([0, 1, 2]);
    expect(heather).toBeGreaterThan(60);
  });

  it('lays the dawn fog banks over the water', () => {
    const out = new Float32Array(120 * FOG_STRIDE);
    const n = fogSpots(L, L.spawn.x, L.spawn.z, out, { x: 0, z: 0 });
    expect(n).toBeGreaterThan(5);
    for (let k = 0; k < n; k++)
      expect(L.fjord(out[k * FOG_STRIDE], out[k * FOG_STRIDE + 2])).toBeLessThan(0);
  });
});

describe('fjord music', () => {
  it('has a dorian colour and one key per time of day', () => {
    expect(MODES.dorianPenta).toEqual([0, 2, 3, 7, 9]);
    expect(FJORD_KEYS).toHaveLength(5);
    expect(Config.fjord.aurora).toBeGreaterThan(0);
  });
});
