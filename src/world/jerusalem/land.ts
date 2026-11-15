import * as THREE from 'three';
import { Config } from '../../core/Config';
import { clamp } from '../../core/math';
import { createChunkGeometry } from '../Terrain';
import type { JerusalemLayout } from './JerusalemLayout';

/**
 * Terrain geometry with `aJLand` per vertex: (signed metres from the nearest road's centre
 * line, the nearest footpath's in its half-widths, the valley floor line's, and the ground's
 * habitat: -1 built or paved, 0 open hill, up to 1 terraced orchard). Signed distances
 * interpolate exactly across the 4 m lattice, so a 1.6 m path or a 7 m bed is painted sharp.
 * The ground cover reads the same attribute.
 */
export function createLandGeometry(res: number): THREE.BufferGeometry {
  const g = createChunkGeometry(res);
  const n = res + 1;
  g.setAttribute('aJLand', new THREE.BufferAttribute(new Float32Array(n * n * 4), 4));
  return g;
}

/** Habitat of the layout's scratch point: -1 built or paved, else its terrace (0..1). */
export function habitat(L: JerusalemLayout, x: number, z: number): number {
  if (L.sd < 24 || L.town > 0.5 || L.cemetery(x, z) > 0.5) return -1;
  return L.terrace;
}

export function fillLand(
  L: JerusalemLayout,
  g: THREE.BufferGeometry,
  ox: number,
  oz: number,
  size: number,
  res: number,
): void {
  const a = g.getAttribute('aJLand') as THREE.BufferAttribute;
  const A = a.array as Float32Array;
  const n = res + 1;
  const step = size / res;
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const x = ox + i * step;
      const z = oz + j * step;
      L.track(x, z);
      L.at(x, z);
      const k = (j * n + i) * 4;
      A[k] = clamp(L.roadS, -60, 60);
      A[k + 1] = clamp(L.pathS / Math.max(L.pathW, 0.05), -40, 40);
      A[k + 2] = clamp(L.bedS, -60, 60);
      A[k + 3] = habitat(L, x, z);
    }
  a.needsUpdate = true;
}

const K = Config.jerusalem;
const uniforms = {
  uJRoadW: {
    get value() {
      return K.roadWidth;
    },
  },
  uJBedW: {
    get value() {
      return K.bedWidth;
    },
  },
  uJStep: {
    get value() {
      return K.terraceStep;
    },
  },
  uJRoadCol: { value: new THREE.Color('#a49d90') },
  uJVergeCol: { value: new THREE.Color('#d9c7a0') },
  uJPathCol: { value: new THREE.Color('#e6d5b0') },
  uJBedCol: { value: new THREE.Color('#ddd5c4') },
  uJWallCol: { value: new THREE.Color('#d7cbb0') },
};

const VERT_PARS = /* glsl */ `
attribute vec4 aJLand;
varying vec4 vJL;
varying vec3 vJLPos;
varying vec3 vJLN;`;

const VERT = /* glsl */ `
  vJL = aJLand;
  vJLPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
  vJLN = normalize(mat3(modelMatrix) * objectNormal);`;

const FRAG_PARS = /* glsl */ `
varying vec4 vJL;
varying vec3 vJLPos;
varying vec3 vJLN;
uniform float uJRoadW;
uniform float uJBedW;
uniform float uJStep;
uniform vec3 uJRoadCol;
uniform vec3 uJVergeCol;
uniform vec3 uJPathCol;
uniform vec3 uJBedCol;
uniform vec3 uJWallCol;
float jlHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float jlNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(jlHash(i), jlHash(i + vec2(1.0, 0.0)), u.x),
             mix(jlHash(i + vec2(0.0, 1.0)), jlHash(i + vec2(1.0, 1.0)), u.x), u.y);
}`;

