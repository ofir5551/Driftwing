import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { smoothstep } from '../../core/math';
import { colored, jitter, lobe, painted, topLit } from '../Trees';

/**
 * Low-poly shapes for the lived-in Highlands, each merged into one vertex-coloured geometry for
 * one instanced draw. Every shape carries `aAnim` (kind, weight) for the shared prop material:
 * 0 still, 1 spins round its local z (windmill sails), 2 sways (weight = how far), 3 bobs
 * (boats), 4 wheels round its origin (a flock bird).
 */
export const Anim = { Still: 0, Spin: 1, Sway: 2, Bob: 3, Flock: 4 } as const;

/** Tags every vertex with an animation kind and a weight from its height. */
export function anim(
  g: THREE.BufferGeometry,
  kind: number,
  weight: (y: number) => number = () => 0,
): THREE.BufferGeometry {
  const pos = g.getAttribute('position');
  const a = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    a[i * 2] = kind;
    a[i * 2 + 1] = weight(pos.getY(i));
  }
  g.setAttribute('aAnim', new THREE.BufferAttribute(a, 2));
  return g;
}

const box = (w: number, h: number, d: number, hex: string, x = 0, y = 0, z = 0) =>
  colored(new THREE.BoxGeometry(w, h, d), hex, y).translate(x, 0, z);

/** A gable roof: a triangular prism along z, eaves overhanging the walls. */
function gable(w: number, h: number, d: number, hex: string, y: number) {
  const s = new THREE.Shape();
  s.moveTo(-w / 2, 0);
  s.lineTo(w / 2, 0);
  s.lineTo(0, h);
  s.closePath();
  const g = new THREE.ExtrudeGeometry(s, { depth: d, bevelEnabled: false });
  g.translate(0, 0, -d / 2);
  const base = new THREE.Color(hex);
  const ridge = base.clone().offsetHSL(0, 0, 0.06);
  return painted(g, (_x, py, _z, out) => out.copy(base).lerp(ridge, py / h), y);
}

/** Cottage (~60 tris): whitewashed walls, a dark door and windows, a red-brown roof, a chimney. */
export function cottageGeometry(): THREE.BufferGeometry {
  return topLit(
    mergeGeometries([
      box(5, 3.2, 7, '#f3eadb', 0, 1.6),
      box(5.04, 0.6, 7.04, '#b9ab98', 0, 0.3), // stone footing
      gable(6.2, 2.6, 8, '#b2564a', 3.2),
      box(0.8, 2.2, 0.8, '#8c7a6e', 1.4, 5.3, -2.2), // chimney
      box(1.0, 1.9, 0.1, '#6b4a3a', 0, 0.95, 3.52), // door
      box(0.8, 0.8, 0.1, '#56637a', -1.6, 1.9, 3.52),
      box(0.8, 0.8, 0.1, '#56637a', 1.6, 1.9, 3.52),
      box(0.1, 0.8, 0.8, '#56637a', 2.52, 1.9, -1.2),
      box(0.1, 0.8, 0.8, '#56637a', -2.52, 1.9, 1.2),
    ])!,
    0.8,
    1.06,
  );
}

/** Chimney top in the cottage's local frame (smoke starts here). */
export const CHIMNEY = new THREE.Vector3(1.4, 6.5, -2.2);

/** Barn (~40 tris): long red timber walls, a big pale door and a slate roof. */
export function barnGeometry(): THREE.BufferGeometry {
  return topLit(
    mergeGeometries([
      box(7, 4.2, 11, '#a5483c', 0, 2.1),
      gable(8, 3.6, 11.8, '#6d6a72', 4.2),
      box(3.2, 3.4, 0.12, '#e6d8c0', 0, 1.7, 5.52),
      box(2.6, 2.8, 0.14, '#8e3c33', 0, 1.6, 5.56),
    ])!,
    0.78,
    1.05,
  );
}

