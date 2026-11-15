import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { smoothstep } from '../../core/math';
import { hipGeometry } from '../city/geometry';
import { mulberry32 } from '../noise';
import { colored, painted } from '../Trees';
import { canoeParts } from './geometry';
import { HUT_FLOOR } from './AtollLayout';

/**
 * Coral Atolls' lived-in props, in metres: the village's stilt huts, fishing nets on poles,
 * cooking fires, coral heads on the lagoon floor, and the animated life (a paddled canoe,
 * schools of fish, turtles, rays, seabirds), whose motion lives in the vertex shader keyed by
 * `aAnim` (materials.ts). Everything that moves faces +z.
 */

/** Set a constant `aAnim` (kind, weight) on a part, or a weight from its vertex position. */
export function anim(
  g: THREE.BufferGeometry,
  kind: number,
  weight: number | ((x: number, y: number, z: number) => number) = 0,
): THREE.BufferGeometry {
  const pos = g.getAttribute('position');
  const a = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    a[i * 2] = kind;
    a[i * 2 + 1] =
      typeof weight === 'number' ? weight : weight(pos.getX(i), pos.getY(i), pos.getZ(i));
  }
  g.setAttribute('aAnim', new THREE.BufferAttribute(a, 2));
  return g;
}

/** A flat triangle list (both windings when `both`), one colour per vertex from `col`. */
function tris(
  pts: number[],
  col: (x: number, y: number, z: number, out: THREE.Color) => void,
  both = true,
): THREE.BufferGeometry {
  const pos = both ? [...pts] : pts;
  if (both)
    for (let k = 0; k < pts.length; k += 9)
      pos.push(...pts.slice(k, k + 3), ...pts.slice(k + 6, k + 9), ...pts.slice(k + 3, k + 6));
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return painted(g, col);
}

const WOOD = '#6b5843';
const PLANK = '#a68a66';
const WEAVE = new THREE.Color('#cfae7c');
const WEAVE_DARK = new THREE.Color('#a9875a');
const THATCH = new THREE.Color('#cfa968');
const THATCH_DARK = new THREE.Color('#94713f');

/**
 * A stilt hut (~230 triangles): six posts from the lagoon floor to a plank floor at
 * HUT_FLOOR, walls of woven pandanus, a tall thatched roof flaring at the eaves (ridge at
 * HUT_TOP), a porch on the door side (+z) with a ladder down to the water. On land the same
 * hut stands on short stilts in the sand.
 */
export function stiltHutGeometry(): THREE.BufferGeometry {
  const F = HUT_FLOOR;
  const parts: THREE.BufferGeometry[] = [];
  for (const x of [-2, 2])
    for (const z of [-2.3, 0, 2.3])
      parts.push(
        colored(new THREE.BoxGeometry(0.22, F + 8, 0.22), WOOD, (F - 8) / 2).translate(x, 0, z),
      );
  for (const x of [-1.4, 1.4])
    parts.push(
      colored(new THREE.BoxGeometry(0.18, F + 8, 0.18), WOOD, (F - 8) / 2).translate(x, 0, 3.9),
    );
  parts.push(
    colored(new THREE.BoxGeometry(4.8, 0.24, 5.6), PLANK, F - 0.12),
    colored(new THREE.BoxGeometry(3.2, 0.18, 1.7), PLANK, F - 0.1).translate(0, 0, 3.6),
    // Woven walls: light and dark bands of the weave.
    painted(new THREE.BoxGeometry(4.0, 2.1, 4.6), (_x, y, _z, o) =>
      o.copy(WEAVE).lerp(WEAVE_DARK, 0.5 + 0.5 * Math.sin(y * 9)),
    ).translate(0, F + 1.05, 0),
    colored(new THREE.PlaneGeometry(1.0, 1.6), '#3b2f25', F + 0.8).translate(0, 0, 2.31),
    colored(new THREE.PlaneGeometry(0.9, 0.6).rotateY(Math.PI / 2), '#3b2f25', F + 1.3).translate(
      2.01,
      0,
      0,
    ),
    colored(new THREE.PlaneGeometry(0.9, 0.6).rotateY(-Math.PI / 2), '#3b2f25', F + 1.3).translate(
      -2.01,
      0,
      0,
    ),
    // Thatch: darker at the eaves and in long streaks down the pitch.
    painted(hipGeometry(0.45).scale(5.8, 2.55, 6.8), (x, y, z, o) =>
      o
        .copy(THATCH_DARK)
        .lerp(THATCH, smoothstep(0, 0.9, y) * (0.85 + 0.15 * Math.sin(x * 7 + z * 5))),
    ).translate(0, F + 2.05, 0),
  );
  // The ladder from the porch down into the water.
  for (const x of [-0.35, 0.35])
    parts.push(colored(new THREE.BoxGeometry(0.08, 2.8, 0.08), WOOD, F - 1.4).translate(x, 0, 4.5));
  for (let k = 0; k < 3; k++)
    parts.push(
      colored(new THREE.BoxGeometry(0.7, 0.06, 0.06), WOOD, F - 0.5 - k * 0.6).translate(0, 0, 4.5),
    );
  return mergeGeometries(parts)!;
}

