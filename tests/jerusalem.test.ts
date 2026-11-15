import { describe, expect, it } from 'vitest';
import { JERUSALEM_KEYS, MODES } from '../src/audio/scales';
import {
  JERUSALEM_MUSIC,
  CITY_MUSIC,
  FJORD_MUSIC,
  HIGHLANDS_MUSIC,
  KARST_MUSIC,
} from '../src/audio/styles';
import { Config } from '../src/core/Config';
import type { CoverTuft } from '../src/world/GroundCover';
import { jerusalemCover } from '../src/world/jerusalem/cover';
import {
  BLOCK,
  FIELD,
  JerusalemLayout,
  MESH,
  STYLE,
  TREE,
} from '../src/world/jerusalem/JerusalemLayout';
import { JerusalemScatter } from '../src/world/jerusalem/JerusalemScatter';
import { JerusalemWorld } from '../src/world/jerusalem/JerusalemWorld';
import { habitat } from '../src/world/jerusalem/land';
import { PROP, PROP_HEIGHT, PROP_RADIUS, PROP_STRIDE } from '../src/world/jerusalem/props';
import { TREE_STRIDE } from '../src/world/Trees';
import { flyBot } from './helpers';

const L = new JerusalemLayout(1337);

/** Every solid centred in a square around the origin. */
function solidsAround(layout: JerusalemLayout, half: number) {
  const out = [];
  for (let j = Math.floor(-half / BLOCK); j <= Math.floor(half / BLOCK); j++)
    for (let i = Math.floor(-half / BLOCK); i <= Math.floor(half / BLOCK); i++)
      out.push(...layout.block(i, j).solids);
  return out;
}

describe('jerusalem layout', () => {
  it('is deterministic per seed', () => {
    const a = new JerusalemLayout(42);
    const b = new JerusalemLayout(42);
    expect(a.spawn).toEqual(b.spawn);
    expect(a.block(3, -2)).toEqual(b.block(3, -2));
    expect(a.block(30, 41)).toEqual(b.block(30, 41));
    expect(a.height(1234, -4567)).toBe(b.height(1234, -4567));
  });

  it('starts the bird on the Mount of Olives, facing the Old City with a clear run ahead', () => {
    for (const seed of [1337, 42, 7, 2024]) {
      const l = new JerusalemLayout(seed);
      const s = l.spawn;
      expect(s.y - l.ground(s.x, s.z)).toBeGreaterThan(8);
      for (let d = 0; d < 200; d += 3) {
        const x = s.x + Math.sin(s.yaw) * d;
        const z = s.z + Math.cos(s.yaw) * d;
        expect(l.ground(x, z)).toBeLessThan(s.y - 6);
        expect(l.solidTop(x, s.y, z, 3)).toBe(-Infinity);
      }
      // The Old City lies ahead, the golden dome taller than the walls round it.
      expect(l.inOldCity(s.x + Math.sin(s.yaw) * 450, s.z + Math.cos(s.yaw) * 450)).toBe(true);
    }
  });

  it('lays the Old City on its plateau, the Kidron below its east wall, Olives beyond', () => {
    const inside = L.height(0, 0);
    expect(Math.abs(inside - L.plateau(0, 0))).toBeLessThan(0.01);
    expect(L.height(-210, -120)).toBeCloseTo(L.platformY, 3);
    // The Kidron's floor is far below the wall; the Mount of Olives rises above the city.
    expect(L.height(-450, -60)).toBeLessThan(inside - 30);
    expect(L.height(-780, 0)).toBeGreaterThan(inside + 20);
    // The Hinnom between the new city and the walls.
    expect(L.height(425, -40)).toBeLessThan(inside - 20);
    // Never down to the water: this is hill country.
    for (let k = 0; k < 400; k++) {
      const x = Math.sin(k * 1.7) * 3000 * (k / 400);
      const z = Math.cos(k * 2.3) * 3000 * (k / 400);
      expect(L.height(x, z)).toBeGreaterThan(Config.world.waterLevel + 8);
    }
  });

  it('builds walls and landmarks that are solid, and keeps every solid within a block of reach', () => {
    const ss = solidsAround(L, 900);
    expect(ss.length).toBeGreaterThan(150);
    for (const s of ss) expect(s.reach).toBeLessThan(BLOCK);
    const D = L.dome;
    expect(L.solidTop(D.x, D.top - 2, D.z, 0)).toBeGreaterThan(D.top - 1);
    // The walls stand a storey or more above the roofs inside.
    const wallTop = L.solidTop(-300, L.plateau(-300, 200) + 8, 200, 1);
    expect(wallTop).toBeGreaterThan(L.ground(-280, 200));
    // Hill towns far out raise minarets and bell towers too.
    let far = 0;
    for (let j = 20; j < 40; j++)
      for (let i = 20; i < 40; i++) far += L.block(i, j).landmarks.length;
    expect(far).toBeGreaterThan(3);
  });

  it('pushes a point out of stone: sideways off a wall or tower, up off a dome', () => {
    const n = { x: 0, y: 0, z: 0 };
    // The east wall at x = -300: a point just inside its outer face leaves eastward (-x).
    const y = L.plateau(-300, 200) + 6;
    const p = { x: -301, y, z: 200 };
    expect(L.pushPoint(p, 1, n)).toBeGreaterThan(0);
    expect(n.x).toBeLessThan(-0.9);
    expect(L.solidTop(p.x, p.y, p.z, 0.99)).toBe(-Infinity);
    // Into the golden dome from above: out upward.
    const D = L.dome;
    const top = { x: D.x + 2, y: D.top - 1.5, z: D.z };
    L.pushPoint(top, 1, n);
    expect(n.y).toBe(1);
    expect(L.solidTop(top.x, top.y, top.z, 0.99)).toBe(-Infinity);
    // Never a NaN, wherever the point starts.
    for (const s of solidsAround(L, 400)) {
      const q = { x: s.x, y: (s.y0 + s.top) / 2, z: s.z };
      L.pushPoint(q, 1.6, n);
      expect(Number.isFinite(q.x + q.y + q.z)).toBe(true);
    }
  });
});

