import * as THREE from 'three';
import { Config } from '../../core/Config';
import { withMist } from '../Mist';
import { getToonGradient } from '../Terrain';
import { PATHS } from './AtollScatter';

/** Shared clock for Coral Atolls' animated things (set once per frame by the world). */
export const atollTime = { value: 0 };

const glslPath = Object.entries(PATHS)
  .map(
    ([k, p]) =>
      `if (kind == ${k}) { spd = ${p.speed.toFixed(2)}; rad = ${p.r0.toFixed(1)} + ${p.dr.toFixed(1)} * ph; }`,
  )
  .join('\n    ');

/**
 * The lagoon life's toon material. All motion is in the vertex shader, keyed by the geometry's
 * `aAnim` (kind, weight), so nothing moves on the CPU. Each thing follows a circle round its
 * instance's origin (instances carry position and a uniform scale only), nose (local +z) along
 * the path:
 *  - 1 seabird: soars, banked into the turn, rising and sinking round the circle; terns (small
 *    instances) beat their wings, frigatebirds hang on the wind and flap now and then;
 *  - 2 fish: the school sways along its circle, every tail beating (weight down the body);
 *  - 3 turtle: rows slowly with its flippers; 4 ray: its wings ripple from root to tip;
 *  - 5 canoe: paddled round its circle, the paddle sweeping fore and aft, the hull bobbing.
 */
export function lifeMaterial(): THREE.MeshToonMaterial {
  const m = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: getToonGradient() });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uAtollTime = atollTime;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute vec2 aAnim;\nuniform float uAtollTime;',
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
    float t = uAtollTime;
    float spd = 1.0;
    float rad = 10.0;
    ${glslPath}
    float dir = fract(ph * 7.31) > 0.5 ? 1.0 : -1.0;
    float a = t * spd / rad * dir + ph * 40.0;
    vec3 v = transformed;
    float w = aAnim.y;
    if (kind == 1) {
      // Terns beat; frigatebirds glide, with a few slow beats now and then.
      float beat = s < 0.8 ? 1.0 : smoothstep(0.85, 1.0, sin(t * 0.31 + ph * 9.0));
      v.y += sin(t * (s < 0.8 ? 11.0 : 6.0) + ph * 20.0) * w * 0.55 * beat;
      float b = 0.35 * dir;
      v = vec3(v.x * cos(b) - v.y * sin(b), v.x * sin(b) + v.y * cos(b), v.z);
    } else if (kind == 2) {
      v.x += sin(t * 14.0 + (v.x + v.z) * 5.0) * 0.07 * w + sin(t * 0.7 + v.z * 0.4) * 0.3;
      v.y += sin(t * 0.9 + v.x * 1.3) * 0.15;
    } else if (kind == 3) {
      v.y += sin(t * 1.7 + ph * 6.0) * 0.18 * w * (v.z > 0.0 ? 1.0 : 0.5);
    } else if (kind == 4) {
      v.y += sin(t * 2.3 - w * 2.0 + ph * 6.0) * 0.32 * w;
    } else if (kind == 5) {
      // The paddle sweeps about the paddler's shoulder; the canoe bobs and rolls a little.
      float st = sin(t * 2.6 + ph * 10.0);
      vec3 q = v - vec3(-0.3, 0.95, 0.45);
      float r = st * 0.55 * w;
      v = vec3(q.x, q.y * cos(r) - q.z * sin(r), q.y * sin(r) + q.z * cos(r)) * w + v * (1.0 - w)
        + vec3(-0.3, 0.95, 0.45) * w;
      v.y += sin(t * 1.3 + ph * 5.0) * 0.05 + v.x * sin(t * 1.1 + ph) * 0.02;
    }
    // Round the circle, nose along it (local x to the path's right).
    vec2 T = dir * vec2(-sin(a), cos(a));
    transformed = vec3(T.y * v.x + T.x * v.z, v.y, -T.x * v.x + T.y * v.z);
    transformed.xz += vec2(cos(a), sin(a)) * rad / s;
    if (kind == 1) transformed.y += sin(a * 2.0 + ph * 3.0) * 4.0 / s;
  }
}
#endif`,
      );
  };
  m.customProgramCacheKey = () => 'atoll-life';
  return withMist(m);
}

/** Smoke uniforms (AtollWorld sets colour and fog per frame). */
export const smokeUniforms = {
  uTime: atollTime,
  uRise: {
    get value() {
      return Config.atoll.smokeRise;
    },
  },
  uColor: { value: new THREE.Color('#ece8e4') },
  uFogColor: { value: new THREE.Color() },
  uFogFar: { value: 1000 },
};

/**
 * Cooking-fire smoke: camera-facing puffs (instanced quads, each with its own phase) rising
 * from the fire, drifting downwind on the trade wind, swelling and thinning as they go.
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
        float life = 8.0;
        float t = fract(uTime / life + aPhase);
        vec3 c = base + vec3(t * t * 7.0 + sin(t * 6.0 + aPhase * 9.0) * 0.4, t * life * uRise, t * t * 4.0);
        float size = mix(0.5, 3.6, sqrt(t));
        vec4 mv = viewMatrix * vec4(c, 1.0);
        mv.xy += position.xy * size;
        vDist = -mv.z;
        vA = smoothstep(0.0, 0.08, t) * (1.0 - smoothstep(0.4, 1.0, t)) * 0.45;
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
        float a = (1.0 - smoothstep(0.25, 1.0, r)) * vA;
        vec3 col = mix(uColor, uFogColor, smoothstep(uFogFar * 0.25, uFogFar, vDist));
        gl_FragColor = vec4(col, a);
        #include <colorspace_fragment>
      }`,
    transparent: true,
    depthWrite: false,
  });
}
