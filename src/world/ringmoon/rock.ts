import type * as THREE from 'three';
import { Config } from '../../core/Config';

/**
 * Ringmoon's basalt, painted per pixel (no vertices). A spire is a bundle of columns: its
 * lathed mesh is round, and here every column gets a flat face (the normal turned to the
 * column's middle, so the toon bands step from face to face), a dark joint either side, its
 * own shade, and cross joints (cracks) at its own spacing, a pale weathered lip over each. The
 * columns twist a little up the spire and follow its lean, because they are cut from the
 * mesh's own unit space. The terrace steps (hexagonal stubs, faceted already) get the cracks.
 *
 * Needs `withGroundDetail` applied first (it reuses its noise, world position and normal).
 */
const R = Config.ringmoon;
const uniforms = {
  uRmColumns: {
    get value() {
      return R.columns;
    },
  },
  uRmRelief: {
    get value() {
      return R.relief;
    },
  },
  uRmCracks: {
    get value() {
      return R.cracks;
    },
  },
  uRmRockFar: {
    get value() {
      return R.rockFar;
    },
  },
};

const PARS = /* glsl */ `
uniform float uRmColumns;
uniform float uRmRelief;
uniform float uRmCracks;
uniform float uRmRockFar;
varying vec3 vRmL;
`;

/** Colour: joints, column shades, cracks. Leaves rmTurn (facet angle) and rmLip for the normal. */
const COLOR_SPIRE = /* glsl */ `
float rmTurn = 0.0;
float rmLip = 0.0;
float rmNear = 1.0 - smoothstep(uRmRockFar * 0.35, uRmRockFar, distance(vGPos, cameraPosition));
{
  float n = floor(uRmColumns + 0.5);
  float w = 6.2832 / n;
  // The columns twist and wander a little up the spire.
  float tw = (gNoise(vec2(vGPos.y * 0.035, 3.1)) - 0.5) * w * 0.9 + vRmL.y * 0.7;
  float a = atan(vRmL.z, vRmL.x) + tw;
  float c = floor(a / w);
  float f = a / w - c;
  float id = mod(c, n);
  float h = gHash(vec2(id, 17.0));
  rmTurn = (c + 0.5) * w - a;
  // Joints and cracks thin out to nothing where a pixel covers much of a column (no grid far off).
  float fw = max(fwidth(f), 1e-4);
  float sharp = 1.0 - smoothstep(0.04, 0.16, fw);
  float joint = (1.0 - smoothstep(fw, fw + 0.035, min(f, 1.0 - f))) * sharp;
  diffuseColor.rgb *= (0.88 + 0.22 * h) * (1.0 - 0.38 * joint);
  // Cross joints: each column cracked at its own spacing, the drums offset from its neighbours'.
  float sp = 6.0 + 7.0 * gHash(vec2(id, 31.0));
  float cy = (vGPos.y + h * 37.0) / sp;
  float k = fract(cy);
  float ky = max(fwidth(cy), 1e-4);
  // Not every drum is broken: about half the joints show.
  float whole = step(0.5, gHash(vec2(id, floor(cy + 0.5) + 7.0)));
  float crack = (1.0 - smoothstep(ky, ky + 0.02, min(k, 1.0 - k))) * (1.0 - smoothstep(0.03, 0.09, ky)) * whole;
  diffuseColor.rgb *= 1.0 - uRmCracks * 0.45 * crack * rmNear;
  rmLip = smoothstep(ky + 0.02, ky + 0.05, k) * (1.0 - smoothstep(0.05, 0.12, k)) * (1.0 - smoothstep(0.03, 0.09, ky));
  diffuseColor.rgb *= 1.0 + 0.1 * rmLip;
}`;

const COLOR_STEPS = /* glsl */ `
float rmTurn = 0.0;
float rmLip = 0.0;
float rmNear = 1.0 - smoothstep(uRmRockFar * 0.35, uRmRockFar, distance(vGPos, cameraPosition));
{
  float sp = 1.6 + gHash(floor(vGPos.xz * 0.6)) * 1.4;
  float cy = vGPos.y / sp;
  float k = fract(cy);
  float ky = max(fwidth(cy), 1e-4);
  float crack = 1.0 - smoothstep(ky, ky + 0.05, min(k, 1.0 - k));
  diffuseColor.rgb *= 1.0 - uRmCracks * 0.5 * crack * (1.0 - smoothstep(0.7, 0.95, normalize(vGNrm).y));
}`;

/** The normal: each column's face flat (turned to its middle), the lip over a crack facing up. */
const NORMAL = /* glsl */ `
{
  vec3 rmW = normalize((vec4(normal, 0.0) * viewMatrix).xyz);
  float rmA = rmTurn * uRmRelief * rmNear;
  float rc = cos(rmA);
  float rs = sin(rmA);
  rmW = vec3(rmW.x * rc - rmW.z * rs, rmW.y, rmW.x * rs + rmW.z * rc);
  rmW.y += 0.5 * rmLip * uRmRelief * rmNear;
  normal = normalize((viewMatrix * vec4(normalize(rmW), 0.0)).xyz);
}
#include <emissivemap_fragment>`;

/** Paints the basalt (see the module comment): 'spire' columns, or the terraces' 'steps'. */
export function withBasalt<T extends THREE.Material>(m: T, mode: 'spire' | 'steps'): T {
  const prev = m.onBeforeCompile.bind(m);
  const prevKey = m.customProgramCacheKey.bind(m);
  m.onBeforeCompile = (shader, renderer) => {
    prev(shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vRmL;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n  vRmL = position;');
    // After GroundDetail's pars (it declares gNoise and the world-position varyings).
    shader.fragmentShader = shader.fragmentShader
      .replace('float gBumpAt(', `${PARS}\nfloat gBumpAt(`)
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>\n${mode === 'spire' ? COLOR_SPIRE : COLOR_STEPS}`,
      )
      .replace('#include <emissivemap_fragment>', NORMAL);
  };
  m.customProgramCacheKey = () => `${prevKey()}|rm-basalt-${mode}`;
  return m;
}
