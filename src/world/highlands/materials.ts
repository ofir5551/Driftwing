import * as THREE from 'three';
import { Config } from '../../core/Config';
import { withMist } from '../Mist';
import { getToonGradient } from '../Terrain';

/** Shared clock for every animated Highlands prop (set once per frame by the world). */
export const propTime = { value: 0 };

const swayU = {
  get value() {
    return Config.cover.sway;
  },
};

/**
 * The props' toon material. Motion lives in the vertex shader, keyed by the geometry's `aAnim`
 * (kind, weight), so nothing animates on the CPU:
 *  - spin: windmill sails turn round their hub (local z);
 *  - sway: reeds and bushes lean in a travelling gust that rolls across the land (as the grass
 *    does), so they ripple together instead of each nodding on its own;
 *  - bob: boats rise and roll on the swell;
 *  - flock: a bird circles its instance's origin, wings beating.
 */
export function propMaterial(): THREE.MeshToonMaterial {
  const m = new THREE.MeshToonMaterial({
    vertexColors: true,
    gradientMap: getToonGradient(),
  });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uPropTime = propTime;
    shader.uniforms.uSway = swayU;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute vec2 aAnim;\nuniform float uPropTime;\nuniform float uSway;',
      )
      .replace(
        '#include <begin_vertex>',
        /* glsl */ `#include <begin_vertex>
#ifdef USE_INSTANCING
{
  vec3 iPos = instanceMatrix[3].xyz;
  float ph = iPos.x * 0.37 + iPos.z * 0.29;
  float t = uPropTime;
  if (aAnim.x > 0.5 && aAnim.x < 1.5) {
    float a = t * 0.8 + ph;
    float c = cos(a);
    float s = sin(a);
    transformed.xy = mat2(c, s, -s, c) * transformed.xy;
  } else if (aAnim.x > 1.5 && aAnim.x < 2.5) {
    // A gust front rolls along the wind (+x, +z), with a slow swell in its strength.
    float along = dot(iPos.xz, vec2(0.8, 0.6));
    float gust = 0.55 + 0.45 * sin(along * 0.035 - t * 0.9);
    float w = sin(along * 0.22 - t * 2.6) * 0.6 + 0.4 + sin(t * 3.7 + ph) * 0.15;
    transformed.xz += vec2(0.8, 0.6) * w * gust * aAnim.y * uSway;
  } else if (aAnim.x > 2.5 && aAnim.x < 3.5) {
    transformed.y += sin(t * 1.3 + ph) * 0.07;
    transformed.y += transformed.x * sin(t * 1.1 + ph * 1.7) * 0.06;
  } else if (aAnim.x > 3.5) {
    // Flocks wheel round their origin together (one phase per ~100 m), each bird flapping.
    float a = t * 0.3 + floor(iPos.x / 97.0) * 1.7 + floor(iPos.z / 89.0) * 2.3;
    float flap = sin(t * 9.0 + ph * 3.0);
    transformed.y += abs(transformed.x) * flap * 0.6;
    float c = cos(a);
    float s = sin(a);
    // Face along the circle's tangent, then step out to its rim (radius 34 m).
    vec2 r = vec2(transformed.x * c + transformed.z * s, -transformed.x * s + transformed.z * c);
    transformed.xz = r + vec2(-s, -c) * 34.0;
    transformed.y += sin(a * 2.0 + ph) * 2.0;
  }
}
#endif`,
      );
  };
  m.customProgramCacheKey = () => 'hl-prop';
  return withMist(m); // cloud shadows come from LitScenery, like every lit material
}

/**
 * Chimney smoke: each instance is one puff billboard; its phase (instance attribute) staggers
 * the puffs up the column. The rise, drift, growth and fade are all in the vertex shader.
 */
export function smokeMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: propTime,
      uRise: {
        get value() {
          return Config.highlands.smokeRise;
        },
      },
      uColor: { value: new THREE.Color('#e8e4ea') },
      uFogColor: { value: new THREE.Color() },
      uFogFar: { value: 1000 },
    },
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
        float life = 7.0;
        float t = fract(uTime / life + aPhase);
        vec3 c = base + vec3(t * t * 5.0 + sin(t * 6.0 + aPhase * 9.0) * 0.4, t * life * uRise, t * t * 3.0);
        float size = mix(0.6, 3.4, sqrt(t));
        vec4 mv = viewMatrix * vec4(c, 1.0);
        mv.xy += position.xy * size;
        vDist = -mv.z;
        vA = smoothstep(0.0, 0.08, t) * (1.0 - smoothstep(0.45, 1.0, t)) * 0.5;
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
