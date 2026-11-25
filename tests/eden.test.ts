import { describe, expect, it } from 'vitest';
import { Config } from '../src/core/Config';
import { Eden } from '../src/levels/Eden';
import { createHeightField } from '../src/world/Terrain';
import { EdenLayout, VENUE } from '../src/world/eden/EdenLayout';
import { CELL, Countryside } from '../src/world/eden/countryside';
import { heartField, heartPoint } from '../src/world/eden/heart';
import { EdenWorld } from '../src/world/eden/EdenWorld';
import { EDEN_PHOTOS } from '../src/world/eden/photos';
import v0 from '../src/world/eden/photos/p0.bin?inline';
import v1 from '../src/world/eden/photos/p1.bin?inline';
import v2 from '../src/world/eden/photos/p2.bin?inline';
import { veil } from '../src/world/eden/veil';
import { flyBot, journeyBot } from './helpers';

const SEEDS = [1337, 42, 7, 2024];

describe('Eden layout', () => {
  it('is the same for a seed', () => {
    const a = new EdenLayout(createHeightField(7), 7);
    const b = new EdenLayout(createHeightField(7), 7);
    expect([a.tal, a.hadar, a.venue]).toEqual([b.tal, b.hadar, b.venue]);
  });

  it.each(SEEDS)('puts each stop on its own level, dry meadow, farther along (seed %i)', (seed) => {
    const L = new EdenLayout(createHeightField(seed), seed);
    const sites = [L.tal, L.hadar, L.venue];
    let prev = { x: 0, z: 0 };
    for (const S of sites) {
      expect(S.y).toBeGreaterThanOrEqual(Config.eden.plateauMin);
      expect(S.y).toBeLessThanOrEqual(Config.eden.plateauMax);
      // Level across the meadow and away from any river.
      for (let a = 0; a < 6.28; a += 0.4) {
        const x = S.x + Math.sin(a) * S.flat * 0.95;
        const z = S.z + Math.cos(a) * S.flat * 0.95;
        expect(L.field.height(x, z)).toBeCloseTo(S.y, 5);
        expect(Math.abs(L.field.riverDist(x, z))).toBeGreaterThan(Config.highlands.plainWidth);
        expect(L.field.farm(x, z)).toBe(0);
      }
      const leg = Math.hypot(S.x - prev.x, S.z - prev.z);
      expect(leg).toBeGreaterThan(Config.destinations.firstRoute * 0.7);
      expect(leg).toBeLessThan(Config.destinations.stray * 0.5);
      prev = S;
    }
    expect(L.venue.z).toBeGreaterThan(L.hadar.z);
    expect(L.hadar.z).toBeGreaterThan(L.tal.z);
  });

  it('maps the venue frame both ways, with the bird arriving from +v', () => {
    const L = new EdenLayout(createHeightField(1337), 1337);
    const p = L.toWorld(12, -30);
    const q = L.toVenue(p.x, p.z);
    expect(q.u).toBeCloseTo(12, 6);
    expect(q.v).toBeCloseTo(-30, 6);
    // +v points back toward Hadar's garden, where the bird comes from.
    const b = L.toWorld(0, 100);
    expect(Math.hypot(b.x - L.hadar.x, b.z - L.hadar.z)).toBeLessThan(
      Math.hypot(L.venue.x - L.hadar.x, L.venue.z - L.hadar.z),
    );
    // The roof stands over the hall; the beacon's lawn is open.
    const R = VENUE.roof;
    expect(L.roofTop(R.u, R.v)).toBeGreaterThan(L.venue.y + VENUE.hall.height);
    const beacon = L.toWorld(VENUE.beacon.u, VENUE.beacon.v);
    expect(L.liftAt(beacon.x, beacon.z)).toBe(-Infinity);
  });

  it('pushes a point out of a picture through its nearer face, and over the top', () => {
    const L = new EdenLayout(createHeightField(1337), 1337);
    const F = L.frames[0];
    const s = Math.sin(F.yaw);
    const c = Math.cos(F.yaw);
    const front = { x: F.x + s * 0.3, y: (F.y0 + F.y1) / 2, z: F.z + c * 0.3 };
    expect(L.pushFrame(front, 1)).toBeGreaterThan(0);
    expect((front.x - F.x) * s + (front.z - F.z) * c).toBeGreaterThan(1.7);
    const top = { x: F.x, y: F.y1 + 0.5, z: F.z };
    L.pushFrame(top, 1);
    expect(top.y).toBeGreaterThanOrEqual(F.y1 + 2 - 1e-9);
    const clear = { x: F.x + c * 40, y: F.y0, z: F.z - s * 40 };
    expect(L.pushFrame(clear, 1)).toBe(0);
  });
});

