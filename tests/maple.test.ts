import { describe, expect, it } from 'vitest';
import { MAPLE_KEYS, MODES } from '../src/audio/scales';
import { MAPLE_MUSIC } from '../src/audio/styles';
import { Config } from '../src/core/Config';
import { LEVEL_LIST } from '../src/levels';
import type { CoverTuft } from '../src/world/GroundCover';
import { mapleCover } from '../src/world/maple/cover';
import {
  HALL,
  MapleLayout,
  PAGODA_R,
  WATER_GATE,
  deckY,
  type Temple,
  type Tunnel,
} from '../src/world/maple/MapleLayout';
import {
  CEDAR,
  FLOAT_STRIDE,
  K,
  MapleScatter,
  PROP_STRIDE,
  type MapleChunk,
} from '../src/world/maple/MapleScatter';
import { MapleWorld } from '../src/world/maple/MapleWorld';
import { TREE_STRIDE } from '../src/world/Trees';
import { flyBot } from './helpers';

const L = new MapleLayout(1337);
const SEEDS = [1337, 42, 7, 2024];

function templesAround(layout: MapleLayout, half: number): Temple[] {
  const C = Config.maple.templeCell;
  const out: Temple[] = [];
  for (let j = Math.floor(-half / C); j <= Math.floor(half / C); j++)
    for (let i = Math.floor(-half / C); i <= Math.floor(half / C); i++) {
      const t = layout.temple(i, j);
      if (t) out.push(t);
    }
  return out;
}

function tunnelsAround(layout: MapleLayout, half: number): Tunnel[] {
  const C = Config.maple.gateCell;
  const out: Tunnel[] = [];
  for (let j = Math.floor(-half / C); j <= Math.floor(half / C); j++)
    for (let i = Math.floor(-half / C); i <= Math.floor(half / C); i++) {
      const t = layout.tunnel(i, j);
      if (t) out.push(t);
    }
  return out;
}

