import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { smoothstep } from '../../core/math';
import { hipGeometry } from '../city/geometry';
import { hash2, mulberry32 } from '../noise';
import { colored, jitter, painted, topLit } from '../Trees';
import { profile, type Bridge, type SpireShape } from './PeaksLayout';

/**
 * Sea of Clouds' shapes. Spires are lathed from the layout's profile in base radii (radius 1,
 * height `aspect`; the instance scales them) and flat-shaded, so the granite breaks into
 * facets; collisions use the same profile. Everything else is built in metres from primitives
 * and painted with vertex colours.
 */

const GRANITE = new THREE.Color('#aaa29b');
const GRANITE_WARM = new THREE.Color('#bba88f');
const JOINT = new THREE.Color('#4e4a4d');
const LICHEN = new THREE.Color('#c7a165');
const MOSS = new THREE.Color('#5f7f58');

/**
 * One spire silhouette: granite split by vertical joints into columns of slightly different
 * depth (each facet a different stone), darker in the joints and streaked where water runs,
 * with ochre lichen and green on the ledges and the summit. Flat-shaded: crisp facets read as
 * hard granite, where Jade River's limestone is smooth.
 */
export function spireGeometry(
  sh: SpireShape,
  seed: number,
  SEG = 9,
  RINGS = 24,
): THREE.BufferGeometry {
  const rand = mulberry32(seed);
  // Each column of rock sits a little proud or recessed, block by block up the spire.
  const blocks = 5 + Math.floor(rand() * 4);
  const ph = rand() * 10;
  const ring: number[][] = [];
  const cols: number[][] = [];
  const c = new THREE.Color();
  for (let i = 0; i <= RINGS; i++) {
    const u = i / RINGS;
    // Rings bunch up toward the summit, where the dome curves.
    const t = -0.03 + 1.02 * (1 - Math.pow(1 - u, 1.3));
    const tc = Math.max(t, 0);
    const rad = profile(sh, tc) * (t < 0 ? 1.03 : 1);
    const off = sh.lean * tc * tc * sh.aspect;
    const ledge = smoothstep(
      0.015,
      0.05,
      profile(sh, tc) - profile(sh, Math.min(tc + 0.02, 0.999)),
    );
    const crown = smoothstep(sh.cap - 0.04, sh.cap + 0.06, tc);
    const row: number[] = [];
    const rc: number[] = [];
    for (let k = 0; k < SEG; k++) {
      const a = (k / SEG) * Math.PI * 2 + (hash2(k, i, seed) - 0.5) * 0.12;
      const b = Math.floor(tc * blocks + hash2(k, 7, seed) * 0.8);
      const depth = 1 + (1 - crown * 0.7) * (hash2(k, b, seed + 1) - 0.5) * 0.16;
      row.push(Math.cos(a) * rad * depth + off, t * sh.aspect, Math.sin(a) * rad * depth);
      // Joints run down the rock; rain streaks the faces below the ledges.
      const streak = 0.5 + 0.5 * Math.sin(a * 5 + ph + Math.sin(t * 7 + a) * 1.2);
      c.copy(GRANITE).lerp(
        GRANITE_WARM,
        hash2(k, 0, seed + 2) * 0.5 + hash2(k, b, seed + 3) * 0.12,
      );
      c.lerp(JOINT, smoothstep(0.55, 0.95, streak) * 0.6 + (depth < 0.97 ? 0.1 : 0));
      const lichen = smoothstep(0.75, 0.95, Math.sin(t * 19 + a * 3 + ph) * Math.sin(a * 2 - ph));
      c.lerp(LICHEN, lichen * 0.45);
      c.lerp(MOSS, Math.min(1, crown * 0.35 + ledge * 0.55));
      rc.push(c.r, c.g, c.b);
    }
    ring.push(row);
    cols.push(rc);
  }
  // Non-indexed with a colour per face (from its lower-left corner), so each facet is one stone.
  const pos: number[] = [];
  const col: number[] = [];
  const v = (i: number, k: number) => {
    const r = ring[i];
    pos.push(r[k * 3], r[k * 3 + 1], r[k * 3 + 2]);
  };
  const face = (i: number, k: number) => {
    const cc = cols[i];
    for (let n = 0; n < 3; n++) col.push(cc[k * 3], cc[k * 3 + 1], cc[k * 3 + 2]);
  };
  for (let i = 0; i < RINGS; i++)
    for (let k = 0; k < SEG; k++) {
      const k1 = (k + 1) % SEG;
      v(i, k);
      v(i + 1, k);
      v(i, k1);
      face(i, k);
      v(i, k1);
      v(i + 1, k);
      v(i + 1, k1);
      face(i, k);
    }
  const apex = [sh.lean * sh.aspect, sh.aspect, 0];
  for (let k = 0; k < SEG; k++) {
    v(RINGS, k);
    pos.push(apex[0], apex[1], apex[2]);
    v(RINGS, (k + 1) % SEG);
    face(RINGS, k);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.computeVertexNormals();
  return geo;
}

/**
 * A windswept granite pine (~50 triangles): a crooked trunk leaning out (+x) under flat,
 * layered pads of needles held level like open hands, the way pines grow from cliffs above
 * the clouds. Drawn leaning, turned per instance so cliff pines reach out over the drop.
 */
export function cloudPineGeometry(): THREE.BufferGeometry {
  const trunk = new THREE.CylinderGeometry(0.22, 0.42, 6, 4).translate(0, 3, 0).rotateZ(-0.42);
  const parts = [colored(trunk, '#6c5345')];
  const pads: [number, number, number, number][] = [
    [2.6, 5.6, 0, 3.0],
    [3.6, 6.9, 0.6, 2.2],
    [1.6, 4.5, -0.5, 1.9],
  ];
  for (const [x, y, z, r] of pads)
    parts.push(
      colored(new THREE.CylinderGeometry(r, r * 0.8, 0.9, 6), '#3f6b4f').translate(x, y, z),
    );
  return topLit(mergeGeometries(parts)!, 0.6, 1.15);
}

/**
 * Near granite pine (~140 triangles): the trunk bends twice as it reaches out, and each pad is
 * a lumpy flattened cloud of needles, dark underneath and catching the light along its top.
 */
export function cloudPineDetailGeometry(): THREE.BufferGeometry {
  const rand = mulberry32(17);
  const parts: THREE.BufferGeometry[] = [];
  const pts = [
    [0, 0, 0],
    [0.9, 2.4, 0.1],
    [2.3, 4.2, -0.2],
    [3.6, 5.6, 0.3],
  ];
  for (let i = 0; i < 3; i++) {
    const a = new THREE.Vector3(...pts[i]);
    const b = new THREE.Vector3(...pts[i + 1]);
    const d = b.clone().sub(a);
    const g = new THREE.CylinderGeometry(0.32 - i * 0.08, 0.42 - i * 0.08, d.length(), 5);
    g.translate(0, d.length() / 2, 0);
    g.applyQuaternion(
      new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize()),
    );
    g.translate(a.x, a.y, a.z);
    parts.push(colored(g, '#6c5345'));
  }
  const dark = new THREE.Color('#2f5440');
  const light = new THREE.Color('#5a8a62');
  const pads: [number, number, number, number][] = [
    [3.4, 6.2, 0.2, 2.8],
    [1.9, 4.7, -0.9, 2.1],
    [4.4, 5.0, 1.1, 1.8],
    [2.5, 7.0, 0.8, 1.6],
  ];
  for (const [x, y, z, r] of pads) {
    const g = jitter(new THREE.IcosahedronGeometry(1, 0), 0.3, 40 + Math.floor(rand() * 50));
    g.scale(r, 0.42, r * 0.85);
    parts.push(
      painted(g, (_x, py, _z, out) =>
        out.copy(dark).lerp(light, smoothstep(-0.3, 0.4, py)),
      ).translate(x, y, z),
    );
  }
  return mergeGeometries(parts)!;
}

