import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { smoothstep } from '../../core/math';
import { colored, jitter, painted, topLit } from '../Trees';
import { RANCH_FAN } from './CanyonSites';

/**
 * Red Canyons' lived-in things, built from primitives and painted with vertex colours (flat
 * shaded: boards, stone and tin read as facets): the ranch (barn, house, windmill tower, stock
 * tank, corral) in one merged shape laid out to CanyonSites' RANCH_PARTS, the windmill's fan,
 * cattle and horses, the road's post-and-wire fence, a cliff dwelling's rooms, a soaring hawk,
 * and the ground cover's prickly pear and tumbleweed. Animated parts carry `aAnim` (kind,
 * weight) for the props material (materials.ts).
 */

/** A box of size (w, h, d) standing on y = 0 at (x, z), turned `yaw`, in one colour. */
function box(
  w: number,
  h: number,
  d: number,
  x: number,
  y: number,
  z: number,
  hex: string,
  yaw = 0,
): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(w, h, d).translate(0, h / 2, 0).rotateY(yaw);
  return colored(g, hex).translate(x, y, z);
}

/** A thin rod from a to b (square section `r`), in one colour. */
function rod(
  ax: number,
  ay: number,
  az: number,
  bx: number,
  by: number,
  bz: number,
  r: number,
  hex: string,
): THREE.BufferGeometry {
  const dir = new THREE.Vector3(bx - ax, by - ay, bz - az);
  const len = dir.length();
  const g = new THREE.CylinderGeometry(r, r, len, 4, 1, true).translate(0, len / 2, 0);
  g.applyQuaternion(
    new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize()),
  );
  return colored(g, hex).translate(ax, ay, az);
}

/** A gabled roof over a w x d footprint (ridge along x) from eave height `y` up `rise`. */
function gable(
  w: number,
  d: number,
  y: number,
  rise: number,
  x: number,
  z: number,
  hex: string,
): THREE.BufferGeometry {
  const hw = w / 2;
  const hd = d / 2;
  const p = [
    // Two slopes and two gable ends.
    [-hw, 0, -hd, hw, 0, -hd, hw, rise, 0],
    [-hw, 0, -hd, hw, rise, 0, -hw, rise, 0],
    [hw, 0, hd, -hw, 0, hd, -hw, rise, 0],
    [hw, 0, hd, -hw, rise, 0, hw, rise, 0],
    [-hw, 0, hd, -hw, 0, -hd, -hw, rise, 0],
    [hw, 0, -hd, hw, 0, hd, hw, rise, 0],
  ].flat();
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  return colored(g, hex).translate(x, y, z);
}

/** A flat quad facing -z (a door or a window painted on a wall), w x h, its foot at y. */
function panel(w: number, h: number, x: number, y: number, z: number, hex: string, yaw = 0) {
  return colored(new THREE.PlaneGeometry(w, h).rotateY(Math.PI + yaw), hex).translate(
    x,
    y + h / 2,
    z,
  );
}

function withAnim(g: THREE.BufferGeometry, kind: number): THREE.BufferGeometry {
  const n = g.getAttribute('position').count;
  const a = new Float32Array(n * 2);
  const pos = g.getAttribute('position');
  for (let i = 0; i < n; i++) {
    a[i * 2] = kind;
    a[i * 2 + 1] = pos.getY(i);
  }
  g.setAttribute('aAnim', new THREE.BufferAttribute(a, 2));
  return g;
}

/**
 * The ranch, in its frame (x along the canyon, z away from the river, y up from the pad): a
 * red barn with a grey tin roof and big doors, a small house with a porch and a stone
 * chimney, a lattice windmill tower over a round stock tank, a corral of posts and rails, and
 * a stack of hay. About 1000 triangles; laid out to RANCH_PARTS.
 */
