import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { PROP } from './props';

/**
 * Neon Bay's props as small merged low-poly shapes: vertex colours (sRGB authored) and an
 * `aProp` attribute (glow, inset x, inset z) the prop material reads: glow lights a lamp's head,
 * a sign or a vending machine's front after dark; the inset pulls a parapet's inner wall in by
 * a fixed thickness whatever the roof's size. Each sits on y = 0 with its front along +z.
 */

/** Non-indexed, flat-shaded copy of `g` painted one colour, with glow and no inset. */
function paint(g: THREE.BufferGeometry, hex: string, glow = 0): THREE.BufferGeometry {
  const ng = g.index ? g.toNonIndexed() : g;
  ng.deleteAttribute('uv');
  ng.computeVertexNormals();
  const n = ng.getAttribute('position').count;
  const c = new THREE.Color(hex);
  const col = new Float32Array(n * 3);
  const prop = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    col[i * 3] = c.r;
    col[i * 3 + 1] = c.g;
    col[i * 3 + 2] = c.b;
    prop[i * 3] = glow;
  }
  ng.setAttribute('color', new THREE.BufferAttribute(col, 3));
  ng.setAttribute('aProp', new THREE.BufferAttribute(prop, 3));
  return ng;
}

/** Box of size (w, h, d) whose base centre is at (x, y, z). */
function box(
  w: number,
  h: number,
  d: number,
  x: number,
  y: number,
  z: number,
  hex: string,
  glow = 0,
): THREE.BufferGeometry {
  return paint(new THREE.BoxGeometry(w, h, d).translate(x, y + h / 2, z), hex, glow);
}

/** Upright cylinder (open: no caps) whose base centre is at (x, y, z). */
function cyl(
  r0: number,
  r1: number,
  h: number,
  seg: number,
  x: number,
  y: number,
  z: number,
  hex: string,
  open = true,
): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(r1, r0, h, seg, 1, open).translate(x, y + h / 2, z);
  return paint(g, hex);
}

function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  return mergeGeometries(parts)!;
}

const STEEL = '#5a5f69';
const CONCRETE = '#b9b4ad';

/** Street lamp (~34 tris): a slim pole, an arm over the road and a head that glows. */
function lamp(): THREE.BufferGeometry {
  return merge([
    cyl(0.11, 0.08, 7, 5, 0, 0, 0, STEEL),
    box(0.08, 0.08, 1.7, 0, 6.85, 0.8, STEEL),
    box(0.42, 0.16, 0.7, 0, 6.72, 1.55, '#fff0c8', 1),
  ]);
}

/** Utility pole (~60 tris): concrete shaft, crossarm across the street, a transformer can. */
function pole(): THREE.BufferGeometry {
  return merge([
    cyl(0.17, 0.12, 10.4, 6, 0, 0, 0, '#a9a49b'),
    box(1.9, 0.12, 0.12, 0, 9.25, 0, '#6d6a66'),
    box(0.9, 0.1, 0.1, 0, 8.4, 0, '#6d6a66'),
    cyl(0.28, 0.28, 0.9, 6, 0.36, 6.9, 0, '#8e9298', false),
  ]);
}

/**
 * Three cables (~60 tris) from x = -0.5 to 0.5 (the instance stretches them to the span),
 * sagging 0.75 m, each an X of two thin ribbons so it reads from any side.
 */
function wires(): THREE.BufferGeometry {
  const seg = 5;
  const w = 0.045;
  const t: number[] = [];
  for (const oz of [-0.7, 0, 0.7])
    for (let i = 0; i < seg; i++) {
      const xa = -0.5 + i / seg;
      const xb = -0.5 + (i + 1) / seg;
      const ya = -0.75 * (1 - (2 * xa) ** 2);
      const yb = -0.75 * (1 - (2 * xb) ** 2);
      for (const [dy, dz] of [
        [w, w],
        [w, -w],
      ]) {
        t.push(xa, ya - dy, oz - dz, xb, yb - dy, oz - dz, xb, yb + dy, oz + dz);
        t.push(xa, ya - dy, oz - dz, xb, yb + dy, oz + dz, xa, ya + dy, oz + dz);
      }
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(t), 3));
  return paint(g, '#2c2b31');
}

