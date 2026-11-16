import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { smoothstep } from '../../core/math';
import { hipGeometry } from '../city/geometry';
import { colored, jitter, painted, topLit } from '../Trees';

/**
 * Sea of Clouds' props, in metres, painted with vertex colours: the ledge cover (moss
 * cushions, alpine grass, snow, boulders, dwarf pines), the hermits' alcove huts and summit
 * pavilions, the monastery stair, rope-bridge and prayer-flag segments, cranes and lit windows.
 * Animated parts carry `aAnim` (kind, weight) for the props material: 1 a flag fluttering
 * (weight down the cloth), 2 a crane's wing (weight out to the tip).
 */

/** Give a geometry the `aAnim` attribute (kind, weight from a function of the vertex). */
function anim(
  g: THREE.BufferGeometry,
  kind: number,
  weight: (x: number, y: number, z: number) => number = () => 0,
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

/** Still props: aAnim all zero. */
function still(g: THREE.BufferGeometry): THREE.BufferGeometry {
  return anim(g, 0);
}

function box(w: number, h: number, d: number, hex: string, x = 0, y = 0, z = 0) {
  return colored(new THREE.BoxGeometry(w, h, d), hex).translate(x, y, z);
}

/** A cushion of moss on a ledge (~1.6 m across at scale 1, 20 triangles), darker underneath. */
export function mossGeometry(): THREE.BufferGeometry {
  const dark = new THREE.Color('#3e5a35');
  const lit = new THREE.Color('#7d9a4c');
  const g = jitter(new THREE.IcosahedronGeometry(0.8, 0), 0.3, 11).scale(1.1, 0.42, 0.9);
  return still(painted(g, (_x, y, _z, out) => out.copy(dark).lerp(lit, smoothstep(-0.2, 0.3, y))));
}

/** A clump of alpine grass: three crossed fans of blades, straw-tipped (~18 triangles). */
export function grassGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const base = new THREE.Color('#5d7438');
  const tip = new THREE.Color('#c7b56d');
  for (let i = 0; i < 3; i++) {
    const g = new THREE.BufferGeometry();
    const v: number[] = [];
    for (let k = -1; k <= 1; k++) {
      const lean = k * 0.35;
      v.push(
        k * 0.18 - 0.07,
        0,
        0,
        k * 0.18 + 0.07,
        0,
        0,
        k * 0.18 + lean,
        0.9 - Math.abs(k) * 0.2,
        0,
      );
    }
    g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
    g.rotateY((i / 3) * Math.PI);
    parts.push(painted(g, (_x, y, _z, out) => out.copy(base).lerp(tip, smoothstep(0.2, 0.85, y))));
  }
  return still(mergeGeometries(parts)!);
}

/** A patch of old snow lying on a ledge: a lumpy lens, blue in its shade (~16 triangles). */
export function snowGeometry(): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(1, 1.15, 0.35, 8, 1);
  jitter(g, 0.35, 23);
  const shade = new THREE.Color('#bccbe2');
  const lit = new THREE.Color('#f6f8fc');
  return still(
    painted(g, (_x, y, _z, out) => out.copy(shade).lerp(lit, smoothstep(-0.1, 0.17, y))),
  );
}

/** A granite boulder: detail 0 is 20 faces, 1 is 80. Rounded by weather, flat-bottomed. */
export function boulderGeometry(detail: 0 | 1): THREE.BufferGeometry {
  const g = jitter(new THREE.IcosahedronGeometry(1, detail), detail ? 0.22 : 0.3, 31);
  const pos = g.getAttribute('position');
  for (let i = 0; i < pos.count; i++) pos.setY(i, Math.max(pos.getY(i) * 0.75, -0.25));
  const dark = new THREE.Color('#7d7671');
  const lit = new THREE.Color('#b5ada3');
  const moss = new THREE.Color('#6f8a4c');
  return still(
    painted(
      g,
      (x, y, z, out) => {
        out.copy(dark).lerp(lit, smoothstep(-0.3, 0.5, y));
        out.lerp(
          moss,
          smoothstep(0.45, 0.7, y) * smoothstep(-0.2, 0.6, Math.sin(x * 3 + z * 2)) * 0.7,
        );
      },
      0.2,
    ),
  );
}

/**
 * A dwarf pine clinging to a ledge (krummholz): a stub of trunk under two or three wind-flattened
 * pads, all leaning one way (+x). `near` adds lumpier pads (~70 triangles against ~30).
 */
