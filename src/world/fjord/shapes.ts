import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { smoothstep } from '../../core/math';
import { colored, jitter, painted, topLit } from '../Trees';

/**
 * Aurora Fjords' props, in metres, merged into one vertex-coloured geometry each for one
 * instanced draw (materials.ts). Every shape carries `aFx` (paint, glow, wing): `paint` 1 takes
 * the instance's colour (a house's red or yellow boards) and 0 keeps its own (white trim, a
 * dark roof); `glow` marks window glass, lit warm after dark; `wing` is how far a vertex flaps.
 * Local +z faces the water: a house's door, a boathouse's gable, a jetty's far end, a bow.
 */

/** Tags every vertex of a non-indexed geometry with its effects. */
function fx(g: THREE.BufferGeometry, paint: number, glow = 0, wing?: (x: number) => number) {
  const pos = g.getAttribute('position');
  const a = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    a[i * 3] = paint;
    a[i * 3 + 1] = glow;
    a[i * 3 + 2] = wing ? wing(pos.getX(i)) : 0;
  }
  g.setAttribute('aFx', new THREE.BufferAttribute(a, 3));
  return g;
}

/** A box `hex`, lifted so its centre is at (x, y, z); paint/glow as `fx`. */
const box = (
  w: number,
  h: number,
  d: number,
  hex: string,
  x: number,
  y: number,
  z: number,
  paint = 0,
) => fx(colored(new THREE.BoxGeometry(w, h, d), hex, y).translate(x, 0, z), paint);

/** A flat quad facing +z (or turned by `yaw`), centred at (x, y, z). */
const quad = (
  w: number,
  h: number,
  hex: string,
  x: number,
  y: number,
  z: number,
  yaw = 0,
  glow = 0,
) => fx(colored(new THREE.PlaneGeometry(w, h).rotateY(yaw), hex, y).translate(x, 0, z), 0, glow);

/** A gable roof with its ridge along x: width w (x), depth d (z), rise h, eaves at y. */
function roof(w: number, d: number, h: number, hex: string, y: number, ridgeAlongZ = false) {
  const s = new THREE.Shape();
  s.moveTo(-d / 2, 0);
  s.lineTo(d / 2, 0);
  s.lineTo(0, h);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: w, bevelEnabled: false });
  g.translate(0, 0, -w / 2);
  g.rotateY(ridgeAlongZ ? 0 : Math.PI / 2);
  const base = new THREE.Color(hex);
  const ridge = base.clone().offsetHSL(0, 0, 0.05);
  return fx(
    painted(g, (_x, py, _z, out) => out.copy(base).lerp(ridge, py / h), y),
    0,
  );
}

/** A window: dark glass (it glows after dark) in a white frame, on a face looking along `yaw`. */
function windowAt(x: number, y: number, z: number, yaw: number, w = 0.95, h = 1.15) {
  const nx = Math.sin(yaw) * 0.03;
  const nz = Math.cos(yaw) * 0.03;
  return [
    quad(w + 0.32, h + 0.32, '#f2eee6', x, y, z, yaw),
    quad(w, h, '#2c3442', x + nx, y, z + nz, yaw, 1),
  ];
}

/**
 * A wooden house (~90 tris): boarded walls in the instance's paint on a stone footing, a dark
 * slate roof with a chimney, white-framed windows (glass that glows after dark) and a door to
 * the water. 8.4 x 6.8 m, the ridge at ~7.4 m; scaled per house (sy > 1.2: two storeys).
 */
export function houseGeometry(): THREE.BufferGeometry {
  const parts = [
    box(8.2, 1.8, 6.8, '#77767a', 0, -0.3, 0),
    box(8, 3.6, 6.6, '#ffffff', 0, 2.4, 0, 1),
    roof(8.8, 7.4, 2.9, '#34363d', 4.2),
    box(0.7, 1.8, 0.7, '#5a524e', 2.2, 7, -0.8),
    quad(1.1, 2.1, '#f2eee6', 0, 1.65, 3.32),
    quad(0.85, 1.9, '#4c3a32', 0, 1.6, 3.35),
  ];
  for (const x of [-2.6, 2.6]) parts.push(...windowAt(x, 2.8, 3.32, 0));
  for (const x of [-2, 2]) parts.push(...windowAt(x, 2.8, -3.32, Math.PI));
  parts.push(...windowAt(4.02, 2.8, 0, Math.PI / 2), ...windowAt(-4.02, 2.8, 0, -Math.PI / 2));
  return topLit(mergeGeometries(parts)!, 0.82, 1.06);
}

