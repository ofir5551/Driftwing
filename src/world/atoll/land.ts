import * as THREE from 'three';
import { Config } from '../../core/Config';
import { clamp, smoothstep } from '../../core/math';
import type { DayCycle } from '../DayCycle';
import { createChunkGeometry } from '../Terrain';
import type { AtollLayout } from './AtollLayout';

/**
 * Coral Atolls' ground, painted per pixel over the vertex colours (no vertices):
 *  - jungle: wherever the paint is green above the beach, a carpet of tree crowns, each its
 *    own tint with dark gaps between and a domed normal, so a forested slope reads as foliage
 *    (also on the mushroom rocks' jungle caps);
 *  - the shore: a band of wet sand, a lace of foam at the waterline that swashes up and back
 *    (higher on the ocean side of an islet, where the swell reaches), a sheen where it ran;
 *  - the reef flat: bare rubble and coralline crust where the crest dries, tide pools between;
 *  - the seabed, seen through the clear water: sand ripples, seagrass meadows, coral gardens
 *    of pink, purple, mustard and teal heads on the lagoon's coral knolls.
 * The terrain carries the layout's values per vertex in `aAtoll`: (reef-flat share, ocean side
 * of the shore, seagrass, coral). Needs `withGroundDetail` applied first (it reuses its noise,
 * world position and normal varyings).
 */

/** Terrain geometry with the `aAtoll` attribute (see the module comment). */
export function createAtollGeometry(res: number): THREE.BufferGeometry {
  const g = createChunkGeometry(res);
  const n = res + 1;
  g.setAttribute('aAtoll', new THREE.BufferAttribute(new Float32Array(n * n * 4), 4));
  return g;
}

/** Fill a chunk's `aAtoll` from the layout (its heights are already in place). */
export function fillAtoll(
  L: AtollLayout,
  g: THREE.BufferGeometry,
  ox: number,
  oz: number,
  size: number,
  res: number,
): void {
  const a = g.getAttribute('aAtoll') as THREE.BufferAttribute;
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
      const rs = L.ring(x, z);
      const at = L.ra;
      let reef = 0;
      let ocean = 0;
      let coral = 0;
      if (at) {
        const w = at.w;
        reef = 1 - smoothstep(w * 0.6, w * 1.1, Math.abs(rs));
        ocean = smoothstep(-w * 0.4, w * 0.3, rs);
        if (rs < -w) coral = L.bommie(x, z) * smoothstep(-1.2, -2.5, y);
      }
      A[k * 4] = reef;
      A[k * 4 + 1] = clamp(ocean, 0, 1);
      A[k * 4 + 2] = L.seagrass(x, z, y);
      A[k * 4 + 3] = coral;
    }
  a.needsUpdate = true;
}

const K = Config.atoll;
/** Shared uniforms (AtollWorld sets the time and the sky per frame). */
export const atollLandUniforms = {
  uATime: { value: 0 },
  uASky: { value: new THREE.Color() },
  uACrowns: {
    get value() {
      return K.crowns;
    },
  },
  uACrownSize: {
    get value() {
      return K.crownSize;
    },
  },
  uACrownFar: {
    get value() {
      return K.crownFar;
    },
  },
  uAFoam: {
    get value() {
      return K.foam;
    },
  },
  uAPools: {
    get value() {
      return K.tidePools;
    },
  },
  uAGrass: { value: new THREE.Color('#3d7a4e') },
  uARubble: { value: new THREE.Color('#cdb6a2') },
  uAPool: { value: new THREE.Color('#2f95a3') },
  uACorals: {
    value: ['#e2809b', '#9c7ccb', '#d8b347', '#4db3a0', '#ea8a5c'].map((h) => new THREE.Color(h)),
  },
};

/** Per frame: the foam's clock and the sky the wet sand and the pools reflect. */
export function atollLandFrame(day: DayCycle, time: number): void {
  const p = day.palette;
  atollLandUniforms.uATime.value = time;
  atollLandUniforms.uASky.value.copy(p.skyHorizon).lerp(p.skyTop, 0.4);
}

const PARS = /* glsl */ `
uniform float uATime;
uniform vec3 uASky;
uniform float uACrowns;
uniform float uACrownSize;
uniform float uACrownFar;
uniform float uAFoam;
uniform float uAPools;
uniform vec3 uAGrass;
uniform vec3 uARubble;
uniform vec3 uAPool;
uniform vec3 uACorals[5];
#ifdef ATOLL_LAND
varying vec4 vAtoll;
#endif
// Nearest of a jittered grid of points: distance (cell units), offset from it, its hash.
vec4 aCell(vec2 p) {
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
// A crown's dome fades flat toward its rim: neighbours meet in a soft hollow, not a crease.
float aRim(float d) { return 1.0 - smoothstep(0.4, 0.7, d); }
`;