const FRAG = /* glsl */ `
{
  float up = normalize(vJLN).y;
  float dist = distance(vJLPos, cameraPosition);
  float fine = 1.0 - smoothstep(120.0, 380.0, dist);
  float px = max(fwidth(vJLPos.x), fwidth(vJLPos.z)); // metres per pixel: soft, never jagged
  // The dry bed down a valley's floor: pale pebbles and gravel, a few darker stones.
  float bed = (1.0 - smoothstep(uJBedW - 0.5 - px, uJBedW + 0.6 + px, abs(vJL.z)))
    * smoothstep(0.75, 0.9, up);
  if (bed > 0.0) {
    vec3 bc = uJBedCol * (0.86 + 0.26 * jlNoise(vJLPos.xz * 0.35));
    bc *= mix(1.0, 0.8 + 0.4 * jlNoise(vJLPos.xz * 2.7), fine);
    diffuseColor.rgb = mix(diffuseColor.rgb, bc, bed * 0.9);
  }
  // Terrace risers in the orchards: dry-stone faces where the stepped ground climbs.
  float terr = clamp(vJL.w, 0.0, 1.0);
  float riser = terr * (1.0 - smoothstep(0.55, 0.85, up));
  if (riser > 0.0) {
    float row = floor(vJLPos.y / 0.4);
    float u = (vJLPos.x + vJLPos.z) / (0.6 + 0.5 * jlHash(vec2(row, 5.0))) + jlHash(vec2(row, 2.0));
    float tone = 0.82 + 0.26 * jlHash(vec2(floor(u), row));
    float joint = min(fract(vJLPos.y / 0.4), 1.0 - fract(vJLPos.y / 0.4));
    tone = mix(tone * (1.0 - 0.3 * (1.0 - smoothstep(0.04, 0.16, joint))), 0.95, 1.0 - fine);
    diffuseColor.rgb = mix(diffuseColor.rgb, uJWallCol * tone, riser * 0.85);
  }
  // Footpaths: a worn, dusty line (|vJL.y| < 1 is on the path).
  float path = (1.0 - smoothstep(0.7 - px, 1.15 + px, abs(vJL.y))) * smoothstep(0.62, 0.82, up);
  if (path > 0.0) {
    vec3 pc = uJPathCol * (0.92 + 0.14 * jlNoise(vJLPos.xz * 0.9));
    diffuseColor.rgb = mix(diffuseColor.rgb, pc, path * 0.8);
  }
  // Roads: worn grey asphalt with a dusty verge either side.
  float ad = abs(vJL.x);
  float road = (1.0 - smoothstep(uJRoadW - 0.25 - px, uJRoadW + 0.25 + px, ad)) * smoothstep(0.55, 0.8, up);
  float verge = (1.0 - smoothstep(uJRoadW + 0.4, uJRoadW + 1.8 + px, ad)) * smoothstep(0.55, 0.8, up);
  if (verge > 0.0) {
    diffuseColor.rgb = mix(diffuseColor.rgb, uJVergeCol * (0.9 + 0.2 * jlNoise(vJLPos.xz * 0.6)), verge * 0.55);
    vec3 rc = uJRoadCol * (0.93 + 0.12 * jlNoise(vJLPos.xz * 0.25));
    // Dust drifts onto the tarmac's edges; the wheel tracks are a shade darker.
    rc = mix(rc, uJVergeCol, smoothstep(uJRoadW * 0.6, uJRoadW, ad) * 0.45);
    rc *= 1.0 - (1.0 - smoothstep(0.2, 0.5, abs(ad - uJRoadW * 0.5))) * 0.06 * fine;
    diffuseColor.rgb = mix(diffuseColor.rgb, rc, road);
  }
}`;

/**
 * Paints the roads, footpaths, dry valley beds and terrace risers on City of Gold's terrain
 * material (after the vertex colour, before the painted ground detail, so they get its mottle
 * too). Apply after withGroundDetail.
 */
export function withLand<T extends THREE.Material>(m: T): T {
  const prev = m.onBeforeCompile.bind(m);
  const prevKey = m.customProgramCacheKey();
  m.onBeforeCompile = (shader, renderer) => {
    prev(shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERT_PARS}`)
      .replace('#include <project_vertex>', `#include <project_vertex>\n${VERT}`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAG_PARS}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${FRAG}`);
  };
  m.customProgramCacheKey = () => `${prevKey}|jland`;
  return m;
}
