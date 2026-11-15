import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { smoothstep } from '../../core/math';
import { Anim, anim } from '../highlands/shapes';
import { colored, jitter, lobe, painted, topLit } from '../Trees';
import { dropUndersides as noBottom, soften } from './geometry';

/**
 * Low-poly shapes for City of Gold's country and its roofs, each merged into one vertex-coloured
 * geometry for one instanced draw of the shared prop material (`aAnim`: 0 still, 2 sways, 4
 * wheels round its origin, -1 dry stone: courses painted in the shader, their height in the
 * second component). Near shapes for the
 * ring round the bird, far ones (a third of the triangles or less) beyond render.propDetail.
 */

/** Painted dry stone (the prop material lays courses on it in world metres; no motion). */
export const DRY_STONE = -1;

const box = (w: number, h: number, d: number, hex: string, x = 0, y = 0, z = 0) =>
  colored(new THREE.BoxGeometry(w, h, d), hex, y).translate(x, 0, z);

const limestone = new THREE.Color('#e3d8bf');
const limeDark = new THREE.Color('#b9ab8e');
const lichen = new THREE.Color('#c2b98c');

/**
 * Limestone outcrop (~110 tris): three broken shelves stacked and stepped back, the way the
 * Judean hills' bedding breaks out of a slope; pale on top, shaded at each shelf's foot.
 */
export function outcropGeometry(): THREE.BufferGeometry {
  const shelf = (
    sx: number,
    sy: number,
    sz: number,
    x: number,
    y: number,
    z: number,
    seed: number,
  ) => {
    const g = jitter(new THREE.DodecahedronGeometry(1, 0), 0.22, seed).scale(sx, sy, sz);
    return painted(
      g,
      (_x, py, _z, out) =>
        out
          .copy(limeDark)
          .lerp(limestone, smoothstep(-sy, sy * 0.4, py))
          .lerp(lichen, py > sy * 0.6 ? 0.25 : 0),
      y,
    ).translate(x, 0, z);
  };
  return anim(
    topLit(
      mergeGeometries([
        shelf(2.3, 0.6, 1.7, 0, 0.45, 0, 11),
        shelf(1.8, 0.55, 1.35, 0.35, 1.05, -0.25, 12),
        shelf(1.15, 0.5, 0.95, 0.6, 1.6, -0.4, 13),
      ])!,
      0.78,
      1.06,
    ),
    DRY_STONE,
    () => 0.5,
  );
}

/** Far outcrop (~20 tris): one squat pale block. */
export function outcropFarGeometry(): THREE.BufferGeometry {
  const g = jitter(new THREE.IcosahedronGeometry(1, 0), 0.25, 14).scale(2.2, 1.0, 1.6);
  return anim(
    topLit(
      painted(
        g,
        (_x, y, _z, out) => out.copy(limeDark).lerp(limestone, smoothstep(-1, 0.4, y)),
        0.7,
      ),
      0.8,
      1.06,
    ),
    DRY_STONE,
    () => 0.5,
  );
}

/** Boulder (~80 tris near, 20 far): a rounded, pale, lichen-blotched stone. */
export function boulderGeometry(detail: number): THREE.BufferGeometry {
  const g = jitter(new THREE.IcosahedronGeometry(1, detail), 0.32, 21).scale(1.1, 0.75, 0.95);
  const out = painted(
    g,
    (x, y, z, c) =>
      c
        .copy(limeDark)
        .lerp(limestone, smoothstep(-0.7, 0.4, y))
        .lerp(lichen, Math.sin(x * 9 + z * 7) > 0.6 ? 0.35 : 0),
    0.4,
  );
  soften(out, 0, 0.4, 0, 1.1, 0.75, 0.95, 0.6);
  return topLit(out, 0.75, 1.08);
}

/**
 * Garrigue (~60 tris near, 20 far): thorny burnet and sage, squat grey-green cushions with a
 * dusty top; sways a little.
 */
export function scrubGeometry(): THREE.BufferGeometry {
  const g = mergeGeometries([
    soften(lobe(0.75, 0, 0.45, 0, '#8d9670', 31, 0.7), 0, 0.45, 0, 0.75, 0.53, 0.75, 0.8),
    soften(
      lobe(0.55, 0.6, 0.35, 0.25, '#a3a57c', 32, 0.75),
      0.6,
      0.35,
      0.25,
      0.55,
      0.41,
      0.55,
      0.8,
    ),
    soften(
      lobe(0.5, -0.45, 0.32, -0.35, '#7c8762', 33, 0.75),
      -0.45,
      0.32,
      -0.35,
      0.5,
      0.38,
      0.5,
      0.8,
    ),
  ])!;
  return anim(topLit(g, 0.7, 1.1), Anim.Sway, (y) => Math.max(0, y) * 0.03);
}