const FRAG = /* glsl */ `
float aCan = 0.0;
vec3 aCanTilt = vec3(0.0);
float aGloss = 0.0;
{
  vec3 aN = normalize(vGNrm);
  float aDist = distance(vGPos, cameraPosition);
  float aFine = 1.0 - smoothstep(140.0, 420.0, aDist);
  // Jungle: a carpet of crowns. Triplanar-lite: the ground plane on gentle slopes, the two
  // wall planes on steep ones.
  aCan = smoothstep(0.03, 0.1, diffuseColor.g - max(diffuseColor.r, diffuseColor.b))
    * smoothstep(2.5, 6.0, vGPos.y) * uACrowns * (1.0 - smoothstep(uACrownFar * 0.6, uACrownFar, aDist));
  if (aCan > 0.0) {
    vec3 w = pow(abs(aN), vec3(4.0));
    w /= w.x + w.y + w.z;
    vec3 p = vGPos / uACrownSize;
    float gap = 0.0;
    float tint = 0.0;
    if (w.y > 0.02) {
      vec4 c = aCell(p.xz);
      gap += w.y * c.x; tint += w.y * c.w; aCanTilt += w.y * aRim(c.x) * vec3(c.y, 0.0, c.z);
    }
    if (w.x > 0.02) {
      vec4 c = aCell(p.zy + 31.7);
      gap += w.x * c.x; tint += w.x * c.w; aCanTilt += w.x * aRim(c.x) * vec3(0.0, c.z, c.y);
    }
    if (w.z > 0.02) {
      vec4 c = aCell(p.xy + 63.1);
      gap += w.z * c.x; tint += w.z * c.w; aCanTilt += w.z * aRim(c.x) * vec3(c.y, c.z, 0.0);
    }
    float shade = 1.0 - 0.38 * smoothstep(0.42, 0.78, gap);
    vec3 hue = mix(vec3(1.1, 1.06, 0.78), vec3(0.86, 0.96, 1.06), tint);
    diffuseColor.rgb *= mix(vec3(1.0), hue * shade, aCan);
  }
#ifdef ATOLL_LAND
  float y = vGPos.y;
  vec2 p = vGPos.xz;
  float t = uATime;
  if (y < 0.1) {
    // The seabed. Ripples in the bare sand, long and parallel, bent by the current.
    float sandy = (1.0 - vAtoll.z) * (1.0 - vAtoll.w) * (1.0 - vAtoll.x) * smoothstep(-7.0, -0.5, y);
    float rip = sin(dot(p, vec2(0.62, 0.38)) * 2.1 + gNoise(p * 0.07) * 7.0);
    diffuseColor.rgb *= 1.0 + 0.09 * rip * sandy * aFine;
    // Seagrass: dark green meadows with ragged edges, combed by the current.
    float g = smoothstep(0.2, 0.55, vAtoll.z + (gNoise(p * 0.18) - 0.5) * 0.45);
    if (g > 0.0) {
      float blade = gNoise(vec2(dot(p, vec2(0.8, 0.6)) * 0.5, dot(p, vec2(-0.6, 0.8)) * 3.5));
      diffuseColor.rgb = mix(diffuseColor.rgb, uAGrass * (0.75 + 0.5 * mix(0.5, blade, aFine)), g * 0.85);
    }
    // Coral gardens on the lagoon's knolls: heads of every colour, rubble and shade between.
    float co = vAtoll.w;
    if (co > 0.02) {
      vec4 c = aCell(p / 1.3);
      int ci = int(floor(c.w * 4.999));
      vec3 cc = uACorals[0];
      if (ci == 1) cc = uACorals[1];
      else if (ci == 2) cc = uACorals[2];
      else if (ci == 3) cc = uACorals[3];
      else if (ci == 4) cc = uACorals[4];
      float head = (1.0 - smoothstep(0.22, 0.5, c.x)) * step(0.25, fract(c.w * 13.7));
      vec3 garden = mix(diffuseColor.rgb * 0.74, mix(diffuseColor.rgb, cc, 0.6) * (0.85 + 0.25 * (1.0 - c.x)), head);
      // Far off the heads blur into one warm, speckled patch.
      garden = mix(mix(diffuseColor.rgb * 0.86, vec3(0.6, 0.46, 0.5), 0.18), garden, aFine);
      diffuseColor.rgb = mix(diffuseColor.rgb, garden, smoothstep(0.05, 0.4, co));
    }
  }
  // The reef flat: coralline crust and rubble, bare where the crest dries, with tide pools.
  float reef = vAtoll.x * uAPools;
  if (reef > 0.02 && y > -0.9 && y < 0.6) {
    float dots = gNoise(p * 0.9) + 0.5 * gNoise(p * 2.3 + 4.1);
    vec3 rub = uARubble * (0.82 + 0.25 * dots) * mix(vec3(1.0), vec3(1.08, 0.86, 0.9), smoothstep(0.9, 1.2, dots));
    float bare = smoothstep(-0.25, 0.05, y);
    diffuseColor.rgb = mix(diffuseColor.rgb, rub, reef * mix(0.35, 0.9, bare));
    float pn = gNoise(p * 0.16) + 0.55 * gNoise(p * 0.45 + 2.7);
    float pool = smoothstep(0.98, 1.06, pn) * bare * reef;
    if (pool > 0.0) {
      float rim = smoothstep(0.98, 1.0, pn) * (1.0 - smoothstep(1.0, 1.04, pn));
      vec3 pc = mix(uAPool, uASky, 0.25) * (0.9 + 0.2 * gNoise(p * 1.4 + t * 0.3));
      diffuseColor.rgb = mix(diffuseColor.rgb, pc, pool);
      diffuseColor.rgb += vec3(0.18) * rim * reef;
      aGloss = max(aGloss, pool);
    }
  }
  // The shore: wet sand below the reach of the waves, the swash's sheen and its lace of foam.
  if (y > -0.35 && y < 1.1 && aCan <= 0.0) {
    float amp = (0.12 + 0.3 * vAtoll.y) * uAFoam;
    float ph = gNoise(p * 0.015) * 9.0 + dot(p, vec2(0.031, 0.022));
    float sw = 0.03 + amp * (0.5 + 0.5 * sin(t * 0.75 + ph));
    float wet = 1.0 - smoothstep(amp + 0.18, amp + 0.45, y);
    diffuseColor.rgb *= mix(vec3(1.0), vec3(0.8, 0.78, 0.74), wet * (1.0 - reef * 0.7));
    float sheen = (1.0 - smoothstep(sw - 0.05, sw, y)) * smoothstep(-0.1, 0.05, y);
    aGloss = max(aGloss, sheen * 0.6 + wet * 0.15);
    float lace = gNoise(p * 1.3 + vec2(t * 0.15, -t * 0.1)) + 0.5 * gNoise(p * 3.1 - t * 0.2);
    float line = (1.0 - smoothstep(0.015, 0.06, abs(y - sw))) * smoothstep(0.45, 0.8, lace);
    float trail = (1.0 - smoothstep(0.0, 0.12, sw - y)) * step(y, sw) * smoothstep(0.85, 1.1, lace) * 0.6;
    float foam = max(line, trail) * uAFoam * (0.6 + 0.4 * aFine);
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(1.0, 1.0, 0.98), clamp(foam, 0.0, 1.0));
  }
#endif
}`;

