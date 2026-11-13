import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { lerp, smoothstep } from '../../core/math';
import { mulberry32 } from '../noise';
import { painted } from '../Trees';
import { spireProfile, type Ship, type SpireShape } from './RingmoonLayout';

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
