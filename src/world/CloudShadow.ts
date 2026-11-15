import * as THREE from 'three';
import { Config } from '../core/Config';
import { smoothstep } from '../core/math';

/**
 * Drifting cloud shadows: big soft patches sliding over the land with the wind. They dim only
 * the direct sunlight (the sky light stays), so a hill reads lit, then shaded, then lit again,
 * like a summer day. One set of shared uniforms drives every patched material; Game sets them
 * per frame (strength 0 turns the lookup off in the shader).
 */
export const cloudShadowUniforms = {
  uCloudShadow: { value: 0 },
  uCloudScale: { value: 0.0035 },
  uCloudCover: { value: 0.56 },
  uCloudOffset: { value: new THREE.Vector2() },
};

/**
 * Strength of the cloud shadows for a level strength, the preset's multiplier and the sun's
 * height: none at night or with the sun on the horizon (no hard sunlight to block).
 */
export function cloudShadowStrength(level: number, preset: number, sunY: number): number {
  const L = Config.light;
  return level * preset * smoothstep(L.cloudSunMin, L.cloudSunFull, sunY);
}

/** Set the shared uniforms for this frame (no allocation). */
export function updateCloudShadows(strength: number, time: number): void {
  const L = Config.light;
  const u = cloudShadowUniforms;
  u.uCloudShadow.value = strength;
  u.uCloudScale.value = L.cloudScale;
  u.uCloudCover.value = L.cloudCover;
  // Offsets in noise space: the shadows drift with the cloud layer's wind.
  u.uCloudOffset.value.set(
    time * Config.world.cloudDrift * L.cloudScale,
    time * L.cloudDriftZ * L.cloudScale,
  );
}

const PARS = /* glsl */ `
uniform float uCloudShadow;
uniform float uCloudScale;
uniform float uCloudCover;
uniform vec2 uCloudOffset;
varying vec3 vCsPos;
float csHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float csNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(csHash(i), csHash(i + vec2(1.0, 0.0)), u.x),
             mix(csHash(i + vec2(0.0, 1.0)), csHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float cloudShade(vec3 wp) {
  if (uCloudShadow <= 0.0) return 1.0;
  vec2 p = wp.xz * uCloudScale + uCloudOffset;
  float n = csNoise(p) * 0.62 + csNoise(p * 2.3 + 5.2) * 0.38;
  return 1.0 - uCloudShadow * smoothstep(uCloudCover - 0.05, uCloudCover + 0.08, n);
}`;

/**
 * Add cloud shadows to a lit built-in material (toon, lambert, standard). Composes with the
 * material's earlier patches. Returns the same material.
 */
export function withCloudShadow<T extends THREE.Material>(m: T): T {
  const prev = m.onBeforeCompile.bind(m);
  // Snapshot the key now: the default key is the onBeforeCompile source, which we replace.
  const prevKey = m.customProgramCacheKey();
  m.onBeforeCompile = (shader, renderer) => {
    prev(shader, renderer);
    Object.assign(shader.uniforms, cloudShadowUniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vCsPos;')
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
#ifdef USE_INSTANCING
  vCsPos = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
#else
  vCsPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
#endif`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${PARS}`)
      .replace(
        '#include <lights_fragment_end>',
        '#include <lights_fragment_end>\nreflectedLight.directDiffuse *= cloudShade(vCsPos);',
      );
  };
  m.customProgramCacheKey = () => `${prevKey}|cloudshadow`;
  return m;
}