describe('jerusalem wisps', () => {
  it('ribbons never sit inside stone or a prop, and an autopilot flies them over city and hills', () => {
    for (const seed of [42, 2024]) {
      const w = new JerusalemWorld(seed);
      const S = new JerusalemScatter(w.layout);
      const cache = new Map<string, [number[], number[]]>();
      /** Inside a prop's cylinder (a metre's margin), rooftop clutter and stalls included. */
      const inProp = (x: number, y: number, z: number) => {
        const lists = [chunkProps(S, cache, Math.floor(x / SIZE), Math.floor(z / SIZE))[0]];
        lists.push(w.layout.block(Math.floor(x / BLOCK), Math.floor(z / BLOCK)).props);
        for (const P of lists)
          for (let k = 0; k < P.length; k += PROP_STRIDE) {
            const kind = P[k];
            const r = PROP_RADIUS[kind] * Math.max(P[k + 6], P[k + 8]) + 1;
            if (kind === PROP.Wall) continue; // low: under any ribbon (checked by height below)
            if ((x - P[k + 1]) ** 2 + (z - P[k + 3]) ** 2 > r * r) continue;
            if (y < P[k + 2] + PROP_HEIGHT[kind] * P[k + 7] + 1) return true;
          }
        return false;
      };
      const r = flyBot(
        w,
        w.layout.spawn,
        seed,
        120,
        (x, y, z) =>
          w.layout.solidTop(x, y, z, 0) !== -Infinity ||
          y < w.layout.height(x, z) + 4 ||
          inProp(x, y, z),
      );
      expect(r.inside).toBe(0);
      expect(r.got).toBeGreaterThan(150);
      expect(r.glances).toBeLessThanOrEqual(2);
    }
  });
});

const SIZE = 160;
/** The country's props and road cypresses of chunk (cx, cz), scattered once per layout. */
function chunkProps(
  S: JerusalemScatter,
  cache: Map<string, [number[], number[]]>,
  cx: number,
  cz: number,
) {
  const k = `${cx},${cz}`;
  let hit = cache.get(k);
  if (!hit) {
    hit = [[], []];
    S.scatter(cx * SIZE, cz * SIZE, SIZE, hit[0], hit[1]);
    cache.set(k, hit);
  }
  return hit;
}

/** The ground the props stand on: the hills east of the city, the new city, the far hills. */
const CHUNKS: [number, number][] = [];
for (let cz = -3; cz <= 3; cz++) for (let cx = -7; cx <= 13; cx += 2) CHUNKS.push([cx, cz]);