/** After the lights: the wet sand and the pools catch a little of the sky. */
const GLOSS = /* glsl */ `
#ifdef ATOLL_LAND
if (aGloss > 0.0) {
  vec3 aV = normalize(cameraPosition - vGPos);
  float aFres = 0.2 + 0.8 * pow(1.0 - clamp(aV.y, 0.0, 1.0), 3.0);
  outgoingLight = mix(outgoingLight, uASky, aGloss * aFres * 0.45);
}
#endif
#include <opaque_fragment>`;

/** Each crown a dome: the normal leans out from its centre, after the ground's own bumps. */
const CROWN_NORMAL = /* glsl */ `
if (aCan > 0.0) {
  vec3 aN0 = normalize(vGNrm);
  vec3 aD = aCanTilt - aN0 * dot(aN0, aCanTilt);
  vec3 aW = normalize(aN0 + aD * 1.3 * aCan);
  normal = normalize(mix(normal, (viewMatrix * vec4(aW, 0.0)).xyz, aCan));
}
#include <emissivemap_fragment>`;

/**
 * Paints Coral Atolls' ground (see the module comment) on a toon material that already has
 * `withGroundDetail`. `land`: the terrain (shore, reef, seabed from `aAtoll`); without it only
 * the crown carpet (the mushroom rocks' caps).
 */
export function withAtollLand<T extends THREE.Material>(m: T, land: boolean): T {
  const prev = m.onBeforeCompile.bind(m);
  const prevKey = m.customProgramCacheKey.bind(m);
  m.onBeforeCompile = (shader, renderer) => {
    prev(shader, renderer);
    Object.assign(shader.uniforms, atollLandUniforms);
    const def = land ? '#define ATOLL_LAND\n' : '';
    if (land)
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          '#include <common>\nattribute vec4 aAtoll;\nvarying vec4 vAtoll;',
        )
        .replace('#include <project_vertex>', '#include <project_vertex>\n  vAtoll = aAtoll;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `${def}#include <common>`)
      .replace('float gBumpAt(', `${PARS}\nfloat gBumpAt(`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${FRAG}`)
      .replace('#include <emissivemap_fragment>', CROWN_NORMAL)
      .replace('#include <opaque_fragment>', GLOSS);
  };
  m.customProgramCacheKey = () => `${prevKey()}|atoll${land ? '-land' : ''}`;
  return m;
}
