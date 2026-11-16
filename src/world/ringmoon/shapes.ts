import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { smoothstep } from '../../core/math';
import { mulberry32 } from '../noise';
import { jitter, painted } from '../Trees';
import { glowing } from './materials';
import { OUT_AWNING, OUT_SKIFF, OUT_STRIDE, type RingmoonLayout } from './RingmoonLayout';

/**
 * Ringmoon Shallows' smaller shapes, all in one family with the landing pods (ivory shell,
 * copper, teal light): the explorers' habs, masts and lamps, the camp's awning and skiff; the
 * life (glowing fish, grazers, floaters) with their `aAnim` for the life material; glow bulbs
 * and basalt steps; the ground cover's moss cushions, trumpet flowers and spore puffs. Glowing
 * parts carry `aGlow` (see materials.ts). Units are metres; local +z is a thing's front.
 */

const IVORY = new THREE.Color('#e8dfc8');
const IVORY_SHADE = new THREE.Color('#b9ad94');
const COPPER = new THREE.Color('#c0703a');
const COPPER_DARK = new THREE.Color('#7a4026');
const STRUT = new THREE.Color('#5d5752');
const TEAL_LIGHT = new THREE.Color('#8ff0dc');
const WARM_LIGHT = new THREE.Color('#ffd79a');
const AWNING = new THREE.Color('#d98a52');
/** The habs' fabric shell: paler than the pods' ivory, so they read white in the sun. */
const SHELL = new THREE.Color('#f4efe2');

type Paint = (x: number, y: number, z: number, out: THREE.Color) => void;
const flat =
  (c: THREE.Color): Paint =>
  (_x, _y, _z, o) =>
    o.copy(c);

/** A part: non-indexed, painted, with its glow (a constant or per vertex). */
function part(
  g: THREE.BufferGeometry,
  paint: Paint,
  glow: number | ((x: number, y: number, z: number) => number) = 0,
): THREE.BufferGeometry {
  const p = painted(g, paint);
  return glowing(p, typeof glow === 'number' ? () => glow : glow);
}

/** Merge parts that all carry position, normal, colour and aGlow (and aAnim if any). */
function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  return mergeGeometries(parts)!;
}

/** A stick from a to b: a tapered cylinder of `sides`. */
function stick(
  a: THREE.Vector3,
  b: THREE.Vector3,
  r0: number,
  r1: number,
  sides: number,
): THREE.BufferGeometry {
  const len = a.distanceTo(b);
  const g = new THREE.CylinderGeometry(r1, r0, len, sides, 1, true);
  g.applyQuaternion(
    new THREE.Quaternion().setFromUnitVectors(
      new THREE.Vector3(0, 1, 0),
      b.clone().sub(a).normalize(),
    ),
  );
  g.translate((a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2);
  return g;
}

/** A surface of revolution from (radius, height) points, smooth-shaded, `seg` sides. */
function lathe(pts: [number, number][], seg: number): THREE.BufferGeometry {
  const g = new THREE.LatheGeometry(
    pts.map(([r, y]) => new THREE.Vector2(r, y)),
    seg,
  );
  g.deleteAttribute('uv');
  g.computeVertexNormals();
  const ng = g.toNonIndexed();
  return ng;
}

/** As `part`, keeping the geometry's own smooth normals (painted() would facet them). */
function smoothPart(
  g: THREE.BufferGeometry,
  paint: Paint,
  glow: number | ((x: number, y: number, z: number) => number) = 0,
): THREE.BufferGeometry {
  const ng = g.index ? g.toNonIndexed() : g;
  if (!ng.getAttribute('normal')) ng.computeVertexNormals();
  const pos = ng.getAttribute('position');
  const col = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    paint(pos.getX(i), pos.getY(i), pos.getZ(i), c);
    col.set([c.r, c.g, c.b], i * 3);
  }
  ng.setAttribute('color', new THREE.BufferAttribute(col, 3));
  if (ng.getAttribute('uv')) ng.deleteAttribute('uv');
  return glowing(ng, typeof glow === 'number' ? () => glow : glow);
}

// --- The explorers ---------------------------------------------------------------------------

/**
 * A hab: a low ivory dome on a pad, a copper band round its foot, round windows lit teal, a
 * short entry tunnel with a lit door facing +z, crates stacked beside it and a whip aerial.
 * ~3.6 m to the aerial's tip.
 */
