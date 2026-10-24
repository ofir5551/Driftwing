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
import { BLOCK, JerusalemLayout } from '../src/world/jerusalem/JerusalemLayout';
import { JerusalemWorld } from '../src/world/jerusalem/JerusalemWorld';
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
  it('ribbons never sit inside stone, and an autopilot flies them over the city and hills', () => {
    for (const seed of [42, 2024]) {
      const w = new JerusalemWorld(seed);
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
