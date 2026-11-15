import type * as THREE from 'three';
import { Config } from '../../core/Config';

/**
 * Limestone detail for the pillars, in the fragment shader so it costs no vertices: vertical
 * solution flutes (karren) tilted into the normal so the toon bands break into ribbed strokes,
 * dark rain streaks that run down the walls in patches, and moss on every sky-facing shoulder
 * with a dabbed, broken edge (vertex moss on a metres-wide lattice can only smear). Patterns live
 * in the lathe's own coordinates (angle round the axis, height), so they follow each pillar's
 * shape and lean, and close round the seam (the angle only enters through whole frequencies or
 * as a circle in noise space). Apply after withGroundDetail: it reuses that patch's noise and
 * world position and runs after its normal tilt. The flutes and streaks compile in only where
 * `render.rockDetail` is on (medium, high); low keeps the moss, the cheap part.
 */
const K = Config.karst;
const uniforms = {
  uRFlutes: {
    get value() {
      return K.flutes;
    },
  },
  uRStreaks: {
    get value() {
      return K.streaks;
    },
  },
  uRMoss: {
    get value() {
      return K.mossLedges;
    },
  },
};

const PARS = /* glsl */ `
varying vec3 vRLocal;
uniform float uRFlutes;
uniform float uRStreaks;
uniform float uRMoss;`;

const FRAG = /* glsl */ `{
  float rA = atan(vRLocal.z, vRLocal.x);
  float rY = vRLocal.y;
  vec2 rC = vec2(cos(rA), sin(rA));
  vec3 rWN = normalize((vec4(normal, 0.0) * viewMatrix).xyz);
  float rSide = 1.0 - smoothstep(0.55, 0.85, abs(rWN.y));
#ifdef ROCK_DETAIL
  // Flutes: whole-number frequencies round the axis, wandering as they fall. Their slope along
  // the horizontal tangent tilts the normal, so the light catches one side of each rib.
  float rWob = gNoise(rC * 1.7 + vec2(rY * 0.6, 3.0)) * 4.0;
  float rP1 = rA * 26.0 + rWob;
  float rP2 = rA * 61.0 + rWob * 2.3 + rY * 0.8;
  float rPatch = 0.35 + 0.65 * smoothstep(0.3, 0.7, gNoise(rC * 2.5 + vec2(0.0, rY * 1.3)));
  float rSlope = (cos(rP1) * 0.65 + cos(rP2) * 0.35) * rPatch;
  vec3 rT = normalize(vec3(-rWN.z, 0.0, rWN.x) + 1e-5);
  rWN = normalize(rWN + rT * rSlope * uRFlutes * gNear * rSide);
  normal = normalize((viewMatrix * vec4(rWN, 0.0)).xyz);
  // Rain streaks: narrow dark washes, long in height, starting and stopping in patches.
  float rS = gNoise(rC * 4.5 + vec2(rY * 0.05, 0.0)) + 0.4 * gNoise(rC * 13.0 + vec2(0.0, rY * 0.1));
  float rRun = smoothstep(0.3, 0.6, gNoise(rC * 2.0 + vec2(11.0, rY * 0.45)));
  diffuseColor.rgb *= 1.0 - uRStreaks * smoothstep(0.75, 1.1, rS) * rRun * rSide;
  // Ribs: the crests a shade lighter than the grooves, like dry-brush.
  diffuseColor.rgb *= 1.0 + 0.06 * sin(rP1) * rPatch * gNear;
#endif
  // Moss on what faces the sky, from the smooth geometric normal (gN), not the bumped one, so
  // ledges get bands of moss with a broken edge rather than speckles on every dab.
  float rDab = gNoise(vec2(rA * 6.0, rY * 9.0)) - 0.5;
  float rMoss = smoothstep(0.32, 0.5, gN.y + rDab * 0.3) * uRMoss;
  // Linear colours, between the vertex moss's dark and light greens.
  vec3 rMossCol = mix(vec3(0.075, 0.15, 0.065), vec3(0.16, 0.29, 0.1), gNoise(vGPos.xz * 0.11));
  diffuseColor.rgb = mix(diffuseColor.rgb, rMossCol, rMoss);
}
#include <lights_toon_fragment>`;

export function withRockDetail<T extends THREE.Material>(m: T): T {
  const prev = m.onBeforeCompile.bind(m);
  const prevKey = m.customProgramCacheKey.bind(m);
  m.onBeforeCompile = (shader, renderer) => {
    prev(shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vRLocal;')
      .replace('#include <project_vertex>', '#include <project_vertex>\n  vRLocal = transformed;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${PARS}`)
      .replace('#include <lights_toon_fragment>', FRAG);
  };
  m.customProgramCacheKey = () => `${prevKey()}|rock`;
  return m;
}

/** Compile the flutes and streaks in or out (a recompile: only when the preset changes). */
export function setRockDetail(m: THREE.Material, on: boolean): void {
  const has = m.defines?.ROCK_DETAIL !== undefined;
  if (has === on) return;
  m.defines ??= {};
  if (on) m.defines.ROCK_DETAIL = '';
  else delete m.defines.ROCK_DETAIL;
  m.needsUpdate = true;
}