export function habGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  parts.push(
    part(new THREE.CylinderGeometry(4.1, 4.3, 0.3, 10).translate(0, 0.15, 0), flat(STRUT)),
  );
  const dome = lathe(
    [
      [3.3, 0.25],
      [3.28, 0.9],
      [3.05, 1.6],
      [2.5, 2.3],
      [1.5, 2.8],
      [0.01, 3.0],
    ],
    12,
  );
  parts.push(
    smoothPart(dome, (x, y, z, o) => {
      o.copy(SHELL).lerp(IVORY, 0.3 + 0.3 * Math.sin(Math.atan2(z, x) * 6));
      if (y > 0.55 && y < 0.95) o.copy(COPPER);
      if (y < 0.4) o.copy(COPPER_DARK);
    }),
  );
  for (const a of [1.1, -1.1, Math.PI]) {
    const w = new THREE.IcosahedronGeometry(0.42, 0).scale(1, 1, 0.35);
    w.rotateY(a).translate(Math.sin(a) * 2.95, 1.55, Math.cos(a) * 2.95);
    parts.push(part(w, flat(TEAL_LIGHT), 1));
  }
  // The entry tunnel and its door.
  parts.push(part(new THREE.BoxGeometry(1.7, 1.9, 1.5).translate(0, 1.2, 3.4), flat(IVORY_SHADE)));
  parts.push(part(new THREE.BoxGeometry(1.9, 0.25, 1.7).translate(0, 2.2, 3.4), flat(COPPER)));
  parts.push(
    part(new THREE.BoxGeometry(0.9, 1.4, 0.08).translate(0, 1.0, 4.16), flat(WARM_LIGHT), 1),
  );
  // Crates by the door.
  const crate = (s: number, x: number, y: number, z: number, yaw: number, c: THREE.Color) =>
    part(new THREE.BoxGeometry(s, s * 0.8, s).rotateY(yaw).translate(x, y + s * 0.4, z), flat(c));
  parts.push(crate(1.1, 2.5, 0.3, 4.0, 0.2, COPPER_DARK));
  parts.push(crate(0.9, 2.6, 1.18, 3.9, -0.3, IVORY_SHADE));
  parts.push(crate(0.9, 3.7, 0.3, 3.2, 0.5, STRUT));
  parts.push(
    part(
      stick(new THREE.Vector3(-1.2, 2.5, -0.8), new THREE.Vector3(-1.2, 3.6, -0.8), 0.05, 0.03, 3),
      flat(STRUT),
    ),
  );
  return merge(parts);
}

/**
 * A mast: a tripod, a slim pole with copper collars, a dish turned to the sky (toward +z) and a
 * light at the tip that pulses after dark. 7.6 m.
 */
export function mastGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const top = new THREE.Vector3(0, 2.4, 0);
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2 + 0.4;
    const foot = new THREE.Vector3(Math.sin(a) * 1.7, 0, Math.cos(a) * 1.7);
    parts.push(part(stick(foot, top, 0.09, 0.06, 4), flat(STRUT)));
  }
  parts.push(
    part(
      stick(new THREE.Vector3(0, 0.2, 0), new THREE.Vector3(0, 7.3, 0), 0.17, 0.1, 6),
      flat(IVORY),
    ),
  );
  for (const y of [2.4, 4.6]) {
    parts.push(
      part(new THREE.CylinderGeometry(0.26, 0.26, 0.3, 6).translate(0, y, 0), flat(COPPER)),
    );
  }
  const dish = new THREE.ConeGeometry(1.35, 0.55, 10, 1, true).rotateX(Math.PI);
  dish.rotateX(-0.75).translate(0, 5.6, 0.45);
  parts.push(
    part(dish, (_x, y, _z, o) => o.copy(IVORY).lerp(IVORY_SHADE, smoothstep(5.2, 6.2, y))),
  );
  parts.push(
    part(
      stick(new THREE.Vector3(0, 5.5, 0.4), new THREE.Vector3(0, 6.3, 1.2), 0.04, 0.03, 3),
      flat(COPPER_DARK),
    ),
  );
  parts.push(part(new THREE.OctahedronGeometry(0.24).translate(0, 7.45, 0), flat(TEAL_LIGHT), 2));
  return merge(parts);
}

/** A path lamp: a slim post with a glowing teal head. 1.7 m. */
export function lampGeometry(): THREE.BufferGeometry {
  return merge([
    part(
      stick(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 1.45, 0), 0.07, 0.05, 4),
      flat(STRUT),
    ),
    part(
      new THREE.OctahedronGeometry(0.17).scale(1, 1.3, 1).translate(0, 1.55, 0),
      flat(TEAL_LIGHT),
      1,
    ),
    part(new THREE.ConeGeometry(0.2, 0.16, 4).translate(0, 1.78, 0), flat(COPPER)),
  ]);
}

