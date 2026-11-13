import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { lerp, smoothstep } from '../../core/math';
import { mulberry32 } from '../noise';
import { painted } from '../Trees';
import { BEACON, CRYSTAL_H, spireProfile, type Ship, type SpireShape } from './RingmoonLayout';

/**
 * Ringmoon Shallows' shapes. Spires are lathed from the layout's profile in unit radius and
 * unit height (the instance scales and leans them), so collisions match the drawn stone. The
 * ship is built once in its own frame (+z along its length, +x across); the flora in metres.
 */

const BASALT = new THREE.Color('#4a4860');
const BASALT_DARK = new THREE.Color('#33324a');
const LICHEN = new THREE.Color('#c0904f');
const LICHEN_RUST = new THREE.Color('#9c5a3c');
const WET = new THREE.Color('#2a3340');
const CROWN = new THREE.Color('#7f8a9a');

/**
 * A basalt spire: a fluted column (never quite round: pulled in, never out, so the bird meets
 * the stone no later than drawn), dark slate with amber lichen gathered in bands at the
 * knuckles, wet and dark at the foot, paler at the crown.
 */
export function spireGeometry(
  sh: SpireShape,
  seed: number,
  SEG = 9,
  RINGS = 20,
): THREE.BufferGeometry {
  const rand = mulberry32(seed);
  const ph = rand() * 10;
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const c = new THREE.Color();
  for (let i = 0; i <= RINGS; i++) {
    // Rings bunch toward the crown, where the profile bends hardest.
    const u = i / RINGS;
    const t = Math.min(1 - Math.pow(1 - u, 1.35), 0.995);
    const rad = spireProfile(sh, t);
    const knuckle = Math.pow(Math.max(0, Math.sin(t * Math.PI * sh.knuckles)), 6);
    for (let k = 0; k < SEG; k++) {
      const a = (k / SEG) * Math.PI * 2;
      const flute =
        1 - 0.07 * Math.pow(Math.abs(Math.sin(a * 2.5 + ph)), 2) - 0.04 * (1 + Math.sin(a + ph));
      pos.push(Math.cos(a) * rad * flute, t, Math.sin(a) * rad * flute);
      c.copy(BASALT).lerp(
        BASALT_DARK,
        0.5 + 0.4 * Math.sin(a * 3 + ph + t * 9) * 0.6 + rand() * 0.15,
      );
      // Lichen settles on the knuckles and on the sunnier face.
      const lichen =
        knuckle * (0.55 + 0.35 * Math.sin(a + ph)) + 0.12 * Math.max(0, Math.sin(a - ph));
      c.lerp(rand() < 0.5 ? LICHEN : LICHEN_RUST, Math.min(1, lichen));
      c.lerp(WET, 1 - smoothstep(0.02, 0.08, t));
      c.lerp(CROWN, smoothstep(sh.crown - 0.05, 1, t) * 0.6);
      col.push(c.r, c.g, c.b);
    }
  }
  const apex = pos.length / 3;
  pos.push(0, 1, 0);
  col.push(CROWN.r, CROWN.g, CROWN.b);
  for (let i = 0; i < RINGS; i++)
    for (let k = 0; k < SEG; k++) {
      const a = i * SEG + k;
      const b = i * SEG + ((k + 1) % SEG);
      idx.push(a, a + SEG, b, b, a + SEG, b + SEG);
    }
  const last = RINGS * SEG;
  for (let k = 0; k < SEG; k++) idx.push(last + k, apex, last + ((k + 1) % SEG));
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

const SHELL = new THREE.Color('#e4dac2');
const SHELL_SHADE = new THREE.Color('#b8ab90');
const RIB = new THREE.Color('#6e5140');
const BELLY = new THREE.Color('#7f7b6c');
const SEAM = new THREE.Color('#3b2f2a');
const LEG = new THREE.Color('#5f4a3e');
const LEG_FOOT = new THREE.Color('#3c3a3a');

/**
 * Radius of the drawn hull's cross-section, as a share of the collision ellipsoid's, at
 * fraction s (-1..1) along it: a seed pod, pointed at both ends (always inside the ellipsoid,
 * whose share is sqrt(1 - s^2)).
 */
const pod = (s: number) => Math.pow(Math.max(0, 1 - s * s), 0.72);

/**
 * The ship: a long seed pod of weathered ivory shell, banded by dark ribs that stand proud of
 * it, darker and stained on the belly, a seam along its back where the shell has split. Four
 * plain legs splay from its underside to the sea floor. Built in the ship's frame, centred on
 * the hull (legs in world height relative to the hull's centre).
 */
export function shipGeometry(S: Ship): THREE.BufferGeometry {
  const RINGS = 44;
  const SEG = 20;
  const RIBS = 11;
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const c = new THREE.Color();
  for (let i = 0; i <= RINGS; i++) {
    const s = -1 + (2 * i) / RINGS;
    const rib = Math.pow(Math.abs(Math.cos(s * Math.PI * RIBS * 0.5)), 14);
    const k = pod(s) * (0.94 + 0.05 * rib);
    for (let j = 0; j < SEG; j++) {
      const phi = (j / SEG) * Math.PI * 2;
      const x = Math.cos(phi) * S.b * k;
      // The belly a little flatter than the back.
      const sy = Math.sin(phi);
      const y = sy * S.c * k * (sy < 0 ? 0.88 : 1);
      pos.push(x, y, s * S.a);
      c.copy(SHELL).lerp(SHELL_SHADE, 0.3 + 0.3 * Math.sin(phi * 3 + s * 7));
      c.lerp(BELLY, smoothstep(0.1, -0.7, sy));
      c.lerp(RIB, rib * 0.85);
      // The seam along the back.
      const seam = 1 - smoothstep(0.03, 0.1, Math.abs(phi - Math.PI / 2 + 0.04 * Math.sin(s * 23)));
      c.lerp(SEAM, seam * smoothstep(0.85, 0.5, Math.abs(s)));
      col.push(c.r, c.g, c.b);
    }
  }
  // The pointed ends close on the axis.
  const bow = pos.length / 3;
  pos.push(0, 0, S.a);
  col.push(RIB.r, RIB.g, RIB.b);
  const stern = bow + 1;
  pos.push(0, 0, -S.a);
  col.push(RIB.r, RIB.g, RIB.b);
  for (let i = 0; i < RINGS; i++)
    for (let j = 0; j < SEG; j++) {
      const a = i * SEG + j;
      const b = i * SEG + ((j + 1) % SEG);
      idx.push(a, b, a + SEG, b, b + SEG, a + SEG);
    }
  for (let j = 0; j < SEG; j++) {
    idx.push(RINGS * SEG + j, RINGS * SEG + ((j + 1) % SEG), bow);
    idx.push(j, stern, (j + 1) % SEG);
  }
  const hull = new THREE.BufferGeometry();
  hull.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  hull.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  hull.setIndex(idx);
  hull.computeVertexNormals();
  const parts: THREE.BufferGeometry[] = [hull.toNonIndexed()];
  // Legs, from the world segments into the ship's frame.
  const sn = Math.sin(S.yaw);
  const cs = Math.cos(S.yaw);
  const L = S.legs;
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  for (let k = 0; k < L.length; k += 6) {
    const local = (out: THREE.Vector3, x: number, y: number, z: number) => {
      const dx = x - S.x;
      const dz = z - S.z;
      return out.set(dx * cs - dz * sn, y - S.y, dx * sn + dz * cs);
    };
    local(a, L[k], L[k + 1], L[k + 2]);
    local(b, L[k + 3], L[k + 4], L[k + 5]);
    const len = a.distanceTo(b);
    const g = new THREE.CylinderGeometry(S.legR * 0.8, S.legR, len, 7, 4);
    // A joint ring two thirds of the way down, and a broad foot.
    const joint = new THREE.TorusGeometry(S.legR * 1.05, 0.55, 4, 8).rotateX(Math.PI / 2);
    joint.translate(0, -len * 0.18, 0);
    const foot = new THREE.CylinderGeometry(S.legR * 1.25, S.legR * 1.9, 2.4, 8).translate(
      0,
      -len / 2 + 1,
      0,
    );
    const leg = mergeGeometries(
      [g, joint, foot].map((p) =>
        painted(p, (_x, y, _z, out) => out.copy(LEG).lerp(LEG_FOOT, smoothstep(0, -len / 2, y))),
      ),
    )!;
    // Stand it along a -> b.
    const mid = a.clone().add(b).multiplyScalar(0.5);
    const dir = a.clone().sub(b).normalize();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);
    leg.applyQuaternion(q);
    leg.translate(mid.x, mid.y, mid.z);
    parts.push(leg);
  }
  return mergeGeometries(parts)!;
}