/** Windmill tower: a tapered white octagon on a stone base with a dark cap; sails are separate. */
export function windmillGeometry(): THREE.BufferGeometry {
  return topLit(
    mergeGeometries([
      colored(new THREE.CylinderGeometry(2.6, 3.4, 1.4, 8), '#a89e92', 0.7),
      colored(new THREE.CylinderGeometry(1.9, 3.0, 9, 8), '#f1ebe0', 5.9),
      colored(new THREE.ConeGeometry(2.4, 2.8, 8), '#5f5a66', 11.8),
      box(0.9, 1.8, 0.12, '#6b4a3a', 0, 0.9, 3.1),
    ])!,
    0.8,
    1.05,
  );
}

/** Height of the sails' hub on the windmill (sails are placed here and face +z). */
export const SAIL_HUB = new THREE.Vector3(0, 11.2, 2.4);

/** Four lattice sails round the hub, spinning in the shader. */
export function sailsGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  for (let k = 0; k < 4; k++) {
    const spar = box(0.25, 7, 0.2, '#6b5446', 0, 0).translate(0, 3.6, 0);
    const cloth = box(1.5, 5.4, 0.08, '#f4ecdc', 0.85, 0).translate(0, 4.4, 0.05);
    const blade = mergeGeometries([spar, cloth])!;
    blade.rotateZ((k * Math.PI) / 2);
    parts.push(blade);
  }
  parts.push(
    colored(new THREE.CylinderGeometry(0.45, 0.45, 0.8, 6).rotateX(Math.PI / 2), '#4e4a52'),
  );
  return anim(mergeGeometries(parts)!, Anim.Spin);
}

/** Boulder (~80 tris): a lumpy lavender-grey stone, mossy on top. */
export function boulderGeometry(seed: number, detail = 1): THREE.BufferGeometry {
  const g = jitter(new THREE.IcosahedronGeometry(1, detail), 0.38, seed);
  g.scale(1.1, 0.72, 0.95);
  const stone = new THREE.Color('#a59cab');
  const moss = new THREE.Color('#8fae6e');
  return topLit(
    painted(
      g,
      (_x, y, _z, out) => out.copy(stone).lerp(moss, smoothstep(0.35, 0.7, y) * 0.55),
      0.35,
    ),
    0.68,
    1.1,
  );
}

/** Outcrop slab: a broken, flat-topped rock shelf that pokes out of a slope. */
export function slabGeometry(seed: number): THREE.BufferGeometry {
  const g = jitter(new THREE.DodecahedronGeometry(1, 0), 0.3, seed);
  g.scale(1.6, 0.8, 1.1);
  return topLit(colored(g, '#9d93a5', 0.2), 0.62, 1.12);
}

/** Bush (~60 tris): three overlapping leafy lobes. */
export function bushGeometry(): THREE.BufferGeometry {
  return anim(
    topLit(
      mergeGeometries([
        lobe(1.1, 0, 0.8, 0, '#6e9f5c', 3),
        lobe(0.85, 0.8, 0.65, 0.3, '#7aa962', 4),
        lobe(0.8, -0.6, 0.7, -0.5, '#669655', 5),
      ])!,
      0.62,
      1.1,
    ),
    Anim.Sway,
    (y) => Math.max(0, y) * 0.05,
  );
}

/** Far bush (~20 tris): one squat lumpy lobe in the near bush's colours. */
export function bushFarGeometry(): THREE.BufferGeometry {
  const g = lobe(1.25, 0.1, 0.75, 0, '#6e9f5c', 3, 0.75);
  g.scale(1.25, 1, 1.1);
  return anim(topLit(g, 0.62, 1.1), Anim.Sway, (y) => Math.max(0, y) * 0.05);
}

