import * as THREE from 'three';
import { propMaterial } from '../highlands/materials';
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
  uJBevel: THREE.IUniform<number>;
  uJBevelPx: THREE.IUniform<number>;
  uJWeather: THREE.IUniform<number>;
  /** Tint of stone turned away from the sun (white = none): the sky's cool fill. */
  uJShade: THREE.IUniform<THREE.Color>;
}

export function createStoneUniforms(): StoneUniforms {
  return {
    uJNight: { value: 0 },
    uJLights: { value: 1 },
    uJFlood: { value: 1 },
    uJSky: { value: new THREE.Color() },
    uJSun: { value: new THREE.Color() },
    uJSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uJBevel: { value: 0.45 },
    uJBevelPx: { value: 2 },
    uJWeather: { value: 0.12 },
    uJShade: { value: new THREE.Color(1, 1, 1) },
  };
}

const HASH = /* glsl */ `
float jHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float jHash3(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}
// Trilinear value noise: soft weathering patches and leaf clumps that need no texture.
float jNoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = p - i;
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(jHash3(i), jHash3(i + vec3(1, 0, 0)), f.x),
        mix(jHash3(i + vec3(0, 1, 0)), jHash3(i + vec3(1, 1, 0)), f.x), f.y),
    mix(mix(jHash3(i + vec3(0, 0, 1)), jHash3(i + vec3(1, 0, 1)), f.x),
        mix(jHash3(i + vec3(0, 1, 1)), jHash3(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}`;

/**
 * Jerusalem stone: toon lighting plus a surface pass keyed by a per-instance style. Every
 * wall is laid in ashlar courses (in world metres, so neighbouring pieces line up, each block
 * its own warm tone, faded to the average at a distance so it never shimmers); houses get
 * small arched windows and flats rows of them, lit warmly after dark; walls and landmarks are
 * floodlit from below at night, the classic amber glow on the stone; gilded domes catch sun
 * glints by day and glow (HDR, bloomed) at night; lead domes take a dull sheen. Weathering
 * (broad patches, blotches, run-off under the roof's edge) holds at any distance, where the
 * courses fade; boxes get rounded arrises painted into their normals; stone turned from the
 * sun leans toward the sky's cool colour, so a golden evening still has blue shadows. The
 * shared valley mist is patched in on top.
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
attribute float aBevel;
varying float vJBev;
varying vec3 vJAx;
varying vec3 vJAz;
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
  vJBev = aBevel;
  vJAx = normalize(instanceMatrix[0].xyz);
  vJAz = normalize(instanceMatrix[2].xyz);
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
uniform float uJBevel;
uniform float uJBevelPx;
uniform float uJWeather;
uniform vec3 uJShade;
varying float vJBev;
varying vec3 vJAx;
varying vec3 vJAz;
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
vec3 jTilt = vec3(0.0);
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
    // Weathering that survives distance (the ashlar fades out, this doesn't): broad warm/cool
    // patches, finer blotches, and dark run-off streaks under a roof's edge, so big faces are
    // never one flat polygon of colour.
    float wN = jNoise(vJW * 0.11) * 0.6 + jNoise(vJW * 0.43 + 7.0) * 0.4;
    float sN = jNoise(vec3(along * 0.9, vJW.y * 0.06, seed * 13.0));
    float streak = smoothstep(0.55, 0.85, sN) * smoothstep(0.35, 1.0, h / max(vJExt.y, 1.0)) * wallF;
    diffuseColor.rgb *= 1.0 + (wN - 0.5) * 2.0 * uJWeather - streak * uJWeather * 1.1;
    diffuseColor.rgb *= mix(vec3(1.0), mix(vec3(1.04, 0.99, 0.93), vec3(0.95, 0.99, 1.04), wN), uJWeather * 4.0);
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
    if (vJBev > 0.5) {
      // Rounded arrises on boxes: within a bevel of an edge the normal leans toward the
      // neighbouring face (45 degrees at the edge, so both faces agree there and the toon band
      // sweeps round the corner instead of breaking on it). Widened to a few pixels far away so
      // distant houses keep a soft rim rather than a razor edge.
      float px = length(fwidth(vJW));
      float bw = min(max(uJBevel, px * uJBevelPx), 0.3 * min(min(vJExt.x, vJExt.z), vJExt.y));
      if (abs(dot(n, vJAx)) < 0.5) {
        float d = min(vJRel.x, vJExt.x - vJRel.x);
        float t = 1.0 - smoothstep(0.0, bw, d);
        jTilt += vJAx * sign(vJRel.x - 0.5 * vJExt.x) * t * t;
      }
      if (abs(dot(n, vJAz)) < 0.5) {
        float d = min(vJRel.z, vJExt.z - vJRel.z);
        float t = 1.0 - smoothstep(0.0, bw, d);
        jTilt += vJAz * sign(vJRel.z - 0.5 * vJExt.z) * t * t;
      }
      if (n.y < 0.5) {
        float t = 1.0 - smoothstep(0.0, bw, vJExt.y - vJRel.y);
        jTilt += vec3(0.0, t * t, 0.0);
      }
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
  // Faces turned from the sun take the sky's cool fill, so shade reads blue-violet against
  // the gold instead of a darker orange (gold leaf and lamps keep their own colour).
  if (st < 3.5 || st > 4.5 && st < 6.5) {
    float lit = smoothstep(-0.2, 0.35, dot(normalize(n + jTilt), normalize(uJSunDir)));
    diffuseColor.rgb *= mix(uJShade, vec3(1.0), lit);
  }
}`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        /* glsl */ `#include <normal_fragment_maps>
if (dot(jTilt, jTilt) > 1e-4) normal = normalize((viewMatrix * vec4(normalize(normalize(vJN) + jTilt), 0.0)).xyz);`,
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