/**
 * What glows on the ship: a crack of light along the seam in its back, a row of nodes either
 * side of it, and one lamp under the belly. Drawn with a basic material whose colour turns HDR
 * after dark, so bloom halos it.
 */
export function shipGlowGeometry(S: Ship): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const pos: number[] = [];
  const N = 40;
  // The crack: a thin zigzag strip just proud of the seam.
  for (let i = 0; i < N; i++) {
    const s0 = -0.62 + (1.24 * i) / N;
    const s1 = -0.62 + (1.24 * (i + 1)) / N;
    const w0 = 0.6 + 0.5 * Math.abs(Math.sin(s0 * 19));
    const w1 = 0.6 + 0.5 * Math.abs(Math.sin(s1 * 19));
    const x0 = Math.sin(s0 * 23) * 0.9;
    const x1 = Math.sin(s1 * 23) * 0.9;
    const y0 = S.c * pod(s0) * 0.995 + 0.15;
    const y1 = S.c * pod(s1) * 0.995 + 0.15;
    pos.push(x0 - w0, y0, s0 * S.a, x1 - w1, y1, s1 * S.a, x1 + w1, y1, s1 * S.a);
    pos.push(x0 - w0, y0, s0 * S.a, x1 + w1, y1, s1 * S.a, x0 + w0, y0, s0 * S.a);
  }
  const crack = new THREE.BufferGeometry();
  crack.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  parts.push(crack);
  // Nodes along the back, on the ribs either side of the seam.
  for (let r = -4; r <= 4; r++) {
    const s = r / 5.5;
    const k = pod(s) * 0.99;
    for (const side of [1, -1]) {
      const phi = Math.PI / 2 + side * 0.55;
      const g = new THREE.IcosahedronGeometry(0.9, 0);
      g.translate(Math.cos(phi) * S.b * k, Math.sin(phi) * S.c * k, s * S.a);
      parts.push(g);
    }
  }
  const lamp = new THREE.IcosahedronGeometry(2.2, 1).scale(1, 0.5, 1);
  lamp.translate(0, -S.c * 0.88 - 0.4, 0);
  parts.push(lamp);
  for (const p of parts) {
    p.deleteAttribute('uv');
    if (!p.getAttribute('normal')) p.computeVertexNormals();
  }
  return mergeGeometries(parts)!;
}