/** Where a hut's lantern hangs (local metres, at scale 1): under the eaves over the porch. */
export const HUT_LANTERN = { x: 1.3, y: HUT_FLOOR + 1.9, z: 3.0 };

/**
 * A fishing net on poles in the shallows (~70 triangles), along local x: five poles driven
 * into the sand, the net hung between them from a sagging top rope with white floats.
 */
export function netGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const xs = [-6, -3, 0, 3, 6];
  for (const x of xs)
    parts.push(
      colored(new THREE.CylinderGeometry(0.06, 0.08, 3.4, 4, 1, true), '#7a6248', 0).translate(
        x,
        0,
        0,
      ),
    );
  const top = (x: number) => 0.85 - 0.22 * Math.sin(((x + 6) / 3) * Math.PI) ** 2;
  const pts: number[] = [];
  for (let k = 0; k < 8; k++) {
    const x0 = -6 + k * 1.5;
    const x1 = x0 + 1.5;
    // The net: dark mesh from the rope down into the water; a lighter rope along its top.
    pts.push(x0, top(x0), 0, x0, -0.6, 0, x1, -0.6, 0, x0, top(x0), 0, x1, -0.6, 0, x1, top(x1), 0);
    pts.push(x0, top(x0) + 0.05, 0, x0, top(x0) - 0.05, 0, x1, top(x1) - 0.05, 0);
    pts.push(x0, top(x0) + 0.05, 0, x1, top(x1) - 0.05, 0, x1, top(x1) + 0.05, 0);
  }
  parts.push(tris(pts, (_x, _y, _z, o) => o.set('#55524a')));
  for (let k = 0; k < 7; k++) {
    const x = -5.25 + k * 1.75;
    parts.push(
      colored(new THREE.TetrahedronGeometry(0.13, 0), '#f1ece0', top(x) + 0.02).translate(x, 0, 0),
    );
  }
  return mergeGeometries(parts)!;
}

/** A cooking fire on the sand (~60 triangles): a ring of stones round charred logs. */
export function firePitGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 7; k++) {
    const a = (k / 7) * Math.PI * 2;
    parts.push(
      colored(new THREE.TetrahedronGeometry(0.24, 0), k % 2 ? '#8d8a80' : '#77746b', 0.08)
        .rotateY(a * 3)
        .translate(Math.cos(a) * 0.75, 0, Math.sin(a) * 0.75),
    );
  }
  for (const a of [0.3, 1.4, 2.6])
    parts.push(
      colored(new THREE.BoxGeometry(1.1, 0.16, 0.16), '#3a2e26', 0.12)
        .rotateZ(0.25)
        .rotateY(a),
    );
  return mergeGeometries(parts)!;
}