/**
 * A white wooden church (~110 tris): a long nave with tall windows, a square tower at its west
 * end under a slender steeple, ~19.5 m to the tip.
 */
export function churchGeometry(): THREE.BufferGeometry {
  const spire = fx(
    colored(new THREE.ConeGeometry(1.9, 7.5, 4).rotateY(Math.PI / 4), '#34363d', 15.2),
    0,
  );
  spire.translate(-5.6, 0, 0);
  const parts = [
    box(12.4, 1.4, 7.4, '#77767a', 0.8, -0.2, 0),
    box(11, 5.2, 7, '#f1ede4', 1.3, 3, 0),
    roof(11.8, 7.8, 3.6, '#34363d', 5.6),
    box(3.6, 10.2, 3.6, '#f1ede4', -5.6, 5.5, 0),
    box(4, 0.4, 4, '#34363d', -5.6, 10.8, 0),
    spire,
    quad(1.3, 2.6, '#4c3a32', -5.6, 1.6, 1.82),
  ];
  for (const x of [-1.6, 1.6, 4.8])
    parts.push(...windowAt(x, 3.6, 3.52, 0, 0.9, 2), ...windowAt(x, 3.6, -3.52, Math.PI, 0.9, 2));
  parts.push(...windowAt(-5.6, 7.6, 1.82, 0, 0.7, 1));
  return topLit(mergeGeometries(parts)!, 0.84, 1.05);
}

/**
 * A boathouse (naust, ~60 tris): a long, plain shed in the instance's paint (tarred dark or
 * red), its gable to the water with a big door, standing on posts over the shore.
 */
export function boathouseGeometry(): THREE.BufferGeometry {
  const parts = [
    box(5.4, 3.2, 9, '#ffffff', 0, 2.6, 0, 1),
    roof(5.4, 6.2, 2.4, '#3b3a3c', 4.2, true),
    quad(3.2, 2.7, '#3a2f2a', 0, 2.35, 4.53),
    quad(3.6, 3.1, '#e6e0d6', 0, 2.4, 4.51),
  ];
  for (const x of [-2.4, 2.4])
    for (const z of [-3.8, 0, 3.8]) parts.push(box(0.35, 3, 0.35, '#4a3b33', x, -0.4, z));
  return topLit(mergeGeometries(parts)!, 0.8, 1.06);
}

/** A jetty (~70 tris): a plank deck 20 m long on paired posts, with a bollard at its end. */
export function jettyGeometry(): THREE.BufferGeometry {
  const parts = [box(2.4, 0.3, 20, '#8a7560', 0, 1.25, 0)];
  for (let z = -8; z <= 9; z += 4.2)
    for (const x of [-1.05, 1.05]) parts.push(box(0.3, 3.4, 0.3, '#4a3b33', x, -0.4, z));
  parts.push(
    box(0.35, 0.6, 0.35, '#3a3330', 0.8, 1.7, 9.4),
    box(0.35, 0.6, 0.35, '#3a3330', -0.8, 1.7, 9.4),
  );
  return topLit(mergeGeometries(parts)!, 0.8, 1.05);
}

/**
 * A fish-drying rack (hjell, ~90 tris): a long timber frame of A-trestles and poles, hung
 * with rows of pale stockfish. 12 m long (x), 3.3 m high.
 */
export function rackGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (const x of [-5.8, 0, 5.8]) {
    for (const s of [-1, 1]) {
      const leg = new THREE.CylinderGeometry(0.1, 0.12, 3.6, 4).rotateX(s * 0.32);
      parts.push(fx(colored(leg, '#5b4a3e', 1.6).translate(x, 0, s * 0.55), 0));
    }
  }
  for (const y of [3.2, 2.2])
    parts.push(
      fx(
        colored(new THREE.CylinderGeometry(0.08, 0.08, 12.4, 4).rotateZ(Math.PI / 2), '#6b5848', y),
        0,
      ),
    );
  // Fish hang in pairs from the poles: thin pale slabs, a grey-gold drying colour.
  for (const [y, z] of [
    [2.6, 0.18],
    [2.6, -0.18],
    [1.6, 0.42],
    [1.6, -0.42],
  ]) {
    const fish = new THREE.BoxGeometry(11.6, 1.05, 0.08);
    parts.push(
      fx(
        painted(
          fish,
          (x, py, _z, out) =>
            out.set(Math.sin(x * 9) > 0.2 ? '#c9b98f' : '#a99a74').multiplyScalar(0.85 + py * 0.25),
          y,
        ),
        0,
      ).translate(0, 0, z),
    );
  }
  return mergeGeometries(parts)!;
}