/** Traffic signal (~96 tris): pole, arm over the road, a horizontal head lit both ways. */
function signal(): THREE.BufferGeometry {
  return merge([
    cyl(0.13, 0.11, 5.9, 6, 0, 0, 0, STEEL),
    box(0.1, 0.1, 4.6, 0, 5.55, 2.3, STEEL),
    box(0.36, 0.42, 1.35, 0, 5.15, 4.0, '#3a3d44'),
    box(0.42, 0.28, 0.28, 0, 5.22, 3.55, '#4dffa0', 1),
    box(0.42, 0.28, 0.28, 0, 5.22, 4.0, '#ffb347', 0.15),
    box(0.42, 0.28, 0.28, 0, 5.22, 4.45, '#ff4a3a', 0.15),
    box(0.3, 0.6, 0.25, 0, 2.6, 0.2, '#3a3d44'),
    box(0.22, 0.22, 0.04, 0, 2.95, 0.33, '#ff6a50', 0.8),
  ]);
}

/** Two vending machines side by side (~28 tris), fronts lit (the instance tints the bodies). */
function vending(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (const x of [-0.48, 0.48]) {
    parts.push(box(0.9, 1.85, 0.72, x, 0, 0, '#f4f2ee'));
    parts.push(box(0.74, 1.1, 0.04, x, 0.55, 0.37, '#eaf4ff', 0.85));
  }
  return merge(parts);
}

/** Park bench (~48 tris) facing +z. */
function bench(): THREE.BufferGeometry {
  return merge([
    box(1.8, 0.07, 0.46, 0, 0.42, 0, '#a7774f'),
    box(1.8, 0.36, 0.06, 0, 0.55, -0.23, '#a7774f'),
    box(0.08, 0.42, 0.46, -0.75, 0, 0, '#3f4249'),
    box(0.08, 0.42, 0.46, 0.75, 0, 0, '#3f4249'),
  ]);
}

/** Bus shelter (~72 tris), open to +z: roof, glass back, a lit ad panel, posts and a bench. */
function busStop(): THREE.BufferGeometry {
  return merge([
    box(3.4, 0.12, 1.7, 0, 2.5, -0.1, '#e9e6e0'),
    box(3.2, 1.9, 0.05, 0, 0.45, -0.75, '#a9c3cf'),
    box(0.08, 1.9, 1.2, 1.62, 0.45, -0.2, '#fff4e0', 0.9),
    box(0.1, 2.5, 0.1, -1.62, 0, -0.75, STEEL),
    box(0.1, 2.5, 0.1, 1.62, 0, -0.75, STEEL),
    box(2.4, 0.08, 0.4, -0.2, 0.45, -0.5, '#a7774f'),
  ]);
}

/** Tree pit (~24 tris): a pale kerb with dark soil standing just proud of it. */
function pit(): THREE.BufferGeometry {
  return merge([box(1.9, 0.1, 1.9, 0, 0, 0, '#d6d0c6'), box(1.5, 0.13, 1.5, 0, 0, 0, '#5b4a3c')]);
}

/** Lumpy shrub ball (an icosahedron, slightly squashed). */
function shrub(r: number, x: number, y: number, z: number, hex: string): THREE.BufferGeometry {
  return paint(new THREE.IcosahedronGeometry(r, 0).scale(1, 0.8, 1).translate(x, y, z), hex);
}

/** Planter (~52 tris): a concrete trough of clipped shrubs. */
function planter(): THREE.BufferGeometry {
  return merge([
    box(2.4, 0.6, 1.0, 0, 0, 0, CONCRETE),
    shrub(0.62, -0.55, 0.78, 0, '#5f9a52'),
    shrub(0.58, 0.6, 0.76, 0.05, '#6aa75a'),
  ]);
}

