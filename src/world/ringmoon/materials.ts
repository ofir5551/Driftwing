import * as THREE from 'three';
import { Config } from '../../core/Config';
import { smoothstep } from '../../core/math';
import type { DayCycle } from '../DayCycle';
import { withMist } from '../Mist';
import { getToonGradient } from '../Terrain';
import { LIFE_PATHS } from './RingmoonLayout';

/**
 * Ringmoon Shallows' shared shader state, set once per frame by the world: the clock, how dark
 * it is (things glow), the beacons' pulse, and the two fills the scene's one light can't give:
 * light off the ringed giant's lit face (a coloured fill from its side of the sky; the
 * ringlight at night) and the second sun's, from where it trails the first.
 */
export const ringUniforms = {
  uRmTime: { value: 0 },
  /** 0 by day .. 1 at night (times Config.ringmoon.glow). */
  uRmNight: { value: 0 },
  /** 0..1, the beacons' slow pulse. */
  uRmPulse: { value: 0 },
  uRmGiantDir: { value: new THREE.Vector3(0, 0.3, 1) },
  uRmGiantFill: { value: new THREE.Color(0, 0, 0) },
  uRmSun2Dir: { value: new THREE.Vector3(0, 1, 0) },
  uRmSun2Fill: { value: new THREE.Color(0, 0, 0) },
};

const GIANT_LIGHT = new THREE.Color('#f2dcae');
const RING_LIGHT = new THREE.Color('#9fe6cf');
const SUN2_LIGHT = new THREE.Color('#fff4e2');
const tmp = new THREE.Color();

/**
 * Per frame. The giant's fill: its colour, strongest when its face toward us is lit (the sun
 * behind the viewer, on the giant's side), plus the ringlight's teal glow after dark. The
 * second sun's fill fades as it sets.
 */
export function ringFrame(day: DayCycle, time: number): void {
  const R = Config.ringmoon;
  const LL = Config.levelLight.ringmoon;
  const p = day.palette;
  const u = ringUniforms;
  u.uRmTime.value = time;
  const night = smoothstep(0.08, 0.6, p.stars);
  u.uRmNight.value = night * R.glow;
  u.uRmPulse.value = 0.55 + 0.45 * Math.sin(time * 1.7);
  const ce = Math.cos(R.giantEl);
  const g = u.uRmGiantDir.value.set(
    Math.sin(R.giantAz) * ce,
    Math.sin(R.giantEl),
    Math.cos(R.giantAz) * ce,
  );
  const sd = day.sunDir;
  // How much of the giant's face toward us is lit: half when the sun is beside it, full behind us.
  const lit = 0.5 - 0.5 * (sd.x * g.x + sd.y * g.y + sd.z * g.z);
  tmp.copy(GIANT_LIGHT).multiplyScalar((0.25 + 0.75 * lit) * (1 - night * 0.5));
  tmp.lerp(RING_LIGHT, night * 0.7);
  u.uRmGiantFill.value.copy(tmp).multiplyScalar(LL.giant * (0.6 + 0.15 * night));
  const c2 = Math.cos(R.sun2);
  const s2 = Math.sin(R.sun2);
  const s = u.uRmSun2Dir.value
    .set(sd.x * c2 + sd.z * s2, sd.y - 0.06, -sd.x * s2 + sd.z * c2)
    .normalize();
  u.uRmSun2Fill.value
    .copy(SUN2_LIGHT)
    .lerp(p.sun, 0.4)
    .multiplyScalar(LL.sun2 * smoothstep(-0.02, 0.15, s.y) * (1 - night));
}

/**
 * The two fills, added to the indirect light after the scene's lights: a wrapped diffuse from
 * the giant's direction and the second sun's, so faces turned from the sun but toward either
 * are lifted in their colour (the second sun gives every shadow a soft warm side).
 */