export function dwarfPineGeometry(near: boolean): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [
    colored(
      new THREE.CylinderGeometry(0.12, 0.2, 1.6, 4).translate(0, 0.8, 0).rotateZ(-0.6),
      '#6a5244',
    ),
  ];
  const dark = new THREE.Color('#2f5440');
  const light = new THREE.Color('#5a8a62');
  const pads: [number, number, number, number][] = near
    ? [
        [0.9, 1.25, 0, 1.2],
        [0.3, 0.75, 0.4, 0.95],
        [1.4, 0.95, -0.3, 0.8],
      ]
    : [
        [0.9, 1.2, 0, 1.25],
        [0.4, 0.75, 0.3, 0.95],
      ];
  pads.forEach(([x, y, z, r], i) => {
    const g = near
      ? jitter(new THREE.IcosahedronGeometry(1, 0), 0.3, 60 + i)
      : new THREE.CylinderGeometry(1, 0.8, 0.9, 5);
    g.scale(r, near ? 0.38 : 0.45, r * 0.85);
    parts.push(
      painted(g, (_x, py, _z, out) =>
        out.copy(dark).lerp(light, smoothstep(-0.3, 0.3, py)),
      ).translate(x, y, z),
    );
  });
  return mergeGeometries(parts)!;
}

/** The granite pine past render.treeFar: a trunk stroke under two flat pads (~16 triangles). */
export function pineDistantGeometry(): THREE.BufferGeometry {
  const trunk = new THREE.CylinderGeometry(0.25, 0.45, 6, 3).translate(0, 3, 0).rotateZ(-0.42);
  const pads = [
    colored(new THREE.CylinderGeometry(3.0, 2.4, 1.0, 4), '#3f6b4f').translate(2.8, 5.8, 0),
    colored(new THREE.CylinderGeometry(2.0, 1.6, 0.9, 4), '#3f6b4f').translate(1.6, 4.4, -0.4),
  ];
  return topLit(mergeGeometries([colored(trunk, '#6c5345'), ...pads])!, 0.6, 1.15);
}

/** A dark curved roof (hip) over a w x d footprint, eaves flaring, at height y. */
function roof(w: number, d: number, h: number, y: number, hex = '#3b4247') {
  return colored(hipGeometry(0.3).scale(w, h, d), hex, y);
}

/**
 * A hermit's hut in an alcove under an overhang (front +z, out over the drop): a plank floor on
 * stilts braced back to the rock, timber and whitewash walls, a red door, a dark curved roof.
 * `near` adds the railing, braces and a water jar (~190 triangles against ~70).
 */
export function hutGeometry(near: boolean): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [
    box(3.6, 0.22, 3.6, '#6e5641', 0, -0.11, 0.3),
    box(3.0, 2.3, 2.5, '#e8e1d2', 0, 1.15, -0.2),
    box(0.9, 1.7, 0.08, '#9e3a2f', -0.55, 0.85, 1.08),
    roof(3.9, 3.4, 1.3, 2.3),
  ];
  // Stilts from the floor's outer corners down and back to the rock.
  for (const x of [-1.6, 1.6]) {
    const g = new THREE.CylinderGeometry(0.09, 0.11, 3.2, 4).translate(0, -1.6, 0).rotateX(0.55);
    parts.push(colored(g, '#4f3e31').translate(x, 0, 2.0));
  }
  if (near) {
    // Timber frame on the whitewash, a railing round the floor, a jar by the door.
    for (const x of [-1.5, 1.5]) parts.push(box(0.16, 2.3, 0.16, '#5c4433', x, 1.15, 1.06));
    parts.push(box(3.0, 0.16, 0.16, '#5c4433', 0, 2.2, 1.06));
    parts.push(box(3.6, 0.07, 0.07, '#5c4a3a', 0, 0.9, 2.08));
    for (const x of [-1.75, -0.6, 0.6, 1.75])
      parts.push(box(0.08, 0.9, 0.08, '#5c4a3a', x, 0.45, 2.08));
    parts.push(
      colored(new THREE.CylinderGeometry(0.28, 0.2, 0.55, 6), '#7d5a3e').translate(1.3, 0.28, 1.5),
    );
  }
  return still(mergeGeometries(parts)!);
}

/**
 * A six-post pavilion (a ting) on a summit: a stone plinth, red posts, a flared roof with a
 * gold finial. `near` adds the benches and the roof's second tier (~200 triangles against ~90).
 */