describe('maple layout', () => {
  it('is deterministic per seed', () => {
    const a = new MapleLayout(42);
    const b = new MapleLayout(42);
    expect(a.height(123, -456)).toBe(b.height(123, -456));
    expect(a.temple(2, -3)).toEqual(b.temple(2, -3));
    expect(a.tunnel(-1, 2)).toEqual(b.tunnel(-1, 2));
    expect(a.lake).toEqual(b.lake);
    expect(a.home).toEqual(b.home);
  });

  it('opens on the river, down into the lake through the gate standing in the water', () => {
    for (const seed of SEEDS) {
      const l = new MapleLayout(seed);
      const s = l.spawn;
      expect(l.height(s.x, s.z)).toBeLessThan(-1);
      const G = l.gate;
      // The gate's posts stand in deep water, the opening run passes between them.
      for (const sd of [-1, 1])
        expect(
          l.height(G.x + G.uz * sd * WATER_GATE.half, G.z - G.ux * sd * WATER_GATE.half),
        ).toBeLessThan(-1);
      const O = l.opening;
      let closest = Infinity;
      for (let k = 0; k < O.length; k += 3) {
        closest = Math.min(closest, Math.hypot(O[k] - G.x, O[k + 1] - G.z));
        // Low over the water all the way, never into the island.
        expect(l.height(O[k], O[k + 1])).toBeLessThan(0);
        expect(Math.hypot(O[k] - l.island.x, O[k + 1] - l.island.z)).toBeGreaterThan(
          l.island.r + 20,
        );
      }
      expect(closest).toBeLessThan(1);
      // Between the posts and under the beams is open; the posts and beams are solid.
      expect(l.solidTop(G.x, 7, G.z, 2)).toBe(-Infinity);
      expect(
        l.solidTop(G.x + G.uz * WATER_GATE.half, 7, G.z - G.ux * WATER_GATE.half, 0),
      ).toBeGreaterThan(0);
      expect(l.solidTop(G.x, WATER_GATE.under + 1, G.z, 0)).toBe(WATER_GATE.top);
      // The island is dry, level ground for the pavilion, and the pavilion is solid.
      expect(l.height(l.island.x, l.island.z)).toBeCloseTo(l.island.y, 1);
      expect(l.solidTop(l.pavilion.x, 8, l.pavilion.z, 0)).toBe(l.pavilion.top);
      expect(l.home).not.toBeNull();
    }
  });

  it('raises wooded mountains beyond a valley floor, never a cliff, under the ceiling', () => {
    let high = 0;
    let n = 0;
    let top = 0;
    for (let z = -3000; z < 3000; z += 41)
      for (let x = -3000; x < 3000; x += 43) {
        n++;
        const y = L.height(x, z);
        top = Math.max(top, y);
        if (y > 60) high++;
      }
    expect(high / n).toBeGreaterThan(0.15);
    expect(top).toBeLessThan(Config.maple.mountain + 10);
    expect(top + Config.maple.canopy + 40).toBeLessThan(340);
  });

  it('sets temples on level pads by the valley floor, their pagodas solid, their halls soft', () => {
    const ts = templesAround(L, 3000);
    expect(ts.length).toBeGreaterThan(8);
    for (const t of ts) {
      expect(L.height(t.x, t.z)).toBeCloseTo(t.y, 3);
      expect(t.y).toBeGreaterThan(2.5);
      const w = L.water(t.x, t.z);
      expect(w).toBeGreaterThan(40);
      // The pagoda: solid half way up, pushed out sideways off its eaves.
      const y = t.y + 12;
      expect(L.solidTop(t.px, y, t.pz, 0)).toBe(t.top);
      const p = { x: t.px + PAGODA_R - 0.5, y, z: t.pz };
      const n = { x: 0, y: 0, z: 0 };
      expect(L.pushPoint(p, 1, n)).toBeGreaterThan(0);
      expect(n.x).toBeGreaterThan(0.9);
      expect(L.solidTop(p.x, p.y, p.z, 0.99)).toBe(-Infinity);
      // The hall is a soft roof: no solid, but the floor lifts over it.
      expect(L.solidTop(t.x, t.y + 4, t.z, 1)).toBe(-Infinity);
      expect(L.flightGround(t.x, t.z)).toBeGreaterThan(t.y + HALL.h - 0.5);
    }
  });

  it('climbs tunnels of gates up the mountainsides on level benches, soft but kept from ribbons', () => {
    const tun = tunnelsAround(L, 3000);
    expect(tun.length).toBeGreaterThan(5);
    const K2 = Config.maple;
    for (const t of tun) {
      expect(t.n).toBeGreaterThanOrEqual(K2.gateMin);
      const G = t.gates;
      expect(G[(t.n - 1) * 4 + 1] - G[1]).toBeGreaterThan(
        t.n * K2.gateSpacing * K2.gateGrade * 0.45,
      );
      for (let k = 0; k < t.n; k++) {
        const x = G[k * 4];
        const y = G[k * 4 + 1];
        const z = G[k * 4 + 2];
        const yaw = G[k * 4 + 3];
        if (k > 0) {
          const d = Math.hypot(x - G[k * 4 - 4], z - G[k * 4 - 2]);
          expect(d).toBeGreaterThan(K2.gateSpacing * 0.8);
          expect(d).toBeLessThan(K2.gateSpacing * 1.3);
          // Gentle: never steeper than the grade allows, never a hairpin.
          expect(Math.abs(y - G[k * 4 - 3])).toBeLessThan(K2.gateSpacing * K2.gateGrade * 2 + 0.5);
        }
        // The bench is level across the path: both posts stand on it.
        for (const s of [-1, 1]) {
          const px = x + Math.cos(yaw) * s * K2.gateHalf;
          const pz = z - Math.sin(yaw) * s * K2.gateHalf;
          expect(Math.abs(L.height(px, pz) - L.height(x, z))).toBeLessThan(1.2);
        }
        // Soft (no solid), no canopy over the path, and kept from generic ribbons.
        expect(L.solidTop(x, y + 5, z, 1)).toBe(-Infinity);
        expect(L.flightGround(x, z)).toBeLessThan(L.height(x, z) + 1);
        expect(L.inGates(x, y + 5, z, 0)).toBe(true);
        expect(L.inGates(x, y + K2.gateHeight + 12, z, 0)).toBe(false);
      }
    }
  });

  it('bridges narrow reaches with arched decks the bird is lifted over', () => {
    let n = 0;
    for (let j = -6; j <= 6; j++)
      for (let i = -6; i <= 6; i++) {
        const b = L.bridgeIn(i, j);
        if (!b) continue;
        n++;
        expect(L.height(b.x, b.z)).toBeLessThan(0);
        expect(deckY(b, 0)).toBe(b.crown);
        expect(L.bridgeTop(b.x, b.z)).toBeGreaterThan(b.crown);
      }
    expect(n).toBeGreaterThan(5);
  });

  it('pushes down out from under the gate’s beams, and never by an infinite amount', () => {
    const G = L.gate;
    const p = { x: G.x, y: WATER_GATE.under + 0.5, z: G.z };
    const n = { x: 0, y: 0, z: 0 };
    expect(L.pushPoint(p, 1, n)).toBeGreaterThan(0);
    expect(n.y).toBe(-1);
    expect(p.y).toBeLessThan(WATER_GATE.under - 0.9);
    const top = { x: G.x, y: WATER_GATE.top - 0.3, z: G.z };
    L.pushPoint(top, 1, n);
    expect(n.y).toBe(1);
    for (const v of [p.x, p.y, p.z, top.x, top.y, top.z]) expect(Number.isFinite(v)).toBe(true);
  });
});