export function ranchGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const wood = '#8b6d52';
  // Barn at (0, 6): walls, roof, doors facing the yard (-z), a hay loft door.
  parts.push(box(13, 5, 9, 0, 0, 6, '#9b4a34'));
  parts.push(gable(13.8, 9.8, 5, 3.2, 0, 6, '#8f8b84'));
  parts.push(panel(3.6, 3.6, 0, 0, 1.45, '#4a2e24'));
  parts.push(panel(1.6, 1.4, 0, 5.6, 1.45, '#4a2e24'));
  parts.push(box(0.25, 3.8, 0.12, -1.9, 0, 1.4, '#e8e0d0'));
  parts.push(box(0.25, 3.8, 0.12, 1.9, 0, 1.4, '#e8e0d0'));
  // House at (-18, 3): plastered walls, a rusty tin roof, a porch on posts, a stone chimney.
  parts.push(box(8, 3.2, 6, -18, 0, 3, '#dcc8a6'));
  parts.push(gable(8.8, 6.8, 3.2, 2.2, -18, 3, '#9a6a4c'));
  parts.push(panel(1.1, 2.1, -18, 0, -0.05, '#4d382c'));
  parts.push(panel(1.2, 1, -20.6, 1.2, -0.05, '#3e4652'));
  parts.push(panel(1.2, 1, -15.4, 1.2, -0.05, '#3e4652'));
  parts.push(box(8, 0.15, 2.2, -18, 2.6, -1.1, '#8a6a52'));
  for (const px of [-21.6, -18, -14.4]) parts.push(box(0.18, 2.6, 0.18, px, 0, -2, wood));
  parts.push(box(0.9, 6.4, 0.9, -21.2, 0, 4.6, '#a8927a'));
  // Windmill tower at (10, -1): four splayed legs, braces, a platform, the tail vane.
  const [hx, hy, hz] = RANCH_FAN;
  const top = hy - 0.6;
  const metal = '#9c9890';
  for (const [sx, sz] of [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ])
    parts.push(
      rod(hx + sx * 1.4, 0, hz + sz * 1.4, hx + sx * 0.3, top, hz + sz * 0.3, 0.07, metal),
    );
  for (const yb of [2.5, 5.5]) {
    const s = 1.4 - (1.1 * yb) / top;
    for (const [ax, az, bx, bz] of [
      [-1, -1, 1, -1],
      [1, -1, 1, 1],
      [1, 1, -1, 1],
      [-1, 1, -1, -1],
    ])
      parts.push(rod(hx + ax * s, yb, hz + az * s, hx + bx * s, yb, hz + bz * s, 0.05, metal));
  }
  parts.push(box(1, 0.12, 1, hx, top, hz, metal));
  parts.push(rod(hx, hy, hz, hx, hy, hz + 2.2, 0.06, metal));
  parts.push(
    colored(new THREE.PlaneGeometry(1.4, 0.9), '#c9c2b4')
      .rotateY(Math.PI / 2)
      .translate(hx, hy, hz + 2.5),
  );
  // Stock tank by the tower, water just under its rim.
  parts.push(
    colored(new THREE.CylinderGeometry(1.8, 1.8, 0.8, 12, 1, true), '#a8adb0').translate(
      hx + 3.5,
      0.4,
      hz + 3,
    ),
  );
  parts.push(
    colored(new THREE.CircleGeometry(1.75, 12).rotateX(-Math.PI / 2), '#5f8f99').translate(
      hx + 3.5,
      0.65,
      hz + 3,
    ),
  );
  // Corral at (20, 6): a ring of posts with two rails, a gap for the gate toward the yard.
  const n = 16;
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2;
    const x = 20 + Math.cos(a) * 9.5;
    const z = 6 + Math.sin(a) * 9.5;
    parts.push(box(0.2, 1.6, 0.2, x, 0, z, wood));
    if (k === 12) continue; // the gate, facing the yard
    const b = ((k + 1) / n) * Math.PI * 2;
    const x2 = 20 + Math.cos(b) * 9.5;
    const z2 = 6 + Math.sin(b) * 9.5;
    for (const ry of [0.75, 1.35]) parts.push(rod(x, ry, z, x2, ry, z2, 0.07, '#9a7b5e'));
  }
  // Hay by the barn.
  parts.push(box(3, 1.8, 2.2, 9, 0, 12.5, '#d9c07a'));
  return topLit(mergeGeometries(parts)!, 0.86, 1.05);
}

