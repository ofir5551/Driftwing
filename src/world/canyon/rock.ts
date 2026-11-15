import * as THREE from 'three';
import { Config } from '../../core/Config';

/**
 * Red Canyons' rock, painted per pixel from world height instead of per vertex. The terrain's
 * vertices sit 4 m apart (11 m in the far LOD), so strata baked into vertex colours smeared
 * into zigzags and blobs across a 30 m cliff; here every band edge is crisp at any mesh
 * density, and the arches, hoodoos and dwellings' brows share the walls' layers (the same
 * rock at the same levels). Also the warm light the red walls bounce into the canyon's shade.
 *
 * Needs `withGroundDetail` applied first (it reuses its world-position varyings and noise).
 */
const K = Config.canyon;
/** The walls' rock layers from the floor up, repeated. */
const STRATA = ['#9a4429', '#b85a33', '#dba574', '#c8703e', '#a94d2e', '#d08a55', '#e6c597'].map(
  (h) => new THREE.Color(h),
);

/** Bounce light (CanyonWorld sets it per frame from the palette and Config.levelLight). */
export const bounceUniforms = {
  uBounceColor: { value: new THREE.Color() },
  /** Height of the rims: the bounce fades out toward them. */
  uBounceTop: { value: 125 },
};

const uniforms = {
  uRockBands: { value: STRATA },
  uRockBand: {
    get value() {
      return K.rockBand;
    },
  },
  uRockSeam: {
    get value() {
      return K.rockSeam;
    },
  },
  uRockVarnish: {
    get value() {
      return K.rockVarnish;
    },
  },
  uRockContrast: {
    get value() {
      return K.rockContrast;
    },
  },
  uRockMean: {
    value: STRATA.reduce((a, c) => a.add(c), new THREE.Color(0, 0, 0)).multiplyScalar(
      1 / STRATA.length,
    ),
  },
  ...bounceUniforms,
};

const PARS = /* glsl */ `
uniform vec3 uRockBands[7];
uniform float uRockBand;
uniform float uRockSeam;
uniform float uRockVarnish;
uniform float uRockContrast;
uniform vec3 uRockMean;
uniform vec3 uBounceColor;
uniform float uBounceTop;
// Band colour at a world point: level layers whose lines wander a little (painted, not ruled),
// soft-edged into the next layer, with a dark seam under each ledge and fine laminations.
vec3 rockStrata(vec3 p, float steep) {
  float w = 2.4 * (gNoise(p.xz * 0.004) * 2.0 - 1.0) + 1.2 * sin(p.x * 0.013 + p.z * 0.009)
          + 0.6 * gNoise(vec2(p.x + p.z, p.y) * 0.05);
  float yy = (p.y + w) / uRockBand;
  // Uneven layers: warp the count so some bands are thick and some thin (still monotonic).
  yy += 0.33 * sin(yy * 1.7 + 1.3) + 0.12 * sin(yy * 4.1 + 0.4);
  float k = floor(yy);
  float f = yy - k;
  int i0 = int(mod(k, 7.0));
  int i1 = int(mod(k + 1.0, 7.0));
  vec3 c = mix(uRockBands[i0], uRockBands[i1], smoothstep(0.78, 1.0, f));
  // Keep the layers a family of one rock: pulled toward their mean, drifting along the wall.
  c = mix(uRockMean, c, uRockContrast) * (1.0 + 0.12 * (gNoise(p.xz * 0.012 + p.y * 0.01) - 0.5));
  // A shadowed seam where a softer layer weathers back under a harder one; a lit lip above it.
  c *= 1.0 - uRockSeam * smoothstep(0.86, 0.97, f) * (1.0 - smoothstep(0.97, 1.0, f));
  c *= 1.0 + uRockSeam * 0.25 * (1.0 - smoothstep(0.0, 0.08, f));
  // Fine laminations inside a band.
  c *= 1.0 + 0.05 * sin(yy * 18.85 + gNoise(p.xz * 0.07) * 3.0);
  // Desert varnish: dark blue-brown streaks hanging down the steep faces, strongest under the
  // lip of a layer and thinning as they run down it.
  float along = p.x * 0.7 + p.z * 0.7;
  float s = gNoise(vec2(along * 0.28, p.y * 0.012 + 4.0)) * 0.7 + gNoise(vec2(along * 0.9, p.y * 0.03)) * 0.3;
  s = smoothstep(0.5, 0.82, s) * (0.55 + 0.45 * (1.0 - f));
  c = mix(c, vec3(0.3, 0.17, 0.14), s * uRockVarnish * smoothstep(0.3, 0.6, steep));
  return c;
}`;

