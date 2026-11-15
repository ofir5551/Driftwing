import * as THREE from 'three';
import { Config } from '../../core/Config';
import { clamp, smoothstep } from '../../core/math';
import type { DayCycle } from '../DayCycle';
import { createChunkGeometry, type HeightField } from '../Terrain';
import type { KarstLayout } from './KarstLayout';

/**
 * Jade River's ground: the vertex colour (grass, groves, villages' packed earth, mossy scree,
 * pale shores) and, in the terrain shader, the terraced paddies and the footpaths, read from a
 * per-vertex `aKarst`: (metres from the river bank, paddy share minus grove density, the land's
 * height before the terraces cut it, metres to the nearest path or, negative, the scree's depth). Every one is smooth, so the
 * shader's bilinear reading of it is exact enough: field edges and bunds follow the terrace
 * contours at pixel sharpness on a 4 m lattice. Flooded fields are mirrors of the sky.
 */

// Ground palette (sRGB; the toon material and fog tint it per time of day).
const C = {
  bed: new THREE.Color('#4f7268'),
  shallows: new THREE.Color('#87a596'),
  shore: new THREE.Color('#cdc5ae'),
  grass: new THREE.Color('#98bd78'),
  meadow: new THREE.Color('#b9c987'),
  grove: new THREE.Color('#6c9663'),
  scree: new THREE.Color('#7f9373'),
  screeStone: new THREE.Color('#9a9f93'),
  earth: new THREE.Color('#c6baa0'),
  paddy: new THREE.Color('#9dbd74'),
};

export function karstColor(
  L: KarstLayout,
  f: HeightField,
  x: number,
  z: number,
  y: number,
  out: THREE.Color,
): THREE.Color {
  if (y < -0.4) return out.copy(C.shallows).lerp(C.bed, smoothstep(-0.4, -3, y));
  const t = f.tint(x, z);
  L.land(x, z);
  const scree = y - L.lBase;
  out.copy(C.grass).lerp(C.meadow, 0.5 + 0.5 * t);
  // The paddies' risers and bunds are grass; the shader paints the fields on the treads.
  out.lerp(C.paddy, L.pw * 0.8);
  out.lerp(C.grove, L.lGrove * 0.7);
  out.lerp(C.earth, L.lVillage * 0.55);
  // Scree mounds at the pillars' feet: mossy, with grey stone showing through.
  const sc = smoothstep(0.4, 4, scree);
  out.lerp(C.scree, sc).lerp(C.screeStone, sc * smoothstep(0.1, 0.7, t) * 0.5);
  out.lerp(C.shore, 1 - smoothstep(1, 8, L.lBank));
  return out.multiplyScalar(0.95 + 0.06 * t);
}

/** Terrain geometry with the `aKarst` attribute (see the module comment). */
export function createKarstGeometry(res: number): THREE.BufferGeometry {
  const g = createChunkGeometry(res);
  const n = res + 1;
  g.setAttribute('aKarst', new THREE.BufferAttribute(new Float32Array(n * n * 4), 4));
  return g;
}

export function fillKarst(
  L: KarstLayout,
  g: THREE.BufferGeometry,
  ox: number,
  oz: number,
  size: number,
  res: number,
): void {
  const a = g.getAttribute('aKarst') as THREE.BufferAttribute;
  const A = a.array as Float32Array;
  // The chunk's heights are already in place: the scree over the valley floor is their excess.
  const P = g.getAttribute('position').array as Float32Array;
  const n = res + 1;
  const step = size / res;
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      L.land(ox + i * step, oz + j * step);
      const k = (j * n + i) * 4;
      const scree = P[(j * n + i) * 3 + 1] - L.lBase;
      A[k] = clamp(L.lBank, -400, 400);
      // No paddy (and no rice) on a pillar's scree mound.
      A[k + 1] = L.pw * (1 - smoothstep(0.2, 1.2, scree)) - L.lGrove;
      A[k + 2] = L.raw;
      // Metres to a path, or (negative) how deep the scree lies here: no path on the scree.
      A[k + 3] = scree > 0.3 ? -Math.min(scree, 10) : Math.min(L.lPath, 60);
    }
  a.needsUpdate = true;
}