/**
 * A small fishing boat (~110 tris): a round-bilged hull (white with the instance's paint on
 * the sheer strake), a wheelhouse aft and a short mast forward. 8.5 m long along z (bow +z).
 */
export function boatGeometry(): THREE.BufferGeometry {
  // A box bent into a hull: narrowing to the keel, pinched to a bow (+z) and a fuller stern,
  // the sheer rising forward.
  const hull = new THREE.BoxGeometry(1, 1, 1, 2, 2, 6);
  const pos = hull.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const t = pos.getZ(i) * 2;
    const yy = pos.getY(i) + 0.5;
    const pinch = 1 - 0.85 * smoothstep(0.25, 1, t) - 0.2 * smoothstep(0.5, 1, -t);
    const w = 2.8 * pinch * (0.4 + 0.6 * Math.sqrt(yy));
    pos.setXYZ(
      i,
      pos.getX(i) * w,
      yy * 1.7 - 0.75 + 0.4 * smoothstep(0.3, 1, t) * yy,
      pos.getZ(i) * 8.5,
    );
  }
  const hg = painted(hull, (_x, y, _z, out) =>
    out.set(y < -0.1 ? '#7a2a2a' : y < 0.55 ? '#f2efe8' : '#2f3a46'),
  );
  const parts = [
    fx(hg, 0),
    box(2.6, 0.22, 7.2, '#ffffff', 0, 0.72, -0.2, 1),
    box(2.1, 1.7, 2.2, '#efeae0', 0, 1.7, -1.8),
    box(2.3, 0.18, 2.5, '#2f3a46', 0, 2.62, -1.8),
    quad(1.4, 0.55, '#2c3442', 0, 2.05, -0.69, 0, 1),
    fx(
      colored(new THREE.CylinderGeometry(0.07, 0.09, 4.2, 4), '#d8d2c4', 2.9).translate(0, 0, 1.6),
      0,
    ),
    fx(
      colored(
        new THREE.CylinderGeometry(0.05, 0.05, 2.4, 3).rotateZ(Math.PI / 2),
        '#d8d2c4',
        3.6,
      ).translate(0, 0, 1.6),
      0,
    ),
  ];
  return topLit(mergeGeometries(parts)!, 0.84, 1.06);
}

/** A boulder: a smooth lumpy stone (detail 1, ~80 tris) or a cheap far one (~20). */
export function boulderGeometry(detail: number): THREE.BufferGeometry {
  const g = jitter(new THREE.IcosahedronGeometry(1, detail), 0.42, 31);
  g.scale(1.15, 0.7, 0.95);
  const stone = new THREE.Color('#8a8d92');
  const lichen = new THREE.Color('#a4a78e');
  const out = topLit(
    painted(
      g,
      (x, y, _z, c) =>
        c.copy(stone).lerp(lichen, smoothstep(0.2, 0.7, y) * (0.5 + 0.5 * Math.sin(x * 5))),
      0.3,
    ),
    0.66,
    1.12,
  );
  if (detail > 0) {
    // Smooth shading on the near stone: rounded, not faceted.
    out.deleteAttribute('normal');
    const merged = mergeVerts(out);
    return fx(merged, 0);
  }
  return fx(out, 0);
}

