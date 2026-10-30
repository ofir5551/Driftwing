import * as THREE from 'three';
import { withMist } from '../Mist';
import { getToonGradient } from '../Terrain';

/** Shared, per-frame uniforms for the level's stone. */
export interface StoneUniforms {
  uJNight: THREE.IUniform<number>;
  uJLights: THREE.IUniform<number>;
  uJFlood: THREE.IUniform<number>;
  uJSky: THREE.IUniform<THREE.Color>;
  uJSun: THREE.IUniform<THREE.Color>;
  uJSunDir: THREE.IUniform<THREE.Vector3>;
}

export function createStoneUniforms(): StoneUniforms {
  return {
    uJNight: { value: 0 },
    uJLights: { value: 1 },
    uJFlood: { value: 1 },
    uJSky: { value: new THREE.Color() },
    uJSun: { value: new THREE.Color() },
    uJSunDir: { value: new THREE.Vector3(0, 1, 0) },
  };
}

const HASH = /* glsl */ `
float jHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}`;

/**
 * Jerusalem stone: toon lighting plus a surface pass keyed by a per-instance style. Every
 * wall is laid in ashlar courses (in world metres, so neighbouring pieces line up, each block
 * its own warm tone, faded to the average at a distance so it never shimmers); houses get
 * small arched windows and flats rows of them, lit warmly after dark; walls and landmarks are
 * floodlit from below at night, the classic amber glow on the stone; gilded domes catch sun
 * glints by day and glow (HDR, bloomed) at night; lead domes take a dull sheen. The shared
 * valley mist is patched in on top.
 */