/** Where a fire's embers glow (a lantern instance), local metres. */
export const FIRE_EMBERS = { x: 0, y: 0.25, z: 0 };

/**
 * An outrigger canoe out paddling (~130 triangles): the moored canoe's hull, float and booms
 * with a paddler kneeling amidships whose paddle (aAnim weight 1) strokes fore and aft.
 * aAnim kind 5: the shader moves it round its circle on the lagoon.
 */
export function paddleCanoeGeometry(): THREE.BufferGeometry {
  const parts = canoeParts().map((g) => anim(g, 5));
  parts.push(
    anim(colored(new THREE.BoxGeometry(0.42, 0.62, 0.3), '#d4643c', 0.72).translate(0, 0, 0.4), 5),
    anim(colored(new THREE.IcosahedronGeometry(0.15, 0), '#7b5236', 1.2).translate(0, 0, 0.42), 5),
    anim(colored(new THREE.IcosahedronGeometry(0.12, 0), '#2a211c', 1.27).translate(0, 0, 0.38), 5),
    // The paddle, held across the body and dipping on the left (away from the float).
    anim(
      colored(new THREE.BoxGeometry(0.05, 1.7, 0.05), '#b48a58', 0)
        .rotateZ(0.5)
        .translate(-0.55, 0.55, 0.45),
      5,
      1,
    ),
    anim(
      colored(new THREE.BoxGeometry(0.04, 0.5, 0.2), '#a07a4c', 0)
        .rotateZ(0.5)
        .translate(-0.95, -0.15, 0.45),
      5,
      1,
    ),
  );
  return mergeGeometries(parts)!;
}

/**
 * A school of fish (~130 triangles): 22 slim fish, silver-blue with yellow tails, in a loose
 * shoal about 7 m long. aAnim kind 2; weight = how far down the fish's body (the tail beats).
 */
export function fishSchoolGeometry(): THREE.BufferGeometry {
  const rand = mulberry32(77);
  const pts: number[] = [];
  const w: number[] = [];
  for (let k = 0; k < 22; k++) {
    const cx = (rand() - 0.5) * 3;
    const cy = (rand() - 0.5) * 1.2;
    const cz = (rand() - 0.5) * 7 * (1 - Math.abs(cx) / 4);
    const L = 0.42 + rand() * 0.18;
    const W = L * 0.24;
    const n = [cx, cy, cz + L * 0.5];
    const l = [cx - W, cy, cz];
    const r = [cx + W, cy, cz];
    const b = [cx, cy, cz - L * 0.3];
    const t1 = [cx - W * 1.1, cy, cz - L * 0.55];
    const t2 = [cx + W * 1.1, cy, cz - L * 0.55];
    // Body (a diamond) and a forked tail, flat: from above the water that is what shows.
    pts.push(...n, ...l, ...r, ...l, ...b, ...r, ...b, ...t1, ...t2);
    w.push(0, 0.3, 0.3, 0.3, 0.6, 0.3, 0.6, 1, 1);
  }
  const g = tris(pts, (_x, _y, _z, o) => o.set('#9fb9c9'));
  // Tails yellow (the last triangle of each fish, both windings).
  const col = g.getAttribute('color');
  const yel = new THREE.Color('#e8c84a');
  for (let k = 0; k < 22; k++)
    for (const v of [6, 7, 8]) col.setXYZ(k * 9 + v, yel.r, yel.g, yel.b);
  for (let k = 0; k < 22; k++)
    for (const v of [6, 7, 8]) col.setXYZ(22 * 9 + k * 9 + v, yel.r, yel.g, yel.b);
  const ww = [...w, ...w.map((_, i) => w[i - (i % 3) + [0, 2, 1][i % 3]])];
  const a = new Float32Array(ww.length * 2);
  ww.forEach((v, i) => {
    a[i * 2] = 2;
    a[i * 2 + 1] = v;
  });
  g.setAttribute('aAnim', new THREE.BufferAttribute(a, 2));
  return upNormals(g);
}