export function pavilionGeometry(near: boolean): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [
    colored(new THREE.CylinderGeometry(2.7, 2.9, 0.45, 6), '#a69f94', 0.22),
  ];
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2;
    parts.push(
      colored(new THREE.CylinderGeometry(0.11, 0.13, 2.5, 4), '#9e3a2f', 1.7).translate(
        Math.cos(a) * 2.2,
        0,
        Math.sin(a) * 2.2,
      ),
    );
  }
  parts.push(colored(new THREE.ConeGeometry(3.4, 1.4, 6, 1, true), '#3b4247', 3.6));
  parts.push(colored(new THREE.CylinderGeometry(3.4, 3.45, 0.15, 6), '#2f363b', 2.95));
  parts.push(colored(new THREE.ConeGeometry(0.16, 0.8, 5), '#c9a64e', 4.6));
  if (near) {
    parts.push(colored(new THREE.ConeGeometry(2.0, 0.9, 6, 1, true), '#3b4247', 4.4));
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI * 2 + 0.5;
      const g = new THREE.BoxGeometry(1.6, 0.12, 0.45).rotateY(-a);
      parts.push(colored(g, '#7a5e45', 0.85).translate(Math.cos(a) * 1.7, 0, Math.sin(a) * 1.7));
    }
  }
  return still(mergeGeometries(parts)!);
}

/** A little stone shrine on a ledge: a stepped plinth, a box with a dark niche, a cap. */
export function shrineGeometry(): THREE.BufferGeometry {
  return still(
    mergeGeometries([
      box(1.0, 0.3, 1.0, '#9c958a', 0, 0.15, 0),
      box(0.62, 0.7, 0.62, '#b3aca0', 0, 0.65, 0),
      box(0.34, 0.36, 0.05, '#3a3633', 0, 0.68, 0.31),
      colored(new THREE.ConeGeometry(0.6, 0.45, 4).rotateY(Math.PI / 4), '#8d867b', 1.22),
    ])!,
  );
}

/**
 * One step of the monastery stair (heading +z): a granite tread over a wall that runs down
 * into the rock, so where the face falls away the stair still stands on something.
 */
export function stepGeometry(): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(2.0, 2.2, 1.1).translate(0, -0.9, 0);
  const dark = new THREE.Color('#857d76');
  const lit = new THREE.Color('#b4aca2');
  return still(painted(g, (_x, y, _z, out) => out.copy(dark).lerp(lit, smoothstep(-0.5, 0.2, y))));
}

/** A stair post: a timber post with a little roofed lamp box on top (lantern sits at y 1.9). */
export function postGeometry(): THREE.BufferGeometry {
  return still(
    mergeGeometries([
      box(0.18, 1.7, 0.18, '#5c4433', 0, 0.85, 0),
      colored(new THREE.ConeGeometry(0.42, 0.35, 4).rotateY(Math.PI / 4), '#3b4247', 2.25),
    ])!,
  );
}

const FLAG_HEX = ['#3d6fb6', '#f1ece2', '#c8443a', '#4c9a5f', '#e5c14b'];
/** The five prayer-flag colours (blue, white, red, green, yellow), as instance tints. */
export const FLAG_COLORS = FLAG_HEX.map((h) => new THREE.Color(h));

/**
 * A length of prayer-flag line, one metre along +x (the instance stretches it to the segment):
 * the cord and one flag hanging from it. White cloth, so the instance's tint is its colour.
 */
export function flagSegmentGeometry(): THREE.BufferGeometry {
  const cloth = colored(new THREE.PlaneGeometry(0.42, 0.62), '#ffffff').translate(0.5, -0.36, 0);
  anim(cloth, 1, (_x, y) => smoothstep(-0.05, -0.67, y));
  const cord = colored(
    new THREE.CylinderGeometry(0.025, 0.025, 1, 3, 1, true).rotateZ(Math.PI / 2),
    '#2a2420',
  ).translate(0.5, 0, 0);
  // Tinted per instance, the cord stays dark (a tint times near-black is near-black).
  return mergeGeometries([cloth, anim(cord, 0)])!;
}

/**
 * A length of rope bridge, one metre along +x: a plank across a 1.5 m deck and rope rails
 * either side at hand height; `near` adds the hangers from the rails down to the deck.
 */
