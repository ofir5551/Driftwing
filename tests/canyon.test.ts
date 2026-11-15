import { describe, expect, it } from 'vitest';
import { CANYON_KEYS, MODES } from '../src/audio/scales';
import { CANYON_MUSIC } from '../src/audio/styles';
import { Config } from '../src/core/Config';
import { ARCH_OUT_X, CanyonLayout } from '../src/world/canyon/CanyonLayout';
import { CanyonScatter, P, PROP_STRIDE, T } from '../src/world/canyon/CanyonScatter';
import { RANCH_PARTS, browTop } from '../src/world/canyon/CanyonSites';
import { CanyonWorld } from '../src/world/canyon/CanyonWorld';
import { canyonCover } from '../src/world/canyon/cover';
import { flyBot } from './helpers';

const L = new CanyonLayout(1337);

describe('canyon layout', () => {
  it('is deterministic per seed', () => {
    const a = new CanyonLayout(42);
    const b = new CanyonLayout(42);
    expect(a.spawn).toEqual(b.spawn);
    expect(a.great).toEqual(b.great);
    expect(a.arch(3, -2)).toEqual(b.arch(3, -2));
    expect(a.hoodoo(30, -12)).toEqual(b.hoodoo(30, -12));
    expect(a.height(123, -456)).toBe(b.height(123, -456));
  });

  it('starts the bird mid-canyon, facing along it with a clear run ahead', () => {
    for (const seed of [1337, 42, 7, 2024]) {
      const l = new CanyonLayout(seed);
      const s = l.spawn;
      expect(l.canyon(s.x, s.z)).toBeLessThan(-25);
      for (let d = 0; d < 150; d += 4) {
        const x = s.x + Math.sin(s.yaw) * d;
        const z = s.z + Math.cos(s.yaw) * d;
        expect(l.height(x, z)).toBeLessThan(5);
        expect(l.solidTop(x, s.y, z, 3)).toBe(-Infinity);
      }
    }
  });

  it('walls the canyon with rock up to a plateau on both sides', () => {
    const s = L.spawn;
    for (const side of [1, -1]) {
      let top = -Infinity;
      for (let d = 0; d < 400; d += 10)
        top = Math.max(
          top,
          L.height(s.x + Math.cos(s.yaw) * d * side, s.z - Math.sin(s.yaw) * d * side),
        );
      expect(top).toBeGreaterThan(Config.canyon.plateau - Config.canyon.plateauVar * 1.5);
    }
  });

  it('stands the Great Arch across the floor ahead, with the way through it open', () => {
    for (const seed of [1337, 42, 7, 2024]) {
      const l = new CanyonLayout(seed);
      const G = l.great;
      expect(Math.hypot(G.x - l.spawn.x, G.z - l.spawn.z)).toBeGreaterThan(200);
      // Both legs on the floor, not in the wall.
      for (const side of [-1, 1]) {
        const u = side * G.r * ARCH_OUT_X;
        const h = l.height(G.x + u * Math.cos(G.yaw), G.z - u * Math.sin(G.yaw));
        expect(h).toBeLessThan(5);
      }
      // Through the middle of the opening, along the way it faces: clear of its rock.
      const y = G.y0 + G.h * 0.42;
      for (let v = -30; v <= 30; v += 2)
        expect(l.inArch(G, G.x + Math.sin(G.yaw) * v, y, G.z + Math.cos(G.yaw) * v, 3)).toBe(false);
      // Its crown and its legs are rock.
      expect(l.inArch(G, G.x, G.y0 + G.h * 1.12, G.z, 0)).toBe(true);
      const u = G.r * 1.15;
      expect(l.inArch(G, G.x + u * Math.cos(G.yaw), G.y0 + 5, G.z - u * Math.sin(G.yaw), 0)).toBe(
        true,
      );
    }
  });

  it('places arches across canyon floors and out on the plateau, and hoodoos on level rock', () => {
    let canyon = 0;
    let plateau = 0;
    for (let j = -10; j <= 10; j++)
      for (let i = -10; i <= 10; i++) {
        const a = L.arch(i, j);
        if (!a) continue;
        if (a.canyon) {
          canyon++;
          expect(L.canyon(a.x, a.z)).toBeLessThan(-a.r);
        } else {
          plateau++;
          expect(L.canyon(a.x, a.z)).toBeGreaterThan(Config.canyon.wall);
        }
      }
    expect(canyon).toBeGreaterThan(5);
    expect(plateau).toBeGreaterThan(5);
    let hoodoos = 0;
    for (let j = -60; j <= 60; j++)
      for (let i = -60; i <= 60; i++) {
        const hd = L.hoodoo(i, j);
        if (!hd) continue;
        hoodoos++;
        expect(L.height(hd.x, hd.z)).toBeGreaterThan(10);
      }
    expect(hoodoos).toBeGreaterThan(50);
  });

  it('pushes a point out of an arch: over its back, under its span, off its legs', () => {
    const G = L.great;
    const n = { x: 0, y: 0, z: 0 };
    const back = { x: G.x, y: G.y0 + G.h * 1.2, z: G.z };
    expect(L.pushPoint(back, 1, n)).toBeGreaterThan(0);
    expect(n.y).toBeGreaterThan(0.9);
    expect(L.inArch(G, back.x, back.y, back.z, 1)).toBe(false);
    const under = { x: G.x, y: G.y0 + G.h + 1.5, z: G.z };
    L.pushPoint(under, 1, n);
    expect(n.y).toBeLessThan(-0.9);
    expect(L.inArch(G, under.x, under.y, under.z, 1)).toBe(false);
    const u = G.r * 1.04;
    const leg = { x: G.x + u * Math.cos(G.yaw), y: G.y0 + 4, z: G.z - u * Math.sin(G.yaw) };
    L.pushPoint(leg, 1, n);
    expect(Math.abs(n.y)).toBeLessThan(0.1);
    expect(L.inArch(G, leg.x, leg.y, leg.z, 1)).toBe(false);
    for (const p of [back, under, leg]) expect(Number.isFinite(p.x + p.y + p.z)).toBe(true);
  });
});