/**
 * Warm light off the sunlit walls into the canyon's shade: strongest low between the walls on
 * faces that look across the canyon (and under the arches), fading up toward the rims.
 */
const BOUNCE = /* glsl */ `
{
  vec3 bN = normalize(vGNrm);
  float bDeep = 1.0 - smoothstep(uBounceTop * 0.15, uBounceTop * 0.95, vGPos.y);
  float bFace = 0.35 + 0.65 * (1.0 - max(bN.y, 0.0));
  reflectedLight.indirectDiffuse += diffuseColor.rgb * uBounceColor * bDeep * bFace;
}`;

/**
 * Flutes: the vertical grooves rain and rockfall carve down a sandstone cliff, as a tilt of the
 * normal across the face (along its horizontal tangent), so the toon bands stripe the cliffs
 * top to bottom while the strata stripe them across. Steep rock only; no vertices.
 */
const FLUTES = /* glsl */ `
{
  vec3 fN = normalize(vGNrm);
  float fSteep = smoothstep(0.3, 0.65, 1.0 - fN.y) * (1.0 - smoothstep(uGFar * 0.4, uGFar * 1.2, distance(vGPos, cameraPosition)));
  if (fSteep > 0.0) {
    vec2 tg = normalize(vec2(-fN.z, fN.x) + 1e-5);
    float al = dot(vGPos.xz, tg);
    float ph = al * 0.42 + gNoise(vec2(al * 0.06, vGPos.y * 0.02)) * 5.0;
    float d = cos(ph) * 0.6 + cos(ph * 2.3 + 1.7) * 0.3;
    normal = normalize(normal + (viewMatrix * vec4(tg.x, 0.0, tg.y, 0.0)).xyz * d * 0.55 * fSteep);
  }
}`;

/**
 * The canyon floor's painted ground (terrain only), from the chunk's `aLand` attribute (see
 * CanyonWorld's chunk fill): x = distance from the road's centre over its half width, y =
 * distance from a wash's bed line over its half width, z = slickrock 0..1, w = the shade
 * under a cliff dwelling's brow. Fields smooth enough to interpolate across 4 m triangles;
 * the edges are drawn here, per pixel, broken by noise.
 */