/**
 * The windmill's fan: a ring of twelve tin blades round the hub, in the xy plane, spinning
 * round local z (aAnim kind 1). About 50 triangles.
 */
export function fanGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const n = 12;
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2;
    const blade = new THREE.BufferGeometry();
    // A blade from r 0.35 to 1.6, wider at the tip, twisted a little out of the plane.
    const p = [
      [0.35, -0.08, 0],
      [1.6, -0.2, 0.08],
      [1.6, 0.2, -0.08],
      [0.35, -0.08, 0],
      [1.6, 0.2, -0.08],
      [0.35, 0.08, 0],
    ].flatMap(([r, w, z]) => [
      r * Math.cos(a) - w * Math.sin(a),
      r * Math.sin(a) + w * Math.cos(a),
      z,
    ]);
    blade.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
    parts.push(colored(blade, k % 2 ? '#c4beb3' : '#b3ada3'));
  }
  parts.push(
    colored(new THREE.CylinderGeometry(0.25, 0.25, 0.3, 6).rotateX(Math.PI / 2), '#8a857c'),
  );
  const g = mergeGeometries(parts)!;
  g.setAttribute(
    'aAnim',
    new THREE.BufferAttribute(new Float32Array(g.getAttribute('position').count * 2).fill(1), 2),
  );
  return g;
}

/**
 * A head of cattle grazing, head down, 2.2 m nose to tail (~90 triangles). White in the
 * vertex colours where the instance's coat colour shows; a pale face and dark hooves.
 */
export function cowGeometry(): THREE.BufferGeometry {
  return topLit(
    mergeGeometries([
      box(1.7, 0.8, 0.75, 0, 0.62, 0, '#ffffff'),
      box(0.55, 0.45, 0.42, 1.05, 0.5, 0, '#f2ece4', 0),
      box(0.45, 0.3, 0.36, 1.3, 0.25, 0, '#f6efe6'),
      ...[
        [-0.65, -0.25],
        [-0.65, 0.25],
        [0.6, -0.25],
        [0.6, 0.25],
      ].map(([x, z]) => box(0.17, 0.66, 0.17, x, 0, z, '#d8d2ca')),
      box(0.08, 0.6, 0.08, -0.88, 0.75, 0, '#e8e2da'),
    ])!,
    0.7,
    1.08,
  );
}

/** A horse standing in the corral, head up, ~2.3 m long (~100 triangles); coat from the instance. */
export function horseGeometry(): THREE.BufferGeometry {
  const neck = new THREE.BoxGeometry(0.32, 0.95, 0.3).rotateZ(-0.6).translate(0.95, 1.65, 0);
  return topLit(
    mergeGeometries([
      box(1.6, 0.68, 0.55, 0, 1.0, 0, '#ffffff'),
      colored(neck, '#ffffff'),
      box(0.6, 0.3, 0.26, 1.45, 1.85, 0, '#f4eee6'),
      box(0.12, 0.7, 0.06, 0.8, 1.55, 0, '#3a2c24'),
      ...[
        [-0.6, -0.18],
        [-0.6, 0.18],
        [0.6, -0.18],
        [0.6, 0.18],
      ].map(([x, z]) => box(0.13, 1.02, 0.13, x, 0, z, '#e6e0d8')),
      box(0.1, 0.8, 0.1, -0.85, 0.75, 0, '#3a2c24'),
    ])!,
    0.72,
    1.08,
  );
}

/** One span of the road's fence: a weathered post and two wires running 3.6 m along +x. */
export function fenceGeometry(): THREE.BufferGeometry {
  return mergeGeometries([
    box(0.14, 1.25, 0.14, 0, 0, 0, '#857462'),
    box(3.6, 0.03, 0.03, 1.8, 0.72, 0, '#6b655e'),
    box(3.6, 0.03, 0.03, 1.8, 1.08, 0, '#6b655e'),
  ])!;
}