export function createStoneMaterial(u: StoneUniforms): THREE.Material {
  const mat = new THREE.MeshToonMaterial({ gradientMap: getToonGradient(), vertexColors: true });
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        /* glsl */ `#include <common>
attribute vec2 aStyle;
varying vec2 vJStyle;
varying vec3 vJN;
varying vec3 vJW;
varying vec3 vJRel;
varying vec3 vJExt;`,
      )
      .replace(
        '#include <project_vertex>',
        /* glsl */ `#include <project_vertex>
{
  vec3 ext = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
  vJExt = ext;
  vJRel = transformed * ext + vec3(0.5 * ext.x, 0.0, 0.5 * ext.z);
  vJW = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
  vJN = normalize(mat3(instanceMatrix) * (objectNormal / (ext * ext))); // inverse transpose
  vJStyle = aStyle;
}`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        /* glsl */ `#include <common>
uniform float uJNight;
uniform float uJLights;
uniform float uJFlood;
uniform vec3 uJSky;
uniform vec3 uJSun;
uniform vec3 uJSunDir;
varying vec2 vJStyle;
varying vec3 vJN;
varying vec3 vJW;
varying vec3 vJRel;
varying vec3 vJExt;
${HASH}`,
      )
      .replace(
        '#include <color_fragment>',
        /* glsl */ `#include <color_fragment>
vec3 jEmit = vec3(0.0);
{
  float st = floor(vJStyle.x + 0.5);
  float seed = vJStyle.y;
  vec3 n = normalize(vJN);
  float wallF = 1.0 - step(0.6, abs(n.y));
  float roofF = step(0.6, n.y);
  // Along the face: world metres on the face's tangent, so neighbouring pieces line up.
  vec2 tan2 = normalize(vec2(-n.z, n.x) + 1e-5);
  float along = dot(vJW.xz, tan2);
  float h = vJRel.y;
  float night = uJNight * uJLights;
  float flood = uJNight * uJFlood;
  if (st < 3.5 || st > 5.5 && st < 6.5) {
    // Ashlar: courses ~0.7 m tall, blocks 1.1-1.7 m long, alternate courses offset.
    float course = 0.72;
    float row = floor(vJW.y / course);
    float L = 1.1 + 0.6 * jHash(vec2(row, 7.0));
    float u = along / L + 0.5 * mod(row, 2.0) + jHash(vec2(row, 3.0));
    vec2 id = vec2(floor(u), row);
    vec2 f = vec2(fract(u) * L, fract(vJW.y / course) * course);
    float aa = max(fwidth(u) * L, fwidth(vJW.y));
    float far = smoothstep(0.08, 0.3, aa);
    float joint = min(min(f.x, L - f.x), min(f.y, course - f.y));
    float line = 1.0 - smoothstep(0.025, 0.06 + aa, joint);
    float tone = 0.9 + 0.17 * jHash(id + seed * 17.0);
    float ash = mix(tone * (1.0 - 0.2 * line), 1.0, far);
    if (st > 5.5) {
      // Tiles: a fine glazed grid with a little sparkle in the tone.
      vec2 t = vec2(along, vJW.y) / 0.55;
      vec2 tf = abs(fract(t) - 0.5);
      float tl = smoothstep(0.42, 0.48, max(tf.x, tf.y)) * (1.0 - far);
      ash = mix(0.92 + 0.14 * jHash(floor(t)), 1.0, far) * (1.0 - 0.15 * tl);
    }
    diffuseColor.rgb *= mix(1.0, ash, wallF);
    // Roofs pale and dusty; the foot of a wall a little darker with age.
    diffuseColor.rgb *= mix(1.0, 1.06, roofF) * (0.9 + 0.1 * smoothstep(0.0, 2.5, h));
    if (st > 0.5 && st < 2.5) {
      // Windows: small arched ones on houses, rows of wider ones on flats.
      bool flats = st > 1.5;
      vec2 cs = flats ? vec2(3.2, 3.0) : vec2(3.6, 3.1);
      vec2 ww = flats ? vec2(1.5, 1.35) : vec2(0.85, 1.35);
      bool xf = abs(n.x) > abs(n.z);
      float a2 = xf ? vJRel.z : vJRel.x;
      float wd = xf ? vJExt.z : vJExt.x;
      vec2 cell = vec2(a2, h - 0.6) / cs;
      vec2 cid = floor(cell);
      vec2 p = (fract(cell) - vec2(0.5, 0.45)) * cs;
      float arch = flats ? 0.0 : max(p.y - (ww.y * 0.5 - ww.x * 0.5), 0.0);
      float inWin = step(abs(p.x), ww.x * 0.5) * step(abs(p.y), ww.y * 0.5)
        * step(length(vec2(p.x, arch)), ww.x * 0.5);
      float present = step(jHash(cid + vec2(seed * 31.0, xf ? 5.0 : 9.0)), flats ? 0.9 : 0.6);
      float inF = step(1.0, a2) * step(a2, wd - 1.0) * step(0.9, h) * step(h, vJExt.y - 0.6) * wallF;
      vec2 fw = fwidth(cell);
      float wfar = smoothstep(0.2, 0.55, max(fw.x, fw.y));
      float cover = (ww.x * ww.y) / (cs.x * cs.y) * (flats ? 0.9 : 0.6);
      float glass = mix(inWin * present, cover, wfar) * inF;
      vec3 pane = mix(vec3(0.05, 0.045, 0.05), uJSky * 0.35, 0.3);
      diffuseColor.rgb = mix(diffuseColor.rgb, pane, glass * 0.85);
      float rnd = jHash(cid + vec2(seed * 53.0, 1.7));
      float litF = (flats ? 0.45 : 0.5) * (0.6 + 0.7 * fract(seed * 5.3));
      float lit = mix(step(rnd, litF), litF, wfar);
      vec3 warm = mix(vec3(1.0, 0.66, 0.34), vec3(1.0, 0.86, 0.62), step(0.7, fract(rnd * 9.1)));
      jEmit = warm * glass * lit * night * 0.8;
    }
    if (st > 2.5 && st < 3.5) {
      // Floodlights at the wall's foot wash the stone amber, brightest low down.
      float wash = 0.3 + 0.9 * exp(-h / 14.0);
      jEmit += diffuseColor.rgb * vec3(1.0, 0.64, 0.32) * wash * flood * 0.6 * wallF;
    }
  } else if (st < 4.5) {
    // Gold leaf: bright, warm, with a hard glint where it mirrors the sun.
    vec3 v = normalize(cameraPosition - vJW);
    vec3 r = reflect(-v, n);
    float g1 = pow(max(dot(r, normalize(uJSunDir)), 0.0), 9.0);
    float rim = pow(1.0 - max(dot(n, v), 0.0), 3.0);
    jEmit = uJSun * g1 * 1.5 + diffuseColor.rgb * (0.18 + rim * 0.25)
      + diffuseColor.rgb * vec3(1.0, 0.8, 0.5) * flood * 2.4;
  } else if (st < 5.5) {
    // Lead and silver: a dull sheen toward the sun, faintly lit after dark.
    vec3 v = normalize(cameraPosition - vJW);
    float g1 = pow(max(dot(reflect(-v, n), normalize(uJSunDir)), 0.0), 14.0);
    jEmit = uJSun * g1 * 0.35 + diffuseColor.rgb * vec3(1.0, 0.75, 0.5) * flood * 0.35;
  } else if (st > 6.5 && st < 7.5) {
    jEmit = diffuseColor.rgb * (0.1 + night * 2.6);
  }
}`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        /* glsl */ `#include <emissivemap_fragment>
totalEmissiveRadiance += jEmit;`,
      );
  };
  mat.customProgramCacheKey = () => 'jerusalem-stone';
  return withMist(mat);
}
