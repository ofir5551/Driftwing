import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { smoothstep } from '../../core/math';
import { hipGeometry } from '../city/geometry';
import { mulberry32 } from '../noise';
import { colored, jitter, painted, topLit } from '../Trees';
import { profile, type Bridge } from './PeaksLayout';
import { LEDGE_EPS, type SpireSkin } from './skin';

/**
 * Sea of Clouds' shapes. Spires are lathed from the layout's profile in base radii (radius 1,
 * height `aspect`; the instance scales them) and flat-shaded, so the granite breaks into
 * facets; collisions use the same profile. Everything else is built in metres from primitives
 * and painted with vertex colours.
 */

const GRANITE = new THREE.Color('#aaa29b');
const GRANITE_WARM = new THREE.Color('#bba88f');
const GRANITE_COOL = new THREE.Color('#9a9ca3');
const JOINT = new THREE.Color('#4e4a4d');
const LICHEN = new THREE.Color('#c7a165');
const MOSS = new THREE.Color('#5f7f58');

/** Ring layout of one spire mesh tier: segments round, base rings, rings added per joint. */
export interface SpireDetail {
  seg: number;
  rings: number;
  /** 0: none (far), 1: the ledge's lip and inner edge, 2: the joint's groove too. */
  joints: 0 | 1 | 2;
}

export const SPIRE_HERO: SpireDetail = { seg: 30, rings: 26, joints: 2 };
export const SPIRE_NEAR: SpireDetail = { seg: 16, rings: 16, joints: 1 };
export const SPIRE_FAR: SpireDetail = { seg: 7, rings: 10, joints: 0 };

/**
 * One spire silhouette lathed from its skin (radius 1, height `aspect`; the instance scales
 * it): an indexed lathe with smooth normals, rings packed round every joint so the ledges are
 * flat steps with a lip and the grooves are undercut, chimneys cut down the faces, the summit
 * dome rounded. Vertex colours carry the large paint (granite warmer or cooler column by
 * column, dark in the grooves and chimneys, rain streaks under the ledges, moss on them and on
 * the summit); the fine relief and lichen are painted per pixel (granite.ts).
 */