/** A dark curved roof (hip) over a w x d footprint, eaves flaring, sitting at height y. */
function roof(w: number, d: number, h: number, y: number, hex = '#3b4247'): THREE.BufferGeometry {
  return colored(hipGeometry(0.3).scale(w, h, d), hex, y);
}

/** A hermit's shrine on a summit: a stone terrace, a whitewashed hall, a red door, a dark roof. */
export function hermitageGeometry(): THREE.BufferGeometry {
  return mergeGeometries([
    colored(new THREE.CylinderGeometry(5.2, 5.8, 1, 7), '#a69f94', 0.5),
    colored(new THREE.BoxGeometry(6, 3.4, 4.4), '#ece6da', 2.7),
    colored(new THREE.BoxGeometry(1.2, 2, 0.15), '#a3392f', 2).translate(0, 0, 2.23),
    roof(7.6, 6, 2.6, 4.3),
    colored(new THREE.ConeGeometry(0.25, 1.1, 5), '#c9a64e', 7.3),
  ])!;
}

/**
 * The gate's monastery, crowning the taller spire: a walled terrace, a main hall with a
 * double roof, a three-storey tower and a side hall, whitewashed with red doors and dark tiles.
 */
export function monasteryGeometry(): THREE.BufferGeometry {
  const parts = [
    colored(new THREE.CylinderGeometry(15, 16, 1.6, 10), '#a69f94', 0.8),
    colored(new THREE.CylinderGeometry(15.2, 15.2, 1.4, 10, 1, true), '#d9d2c4', 2.3),
    // Main hall.
    colored(new THREE.BoxGeometry(12, 5, 8), '#ece6da', 4.1).translate(-2, 0, -2),
    colored(new THREE.BoxGeometry(2, 3, 0.2), '#a3392f', 3.1).translate(-2, 0, 2.05),
    roof(14.5, 10.5, 2.6, 6.6).translate(-2, 0, -2),
    roof(9, 6, 2.2, 8.6).translate(-2, 0, -2),
    // Side hall.
    colored(new THREE.BoxGeometry(5, 3.4, 6), '#e3dccd', 3.3).translate(8, 0, 2),
    roof(6.4, 7.6, 2, 5).translate(8, 0, 2),
  ];
  // Tower: three storeys, each a little smaller under its own flared roof.
  for (let s = 0; s < 3; s++) {
    const w = 5.2 - s * 1.1;
    const y = 1.6 + s * 4.2;
    parts.push(colored(new THREE.BoxGeometry(w, 3.2, w), '#ece6da', y + 1.6).translate(6, 0, -7));
    parts.push(roof(w + 2.4, w + 2.4, 1.4, y + 3.2).translate(6, 0, -7));
  }
  parts.push(colored(new THREE.ConeGeometry(0.35, 2.4, 6), '#c9a64e', 15.6).translate(6, 0, -7));
  return mergeGeometries(parts)!;
}