/**
 * A cliff dwelling's rooms, in its frame (x along the cliff, z out from the cliff's foot, y up
 * from the bench): six masonry rooms of one and two storeys with T-shaped doorways and small
 * windows, the ends of roof beams, a round tower and a kiva's ladder poles. Built for a 20.6 m
 * shelter; scaled along x to each one. About 260 triangles.
 */
export function dwellingGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const stone = ['#c99e72', '#b98b62', '#d4ad84', '#c29466'];
  const dark = '#3a2a22';
  const rooms: [number, number, number, number][] = [
    // x, width, depth, height
    [-12, 4, 3.6, 3.2],
    [-7.8, 3.8, 4.2, 5.6],
    [-3.6, 4, 3.6, 3.6],
    [5.8, 4.4, 4.4, 6.2],
    [10.4, 3.6, 3.4, 3.4],
    [14, 3, 3, 2.6],
  ];
  rooms.forEach(([x, w, d, h], i) => {
    const z = d / 2 - 0.4; // backed into the foot of the cliff
    parts.push(box(w, h, d, x, -0.4, z, stone[i % stone.length]));
    const fz = z - d / 2 - 0.03;
    // A T-shaped doorway: a narrow lower part under a wider upper part.
    parts.push(panel(0.55, 0.9, x - w * 0.15, 0, fz, dark));
    parts.push(panel(0.95, 0.6, x - w * 0.15, 0.9, fz, dark));
    if (h > 4.5) parts.push(panel(0.5, 0.5, x + w * 0.2, h - 1.6, fz, dark));
    // Roof beam ends poking out of the front wall.
    for (const bx of [-0.3, 0.3])
      parts.push(
        rod(x + bx * w, h - 0.75, fz + 0.05, x + bx * w, h - 0.75, fz - 0.45, 0.07, '#6e5240'),
      );
  });
  // A round tower and a kiva's ladder.
  parts.push(
    colored(new THREE.CylinderGeometry(1.6, 1.75, 6.8, 10), '#c99e72').translate(1.2, 3, 3.6),
  );
  parts.push(panel(0.5, 0.5, 1.2, 4.2, 1.95, dark));
  parts.push(
    colored(new THREE.CylinderGeometry(2.4, 2.4, 0.5, 10), '#b98b62').translate(-2, -0.1, 6.2),
  );
  parts.push(rod(-2.3, 0, 6.2, -2.5, 3.2, 6.4, 0.06, '#6e5240'));
  parts.push(rod(-1.7, 0, 6.2, -1.5, 3.2, 6.4, 0.06, '#6e5240'));
  return topLit(mergeGeometries(parts)!, 0.8, 1.06);
}

/**
 * A soaring hawk (~14 triangles): a dark body and long broad wings held in a shallow V, swept
 * at the tips; aAnim kind 3 circles it round its instance's origin (materials.ts).
 */
