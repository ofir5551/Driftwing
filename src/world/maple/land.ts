import * as THREE from 'three';
import { Config } from '../../core/Config';
import { clamp, smoothstep } from '../../core/math';
import { createChunkGeometry, type HeightField } from '../Terrain';
import type { MapleLayout } from './MapleLayout';

/**
 * Maple Valley's ground: the vertex colour (autumn grass and pampas on the valley floor, straw
 * of the harvested farmland, the forest floor deep in fallen leaves under the colour of the
 * canopy above it, dark under the cedars, pebble shores, grey rock where the slopes steepen)
 * and, in the terrain shader, the roads, the stone paths up the tunnels and the temples'
 * raked gravel, read from a per-vertex `aMaple`: (metres from the water, forest share, metres
 * to the nearest road or path, pad share). Every one is smooth, so the shader's reading of it
 * on the 4 m lattice is sharp enough. Fallen leaves are dabbed over the forest floor and
 * drift onto the paths' edges.
 */

// Ground palette (sRGB; the toon material and fog tint it per time of day).
const C = {
  bed: new THREE.Color('#4c5f56'),
  shallows: new THREE.Color('#7f8f78'),
  shore: new THREE.Color('#a59a86'),
  grass: new THREE.Color('#a69a58'),
  pampas: new THREE.Color('#c8b37a'),
  straw: new THREE.Color('#c9a965'),
  litter: new THREE.Color('#8b4a2c'),
  crimson: new THREE.Color('#b33f2b'),
  gold: new THREE.Color('#c98f30'),
  cedar: new THREE.Color('#4a5a40'),
  rock: new THREE.Color('#857a6c'),
  gravel: new THREE.Color('#cbc3b0'),
};

const tmp = new THREE.Color();

export function mapleColor(
  L: MapleLayout,
  f: HeightField,
  x: number,
  z: number,
  y: number,
  slope: number,
  out: THREE.Color,
): THREE.Color {
  if (y < -0.4) return out.copy(C.shallows).lerp(C.bed, smoothstep(-0.4, -3, y));
  const t = f.tint(x, z);
  L.land(x, z);
  out.copy(C.grass).lerp(C.pampas, smoothstep(-0.2, 0.6, t));
  out.lerp(C.straw, L.lVillage * 0.75);
  // Under the forest: leaf litter, tinted by the canopy that drops it (crimson or gold
  // hillsides, dark under cedars), so a far wooded slope reads in its colour between trees.
  tmp.copy(C.crimson).lerp(C.gold, smoothstep(0.35, 0.75, L.lTurn));
  tmp.lerp(C.litter, 0.15).lerp(C.cedar, L.lCedar * 0.85);
  out.lerp(tmp, smoothstep(0.1, 0.7, L.lForest) * 0.95);
  out.lerp(C.rock, smoothstep(0.55, 0.85, slope) * 0.8);
  out.lerp(C.gravel, L.lPad * 0.7);
  out.lerp(C.shore, 1 - smoothstep(0.5, 6, L.lWater));
  return out.multiplyScalar(0.94 + 0.08 * t);
}

/** Terrain geometry with the `aMaple` attribute (see the module comment). */
export function createMapleGeometry(res: number): THREE.BufferGeometry {
  const g = createChunkGeometry(res);
  const n = res + 1;
  g.setAttribute('aMaple', new THREE.BufferAttribute(new Float32Array(n * n * 4), 4));
  return g;
}

export function fillMaple(
  L: MapleLayout,
  g: THREE.BufferGeometry,
  ox: number,
  oz: number,
  size: number,
  res: number,
): void {
  const a = g.getAttribute('aMaple') as THREE.BufferAttribute;
  const A = a.array as Float32Array;
  const n = res + 1;
  const step = size / res;
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      L.land(ox + i * step, oz + j * step);
      const k = (j * n + i) * 4;
      A[k] = clamp(L.lWater, -200, 200);
      A[k + 1] = L.lForest;
      A[k + 2] = Math.min(L.lPath, 60);
      A[k + 3] = L.lPad;
    }
  a.needsUpdate = true;
}

const K = Config.maple;
export const landUniforms = {
  uMRoadW: {
    get value() {
      return K.roadWidth;
    },
  },
  uMPathW: {
    get value() {
      return K.pathWidth;
    },
  },
  uMRoad: { value: new THREE.Color('#bda98a') },
  uMStone: { value: new THREE.Color('#a39c8f') },
  uMGravel: { value: new THREE.Color('#d8d1bf') },
  uMLeafA: { value: new THREE.Color('#c23a28') },
  uMLeafB: { value: new THREE.Color('#e48a2a') },
  uMLeafC: { value: new THREE.Color('#e9bd3c') },
};

const VERT = /* glsl */ `
attribute vec4 aMaple;
varying vec4 vMaple;`;