/** Where lanterns hang on the temples, in their local metres. */
export const HERMITAGE_LANTERNS = [{ x: 2.3, y: 3.6, z: 2.6 }];
export const MONASTERY_LANTERNS = [
  { x: -5, y: 5.6, z: 2.6 },
  { x: 1, y: 5.6, z: 2.6 },
  { x: 6, y: 13.4, z: -4.2 },
  { x: 8, y: 4.6, z: 5.3 },
  { x: -12, y: 3.4, z: 8 },
  { x: 12, y: 3.4, z: -8 },
];

const FLAGS = ['#3d6fb6', '#f1ece2', '#c8443a', '#4c9a5f', '#e5c14b'];

/** Deck height of the bridge at x (a sag between its anchors). */
export function deckY(b: Bridge, x: number): number {
  const u = (2 * (x - b.x0)) / (b.x1 - b.x0) - 1;
  return b.y - b.sag * (1 - u * u);
}

/**
 * The hanging bridge between the gate spires, in world metres: a plank deck sagging between
 * the rock, rope rails on posts, and strings of prayer flags (blue, white, red, green, yellow)
 * along both rails. Returns the geometry and where its lanterns hang.
 */
export function bridgeGeometry(b: Bridge): {
  geometry: THREE.BufferGeometry;
  lanterns: { x: number; y: number; z: number }[];
} {
  const parts: THREE.BufferGeometry[] = [];
  const lanterns: { x: number; y: number; z: number }[] = [];
  const N = 18;
  const seg = (
    x0: number,
    y0: number,
    x1: number,
    y1: number,
    thick: number,
    w: number,
    z: number,
    hex: string,
  ) => {
    const len = Math.hypot(x1 - x0, y1 - y0);
    const g = new THREE.BoxGeometry(len, thick, w);
    g.rotateZ(Math.atan2(y1 - y0, x1 - x0));
    g.translate((x0 + x1) / 2, (y0 + y1) / 2, z);
    parts.push(colored(g, hex));
  };
  const w = b.w * 0.8;
  for (let i = 0; i < N; i++) {
    const x0 = b.x0 + ((b.x1 - b.x0) * i) / N;
    const x1 = b.x0 + ((b.x1 - b.x0) * (i + 1)) / N;
    const y0 = deckY(b, x0);
    const y1 = deckY(b, x1);
    // Planks, every other one a shade darker.
    seg(x0, y0, x1, y1, 0.35, w * 2, b.z, i % 2 ? '#8a6c4f' : '#9d7d5a');
    for (const s of [-1, 1]) {
      seg(x0, y0 + 1.2, x1, y1 + 1.2, 0.12, 0.12, b.z + s * w, '#5c4a3a');
      // A flag hanging off the rope at every plank.
      const fx = (x0 + x1) / 2;
      const fy = (y0 + y1) / 2 + 0.85;
      parts.push(
        colored(
          new THREE.BoxGeometry(0.9, 0.7, 0.05),
          FLAGS[(i + (s > 0 ? 2 : 0)) % FLAGS.length],
        ).translate(fx, fy, b.z + s * (w + 0.06)),
      );
    }
    if (i % 3 === 0) {
      for (const s of [-1, 1]) {
        const g = new THREE.CylinderGeometry(0.1, 0.12, 1.4, 4);
        parts.push(colored(g, '#5c4a3a', y0 + 0.7).translate(x0, 0, b.z + s * w));
      }
      if (i > 0) lanterns.push({ x: x0, y: y0 + 1.75, z: b.z + w });
    }
  }
  // Stout anchor posts where the deck meets the rock.
  for (const x of [b.x0 + 0.6, b.x1 - 0.6])
    for (const s of [-1, 1])
      parts.push(
        colored(new THREE.BoxGeometry(0.5, 2.6, 0.5), '#4f3e31', b.y + 0.8).translate(
          x,
          0,
          b.z + s * w,
        ),
      );
  return { geometry: mergeGeometries(parts)!, lanterns };
}
