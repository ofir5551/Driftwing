import * as THREE from 'three';
import { Config } from '../../core/Config';

/**
 * Sea of Clouds' granite, painted per pixel over the lathed spires (and the monastery's rock
 * stair). The mesh carries the big shapes (ledges, grooves, chimneys); this adds what a mesh
 * can't afford: the fine joint system of real granite towers. Vertical fractures wander down
 * the faces and horizontal sheeting joints cross them, both as thin dark lines along the
 * iso-surface of a stretched 3D value noise (world space, so there is no seam round the lathe
 * and every spire differs), and the blocks between them bulge like pillows, so the light rolls
 * over each one (the normal is tilted by the relief's slope along the face). Lichen in ochre
 * and grey-green patches, dark water stains hanging under the joints, moss and alpine turf
 * wherever the tilted normal faces the sky, and snow on the high ledges above a ragged snowline.
 *
 * The relief and fine paint fade by `Config.peaks.rockFar` (off on low, `render.rockDetail`),
 * so far spires keep the vertex paint and the shader costs nothing beyond it.
 */
const K = Config.peaks;

const uniforms = {
  uGrRelief: {
    get value() {
      return K.rockRelief;
    },
  },
  uGrFar: {
    get value() {
      return Config.render.rockDetail > 0 ? K.rockFar : 1e-3;
    },
  },
  uGrSnow: {
    get value() {
      return K.snowline;
    },
  },
  uGrSnowRag: {
    get value() {
      return K.snowRag;
    },
  },
  uGrMoss: {
    get value() {
      return K.ledgeMoss;
    },
  },
};

const PARS = /* glsl */ `
uniform float uGrRelief;
uniform float uGrFar;
uniform float uGrSnow;
uniform float uGrSnowRag;
uniform float uGrMoss;
varying vec3 vGrPos;
varying vec3 vGrNrm;
float grHash(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}
float grNoise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(grHash(i), grHash(i + vec3(1.0, 0.0, 0.0)), f.x),
        mix(grHash(i + vec3(0.0, 1.0, 0.0)), grHash(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
    mix(mix(grHash(i + vec3(0.0, 0.0, 1.0)), grHash(i + vec3(1.0, 0.0, 1.0)), f.x),
        mix(grHash(i + vec3(0.0, 1.0, 1.0)), grHash(i + vec3(1.0, 1.0, 1.0)), f.x), f.y), f.z);
}
// The joint field: x = vertical fractures (0 on a crack), y = horizontal sheeting joints.
vec2 grJoints(vec3 p) {
  float c = abs(grNoise(p * vec3(0.075, 0.012, 0.075)) - 0.5);
  float j = abs(grNoise(p * vec3(0.016, 0.07, 0.016) + 17.0) - 0.5);
  return vec2(c, j);
}
// Relief in metres-ish: pillowed blocks between the joints, the joints themselves cut in.
float grRelief(vec3 p) {
  vec2 q = grJoints(p);
  float block = smoothstep(0.0, 0.2, q.x) * smoothstep(0.0, 0.17, q.y);
  return block * 0.9 - (1.0 - smoothstep(0.0, 0.035, q.x)) * 0.6 - (1.0 - smoothstep(0.0, 0.03, q.y)) * 0.45;
}`;