/** Rooftop kit A (~76 tris): a water tank on a stand and two air-conditioning units. */
function roofA(): THREE.BufferGeometry {
  return merge([
    box(1.5, 1.0, 1.5, -1.2, 0, 0, '#6b6f78'),
    cyl(1.05, 1.05, 1.8, 8, -1.2, 1.0, 0, '#d9d4c8', false),
    box(1.0, 0.8, 0.65, 1.0, 0, -0.6, '#e6e4df'),
    box(1.0, 0.8, 0.65, 1.0, 0, 0.6, '#e6e4df'),
    box(0.6, 0.02, 0.4, 1.0, 0.8, -0.6, '#4a4d55'),
    box(0.6, 0.02, 0.4, 1.0, 0.8, 0.6, '#4a4d55'),
  ]);
}

/** Rooftop kit B (~60 tris): a stair hut, a row of condensers and an antenna mast. */
function roofB(): THREE.BufferGeometry {
  return merge([
    box(2.2, 2.4, 2.2, -1.2, 0, 0, '#cfc9bf'),
    box(0.9, 1.9, 0.04, -1.2, 0, 1.11, '#6f6a66'),
    box(3.0, 0.9, 0.8, 1.2, 0, 1.0, '#e2e0da'),
    cyl(0.07, 0.05, 6.5, 4, 1.3, 0, -0.6, STEEL),
    box(1.4, 0.06, 0.06, 1.3, 4.5, -0.6, STEEL),
    box(1.0, 0.06, 0.06, 1.3, 5.6, -0.6, STEEL),
  ]);
}

/**
 * Parapet (24 tris): a wall round a 1 x 1 roof, 1 m high (instances scale it to the roof); the
 * inner wall's vertices carry an inset direction so the wall stays ~0.3 m thick at any size.
 */
function parapet(): THREE.BufferGeometry {
  const t: number[] = [];
  const ins: number[] = [];
  const up: boolean[] = [];
  const c = [
    [-0.5, -0.5],
    [0.5, -0.5],
    [0.5, 0.5],
    [-0.5, 0.5],
  ];
  const y0 = -0.05;
  const y1 = 1;
  const quad = (a: number[][], inset: number[][], top = false) => {
    for (const k of [0, 1, 2, 0, 2, 3]) {
      t.push(...a[k]);
      ins.push(...inset[k]);
      up.push(top);
    }
  };
  for (let k = 0; k < 4; k++) {
    const [ax, az] = c[k];
    const [bx, bz] = c[(k + 1) % 4];
    const o = [0, 0];
    const ia = [-Math.sign(ax), -Math.sign(az)];
    const ib = [-Math.sign(bx), -Math.sign(bz)];
    // Outer wall (counter-clockwise from outside), inner wall (facing in), top.
    quad(
      [
        [ax, y0, az],
        [bx, y0, bz],
        [bx, y1, bz],
        [ax, y1, az],
      ],
      [o, o, o, o],
    );
    quad(
      [
        [bx, y0, bz],
        [ax, y0, az],
        [ax, y1, az],
        [bx, y1, bz],
      ],
      [ib, ia, ia, ib],
    );
    quad(
      [
        [ax, y1, az],
        [bx, y1, bz],
        [bx, y1, bz],
        [ax, y1, az],
      ],
      [o, o, ib, ia],
      true,
    );
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(t), 3));
  const out = paint(g, '#ddd6cb');
  const P = out.getAttribute('aProp') as THREE.BufferAttribute;
  const N = out.getAttribute('normal') as THREE.BufferAttribute;
  for (let i = 0; i < P.count; i++) {
    P.setXYZ(i, 0, ins[i * 2], ins[i * 2 + 1]);
    // The top's triangles are flat until the inset opens them: give them their normal.
    if (up[i]) N.setXYZ(i, 0, 1, 0);
  }
  return out;
}

