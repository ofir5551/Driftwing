import { describe, expect, it } from 'vitest';
import { Config } from '../src/core/Config';
import { KARST_KEYS, MODES } from '../src/audio/scales';
import type { CoverTuft } from '../src/world/GroundCover';
import { karstCover } from '../src/world/karst/cover';
import {
  deckY,
  FLOODED,
  KarstLayout,
  PAGODA_HEIGHT,
  paddyKind,
  profile,
  RIPE,
  SHAPES,
} from '../src/world/karst/KarstLayout';
import {
  BUILT_HEIGHT,
  BUILT_REACH,
  K,
  KarstScatter,
  PROP_STRIDE,
  VINE_STRIDE,
  type KarstChunk,
} from '../src/world/karst/KarstScatter';
import { KarstWorld } from '../src/world/karst/KarstWorld';
import { MIST_STRIDE, riverMistSpots } from '../src/world/karst/RiverMist';
import { SKINS } from '../src/world/karst/skin';
import { flyBot } from './helpers';

const L = new KarstLayout(1337);

/** Every pillar centred in a square around the origin. */
function pillarsAround(layout: KarstLayout, half: number) {
  const C = Config.karst.pillarCell;
  const out = [];
  for (let j = Math.floor(-half / C); j <= Math.floor(half / C); j++)
    for (let i = Math.floor(-half / C); i <= Math.floor(half / C); i++)
      out.push(...layout.cell(i, j));
  return out;
}

describe('karst layout', () => {
  it('is deterministic per seed', () => {
    const a = new KarstLayout(42);
    const b = new KarstLayout(42);
    expect(a.spawn).toEqual(b.spawn);
    expect(a.cell(3, -2)).toEqual(b.cell(3, -2));
    expect(a.height(123, -456)).toBe(b.height(123, -456));
    expect(a.bridgeIn(1, -2)).toEqual(b.bridgeIn(1, -2));
  });

  it('starts the bird on a river, facing along it with open water ahead', () => {
    for (const seed of [1337, 42, 7, 2024]) {
      const l = new KarstLayout(seed);
      const s = l.spawn;
      expect(l.river(s.x, s.z)).toBeLessThan(0);
      expect(l.height(s.x, s.z)).toBeLessThan(0);
      for (let d = 0; d < 150; d += 3) {
        const x = s.x + Math.sin(s.yaw) * d;
        const z = s.z + Math.cos(s.yaw) * d;
        expect(l.solidTop(x, s.y, z, 3)).toBe(-Infinity);
        expect(l.bridgeTop(x, z)).toBe(-Infinity);
      }
    }
  });

  it('scatters plenty of pillars, all clear of the rivers and under the ceiling', () => {
    const ps = pillarsAround(L, 1200);
    expect(ps.length).toBeGreaterThan(250);
    for (const p of ps) {
      expect(L.river(p.x, p.z)).toBeGreaterThan(p.r);
      expect(p.top).toBeLessThan(Config.karst.pillarTop + 20);
    }
    // A forest of peaks, not a uniform field: a good share stands taller than 100 m.
    expect(ps.filter((p) => p.h > 100).length).toBeGreaterThan(ps.length * 0.15);
    expect(ps.some((p) => p.pavilion)).toBe(true);
  });

  it('profiles a closed summit dome with a flared foot', () => {
    for (const sh of SHAPES) {
      expect(profile(sh, 0)).toBeGreaterThan(1);
      expect(profile(sh, 0.999)).toBeLessThan(0.1);
      expect(profile(sh, 1)).toBe(0);
    }
  });

  it('lathes every tier from one skin that stays within the collision margin', () => {
    // The drawn rock bulges and dips round the profile the collisions use, never by more than
    // the bird's clearance can absorb.
    for (const skin of SKINS)
      for (let t = 0; t < 0.98; t += 0.05)
        for (let a = 0; a < 6.28; a += 0.3) {
          const f = skin.flute(t, a);
          expect(f).toBeGreaterThan(0.8);
          expect(f).toBeLessThan(1.2);
        }
  });

  it('pushes a point out of a pillar: sideways on the flank, up on the summit', () => {
    const p = pillarsAround(L, 600).find((q) => q.h > 90 && q.shape !== 3)!;
    const n = { x: 0, y: 0, z: 0 };
    const mid = p.y0 + p.h * 0.4;
    const r = L.axisAt(p, mid);
    const flank = { x: L.ax + r - 2, y: mid, z: L.az };
    expect(L.pushPoint(flank, 1, n)).toBeGreaterThan(0);
    expect(n.x).toBeGreaterThan(0.9);
    expect(L.solidTop(flank.x, flank.y, flank.z, 0.99)).toBe(-Infinity);
    const top = { x: p.x + p.lx, y: p.y0 + p.h - 1, z: p.z + p.lz };
    L.pushPoint(top, 1, n);
    expect(n.y).toBe(1);
    expect(top.y).toBeGreaterThanOrEqual(p.top);
  });
});