describe('maple scatter', () => {
  const S = new MapleScatter(L);
  const size = Config.world.chunkSize;
  const chunks: MapleChunk[] = [];
  for (let j = -4; j < 4; j++)
    for (let i = -4; i < 4; i++) chunks.push(S.chunk(i * size, j * size, size));

  it('is deterministic', () => {
    expect(S.chunk(160, -320, size)).toEqual(
      new MapleScatter(new MapleLayout(1337)).chunk(160, -320, size),
    );
  });

  it('grows a forest off the roads, the pads and the water, cedars among maples', () => {
    let trees = 0;
    let cedars = 0;
    for (const c of chunks)
      for (let k = 0; k < c.trees.length; k += TREE_STRIDE) {
        trees++;
        if (c.trees[k] === CEDAR) cedars++;
        const x = c.trees[k + 1];
        const z = c.trees[k + 3];
        expect(L.height(x, z)).toBeGreaterThan(0.3);
      }
    expect(trees).toBeGreaterThan(2000);
    expect(cedars).toBeGreaterThan(20);
    expect(cedars / trees).toBeLessThan(0.5);
  });

  it('floats lanterns on the lake, clear of the island and the gate', () => {
    let n = 0;
    for (const c of chunks)
      for (let k = 0; k < c.floats.length; k += FLOAT_STRIDE) {
        n++;
        const x = c.floats[k];
        const z = c.floats[k + 1];
        expect(L.lakeEdge(x, z)).toBeLessThan(-10);
        expect(Math.hypot(x - L.island.x, z - L.island.z)).toBeGreaterThan(L.island.r + 10);
      }
    expect(n).toBeGreaterThan(40);
  });

  it('keeps farmhouses under the farmland’s soft floor and off the roads', () => {
    for (const c of chunks)
      for (let k = 0; k < c.built.length; k += PROP_STRIDE) {
        if (c.built[k] !== K.Farmhouse) continue;
        const x = c.built[k + 1];
        const z = c.built[k + 3];
        expect(L.flightGround(x, z)).toBeGreaterThan(c.built[k + 2] + 7);
        L.land(x, z);
        expect(L.lPath).toBeGreaterThan(Config.maple.roadWidth + 4);
      }
  });

  it('leaves the cover bare on the roads and the gravel, pampas on the meadows', () => {
    const style = mapleCover();
    const t: CoverTuft = {
      r: 1,
      g: 1,
      b: 1,
      scale: 1,
      bare: false,
      bloom: -1,
      petal: -1,
      extra: 0,
      extras: [50, 0, 0.5, 0],
      shape: 0,
    };
    style.paint!(10, 10, 5, t);
    expect(t.bare).toBe(true);
    Object.assign(t, { bare: false, scale: 1, extras: [50, 0, 40, 0.9] });
    style.paint!(10, 10, 5, t);
    expect(t.bare).toBe(true);
    let tall = 0;
    for (let x = 0; x < 400; x += 7) {
      Object.assign(t, { bare: false, scale: 1, extras: [50, 0, 40, 0] });
      style.paint!(x, x * 0.7, 5, t);
      if (t.scale > 2) tall++;
    }
    expect(tall).toBeGreaterThan(3);
  });
});

describe('maple wisps', () => {
  it('ribbons never sit inside a solid, and an autopilot gathers them', () => {
    for (const seed of [42, 2024]) {
      const w = new MapleWorld(seed);
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

describe('maple level and music', () => {
  it('is on the title, on its own harp and tempo', () => {
    expect(LEVEL_LIST.map((l) => l.id)).toContain('maple');
    expect(MAPLE_KEYS).toHaveLength(5);
    for (const k of MAPLE_KEYS) expect(MODES[k.mode]).toBeDefined();
    expect(MAPLE_MUSIC.voice).toBe('harp');
    for (const l of LEVEL_LIST)
      if (l.id !== 'maple')
        expect(l.music.voice === MAPLE_MUSIC.voice && l.music.bpm === MAPLE_MUSIC.bpm).toBe(false);
  });
});
