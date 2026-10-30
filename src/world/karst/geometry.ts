import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { smoothstep } from '../../core/math';
import { gableGeometry, hipGeometry } from '../city/geometry';
import { mulberry32 } from '../noise';
import { colored, jitter, painted, topLit } from '../Trees';
import { profile, type PillarShape } from './KarstLayout';

/**
 * Jade River's shapes. Pillars are lathed from the layout's profile in base radii (radius 1,
 * height `aspect`; the instance scales them), so collisions match the drawn rock. Everything
 * else is built in metres from primitives and painted with vertex colours.
 */

const ROCK = new THREE.Color('#a3aba3');
const ROCK_DARK = new THREE.Color('#58635e');
const FOOT = new THREE.Color('#4d5853');
const MOSS = new THREE.Color('#6d9159');
const MOSS_DARK = new THREE.Color('#4c6c48');

/**
 * One pillar silhouette: fluted, lumpy limestone with dark vertical washes (rain streaks), moss
 * on every ledge that faces the sky and a green crown. Smooth-shaded so the toon bands sweep
 * round it like brush strokes.
 */
export function pillarGeometry(
  sh: PillarShape,
  seed: number,
  SEG = 16,
  RINGS = 22,
): THREE.BufferGeometry {
  const rand = mulberry32(seed);
  const ph = rand() * 10;
  const ph2 = rand() * 10;
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const c = new THREE.Color();
  const g = new THREE.Color();
  for (let i = 0; i <= RINGS; i++) {
    // Rings bunch up toward the summit, where the dome curves.
    const u = i / RINGS;
    const t = -0.04 + 1.025 * (1 - Math.pow(1 - u, 1.35));
    const tc = Math.max(t, 0);
    const rad = profile(sh, tc) * (t < 0 ? 1.04 : 1);
    const off = sh.lean * tc * tc * sh.aspect;
    // Ledges: where the profile narrows quickly going up, the rock faces the sky.
    const ledge = smoothstep(0.02, 0.07, profile(sh, tc) - profile(sh, Math.min(tc + 0.03, 0.999)));
    const crown = smoothstep(sh.cap - 0.1, sh.cap + 0.04, tc);
    const rough = 1 - 0.6 * crown;
    for (let k = 0; k < SEG; k++) {
      const a = (k / SEG) * Math.PI * 2;
      const flute =
        1 +
        rough *
          (0.07 * Math.sin(a * 5 + ph + t * 4) +
            0.04 * Math.sin(a * 11 + ph2 - t * 9) +
            (rand() - 0.5) * 0.07);
      pos.push(Math.cos(a) * rad * flute + off, t * sh.aspect, Math.sin(a) * rad * flute);
      // Ink washes run down the walls in streaks that wander as they fall.
      const streak = 0.5 + 0.5 * Math.sin(a * 7 + ph * 3 + Math.sin(t * 9 + a * 2) * 1.5);
      c.copy(ROCK).lerp(ROCK_DARK, smoothstep(0.5, 0.95, streak) * 0.85 + rand() * 0.12);
      c.lerp(FOOT, 1 - smoothstep(0, 0.1, t));
      // Clinging green: summit, ledges, and a few patchy bands on the walls.
      const patch = smoothstep(0.7, 0.95, Math.sin(t * 23 + a * 3 + ph) * Math.sin(a * 2 - ph2));
      const green = Math.min(1, crown + ledge * 0.8 + patch * 0.6);
      g.copy(MOSS).lerp(MOSS_DARK, rand() * 0.6);
      c.lerp(g, green);
      col.push(c.r, c.g, c.b);
    }
  }
  const apex = pos.length / 3;
  pos.push(sh.lean * sh.aspect, sh.aspect, 0);
  col.push(MOSS_DARK.r, MOSS_DARK.g, MOSS_DARK.b);
  for (let i = 0; i < RINGS; i++)
    for (let k = 0; k < SEG; k++) {
      const a = i * SEG + k;
      const b = i * SEG + ((k + 1) % SEG);
      idx.push(a, a + SEG, b, b, a + SEG, b + SEG);
    }
  const last = RINGS * SEG;
  for (let k = 0; k < SEG; k++) idx.push(last + k, apex, last + ((k + 1) % SEG));
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

/**
 * A clump of bamboo: a few thin leaning culms under tall, feathery plumes. Kept to ~50
 * triangles: river banks carry a thousand of them.
 */
export function bambooGeometry(): THREE.BufferGeometry {
  const rand = mulberry32(5);
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 3; i++) {
    const h = 9 + rand() * 4;
    const a = (i / 3) * Math.PI * 2 + rand();
    const lean = 0.1 + rand() * 0.15;
    const culm = new THREE.CylinderGeometry(0.1, 0.15, h, 3, 1, true).translate(0, h / 2, 0);
    culm.rotateZ(-lean).rotateY(a);
    parts.push(colored(culm, i % 2 ? '#9aae62' : '#869d55'));
  }
  // Plumes: tall, narrow and leaning out, so the clump reads as a feathery vase of leaves.
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI * 2 + 0.6;
    const plume = new THREE.IcosahedronGeometry(1, 0).scale(1.5, 4.2 + rand() * 1.2, 1.5);
    plume.rotateZ(-0.22).rotateY(a);
    plume.translate(Math.cos(a) * 1.3, 8.2 + rand() * 1.5, -Math.sin(a) * 1.3);
    parts.push(colored(plume, k % 2 ? '#7eae5b' : '#93c068'));
  }
  return topLit(mergeGeometries(parts)!, 0.7, 1.1);
}