/** Fallen log: a mossy trunk lying along x with pale cut ends. */
export function logGeometry(): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(0.42, 0.5, 6, 7).rotateZ(Math.PI / 2);
  const bark = new THREE.Color('#7c604f');
  const cut = new THREE.Color('#d9c09a');
  const moss = new THREE.Color('#7d9d5a');
  return topLit(
    painted(
      g,
      (x, y, _z, out) => {
        out.copy(bark).lerp(moss, smoothstep(0.15, 0.45, y) * 0.6);
        if (Math.abs(x) > 2.95) out.copy(cut);
      },
      0.38,
    ),
  );
}

/** Round hay bale lying on its side. */
export function haybaleGeometry(): THREE.BufferGeometry {
  const g = new THREE.CylinderGeometry(0.75, 0.75, 1.2, 10).rotateZ(Math.PI / 2);
  const side = new THREE.Color('#e3c46a');
  const end = new THREE.Color('#cfa84f');
  return topLit(
    painted(g, (x, _y, _z, out) => out.copy(Math.abs(x) > 0.59 ? end : side), 0.72),
    0.72,
    1.08,
  );
}

/** Dry-stone wall, one metre long (scaled along x), with a lumpy top. */
export function wallGeometry(): THREE.BufferGeometry {
  // Narrower at the top, a lumpy coping, and each block of stones its own shade.
  const g = new THREE.BoxGeometry(1, 0.8, 0.6, 5, 1, 1);
  const pos = g.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    if (y > 0) {
      pos.setY(i, y + Math.sin(pos.getX(i) * 19 + pos.getZ(i) * 4) * 0.08);
      pos.setZ(i, pos.getZ(i) * 0.7);
    }
  }
  const stone = new THREE.Color('#bdb3b6');
  const dark = new THREE.Color('#7f7682');
  const moss = new THREE.Color('#93a87a');
  return topLit(
    painted(
      g,
      (x, y, z, out) => {
        out.copy(dark).lerp(stone, y + 0.55);
        out.multiplyScalar(0.86 + 0.14 * Math.sin(x * 37 + y * 23 + z * 11));
        if (y > 0.3) out.lerp(moss, 0.35);
      },
      0.38,
    ),
    0.8,
    1.06,
  );
}

/** Post-and-rail fence, one metre long (scaled along x), its post at the start. */
export function fenceGeometry(): THREE.BufferGeometry {
  return mergeGeometries([
    box(0.16, 1.3, 0.16, '#8a6d58', -0.5, 0.65),
    box(1, 0.12, 0.07, '#9a7c66', 0, 1.05),
    box(1, 0.12, 0.07, '#9a7c66', 0, 0.6),
  ])!;
}

/** Sheep (~70 tris): a woolly body, a dark face and legs. */
export function sheepGeometry(): THREE.BufferGeometry {
  const body = jitter(new THREE.IcosahedronGeometry(0.62, 1), 0.12, 9);
  body.scale(1, 0.78, 1.35);
  const leg = (x: number, z: number) => box(0.13, 0.5, 0.13, '#3d3640', x, 0.25, z);
  return topLit(
    mergeGeometries([
      colored(body, '#f4f0e6', 0.88),
      box(0.36, 0.38, 0.46, '#3d3640', 0, 1.0, 0.86),
      leg(0.28, 0.45),
      leg(-0.28, 0.45),
      leg(0.28, -0.45),
      leg(-0.28, -0.45),
    ])!,
    0.75,
    1.05,
  );
}

/** Rowing boat: a pointed, open wooden hull with a pale stripe; bobs in the shader. */
export function boatGeometry(): THREE.BufferGeometry {
  const s = new THREE.Shape();
  s.moveTo(0, -2.2);
  s.quadraticCurveTo(0.95, -1.2, 0.85, 1.4);
  s.lineTo(-0.85, 1.4);
  s.quadraticCurveTo(-0.95, -1.2, 0, -2.2);
  const hull = new THREE.ExtrudeGeometry(s, { depth: 0.6, bevelEnabled: false, curveSegments: 4 });
  hull.rotateX(Math.PI / 2).translate(0, 0.35, 0);
  const wood = new THREE.Color('#8b5e48');
  const stripe = new THREE.Color('#e8dccb');
  const g = painted(hull, (_x, y, _z, out) => out.copy(y > 0.25 ? stripe : wood), 0);
  const seat = box(1.5, 0.08, 0.35, '#a4775c', 0, 0.2, 0.2);
  return anim(topLit(mergeGeometries([g, seat])!, 0.7, 1.08), Anim.Bob);
}

