import type * as THREE from 'three';
import { Config } from '../../core/Config';

/**
 * The cloud sea's paint, patched into a vertex-coloured toon material: cauliflower lobes tilted
 * into the normal (so the toon bands break into heaped, rounded puffs instead of reading as
 * snowfields) that drift slowly with the wind, and a little brightness in the lobes' tops. All
 * from world position, so it never seams across chunks; the fine lobes fade with distance so
 * the far sea is calm, not shimmering. Uniforms read Config live (the ?debug panel tunes it).
 */
export const cloudSeaUniforms = {
  uCTime: { value: 0 },
  uCDetail: {
    get value() {
      return Config.peaks.billowDetail;
    },
  },
};

const PARS = /* glsl */ `
varying vec3 vCPos;
uniform float uCTime;
uniform float uCDetail;
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
}
// Rounded lobes: each octave squared toward its crests, so the puffs bulge and the seams
// between them pinch, as in heaped cumulus. near (0..1) fades the fine octaves.
float cLobes(vec2 p, float near) {
  vec2 w = vec2(uCTime * 0.35, uCTime * 0.12);
  float a = cNoise(p * 0.035 + w * 0.035);
  float b = cNoise(p * 0.09 - w * 0.06 + 4.7);
  float c = cNoise(p * 0.22 + w * 0.1 + 9.1);
  return a * a * 1.2 + b * b * 0.7 * (0.4 + 0.6 * near) + c * c * 0.35 * near;
}`;

/** Adds the cloud-sea paint to a toon terrain material. Apply before `withMist`. */
export function withCloudSea<T extends THREE.Material>(m: T): T {
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, cloudSeaUniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vCPos;')
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
  vCPos = (modelMatrix * vec4(transformed, 1.0)).xyz;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${PARS}`)
      .replace(
        '#include <color_fragment>',
        /* glsl */ `#include <color_fragment>
float cNear = 1.0 - smoothstep(120.0, 520.0, distance(vCPos, cameraPosition));
float cL = cLobes(vCPos.xz, cNear);
// Crests of the lobes catch a little more light; the seams between them sink into shade.
diffuseColor.rgb *= mix(vec3(1.0), mix(vec3(0.84, 0.84, 0.96), vec3(1.06), smoothstep(0.15, 1.1, cL)), uCDetail);`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        /* glsl */ `#include <normal_fragment_maps>
{
  const float e = 1.2;
  vec2 g = vec2(
    cLobes(vCPos.xz + vec2(e, 0.0), cNear) - cLobes(vCPos.xz - vec2(e, 0.0), cNear),
    cLobes(vCPos.xz + vec2(0.0, e), cNear) - cLobes(vCPos.xz - vec2(0.0, e), cNear)) / (2.0 * e);
  // Lobes heap upward: tilt the world normal down the slope of the lobe field.
  vec3 wn = normalize(vec3(-g.x * 30.0 * uCDetail, 1.0, -g.y * 30.0 * uCDetail));
  vec3 base = normalize((vec4(normal, 0.0) * viewMatrix).xyz);
  wn = normalize(base + wn - vec3(0.0, 1.0, 0.0));
  normal = normalize((viewMatrix * vec4(wn, 0.0)).xyz);
}`,
      );
  };
  m.customProgramCacheKey = () => 'cloudsea';
  return m;
}
