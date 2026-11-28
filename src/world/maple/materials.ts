import * as THREE from 'three';
import { Config } from '../../core/Config';
import { withMist } from '../Mist';
import { getToonGradient } from '../Terrain';

/** Shared clock for Maple Valley's moving things (set once per frame by the world). */
export const mapleTime = { value: 0 };

/** Life kinds, in a geometry's `aAnim.x` (the motion the vertex shader gives it). */
export const LIFE_CROW = 1;
export const LIFE_LAKE_BOAT = 2;
export const LIFE_RIVER_BOAT = 3;

/** Circle radius (m) of a lake boat with phase `ph` (the shader's formula, for the scatter). */
export const lakeBoatRadius = (ph: number): number => 22 + 30 * ph;
/** A crow's circle radius (m) with phase `ph`. */
export const crowRadius = (ph: number): number => 18 + 22 * ph;
/**
 * The phase of an instance at (x, z), as the shader derives it from the instance's position
 * (so the scatter can check the path the shader will fly before it places the instance).
 */
export const lifePhase = (x: number, z: number): number => {
  const v = x * 0.0137 + z * 0.0291;
  return v - Math.floor(v);
};

/**
 * The valley's life: a toon material whose vertex shader moves each thing, keyed by the
 * geometry's `aAnim` (kind, weight), so nothing moves on the CPU. Instances carry position, a
 * yaw and a uniform scale.
 *  - crow: wheels round the instance's origin (a pagoda's axis), banked into the turn, rising
 *    and sinking round the circle, beating its wings in bursts between glides;
 *  - lake boat: poled slowly round a circle about its origin, nose along it, the pole sweeping
 *    back as the figure pushes, the hull bobbing;
 *  - river boat: poled up and down its reach along the instance's own z (the river), turning
 *    about at each end.
 */
export function lifeMaterial(): THREE.MeshToonMaterial {
  const m = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: getToonGradient() });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uMapleTime = mapleTime;
    shader.uniforms.uReach = {
      get value() {
        return Config.maple.boatReach;
      },
    };
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute vec2 aAnim;\nuniform float uMapleTime;\nuniform float uReach;',
      )
      .replace(
        '#include <begin_vertex>',
        /* glsl */ `#include <begin_vertex>
#ifdef USE_INSTANCING
{
  int kind = int(aAnim.x + 0.5);
  if (kind > 0) {
    vec3 iPos = instanceMatrix[3].xyz;
    float s = length(instanceMatrix[0].xyz);
    float ph = fract(iPos.x * 0.0137 + iPos.z * 0.0291);
    float t = uMapleTime;
    float w = aAnim.y;
    vec3 v = transformed;
    if (kind == ${LIFE_RIVER_BOAT}) {
      // Up and down the reach: slow at each end, where it turns about.
      float a = t * 1.6 / uReach + ph * 40.0;
      float dir = cos(a) >= 0.0 ? 1.0 : -1.0;
      float push = sin(t * 1.4 + ph * 9.0);
      vec3 q = v - vec3(0.0, 1.5, -1.1);
      float r = push * 0.35 * w;
      v = (vec3(q.x, q.y * cos(r) - q.z * sin(r), q.y * sin(r) + q.z * cos(r)) + vec3(0.0, 1.5, -1.1)) * w
        + v * (1.0 - w);
      v.y += sin(t * 1.2 + ph * 5.0) * 0.05;
      v.xz *= dir;
      transformed = v + vec3(0.0, 0.0, sin(a) * uReach / s);
    } else {
      float spd = kind == ${LIFE_CROW} ? 9.0 : 1.5;
      float rad = kind == ${LIFE_CROW} ? 18.0 + 22.0 * ph : 22.0 + 30.0 * ph;
      float dir = fract(ph * 7.31) > 0.5 ? 1.0 : -1.0;
      float a = t * spd / rad * dir + ph * 40.0;
      if (kind == ${LIFE_CROW}) {
        // Bursts of beats between long glides; banked into the turn.
        float beat = smoothstep(0.3, 0.8, sin(t * 0.7 + ph * 11.0));
        v.y += sin(t * 9.0 + ph * 20.0) * w * 0.45 * beat;
        float b = 0.4 * dir;
        v = vec3(v.x * cos(b) - v.y * sin(b), v.x * sin(b) + v.y * cos(b), v.z);
      } else {
        // The pole sweeps back about the figure's hands as it pushes; the hull bobs.
        float push = sin(t * 1.4 + ph * 9.0);
        vec3 q = v - vec3(0.0, 1.5, -1.1);
        float r = push * 0.35 * w;
        v = (vec3(q.x, q.y * cos(r) - q.z * sin(r), q.y * sin(r) + q.z * cos(r)) + vec3(0.0, 1.5, -1.1)) * w
          + v * (1.0 - w);
        v.y += sin(t * 1.2 + ph * 5.0) * 0.05;
      }
      // Round the circle, nose along it.
      vec2 T = dir * vec2(-sin(a), cos(a));
      transformed = vec3(T.y * v.x + T.x * v.z, v.y, -T.x * v.x + T.y * v.z);
      transformed.xz += vec2(cos(a), sin(a)) * rad / s;
      if (kind == ${LIFE_CROW}) transformed.y += sin(a * 2.0 + ph * 3.0) * 3.0 / s;
    }
  }
}
#endif`,
      );
  };
  m.customProgramCacheKey = () => 'maple-life';
  return withMist(m);
}

/** Smoke uniforms (the world sets colour and fog per frame). */
export const smokeUniforms = {
  uTime: mapleTime,
  uRise: {
    get value() {
      return Config.maple.smokeRise;
    },
  },
  uColor: { value: new THREE.Color('#e8e4e0') },
  uFogColor: { value: new THREE.Color() },
  uFogFar: { value: 1000 },
};

/**
 * Smoke from the farms' roofs and the temples' incense: camera-facing puffs (instanced quads,
 * each with its own phase) rising in a thin column that leans and spreads as it goes, drifting
 * on the valley's light air, swelling and thinning away.
 */
export function smokeMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: smokeUniforms,
    vertexShader: /* glsl */ `
      attribute float aPhase;
      uniform float uTime;
      uniform float uRise;
      varying vec2 vUv;
      varying float vA;
      varying float vDist;
      void main() {
        vUv = uv * 2.0 - 1.0;
        vec3 base = instanceMatrix[3].xyz;
        float k = length(instanceMatrix[0].xyz);
        float life = 10.0;
        float t = fract(uTime / life + aPhase);
        vec3 c = base + vec3(t * t * 5.0 + sin(t * 5.0 + aPhase * 9.0) * 0.6, t * life * uRise * k, t * t * 2.5);
        float size = mix(0.9, 4.2, sqrt(t)) * k;
        vec4 mv = viewMatrix * vec4(c, 1.0);
        mv.xy += position.xy * size;
        vDist = -mv.z;
        vA = smoothstep(0.0, 0.1, t) * (1.0 - smoothstep(0.35, 1.0, t)) * 0.4;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform vec3 uFogColor;
      uniform float uFogFar;
      varying vec2 vUv;
      varying float vA;
      varying float vDist;
      void main() {
        float r = dot(vUv, vUv);
        float a = (1.0 - smoothstep(0.0, 1.0, r)) * vA;
        vec3 col = mix(uColor, uFogColor, smoothstep(uFogFar * 0.25, uFogFar, vDist));
        gl_FragColor = vec4(col, a);
        #include <colorspace_fragment>
      }`,
    transparent: true,
    depthWrite: false,
  });
}