/** Reeds: a clump of tall thin blades with a few brown seed heads; sways. */
export function reedsGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const n = 9;
  for (let k = 0; k < n; k++) {
    const a = (k / n) * Math.PI * 2 + k * 0.7;
    const r = 0.25 + (k % 3) * 0.18;
    const h = 1.6 + ((k * 37) % 10) * 0.12;
    const blade = new THREE.ConeGeometry(0.06, h, 3).translate(0, h / 2, 0);
    blade.rotateZ(Math.cos(a) * 0.12).rotateX(Math.sin(a) * 0.12);
    const green = new THREE.Color('#7f9a55');
    const tip = new THREE.Color('#b5b971');
    parts.push(
      painted(blade, (_x, y, _z, out) => out.copy(green).lerp(tip, y / h)).translate(
        Math.cos(a) * r,
        0,
        Math.sin(a) * r,
      ),
    );
    if (k % 3 === 0)
      parts.push(
        colored(new THREE.CylinderGeometry(0.07, 0.07, 0.35, 4), '#6f4b36', h - 0.1).translate(
          Math.cos(a) * r,
          0,
          Math.sin(a) * r,
        ),
      );
  }
  return anim(mergeGeometries(parts)!, Anim.Sway, (y) => y * y * 0.05);
}

/** Flock bird: a flat dark chevron (wings flap in the shader by |x|). */
export function flockBirdGeometry(): THREE.BufferGeometry {
  const g = new THREE.BufferGeometry();
  // Two wing triangles meeting at the body line.
  const p = [0, 0, 0.35, -1.1, 0.05, -0.2, 0, 0, -0.25, 0, 0, 0.35, 0, 0, -0.25, 1.1, 0.05, -0.2];
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(new Array(18).fill(0.25), 3));
  g.computeVertexNormals();
  return anim(g, Anim.Flock);
}

/** Birch (far, ~50 tris): a slim white trunk under a tall, light, airy crown. */
export function birchGeometry(): THREE.BufferGeometry {
  const crown = jitter(new THREE.IcosahedronGeometry(1.7, 0), 0.4, 61);
  crown.scale(0.85, 1.55, 0.85);
  return topLit(
    mergeGeometries([
      colored(new THREE.CylinderGeometry(0.16, 0.24, 5.2, 5), '#ece6dc', 2.6),
      colored(crown, '#b7cf74', 6.4),
    ])!,
    0.7,
    1.12,
  );
}

/** Near birch: a speckled trunk and a loose column of small, bright lobes. */
export function birchDetailGeometry(): THREE.BufferGeometry {
  const trunk = painted(
    new THREE.CylinderGeometry(0.15, 0.25, 6, 6, 4),
    (x, y, z, out) => out.set(Math.sin(y * 7 + x * 20 + z * 13) > 0.7 ? '#4b4446' : '#efe9df'),
    3,
  );
  const lobes: [number, number, number, number, string][] = [
    [1.3, 0, 5.4, 0, '#a9c56a'],
    [1.1, 0.7, 6.4, 0.3, '#b9d178'],
    [1.1, -0.6, 6.6, -0.4, '#a3c066'],
    [1.0, 0.2, 7.6, -0.2, '#c3d985'],
    [0.9, -0.3, 8.4, 0.3, '#cbe08e'],
    [0.9, 0.6, 5.0, -0.8, '#9fbc62'],
  ];
  const parts = [trunk];
  lobes.forEach(([r, x, y, z, hex], i) => parts.push(lobe(r, x, y, z, hex, 70 + i, 1.05)));
  return topLit(mergeGeometries(parts)!, 0.7, 1.12);
}