/** The paddy hash in float32 arithmetic, as the terrain shader does it. */
function glslKind(t: number, cx: number, cz: number): number {
  const f = Math.fround;
  const mod = (x: number, y: number) => f(x - f(y * Math.floor(f(x / y))));
  const a = mod(f(t), 64);
  const b = mod(f(cx), 64);
  const c = mod(f(cz), 64);
  const n = f(
    f(f(f(f(f(a * 31) + f(b * 17)) + f(c * 13)) + f(f(a * b) * 7)) + f(f(b * c) * 3)) +
      f(f(a * c) * 5),
  );
  return mod(mod(n, 97), 20);
}

/** Every chunk's eager and lazy scenery within `r` chunks of (cx, cz). */
function chunksAround(layout: KarstLayout, cx: number, cz: number, r: number): KarstChunk[] {
  const sc = new KarstScatter(layout);
  const size = Config.world.chunkSize;
  const out: KarstChunk[] = [];
  for (let j = cz - r; j <= cz + r; j++)
    for (let i = cx - r; i <= cx + r; i++) {
      const c = sc.chunk(i * size, j * size, size);
      sc.props(c, size);
      out.push(c);
    }
  return out;
}

/** Records of the given kinds from the chunks' built (or lazy) lists. */
function records(chunks: KarstChunk[], kinds: number[], lazy = false): number[][] {
  const out: number[][] = [];
  for (const c of chunks) {
    const list = lazy ? c.props! : c.built;
    for (let k = 0; k < list.length; k += PROP_STRIDE)
      if (kinds.includes(list[k])) out.push(list.slice(k, k + PROP_STRIDE));
  }
  return out;
}

describe('karst land', () => {
  it('picks the same paddy kind on the CPU as the shader does in float32', () => {
    const seen = new Set<number>();
    for (let t = -3; t < 40; t += 1)
      for (let j = -300; j <= 300; j += 37)
        for (let i = -300; i <= 300; i += 23) {
          const k = paddyKind(t, i, j);
          expect(k).toBe(glslKind(t, i, j));
          seen.add(k < FLOODED ? 0 : k < RIPE ? 1 : 2);
        }
    expect(seen.size).toBe(3);
  });

  it('cuts the paddy country into level terraces stepping up its hills', () => {
    const step = Config.karst.terraceStep;
    let treads = 0;
    const levels = new Set<number>();
    for (let z = -1500; z < 1500; z += 13)
      for (let x = -1500; x < 1500; x += 13) {
        const y = L.base(x, z);
        if (L.pw < 0.999 || y < 0.5) continue;
        const f = L.raw / step;
        // On a tread the ground is exactly the terrace's level.
        if (f - Math.floor(f) < 0.8) {
          expect(Math.abs(y - Math.floor(f) * step)).toBeLessThan(0.01);
          treads++;
          levels.add(Math.floor(f));
        }
      }
    expect(treads).toBeGreaterThan(1000);
    expect(levels.size).toBeGreaterThan(8);
  });

  it('paints rice by field kind, reeds at the water, bare paths and sparse scree', () => {
    const style = karstCover();
    const tuft = (bank: number, pg: number, raw: number, path: number): CoverTuft => ({
      r: 0.3,
      g: 0.5,
      b: 0.2,
      scale: 1,
      bare: false,
      bloom: -1,
      petal: -1,
      extra: bank,
      more: [bank, pg, raw, path],
    });
    const step = Config.karst.terraceStep;
    const fc = Config.karst.fieldCell;
    const kinds = new Set<string>();
    for (let ti = 2; ti < 30; ti++)
      for (let c = 0; c < 6; c++) {
        const x = (c + 0.5) * fc;
        const z = ((ti % 5) + 0.5) * fc;
        const t = tuft(60, 1, (ti + 0.4) * step, 50);
        style.paint!(x, z, ti * step, t);
        const kind = paddyKind(ti, Math.floor(x / fc), Math.floor(z / fc));
        if (kind >= RIPE) expect([t.bare, t.scale > 1.2, t.r > t.b]).toEqual([false, true, true]);
        else if (kind >= FLOODED) expect([t.bare, t.g > t.r]).toEqual([false, true]);
        else if (!t.bare) expect(t.scale).toBeLessThan(0.7);
        kinds.add(kind < FLOODED ? 'wet' : kind < RIPE ? 'young' : 'ripe');
      }
    expect(kinds.size).toBe(3);
    const reed = tuft(1.5, 0, 3, 50);
    style.paint!(10.5, 10.5, 1, reed);
    expect(reed.scale).toBeGreaterThan(1.8);
    const path = tuft(40, 0, 3, 0.4);
    style.paint!(10.5, 10.5, 3, path);
    expect(path.bare).toBe(true);
  });
});