export function spireGeometry(skin: SpireSkin, d: SpireDetail): THREE.BufferGeometry {
  const sh = skin.sh;
  const SEG = d.seg;
  // Ring heights: a base set bunched toward the summit, plus rings at each joint.
  const ts: number[] = [];
  for (let i = 0; i <= d.rings; i++) {
    const u = i / d.rings;
    ts.push(-0.03 + 1.02 * (1 - Math.pow(1 - u, 1.35)));
  }
  if (d.joints > 0)
    for (const J of skin.joints) {
      ts.push(J.t - LEDGE_EPS, J.t + LEDGE_EPS, J.t + J.rise * 0.45);
      if (d.joints > 1) ts.push(J.t - J.w, J.t + J.rise * 0.15, J.t + J.rise);
    }
  ts.sort((a, b) => a - b);
  const T: number[] = [];
  for (const t of ts) if (t < 0.995 && (T.length === 0 || t - T[T.length - 1] > 0.0015)) T.push(t);
  const pos: number[] = [];
  const col: number[] = [];
  const c = new THREE.Color();
  const ph = skin.sh.aspect * 3.7;
  for (const t of T) {
    const tc = Math.max(t, 0);
    const off = sh.lean * tc * tc * sh.aspect;
    const crown = smoothstep(sh.cap - 0.04, sh.cap + 0.06, tc);
    // Just above a ledge (its floor) and in the band under it (where water runs off it).
    let ledge = 0;
    let under = 0;
    for (let j = 0; j < skin.joints.length; j++) {
      const J = skin.joints[j];
      if (tc >= J.t && tc < J.t + 0.004) ledge = Math.max(ledge, j + 1);
      if (tc < J.t && tc > J.t - 0.06) under = Math.max(under, 1 - (J.t - tc) / 0.06);
    }
    for (let k = 0; k < SEG; k++) {
      const a = (k / SEG) * Math.PI * 2;
      const prof = profile(sh, tc) * (t < 0 ? 1.03 : 1);
      const sk = skin.skin(tc, a);
      const rad = prof * sk;
      pos.push(Math.cos(a) * rad + off, (t + skin.lift(tc, a)) * sh.aspect, Math.sin(a) * rad);
      // Columns of slightly different stone round the spire.
      const tone = 0.5 + 0.5 * Math.sin(a * 3 + ph) * Math.sin(a * 7 - ph * 0.6 + tc * 5);
      c.copy(GRANITE)
        .lerp(GRANITE_WARM, tone * 0.55)
        .lerp(GRANITE_COOL, (1 - tone) * 0.25);
      // Cut-in rock is in shade and wet: grooves, chimneys, the backs of ledges.
      c.lerp(JOINT, Math.min(0.6, Math.max(0, 1 - sk) * 4.5));
      const lichen = smoothstep(0.75, 0.95, Math.sin(tc * 19 + a * 3 + ph) * Math.sin(a * 2 - ph));
      c.lerp(LICHEN, lichen * 0.35);
      // Rain streaks hang under the ledges.
      const streak = smoothstep(0.4, 0.9, Math.sin(a * 11 + ph + Math.sin(tc * 6) * 2));
      c.lerp(JOINT, under * streak * 0.35);
      if (ledge > 0) c.lerp(MOSS, skin.ledgeMask(ledge - 1, a) * 0.75);
      c.lerp(MOSS, crown * 0.4);
      col.push(c.r, c.g, c.b);
    }
  }
  const R = T.length;
  pos.push(sh.lean * sh.aspect, sh.aspect, 0);
  c.copy(GRANITE).lerp(MOSS, 0.4);
  col.push(c.r, c.g, c.b);
  const apex = R * SEG;
  const idx: number[] = [];
  for (let i = 0; i < R - 1; i++)
    for (let k = 0; k < SEG; k++) {
      const k1 = (k + 1) % SEG;
      const a = i * SEG + k;
      const b = i * SEG + k1;
      const cc = (i + 1) * SEG + k;
      const dd = (i + 1) * SEG + k1;
      idx.push(a, cc, b, b, cc, dd);
    }
  for (let k = 0; k < SEG; k++) idx.push((R - 1) * SEG + k, apex, (R - 1) * SEG + ((k + 1) % SEG));
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
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
  // The monks' long dormitory along the west wall.
  parts.push(colored(new THREE.BoxGeometry(4, 3, 7), '#e3dccd', 3.1).translate(-10, 0, -5));
  parts.push(roof(5.2, 8.4, 1.6, 4.6).translate(-10, 0, -5));
  // A bell pavilion: four red posts, a roof, the bronze bell hanging under it.
  for (const [x, z] of [
    [-10.3, 4.7],
    [-7.7, 4.7],
    [-10.3, 7.3],
    [-7.7, 7.3],
  ])
    parts.push(
      colored(new THREE.CylinderGeometry(0.12, 0.14, 2.8, 4), '#9e3a2f', 3).translate(x, 0, z),
    );
  parts.push(roof(4, 4, 1.3, 4.4).translate(-9, 0, 6));
  parts.push(
    colored(new THREE.CylinderGeometry(0.45, 0.7, 1.2, 8), '#6d5a35', 3.3).translate(-9, 0, 6),
  );
  // A white stupa: a square plinth, the dome, a stepped spire with a gilded tip.
  parts.push(colored(new THREE.BoxGeometry(3, 1, 3), '#d9d2c4', 2.1).translate(8, 0, 10));
  parts.push(colored(new THREE.SphereGeometry(1.25, 8, 5), '#f1ece2', 3.4).translate(8, 0, 10));
  parts.push(
    colored(new THREE.CylinderGeometry(0.25, 0.55, 2.2, 6), '#e9e3d6', 5.3).translate(8, 0, 10),
  );
  parts.push(colored(new THREE.ConeGeometry(0.3, 0.8, 6), '#c9a64e', 6.8).translate(8, 0, 10));
  // The courtyard before the main hall: a bronze incense burner and two stone lanterns.
  parts.push(
    colored(new THREE.CylinderGeometry(0.75, 0.5, 0.8, 8), '#5e5135', 2.1).translate(-2, 0, 5.2),
  );
  parts.push(colored(new THREE.ConeGeometry(0.6, 0.7, 8), '#4b4130', 2.85).translate(-2, 0, 5.2));
  for (const x of [-5, 1])
    parts.push(
      colored(new THREE.BoxGeometry(0.5, 1.3, 0.5), '#a69f94', 2.25).translate(x, 0, 4.4),
      colored(new THREE.ConeGeometry(0.55, 0.45, 4).rotateY(Math.PI / 4), '#8d867b', 3.1).translate(
        x,
        0,
        4.4,
      ),
    );
  // The front gate in the terrace wall.
  for (const x of [-3.6, -0.4])
    parts.push(colored(new THREE.BoxGeometry(0.4, 3.4, 0.4), '#9e3a2f', 3.3).translate(x, 0, 13.4));
  parts.push(roof(5, 1.5, 0.8, 5).translate(-2, 0, 13.4));
  return mergeGeometries(parts)!;
}

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
