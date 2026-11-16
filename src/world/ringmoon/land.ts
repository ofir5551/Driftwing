import * as THREE from 'three';
import { Config } from '../../core/Config';
import type { DayCycle } from '../DayCycle';
import { createChunkGeometry } from '../Terrain';
import { ringUniforms } from './materials';
import type { RingmoonLayout } from './RingmoonLayout';

/**
 * Ringmoon Shallows' ground, painted per pixel over the vertex colours (no vertices):
 *  - the moss: a carpet of small cushions on the islets and hills, each its own tint with
 *    dark gaps between and a domed normal, so the land reads as alien turf, not felt;
 *  - the islets' terrace risers: basalt columns, joints down them and hexagonal tops at the lip;
 *  - the shore: a band of wet sand, a lace of foam swashing at the waterline, tide pools on the
 *    flats above it that catch the sky;
 *  - the sea floor through the clear shallows: sand ripples, the moss beds as clumped
 *    cushions, the sand bars paler, and spores in the beds that glow after dark;
 *  - the explorers' paths: trodden pale sand with lit studs along their edges.
 * The terrain carries the layout's values per vertex in `aRing`: (distance to a path over 3 m,
 * sand bar, mainland, islet). Needs `withGroundDetail` applied first (it reuses its noise,
 * world position and normal varyings).
 */

/** Terrain geometry with the `aRing` attribute (see the module comment). */
export function createRingGeometry(res: number): THREE.BufferGeometry {
  const g = createChunkGeometry(res);
  const n = res + 1;
  g.setAttribute('aRing', new THREE.BufferAttribute(new Float32Array(n * n * 4), 4));
  return g;
}

/** Fill a chunk's `aRing` from the layout (its heights are already in place). */
export function fillRing(
  L: RingmoonLayout,
  g: THREE.BufferGeometry,
  ox: number,
  oz: number,
  size: number,
  res: number,
): void {
  const a = g.getAttribute('aRing') as THREE.BufferAttribute;
  const A = a.array as Float32Array;
  const P = g.getAttribute('position').array as Float32Array;
  const n = res + 1;
  const step = size / res;
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const x = ox + i * step;
      const z = oz + j * step;
      const k = j * n + i;
      const y = P[k * 3 + 1];
      A[k * 4] = y > 0 ? Math.min(L.pathDist(x, z) / 3, 2) : 2;
      A[k * 4 + 1] = y < 1 ? L.sandbar(x, z) : 0;
      A[k * 4 + 2] = L.mainland(x, z);
      A[k * 4 + 3] = L.isle(x, z);
    }
  a.needsUpdate = true;
}

const K = Config.ringmoon;
/** Shared uniforms (the world sets the sky per frame; time and night come from ringUniforms). */
export const ringLandUniforms = {
  uRmSky: { value: new THREE.Color() },
  uRmMoss: {
    get value() {
      return K.moss;
    },
  },
  uRmMossSize: {
    get value() {
      return K.mossSize;
    },
  },
  uRmSeabed: {
    get value() {
      return K.seabed;
    },
  },
  uRmFoam: {
    get value() {
      return K.foam;
    },
  },
  uRmPools: {
    get value() {
      return K.tidePools;
    },
  },
  uRmPool: { value: new THREE.Color('#3f9c98') },
  uRmBasalt: { value: new THREE.Color('#47455c') },
  uRmPath: { value: new THREE.Color('#cfc6b4') },
  uRmSpore: { value: new THREE.Color(0.35, 1.0, 0.85) },
};

/** Per frame: the sky the wet sand and the pools reflect. */
export function ringLandFrame(day: DayCycle): void {
  const p = day.palette;
  ringLandUniforms.uRmSky.value.copy(p.skyHorizon).lerp(p.skyTop, 0.4);
}

