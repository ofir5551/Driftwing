import * as THREE from 'three';
import { Config } from '../../core/Config';

/**
 * The cloud sea's paint and motion, patched into a vertex-coloured toon material.
 *
 * Motion: the surface heaves. Broad heaps ride the wind (`uCDrift`) over the fixed swells of the
 * height field while each stretch of sea swells and sinks in its own time, so the sum keeps
 * changing shape like a time-lapse of real cloud. The heave is visual only and small
 * (`Config.peaks.heave`, under the bird's `groundHeight`), and it flattens round the camera,
 * whose floor sits only 1.2 m over the height field, so neither ever dips into it.
 *
 * Paint: cauliflower lobes tilted into the normal (so the toon bands break into heaped, rounded
 * puffs instead of reading as snowfields), riding the same wind and slowly warped so they boil
 * rather than slide like a decal, with a little brightness in the lobes' tops. All from world
 * position, so it never seams across chunks; the fine lobes fade with distance so the far sea is
 * calm, not shimmering. Uniforms read Config live (the ?debug panel tunes it).
 */
export const cloudSeaUniforms = {
  uCTime: { value: 0 },
  /** Metres the wind has carried the moving heaps and lobes (set each frame). */
  uCDrift: { value: new THREE.Vector2() },
  uCDetail: {
    get value() {
      return Config.peaks.billowDetail;
    },
  },
  uCHeave: {
    get value() {
      return Config.peaks.heave;
    },
  },
  uCBreath: {
    get value() {
      return Config.peaks.breath;
    },
  },
};

const NOISE = /* glsl */ `
float cHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float cNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(cHash(i), cHash(i + vec2(1.0, 0.0)), u.x),
             mix(cHash(i + vec2(0.0, 1.0)), cHash(i + vec2(1.0, 1.0)), u.x), u.y);
}`;

const VERT_PARS = /* glsl */ `
varying vec3 vCPos;
varying vec2 vCTilt;
varying vec2 vCWarp;
uniform float uCTime;
uniform vec2 uCDrift;
uniform float uCHeave;
uniform float uCBreath;
${NOISE}
// Heave in -1..1: broad heaps carried by the wind, smaller ones that swell and sink in place.
float cHeave(vec2 p) {
  vec2 q = p - uCDrift;
  float a = cNoise(q * 0.016);
  float b = cNoise(q * 0.042 + 3.7);
  // Each stretch of sea breathes in its own time, so the heaps never rise all together.
  float s = sin(uCTime * uCBreath + cNoise(p * 0.006 + 7.7) * 6.2832);
  float h = (a * a - 0.33) * 1.5 + (b * b - 0.33) * (0.5 + 0.7 * s);
  return clamp(h, -1.0, 1.0);
}`;

const FRAG_PARS = /* glsl */ `
varying vec3 vCPos;
varying vec2 vCTilt;
varying vec2 vCWarp;
uniform float uCTime;
uniform vec2 uCDrift;
uniform float uCDetail;
${NOISE}
// Rounded lobes: each octave squared toward its crests, so the puffs bulge and the seams
// between them pinch, as in heaped cumulus. q is wind-carried and warped; near (0..1) fades the
// fine octaves. The octaves creep against each other a little so the lobes churn as they ride.
float cLobes(vec2 q, float near) {
  vec2 w = vec2(uCTime * 0.35, uCTime * 0.12);
  float a = cNoise(q * 0.035);
  float b = cNoise(q * 0.09 - w * 0.06 + 4.7);
  float c = cNoise(q * 0.22 + w * 0.1 + 9.1);
  return a * a * 1.2 + b * b * 0.7 * (0.4 + 0.6 * near) + c * c * 0.35 * near;
}`;

/** Adds the cloud-sea paint and heave to a toon terrain material. Apply before `withMist`. */
export function withCloudSea<T extends THREE.Material>(m: T): T {
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, cloudSeaUniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERT_PARS}`)
      .replace(
        '#include <begin_vertex>',
        /* glsl */ `#include <begin_vertex>
{
  // Chunks are only translated, so the model matrix's offset takes chunk-local to world.
  vec3 cw = (modelMatrix * vec4(transformed, 1.0)).xyz;
  float cd = length(cw.xz - cameraPosition.xz);
  // Flat round the camera (its floor is just above the height field) and calm far away.
  float amp = uCHeave * smoothstep(6.0, 36.0, cd) * (1.0 - smoothstep(700.0, 1100.0, cd));
  transformed.y += cHeave(cw.xz) * amp;
  // The heave's slope (m per m) tilts the shading normal in the fragment shader.
  const float ce = 3.0;
  vCTilt = vec2(cHeave(cw.xz + vec2(ce, 0.0)) - cHeave(cw.xz - vec2(ce, 0.0)),
                cHeave(cw.xz + vec2(0.0, ce)) - cHeave(cw.xz - vec2(0.0, ce))) * amp / (2.0 * ce);
  // A slow warp of the lobes, broad enough to interpolate between vertices.
  vec2 cq = (cw.xz - uCDrift) * 0.02;
  vCWarp = (vec2(cNoise(cq + uCTime * 0.03), cNoise(cq + 5.2 - uCTime * 0.025)) - 0.5) * 22.0;
}`,
      )
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
  vCPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAG_PARS}`)
      .replace(
        '#include <color_fragment>',
        /* glsl */ `#include <color_fragment>
float cNear = 1.0 - smoothstep(120.0, 520.0, distance(vCPos, cameraPosition));
vec2 cQ = vCPos.xz - uCDrift + vCWarp;
float cL = cLobes(cQ, cNear);
// Crests of the lobes catch a little more light; the seams between them sink into shade.
diffuseColor.rgb *= mix(vec3(1.0), mix(vec3(0.84, 0.84, 0.96), vec3(1.06), smoothstep(0.15, 1.1, cL)), uCDetail);`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        /* glsl */ `#include <normal_fragment_maps>
{
  const float e = 1.2;
  vec2 g = vec2(
    cLobes(cQ + vec2(e, 0.0), cNear) - cLobes(cQ - vec2(e, 0.0), cNear),
    cLobes(cQ + vec2(0.0, e), cNear) - cLobes(cQ - vec2(0.0, e), cNear)) / (2.0 * e);
  // Lobes heap upward: tilt the world normal down the slope of the lobe field, and of the heave.
  vec3 wn = normalize(vec3(-g.x * 30.0 * uCDetail, 1.0, -g.y * 30.0 * uCDetail));
  vec3 base = normalize((vec4(normal, 0.0) * viewMatrix).xyz);
  base = normalize(base - vec3(vCTilt.x, 0.0, vCTilt.y));
  wn = normalize(base + wn - vec3(0.0, 1.0, 0.0));
  normal = normalize((viewMatrix * vec4(wn, 0.0)).xyz);
}`,
      );
  };
  m.customProgramCacheKey = () => 'cloudsea';
  return m;
}