/** Foliage detail strength (Config.jerusalem.foliageDetail, set per frame). */
export const foliageUniforms = { uFDetail: { value: 1 } };

/**
 * Leaf clumps painted over the tree crowns: a two-octave noise in world metres darkens the gaps
 * between clumps and bumps the normal (screen-space derivatives, as three's bump map does), so a
 * crown's flat facets break into brushed dabs at no triangle cost. It fades to the plain colour
 * where a clump shrinks under a few pixels, so far groves never shimmer.
 */
export function withFoliageDetail<T extends THREE.Material>(m: T): T {
  const own = m.onBeforeCompile !== THREE.Material.prototype.onBeforeCompile;
  const prev = m.onBeforeCompile.bind(m);
  const prevKey = own ? m.customProgramCacheKey() : '';
  m.onBeforeCompile = (shader, renderer) => {
    if (own) prev(shader, renderer);
    Object.assign(shader.uniforms, foliageUniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vFolW;')
      .replace(
        '#include <project_vertex>',
        /* glsl */ `#include <project_vertex>
#ifdef USE_INSTANCING
  vFolW = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
#else
  vFolW = (modelMatrix * vec4(transformed, 1.0)).xyz;
#endif`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>\nvarying vec3 vFolW;\nuniform float uFDetail;\n${HASH}`,
      )
      .replace(
        '#include <color_fragment>',
        /* glsl */ `#include <color_fragment>
float fClump = jNoise(vFolW * 0.9) * 0.55 + jNoise(vFolW * 2.3 + 11.0) * 0.45;
float fFar = smoothstep(0.12, 0.45, length(fwidth(vFolW)) * 2.3);
float fAmt = uFDetail * (1.0 - fFar);
diffuseColor.rgb *= mix(1.0, 0.74 + 0.42 * smoothstep(0.3, 0.72, fClump), fAmt);`,
      )
      .replace(
        '#include <normal_fragment_maps>',
        /* glsl */ `#include <normal_fragment_maps>
if (fAmt > 0.01) {
  // perturbNormalArb, with the clump noise as a height in metres.
  float hgt = fClump * 0.45 * fAmt;
  vec2 dH = vec2(dFdx(hgt), dFdy(hgt));
  vec3 sx = dFdx(-vViewPosition);
  vec3 sy = dFdy(-vViewPosition);
  vec3 r1 = cross(sy, normal);
  vec3 r2 = cross(normal, sx);
  float det = dot(sx, r1);
  vec3 grad = sign(det) * (dH.x * r1 + dH.y * r2);
  normal = normalize(abs(det) * normal - grad);
}`,
      );
  };
  m.customProgramCacheKey = () => prevKey + '|foliage';
  return m;
}

/**
 * The props' material: the Highlands' animated prop material (sway, wheeling flocks) with dry
 * stone painted on the shapes flagged for it (aAnim.x < -0.5; aAnim.y is the course height):
 * fieldstone courses laid in world metres along the wall's run, each stone its own shade with
 * dark joints, fading to the plain colour where the stones shrink under a few pixels.
 */
export function stonePropMaterial(): THREE.MeshToonMaterial {
  const m = propMaterial();
  const prev = m.onBeforeCompile.bind(m);
  m.onBeforeCompile = (shader, renderer) => {
    prev(shader, renderer);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nvarying vec3 vDryW;\nvarying vec3 vDryN;\nvarying vec3 vDryAx;\nvarying vec2 vDry;',
      )
      .replace(
        '#include <project_vertex>',
        /* glsl */ `#include <project_vertex>
#ifdef USE_INSTANCING
  vDryW = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
  vDryN = mat3(modelMatrix) * mat3(instanceMatrix) * objectNormal;
  vDryAx = mat3(modelMatrix) * instanceMatrix[0].xyz;
#else
  vDryW = (modelMatrix * vec4(transformed, 1.0)).xyz;
  vDryN = mat3(modelMatrix) * objectNormal;
  vDryAx = vec3(1.0, 0.0, 0.0);
#endif
  vDry = vec2(step(aAnim.x, -0.5), aAnim.y);`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>\nvarying vec3 vDryW;\nvarying vec3 vDryN;\nvarying vec3 vDryAx;\nvarying vec2 vDry;\n${HASH}`,
      )
      .replace(
        '#include <color_fragment>',
        /* glsl */ `#include <color_fragment>
if (vDry.x > 0.5) {
  vec3 dn = normalize(vDryN);
  vec2 ax = normalize(vDryAx.xz + 1e-5);
  // On the faces: along the run and up; on top: the ground plane.
  vec2 dp = abs(dn.y) < 0.7
    ? vec2(dot(vDryW.xz, ax) + dot(vDryW.xz, vec2(-ax.y, ax.x)) * 0.5, vDryW.y)
    : vDryW.xz;
  float course = max(vDry.y, 0.1);
  float row = floor(dp.y / course);
  float len = course * (1.3 + 1.2 * jHash(vec2(row, 3.0)));
  float u = dp.x / len + jHash(vec2(row, 1.0));
  vec2 id = vec2(floor(u), row);
  vec2 f = vec2(fract(u) * len, fract(dp.y / course) * course);
  float far = smoothstep(0.04, 0.16, max(fwidth(u) * len, fwidth(dp.y)));
  float joint = min(min(f.x, len - f.x), min(f.y, course - f.y));
  float line = 1.0 - smoothstep(0.015, 0.06, joint);
  float tone = 0.84 + 0.26 * jHash(id + 7.0);
  diffuseColor.rgb *= mix(tone * (1.0 - 0.4 * line), 1.0, far);
}`,
      );
  };
  m.customProgramCacheKey = () => 'jl-prop';
  return m;
}