const STALK = new THREE.Color('#2f7c74');
const STALK_DARK = new THREE.Color('#1f5a59');
const COIL = new THREE.Color('#d3c45c');

/** A tube of `sides` round a polyline of points, painted by a function of the share along it. */
function tube(
  pts: THREE.Vector3[],
  radius: (u: number) => number,
  sides: number,
  paint: (u: number, out: THREE.Color) => void,
): THREE.BufferGeometry {
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const c = new THREE.Color();
  const t = new THREE.Vector3();
  const n = new THREE.Vector3();
  const bn = new THREE.Vector3();
  const ref = new THREE.Vector3(1, 0, 0);
  for (let i = 0; i < pts.length; i++) {
    const u = i / (pts.length - 1);
    t.subVectors(pts[Math.min(i + 1, pts.length - 1)], pts[Math.max(i - 1, 0)]).normalize();
    n.crossVectors(t, ref);
    if (n.lengthSq() < 1e-4) n.crossVectors(t, new THREE.Vector3(0, 0, 1));
    n.normalize();
    bn.crossVectors(t, n).normalize();
    const r = radius(u);
    paint(u, c);
    for (let k = 0; k < sides; k++) {
      const a = (k / sides) * Math.PI * 2;
      const p = pts[i];
      pos.push(
        p.x + (n.x * Math.cos(a) + bn.x * Math.sin(a)) * r,
        p.y + (n.y * Math.cos(a) + bn.y * Math.sin(a)) * r,
        p.z + (n.z * Math.cos(a) + bn.z * Math.sin(a)) * r,
      );
      col.push(c.r, c.g, c.b);
    }
  }
  for (let i = 0; i < pts.length - 1; i++)
    for (let k = 0; k < sides; k++) {
      const a = i * sides + k;
      const b = i * sides + ((k + 1) % sides);
      idx.push(a, b, a + sides, b, b + sides, a + sides);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  return g.toNonIndexed();
}

/**
 * A coil frond: a stalk rising ~9 m with a lean, its top still rolled into a spiral like a
 * fern's fiddlehead, teal below and gold where it uncurls. `segs` sets the detail.
 */
export function coilGeometry(stalkSegs = 4, coilSegs = 7, sides = 4): THREE.BufferGeometry {
  const pts: THREE.Vector3[] = [];
  const H = 8;
  for (let i = 0; i <= stalkSegs; i++) {
    const u = i / stalkSegs;
    pts.push(new THREE.Vector3(1.2 * u * u, H * u, 0));
  }
  // The coil, in the stalk's plane, rolling over forward and in on itself.
  const top = pts[pts.length - 1];
  const R0 = 1.5;
  for (let i = 1; i <= coilSegs; i++) {
    const u = i / coilSegs;
    const ang = u * Math.PI * 1.7;
    const R = R0 * (1 - 0.6 * u);
    pts.push(new THREE.Vector3(top.x + R0 - Math.cos(ang) * R, top.y + Math.sin(ang) * R, 0));
  }
  const n = pts.length;
  const split = stalkSegs / (n - 1);
  const g = tube(
    pts,
    (u) => lerp(0.32, 0.12, u),
    sides,
    (u, out) =>
      out
        .copy(STALK_DARK)
        .lerp(STALK, smoothstep(0, split, u))
        .lerp(COIL, smoothstep(split * 0.9, 1, u)),
  );
  g.computeVertexNormals();
  return g;
}

const REED = new THREE.Color('#4f9a9a');
const REED_TIP = new THREE.Color('#d5f2e8');
const REED_BASE = new THREE.Color('#3b5f6e');

/**
 * A fan of glassy reeds: thin blades splaying out from one root, pale aqua toward their tips.
 * Both windings, so it reads from either side.
 */
export function reedGeometry(blades = 6): THREE.BufferGeometry {
  const pos: number[] = [];
  const col: number[] = [];
  const c = new THREE.Color();
  for (let i = 0; i < blades; i++) {
    const f = (i / (blades - 1)) * 2 - 1;
    const lean = f * 0.75;
    const h = 5.5 - Math.abs(f) * 1.6;
    const yaw = f * 0.5;
    const tip = [
      Math.sin(lean) * h * Math.cos(yaw),
      Math.cos(lean) * h,
      Math.sin(lean) * h * Math.sin(yaw),
    ];
    const w = 0.3;
    const bx = Math.cos(yaw) * w;
    const bz = -Math.sin(yaw) * w;
    const mid = [tip[0] * 0.5, tip[1] * 0.5, tip[2] * 0.5];
    const v = [
      [-bx, 0, -bz],
      [bx, 0, bz],
      [mid[0] + bx * 0.9, mid[1], mid[2] + bz * 0.9],
      [mid[0] - bx * 0.9, mid[1], mid[2] - bz * 0.9],
      tip,
    ];
    const us = [0, 0, 0.5, 0.5, 1];
    const tris = [
      [0, 1, 2],
      [0, 2, 3],
      [3, 2, 4],
    ];
    for (const flip of [false, true])
      for (const tr of tris) {
        const o = flip ? [tr[0], tr[2], tr[1]] : tr;
        for (const k of o) {
          pos.push(v[k][0], v[k][1], v[k][2]);
          c.copy(REED_BASE)
            .lerp(REED, smoothstep(0, 0.5, us[k]))
            .lerp(REED_TIP, smoothstep(0.5, 1, us[k]));
          col.push(c.r, c.g, c.b);
        }
      }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeVertexNormals();
  return g;
}

/** A glow pod: a small bulb (the instance sets its colour) on the islets, lit after dark. */
export function podGeometry(): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(0.7, 0).scale(1, 1.3, 1);
  g.deleteAttribute('uv');
  return g;
}

// --- Alien things: one family, ivory shell, copper, teal light ----------------------------------

const IVORY = new THREE.Color('#e8dfc8');
const IVORY_SHADE = new THREE.Color('#bdb096');
const COPPER = new THREE.Color('#c0703a');
const COPPER_DARK = new THREE.Color('#7a4026');
const STRUT = new THREE.Color('#5d5752');

/** Lander shell radius at fraction t of its height: a round-bottomed teardrop, pointed on top. */
const landerR = (t: number) =>
  2.5 * Math.pow(Math.max(0, Math.sin(Math.PI * Math.pow(t, 0.72))), 0.85);
/** The shell's base above the ground and its height (m, at scale 1). */
const LANDER_BASE = 2.1;
const LANDER_SHELL = 5.6;

/**
 * A landing pod: an upright teardrop of ivory shell on three thin splayed legs with round foot
 * pads, a copper band round its widest part with rivet bumps, and a short antenna with a copper
 * bulb. ~8.4 m tall at scale 1. The hatch's light is a separate mesh (`landerGlowGeometry`).
 */
export function landerGeometry(): THREE.BufferGeometry {
  const RINGS = 12;
  const SEG = 10;
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const c = new THREE.Color();
  for (let i = 0; i <= RINGS; i++) {
    const t = i / RINGS;
    const band = 1 - smoothstep(0.03, 0.06, Math.abs(t - 0.42));
    const r = landerR(t) * (1 + 0.04 * band);
    for (let k = 0; k < SEG; k++) {
      const a = (k / SEG) * Math.PI * 2;
      pos.push(Math.cos(a) * r, LANDER_BASE + t * LANDER_SHELL, Math.sin(a) * r);
      c.copy(IVORY).lerp(IVORY_SHADE, 0.35 + 0.3 * Math.sin(a * 2 + t * 5));
      c.lerp(COPPER, band).lerp(COPPER_DARK, smoothstep(0.25, 0, t) * 0.6);
      col.push(c.r, c.g, c.b);
    }
  }
  for (let i = 0; i < RINGS; i++)
    for (let k = 0; k < SEG; k++) {
      const a = i * SEG + k;
      const b = i * SEG + ((k + 1) % SEG);
      idx.push(a, a + SEG, b, b, a + SEG, b + SEG);
    }
  const shell = new THREE.BufferGeometry();
  shell.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  shell.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  shell.setIndex(idx);
  shell.computeVertexNormals();
  const parts: THREE.BufferGeometry[] = [shell.toNonIndexed()];
  const up = new THREE.Vector3(0, 1, 0);
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2 + 0.5;
    const top = new THREE.Vector3(Math.cos(a) * 1.6, LANDER_BASE + 0.9, Math.sin(a) * 1.6);
    const foot = new THREE.Vector3(Math.cos(a) * 3.4, 0.15, Math.sin(a) * 3.4);
    const len = top.distanceTo(foot);
    const leg = new THREE.CylinderGeometry(0.16, 0.22, len, 5);
    leg.applyQuaternion(
      new THREE.Quaternion().setFromUnitVectors(up, top.clone().sub(foot).normalize()),
    );
    leg.translate((top.x + foot.x) / 2, (top.y + foot.y) / 2, (top.z + foot.z) / 2);
    parts.push(painted(leg, (_x, _y, _z, out) => out.copy(STRUT)));
    const pad = new THREE.CylinderGeometry(0.55, 0.7, 0.3, 7).translate(foot.x, 0.15, foot.z);
    parts.push(painted(pad, (_x, _y, _z, out) => out.copy(COPPER_DARK)));
  }
  const top = LANDER_BASE + LANDER_SHELL;
  parts.push(
    painted(
      new THREE.CylinderGeometry(0.06, 0.08, 0.9, 4).translate(0, top + 0.35, 0),
      (_x, _y, _z, o) => o.copy(STRUT),
    ),
  );
  parts.push(
    painted(new THREE.IcosahedronGeometry(0.22, 0).translate(0, top + 0.85, 0), (_x, _y, _z, o) =>
      o.copy(COPPER),
    ),
  );
  for (let k = 0; k < 8; k++) {
    const a = (k / 8) * Math.PI * 2;
    const r = landerR(0.42) * 1.05;
    const g = new THREE.IcosahedronGeometry(0.16, 0).translate(
      Math.cos(a) * r,
      LANDER_BASE + 0.42 * LANDER_SHELL,
      Math.sin(a) * r,
    );
    parts.push(painted(g, (_x, _y, _z, o) => o.copy(COPPER_DARK)));
  }
  return mergeGeometries(parts)!;
}