export function scrubFarGeometry(): THREE.BufferGeometry {
  const g = soften(
    lobe(0.85, 0.1, 0.42, 0, '#8d9670', 34, 0.62),
    0.1,
    0.42,
    0,
    0.85,
    0.53,
    0.85,
    0.8,
  );
  g.scale(1.2, 1, 1.05);
  return anim(topLit(g, 0.7, 1.1), Anim.Sway, (y) => Math.max(0, y) * 0.03);
}

const leaf = new THREE.Color('#4e6d44');
const leafLight = new THREE.Color('#67855a');
const pink = new THREE.Color('#ec8fb0');
const white = new THREE.Color('#f6e9ee');

/** Pink and white flower speckles over a dark leaf mass (by a hash of the vertex). */
function speckled(g: THREE.BufferGeometry, y: number, share: number): THREE.BufferGeometry {
  return painted(
    g,
    (x, py, z, out) => {
      const h = Math.sin(x * 13.1 + py * 7.7 + z * 5.3) * 0.5 + 0.5;
      out.copy(leaf).lerp(leafLight, smoothstep(-0.6, 0.6, py));
      if (h > 1 - share && py > -0.3) out.copy(h > 1 - share * 0.25 ? white : pink);
    },
    y,
  );
}

/**
 * Oleander (~170 tris near): a dark, upright bush of four lobes speckled pink and white, with
 * clusters of blossom standing out of its crown.
 */
export function oleanderGeometry(): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const lobes: [number, number, number, number][] = [
    [1.0, 0, 1.0, 0],
    [0.85, 0.7, 1.5, 0.3],
    [0.85, -0.6, 1.6, -0.2],
    [0.7, 0.1, 2.2, 0.1],
  ];
  lobes.forEach(([r, x, y, z], i) => {
    const g = jitter(new THREE.IcosahedronGeometry(r, 0), r * 0.3, 41 + i).scale(1, 1.05, 1);
    parts.push(soften(speckled(g, y, 0.3).translate(x, 0, z), x, y, z, r, r * 1.05, r, 0.8));
  });
  // Blossom clusters on the crown.
  for (let k = 0; k < 10; k++) {
    const a = k * 2.4;
    const y = 1.3 + (k % 4) * 0.32;
    const r = 0.95 - (y - 1.3) * 0.3;
    parts.push(
      colored(
        new THREE.OctahedronGeometry(0.3).scale(1, 0.7, 1),
        k % 3 === 2 ? '#f8eef2' : '#f08cb0',
        y,
      ).translate(Math.cos(a) * r, 0, Math.sin(a) * r),
    );
  }
  return anim(topLit(mergeGeometries(parts)!, 0.72, 1.08), Anim.Sway, (y) => Math.max(0, y) * 0.03);
}

/** Far oleander (~40 tris): two lobes speckled pink. */
export function oleanderFarGeometry(): THREE.BufferGeometry {
  const a = jitter(new THREE.IcosahedronGeometry(1.05, 0), 0.3, 45).scale(1, 1.05, 1);
  const b = jitter(new THREE.IcosahedronGeometry(0.75, 0), 0.25, 46);
  return anim(
    topLit(
      mergeGeometries([speckled(a, 1.05, 0.4), speckled(b, 1.95, 0.4).translate(0.1, 0, 0)])!,
      0.72,
      1.08,
    ),
    Anim.Sway,
    (y) => Math.max(0, y) * 0.03,
  );
}

/**
 * A metre of dry-stone wall (scaled along x to its length, in y to its height): a 1 m tall,
 * 0.7 m thick bank of fieldstone with a lumpy coping, battered a little toward its top; its
 * stones are painted in the shader. Near (~40 tris) and far (~10 tris, a plain bank).
 */