/** Moored boat (~36 tris), bow toward +x: a tapered white hull, a cabin, a coloured rubbing strake. */
function boat(): THREE.BufferGeometry {
  const hull = new THREE.BoxGeometry(6.5, 1.3, 2.4, 2, 1, 1);
  const pos = hull.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i);
    if (x > 3) {
      pos.setZ(i, pos.getZ(i) * 0.15);
      pos.setY(i, pos.getY(i) + 0.25);
    }
    if (pos.getY(i) < 0) pos.setZ(i, pos.getZ(i) * 0.7);
  }
  hull.translate(0, 0.25, 0);
  return merge([
    paint(hull, '#f4f1ea'),
    box(6.0, 0.18, 2.42, -0.2, 0.55, 0, '#3a6ea5'),
    box(2.2, 1.3, 1.7, -0.9, 0.9, 0, '#e8e4dc'),
    box(2.0, 0.35, 1.72, -0.9, 1.75, 0, '#2f3a4a'),
  ]);
}

/** The near shape of every prop kind, indexed by PROP. */
export function propGeometries(): THREE.BufferGeometry[] {
  const g: THREE.BufferGeometry[] = [];
  g[PROP.Lamp] = lamp();
  g[PROP.Pole] = pole();
  g[PROP.Wire] = wires();
  g[PROP.Signal] = signal();
  g[PROP.Vending] = vending();
  g[PROP.Bench] = bench();
  g[PROP.BusStop] = busStop();
  g[PROP.Pit] = pit();
  g[PROP.Planter] = planter();
  g[PROP.RoofA] = roofA();
  g[PROP.RoofB] = roofB();
  g[PROP.Parapet] = parapet();
  g[PROP.Boat] = boat();
  g[PROP.ParkedCar] = parkedCar();
  return g;
}

/** A flat quad (2 tris) of size w x h at (x, y, z), facing up, or facing +z / -z (`face`). */
function quad(
  w: number,
  h: number,
  x: number,
  y: number,
  z: number,
  face: 0 | 1 | -1,
  hex: string,
  glow = 0,
): THREE.BufferGeometry {
  const g = new THREE.PlaneGeometry(w, h);
  if (face === 0) g.rotateX(-Math.PI / 2);
  else if (face < 0) g.rotateY(Math.PI);
  return paint(g.translate(x, y, z), hex, glow);
}

/**
 * Car (~30 tris), nose along +z: a body (the instance colours it), a dark glasshouse, lights
 * front and back (glowing, untinted) and a dark patch underneath that reads as its shadow.
 */
export function carGeometry(): THREE.BufferGeometry {
  return merge([
    quad(2.0, 4.8, 0, 0.05, 0, 0, '#1e1f26'),
    box(1.76, 0.78, 4.4, 0, 0.22, 0, '#ffffff'),
    box(1.56, 0.58, 2.3, 0, 1.0, -0.25, '#3a4250'),
    quad(1.5, 0.2, 0, 0.72, 2.21, 1, '#fff4dc', 1),
    quad(1.5, 0.16, 0, 0.78, -2.21, -1, '#ff3a30', 0.9),
  ]);
}

/** A parked car: the moving car's shape with its lights off. */
function parkedCar(): THREE.BufferGeometry {
  return merge([
    quad(2.0, 4.8, 0, 0.05, 0, 0, '#1e1f26'),
    box(1.76, 0.78, 4.4, 0, 0.22, 0, '#ffffff'),
    box(1.56, 0.58, 2.3, 0, 1.0, -0.25, '#3a4250'),
  ]);
}

/** A kei car (~30 tris): Japan's small boxy runabout, tall and short, nose along +z. */
export function keiGeometry(): THREE.BufferGeometry {
  return merge([
    quad(1.7, 3.6, 0, 0.05, 0, 0, '#1e1f26'),
    box(1.48, 0.95, 3.4, 0, 0.2, 0, '#ffffff'),
    box(1.42, 0.62, 2.5, 0, 1.15, -0.25, '#3a4250'),
    box(1.46, 0.08, 2.4, 0, 1.77, -0.25, '#ffffff'),
    quad(1.2, 0.18, 0, 0.75, 1.71, 1, '#fff4dc', 1),
    quad(1.2, 0.16, 0, 0.8, -1.71, -1, '#ff3a30', 0.9),
  ]);
}

/** A taxi (~36 tris): the car with a lit sign on its roof. */
export function taxiGeometry(): THREE.BufferGeometry {
  return merge([carGeometry(), box(0.55, 0.24, 0.3, 0, 1.58, -0.2, '#fff1c8', 0.8)]);
}