/** Normals straight up (flat sea life seen from above through the water). */
function upNormals(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const n = g.getAttribute('normal');
  for (let i = 0; i < n.count; i++) n.setXYZ(i, 0, 1, 0);
  return g;
}

/**
 * A green turtle (~40 triangles), 1.3 m: a domed shell, head and four flippers (aAnim kind 3,
 * weight on the flippers, which row slowly).
 */
export function turtleGeometry(): THREE.BufferGeometry {
  const shell = new THREE.IcosahedronGeometry(1, 0).scale(0.55, 0.2, 0.7);
  const parts = [
    anim(colored(shell, '#6d6a3c'), 3),
    anim(colored(new THREE.IcosahedronGeometry(0.16, 0), '#8f8b5c').translate(0, 0, 0.82), 3),
  ];
  const fl: number[] = [];
  for (const s of [1, -1]) {
    fl.push(0.4 * s, 0, 0.35, 1.05 * s, 0, 0.05, 0.45 * s, 0, 0.05);
    fl.push(0.35 * s, 0, -0.45, 0.65 * s, 0, -0.7, 0.3 * s, 0, -0.6);
  }
  parts.push(
    anim(
      tris(fl, (_x, _y, _z, o) => o.set('#8f8b5c')),
      3,
      (x) => Math.abs(x),
    ),
  );
  return upNormals(mergeGeometries(parts)!);
}

/** An eagle ray (~10 triangles), 2.8 m across: wings that ripple (aAnim kind 4) and a tail. */
export function rayGeometry(): THREE.BufferGeometry {
  const pts = [
    0, 0, 0.7, -1.4, 0, -0.15, 0, 0.06, -0.55, 0, 0, 0.7, 0, 0.06, -0.55, 1.4, 0, -0.15, -0.04, 0,
    -0.5, 0.04, 0, -0.5, 0, 0, -2.1,
  ];
  const g = tris(pts, (x, _y, _z, o) =>
    o.set('#3d4c58').lerp(new THREE.Color('#6b7c86'), smoothstep(0.3, 1.4, Math.abs(x))),
  );
  return upNormals(anim(g, 4, (x) => Math.abs(x) / 1.4));
}

/**
 * A seabird gliding (~30 triangles): crooked, pointed wings and a forked tail, nose to +z.
 * White in the vertex colours: frigatebirds are tinted near black per instance, terns stay
 * white. aAnim kind 1 (the soar), weight out along the wing (the flap).
 */
export function seabirdGeometry(): THREE.BufferGeometry {
  const pts: number[] = [];
  for (const s of [1, -1]) {
    const root = [0.1 * s, 0, 0.12];
    const rootB = [0.1 * s, 0, -0.18];
    const elbow = [0.75 * s, 0.1, 0.02];
    const elbowB = [0.7 * s, 0.1, -0.22];
    const tip = [1.6 * s, -0.04, -0.42];
    pts.push(
      ...root,
      ...elbow,
      ...rootB,
      ...rootB,
      ...elbow,
      ...elbowB,
      ...elbow,
      ...tip,
      ...elbowB,
    );
    pts.push(0.04 * s, 0, -0.3, 0.2 * s, 0, -0.85, 0.01 * s, 0, -0.45);
  }
  pts.push(0, 0.05, 0.55, -0.1, 0, 0.1, 0.1, 0, 0.1, -0.1, 0, 0.1, 0, 0, -0.35, 0.1, 0, 0.1);
  const g = tris(pts, (_x, _y, _z, o) => o.set('#f4f2ee'));
  return anim(g, 1, (x) => Math.abs(x) / 1.6);
}

/**
 * A coral head (~50 triangles) for the lagoon floor: a brain-coral dome, fingers of staghorn
 * and a flat table, pale in the vertex colours (the instance colour gives each its hue).
 */