/** Colour pass (before alphamap_fragment): paint, and the tilted normal for the light pass. */
const COLOR = /* glsl */ `
vec3 grN = normalize(vGrNrm);
vec3 grWN = grN;
float grDist = distance(vGrPos, cameraPosition);
float grNear = 1.0 - smoothstep(uGrFar * 0.5, uGrFar, grDist);
vec2 grQ = vec2(0.5);
if (grNear > 0.0) {
  // Tangent frame on the face: round the spire (horizontal) and up the face.
  vec3 tg = normalize(vec3(-grN.z, 0.0, grN.x) + vec3(1e-4, 0.0, 0.0));
  vec3 bt = normalize(cross(grN, tg));
  float r0 = grRelief(vGrPos);
  float dA = (grRelief(vGrPos + tg * 0.7) - r0) / 0.7;
  float dB = (grRelief(vGrPos + bt * 0.7) - r0) / 0.7;
  grWN = normalize(grN - (tg * dA + bt * dB) * 2.6 * uGrRelief * grNear);
  grQ = grJoints(vGrPos);
}
{
  vec3 p = vGrPos;
  float n1 = grNoise(p * 0.045);
  float n2 = grNoise(p * vec3(0.3, 0.05, 0.3) + 5.0);
  vec3 rc = diffuseColor.rgb;
  // Stone tone drifts warmer and cooler across the faces.
  rc *= 0.88 + 0.24 * n1;
  float crack = (1.0 - smoothstep(0.0, 0.03, grQ.x)) + (1.0 - smoothstep(0.0, 0.025, grQ.y)) * 0.8;
  rc *= 1.0 - 0.55 * min(crack, 1.0) * grNear;
  // Dark water stains hanging down the faces.
  float stain = smoothstep(0.62, 0.86, n2) * (1.0 - smoothstep(0.5, 0.9, grWN.y));
  rc = mix(rc, rc * vec3(0.55, 0.56, 0.6), stain * 0.6 * (0.35 + 0.65 * grNear));
  // Lichen: ochre and grey-green crusts.
  float lich = smoothstep(0.66, 0.8, grNoise(p * 0.11 + 9.0));
  rc = mix(rc, mix(vec3(0.78, 0.64, 0.4), vec3(0.62, 0.68, 0.55), n2), lich * 0.35 * grNear);
  // Moss and alpine turf wherever the rock faces the sky (ledges, the grooves' lower lips).
  float up = grWN.y + 0.18 * (n1 - 0.5);
  float moss = smoothstep(0.42, 0.72, up) * uGrMoss;
  vec3 turf = mix(vec3(0.27, 0.38, 0.2), vec3(0.47, 0.5, 0.26), smoothstep(0.3, 0.8, n2));
  rc = mix(rc, turf, moss * 0.85);
  // Snow on the high ledges and summits, above a ragged snowline.
  float rag = (grNoise(p * 0.03 + 3.0) - 0.5) * 2.0 * uGrSnowRag;
  float snow = smoothstep(uGrSnow - 6.0, uGrSnow + 6.0, p.y + rag) * smoothstep(0.62, 0.82, up + 0.25 * (n2 - 0.5));
  rc = mix(rc, mix(vec3(0.74, 0.8, 0.92), vec3(0.97, 0.98, 1.0), smoothstep(0.75, 0.95, grWN.y)), snow);
  diffuseColor.rgb = rc;
}`;

/** Normal pass (before emissivemap_fragment): light the tilted normal. */
const NORMAL = /* glsl */ `
if (grNear > 0.0) normal = normalize((viewMatrix * vec4(grWN, 0.0)).xyz);`;

/** Paint a lit material as Sea of Clouds' granite (see the file comment). Returns it. */
export function withGranite<T extends THREE.Material>(m: T): T {
  const prev = m.onBeforeCompile.bind(m);
  const prevKey = m.customProgramCacheKey.bind(m);
  m.onBeforeCompile = (shader, renderer) => {
    prev(shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vGrPos;\nvarying vec3 vGrNrm;')
      .replace(
        '#include <defaultnormal_vertex>',
        `#include <defaultnormal_vertex>
  vGrNrm = normalize((vec4(transformedNormal, 0.0) * viewMatrix).xyz);`,
      )
      .replace(
        '#include <project_vertex>',
        `#include <project_vertex>
#ifdef USE_INSTANCING
  vGrPos = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
#else
  vGrPos = (modelMatrix * vec4(transformed, 1.0)).xyz;
#endif`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${PARS}`)
      .replace('#include <alphamap_fragment>', `${COLOR}\n#include <alphamap_fragment>`)
      .replace('#include <emissivemap_fragment>', `${NORMAL}\n#include <emissivemap_fragment>`);
  };
  m.customProgramCacheKey = () => `${prevKey()}|granite`;
  return m;
}
