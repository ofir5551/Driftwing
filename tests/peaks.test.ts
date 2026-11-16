import { describe, expect, it } from 'vitest';
import { Config } from '../src/core/Config';
import { MODES, PEAKS_KEYS } from '../src/audio/scales';
import { PeaksLayout, profile, SHAPES, Temple } from '../src/world/peaks/PeaksLayout';
import {
  K,
  PeaksScatter,
  placeLocal,
  PROP_STRIDE,
  type Dressing,
} from '../src/world/peaks/PeaksScatter';
import { ropeAt } from '../src/world/peaks/PeaksSites';
import { PeaksWorld } from '../src/world/peaks/PeaksWorld';
import { LEDGE_EPS, SKINS } from '../src/world/peaks/skin';
import { flyBot } from './helpers';

const L = new PeaksLayout(1337);

/** Every spire centred in a square around the origin. */
function spiresAround(layout: PeaksLayout, half: number) {
  const C = Config.peaks.spireCell;
  const out = [];
  for (let j = Math.floor(-half / C); j <= Math.floor(half / C); j++)
    for (let i = Math.floor(-half / C); i <= Math.floor(half / C); i++)
      out.push(...layout.cell(i, j));
  return out;
}

describe('peaks layout', () => {
  it('is deterministic per seed', () => {
    const a = new PeaksLayout(42);
    const b = new PeaksLayout(42);
    expect(a.cell(3, -2)).toEqual(b.cell(3, -2));
    expect(a.height(123, -456)).toBe(b.height(123, -456));
    expect(new PeaksLayout(43).cell(3, -2)).not.toEqual(a.cell(9, 9));
  });

  it('starts the bird over the cloud sea with a clear run to the Sky Gate and through it', () => {
    for (const seed of [1337, 42, 7, 2024]) {
      const l = new PeaksLayout(seed);
      const s = l.spawn;
      expect(s.y).toBeGreaterThan(l.height(s.x, s.z) + 25);
      for (let d = 0; d < 600; d += 3) {
        const x = s.x + Math.sin(s.yaw) * d;
        const z = s.z + Math.cos(s.yaw) * d;
        expect(l.solidTop(x, s.y, z, 3)).toBe(-Infinity);
        // Under the bridge too: the opening ribbon passes 26 m below its deck.
        expect(l.solidTop(x, Config.peaks.bridgeY - 30, z, 3)).toBe(-Infinity);
      }
      // The bridge spans the gap: solid at mid-span, anchored into both spires.
      const b = l.bridge;
      expect(l.solidTop(0, b.y - b.sag, b.z, 0)).toBeGreaterThan(b.y);
      for (const x of [b.x0 + 0.5, b.x1 - 0.5]) {
        const g = l.gate.find((p) => Math.sign(p.x) === Math.sign(x))!;
        expect(Math.abs(x - g.x)).toBeLessThan(l.axisAt(g, b.y));
      }
    }
  });

  it('raises plenty of spires out of the cloud, all under the ceiling', () => {
    const ps = spiresAround(L, 1500);
    expect(ps.length).toBeGreaterThan(150);
    for (const p of ps) {
      expect(p.top).toBeLessThan(Config.peaks.spireTop + 10);
      // The foot is hidden in the cloud sea.
      expect(p.y0).toBeLessThan(L.height(p.x, p.z) - 5);
    }
    expect(ps.filter((p) => p.y0 + p.h > 180).length).toBeGreaterThan(ps.length * 0.15);
    expect(ps.some((p) => p.temple === Temple.Hermitage)).toBe(true);
    expect(ps.filter((p) => p.temple === Temple.Monastery)).toHaveLength(1);
  });

  it('profiles columns that only narrow going up, closed by a summit', () => {
    for (const sh of SHAPES) {
      expect(profile(sh, 0)).toBeGreaterThan(1);
      expect(profile(sh, 0.999)).toBeLessThan(0.4);
      expect(profile(sh, 1)).toBe(0);
      for (let t = 0.06; t < 0.995; t += 0.005)
        expect(profile(sh, t + 0.005)).toBeLessThanOrEqual(profile(sh, t) + 1e-9);
    }
  });

  it('pushes a point out: sideways off a wall, up off a summit, out of the bridge', () => {
    const p = spiresAround(L, 800).find((q) => q.h > 150 && q.shape !== 4)!;
    const n = { x: 0, y: 0, z: 0 };
    const mid = p.y0 + p.h * 0.5;
    const r = L.axisAt(p, mid);
    const flank = { x: L.ax + r - 2, y: mid, z: L.az };
    expect(L.pushPoint(flank, 1, n)).toBeGreaterThan(0);
    expect(n.x).toBeGreaterThan(0.9);
    expect(L.solidTop(flank.x, flank.y, flank.z, 0.99)).toBe(-Infinity);
    const top = { x: p.x + p.lx, y: p.y0 + p.h - 1, z: p.z + p.lz };
    L.pushPoint(top, 1, n);
    expect(n.y).toBe(1);
    expect(top.y).toBeGreaterThanOrEqual(p.top);
    const b = L.bridge;
    const under = { x: 0, y: b.y - b.sag - 1, z: b.z };
    expect(L.pushPoint(under, 1, n)).toBeGreaterThan(0);
    expect(n.y).toBe(-1);
    expect(Number.isFinite(under.y)).toBe(true);
  });
});