const K = Config.karst;
/** Shared uniforms; the sky's colours and the sun follow the day (karstLandFrame). */
export const landUniforms = {
  uKStep: {
    get value() {
      return K.terraceStep;
    },
  },
  uKField: {
    get value() {
      return K.fieldCell;
    },
  },
  uKPathW: {
    get value() {
      return K.pathWidth;
    },
  },
  uKMirror: {
    get value() {
      return K.paddyMirror;
    },
  },
  uKMud: { value: new THREE.Color('#6f7f5c') },
  uKYoung: { value: new THREE.Color('#8fc25a') },
  uKRipe: { value: new THREE.Color('#d6c66e') },
  uKBund: { value: new THREE.Color('#7fa35a') },
  uKPath: { value: new THREE.Color('#c9b48e') },
  uKSkyTop: { value: new THREE.Color() },
  uKSkyHorizon: { value: new THREE.Color() },
  uKSun: { value: new THREE.Color() },
  uKSunDir: { value: new THREE.Vector3(0, 1, 0) },
  uKTime: { value: 0 },
};

/** Per frame: the paddies mirror this hour's sky and catch its sun. */
export function karstLandFrame(day: DayCycle, time: number): void {
  const u = landUniforms;
  const p = day.palette;
  u.uKSkyTop.value.copy(p.skyTop);
  u.uKSkyHorizon.value.copy(p.skyHorizon);
  u.uKSun.value.copy(p.sun).multiplyScalar(p.sunIntensity);
  u.uKSunDir.value.copy(day.sunDir);
  u.uKTime.value = time;
}

const VERT = /* glsl */ `
attribute vec4 aKarst;
varying vec4 vKarst;`;

const FRAG_PARS = /* glsl */ `
varying vec4 vKarst;
uniform float uKStep;
uniform float uKField;
uniform float uKPathW;
uniform float uKMirror;
uniform vec3 uKMud;
uniform vec3 uKYoung;
uniform vec3 uKRipe;
uniform vec3 uKBund;
uniform vec3 uKPath;
uniform vec3 uKSkyTop;
uniform vec3 uKSkyHorizon;
uniform vec3 uKSun;
uniform vec3 uKSunDir;
uniform float uKTime;`;