describe('jerusalem country', () => {
  const S = new JerusalemScatter(L);
  const cache = new Map<string, [number[], number[]]>();
  const all: number[] = [];
  const lined: number[] = [];
  for (const [cx, cz] of CHUNKS) {
    const [p, t] = chunkProps(S, cache, cx, cz);
    all.push(...p);
    lined.push(...t);
  }
  const count = (kind: number) => {
    let n = 0;
    for (let k = 0; k < all.length; k += PROP_STRIDE) if (all[k] === kind) n++;
    return n;
  };

  it('scatters the same country for the same seed, whatever the order', () => {
    const a = new JerusalemScatter(new JerusalemLayout(42));
    const b = new JerusalemScatter(new JerusalemLayout(42));
    const pa: number[] = [];
    const ta: number[] = [];
    const pb: number[] = [];
    const tb: number[] = [];
    a.scatter(1600, -320, SIZE, pa, ta);
    b.scatter(160, 160, SIZE, pb, tb); // another chunk first: no state leaks between them
    b.scatter(1600, -320, SIZE, pb, tb);
    expect(pb).toEqual(pa);
    expect(tb).toEqual(ta);
    expect(pa.length).toBeGreaterThan(0);
  });

  it('fills the hills: terrace and field walls, rocks, garrigue, oleanders, flocks, cypresses', () => {
    expect(count(PROP.Wall)).toBeGreaterThan(400);
    expect(count(PROP.Outcrop) + count(PROP.Boulder)).toBeGreaterThan(100);
    expect(count(PROP.Scrub)).toBeGreaterThan(300);
    expect(count(PROP.Oleander)).toBeGreaterThan(10);
    expect(count(PROP.Goat) + count(PROP.Sheep)).toBeGreaterThan(20);
    expect(lined.length / TREE_STRIDE).toBeGreaterThan(10);
    for (let k = 0; k < lined.length; k += TREE_STRIDE) expect(lined[k]).toBe(TREE.CYPRESS);
  });

  it('keeps props and trees off the roads and paths, out of the stone and on the ground', () => {
    for (let k = 0; k < all.length; k += PROP_STRIDE) {
      const kind = all[k];
      const x = all[k + 1];
      const y = all[k + 2];
      const z = all[k + 3];
      if (kind === PROP.Swift) continue;
      L.track(x, z);
      if (kind === PROP.Wall) expect(L.roadE).toBeGreaterThan(0);
      else {
        expect(L.roadE).toBeGreaterThan(0.5);
        expect(L.pathE).toBeGreaterThan(0);
      }
      const top = y + PROP_HEIGHT[kind] * all[k + 7];
      expect(L.solidTop(x, (y + top) / 2, z, 0)).toBe(-Infinity);
      // Standing on (or set into) the ground, never floating (a wall follows its run's slope).
      expect(y).toBeLessThan(L.height(x, z) + (kind === PROP.Wall ? 0.8 : 0.2));
    }
    for (let k = 0; k < lined.length; k += TREE_STRIDE) {
      L.track(lined[k + 1], lined[k + 3]);
      expect(L.roadE).toBeGreaterThan(1);
    }
    for (let j = 18; j < 30; j++)
      for (let i = -12; i < 12; i++) {
        const T = L.block(i, j).trees;
        for (let k = 0; k < T.length; k += TREE_STRIDE) {
          L.track(T[k + 1], T[k + 3]);
          expect(L.roadE).toBeGreaterThan(1);
          expect(L.fieldAt(T[k + 1], T[k + 3])).toBe(-1);
        }
      }
  });

  it('walls stand on the terrace risers or round the walled fields', () => {
    const fc = { u: 0, w: 0 };
    let terrace = 0;
    let field = 0;
    for (let k = 0; k < all.length; k += PROP_STRIDE) {
      if (all[k] !== PROP.Wall) continue;
      const x = all[k + 1];
      const z = all[k + 3];
      L.fieldCoords(x, z, fc);
      const eu = Math.abs(fc.u - Math.round(fc.u));
      const ew = Math.abs(fc.w - Math.round(fc.w));
      const onEdge = Math.min(eu, ew) * Config.jerusalem.fieldCell < 0.5;
      if (onEdge && (L.fieldAt(x + 1, z + 1) >= 0 || L.fieldAt(x - 1, z - 1) >= 0)) field++;
      else {
        L.at(x, z);
        expect(L.terrace).toBeGreaterThan(0.3);
        terrace++;
      }
    }
    expect(terrace).toBeGreaterThan(200);
    expect(field).toBeGreaterThan(20);
  });

  it('lines houses along the roads, never on them, with life on the roofs and stalls', () => {
    let houses = 0;
    let roofs = 0;
    let stalls = 0;
    for (let j = -30; j < 30; j++)
      for (let i = 12; i < 40; i++) {
        const b = L.block(i, j);
        const P = b.parts;
        for (let k = 0; k < P.length; k += 11) {
          if (P[k] !== MESH.BOX || (P[k + 9] !== STYLE.HOUSE && P[k + 9] !== STYLE.FLATS)) continue;
          houses++;
          L.track(P[k + 1], P[k + 3]);
          expect(L.roadE).toBeGreaterThan(Math.max(P[k + 4], P[k + 6]) * 0.5);
        }
        for (let k = 0; k < b.props.length; k += PROP_STRIDE) {
          if (b.props[k] === PROP.Awning) {
            stalls++;
            L.track(b.props[k + 1], b.props[k + 3]);
            expect(L.roadE).toBeGreaterThan(0);
          } else roofs++;
        }
      }
    expect(houses).toBeGreaterThan(200);
    expect(roofs).toBeGreaterThan(50);
    expect(stalls).toBeGreaterThan(3);
    // The Old City's souks are lined with stalls; its flat roofs carry tanks and washing.
    let souk = 0;
    for (let j = -6; j <= 5; j++)
      for (let i = -6; i <= 6; i++) {
        const b = L.block(i, j);
        for (let k = 0; k < b.props.length; k += PROP_STRIDE)
          if (b.props[k] === PROP.Awning) souk++;
      }
    expect(souk).toBeGreaterThan(40);
  });

  it('grows dry grass, thyme and anemones; leaves roads, beds, risers and plough bare', () => {
    const style = jerusalemCover(L);
    const tuft = (road: number, path: number, bed: number, hab: number): CoverTuft => ({
      r: 0.5,
      g: 0.45,
      b: 0.3,
      scale: 1,
      bare: false,
      bloom: -1,
      petal: -1,
      extra: road,
      extras: [road, path, bed, hab],
      shape: 0,
    });
    const K = Config.jerusalem;
    const bare = (t: CoverTuft, x = 5000.5, z = 5000.5, y = 80) => {
      style.paint!(x, z, y, t);
      return t.bare;
    };
    expect(bare(tuft(0, 30, 40, 0))).toBe(true); // a road
    expect(bare(tuft(40, 0.5, 40, 0))).toBe(true); // a path
    expect(bare(tuft(40, 30, 1, 0))).toBe(true); // the pebble bed
    expect(bare(tuft(40, 30, 40, -1))).toBe(true); // paved, built
    // Terraces: grass and anemones on the flats, the risers bare.
    const flat = tuft(40, 30, 40, 1);
    expect(bare(flat, 5000.5, 5000.5, K.terraceStep * 20)).toBe(false);
    expect(flat.bloom).toBeGreaterThan(0);
    expect(bare(tuft(40, 30, 40, 1), 5000.5, 5000.5, K.terraceStep * 20.5)).toBe(true);
    // The plough is bare, stubble short.
    let seen = 0;
    const pt = { x: 0, z: 0 };
    for (let j = -60; j < 60 && seen < 2; j++)
      for (let i = -60; i < 60; i++) {
        const kind = L.fieldKind(i, j);
        if (kind !== FIELD.PLOUGH && kind !== FIELD.STUBBLE) continue;
        L.fieldPoint(i + 0.5, j + 0.5, pt);
        const t = tuft(40, 30, 40, 0);
        style.paint!(pt.x, pt.z, 60, t);
        if (kind === FIELD.PLOUGH) expect(t.bare).toBe(true);
        else expect([t.bare, t.scale < 1, t.bloom]).toEqual([false, true, 0]);
        seen++;
      }
    expect(seen).toBeGreaterThan(0);
    // Built and paved ground is habitat -1 (bare), the terraces positive.
    L.at(0, 0);
    expect(habitat(L, 0, 0)).toBe(-1);
  });
});

describe('jerusalem music', () => {
  it('plays maqam colours on an oud over a frame drum, unlike any other level', () => {
    expect(MODES.hijaz).toEqual([0, 1, 4, 5, 7]);
    expect(JERUSALEM_KEYS).toHaveLength(5);
    expect(JERUSALEM_MUSIC.voice).toBe('oud');
    expect(JERUSALEM_MUSIC.beat).toBe('maqsum');
    for (const o of [HIGHLANDS_MUSIC, CITY_MUSIC, KARST_MUSIC, FJORD_MUSIC])
      expect(o.bpm === JERUSALEM_MUSIC.bpm && o.voice === JERUSALEM_MUSIC.voice).toBe(false);
  });
});