/**
 * Near bamboo (~170 triangles): five culms fanning out of one
 * root, under seven lumpy leaf sprays that arch outward from the culm tops and droop at the
 * tips, cool and shaded inside the clump, catching the light on the outside.
 */
export function bambooDetailGeometry(): THREE.BufferGeometry {
  const rand = mulberry32(9);
  const parts: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 5; i++) {
    const h = 9 + rand() * 4.5;
    const a = (i / 5) * Math.PI * 2 + rand() * 0.8;
    const lean = 0.08 + rand() * 0.2;
    const culm = new THREE.CylinderGeometry(0.09, 0.15, h, 3, 1, true).translate(0, h / 2, 0);
    culm.rotateZ(-lean).rotateY(a);
    parts.push(colored(culm, i % 2 ? '#9aae62' : '#869d55'));
  }
  const inner = new THREE.Color('#5f8f4c');
  for (let k = 0; k < 7; k++) {
    const a = (k / 7) * Math.PI * 2 + rand() * 0.5;
    const high = k % 2 === 0;
    const len = 3.2 + rand() * 1.4;
    const spray = jitter(new THREE.IcosahedronGeometry(1, 0), 0.35, 30 + k).scale(0.85, len, 1.5);
    const outer = new THREE.Color(k % 3 ? '#8cbc63' : '#a0c972');
    const g = painted(spray, (x, y, _z, out) =>
      out.copy(inner).lerp(outer, smoothstep(-0.6, 0.8, x + y * 0.15)),
    );
    // Arch outward: lower sprays lean further and hang lower, the crown ones stand taller.
    g.translate(0.6, 0, 0)
      .rotateZ(-(high ? 0.35 : 0.75) - rand() * 0.2)
      .rotateY(a)
      .translate(Math.cos(a) * 1.1, (high ? 9.4 : 7.4) + rand() * 1.2, -Math.sin(a) * 1.1);
    parts.push(g);
  }
  return topLit(mergeGeometries(parts)!, 0.7, 1.1);
}