/**
 * The camp's one-off things, in world space from the layout: an awning on four poles over a
 * table and crates, and a skiff moored off the beach. One merged mesh.
 */
export function campGeometry(L: RingmoonLayout): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const Q = L.campSite.parts;
  const m = new THREE.Matrix4();
  for (let k = 0; k < Q.length; k += OUT_STRIDE) {
    const kind = Q[k];
    if (kind !== OUT_AWNING && kind !== OUT_SKIFF) continue;
    const x = Q[k + 1];
    const z = Q[k + 2];
    const yaw = Q[k + 3];
    const s = Q[k + 4];
    const local: THREE.BufferGeometry[] = [];
    if (kind === OUT_AWNING) {
      for (const [px, pz] of [
        [-2.8, -1.8],
        [2.8, -1.8],
        [-2.8, 1.8],
        [2.8, 1.8],
      ])
        local.push(
          part(
            stick(new THREE.Vector3(px, 0, pz), new THREE.Vector3(px, 2.5, pz), 0.07, 0.06, 4),
            flat(STRUT),
          ),
        );
      // The sheet sags between the poles; both windings so it reads from under it.
      const sheet = new THREE.PlaneGeometry(6.4, 4.4, 2, 1).rotateX(-Math.PI / 2);
      const sp = sheet.getAttribute('position');
      for (let i = 0; i < sp.count; i++) sp.setY(i, 2.6 - (Math.abs(sp.getX(i)) < 0.1 ? 0.25 : 0));
      const back = sheet.clone();
      back.index!.array.reverse();
      for (const g of [sheet, back]) local.push(part(g, flat(AWNING)));
      local.push(
        part(new THREE.BoxGeometry(2.2, 0.12, 1.1).translate(0, 0.9, 0), flat(IVORY_SHADE)),
      );
      local.push(part(new THREE.BoxGeometry(0.1, 0.85, 0.9).translate(0, 0.43, 0), flat(STRUT)));
      local.push(
        part(
          new THREE.BoxGeometry(1.0, 0.8, 1.0).rotateY(0.3).translate(-1.9, 0.4, 0.6),
          flat(COPPER_DARK),
        ),
      );
      local.push(
        part(
          new THREE.BoxGeometry(0.8, 0.7, 0.8).rotateY(-0.2).translate(-1.9, 1.15, 0.6),
          flat(IVORY_SHADE),
        ),
      );
      local.push(
        part(new THREE.OctahedronGeometry(0.16).translate(0.6, 1.1, 0), flat(WARM_LIGHT), 1),
      );
    } else {
      // A little skiff: a pointed ivory hull with a copper rail and a lit lamp at the bow.
      const hull = lathe(
        [
          [0.01, -2.6],
          [0.55, -2.0],
          [0.85, -0.6],
          [0.85, 1.2],
          [0.5, 2.2],
          [0.01, 2.6],
        ],
        8,
      );
      hull.rotateX(Math.PI / 2).scale(1, 0.5, 1);
      local.push(
        smoothPart(hull, (_x, y, _z, o) =>
          o.copy(y > 0.1 ? COPPER : IVORY).lerp(IVORY_SHADE, y < -0.2 ? 0.4 : 0),
        ),
      );
      local.push(part(new THREE.BoxGeometry(0.9, 0.35, 1.2).translate(0, 0.35, -0.6), flat(IVORY)));
      local.push(
        part(new THREE.OctahedronGeometry(0.13).translate(0, 0.55, 2.0), flat(WARM_LIGHT), 1),
      );
    }
    const y = kind === OUT_SKIFF ? 0.05 : L.height(x, z) - 0.05;
    m.makeRotationY(yaw)
      .scale(new THREE.Vector3(s, s, s))
      .setPosition(x, y, z);
    for (const g of local) parts.push(g.applyMatrix4(m));
  }
  return merge(parts);
}

// --- Glow bulbs and basalt steps -------------------------------------------------------------