describe('karst scenery', () => {
  const W = new KarstWorld(1337);
  const LL = W.layout;
  const chunks = chunksAround(LL, 0, -1, 4);

  it('scatters the same scenery for the same seed', () => {
    const sa = new KarstScatter(new KarstLayout(7));
    const sb = new KarstScatter(new KarstLayout(7));
    const a = sa.chunk(320, -480, 160);
    const b = sb.chunk(320, -480, 160);
    expect(a.built).toEqual(b.built);
    expect(a.trees).toEqual(b.trees);
    sa.props(a, 160);
    sb.props(b, 160);
    expect(a.props).toEqual(b.props);
    expect(a.vines).toEqual(b.vines);
  });

  it('builds villages on dry ground off the paths, every roof under the flight floor', () => {
    const houses = records(chunks, [K.House, K.House2, K.Hall]);
    expect(houses.length).toBeGreaterThan(60);
    for (const [kind, x, y, z, yaw, , s] of houses) {
      expect(LL.river(x, z)).toBeGreaterThan(8);
      expect(LL.pathDist(x, z)).toBeGreaterThan(Config.karst.pathWidth + 2);
      const roof = y + BUILT_HEIGHT[kind] * s;
      // The centre and the corners of the footprint.
      const r = BUILT_REACH[kind] * s * 0.7;
      const c = Math.cos(yaw);
      const n = Math.sin(yaw);
      for (const [dx, dz] of [
        [0, 0],
        [1, 1],
        [-1, 1],
        [1, -1],
        [-1, -1],
      ]) {
        const px = x + (dx * c + dz * n) * r;
        const pz = z + (-dx * n + dz * c) * r;
        expect(W.flightGround(px, pz)).toBeGreaterThan(roof - 0.6);
      }
    }
  });

  it('keeps land props out of the river, and boats and wallowing buffalo in it', () => {
    const land = records(chunks, [K.Boulder, K.Farmer], true);
    expect(land.length).toBeGreaterThan(100);
    for (const [, x, , z] of land) expect(LL.river(x, z)).toBeGreaterThan(0);
    const boats = records(chunks, [K.Raft, K.Sampan]);
    expect(boats.length).toBeGreaterThan(5);
    for (const [, x, , z] of boats) expect(LL.river(x, z)).toBeLessThan(-2);
    for (const [, x, y, z] of records(chunks, [K.Buffalo], true))
      expect(y < 0 ? LL.river(x, z) < 0 : LL.river(x, z) > 10).toBe(true);
  });

  it('hangs vines on the rock: never inside it, never far off it', () => {
    let n = 0;
    for (const c of chunks) {
      const v = c.vines!;
      for (let k = 0; k < v.length; k += VINE_STRIDE) {
        // Its top, and its foot (the top less the basis' foot-to-top axis).
        for (const [x, y, z] of [
          [v[k], v[k + 1], v[k + 2]],
          [v[k] - v[k + 6], v[k + 1] - v[k + 7], v[k + 2] - v[k + 8]],
        ]) {
          // Its own pillar: the one whose wall it is nearest.
          let off = Infinity;
          for (const p of c.pillars) {
            const t = (y - p.y0) / p.h;
            if (t < 0 || t > 1) continue;
            const ax = p.x + p.lx * t * t;
            const az = p.z + p.lz * t * t;
            const la = Math.atan2(z - az, x - ax) + p.yaw;
            const d = Math.hypot(x - ax, z - az) - p.r * SKINS[p.shape].radius(t, la);
            if (Math.abs(d) < Math.abs(off)) off = d;
          }
          expect(off).toBeGreaterThan(0.3);
          expect(off).toBeLessThan(1.6);
        }
        n++;
      }
    }
    expect(n).toBeGreaterThan(30);
  });

  it('bridges the river where a path crosses it, away from the opening run', () => {
    let n = 0;
    for (let j = -6; j <= 6; j++)
      for (let i = -6; i <= 6; i++) {
        const b = LL.bridgeIn(i, j);
        if (!b) continue;
        n++;
        expect(LL.river(b.x, b.z)).toBeLessThan(-LL.rw + 3);
        expect(LL.pathDist(b.x, b.z)).toBeLessThan(2);
        expect(Math.hypot(b.x - LL.spawn.x, b.z - LL.spawn.z)).toBeGreaterThan(500);
        // The flight floor rides over the deck all the way across, clear of the rock.
        for (const u of [-0.9, -0.5, 0, 0.5, 0.9]) {
          const x = b.x + b.ux * b.half * u;
          const z = b.z + b.uz * b.half * u;
          expect(W.flightGround(x, z)).toBeGreaterThan(deckY(b, u) + 1);
          expect(LL.skyline(x, z, 10)).toBe(-Infinity);
        }
      }
    expect(n).toBeGreaterThan(5);
  });

  it('crowns some lower summits with pagodas the collisions know about', () => {
    let n = 0;
    for (let j = -12; j <= 12; j++)
      for (let i = -12; i <= 12; i++)
        for (const p of LL.cell(i, j)) {
          if (!p.pagoda) continue;
          n++;
          expect(p.pavilion).toBe(false);
          expect(p.top).toBeGreaterThan(p.y0 + p.h + PAGODA_HEIGHT);
          const y = p.y0 + p.h + PAGODA_HEIGHT * 0.5;
          expect(LL.solidTop(p.x + p.lx, y, p.z + p.lz, 0)).not.toBe(-Infinity);
        }
    expect(n).toBeGreaterThan(3);
  });

  it('lays river mist over the water', () => {
    const out = new Float32Array(200 * MIST_STRIDE);
    const n = riverMistSpots(LL, 0, 0, out, { x: 0, z: 0 });
    expect(n).toBeGreaterThan(10);
    for (let k = 0; k < n; k++)
      expect(LL.river(out[k * MIST_STRIDE], out[k * MIST_STRIDE + 2])).toBeLessThan(0);
  });
});