/** A box truck (~40 tris): a cab and a tall cargo box, nose along +z. */
export function truckGeometry(): THREE.BufferGeometry {
  return merge([
    quad(2.4, 7.4, 0, 0.05, 0, 0, '#1e1f26'),
    box(2.1, 1.9, 1.9, 0, 0.35, 2.55, '#ffffff'),
    box(2.0, 0.7, 0.1, 0, 1.4, 3.51, '#3a4250'),
    box(2.3, 2.6, 5.0, 0, 0.55, -1.05, '#eceae4'),
    quad(1.7, 0.2, 0, 0.7, 3.56, 1, '#fff4dc', 1),
    quad(1.9, 0.16, 0, 0.8, -3.56, -1, '#ff3a30', 0.9),
  ]);
}

/** A city bus (~44 tris): long and tall, a band of windows that lights up after dark. */
export function busGeometry(): THREE.BufferGeometry {
  return merge([
    quad(2.8, 11.6, 0, 0.05, 0, 0, '#1e1f26'),
    box(2.5, 2.7, 10.8, 0, 0.3, 0, '#ffffff'),
    box(2.56, 0.85, 10.2, 0, 1.45, -0.2, '#f6ead0', 0.6),
    box(2.3, 1.1, 0.08, 0, 1.2, 5.41, '#3a4250'),
    quad(1.8, 0.22, 0, 0.75, 5.42, 1, '#fff4dc', 1),
    quad(1.8, 0.2, 0, 0.9, -5.42, -1, '#ff3a30', 0.9),
  ]);
}

/** Tram (~50 tris), two cars nose along +z, a band of windows that lights up after dark. */
export function tramGeometry(): THREE.BufferGeometry {
  return merge([
    quad(2.9, 25, 0, 0.05, 0, 0, '#1e1f26'),
    box(2.5, 2.7, 11.8, 0, 0.3, 6.1, '#ffffff'),
    box(2.5, 2.7, 11.8, 0, 0.3, -6.1, '#ffffff'),
    box(2.56, 0.85, 23.2, 0, 1.55, 0, '#f6ead0', 0.6),
    box(2.0, 0.3, 21, 0, 3.0, 0, '#9aa0a8'),
    box(0.9, 0.9, 0.08, 0, 3.3, 3, '#3a3d44'),
    quad(1.8, 0.25, 0, 1.0, 12.01, 1, '#fff4dc', 1),
    quad(1.8, 0.2, 0, 1.0, -12.01, -1, '#ff3a30', 0.9),
  ]);
}

/**
 * Ferry (~70 tris), bow along +z: a hull narrowing to the bow, a cabin deck with lit windows,
 * a wheelhouse and a funnel. Scaled down it is a water taxi.
 */
export function ferryGeometry(): THREE.BufferGeometry {
  const hull = new THREE.BoxGeometry(9, 3.2, 32, 1, 1, 2);
  const pos = hull.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    if (pos.getZ(i) > 15) pos.setX(i, pos.getX(i) * 0.15);
    if (pos.getY(i) < 0) pos.setX(i, pos.getX(i) * 0.75);
    if (pos.getZ(i) > 15 && pos.getY(i) > 0) pos.setY(i, pos.getY(i) + 0.6);
  }
  hull.translate(0, 0.6, 0);
  return merge([
    paint(hull, '#f6f3ec'),
    box(9.1, 0.35, 28, 0, 0.5, -1.5, '#3a6ea5'),
    box(7.6, 2.6, 19, 0, 2.2, -3.5, '#f2efe8'),
    box(7.7, 0.9, 18, 0, 3.0, -3.5, '#f6ead0', 0.55),
    box(5.6, 2.2, 6, 0, 4.8, 1.5, '#f2efe8'),
    box(5.7, 0.7, 5.2, 0, 5.8, 1.5, '#2f3a4a'),
    cyl(0.9, 0.75, 3.2, 6, 0, 4.8, -8, '#d0473a', false),
  ]);
}