const FILL = /* glsl */ `
{
  vec3 rmN = normalize(normal);
  vec3 rmG = normalize((viewMatrix * vec4(uRmGiantDir, 0.0)).xyz);
  vec3 rmS = normalize((viewMatrix * vec4(uRmSun2Dir, 0.0)).xyz);
  float rmWg = clamp(dot(rmN, rmG) * 0.6 + 0.4, 0.0, 1.0);
  float rmWs = clamp(dot(rmN, rmS), 0.0, 1.0);
  reflectedLight.indirectDiffuse += diffuseColor.rgb * (uRmGiantFill * rmWg + uRmSun2Fill * rmWs);
}`;

/** Adds the giant's and the second sun's fill (see `ringFrame`) to a lit material. */
export function withMoonLight<T extends THREE.Material>(m: T): T {
  const prev = m.onBeforeCompile.bind(m);
  const prevKey = m.customProgramCacheKey.bind(m);
  m.onBeforeCompile = (shader, renderer) => {
    prev(shader, renderer);
    shader.uniforms.uRmGiantDir = ringUniforms.uRmGiantDir;
    shader.uniforms.uRmGiantFill = ringUniforms.uRmGiantFill;
    shader.uniforms.uRmSun2Dir = ringUniforms.uRmSun2Dir;
    shader.uniforms.uRmSun2Fill = ringUniforms.uRmSun2Fill;
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform vec3 uRmGiantDir;\nuniform vec3 uRmGiantFill;\nuniform vec3 uRmSun2Dir;\nuniform vec3 uRmSun2Fill;',
      )
      .replace('#include <aomap_fragment>', `#include <aomap_fragment>\n${FILL}`);
  };
  m.customProgramCacheKey = () => `${prevKey()}|rm-fill`;
  return m;
}

/**
 * Glow from the geometry's `aGlow` (per vertex): 0 none, up to 1 a steady glow, 2 the beacons'
 * pulse. A glowing part emits its own (instance-tinted) colour: a little by day, so it reads as
 * lit from within, and well over 1 after dark so bloom halos it.
 */
export function withGlow<T extends THREE.Material>(m: T): T {
  const prev = m.onBeforeCompile.bind(m);
  const prevKey = m.customProgramCacheKey.bind(m);
  m.onBeforeCompile = (shader, renderer) => {
    prev(shader, renderer);
    shader.uniforms.uRmNight = ringUniforms.uRmNight;
    shader.uniforms.uRmPulse = ringUniforms.uRmPulse;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute float aGlow;\nvarying float vRmGlow;',
      )
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n  vRmGlow = aGlow;');
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying float vRmGlow;\nuniform float uRmNight;\nuniform float uRmPulse;',
      )
      .replace(
        '#include <emissivemap_fragment>',
        /* glsl */ `#include <emissivemap_fragment>
{
  float rmK = vRmGlow > 1.5 ? uRmPulse : vRmGlow;
  totalEmissiveRadiance += diffuseColor.rgb * rmK * (0.22 + uRmNight * 2.4);
}`,
      );
  };
  m.customProgramCacheKey = () => `${prevKey()}|rm-glow`;
  return m;
}

/** Give a geometry its `aGlow` (a function of the vertex position; 0 everywhere by default). */
export function glowing(
  g: THREE.BufferGeometry,
  glow: (x: number, y: number, z: number) => number = () => 0,
): THREE.BufferGeometry {
  const pos = g.getAttribute('position');
  const a = new Float32Array(pos.count);
  for (let i = 0; i < pos.count; i++) a[i] = glow(pos.getX(i), pos.getY(i), pos.getZ(i));
  g.setAttribute('aGlow', new THREE.BufferAttribute(a, 1));
  return g;
}

/** The props' material: toon, vertex-coloured, glowing parts, the fills, the haze. */
export function propMaterial(): THREE.MeshToonMaterial {
  return withMist(
    withMoonLight(
      withGlow(new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: getToonGradient() })),
    ),
  );
}

const glslPath = Object.entries(LIFE_PATHS)
  .map(
    ([k, p]) =>
      `if (kind == ${k}) { spd = ${p.speed.toFixed(2)}; rad = ${p.r0.toFixed(2)} + ${p.dr.toFixed(2)} * ph; }`,
  )
  .join('\n    ');