describe('peaks wisps', () => {
  it('ribbons keep off the rock and the ropes, and an autopilot flies them among the spires', () => {
    for (const seed of [42, 2024]) {
      const w = new PeaksWorld(seed);
      const r = flyBot(
        w,
        w.layout.spawn,
        seed,
        120,
        (x, y, z) =>
          w.layout.solidTop(x, y, z, 0) !== -Infinity || w.layout.sites.ropeNear(x, y, z, 8),
      );
      expect(r.inside).toBe(0);
      expect(r.got).toBeGreaterThan(150);
      expect(r.glances).toBeLessThanOrEqual(2);
    }
  });
});

describe('peaks granite skin', () => {
  it('only cuts into the rock, so the collision profile stays outside what is drawn', () => {
    SKINS.forEach((sk, i) => {
      for (let t = 0; t < 1; t += 0.003)
        for (let a = 0; a < Math.PI * 2; a += 0.05) {
          const s = sk.skin(t, a);
          expect(s).toBeLessThanOrEqual(1.02);
          expect(s).toBeGreaterThan(0.6);
        }
      // Ledges and grooves close round the seam.
      for (let j = 0; j < sk.joints.length; j++)
        expect(sk.ledgeMask(j, 0.3)).toBeCloseTo(sk.ledgeMask(j, 0.3 + Math.PI * 2), 9);
      expect(sk.skin(0.5, 0.1)).toBeCloseTo(sk.skin(0.5, 0.1 + Math.PI * 2), 9);
      // The dome is untouched by the joints' lift, so the summit query still holds.
      expect(sk.lift(SHAPES[i].cap + 0.01, 1)).toBeCloseTo(0, 12);
    });
  });

  it('has ledges wide enough to hold things, and an alcove deep enough for a hut', () => {
    for (const sk of SKINS) {
      let wide = 0;
      for (const J of sk.joints)
        for (let a = 0; a < Math.PI * 2; a += 0.1)
          if (sk.skin(J.t - LEDGE_EPS, a) - sk.skin(J.t + LEDGE_EPS, a) > 0.05) wide++;
      expect(wide).toBeGreaterThan(10);
    }
    expect(SKINS.some((sk) => sk.alcove.joint >= 0)).toBe(true);
  });
});

