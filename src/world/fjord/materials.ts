import * as THREE from 'three';
import { withMist } from '../Mist';
import { getToonGradient } from '../Terrain';

/** Shared clock and lights for Aurora Fjords' animated props and water (set by the world). */
export const fjordUniforms = {
  uFjTime: { value: 0 },
  /** Window glass: dark by day, warm lamplight (HDR, so bloom halos it) after dark. */
  uWindow: { value: new THREE.Color() },
};

/**
 * The props' toon material. `aFx` (shapes.ts): paint (the instance colour only where 1, so a
 * red house keeps white trim), glow (window glass), wing (how far a vertex flaps). Motion
 * lives in the vertex shader from the per-instance `aMove` (radius, direction, rise, mode):
 *  - mode 1, a boat: bobs and rolls on the swell; with a radius it steams slowly round a
 *    circle about its instance origin, its bow along the way;
 *  - mode 2, a seabird or an eagle: circles at the radius, rising and sinking `rise` metres
 *    round it, banked into the turn, flapping now and then (gulls often, the eagle rarely).
 * Radii are in metres in the world: the shader divides out the instance's scale.
 */
export function propMaterial(): THREE.MeshToonMaterial {
  const m = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: getToonGradient() });
  m.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, fjordUniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        /* glsl */ `#include <common>
attribute vec3 aFx;
attribute vec4 aMove;
uniform float uFjTime;
varying float vGlow;
float fjYaw = 0.0;
vec3 fjOff = vec3(0.0);
float fjFlap = 0.0;
float fjRoll = 0.0;`,
      )
      .replace(
        '#include <color_vertex>',
        /* glsl */ `#include <color_vertex>
#if defined(USE_INSTANCING_COLOR) && defined(USE_COLOR)
  vColor.rgb = mix(color.rgb, color.rgb * instanceColor.rgb, aFx.x);
#endif
vGlow = aFx.y;`,
      )
      .replace(
        '#include <beginnormal_vertex>',
        /* glsl */ `#include <beginnormal_vertex>
#ifdef USE_INSTANCING
{
  vec3 iPos = instanceMatrix[3].xyz;
  float sc = max(length(instanceMatrix[0].xyz), 1e-3);
  float ph = fract(sin(dot(iPos.xz, vec2(12.9898, 78.233))) * 43758.5453);
  float t = uFjTime;
  if (aMove.w > 0.5 && aMove.w < 1.5) {
    fjOff.y = sin(t * 1.3 + ph * 6.28) * 0.12 / sc;
    fjRoll = sin(t * 1.05 + ph * 4.0) * 0.045;
    if (aMove.x > 0.0) {
      // ~2.4 m/s round the circle.
      float a = t * 2.4 / aMove.x * aMove.y + ph * 6.2832;
      fjOff.xz = vec2(sin(a), cos(a)) * aMove.x / sc;
      // Bow along the tangent: forward (sin yaw, cos yaw) = d/da (sin a, cos a) * dir.
      fjYaw = a + 1.5708 * aMove.y;
    }
  } else if (aMove.w > 1.5) {
    float r = aMove.x;
    float a = t * (aMove.z > 6.0 ? 7.0 : 10.0) / r * aMove.y + ph * 40.0;
    fjOff = vec3(sin(a) * r, sin(a * 2.0 + ph * 3.0) * aMove.z * 0.3, cos(a) * r) / sc;
    fjYaw = a + 1.5708 * aMove.y;
    fjRoll = -0.35 * aMove.y;
    float often = aMove.z > 6.0 ? 0.93 : 0.55;
    fjFlap = sin(t * (aMove.z > 6.0 ? 4.5 : 9.0) + ph * 20.0) * smoothstep(often, 1.0, 0.5 + 0.5 * sin(t * 0.37 + ph * 9.0));
  }
  float cy = cos(fjYaw);
  float sy = sin(fjYaw);
  float cr = cos(fjRoll);
  float sr = sin(fjRoll);
  objectNormal = vec3(objectNormal.x * cr - objectNormal.y * sr, objectNormal.x * sr + objectNormal.y * cr, objectNormal.z);
  objectNormal = vec3(objectNormal.x * cy + objectNormal.z * sy, objectNormal.y, -objectNormal.x * sy + objectNormal.z * cy);
}
#endif`,
      )
      .replace(
        '#include <begin_vertex>',
        /* glsl */ `#include <begin_vertex>
#ifdef USE_INSTANCING
{
  transformed.y += aFx.z * fjFlap * 0.55;
  float cr = cos(fjRoll);
  float sr = sin(fjRoll);
  transformed = vec3(transformed.x * cr - transformed.y * sr, transformed.x * sr + transformed.y * cr, transformed.z);
  float cy = cos(fjYaw);
  float sy = sin(fjYaw);
  transformed = vec3(transformed.x * cy + transformed.z * sy, transformed.y, -transformed.x * sy + transformed.z * cy);
  transformed += fjOff;
}
#endif`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform vec3 uWindow;\nvarying float vGlow;',
      )
      .replace(
        '#include <emissivemap_fragment>',
        '#include <emissivemap_fragment>\ntotalEmissiveRadiance += uWindow * vGlow;',
      );
  };
  m.customProgramCacheKey = () => 'fjord-prop';
  return withMist(m); // cloud shadows come from LitScenery, like every lit material
}