/** A cluster of glow bulbs: three pale bulbs (the instance tints them) nodding on dark stalks. */
export function bulbsGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const stalk = new THREE.Color('#2c4f55');
  const rand = mulberry32(41);
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2 + rand();
    const d = k === 0 ? 0 : 0.35 + rand() * 0.2;
    const h = 0.55 + rand() * 0.75;
    const base = new THREE.Vector3(Math.cos(a) * d, 0, Math.sin(a) * d);
    const tip = base.clone().add(new THREE.Vector3(Math.cos(a) * 0.25, h, Math.sin(a) * 0.25));
    parts.push(part(stick(base, tip, 0.05, 0.03, 3), flat(stalk)));
    const r = 0.18 + 0.1 * rand();
    const b = new THREE.IcosahedronGeometry(r, 0)
      .scale(1, 1.25, 1)
      .translate(tip.x, tip.y + r, tip.z);
    parts.push(
      smoothPart(
        b,
        (_x, y, _z, o) =>
          o
            .setRGB(0.92, 0.95, 0.95)
            .multiplyScalar(0.85 + 0.25 * smoothstep(tip.y, tip.y + 2 * r, y)),
        1,
      ),
    );
  }
  const g = merge(parts);
  g.computeVertexNormals();
  return g;
}

/**
 * Basalt steps on a terrace riser: a cluster of hexagonal column stubs, the back row tallest,
 * stepping down toward +z (the downhill side). ~1.7 m at scale 1, sunk 0.6 m into the slope.
 */
export function stepsGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const rand = mulberry32(53);
  const top = new THREE.Color('#8c8798');
  const side = new THREE.Color('#4f4c63');
  const rows: [number, number, number][] = [
    [-0.8, -1.2, 2.2],
    [0.8, -1.2, 1.9],
    [0, 0.2, 1.5],
    [-1.55, 0.2, 1.25],
    [0.8, 1.5, 0.85],
  ];
  for (const [x, z, h] of rows) {
    const hh = h * (0.9 + 0.2 * rand());
    const g = new THREE.CylinderGeometry(0.82, 0.86, hh, 6).rotateY(
      Math.PI / 6 + (rand() - 0.5) * 0.12,
    );
    g.translate(x, hh / 2 - 0.6, z);
    parts.push(
      part(g, (_x, y, _z, o) => o.copy(side).lerp(top, smoothstep(hh - 0.62, hh - 0.58, y))),
    );
  }
  return merge(parts);
}

// --- Life ------------------------------------------------------------------------------------

/** Attach `aAnim` (kind, weight per vertex) to a merged, non-indexed geometry. */
function animated(
  g: THREE.BufferGeometry,
  kind: number,
  weight: (x: number, y: number, z: number) => number,
): THREE.BufferGeometry {
  const pos = g.getAttribute('position');
  const a = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    a[i * 2] = kind;
    a[i * 2 + 1] = weight(pos.getX(i), pos.getY(i), pos.getZ(i));
  }
  g.setAttribute('aAnim', new THREE.BufferAttribute(a, 2));
  return g;
}

/** A school of seven slim fish, pale with glowing cyan flanks, swimming toward +z. */
export function fishSchoolGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const rand = mulberry32(61);
  const back = new THREE.Color('#2e5f70');
  const flank = new THREE.Color('#9ff6e6');
  for (let k = 0; k < 7; k++) {
    const x = (rand() - 0.5) * 3.2;
    const y = (rand() - 0.5) * 0.5;
    const z = (rand() - 0.5) * 4;
    const s = 0.7 + rand() * 0.5;
    const body = new THREE.OctahedronGeometry(0.22).scale(0.55, 0.8, 2.4);
    const tail = new THREE.BufferGeometry();
    tail.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(
        [0, 0, -0.45, 0, 0.18, -0.8, 0, -0.18, -0.8, 0, 0, -0.45, 0, -0.18, -0.8, 0, 0.18, -0.8],
        3,
      ),
    );
    for (const [g, w] of [
      [body, 0.3],
      [tail, 1],
    ] as const) {
      g.scale(s, s, s).translate(x, y, z);
      const pg = part(
        g,
        (_px, py, _pz, o) => o.copy(py > y + 0.05 * s ? back : flank),
        (_px, py) => (py > y + 0.05 * s ? 0.1 : 0.9),
      );
      parts.push(animated(pg, 1, () => w));
    }
  }
  return merge(parts);
}

/**
 * A grazer: a gentle, pale six-legged beast about 4.5 m long, a broad body with a violet frill
 * down its back, a long neck reaching forward to a small blunt head that sweeps the moss.
 * Neck and head carry anim weight 1; the legs 2 and 3 (they swing in two alternating sets).
 */