/** A lander's hatch: a tall oval of light on its +z side, under the copper band. */
export function landerGlowGeometry(): THREE.BufferGeometry {
  const t = 0.3;
  const g = new THREE.SphereGeometry(1, 10, 8).scale(0.75, 1.15, 0.25);
  g.translate(0, LANDER_BASE + t * LANDER_SHELL, landerR(t) * 0.93);
  g.deleteAttribute('uv');
  return g;
}

/**
 * A beacon tower's mast (50 m at scale 1): a copper foot flaring into the ground, a slim
 * ivory mast with copper collars, up to a cradle under the tip. The rings and the tip light are
 * separate meshes (the rings turn, the tip pulses).
 */
export function beaconGeometry(): THREE.BufferGeometry {
  const H = BEACON.h;
  const parts: THREE.BufferGeometry[] = [];
  parts.push(
    painted(
      new THREE.CylinderGeometry(BEACON.mast * 1.2, BEACON.foot, H * 0.07, 8).translate(
        0,
        H * 0.035,
        0,
      ),
      (_x, y, _z, o) => o.copy(COPPER).lerp(COPPER_DARK, smoothstep(H * 0.07, 0, y)),
    ),
  );
  parts.push(
    painted(
      new THREE.CylinderGeometry(BEACON.mast * 0.45, BEACON.mast, H * 0.9, 7).translate(
        0,
        H * 0.5,
        0,
      ),
      (_x, y, _z, o) => o.copy(IVORY).lerp(IVORY_SHADE, 0.3 + 0.3 * Math.sin(y * 0.4)),
    ),
  );
  for (const t of [0.2, 0.38, 0.55, 0.9]) {
    const r = BEACON.mast * (1 - 0.55 * t) + 0.35;
    parts.push(
      painted(new THREE.CylinderGeometry(r, r, 0.7, 8).translate(0, H * t, 0), (_x, _y, _z, o) =>
        o.copy(COPPER),
      ),
    );
  }
  parts.push(
    painted(
      new THREE.CylinderGeometry(BEACON.tip * 0.9, 0.5, 1.6, 8).translate(0, H * 0.95 - 0.8, 0),
      (_x, _y, _z, o) => o.copy(COPPER_DARK),
    ),
  );
  return mergeGeometries(parts)!;
}