const PARS = /* glsl */ `
uniform float uRmTime;
uniform float uRmNight;
uniform vec3 uRmSky;
uniform float uRmMoss;
uniform float uRmMossSize;
uniform float uRmSeabed;
uniform float uRmFoam;
uniform float uRmPools;
uniform vec3 uRmPool;
uniform vec3 uRmBasalt;
uniform vec3 uRmPath;
uniform vec3 uRmSpore;
varying vec4 vRing;
// Nearest of a jittered grid of points: distance (cell units), offset from it, its hash.
vec4 rmCell(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  float best = 8.0;
  vec2 off = vec2(0.0);
  vec2 id = i;
  for (int y = -1; y <= 1; y++)
    for (int x = -1; x <= 1; x++) {
      vec2 g = vec2(float(x), float(y));
      vec2 r = g + 0.15 + 0.7 * vec2(gHash(i + g), gHash(i + g + 17.31)) - f;
      float d = dot(r, r);
      if (d < best) { best = d; off = -r; id = i + g; }
    }
  return vec4(sqrt(best), off, gHash(id + 5.17));
}
`;

const FRAG = /* glsl */ `
float rmMossK = 0.0;
vec2 rmTilt = vec2(0.0);
float rmGloss = 0.0;
float rmGlow = 0.0;
vec3 rmGlowCol = uRmSpore;
{
  vec3 N = normalize(vGNrm);
  float steep = 1.0 - N.y;
  float dist = distance(vGPos, cameraPosition);
  float fine = 1.0 - smoothstep(110.0, 360.0, dist);
  float y = vGPos.y;
  vec2 p = vGPos.xz;
  float t = uRmTime;
  float n1 = gNoise(p * 0.3);
  float isle = vRing.w * (1.0 - smoothstep(0.2, 0.5, vRing.z));
  if (y < 0.2) {
    // The sea floor. Ripples in the bare sand, long and parallel, bent by the current.
    float bright = smoothstep(0.55, 0.75, dot(diffuseColor.rgb, vec3(0.33)));
    float bar = vRing.y;
    float rip = sin(dot(p, vec2(0.55, 0.45)) * 2.3 + gNoise(p * 0.06) * 7.0);
    diffuseColor.rgb *= 1.0 + (0.07 + 0.06 * bar) * rip * max(bright, bar) * fine * uRmSeabed;
    // Bars: paler, cleaner sand, wet where they're awash.
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.86, 0.82, 0.68) * (0.95 + 0.1 * n1), smoothstep(0.2, 0.7, bar) * 0.6);
    // The moss beds as clumps: cushions with dark gaps, where the paint is moss (not sand).
    float bed = (1.0 - bright) * (1.0 - bar) * uRmSeabed;
    if (bed > 0.02) {
      vec4 c = rmCell(p / 1.1);
      float gap = smoothstep(0.4, 0.8, c.x);
      vec3 clump = diffuseColor.rgb * mix(vec3(1.07, 1.0, 1.05), vec3(0.94, 1.04, 1.0), c.w) * (1.0 - 0.2 * gap);
      clump = mix(diffuseColor.rgb * 0.92, clump, fine);
      diffuseColor.rgb = mix(diffuseColor.rgb, clump, bed);
      // Spores among the clumps glow faintly after dark, brighter in drifts.
      vec4 sp = rmCell(p / 0.9 + 40.0);
      float speck = (1.0 - smoothstep(0.05, 0.16, sp.x)) * step(0.62, sp.w) * smoothstep(0.35, 0.7, gNoise(p * 0.04));
      rmGlow = speck * bed * uRmNight * 1.6 * (0.7 + 0.3 * sin(t * 1.3 + sp.w * 40.0));
    }
  }
  // The shore: wet sand below the waves' reach, the swash's sheen and its lace of foam.
  if (y > -0.4 && y < 1.3 && steep < 0.5) {
    float amp = 0.22 * uRmFoam;
    float ph = gNoise(p * 0.015) * 9.0 + dot(p, vec2(0.027, 0.019));
    float sw = 0.03 + amp * (0.5 + 0.5 * sin(t * 0.6 + ph));
    float wet = 1.0 - smoothstep(amp + 0.2, amp + 0.5, y);
    diffuseColor.rgb *= mix(vec3(1.0), vec3(0.78, 0.8, 0.8), wet);
    float sheen = (1.0 - smoothstep(sw - 0.05, sw, y)) * smoothstep(-0.1, 0.05, y);
    rmGloss = max(rmGloss, sheen * 0.55 + wet * 0.15);
    float lace = gNoise(p * 1.3 + vec2(t * 0.12, -t * 0.08)) + 0.5 * gNoise(p * 3.1 - t * 0.18);
    float line = (1.0 - smoothstep(0.015, 0.06, abs(y - sw))) * smoothstep(0.45, 0.8, lace);
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.97, 1.0, 0.97), clamp(line * uRmFoam * (0.6 + 0.4 * fine), 0.0, 1.0));
  }
  // Tide pools on the shore flats and the low terrace treads, catching the sky.
  if (y > 0.3 && y < 3.0 && steep < 0.25 && uRmPools > 0.0) {
    float pn = gNoise(p * 0.11) + 0.6 * gNoise(p * 0.37 + 2.7);
    float zone = (1.0 - smoothstep(1.6, 3.0, y)) * (1.0 - vRing.z);
    float pool = smoothstep(1.02, 1.08, pn) * zone * uRmPools;
    if (pool > 0.0) {
      float rim = smoothstep(1.0, 1.02, pn) * (1.0 - smoothstep(1.02, 1.05, pn));
      vec3 pc = mix(uRmPool, uRmSky, 0.3) * (0.9 + 0.2 * gNoise(p * 1.3 + t * 0.25));
      diffuseColor.rgb = mix(diffuseColor.rgb, pc, pool);
      diffuseColor.rgb += vec3(0.14, 0.12, 0.1) * rim * zone;
      rmGloss = max(rmGloss, pool);
      // Something small glows in the pools at night.
      rmGlow = max(rmGlow, pool * uRmNight * 0.5 * step(0.8, gHash(floor(p * 0.7))));
    }
  }
  // The islets' terrace risers: basalt columns, joints running down, hexagonal tops at the lip.
  float riser = smoothstep(0.28, 0.5, steep + 0.15 * (n1 - 0.5)) * isle * smoothstep(0.6, 1.6, y) * (1.0 - smoothstep(8.0, 11.0, y));
  if (riser > 0.0) {
    vec2 tg = normalize(vec2(-N.z, N.x) + 1e-5);
    float al = dot(p, tg) / 1.3;
    float c = floor(al);
    float f = fract(al);
    float h = gHash(vec2(c, floor(y * 0.2)) + floor(p * 0.02));
    float fw = max(fwidth(al), 1e-4);
    float joint = 1.0 - smoothstep(fw, fw + 0.08, min(f, 1.0 - f));
    vec3 col = uRmBasalt * (0.82 + 0.3 * h) * (1.0 - 0.35 * joint);
    // A rusty lichen streak or two, and a wet dark foot.
    col = mix(col, vec3(0.55, 0.36, 0.25), smoothstep(0.75, 0.95, gNoise(vec2(al * 0.7, y * 0.4))) * 0.5);
    diffuseColor.rgb = mix(diffuseColor.rgb, col, riser);
    rmTilt += tg * (f - 0.5) * 0.9 * riser * fine;
  }
  // Moss cushions on the land (not the rock, the paths or the wet sand).
  rmMossK = smoothstep(0.9, 1.6, y) * (1.0 - smoothstep(0.3, 0.55, steep)) * (1.0 - riser) * uRmMoss;
  if (rmMossK > 0.0) {
    float sz = uRmMossSize * (1.0 + 0.5 * vRing.z);
    vec4 c = rmCell(p / sz);
    float gap = smoothstep(0.5, 0.9, c.x);
    // Patches of tone a few metres across (violet deepening, a warmer or a tealer cast), the
    // little cushions within them only a light dappling.
    float tone = gNoise(p * 0.21) + 0.5 * gNoise(p * 0.55 + 4.0);
    vec3 hue = mix(vec3(1.07, 0.97, 1.05), vec3(0.93, 1.05, 1.02), smoothstep(0.55, 1.0, tone));
    hue *= 1.0 + 0.06 * (c.w - 0.5) - 0.1 * gap;
    hue = mix(hue, vec3(1.1, 1.05, 0.86), step(0.93, fract(c.w * 7.3)) * 0.5);
    float mfine = 1.0 - smoothstep(50.0, 200.0, dist);
    vec3 cush = diffuseColor.rgb * mix(vec3(0.96 + 0.08 * gNoise(p * 0.25)), hue, mfine);
    diffuseColor.rgb = mix(diffuseColor.rgb, cush, rmMossK);
    rmTilt += c.yz * (1.0 - smoothstep(0.4, 0.75, c.x)) * rmMossK * mfine * 0.3;
  }
  // The explorers' paths: trodden pale sand, lit studs along the edges after dark.
  float path = 1.0 - smoothstep(0.42, 0.6, vRing.x + 0.08 * (n1 - 0.5));
  if (path > 0.0) {
    vec3 pc = uRmPath * (0.92 + 0.1 * gNoise(p * 1.7)) * (1.0 - 0.1 * smoothstep(0.2, 0.0, vRing.x));
    diffuseColor.rgb = mix(diffuseColor.rgb, pc, path * 0.85);
    rmMossK *= 1.0 - path;
    vec4 st = rmCell(p / 2.6 + 9.0);
    float edge = smoothstep(0.3, 0.42, vRing.x) * (1.0 - smoothstep(0.48, 0.56, vRing.x));
    float stud = (1.0 - smoothstep(0.06, 0.12, st.x)) * edge;
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.75, 0.95, 0.9), stud * 0.6);
    if (stud > rmGlow * 0.5) { rmGlow = stud * (0.25 + uRmNight * 2.2); rmGlowCol = vec3(0.5, 1.0, 0.9); }
  }
}`;