export function coralGeometry(): THREE.BufferGeometry {
  const parts = [colored(new THREE.IcosahedronGeometry(0.7, 0).scale(1, 0.6, 1), '#efe2d6', 0.2)];
  for (let k = 0; k < 3; k++) {
    const a = k * 2.1 + 0.4;
    parts.push(
      colored(new THREE.ConeGeometry(0.12, 1.0, 4, 1, true), '#f3e6d2', 0.5)
        .rotateZ(0.35)
        .rotateY(a)
        .translate(Math.cos(a) * 0.7, 0, Math.sin(a) * 0.7),
    );
  }
  const plate = new THREE.CircleGeometry(0.75, 6).rotateX(-Math.PI / 2);
  const under = new THREE.CircleGeometry(0.75, 6).rotateX(Math.PI / 2);
  parts.push(
    colored(plate, '#e5d4bc', 0.75).translate(-0.8, 0, -0.5),
    colored(under, '#a89a88', 0.74).translate(-0.8, 0, -0.5),
  );
  return mergeGeometries(parts)!;
}

// --- Ground cover shapes ------------------------------------------------------------------------

/** A fern (~28 triangles): seven arching fronds, dark at the heart, light at the tips. */
export function fernGeometry(): THREE.BufferGeometry {
  const pts: number[] = [];
  for (let k = 0; k < 7; k++) {
    const a = (k / 7) * Math.PI * 2 + (k % 2) * 0.3;
    const ca = Math.cos(a);
    const sa = Math.sin(a);
    const L = 0.75 + (k % 3) * 0.12;
    // Midrib up and out, then drooping; a leafy strip either side.
    const P = (u: number, side: number): number[] => {
      const r = L * u;
      const h = 0.55 * Math.sin(u * Math.PI * 0.8) * (1 - u * 0.3);
      const wv = 0.13 * Math.sin(u * Math.PI) * side;
      return [ca * r - sa * wv, h, sa * r + ca * wv];
    };
    for (let s = 0; s < 2; s++) {
      const u0 = s / 2;
      const u1 = (s + 1) / 2;
      pts.push(...P(u0, 1), ...P(u1, 1), ...P(u0, -1), ...P(u0, -1), ...P(u1, 1), ...P(u1, -1));
    }
  }
  const g = tris(
    pts,
    (x, _y, z, o) =>
      o.set('#3f7d3a').lerp(new THREE.Color('#86b356'), smoothstep(0.1, 0.8, Math.hypot(x, z))),
    false,
  );
  return upNormals(g);
}

/** Driftwood (~28 triangles): a bleached, bent log with a stub of a branch. */
export function driftwoodGeometry(): THREE.BufferGeometry {
  const a = new THREE.CylinderGeometry(0.11, 0.14, 1.5, 5, 1, true)
    .rotateZ(Math.PI / 2 - 0.08)
    .translate(-0.7, 0.1, 0);
  const b = new THREE.CylinderGeometry(0.09, 0.11, 1.2, 5, 1, true)
    .rotateZ(Math.PI / 2 + 0.12)
    .rotateY(0.3)
    .translate(0.62, 0.1, -0.18);
  const c = new THREE.ConeGeometry(0.06, 0.6, 4, 1, true).rotateZ(-0.9).translate(-0.3, 0.25, 0.08);
  return mergeGeometries([colored(a, '#bfb2a0'), colored(b, '#ad9f8b'), colored(c, '#9e917e')])!;
}

/** Shells washed up (~20 triangles): five little cones in white, cream and pink. */
export function shellsGeometry(): THREE.BufferGeometry {
  const cols = ['#fbf6ee', '#f2d6cb', '#f6e7c8', '#fbf6ee', '#e9b9a8'];
  const parts = cols.map((c, k) => {
    const a = k * 2.4;
    const r = 0.12 + (k % 3) * 0.12;
    return colored(new THREE.ConeGeometry(0.07, 0.06, 4, 1, true), c, 0.02).translate(
      Math.cos(a) * r,
      0,
      Math.sin(a) * r,
    );
  });
  return mergeGeometries(parts)!;
}
