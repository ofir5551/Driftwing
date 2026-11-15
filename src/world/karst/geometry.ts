import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { smoothstep } from '../../core/math';
import { mulberry32 } from '../noise';
import { colored, jitter, painted, topLit } from '../Trees';
import { profile } from './KarstLayout';
import type { PillarSkin } from './skin';

/**
 * Jade River's rock and foliage. Pillars are lathed from the layout's profile in base radii (radius 1,
 * height `aspect`; the instance scales them), so collisions match the drawn rock. Everything
 * else is built in metres from primitives and painted with vertex colours.
 */

const ROCK = new THREE.Color('#a3aba3');
const ROCK_DARK = new THREE.Color('#58635e');
const FOOT = new THREE.Color('#4d5853');
const MOSS = new THREE.Color('#6d9159');
const MOSS_DARK = new THREE.Color('#4c6c48');

/**
 * One pillar silhouette, lathed from its skin (profile times smooth flutes and lumps): dark
 * vertical washes (rain streaks), moss on every ledge that faces the sky and a green crown.
 * Smooth-shaded so the toon bands sweep round it like brush strokes. The body's rings are even
 * from the buried foot to the dome; the dome's rings step evenly along its arc and stop short of
 * the pole, so the summit stays round instead of pinching to a point. `SEG` x `RINGS` sets the
 * tier (the hero tier near the bird, the mid tier, the coarse one in the haze).
 */
export function pillarGeometry(skin: PillarSkin, SEG = 16, RINGS = 22): THREE.BufferGeometry {
  const sh = skin.sh;
  const rand = mulberry32(Math.round(skin.phase * 1e6));
  const ph = skin.phase;
  const ph2 = skin.phase2;
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const c = new THREE.Color();
  const g = new THREE.Color();
  const dome = Math.max(3, Math.round(RINGS * 0.3));
  const body = RINGS - dome;
  for (let i = 0; i <= RINGS; i++) {
    const t =
      i <= body
        ? -0.04 + (sh.cap + 0.04) * (i / body)
        : sh.cap + (1 - sh.cap) * Math.sin(((i - body) / (dome + 0.6)) * Math.PI * 0.5);
    const tc = Math.max(t, 0);
    const off = sh.lean * tc * tc * sh.aspect;
    // Ledges: where the profile narrows quickly going up, the rock faces the sky.
    const ledge = smoothstep(0.02, 0.07, profile(sh, tc) - profile(sh, Math.min(tc + 0.03, 0.999)));
    const crown = smoothstep(sh.cap - 0.1, sh.cap + 0.04, tc);
    for (let k = 0; k < SEG; k++) {
      const a = (k / SEG) * Math.PI * 2;
      const rad = skin.radius(tc, a) * (t < 0 ? 1.04 : 1);
      pos.push(Math.cos(a) * rad + off, t * sh.aspect, Math.sin(a) * rad);
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
 * Smooth-shaded copy of a low-poly foliage shape: coincident corners (same position and colour)
 * are welded and the normals averaged, so the toon bands wrap round each lobe like a brush
 * stroke instead of lighting every facet flat. Costs no triangles.
 */
export function soften(g: THREE.BufferGeometry): THREE.BufferGeometry {
  g.deleteAttribute('normal');
  const w = mergeVertices(g, 1e-3);
  w.computeVertexNormals();
  return w;
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

/** Paper lantern: a slightly tall ball (one shared shape, sized per instance). */
export function lanternGeometry(): THREE.BufferGeometry {
  return new THREE.SphereGeometry(0.5, 6, 4).scale(1, 1.25, 1);
}