/**
 * One of a beacon's two rings, tilted off level: a copper hoop with ivory studs round it. Built
 * round the mast's axis so turning it about local y keeps it centred (its tilt wobbles as it
 * turns). `upper` picks the smaller, higher ring.
 */
export function beaconRingGeometry(upper: boolean): THREE.BufferGeometry {
  const R = upper ? BEACON.ring * 0.78 : BEACON.ring;
  const y = BEACON.h * (upper ? 0.8 : 0.67);
  const parts: THREE.BufferGeometry[] = [
    painted(new THREE.TorusGeometry(R - 0.35, 0.35, 5, 28).rotateX(Math.PI / 2), (_x, _y, _z, o) =>
      o.copy(COPPER),
    ),
  ];
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2;
    parts.push(
      painted(
        new THREE.IcosahedronGeometry(0.42, 0).translate(
          Math.cos(a) * (R - 0.35),
          0,
          Math.sin(a) * (R - 0.35),
        ),
        (_x, _y, _z, o) => o.copy(IVORY),
      ),
    );
  }
  const g = mergeGeometries(parts)!;
  g.rotateZ(upper ? -0.32 : 0.24);
  g.translate(0, y, 0);
  return g;
}

/** A beacon's tip light (the instance's colour pulses after dark). */
export function beaconTipGeometry(): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(BEACON.tip, 1).translate(0, BEACON.h * 0.97, 0);
  g.deleteAttribute('uv');
  return g;
}

