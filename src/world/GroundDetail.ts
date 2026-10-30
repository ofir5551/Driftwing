import type * as THREE from 'three';
import { Config } from '../core/Config';

/**
 * Painted detail for terrain, computed in the fragment shader from world position so it costs no
 * vertices and never seams across chunks: broad patches of lighter and darker paint with a warm
 * or cool cast, fine brush strokes on gentle ground, rock strata on steep ground, and small bumps
 * that break the toon bands into dabs. The near detail fades with distance (no shimmer far off).
 * Uniforms read Config live, so the ?debug panel tunes it without a recompile.
 */
const G = Config.ground;
const uniforms = {
  uGMottle: {
    get value() {
      return G.mottle;
    },
  },
  uGStrokes: {
    get value() {
      return G.strokes;
    },
  },
  uGStrata: {
    get value() {
      return G.strata;
    },
  },
  uGBump: {
    get value() {
      return G.bump;
    },
  },
  uGWarmth: {
    get value() {
      return G.warmth;
    },
  },
  uGFar: {
    get value() {
      return G.detailFar;
    },
  },
};

const PARS = /* glsl */ `
varying vec3 vGPos;
varying vec3 vGNrm;
uniform float uGMottle;
uniform float uGStrokes;
uniform float uGStrata;
uniform float uGBump;
uniform float uGWarmth;
uniform float uGFar;
// Sine-free hash (Dave Hoskins): stable at world coordinates in the thousands.
float gHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float gNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(gHash(i), gHash(i + vec2(1.0, 0.0)), u.x),
             mix(gHash(i + vec2(0.0, 1.0)), gHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
// Surface relief: dabs on the ground plane, plus a wall-plane term that only steep ground uses
// (a height field's walls stretch any xz pattern into streaks).
float gBumpAt(vec3 p, float steep) {
  float ground = gNoise(p.xz * 0.33) + 0.5 * gNoise(p.xz * 0.9 + 3.1);
  float wall = gNoise(vec2(p.x + p.z, p.y * 1.6) * 0.3) + 0.5 * gNoise(vec2(p.x - p.z, p.y) * 0.8);
  return mix(ground, wall, steep);
}`;

/**
 * Adds the painted detail to a terrain material (toon, vertex-coloured). Composes with an
 * existing onBeforeCompile (e.g. withMist), so apply it last. Returns the same material.
 */
export function withGroundDetail<T extends THREE.Material>(m: T): T {
  const prev = m.onBeforeCompile.bind(m);
  const prevKey = m.customProgramCacheKey.bind(m);
  m.onBeforeCompile = (shader, renderer) => {
    prev(shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGPos;\nvarying vec3 vGNrm;')
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
#ifdef USE_INSTANCING
  vGPos = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
  vGNrm = mat3(modelMatrix) * mat3(instanceMatrix) * objectNormal;
#else
  vGPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
  vGNrm = mat3(modelMatrix) * objectNormal;
#endif`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${PARS}`)
      .replace(
        '#include <color_fragment>',
        /* glsl */ `#include <color_fragment>
vec3 gN = normalize(vGNrm);
float gSteep = smoothstep(0.35, 0.7, 1.0 - gN.y);
float gNear = 1.0 - smoothstep(uGFar * 0.3, uGFar, distance(vGPos, cameraPosition));
// Broad patches (~40 m and ~12 m), always on: the hills read as painted, not flat-filled.
float gM1 = gNoise(vGPos.xz * 0.025);
float gM2 = gNoise(vGPos.xz * 0.085 + 7.3);
float gShade = (gM1 - 0.5) * uGMottle + (gM2 - 0.5) * uGMottle * 0.6;
// Brush strokes on gentle ground: noise stretched along a direction that wanders slowly.
float gAng = gNoise(vGPos.xz * 0.006) * 6.2832;
vec2 gDir = vec2(cos(gAng), sin(gAng));
vec2 gSp = vec2(dot(vGPos.xz, gDir), dot(vGPos.xz, vec2(-gDir.y, gDir.x)));
float gStroke = gNoise(gSp * vec2(0.09, 0.55)) - 0.5;
gShade += gStroke * uGStrokes * (1.0 - gSteep) * gNear;
// Rock strata on steep ground: wobbly horizontal bands, darker in the seams.
float gBand = sin(vGPos.y * 0.9 + gNoise(vGPos.xz * 0.04) * 7.0 + gNoise(vec2(vGPos.x + vGPos.z, vGPos.y) * 0.12) * 2.0);
gShade -= smoothstep(0.55, 1.0, gBand) * uGStrata * gSteep;
diffuseColor.rgb *= 1.0 + gShade;
// Warm where the paint is light, cool where it is dark, like a wash pooling.
diffuseColor.rgb *= 1.0 + vec3(1.0, 0.25, -0.9) * (gM1 - 0.5) * uGWarmth;`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        /* glsl */ `#include <normal_fragment_maps>
if (gNear > 0.0) {
  // World-space gradient of the relief by central differences, tilted into the normal.
  const float e = 0.6;
  vec3 gGrad = vec3(
    gBumpAt(vGPos + vec3(e, 0.0, 0.0), gSteep) - gBumpAt(vGPos - vec3(e, 0.0, 0.0), gSteep),
    gBumpAt(vGPos + vec3(0.0, e, 0.0), gSteep) - gBumpAt(vGPos - vec3(0.0, e, 0.0), gSteep),
    gBumpAt(vGPos + vec3(0.0, 0.0, e), gSteep) - gBumpAt(vGPos - vec3(0.0, 0.0, e), gSteep)) / (2.0 * e);
  vec3 gT = gGrad - gN * dot(gN, gGrad);
  vec3 gWorldN = normalize(gN - gT * uGBump * gNear * 2.0);
  normal = normalize((viewMatrix * vec4(gWorldN, 0.0)).xyz);
}`,
      );
  };
  m.customProgramCacheKey = () => `${prevKey()}|ground`;
  return m;
}