/** Weld coincident vertices (keeping their colours) and smooth the normals. */
function mergeVerts(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const pos = g.getAttribute('position');
  const col = g.getAttribute('color');
  const normals = new Float32Array(pos.count * 3);
  const keyOf = (i: number) =>
    `${Math.round(pos.getX(i) * 500)},${Math.round(pos.getY(i) * 500)},${Math.round(pos.getZ(i) * 500)}`;
  const acc = new Map<string, [number, number, number]>();
  const a = new THREE.Vector3();
  const b = new THREE.Vector3();
  const c = new THREE.Vector3();
  for (let i = 0; i < pos.count; i += 3) {
    a.fromBufferAttribute(pos, i);
    b.fromBufferAttribute(pos, i + 1);
    c.fromBufferAttribute(pos, i + 2);
    const n = b.sub(a).cross(c.sub(a));
    for (let k = 0; k < 3; k++) {
      const key = keyOf(i + k);
      const s = acc.get(key) ?? [0, 0, 0];
      s[0] += n.x;
      s[1] += n.y;
      s[2] += n.z;
      acc.set(key, s);
    }
  }
  for (let i = 0; i < pos.count; i++) {
    const s = acc.get(keyOf(i))!;
    const l = Math.hypot(s[0], s[1], s[2]) || 1;
    normals.set([s[0] / l, s[1] / l, s[2] / l], i * 3);
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', pos);
  out.setAttribute('color', col);
  out.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
  return out;
}

/** Smooth-shaded copy of a non-indexed geometry (shared corners average their face normals). */
export function smooth(g: THREE.BufferGeometry): THREE.BufferGeometry {
  return mergeVerts(g);
}

/** A harbour seal hauled out (~50 tris): a plump grey body, its head raised, lying along z. */
export function sealGeometry(): THREE.BufferGeometry {
  const body = new THREE.SphereGeometry(0.42, 8, 5);
  body.scale(1, 0.8, 2.6);
  const head = new THREE.SphereGeometry(0.24, 6, 4).translate(0, 0.35, 1.05);
  const tail = new THREE.ConeGeometry(0.22, 0.6, 5).rotateX(-Math.PI / 2).translate(0, 0, -1.3);
  const grey = new THREE.Color('#6d7178');
  const belly = new THREE.Color('#b7b3a8');
  const paint = (g: THREE.BufferGeometry) =>
    painted(
      g,
      (x, y, z, out) =>
        out
          .copy(belly)
          .lerp(grey, smoothstep(-0.2, 0.15, y))
          .multiplyScalar(0.92 + 0.12 * Math.sin(x * 9 + z * 7)),
      0.3,
    );
  return fx(smooth(mergeGeometries([paint(body), paint(head), paint(tail)])!), 0);
}

/**
 * A seabird (~10 tris): a white body and two wings with dark tips that flap (`wing` by |x|).
 * The eagle is the same bird, larger and painted brown by its instance colour.
 */
export function birdGeometry(): THREE.BufferGeometry {
  const wing = (s: number) => {
    const g = new THREE.BufferGeometry();
    const p = [
      0,
      0,
      0.3,
      s * 0.9,
      0.05,
      0.05,
      0,
      0,
      -0.25,
      0,
      0,
      -0.25,
      s * 0.9,
      0.05,
      0.05,
      s * 1.6,
      0.08,
      -0.3,
    ];
    g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
    return painted(g, (x, _y, _z, out) => out.set(Math.abs(x) > 1.2 ? '#2d2c30' : '#f1f0ec'));
  };
  const body = painted(
    new THREE.ConeGeometry(0.17, 1.1, 4).rotateX(Math.PI / 2),
    (_x, _y, _z, out) => out.set('#f4f3ef'),
  );
  const g = mergeGeometries([wing(1), wing(-1), body])!;
  return fx(g, 1, 0, (x) => Math.min(Math.abs(x) / 1.6, 1));
}

/** Crowberry (cover, ~24 tris): a low, dark mat of evergreen sprigs with black berries. */
export function crowberryGeometry(): THREE.BufferGeometry {
  const g = jitter(new THREE.IcosahedronGeometry(0.42, 0), 0.18, 41);
  g.scale(1.3, 0.42, 1.1);
  return painted(
    g,
    (x, y, z, out) =>
      out.set(Math.sin(x * 23 + z * 17) > 0.75 ? '#1d1a24' : y > 0.05 ? '#3d5a34' : '#2c4428'),
    0.08,
  );
}

/** A moss cushion (cover, ~20 tris): a soft yellow-green hummock. */
export function mossGeometry(): THREE.BufferGeometry {
  const g = jitter(new THREE.IcosahedronGeometry(0.38, 0), 0.12, 43);
  g.scale(1.4, 0.38, 1.2);
  const lo = new THREE.Color('#6e8a3c');
  const hi = new THREE.Color('#a8b85a');
  return painted(g, (_x, y, _z, out) => out.copy(lo).lerp(hi, smoothstep(-0.05, 0.12, y)), 0.04);
}