export function dryWallGeometry(near: boolean): THREE.BufferGeometry {
  const g = new THREE.BoxGeometry(1, 1, 0.7, near ? 3 : 1, near ? 2 : 1, 1).translate(0, 0.5, 0);
  const pos = g.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i);
    if (y > 0.99) {
      pos.setY(i, y + (near ? Math.sin(pos.getX(i) * 17 + pos.getZ(i) * 5) * 0.05 : 0));
      pos.setZ(i, pos.getZ(i) * 0.8);
    }
  }
  const stone = new THREE.Color('#d6c9a8');
  const dark = new THREE.Color('#a8987a');
  return anim(
    noBottom(
      topLit(
        painted(g, (_x, y, _z, out) => out.copy(dark).lerp(stone, smoothstep(0, 0.9, y))),
        0.85,
        1.05,
      ),
    ),
    DRY_STONE,
    () => 0.3,
  );
}

/** Black goat (~60 tris): a long dark body, a bearded head with swept-back horns, long ears. */
export function goatGeometry(): THREE.BufferGeometry {
  const coat = '#2f2a28';
  const body = jitter(new THREE.IcosahedronGeometry(0.4, 0), 0.06, 51).scale(0.85, 0.85, 1.55);
  const leg = (x: number, z: number) => box(0.09, 0.5, 0.09, '#2a2523', x, 0.25, z);
  return topLit(
    mergeGeometries([
      colored(body, coat, 0.72),
      box(0.22, 0.28, 0.36, coat, 0, 0.98, 0.68).rotateX(0.35),
      colored(new THREE.ConeGeometry(0.05, 0.3, 3).rotateX(-0.9), '#6d6052', 1.22).translate(
        0.07,
        0,
        0.55,
      ),
      colored(new THREE.ConeGeometry(0.05, 0.3, 3).rotateX(-0.9), '#6d6052', 1.22).translate(
        -0.07,
        0,
        0.55,
      ),
      box(0.42, 0.06, 0.12, '#3a3330', 0, 1.0, 0.6),
      leg(0.15, 0.38),
      leg(-0.15, 0.38),
      leg(0.15, -0.4),
      leg(-0.15, -0.4),
    ])!,
    0.8,
    1.12,
  );
}

/** Fat-tailed sheep (~70 tris): a cream fleece, a brown face and legs. */
export function sheepGeometry(): THREE.BufferGeometry {
  const body = jitter(new THREE.IcosahedronGeometry(0.5, 1), 0.08, 52).scale(0.95, 0.8, 1.35);
  const leg = (x: number, z: number) => box(0.1, 0.45, 0.1, '#6b5442', x, 0.22, z);
  return topLit(
    mergeGeometries([
      colored(body, '#ece2ca', 0.78),
      box(0.26, 0.3, 0.36, '#7a5c45', 0, 0.92, 0.72),
      colored(new THREE.IcosahedronGeometry(0.22, 0), '#e2d6bb', 0.6).translate(0, 0, -0.7),
      leg(0.2, 0.4),
      leg(-0.2, 0.4),
      leg(0.2, -0.4),
      leg(-0.2, -0.4),
    ])!,
    0.78,
    1.06,
  );
}

/** Shepherd (~40 tris): a long brown robe, a white headcloth, leaning on a staff. */
export function shepherdGeometry(): THREE.BufferGeometry {
  return topLit(
    mergeGeometries([
      colored(new THREE.CylinderGeometry(0.16, 0.34, 1.35, 6, 1, true), '#7a5a40', 0.68),
      colored(new THREE.IcosahedronGeometry(0.15, 0), '#b9876a', 1.5),
      colored(new THREE.ConeGeometry(0.2, 0.32, 6), '#f1ece2', 1.62),
      box(0.05, 1.8, 0.05, '#5c4632', 0.36, 0.9, 0.15).rotateZ(-0.08),
    ])!,
    0.8,
    1.06,
  );
}

/**
 * Rooftop water tanks (~90 tris): two black drums standing on a steel frame, beside a small
 * pipe, the silhouette on every roof in the hills.
 */
export function tanksGeometry(): THREE.BufferGeometry {
  const drum = (x: number) =>
    colored(new THREE.CylinderGeometry(0.5, 0.5, 1.05, 8), '#262628', 1.12).translate(x, 0, 0);
  return noBottom(
    topLit(
      mergeGeometries([
        box(2.4, 0.08, 1.2, '#8b8f94', 0, 0.56),
        box(0.08, 0.56, 0.08, '#8b8f94', 1.1, 0.28, 0.5),
        box(0.08, 0.56, 0.08, '#8b8f94', -1.1, 0.28, 0.5),
        box(0.08, 0.56, 0.08, '#8b8f94', 1.1, 0.28, -0.5),
        box(0.08, 0.56, 0.08, '#8b8f94', -1.1, 0.28, -0.5),
        drum(0.58),
        drum(-0.58),
        box(0.1, 0.1, 1.4, '#9aa0a6', 0, 0.3, 0.2),
      ])!,
      0.7,
      1.15,
    ),
  );
}