describe('Eden journeys', () => {
  it('lead to Tal, then Hadar, then the venue, then on to the isles', () => {
    const w = new EdenWorld(1337);
    const src = w.destinations;
    const skip = new Set<string>();
    const ids: string[] = [];
    for (let i = 0; i < 4; i++) {
      const d = src.next(0, 0, 0, i === 0, skip);
      expect(d).toBeTruthy();
      ids.push(d!.id);
      skip.add(d!.id);
      if (i < 2) expect(d!.roost).toBeTruthy();
      if (i === 2) expect(d!.roost).toBeNull();
    }
    expect(ids.slice(0, 3)).toEqual(EDEN_PHOTOS.map((p) => p.id));
    expect(ids[3]).toMatch(/^isle:/);
  });

  it('end beside each picture, not in it', () => {
    const w = new EdenWorld(1337);
    const skip = new Set<string>();
    for (let i = 0; i < 2; i++) {
      const d = w.destinations.next(0, 0, 0, i === 0, skip)!;
      skip.add(d.id);
      const F = w.layout.frames[i];
      expect(Math.hypot(d.x - F.x, d.z - F.z)).toBeGreaterThan(F.half + Config.destinations.reach);
    }
  });

  it.each(SEEDS)('the bot follows the ribbons through the whole story (seed %i)', (seed) => {
    const { world, spawn } = Eden.create(seed);
    const r = journeyBot(world, spawn, seed, 360, () => false);
    expect(r.names.slice(0, 3)).toEqual(["Tal's Meadow", "Hadar's Garden", 'Eden']);
    expect(r.arrivals.length).toBeGreaterThanOrEqual(3);
    expect(r.arrivals[0]).toBeLessThan(120);
    expect(r.glances).toBeLessThanOrEqual(2);
  });
});

describe('Eden flight', () => {
  it.each(SEEDS)('the bot flies freely, never inside a picture (seed %i)', (seed) => {
    const { world, spawn } = Eden.create(seed);
    const L = (world as EdenWorld).layout;
    const p = { x: 0, y: 0, z: 0 };
    const inFrame = (x: number, y: number, z: number): boolean => {
      p.x = x;
      p.y = y;
      p.z = z;
      return L.pushFrame(p, 0) > 0 || y < world.field.height(x, z);
    };
    const r = flyBot(world, spawn, seed, 120, inFrame);
    expect(r.inside).toBe(0);
    // The Highlands' own bar is 80 in 90 s: the same country, the same rhythm.
    expect(r.got).toBeGreaterThan(100);
    expect(r.glances).toBeLessThanOrEqual(2);
  });
});

describe('Eden photos', () => {
  it('are kept veiled, and unveil to JPEGs', () => {
    const bytes = new Uint8Array([1, 2, 3, 250, 0, 9]);
    expect([...veil(veil(bytes.slice()))]).toEqual([...bytes]);
    for (const file of [v0, v1, v2]) {
      // Inlined as a base64 data URL.
      const raw = Uint8Array.from(atob(file.slice(file.indexOf(',') + 1)), (c) => c.charCodeAt(0));
      expect(raw.length).toBeGreaterThan(10_000);
      expect([raw[0], raw[1]]).not.toEqual([0xff, 0xd8]);
      const jpg = veil(raw);
      expect([jpg[0], jpg[1], jpg[2]]).toEqual([0xff, 0xd8, 0xff]);
    }
  });
});

describe('Eden countryside', () => {
  it('draws one heart: the field is below 0 inside the outline and above it outside', () => {
    const p = { x: 0, y: 0 };
    expect(heartField(0, 0)).toBeLessThan(0);
    for (let k = 0; k < 32; k++) {
      heartPoint(k / 32, p);
      expect(heartField(p.x * 0.8, p.y * 0.8 + 0.02)).toBeLessThan(0.02);
      // Outward from the centre (but not at the dip between the lobes, which is concave).
      if (Math.abs(p.x) > 0.25) expect(heartField(p.x * 1.3, p.y * 1.3)).toBeGreaterThan(0);
    }
  });

  it.each(SEEDS)('cuts a heart-shaped lake into a dry meadow (seed %i)', (seed) => {
    const L = new EdenLayout(createHeightField(seed), seed);
    const K = L.lake;
    expect(L.field.height(K.x, K.z)).toBeLessThan(Config.world.waterLevel - 1);
    // The lobes point away from the spawn: wet between them would mean it is upside down.
    const up = { x: Math.sin(K.yaw), z: Math.cos(K.yaw) };
    expect(up.x * K.x + up.z * K.z).toBeGreaterThan(0);
    for (let a = 0; a < 6.28; a += 0.3) {
      const x = K.x + Math.sin(a) * K.size * 1.5;
      const z = K.z + Math.cos(a) * K.size * 1.5;
      expect(L.field.height(x, z)).toBeGreaterThan(Config.world.waterLevel);
    }
  });

  it('puts arches on dry road, groves clear of the stops, and is the same each time', () => {
    const f = createHeightField(1337);
    const L = new EdenLayout(f, 1337);
    const a = new Countryside(L.field, L, 1337);
    const b = new Countryside(L.field, L, 1337);
    let arches = 0;
    let groves = 0;
    for (let j = -6; j <= 12; j++)
      for (let i = -8; i <= 8; i++) {
        const c = a.cell(i, j);
        expect(c).toEqual(b.cell(i, j));
        for (const A of c.arches) {
          arches++;
          expect(A.x).toBeGreaterThanOrEqual(i * CELL);
          expect(Math.abs(L.field.riverDist(A.x, A.z) - Config.highlands.roadOffset)).toBeLessThan(
            2,
          );
          expect(A.y).toBeGreaterThan(1);
        }
        for (const G of c.groves) {
          groves++;
          for (const S of [L.tal, L.hadar, L.venue, L.lake])
            expect(Math.hypot(G.x - S.x, G.z - S.z)).toBeGreaterThan(S.blend);
          // The bird glides over a tree's crown, not through it.
          const T = G.trees;
          expect(a.liftAt(T[0], T[2])).toBeGreaterThan(T[1] + 6);
        }
      }
    expect(arches).toBeGreaterThan(20);
    expect(groves).toBeGreaterThan(10);
  });
});
