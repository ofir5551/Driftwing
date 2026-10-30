import * as THREE from 'three';

/**
 * Valley mist: a low-lying, slowly drifting layer plus a distance haze, blended over a
 * material's colour after fog. One set of shared uniforms drives every misted material (and
 * the water); a level that wants mist sets them each frame, and they rest at zero otherwise.
 */
export const mistUniforms = {
  uMist: { value: 0 },
  uMistTop: { value: 50 },
  uMistFar: { value: 0 },
  uMistColor: { value: new THREE.Color() },
  uMistTime: { value: 0 },
};

export const MIST_PARS = /* glsl */ `
uniform float uMist;
uniform float uMistTop;
uniform float uMistFar;
uniform vec3 uMistColor;
uniform float uMistTime;
float mistAmount(vec3 wp) {
  float dist = length(wp - cameraPosition);
  float low = 1.0 - smoothstep(0.0, uMistTop, wp.y);
  // Two slow, crossed swells so the mist lies in banks rather than a flat sheet.
  float drift = 0.65 + 0.35 * sin(wp.x * 0.011 + uMistTime * 0.06) * sin(wp.z * 0.009 - uMistTime * 0.05 + 1.3);
  // Clear around the bird, thickening with distance: the near rock stays crisp.
  float m = uMist * low * low * drift * smoothstep(10.0, 260.0, dist);
  m += uMistFar * smoothstep(60.0, 950.0, dist) * (1.0 - m);
  return clamp(m, 0.0, 0.94);
}`;

/**
 * Add the mist to a built-in material (toon, basic). Composes with an existing onBeforeCompile.
 * Returns the same material.
 */
export function withMist<T extends THREE.Material>(m: T): T {
  const prev = m.onBeforeCompile.bind(m);
  const prevKey = m.customProgramCacheKey.bind(m);
  m.onBeforeCompile = (shader, renderer) => {
    prev(shader, renderer);
    Object.assign(shader.uniforms, mistUniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vMistPos;')
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
#ifdef USE_INSTANCING
  vMistPos = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
#else
  vMistPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
#endif`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\nvarying vec3 vMistPos;\n${MIST_PARS}`)
      .replace(
        '#include <fog_fragment>',
        '#include <fog_fragment>\ngl_FragColor.rgb = mix(gl_FragColor.rgb, uMistColor, mistAmount(vMistPos));',
      );
  };
  m.customProgramCacheKey = () => `${prevKey()}|mist`;
  return m;
}