/**
 * Moving things' material (glowing, with the fills): all motion is in the vertex shader, keyed
 * by the geometry's `aAnim` (kind, weight), so nothing moves on the CPU. Each follows a circle
 * round its instance's origin (instances carry position and a uniform scale), nose (local +z)
 * along the path, radius and direction from a hash of the origin the scatter shares:
 *  - 1 fish: the school sways along its circle, every tail beating (weight down the body);
 *  - 2 grazer: walks slowly, legs swinging in pairs (weight 2 and 3), its neck (weight 1)
 *    sweeping down to the moss and up again;
 *  - 3 floater: drifts round, bobbing, its bell pulsing (weight 0) and its tendrils (weight
 *    down them) trailing and swaying.
 */
export function lifeMaterial(): THREE.MeshToonMaterial {
  const m = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: getToonGradient() });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uRmTime = ringUniforms.uRmTime;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute vec2 aAnim;\nuniform float uRmTime;',
      )
      .replace(
        '#include <begin_vertex>',
        /* glsl */ `#include <begin_vertex>
#ifdef USE_INSTANCING
{
  int kind = int(aAnim.x + 0.5);
  vec3 iPos = instanceMatrix[3].xyz;
  float s = length(instanceMatrix[0].xyz);
  float ph = fract(iPos.x * 0.0137 + iPos.z * 0.0291);
  float t = uRmTime;
  float spd = 1.0;
  float rad = 10.0;
  ${glslPath}
  float dir = fract(ph * 7.31) > 0.5 ? 1.0 : -1.0;
  vec3 v = transformed;
  float w = aAnim.y;
  float a = t * spd / rad * dir + ph * 40.0;
  if (kind == 1) {
    v.x += sin(t * 12.0 + (v.x + v.z) * 4.0) * 0.08 * w + sin(t * 0.6 + v.z * 0.5) * 0.35;
    v.y += sin(t * 0.8 + v.x * 1.1) * 0.12;
  } else if (kind == 2) {
    // An unhurried shuffle round its patch, the neck down to graze for long spells (the legs
    // barely lift then).
    float g = smoothstep(0.2, 0.6, sin(t * 0.23 + ph * 17.0));
    float step = sin(t * 3.2 + ph * 9.0) * (1.0 - 0.6 * g);
    if (w > 1.5) {
      float side = w > 2.5 ? -1.0 : 1.0;
      v.z += step * side * 0.35 * smoothstep(1.4, 0.0, v.y);
      v.y += max(0.0, step * side) * 0.12 * smoothstep(1.4, 0.0, v.y);
    } else if (w > 0.5) {
      // The neck pivots about its root over the shoulders, down to the moss when grazing.
      vec3 q = v - vec3(0.0, 1.9, 1.3);
      float r = g * 0.9 + sin(t * 1.3 + ph * 5.0) * 0.08;
      v = vec3(q.x, q.y * cos(r) - q.z * sin(r), q.y * sin(r) + q.z * cos(r)) + vec3(0.0, 1.9, 1.3);
    }
    v.y += abs(step) * 0.04;
  } else if (kind == 3) {
    float pulse = sin(t * 1.4 + ph * 11.0);
    if (w < 0.05) v.xz *= 1.0 + 0.07 * pulse;
    v.y *= 1.0 - 0.05 * pulse * (1.0 - w);
    v.x += sin(t * 0.9 - w * 3.0 + ph * 6.0) * w * w * 1.6;
    v.z += sin(t * 0.7 - w * 2.4 + ph * 4.0) * w * w * 1.2 - w * w * 1.4;
  }
  // Round the circle, nose along it (local x to the path's right).
  vec2 T = dir * vec2(-sin(a), cos(a));
  transformed = vec3(T.y * v.x + T.x * v.z, v.y, -T.x * v.x + T.y * v.z);
  transformed.xz += vec2(cos(a), sin(a)) * rad / s;
  if (kind == 3) transformed.y += sin(t * 0.35 + ph * 13.0) * 2.0 / s;
}
#endif`,
      );
  };
  m.customProgramCacheKey = () => 'rm-life';
  return withMist(withMoonLight(withGlow(m)));
}