/** A village house: whitewashed walls on a stone plinth under a dark tiled gable roof. */
export function houseGeometry(storeys: 1 | 2): THREE.BufferGeometry {
  const wall = storeys === 1 ? 4.4 : 7.2;
  const parts = [
    colored(new THREE.BoxGeometry(8.3, 0.7, 6.3), '#8f918b', 0.35),
    colored(new THREE.BoxGeometry(8, wall, 6), '#ebe5d8', wall / 2),
    colored(gableGeometry().scale(9.4, 2.5, 7.4), '#454c53', wall),
    colored(new THREE.BoxGeometry(1.3, 2.2, 0.15), '#5d4838', 1.1).translate(0, 0, 3.02),
  ];
  for (let s = 0; s < storeys; s++)
    for (const x of [-2.6, 2.6])
      parts.push(
        colored(new THREE.BoxGeometry(1, 0.8, 0.12), '#3b4046', 2.8 + s * 2.9).translate(
          x,
          0,
          3.02,
        ),
      );
  return mergeGeometries(parts)!;
}

/** A cormorant fisher's bamboo raft: a figure in a straw hat, a pole, two birds, a lantern post. */
export function raftGeometry(): THREE.BufferGeometry {
  const pole = new THREE.CylinderGeometry(0.05, 0.05, 5.5, 4).rotateX(0.9);
  const parts = [
    colored(new THREE.BoxGeometry(1.7, 0.35, 8), '#c6ae78', 0.1),
    colored(new THREE.CylinderGeometry(0.3, 0.42, 1.3, 6), '#39475a', 0.95).translate(0, 0, -0.8),
    colored(new THREE.SphereGeometry(0.24, 6, 4), '#d4b28c', 1.78).translate(0, 0, -0.8),
    colored(new THREE.ConeGeometry(0.78, 0.4, 8), '#dcc78f', 2.05).translate(0, 0, -0.8),
    colored(pole, '#8a7350', 1.6).translate(0.45, 0, 1.1),
    colored(new THREE.CylinderGeometry(0.05, 0.05, 2.7, 4), '#6b5a44', 1.6).translate(0, 0, -3.7),
  ];
  for (const [x, z] of [
    [0.5, 2.2],
    [-0.45, 1.3],
  ]) {
    parts.push(
      colored(new THREE.IcosahedronGeometry(0.3, 0).scale(0.8, 0.9, 1.6), '#2d3233', 0.6).translate(
        x,
        0,
        z,
      ),
      colored(new THREE.CylinderGeometry(0.06, 0.09, 0.55, 4), '#2d3233', 0.95).translate(
        x,
        0,
        z + 0.35,
      ),
    );
  }
  return mergeGeometries(parts)!;
}

/** A hilltop pavilion: stone platform, red posts and beams, a flared dark roof, a gilt finial. */
export function pavilionGeometry(): THREE.BufferGeometry {
  const parts = [
    colored(new THREE.CylinderGeometry(4.3, 4.8, 0.9, 8), '#a8a296', 0.45),
    colored(hipGeometry(0).scale(8.6, 3.6, 8.6), '#3e4746', 4.5),
    colored(new THREE.ConeGeometry(0.32, 1.3, 6), '#c9a64e', 8.6),
  ];
  for (const x of [-2.6, 2.6])
    for (const z of [-2.6, 2.6])
      parts.push(
        colored(new THREE.CylinderGeometry(0.22, 0.24, 3.6, 6), '#ac4239', 2.7).translate(x, 0, z),
      );
  for (const z of [-2.6, 2.6]) {
    parts.push(colored(new THREE.BoxGeometry(5.6, 0.35, 0.3), '#8b3832', 4.35).translate(0, 0, z));
    parts.push(colored(new THREE.BoxGeometry(0.3, 0.35, 5.6), '#8b3832', 4.35).translate(z, 0, 0));
  }
  return mergeGeometries(parts)!;
}

/** Paper lantern: a slightly tall ball (one shared shape, sized per instance). */
export function lanternGeometry(): THREE.BufferGeometry {
  return new THREE.SphereGeometry(0.5, 8, 6).scale(1, 1.25, 1);
}

/** Where things sit on the shapes above, in their local metres. */
export const RAFT_LANTERN = { x: 0, y: 2.75, z: -3.7 };
export const HOUSE_LANTERN = { x: 1.3, y: 2.6, z: 3.4 };
export const PAVILION_LANTERNS = [
  { x: -2.6, y: 3.6, z: 2.6 },
  { x: 2.6, y: 3.6, z: 2.6 },
];