/** A washing line (~80 tris): two posts, the line, and a row of clothes that sway in the wind. */
export function laundryGeometry(): THREE.BufferGeometry {
  const parts = [
    box(0.08, 1.8, 0.08, '#7e6a58', -2.2, 0.9),
    box(0.08, 1.8, 0.08, '#7e6a58', 2.2, 0.9),
    box(4.4, 0.025, 0.025, '#d8d2c8', 0, 1.72),
  ];
  const cloth = ['#f4f1ea', '#5c88c4', '#d9493f', '#f0c64c', '#f4f1ea', '#7aa36c'];
  for (let k = 0; k < 6; k++) {
    const w = 0.45 + ((k * 37) % 5) * 0.06;
    const h = 0.55 + ((k * 53) % 4) * 0.12;
    parts.push(box(w, h, 0.02, cloth[k], -1.75 + k * 0.7, 1.7 - h / 2));
  }
  // Clothes swing from the line: the push grows with the drop below it.
  return anim(
    topLit(mergeGeometries(parts)!, 0.9, 1.04),
    Anim.Sway,
    (y) => Math.max(0, 1.7 - y) * (y < 1.68 ? 0.35 : 0),
  );
}

/** Potted plants (~110 tris): terracotta pots and tins with a fig, geraniums and herbs. */
export function potsGeometry(): THREE.BufferGeometry {
  const pot = (r: number, h: number, x: number, z: number, hex: string) =>
    colored(new THREE.CylinderGeometry(r, r * 0.75, h, 6, 1, true), hex, h / 2).translate(x, 0, z);
  return anim(
    topLit(
      mergeGeometries([
        pot(0.28, 0.45, 0, 0, '#b8643f'),
        lobe(0.42, 0, 0.8, 0, '#5f8a4a', 61, 0.9),
        pot(0.2, 0.32, 0.6, 0.15, '#c97a52'),
        lobe(0.26, 0.6, 0.48, 0.15, '#d8473e', 62, 0.8),
        pot(0.2, 0.3, -0.5, 0.25, '#9aa3a8'),
        lobe(0.24, -0.5, 0.45, 0.25, '#7da35b', 63, 0.9),
        pot(0.16, 0.26, 0.2, -0.5, '#b8643f'),
        lobe(0.2, 0.2, 0.38, -0.5, '#ef6fa0', 64, 0.8),
      ])!,
      0.78,
      1.1,
    ),
    Anim.Sway,
    (y) => Math.max(0, y - 0.3) * 0.04,
  );
}

/**
 * A market stall (~130 tris): a striped canvas sloping from the wall over a trestle of crates
 * piled with oranges, peppers, greens and lemons. Local +z is the street; the stripes are pale
 * so the instance colour can dye them.
 */
export function awningGeometry(): THREE.BufferGeometry {
  const canvas = painted(new THREE.BoxGeometry(3, 0.05, 2.3, 6, 1, 1), (x, _y, _z, out) =>
    out.set(Math.floor((x + 1.5) / 0.5) % 2 ? '#f6f1e6' : '#e5dccb'),
  );
  canvas.rotateX(0.32).translate(0, 2.55, 1.1);
  const produce: THREE.BufferGeometry[] = [];
  const fruit = ['#f08a2c', '#d8432f', '#6f9d45', '#f2d14b', '#f08a2c', '#a8452f'];
  for (let k = 0; k < 6; k++)
    produce.push(
      colored(
        new THREE.IcosahedronGeometry(0.22, 0).scale(1.4, 0.7, 1.2),
        fruit[k],
        1.02,
      ).translate(-1.1 + (k % 3) * 1.1, 0, 0.8 + Math.floor(k / 3) * 0.55),
    );
  return topLit(
    mergeGeometries([
      canvas,
      box(0.07, 2.2, 0.07, '#6b5848', -1.4, 1.1, 2.15),
      box(0.07, 2.2, 0.07, '#6b5848', 1.4, 1.1, 2.15),
      box(2.8, 0.12, 1.3, '#8c6a4c', 0, 0.86, 1.05),
      box(2.6, 0.75, 1.1, '#a07b58', 0, 0.42, 1.05),
      ...produce,
    ])!,
    0.75,
    1.08,
  );
}