const FRAG = /* glsl */ `
float kWet = 0.0;
{
  vec3 kN = normalize(vGNrm);
  float kFine = 1.0 - smoothstep(160.0, 480.0, distance(vGPos, cameraPosition));
  // The raw height's slope (m per m), from its screen derivatives against the world position's:
  // exact for the interpolated attribute within a triangle. Taken outside any branch.
  vec3 kDx = dFdx(vGPos);
  vec3 kDy = dFdy(vGPos);
  float kRx = dFdx(vKarst.z);
  float kRy = dFdy(vKarst.z);
  float kDet = kDx.x * kDy.z - kDx.z * kDy.x;
  vec2 kGrad = abs(kDet) > 1e-7
    ? vec2(kRx * kDy.z - kRy * kDx.z, kRy * kDx.x - kRx * kDy.x) / kDet
    : vec2(0.0);
  float kSlope = clamp(length(kGrad), 0.006, 2.0);
  float kP = clamp(vKarst.y, 0.0, 1.0);
  if (kP > 0.01) {
    float lv = vKarst.z / uKStep;
    float ti = floor(lv);
    float fr = lv - ti;
    vec2 cell = floor(vGPos.xz / uKField);
    // The field's kind: the layout's paddyKind, integer arithmetic exact in float32.
    float t = mod(ti, 64.0);
    float a = mod(cell.x, 64.0);
    float b = mod(cell.y, 64.0);
    float hn = t * 31.0 + a * 17.0 + b * 13.0 + t * a * 7.0 + a * b * 3.0 + t * b * 5.0;
    float kind = mod(mod(hn, 97.0), 20.0);
    // Metres from the tread's downhill edge (its bund), to its uphill riser, to a cross bund.
    float dLow = fr * uKStep / kSlope;
    float dHigh = (0.82 - fr) * uKStep / kSlope;
    vec2 cf = fract(vGPos.xz / uKField) * uKField;
    float dCross = min(min(cf.x, uKField - cf.x), min(cf.y, uKField - cf.y));
    float onTread = 1.0 - smoothstep(0.8, 0.84, fr);
    float bund = (1.0 - smoothstep(0.35, 0.75, min(min(dLow, dHigh), dCross))) * onTread;
    vec3 fc = uKMud;
    if (kind >= 16.0) {
      fc = uKRipe * (1.0 + 0.1 * sin(dot(vGPos.xz, vec2(0.8, 0.6)) * 3.1) * kFine);
    } else if (kind >= 9.0) {
      fc = uKYoung * (1.0 + 0.14 * sin(dot(vGPos.xz, vec2(0.6, -0.8)) * 3.1) * kFine);
    }
    fc *= 0.9 + 0.2 * gNoise(vGPos.xz * 0.12 + cell * 3.7);
    fc = mix(fc, uKBund, bund);
    diffuseColor.rgb = mix(diffuseColor.rgb, fc, kP * onTread);
    float wet = kind < 9.0 ? 1.0 : kind < 16.0 ? 0.3 : 0.0;
    kWet = wet * (1.0 - bund) * onTread * smoothstep(0.7, 0.95, kP) * smoothstep(0.96, 0.99, kN.y);
  }
  // Footpaths: packed earth worn pale down the middle, on dry, gentle ground off the scree.
  float kPath = (1.0 - smoothstep(uKPathW * 0.7, uKPathW * 1.15, vKarst.w)) * step(0.0, vKarst.w)
    * smoothstep(0.8, 0.93, kN.y) * smoothstep(0.25, 0.7, vGPos.y);
  if (kPath > 0.0) {
    vec3 pc = uKPath * (0.88 + 0.22 * gNoise(vGPos.xz * 0.6));
    pc = mix(pc, diffuseColor.rgb, (1.0 - smoothstep(0.1, 0.45, abs(vKarst.w - uKPathW * 0.55))) * 0.25 * kFine);
    diffuseColor.rgb = mix(diffuseColor.rgb, pc, kPath);
    kWet *= 1.0 - kPath;
  }
}`;

const MIRROR = /* glsl */ `
if (kWet > 0.0) {
  // A flooded field mirrors the sky: the reflected ray's height picks between the horizon and
  // the zenith colour, more of it at a grazing look (Fresnel), with faint ripples and a glint
  // of the sun (HDR, so bloom catches it).
  vec3 kV = normalize(cameraPosition - vGPos);
  vec2 kr = vec2(gNoise(vGPos.xz * 0.7 + uKTime * 0.25), gNoise(vGPos.zx * 0.7 - uKTime * 0.2)) - 0.5;
  vec3 kNw = normalize(vec3(kr.x * 0.05, 1.0, kr.y * 0.05));
  vec3 kR = reflect(-kV, kNw);
  vec3 kSky = mix(uKSkyHorizon, uKSkyTop, pow(clamp(kR.y, 0.0, 1.0), 0.6));
  float kFres = 0.35 + 0.65 * pow(1.0 - clamp(dot(kV, kNw), 0.0, 1.0), 3.0);
  float kGlint = pow(max(dot(kR, uKSunDir), 0.0), 260.0) * 2.0;
  outgoingLight = mix(outgoingLight, kSky, kWet * kFres * uKMirror) + uKSun * kGlint * kWet;
}
#include <opaque_fragment>`;

/**
 * Paints the paddies and paths on Jade River's terrain material, and mirrors the sky in the
 * flooded fields. Apply after withGroundDetail (it uses that patch's noise, position and
 * normal; the fields get its mottle too, as it runs after this).
 */
export function withKarstLand<T extends THREE.Material>(m: T): T {
  const prev = m.onBeforeCompile.bind(m);
  const prevKey = m.customProgramCacheKey.bind(m);
  m.onBeforeCompile = (shader, renderer) => {
    prev(shader, renderer);
    Object.assign(shader.uniforms, landUniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERT}`)
      .replace('#include <project_vertex>', '#include <project_vertex>\n  vKarst = aKarst;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAG_PARS}`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${FRAG}`)
      .replace('#include <opaque_fragment>', MIRROR);
  };
  m.customProgramCacheKey = () => `${prevKey()}|karstland`;
  return m;
}