const CRYSTAL_VIOLET = new THREE.Color('#8a5fd0');
const CRYSTAL_TEAL = new THREE.Color('#4fc7b8');
const CRYSTAL_TIP = new THREE.Color('#e9e2ff');

/**
 * A crystal cluster: six-sided shafts with pointed tips growing out of one spot at different
 * angles and heights (the tallest ~6 m at scale 1), violet or teal, paling to the tips.
 */
export function crystalGeometry(): THREE.BufferGeometry {
  const rand = mulberry32(77);
  const parts: THREE.BufferGeometry[] = [];
  const up = new THREE.Vector3(0, 1, 0);
  for (let k = 0; k < 6; k++) {
    const h = k === 0 ? CRYSTAL_H - 1 : 2 + rand() * 3;
    const r = 0.35 + 0.25 * (h / CRYSTAL_H);
    const shaft = new THREE.CylinderGeometry(r, r * 1.1, h, 6).translate(0, h / 2, 0);
    const tip = new THREE.ConeGeometry(r, r * 2.2, 6).translate(0, h + r * 1.1, 0);
    const teal = rand() < 0.4;
    const g = mergeGeometries(
      [shaft, tip].map((p) => {
        p.deleteAttribute('uv');
        return p.toNonIndexed();
      }),
    )!;
    const top = h + r * 2.2;
    painted(g, (_x, y, _z, o) =>
      o
        .copy(teal ? CRYSTAL_TEAL : CRYSTAL_VIOLET)
        .lerp(CRYSTAL_TIP, smoothstep(top * 0.5, top, y) * 0.7),
    );
    const lean = k === 0 ? 0.05 : 0.25 + rand() * 0.45;
    const a = rand() * Math.PI * 2;
    const dir = new THREE.Vector3(
      Math.sin(lean) * Math.cos(a),
      Math.cos(lean),
      Math.sin(lean) * Math.sin(a),
    );
    g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(up, dir));
    g.translate(Math.cos(a) * 0.6, 0, Math.sin(a) * 0.6);
    parts.push(g);
  }
  return mergeGeometries(parts)!;
}