const LAND = /* glsl */ `
vec3 rN = normalize(vGNrm);
float rSteep = 1.0 - rN.y;
float rGentle = 1.0 - smoothstep(0.25, 0.5, rSteep);
float cRock = 0.0;
{
  float n1 = gNoise(vGPos.xz * 0.35);
  float n2 = gNoise(vGPos.xz * 1.7 + 5.0);
  // Scree on the talus: rubble of every layer above, dappled light and dark.
  float scree = smoothstep(0.07, 0.17, rSteep) * (1.0 - smoothstep(0.3, 0.5, rSteep));
  diffuseColor.rgb *= 1.0 + scree * (0.32 * (n2 - 0.5) + 0.12 * (n1 - 0.5));
  // Slickrock: bare cream and salmon sandstone, its old dunes' cross-bedding in sweeping lines.
  float sl = smoothstep(0.12, 0.55, vLand.z + 0.3 * (n1 - 0.5)) * rGentle;
  if (sl > 0.0) {
    float ang = gNoise(vGPos.xz * 0.012) * 6.2832;
    vec2 dir = vec2(cos(ang), sin(ang));
    float xb = dot(vGPos.xz, dir) * 0.3 + gNoise(vGPos.xz * 0.04) * 5.0 + vGPos.y * 0.9;
    float lines = smoothstep(0.7, 0.95, sin(xb * 2.4));
    vec3 slc = mix(vec3(0.8, 0.57, 0.38), vec3(0.74, 0.4, 0.27), gNoise(vGPos.xz * 0.025 + 3.0));
    slc *= (1.0 - 0.13 * lines) * (0.95 + 0.1 * n2);
    diffuseColor.rgb = mix(diffuseColor.rgb, slc, sl);
    cRock = sl;
  }
  // Wash beds: pale sand in ripples, with a darker damp line down the middle after rain.
  float wbed = 1.0 - smoothstep(0.55, 1.0, vLand.y + 0.35 * (n1 - 0.5));
  if (wbed > 0.0) {
    float rip = sin(dot(vGPos.xz, vec2(0.8, 0.6)) * 2.2 + n1 * 4.0);
    vec3 wc = vec3(0.76, 0.57, 0.36) * (0.96 + 0.05 * rip + 0.06 * (n2 - 0.5));
    wc *= 1.0 - 0.12 * (1.0 - smoothstep(0.0, 0.25, vLand.y));
    diffuseColor.rgb = mix(diffuseColor.rgb, wc, wbed * rGentle * (1.0 - cRock));
  }
  // The dirt road: a dusty track with two wheel ruts, its edges ragged.
  float road = 1.0 - smoothstep(0.85, 1.15, vLand.x + 0.3 * (n1 - 0.5) + 0.12 * (n2 - 0.5));
  if (road > 0.0) {
    float rut = smoothstep(0.12, 0.0, abs(vLand.x - 0.5)) * (0.7 + 0.3 * n2);
    vec3 rc = vec3(0.58, 0.4, 0.26) * (1.0 - 0.2 * rut) * (0.95 + 0.1 * n2);
    diffuseColor.rgb = mix(diffuseColor.rgb, rc, road * rGentle * 0.85);
  }
  // Shade on the cliff and bench under a dwelling's brow.
  diffuseColor.rgb *= 1.0 - 0.68 * vLand.w;
}`;

/**
 * `mode` 'terrain': the ground painted from `aLand` (LAND), then the strata blend over it on
 * steep ground (and faintly on high benches). 'decor': the strata are the rock colour and the
 * vertex colours shade it (arch undersides, hoodoo caps, a brow's hollow). Both get the bounce.
 */
export function withRockStrata<T extends THREE.Material>(m: T, mode: 'terrain' | 'decor'): T {
  const prev = m.onBeforeCompile.bind(m);
  const prevKey = m.customProgramCacheKey.bind(m);
  m.onBeforeCompile = (shader, renderer) => {
    prev(shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    const apply =
      mode === 'terrain'
        ? /* glsl */ `${LAND}
{
  // The cliff/bench edge follows interpolated normals across 4 m triangles, so a sharp threshold
  // draws the mesh's zigzags: a wide ramp broken by noise turns them into ragged scree instead.
  float rEdge = rSteep + 0.22 * (gNoise(vGPos.xz * 0.11) - 0.5) + 0.1 * (gNoise(vGPos.xz * 0.45) - 0.5);
  float rW = max(smoothstep(0.16, 0.6, rEdge) * 0.92, smoothstep(6.0, 16.0, vGPos.y) * 0.22 * (1.0 - cRock));
  rW *= smoothstep(0.4, 1.6, vGPos.y);
  diffuseColor.rgb = mix(diffuseColor.rgb, rockStrata(vGPos, rSteep), rW);
}`
        : /* glsl */ `
diffuseColor.rgb *= rockStrata(vGPos, 1.0 - normalize(vGNrm).y * 0.5);`;
    if (mode === 'terrain')
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          '#include <common>\nattribute vec4 aLand;\nvarying vec4 vLand;',
        )
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLand = aLand;');
    const vary = mode === 'terrain' ? 'varying vec4 vLand;\n' : '';
    // After GroundDetail's pars (it declares gNoise and the world-position varyings).
    shader.fragmentShader = shader.fragmentShader
      .replace('float gBumpAt(', `${PARS}\n${vary}float gBumpAt(`)
      .replace('#include <color_fragment>', `#include <color_fragment>\n${apply}`)
      .replace('#include <aomap_fragment>', `#include <aomap_fragment>\n${BOUNCE}`)
      .replace('#include <normal_fragment_maps>', `#include <normal_fragment_maps>\n${FLUTES}`);
  };
  m.customProgramCacheKey = () => `${prevKey()}|rock-${mode}`;
  return m;
}