describe('peaks life', () => {
  const sc = new PeaksScatter(L);
  const empty = (): Dressing => ({ trees: [], props: [], temples: [], lanterns: [], windows: [] });

  it('dresses the rock the same way every time', () => {
    const p = spiresAround(L, 600).find((q) => q.h > 150)!;
    const a = empty();
    const b = empty();
    sc.dress(p, a);
    new PeaksScatter(new PeaksLayout(1337)).dress(p, b);
    expect(a).toEqual(b);
    expect(new PeaksLayout(1337).sites.ropes(2, 3)).toEqual(L.sites.ropes(2, 3));
    expect(new PeaksLayout(1337).sites.flock(1, -1)).toEqual(L.sites.flock(1, -1));
  });

  it('keeps ledge cover, huts and dwarf pines on the rock, inside its solid envelope', () => {
    const out = empty();
    for (const p of spiresAround(L, 900)) sc.dress(p, out);
    const kinds = new Set<number>();
    let n = 0;
    for (let k = 0; k < out.props.length; k += PROP_STRIDE) {
      const kind = out.props[k];
      kinds.add(kind);
      if (kind === K.Step || kind === K.Post || kind === K.Pavilion) continue;
      // On a ledge or a summit: the rock the bird collides with is right there, so nothing
      // stands out in the open air where the bird would fly through it.
      const [x, y, z] = [out.props[k + 1], out.props[k + 2], out.props[k + 3]];
      expect(L.solidTop(x, y + 0.3, z, 2.5)).not.toBe(-Infinity);
      n++;
    }
    expect(n).toBeGreaterThan(2000);
    for (const kind of [K.Moss, K.Grass, K.Snow, K.Boulder, K.Hut, K.Dwarf, K.Pavilion])
      expect(kinds.has(kind)).toBe(true);
    // A hut's outer corners stay within the profile plus the bird's clearance.
    for (let k = 0; k < out.props.length; k += PROP_STRIDE) {
      if (out.props[k] !== K.Hut) continue;
      const s = out.props[k + 5];
      for (const lx of [-1.8, 1.8]) {
        const at = { x: lx, y: 1, z: 1.4 };
        const [x, y, z] = placeLocal(
          out.props[k + 1],
          out.props[k + 2],
          out.props[k + 3],
          out.props[k + 4],
          at,
          s,
        );
        expect(L.solidTop(x, y, z, Config.flight.clearance + 0.6)).not.toBe(-Infinity);
      }
    }
  });

  it('cuts the monastery stair round its spire, from the bridge deck up to the summit', () => {
    const S = L.sites.stair;
    const mon = L.gate.find((g) => g.temple === Temple.Monastery)!;
    expect(S.length / 4).toBeGreaterThan(100);
    expect(Math.abs(S[1] - L.bridge.y)).toBeLessThan(1);
    expect(S[S.length - 3]).toBeGreaterThan(mon.y0 + mon.h * 0.95);
    for (let k = 0; k < S.length; k += 4) {
      if (k > 0) expect(S[k + 1]).toBeGreaterThan(S[k - 3]);
      const r = L.axisAt(mon, S[k + 1]);
      const d = Math.hypot(S[k] - L.ax, S[k + 2] - L.az);
      expect(d - r).toBeGreaterThan(-1);
      expect(d - r).toBeLessThan(4);
    }
  });

  it('hangs ropes from rock to rock, clear of other spires, and keeps ribbons off them', () => {
    let ropes = 0;
    let bridges = 0;
    const m = { x: 0, y: 0, z: 0 };
    for (let j = -15; j <= 15; j++)
      for (let i = -15; i <= 15; i++)
        for (const r of L.sites.ropes(i, j)) {
          ropes++;
          if (r.kind === 0) bridges++;
          // Both ends are anchored in stone; the middle hangs in the open.
          expect(L.solidTop(r.x0, r.y0, r.z0, 0.5)).not.toBe(-Infinity);
          expect(L.solidTop(r.x1, r.y1, r.z1, 0.5)).not.toBe(-Infinity);
          ropeAt(r, 0.5, m);
          expect(L.solidTop(m.x, m.y, m.z, 2)).toBe(-Infinity);
          // No planned path may pass near it.
          expect(L.clear(m.x, m.y + 4, m.z, 3, 3)).toBe(false);
          expect(L.sites.ropeNear(m.x, m.y + Config.peaks.ropeClear + 1, m.z, 9)).toBe(false);
        }
    expect(bridges).toBeGreaterThan(5);
    expect(ropes - bridges).toBeGreaterThan(5);
  });

  it('flies cranes on circles clear over every summit', () => {
    let flocks = 0;
    for (let j = -4; j <= 4; j++)
      for (let i = -4; i <= 4; i++) {
        const f = L.sites.flock(i, j);
        if (!f) continue;
        flocks++;
        expect(f.y).toBeLessThan(Config.flight.maxAltitude);
        for (let k = 0; k < 64; k++) {
          const a = (k / 64) * Math.PI * 2;
          // The V spreads up to ~12 m either side of the track and bobs 3 m.
          for (const dr of [-12, 0, 12]) {
            const x = f.x + Math.cos(a) * (f.r + dr);
            const z = f.z + Math.sin(a) * (f.r + dr);
            expect(L.solidTop(x, f.y - 3, z, 6)).toBe(-Infinity);
          }
        }
      }
    expect(flocks).toBeGreaterThan(20);
  });

  it('opens gaps in the cloud sea only out on the open sea, the bird still flying over them', () => {
    let gaps = 0;
    for (let j = -8; j <= 8; j++)
      for (let i = -8; i <= 8; i++) {
        const g = L.gap(i, j);
        if (!g) continue;
        gaps++;
        expect(L.gapAt(g.x, g.z)).toBe(1);
        expect(L.surface(g.x, g.z)).toBeCloseTo(Config.peaks.gapFloor, 5);
        expect(L.height(g.x, g.z)).toBeGreaterThan(Config.peaks.cloud - 20);
        // No spire's foot stands in the opening or on its rim.
        expect(L.skyline(g.x, g.z, g.r * 1.15 + 12)).toBe(-Infinity);
      }
    expect(gaps).toBeGreaterThan(20);
    // The home gap beside the opening glide.
    const s = L.spawn;
    const [hx, hz] = Config.peaks.gapHome;
    expect(L.gapAt(s.x + hx, s.z + hz)).toBe(1);
  });
});

describe('peaks music', () => {
  it('floats on lydian at sunrise, one key per time of day', () => {
    expect(MODES.lydianPenta).toEqual([0, 2, 4, 6, 9]);
    expect(PEAKS_KEYS).toHaveLength(5);
    expect(PEAKS_KEYS[0].mode).toBe('lydianPenta');
  });
});