const FRAG_PARS = /* glsl */ `
varying vec4 vMaple;
uniform float uMRoadW;
uniform float uMPathW;
uniform vec3 uMRoad;
uniform vec3 uMStone;
uniform vec3 uMGravel;
uniform vec3 uMLeafA;
uniform vec3 uMLeafB;
uniform vec3 uMLeafC;`;

const FRAG = /* glsl */ `
{
  vec3 mN = normalize(vGNrm);
  float mFine = 1.0 - smoothstep(140.0, 420.0, distance(vGPos, cameraPosition));
  float mDry = smoothstep(0.4, 1.2, vMaple.x);
  // Roads and paths: packed earth by the river, flagstones up the tunnels (on the benches,
  // where the ground is level and higher than the road's), worn paler down the middle.
  float mW = mix(uMRoadW, uMPathW, step(8.0, vGPos.y));
  float mPath = (1.0 - smoothstep(mW * 0.75, mW * 1.15, vMaple.z)) * mDry * smoothstep(0.75, 0.9, mN.y);
  if (mPath > 0.0) {
    vec3 pc = mix(uMRoad, uMStone, step(8.0, vGPos.y));
    // Flagstones: a grid of slabs with darker joints, up close.
    vec2 fl = fract(vGPos.xz * 0.9);
    float joint = (1.0 - smoothstep(0.0, 0.08, min(min(fl.x, 1.0 - fl.x), min(fl.y, 1.0 - fl.y))))
      * step(8.0, vGPos.y) * mFine;
    pc *= (0.9 + 0.18 * gNoise(vGPos.xz * 0.7)) * (1.0 - 0.25 * joint);
    diffuseColor.rgb = mix(diffuseColor.rgb, pc, mPath);
  }
  // The temples' raked gravel: pale, combed in fine lines.
  float mPad = smoothstep(0.55, 0.8, vMaple.w) * (1.0 - mPath);
  if (mPad > 0.0) {
    float rake = 0.94 + 0.06 * sin((vGPos.x + vGPos.z) * 4.0) * mFine;
    diffuseColor.rgb = mix(diffuseColor.rgb, uMGravel * rake, mPad);
  }
  // The forest's ground carries its canopy's colour (see mapleColor): far off it is painted as
  // the treetops themselves, mottled in crowns with shade between; near, it darkens to the
  // leaf litter under them.
  float mCan = smoothstep(0.4, 0.8, vMaple.y) * mDry * (1.0 - mPad) * (1.0 - mPath)
    * mix(1.0, smoothstep(0.55, 0.85, mN.y), mFine);
  if (mCan > 0.0) {
    float b1 = gNoise(vGPos.xz * 0.19);
    float b2 = gNoise(vGPos.xz * 0.043 + 7.0);
    vec3 cc = diffuseColor.rgb * (0.62 + 0.62 * smoothstep(0.25, 0.75, b1));
    cc = mix(cc, cc * vec3(1.12, 0.82, 0.62), smoothstep(0.55, 0.85, b2) * 0.6);
    cc = mix(cc, diffuseColor.rgb * vec3(0.62, 0.5, 0.45), mFine * 0.75);
    diffuseColor.rgb = mix(diffuseColor.rgb, cc, mCan);
  }
  // Fallen leaves: dabs of crimson, flame and gold over the forest floor, and drifts of them
  // along the paths' edges; none on the water's edge or the raked gravel.
  float mLeaf = max(smoothstep(0.2, 0.7, vMaple.y), (1.0 - smoothstep(0.0, 2.5, abs(vMaple.z - mW * 1.3))) * 0.7)
    * mDry * (1.0 - mPad) * (1.0 - mPath * 0.85) * mFine * smoothstep(0.6, 0.85, mN.y);
  if (mLeaf > 0.0) {
    float n1 = gNoise(vGPos.xz * 1.7);
    float n2 = gNoise(vGPos.xz * 0.45 + 13.0);
    vec3 lc = mix(uMLeafA, uMLeafB, smoothstep(0.3, 0.7, n2));
    lc = mix(lc, uMLeafC, smoothstep(0.62, 0.85, n2));
    diffuseColor.rgb = mix(diffuseColor.rgb, lc * (0.8 + 0.3 * n1), smoothstep(0.55, 0.75, n1) * mLeaf * 0.8);
  }
}`;

/**
 * Paints the roads, paths, gravel and fallen leaves on Maple Valley's terrain material. Apply
 * after withGroundDetail (it uses that patch's noise, position and normal).
 */
export function withMapleLand<T extends THREE.Material>(m: T): T {
  const prev = m.onBeforeCompile.bind(m);
  const prevKey = m.customProgramCacheKey.bind(m);
  m.onBeforeCompile = (shader, renderer) => {
    prev(shader, renderer);
    Object.assign(shader.uniforms, landUniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERT}`)
      .replace('#include <project_vertex>', '#include <project_vertex>\n  vMaple = aMaple;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAG_PARS}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${FRAG}`);
  };
  m.customProgramCacheKey = () => `${prevKey()}|mapleland`;
  return m;
}