export function grazerGeometry(): THREE.BufferGeometry {
  const hide = new THREE.Color('#d8cdb8');
  const back = new THREE.Color('#8f7c9c');
  const belly = new THREE.Color('#efe6d2');
  const frill = new THREE.Color('#9a6ad0');
  const legC = new THREE.Color('#6d6270');
  const parts: { g: THREE.BufferGeometry; w: number }[] = [];
  const body = new THREE.SphereGeometry(1, 10, 7).scale(1.05, 0.85, 2.0).translate(0, 1.75, 0);
  parts.push({
    g: smoothPart(body, (_x, y, _z, o) =>
      o
        .copy(belly)
        .lerp(hide, smoothstep(1.2, 1.8, y))
        .lerp(back, smoothstep(2.1, 2.6, y)),
    ),
    w: 0,
  });
  for (let k = 0; k < 5; k++) {
    const z = 1.0 - k * 0.55;
    const h = 0.55 - Math.abs(k - 1.5) * 0.1;
    const fin = new THREE.BufferGeometry();
    fin.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(
        [
          0,
          2.45,
          z + 0.3,
          0,
          2.45 + h,
          z - 0.15,
          0,
          2.45,
          z - 0.35,
          0,
          2.45,
          z + 0.3,
          0,
          2.45,
          z - 0.35,
          0,
          2.45 + h,
          z - 0.15,
        ],
        3,
      ),
    );
    parts.push({ g: part(fin, flat(frill), 0.35), w: 0 });
  }
  const neck0 = new THREE.Vector3(0, 1.95, 1.3);
  const neck1 = new THREE.Vector3(0, 2.7, 2.5);
  parts.push({ g: part(stick(neck0, neck1, 0.42, 0.26, 5), flat(hide)), w: 1 });
  const head = new THREE.IcosahedronGeometry(0.38, 0)
    .scale(0.85, 0.75, 1.3)
    .translate(0, 2.75, 2.9);
  parts.push({
    g: part(head, (_x, y, _z, o) => o.copy(hide).lerp(back, smoothstep(2.7, 3.0, y))),
    w: 1,
  });
  parts.push({
    g: part(new THREE.OctahedronGeometry(0.07).translate(0.25, 2.85, 3.05), flat(TEAL_LIGHT), 0.8),
    w: 1,
  });
  parts.push({
    g: part(new THREE.OctahedronGeometry(0.07).translate(-0.25, 2.85, 3.05), flat(TEAL_LIGHT), 0.8),
    w: 1,
  });
  for (let k = 0; k < 3; k++)
    for (const side of [1, -1]) {
      const z = 1.1 - k * 1.1;
      const top = new THREE.Vector3(side * 0.7, 1.4, z);
      const foot = new THREE.Vector3(side * 0.95, 0, z);
      // A tripod gait: front and back on one side with the middle on the other.
      const set = (k === 1 ? side > 0 : side < 0) ? 2 : 3;
      parts.push({ g: part(stick(top, foot, 0.2, 0.12, 4), flat(legC)), w: set });
    }
  const geos = parts.map(({ g, w }) => animated(g, 2, () => w));
  return merge(geos);
}

/**
 * A floater: a jelly-like bell 6 m across, violet and rose with a glowing rim, trailing seven
 * ribbon tendrils 8 m down that glow toward their tips. Bell weight 0; tendrils weight 0..1
 * down their length.
 */