export function hawkGeometry(): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  // Nose along +x; wings out along z.
  const p = [
    // Body: two thin diamonds (top and side).
    [0.55, 0, 0, -0.5, 0.05, 0, -0.1, 0.1, 0.1],
    [0.55, 0, 0, -0.1, 0.1, -0.1, -0.5, 0.05, 0],
    [0.55, 0, 0, -0.1, -0.05, 0.1, -0.5, 0.05, 0],
    [0.55, 0, 0, -0.5, 0.05, 0, -0.1, -0.05, -0.1],
    // Tail fan.
    [-0.45, 0.05, 0, -0.85, 0.06, 0.18, -0.85, 0.06, -0.18],
    // Wings: inner and outer panels each side, tips swept back and up.
    [0.2, 0.06, 0, -0.25, 0.06, 0, 0.05, 0.2, 0.75],
    [-0.25, 0.06, 0, -0.2, 0.2, 0.75, 0.05, 0.2, 0.75],
    [0.05, 0.2, 0.75, -0.2, 0.2, 0.75, -0.22, 0.32, 1.2],
    [0.2, 0.06, 0, 0.05, 0.2, -0.75, -0.25, 0.06, 0],
    [-0.25, 0.06, 0, 0.05, 0.2, -0.75, -0.2, 0.2, -0.75],
    [0.05, 0.2, -0.75, -0.22, 0.32, -1.2, -0.2, 0.2, -0.75],
  ].flat();
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  const out = painted(g, (_x, _y, z, c) => c.set('#6a4a36').multiplyScalar(1 - Math.abs(z) * 0.15));
  // Both faces drawn: the wings are seen from below as often as from above.
  const back = out.clone();
  const idx = back.getAttribute('position');
  for (let i = 0; i < idx.count; i += 3) {
    const x = idx.getX(i + 1);
    const y = idx.getY(i + 1);
    const z = idx.getZ(i + 1);
    idx.setXYZ(i + 1, idx.getX(i + 2), idx.getY(i + 2), idx.getZ(i + 2));
    idx.setXYZ(i + 2, x, y, z);
  }
  back.computeVertexNormals();
  return withAnim(mergeGeometries([out, back])!, 3);
}

/** Prickly pear (ground cover): three spiny green pads with a few magenta fruit (~70 tris). */
export function cactusGeometry(): THREE.BufferGeometry {
  const pad = (x: number, y: number, z: number, rz: number, ry: number, s: number) =>
    colored(
      jitter(new THREE.IcosahedronGeometry(1, 0), 0.08, 91)
        .scale(0.28 * s, 0.34 * s, 0.07)
        .rotateZ(rz)
        .rotateY(ry),
      '#6f8f4e',
    ).translate(x, y, z);
  return topLit(
    mergeGeometries([
      pad(0, 0.3, 0, 0.1, 0, 1),
      pad(0.22, 0.6, 0.02, -0.6, 0.4, 0.85),
      pad(-0.2, 0.55, -0.05, 0.7, -0.5, 0.8),
      colored(new THREE.TetrahedronGeometry(0.07), '#c2457a').translate(0.38, 0.88, 0.05),
      colored(new THREE.TetrahedronGeometry(0.07), '#c2457a').translate(-0.36, 0.82, -0.04),
      colored(new THREE.TetrahedronGeometry(0.07), '#c2457a').translate(0.02, 0.66, 0.02),
    ])!,
    0.75,
    1.1,
  );
}

/**
 * Tumbleweed (ground cover): a dry, open ball of twigs, four thin hoops crossing at angles
 * (~80 triangles), pale straw; the cover material draws both faces.
 */
export function tumbleweedGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 4; k++) {
    const ring = new THREE.RingGeometry(0.34, 0.42, 10, 1);
    ring.rotateX(k * 0.8 + 0.3).rotateY(k * 1.3);
    parts.push(colored(ring, k % 2 ? '#c8b088' : '#b39a74'));
  }
  return mergeGeometries(parts)!.translate(0, 0.36, 0);
}

/**
 * A dust devil: an open, flaring funnel 1 tall (radius 0.12 at the foot, 0.5 at the top),
 * with uv for the swirl and a height attribute; scaled per instance and drawn by the dust
 * devil material.
 */
export function dustDevilGeometry(): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(0.5, 0.12, 1, 14, 8, true).translate(0, 0.5, 0);
  const pos = g.getAttribute('position');
  // Flare the top out (a funnel, not a cone).
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    const f = 0.3 + 0.7 * smoothstep(0, 1, y) ** 1.5 + 0.25 * (1 - smoothstep(0, 0.08, y));
    const r = Math.hypot(pos.getX(i), pos.getZ(i)) || 1;
    const R = 0.12 + 0.38 * f;
    pos.setXYZ(i, (pos.getX(i) / r) * R, y, (pos.getZ(i) / r) * R);
  }
  g.deleteAttribute('normal');
  return g;
}