/** Each moss cushion and basalt column leans its normal; then the glow is added. */
const NORMAL = /* glsl */ `
if (rmTilt.x != 0.0 || rmTilt.y != 0.0) {
  vec3 rN0 = normalize(vGNrm);
  vec3 rD = vec3(rmTilt.x, 0.0, rmTilt.y);
  rD -= rN0 * dot(rN0, rD);
  vec3 rW = normalize(rN0 + rD * 1.1);
  normal = normalize((viewMatrix * vec4(rW, 0.0)).xyz);
}
#include <emissivemap_fragment>
totalEmissiveRadiance += rmGlowCol * rmGlow;`;

/** After the lights: wet sand and the pools catch a little of the sky. */
const GLOSS = /* glsl */ `
if (rmGloss > 0.0) {
  vec3 rV = normalize(cameraPosition - vGPos);
  float rFres = 0.2 + 0.8 * pow(1.0 - clamp(rV.y, 0.0, 1.0), 3.0);
  outgoingLight = mix(outgoingLight, uRmSky, rmGloss * rFres * 0.45);
}
#include <opaque_fragment>`;

/** Paints Ringmoon's ground (see the module comment) on a toon terrain with `withGroundDetail`. */
export function withRingLand<T extends THREE.Material>(m: T): T {
  const prev = m.onBeforeCompile.bind(m);
  const prevKey = m.customProgramCacheKey.bind(m);
  m.onBeforeCompile = (shader, renderer) => {
    prev(shader, renderer);
    Object.assign(shader.uniforms, ringLandUniforms);
    shader.uniforms.uRmTime = ringUniforms.uRmTime;
    shader.uniforms.uRmNight = ringUniforms.uRmNight;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aRing;\nvarying vec4 vRing;')
      .replace('#include <project_vertex>', '#include <project_vertex>\n  vRing = aRing;');
    shader.fragmentShader = shader.fragmentShader
      .replace('float gBumpAt(', `${PARS}\nfloat gBumpAt(`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${FRAG}`)
      .replace('#include <emissivemap_fragment>', NORMAL)
      .replace('#include <opaque_fragment>', GLOSS);
  };
  m.customProgramCacheKey = () => `${prevKey()}|rm-land`;
  return m;
}
