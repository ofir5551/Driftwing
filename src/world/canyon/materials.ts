import * as THREE from 'three';
import { withMist } from '../Mist';
import { getToonGradient } from '../Terrain';

/** Shared clock for Red Canyons' animated props (set once per frame by the world). */
export const canyonTime = { value: 0 };

/**
 * The props' toon material. Motion lives in the vertex shader, keyed by the geometry's `aAnim`
 * (kind, weight), so nothing animates on the CPU:
 *  - 1 spin: the windmill's fan turns round its hub (local z), gusting faster and slower;
 *  - 3 soar: a hawk circles its instance's origin on a thermal, banked into the turn, now and
 *    then flapping, rising and sinking a little round the circle.
 */
export function propMaterial(): THREE.MeshToonMaterial {
  const m = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: getToonGradient() });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uCanyonTime = canyonTime;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute vec2 aAnim;\nuniform float uCanyonTime;',
      )
      .replace(
        '#include <begin_vertex>',
        /* glsl */ `#include <begin_vertex>
#ifdef USE_INSTANCING
{
  vec3 iPos = instanceMatrix[3].xyz;
  float ph = fract(sin(dot(iPos.xz, vec2(12.9898, 78.233))) * 43758.5453);
  float t = uCanyonTime;
  if (aAnim.x > 0.5 && aAnim.x < 1.5) {
    float a = t * (2.2 + 0.8 * sin(t * 0.21 + ph * 6.0)) + ph * 6.2832;
    float c = cos(a);
    float s = sin(a);
    transformed.xy = mat2(c, s, -s, c) * transformed.xy;
  } else if (aAnim.x > 2.5 && aAnim.x < 3.5) {
    // Circle radius 28-52 m at ~8 m/s, either way round; the nose (local +x) along the path.
    float rad = 28.0 + 24.0 * ph;
    float dir = ph > 0.5 ? 1.0 : -1.0;
    float a = t * 8.0 / rad * dir + ph * 40.0;
    float flap = sin(t * 8.0 + ph * 20.0) * smoothstep(0.82, 1.0, sin(t * 0.37 + ph * 9.0));
    vec3 v = transformed;
    v.y += abs(v.z) * flap * 0.45;
    // Bank into the turn: roll about the nose.
    float b = 0.32 * dir;
    v = vec3(v.x, v.y * cos(b) - v.z * sin(b), v.y * sin(b) + v.z * cos(b));
    vec2 T = dir * vec2(-sin(a), cos(a));
    vec2 N = vec2(-T.y, T.x);
    transformed = vec3(T.x * v.x + N.x * v.z, v.y, T.y * v.x + N.y * v.z);
    transformed.xz += vec2(cos(a), sin(a)) * rad;
    transformed.y += sin(a * 2.0 + ph * 3.0) * 3.0;
  }
}
#endif`,
      );
  };
  m.customProgramCacheKey = () => 'canyon-prop';
  return withMist(m); // cloud shadows come from LitScenery, like every lit material
}

/** Dust-devil uniforms (CanyonWorld sets colour and fog per frame). */
export const dustUniforms = {
  uTime: canyonTime,
  uColor: { value: new THREE.Color('#d8b48a') },
  uFogColor: { value: new THREE.Color() },
  uFogFar: { value: 1000 },
};

/**
 * Dust devils: each instance a funnel of dust (dustDevilGeometry) scaled to its radius and
 * height. In the vertex shader it snakes and leans, wanders across the ground, and lives for a
 * while then fades away (one life every ~40 s, its phase from where it stands), so the desert
 * raises one now and then; in the fragment shader dust bands spiral up it, thick at the foot.
 */
export function dustDevilMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: dustUniforms,
    vertexShader: /* glsl */ `
      uniform float uTime;
      varying vec2 vUv;
      varying float vA;
      varying float vDist;
      void main() {
        vec3 base = instanceMatrix[3].xyz;
        float R = length(instanceMatrix[0].xyz);
        float H = length(instanceMatrix[1].xyz);
        float ph = fract(sin(dot(base.xz, vec2(12.9898, 78.233))) * 43758.5453);
        float life = fract(uTime / 41.0 + ph);
        vA = smoothstep(0.0, 0.1, life) * (1.0 - smoothstep(0.32, 0.45, life));
        float y = position.y;
        vec2 snake = vec2(sin(y * 4.0 - uTime * 1.4 + ph * 5.0), cos(y * 3.1 - uTime * 1.1)) * 0.07 * y;
        vec2 drift = vec2(sin(uTime * 0.05 + ph * 6.3), cos(uTime * 0.041 + ph * 4.1)) * 22.0;
        vec3 wp = base + vec3((position.x + snake.x) * R + drift.x, y * H, (position.z + snake.y) * R + drift.y);
        vUv = uv;
        vec4 mv = viewMatrix * vec4(wp, 1.0);
        vDist = -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uColor;
      uniform vec3 uFogColor;
      uniform float uFogFar;
      varying vec2 vUv;
      varying float vA;
      varying float vDist;
      void main() {
        float s = sin(vUv.x * 6.2832 * 3.0 + vUv.y * 14.0 - uTime * 5.0) * 0.5 + 0.5;
        float s2 = sin(vUv.x * 6.2832 * 5.0 - vUv.y * 9.0 - uTime * 3.3) * 0.5 + 0.5;
        float a = (0.3 + 0.45 * s * s2) * smoothstep(0.0, 0.08, vUv.y) * (1.0 - smoothstep(0.35, 1.0, vUv.y));
        a *= 0.55 * vA * (1.0 - smoothstep(0.5, 1.0, vDist / uFogFar));
        vec3 col = mix(uColor, uFogColor, smoothstep(uFogFar * 0.25, uFogFar, vDist));
        gl_FragColor = vec4(col, a);
        #include <colorspace_fragment>
      }`,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
}