describe('canyon wisps', () => {
  it('ribbons never sit inside rock, and an autopilot flies them down the canyons', () => {
    for (const seed of [42, 2024]) {
      const w = new CanyonWorld(seed);
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

describe('canyon geography', () => {
  it('piles scree at each cliff foot without a step, and washes dip into the floor', () => {
    const s = L.spawn;
    for (const side of [1, -1]) {
      let prev = L.height(s.x, s.z);
      for (let d = 0.5; d < 260; d += 0.5) {
        const y = L.height(s.x + Math.cos(s.yaw) * d * side, s.z - Math.sin(s.yaw) * d * side);
        // A cliff is steep, but the terrain never jumps (the aprons meet their benches).
        expect(Math.abs(y - prev)).toBeLessThan(4);
        prev = y;
      }
    }
    // Somewhere on the floors a wash runs below the floor round it.
    const land = new Float32Array(4);
    let beds = 0;
    for (let z = -1500; z <= 1500; z += 7)
      for (let x = -1500; x <= 1500; x += 7) {
        L.landAt(x, z, 0, land, 0);
        if (land[1] < 0.2 && L.canyon(x, z) < -20) beds++;
      }
    expect(beds).toBeGreaterThan(20);
  });

  it('runs a road along the floor, out of the river', () => {
    const land = new Float32Array(4);
    let road = 0;
    for (let z = -1500; z <= 1500; z += 5)
      for (let x = -1500; x <= 1500; x += 5) {
        L.landAt(x, z, 0, land, 0);
        if (land[0] < 1) {
          road++;
          expect(L.cd).toBeGreaterThan(L.river(x, z) + 4);
          expect(L.canyon(x, z)).toBeLessThan(0);
        }
      }
    expect(road).toBeGreaterThan(200);
  });
});

describe('canyon sites', () => {
  it('are deterministic per seed', () => {
    const a = new CanyonLayout(42).sites;
    const b = new CanyonLayout(42).sites;
    expect(a.homeRanch).toEqual(b.homeRanch);
    expect(a.homeAlcove).toEqual(b.homeAlcove);
    for (const [i, j] of [
      [0, 1],
      [-2, 3],
      [4, -1],
    ]) {
      expect(a.ranch(i, j)).toEqual(b.ranch(i, j));
      expect(a.alcove(i, j)).toEqual(b.alcove(i, j));
    }
  });

  it('puts a ranch and a cliff dwelling near the spawn, and more out in the canyons', () => {
    for (const seed of [1337, 1, 42, 7]) {
      const S = new CanyonLayout(seed).sites;
      expect(S.homeRanch).not.toBeNull();
      expect(S.homeAlcove).not.toBeNull();
    }
    const S = L.sites;
    let ranches = 0;
    let alcoves = 0;
    for (let j = -5; j <= 5; j++)
      for (let i = -5; i <= 5; i++) {
        if (S.ranch(i, j)) ranches++;
        if (S.alcove(i, j)) alcoves++;
      }
    expect(ranches).toBeGreaterThan(5);
    expect(alcoves).toBeGreaterThan(10);
  });

  it('stands a ranch on a level pad on the floor, its roofs under the flight floor', () => {
    const r = L.sites.homeRanch!;
    expect(L.canyon(r.x, r.z)).toBeLessThan(0);
    for (const [u, v, , roof] of RANCH_PARTS) {
      const x = r.x + r.ux * u + r.vx * v;
      const z = r.z + r.uz * u + r.vz * v;
      expect(Math.abs(L.height(x, z) - r.y)).toBeLessThan(0.3);
      expect(L.ground(x, z)).toBeGreaterThanOrEqual(r.y + roof - 1e-6);
    }
    // Away from the ranch the floor is the terrain again.
    expect(L.ground(r.x + r.vx * 200, r.z + r.vz * 200)).toBe(
      L.height(r.x + r.vx * 200, r.z + r.vz * 200),
    );
  });

  it('shelters a dwelling under a brow that is solid and lifts the flight floor', () => {
    const a = L.sites.homeAlcove!;
    const bx = a.x - a.nx * a.back + a.nx * a.reach * 0.4;
    const bz = a.z - a.nz * a.back + a.nz * a.reach * 0.4;
    const top = browTop(a, bx, bz);
    expect(top).toBeGreaterThan(a.y0 + a.h);
    expect(L.ground(bx, bz)).toBeGreaterThanOrEqual(top - 1e-6);
    expect(L.solidTop(bx, top - 1, bz, 0)).toBeGreaterThanOrEqual(top - 1e-6);
    // The rooms' bench is level.
    const rx = a.x + a.nx * 2;
    const rz = a.z + a.nz * 2;
    expect(Math.abs(L.height(rx, rz) - a.y0)).toBeLessThan(1.5);
  });
});

describe('canyon scenery', () => {
  const sc = new CanyonScatter(L);
  const size = Config.world.chunkSize;
  const all = (fn: (ox: number, oz: number, out: number[]) => void, r: number) => {
    const out: number[] = [];
    for (let cz = -r; cz <= r; cz++) for (let cx = -r; cx <= r; cx++) fn(cx * size, cz * size, out);
    return out;
  };

  it('is deterministic per seed', () => {
    const b = new CanyonScatter(new CanyonLayout(1337));
    const p1: number[] = [];
    const p2: number[] = [];
    sc.props(160, -320, size, p1);
    b.props(160, -320, size, p2);
    expect(p1).toEqual(p2);
    const t1: number[] = [];
    const t2: number[] = [];
    sc.trees(0, 0, size, t1);
    b.trees(0, 0, size, t2);
    expect(t1).toEqual(t2);
  });

  it('keeps trees and props out of the river and off the road', () => {
    const K = Config.canyon;
    const trees = all((ox, oz, out) => sc.trees(ox, oz, size, out), 4);
    let willows = 0;
    for (let k = 0; k < trees.length; k += 7) {
      const x = trees[k + 1];
      const z = trees[k + 3];
      expect(L.height(x, z)).toBeGreaterThan(0.3);
      L.canyon(x, z);
      if (L.cd < L.cw) expect(Math.abs(L.cs - K.roadOffset)).toBeGreaterThan(K.roadWidth);
      if (trees[k] === T.Willow) willows++;
    }
    expect(willows).toBeGreaterThan(20);
    const props = all((ox, oz, out) => sc.props(ox, oz, size, out), 4);
    const kinds = new Set<number>();
    for (let k = 0; k < props.length; k += PROP_STRIDE) {
      const kind = props[k];
      kinds.add(kind);
      const x = props[k + 1];
      const z = props[k + 3];
      if (kind === P.Hawk || kind === P.DustDevil) continue;
      expect(L.height(x, z)).toBeGreaterThan(0.3);
      L.canyon(x, z);
      if (kind !== P.Fence && L.cd < L.cw)
        expect(Math.abs(L.cs - K.roadOffset)).toBeGreaterThan(K.roadWidth);
    }
    for (const k of [P.Boulder, P.Sage, P.Fence, P.Hawk]) expect(kinds.has(k)).toBe(true);
  });

  it('stocks the ranches: buildings, a turning windmill, horses and cattle', () => {
    const sites = all((ox, oz, out) => sc.sites(ox, oz, size, out), 4);
    const n = new Map<number, number>();
    for (let k = 0; k < sites.length; k += PROP_STRIDE) n.set(sites[k], (n.get(sites[k]) ?? 0) + 1);
    expect(n.get(P.Ranch)).toBeGreaterThan(0);
    expect(n.get(P.Fan)).toBe(n.get(P.Ranch));
    expect(n.get(P.Horse)).toBeGreaterThan(0);
    expect(n.get(P.Cow)).toBeGreaterThan(0);
  });

  it('keeps the wisps an autopilot flies clear of every prop', () => {
    const w = new CanyonWorld(1337);
    const seen: number[] = [];
    const r = flyBot(w, w.layout.spawn, 1337, 60, (x, y, z) => {
      seen.push(x, y, z);
      return false;
    });
    expect(r.got).toBeGreaterThan(60);
    const s2 = new CanyonScatter(w.layout);
    const props = new Map<number, number[]>();
    for (let k = 0; k < seen.length; k += 3) {
      const cx = Math.floor(seen[k] / size);
      const cz = Math.floor(seen[k + 2] / size);
      for (let dz = -1; dz <= 1; dz++)
        for (let dx = -1; dx <= 1; dx++) {
          const key = (cx + dx) * 10000 + cz + dz;
          if (props.has(key)) continue;
          const out: number[] = [];
          s2.props((cx + dx) * size, (cz + dz) * size, size, out);
          s2.sites((cx + dx) * size, (cz + dz) * size, size, out);
          props.set(key, out);
        }
    }
    for (let k = 0; k < seen.length; k += 3) {
      const [x, y, z] = [seen[k], seen[k + 1], seen[k + 2]];
      const cx = Math.floor(x / size);
      const cz = Math.floor(z / size);
      for (let dz = -1; dz <= 1; dz++)
        for (let dx = -1; dx <= 1; dx++)
          for (const list of [props.get((cx + dx) * 10000 + cz + dz)!]) {
            for (let i = 0; i < list.length; i += PROP_STRIDE) {
              const kind = list[i];
              if (kind === P.Hawk || kind === P.DustDevil || kind === P.Brow) continue;
              // Everything on the ground stands under 12 m (the windmill's wheel included).
              if (Math.hypot(x - list[i + 1], z - list[i + 3]) < 4)
                expect(y).toBeGreaterThan(list[i + 2] + (kind === P.Fan ? 2 : 4));
            }
          }
    }
  }, 60_000);
});

describe('canyon ground cover', () => {
  const style = canyonCover();
  const tuft = (r: number, g: number, b: number, road: number, wash: number, slick: number) => ({
    r,
    g,
    b,
    scale: 1,
    bare: false,
    bloom: -1,
    petal: -1,
    extra: road,
    extras: [road, wash, slick, 0] as [number, number, number, number],
    shape: 0,
  });

  it('leaves the road and slickrock bare, grows the banks lush and the washes in flower', () => {
    const road = tuft(0.6, 0.4, 0.2, 0.5, 99, 0);
    style.paint!(10.5, 3.5, 2, road);
    expect(road.bare).toBe(true);
    const slick = tuft(0.6, 0.4, 0.2, 99, 99, 0.8);
    style.paint!(10.5, 3.5, 40, slick);
    expect(slick.bare).toBe(true);
    const bank = tuft(0.3, 0.4, 0.15, 99, 99, 0);
    style.paint!(10.5, 3.5, 1.5, bank);
    expect([bank.bare, bank.scale > 1, bank.shape]).toEqual([false, true, 0]);
    let flowers = 0;
    let shapes = 0;
    for (let i = 0; i < 400; i++) {
      const w = tuft(0.6, 0.4, 0.2, 99, 0.2, 0);
      style.paint!(i * 0.37, i * 0.53, 3, w);
      if (!w.bare && w.bloom > 0.3) flowers++;
      const d = tuft(0.6, 0.4, 0.2, 99, 99, 0);
      style.paint!(i * 0.37, i * 0.53, 3, d);
      if (d.shape > 0) shapes++;
    }
    expect(flowers).toBeGreaterThan(100);
    expect(shapes).toBeGreaterThan(5);
  });
});

describe('canyon music', () => {
  it('has a mixolydian twang and one key per time of day', () => {
    expect(MODES.dominantPenta).toEqual([0, 2, 4, 7, 10]);
    expect(CANYON_KEYS).toHaveLength(5);
    expect(CANYON_MUSIC.voice).toBe('guitar');
  });
});