export function floaterGeometry(): THREE.BufferGeometry {
  const top = new THREE.Color('#c9a6e6');
  const rim = new THREE.Color('#ffb3d4');
  const inner = new THREE.Color('#7a5fb0');
  const parts: THREE.BufferGeometry[] = [];
  const bell = lathe(
    [
      [3.3, -0.6],
      [3.25, 0.0],
      [2.9, 1.1],
      [2.1, 1.95],
      [1.05, 2.4],
      [0.01, 2.5],
    ],
    12,
  );
  parts.push(
    smoothPart(
      bell,
      (_x, y, _z, o) => o.copy(rim).lerp(top, smoothstep(-0.3, 1.2, y)),
      (_x, y) => 0.15 + 0.75 * (1 - smoothstep(-0.6, 0.6, y)),
    ),
  );
  // The bell's underside, a little inside: darker, so it reads hollow from below.
  const under = lathe(
    [
      [0.01, 1.4],
      [1.6, 1.0],
      [2.8, 0.1],
      [3.2, -0.55],
    ],
    12,
  );
  parts.push(smoothPart(under, flat(inner), 0.25));
  const rand = mulberry32(71);
  for (let k = 0; k < 7; k++) {
    const a = (k / 7) * Math.PI * 2 + rand() * 0.4;
    const r = k === 0 ? 0 : 1.2 + rand() * 1.3;
    const len = 6 + rand() * 4;
    const pos: number[] = [];
    const segs = 5;
    const w = 0.22;
    const bx = Math.cos(a + 1.57) * w;
    const bz = Math.sin(a + 1.57) * w;
    const x0 = Math.cos(a) * r;
    const z0 = Math.sin(a) * r;
    for (let i = 0; i < segs; i++) {
      const y0 = -0.3 - (len * i) / segs;
      const y1 = -0.3 - (len * (i + 1)) / segs;
      const t0 = 1 - i / segs;
      const t1 = 1 - (i + 1) / segs;
      const q = [
        [x0 - bx * t0, y0, z0 - bz * t0],
        [x0 + bx * t0, y0, z0 + bz * t0],
        [x0 + bx * t1, y1, z0 + bz * t1],
        [x0 - bx * t1, y1, z0 - bz * t1],
      ];
      for (const [i0, i1, i2] of [
        [0, 1, 2],
        [0, 2, 3],
        [0, 2, 1],
        [0, 3, 2],
      ])
        pos.push(...q[i0], ...q[i1], ...q[i2]);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    parts.push(
      part(
        g,
        (_x, y, _z, o) => o.copy(rim).lerp(top, smoothstep(-2, -9, y)),
        (_x, y) => 0.2 + 0.7 * smoothstep(-3, -9, y),
      ),
    );
  }
  const g = merge(parts);
  return animated(g, 3, (_x, y) => (y > -0.4 ? 0 : smoothstep(-0.4, -10, y)));
}

// --- Ground cover shapes (GroundCover's own material: no glow) -------------------------------

/** A moss cushion: a low lumpy dome of violet moss, 0.7 m across, paler on top. */
export function cushionGeometry(): THREE.BufferGeometry {
  const g = jitter(new THREE.IcosahedronGeometry(0.36, 0), 0.08, 5).scale(1, 0.55, 1);
  return painted(g, (_x, y, _z, o) =>
    o.setRGB(0.42, 0.3, 0.6).lerp(new THREE.Color(0.66, 0.52, 0.82), smoothstep(-0.1, 0.2, y)),
  );
}

/** A trumpet flower: a curving teal stalk with a flaring bell at its tip, lit gold inside. */
export function trumpetGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const a = new THREE.Vector3(0, 0, 0);
  const b = new THREE.Vector3(0.08, 0.45, 0);
  const c = new THREE.Vector3(0.28, 0.75, 0);
  parts.push(painted(stick(a, b, 0.035, 0.03, 3), (_x, _y, _z, o) => o.setRGB(0.12, 0.38, 0.36)));
  parts.push(painted(stick(b, c, 0.03, 0.025, 3), (_x, _y, _z, o) => o.setRGB(0.14, 0.42, 0.38)));
  const bell = new THREE.ConeGeometry(0.17, 0.3, 6, 1, true);
  bell.rotateZ(-Math.PI / 2 - 0.6).translate(0.4, 0.82, 0);
  parts.push(
    painted(bell, (x, _y, _z, o) =>
      o.setRGB(0.95, 0.55, 0.8).lerp(new THREE.Color(1, 0.86, 0.5), smoothstep(0.42, 0.3, x)),
    ),
  );
  return mergeGeometries(parts)!;
}

/** Spore puffs: three pale round caps on short stalks, rising out of the moss. */
export function puffsGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const rand = mulberry32(83);
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2 + rand();
    const d = k === 0 ? 0 : 0.18;
    const h = 0.2 + rand() * 0.25;
    const x = Math.cos(a) * d;
    const z = Math.sin(a) * d;
    parts.push(
      painted(
        stick(new THREE.Vector3(x, 0, z), new THREE.Vector3(x, h, z), 0.03, 0.025, 3),
        (_x, _y, _z, o) => o.setRGB(0.8, 0.78, 0.66),
      ),
    );
    const r = 0.08 + rand() * 0.05;
    parts.push(
      painted(
        new THREE.OctahedronGeometry(r, 0).scale(1, 0.8, 1).translate(x, h + r * 0.6, z),
        (_x, y, _z, o) =>
          o
            .setRGB(0.95, 0.92, 0.82)
            .lerp(new THREE.Color(0.75, 0.95, 0.88), smoothstep(h, h + r, y)),
      ),
    );
  }
  return mergeGeometries(parts)!;
}