export function bridgeSegmentGeometry(near: boolean): THREE.BufferGeometry {
  const rail = (z: number) =>
    colored(
      new THREE.CylinderGeometry(0.035, 0.035, 1, 3, 1, true).rotateZ(Math.PI / 2),
      '#5c4a3a',
    ).translate(0.5, 1.05, z);
  const parts = [box(0.86, 0.1, 1.5, '#9d7d5a', 0.5, 0, 0), rail(0.72), rail(-0.72)];
  if (near)
    for (const z of [0.72, -0.72])
      parts.push(
        colored(new THREE.CylinderGeometry(0.02, 0.02, 1.05, 3, 1, true), '#5c4a3a').translate(
          0.02,
          0.52,
          z,
        ),
      );
  return still(mergeGeometries(parts)!);
}

/** A gate (paifang) where the stair reaches the summit: two red posts, a beam, a little roof. */
export function gateGeometry(): THREE.BufferGeometry {
  const parts = [
    box(0.3, 3.6, 0.3, '#9e3a2f', -1.3, 1.8, 0),
    box(0.3, 3.6, 0.3, '#9e3a2f', 1.3, 1.8, 0),
    box(3.4, 0.3, 0.36, '#9e3a2f', 0, 3.2, 0),
    box(1.2, 0.5, 0.12, '#2d4f7c', 0, 2.75, 0.2),
    roof(3.9, 1.0, 0.6, 3.6),
  ];
  return still(mergeGeometries(parts)!);
}

/**
 * A red-crowned crane in flight (nose +z): white body and wings with black flight feathers,
 * a long neck reaching forward, legs trailing (~44 triangles). Wing vertices carry their
 * distance out along the wing (aAnim 2) so the material can beat them.
 */
export function craneGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const body = new THREE.SphereGeometry(0.35, 6, 4).scale(0.9, 0.8, 1.9);
  parts.push(anim(colored(body, '#f4f2ee'), 2, () => 0));
  const neck = new THREE.CylinderGeometry(0.06, 0.1, 1.0, 4)
    .rotateX(Math.PI / 2)
    .translate(0, 0.08, 1.05);
  parts.push(anim(colored(neck, '#2b2a2e'), 2, () => 0));
  parts.push(
    anim(
      colored(new THREE.SphereGeometry(0.1, 4, 3), '#c8312b').translate(0, 0.12, 1.58),
      2,
      () => 0,
    ),
  );
  parts.push(
    anim(
      colored(new THREE.ConeGeometry(0.035, 0.32, 3).rotateX(Math.PI / 2), '#b8a35c').translate(
        0,
        0.1,
        1.8,
      ),
      2,
      () => 0,
    ),
  );
  const legs = new THREE.CylinderGeometry(0.03, 0.03, 1.1, 3)
    .rotateX(Math.PI / 2)
    .translate(0, -0.05, -1.15);
  parts.push(anim(colored(legs, '#2b2a2e'), 2, () => 0));
  // Wings: a broad inner panel and a tapering hand with black primaries, each side.
  for (const s of [-1, 1]) {
    const inner = new THREE.BufferGeometry();
    inner.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(
        [0, 0, 0.35, s * 1.1, 0, 0.25, 0, 0, -0.4, s * 1.1, 0, 0.25, s * 1.1, 0, -0.45, 0, 0, -0.4],
        3,
      ),
    );
    const hand = new THREE.BufferGeometry();
    hand.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(
        [
          s * 1.1,
          0,
          0.25,
          s * 2.2,
          0,
          0.0,
          s * 1.1,
          0,
          -0.45,
          s * 2.2,
          0,
          0.0,
          s * 2.15,
          0,
          -0.35,
          s * 1.1,
          0,
          -0.45,
        ],
        3,
      ),
    );
    if (s < 0) {
      // Keep the faces' winding pointing up on both sides.
      for (const g of [inner, hand]) {
        const p = g.getAttribute('position');
        for (let i = 0; i < p.count; i += 3) {
          const x = p.getX(i + 1);
          const y = p.getY(i + 1);
          const z = p.getZ(i + 1);
          p.setXYZ(i + 1, p.getX(i + 2), p.getY(i + 2), p.getZ(i + 2));
          p.setXYZ(i + 2, x, y, z);
        }
      }
    }
    parts.push(anim(colored(inner, '#f1efe9'), 2, (x) => Math.abs(x) / 2.2));
    parts.push(anim(colored(hand, '#26252a'), 2, (x) => Math.abs(x) / 2.2));
  }
  return mergeGeometries(parts)!;
}

/** A lit window pane (front +z): dark wood by day, warm after dark (the window material). */
export function windowGeometry(): THREE.BufferGeometry {
  return new THREE.BoxGeometry(0.75, 0.95, 0.08);
}