/** Waterfall and spray uniforms (FjordWorld sets light and fog per frame). */
export const fallUniforms = {
  uFjTime: fjordUniforms.uFjTime,
  uLight: { value: new THREE.Color() },
  uShade: { value: new THREE.Color() },
  uFogColor: { value: new THREE.Color() },
  uFogFar: { value: 1000 },
  uFalls: { value: 1 },
};

const FALL_FOG = /* glsl */ `
uniform vec3 uFogColor;
uniform float uFogFar;
vec3 fjFog(vec3 c, float d) {
  return mix(c, uFogColor, smoothstep(uFogFar * 0.2, uFogFar, d) * 0.9);
}`;

/**
 * The waterfalls: ribbons down the walls (Waterfalls fills them), uv.x across the water and
 * uv.y metres down it, aFall.x the share of the way (0 lip .. 1 the strand's stream). White
 * water streaming down in streaks that break up and thin as it falls, a soft fraying edge,
 * the shade of the wall on its back half, calming to a dark glassy stream on the strand.
 */
export function fallMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: fallUniforms,
    vertexShader: /* glsl */ `
      attribute vec2 aFall;
      varying vec2 vUv;
      varying float vWay;
      varying float vDist;
      void main() {
        vUv = uv;
        vWay = aFall.x;
        vec4 mv = viewMatrix * vec4(position, 1.0);
        vDist = -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uFjTime;
      uniform vec3 uLight;
      uniform vec3 uShade;
      uniform float uFalls;
      ${FALL_FOG}
      varying vec2 vUv;
      varying float vWay;
      varying float vDist;
      float h1(vec2 p) {
        vec3 p3 = fract(vec3(p.xyx) * 0.1031);
        p3 += dot(p3, p3.yzx + 33.33);
        return fract((p3.x + p3.y) * p3.z);
      }
      float n1(vec2 p) {
        vec2 i = floor(p);
        vec2 f = fract(p);
        vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(h1(i), h1(i + vec2(1.0, 0.0)), u.x), mix(h1(i + vec2(0.0, 1.0)), h1(i + vec2(1.0, 1.0)), u.x), u.y);
      }
      void main() {
        float across = vUv.x * 2.0 - 1.0;
        float stream = smoothstep(0.84, 0.9, vWay);
        float speed = mix(9.0, 1.6, stream);
        float y = vUv.y - uFjTime * speed;
        // Streaks: noise stretched down the fall, two layers sliding at different speeds.
        float s = n1(vec2(vUv.x * 7.0, y * 0.09)) * 0.6 + n1(vec2(vUv.x * 15.0 + 3.0, (vUv.y - uFjTime * speed * 1.3) * 0.2)) * 0.4;
        float edge = 1.0 - smoothstep(0.45 + 0.35 * n1(vec2(y * 0.05, 1.0)), 1.0, abs(across));
        float body = smoothstep(0.25, 0.6, s) * edge;
        // Thinner as it falls (spread into spray), whole again at the foot's pool.
        float a = body * (0.95 - 0.35 * smoothstep(0.1, 0.7, vWay)) * (1.0 - smoothstep(0.995, 1.0, vWay));
        vec3 c = mix(uShade, uLight, 0.55 + 0.45 * s);
        // On the strand: a glassy dark stream with flecks of foam.
        vec3 water = mix(uShade * 0.6, uLight * 0.9, smoothstep(0.62, 0.8, s));
        c = mix(c, water, stream);
        a = mix(a, edge * (0.75 + 0.2 * s), stream);
        a *= uFalls;
        if (a < 0.01) discard;
        gl_FragColor = vec4(fjFog(c, vDist), a);
        #include <colorspace_fragment>
      }`,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -2,
  });
}

/**
 * Spray at a waterfall's foot: camera-facing puffs (instanced quads, scaled per puff) that
 * billow up and out from the plunge and fade, each on its own cycle.
 */
export function sprayMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: fallUniforms,
    vertexShader: /* glsl */ `
      uniform float uFjTime;
      varying vec2 vUv;
      varying float vA;
      varying float vDist;
      void main() {
        vec3 base = instanceMatrix[3].xyz;
        float R = length(instanceMatrix[0].xyz);
        float ph = fract(sin(dot(base.xz, vec2(12.9898, 78.233))) * 43758.5453);
        float life = fract(uFjTime / 5.0 + ph);
        vA = smoothstep(0.0, 0.2, life) * (1.0 - smoothstep(0.5, 1.0, life));
        vec3 c = base + vec3(sin(ph * 31.0), 0.0, cos(ph * 17.0)) * life * R * 0.6;
        c.y += life * R * 0.9;
        vec4 mv = viewMatrix * vec4(c, 1.0);
        mv.xy += position.xy * R * (0.7 + 0.8 * life);
        vDist = -mv.z;
        vUv = uv;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uLight;
      uniform float uFalls;
      ${FALL_FOG}
      varying vec2 vUv;
      varying float vA;
      varying float vDist;
      void main() {
        vec2 q = vUv * 2.0 - 1.0;
        float a = (1.0 - smoothstep(0.2, 1.0, length(q))) * vA * 0.5 * uFalls;
        if (a < 0.01) discard;
        gl_FragColor = vec4(fjFog(uLight, vDist), a);
        #include <colorspace_fragment>
      }`,
    transparent: true,
    depthWrite: false,
  });
}