/** Inside the rock (a pagoda's too), under a bridge's deck, or in a house. */
function solidIn(w: KarstWorld) {
  const layout = w.layout;
  const sc = new KarstScatter(layout);
  const size = Config.world.chunkSize;
  const cache = new Map<number, KarstChunk>();
  return (x: number, y: number, z: number): boolean => {
    if (layout.solidTop(x, y, z, 0) !== -Infinity) return true;
    if (y < layout.bridgeTop(x, z) - 1.2) return true;
    const cx = Math.floor(x / size);
    const cz = Math.floor(z / size);
    const key = cx * 100000 + cz;
    let c = cache.get(key);
    if (!c) cache.set(key, (c = sc.chunk(cx * size, cz * size, size)));
    const b = c.built;
    for (let k = 0; k < b.length; k += PROP_STRIDE) {
      if (b[k] > K.Hall) continue;
      const s = b[k + 6];
      if (
        Math.hypot(x - b[k + 1], z - b[k + 3]) < BUILT_REACH[b[k]] * s &&
        y < b[k + 2] + BUILT_HEIGHT[b[k]] * s
      )
        return true;
    }
    return false;
  };
}

describe('karst wisps', () => {
  it('ribbons never sit inside the rock, a bridge or a house, and an autopilot flies them', () => {
    for (const seed of [42, 2024]) {
      const w = new KarstWorld(seed);
      const r = flyBot(w, w.layout.spawn, seed, 120, solidIn(w));
      expect(r.inside).toBe(0);
      expect(r.got).toBeGreaterThan(150);
      expect(r.glances).toBeLessThanOrEqual(2);
    }
  });

  it('hops the river ribbons over a bridge', () => {
    const w = new KarstWorld(1337);
    const layout = w.layout;
    let b = null;
    for (let k = 0; k < 169 && !b; k++) b = layout.bridgeIn((k % 13) - 6, Math.floor(k / 13) - 6);
    expect(b).not.toBeNull();
    // 210 m along the river from the bridge, then turned back to fly at it.
    let x = b!.x;
    let z = b!.z;
    let h = layout.riverHeading(x, z, b!.yaw + Math.PI / 2);
    for (let i = 0; i < 14; i++) {
      h = layout.riverHeading(x, z, h);
      x += Math.sin(h) * 15;
      z += Math.cos(h) * 15;
    }
    const yaw = layout.riverHeading(x, z, Math.atan2(b!.x - x, b!.z - z));
    let over = 0;
    const r = flyBot(w, { x, y: 14, z, yaw }, 1337, 30, solidIn(w), undefined, (px, py, pz) => {
      if (layout.bridgeTop(px, pz) > 0 && py > layout.bridgeTop(px, pz)) over++;
    });
    expect(r.inside).toBe(0);
    expect(over).toBeGreaterThan(0);
  });
});

describe('karst music', () => {
  it('walks the Chinese modes, one key per time of day', () => {
    expect(MODES.jue).toEqual([0, 3, 5, 8, 10]);
    expect(KARST_KEYS).toHaveLength(5);
  });
});
