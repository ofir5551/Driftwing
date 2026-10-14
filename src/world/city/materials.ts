import * as THREE from 'three';
import { Config } from '../../core/Config';
import { getToonGradient } from '../Terrain';
import type { CityLayout } from './CityLayout';

/** Shared, per-frame uniforms for every city material. */
export interface CityUniforms {
  uCityNight: THREE.IUniform<number>;
  uCityLights: THREE.IUniform<number>;
  uCitySky: THREE.IUniform<THREE.Color>;
  uCityTime: THREE.IUniform<number>;
}

export function createCityUniforms(): CityUniforms {
  return {
    uCityNight: { value: 0 },
    uCityLights: { value: 1 },
    uCitySky: { value: new THREE.Color() },
    uCityTime: { value: 0 },
  };
}

const HASH = /* glsl */ `
float cityHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}`;

/**
 * Building material: toon lighting (so the city shares the painterly light of the rest of the
 * game) plus a facade pass driven by a per-instance style. Window grids are computed in world
 * metres from the face normal, so a box of any size gets correctly sized floors; at a distance
 * the grid fades to its average so it never shimmers. After dark a hashed subset of windows,
 * shop fronts, neon signs, lanterns and blinking aviation lights add emission (HDR for the
 * signs and beacons, so the bloom pass picks them up).
 */
export function createBuildingMaterial(
  u: CityUniforms,
  side: THREE.Side = THREE.FrontSide,
): THREE.Material {
  const mat = new THREE.MeshToonMaterial({ gradientMap: getToonGradient(), side });
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        /* glsl */ `#include <common>
attribute vec2 aStyle;
varying vec2 vCityStyle;
varying vec3 vCityN;
varying vec3 vCityRel;
varying vec3 vCityExt;`,
      )
      .replace(
        '#include <project_vertex>',
        /* glsl */ `#include <project_vertex>
{
  vec4 cw = modelMatrix * instanceMatrix * vec4(transformed, 1.0);
  vec3 o = instanceMatrix[3].xyz;
  vec3 ax = abs(instanceMatrix[0].xyz);
  vec3 az = abs(instanceMatrix[2].xyz);
  vec2 halfXZ = 0.5 * (ax.xz + az.xz);
  vCityRel = vec3(cw.x - o.x + halfXZ.x, cw.y - o.y, cw.z - o.z + halfXZ.y);
  vCityExt = vec3(2.0 * halfXZ.x, length(instanceMatrix[1].xyz), 2.0 * halfXZ.y);
  vCityN = mat3(instanceMatrix) * objectNormal;
  vCityStyle = aStyle;
}`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        /* glsl */ `#include <common>
uniform float uCityNight;
uniform float uCityLights;
uniform vec3 uCitySky;
uniform float uCityTime;
varying vec2 vCityStyle;
varying vec3 vCityN;
varying vec3 vCityRel;
varying vec3 vCityExt;
${HASH}`,
      )
      .replace(
        '#include <color_fragment>',
        /* glsl */ `#include <color_fragment>
vec3 cityEmit = vec3(0.0);
{
  float st = floor(vCityStyle.x + 0.5);
  float seed = vCityStyle.y;
  vec3 n = normalize(vCityN);
  float wallF = 1.0 - step(0.6, abs(n.y));
  bool xFace = abs(n.x) > abs(n.z);
  float along = xFace ? vCityRel.z : vCityRel.x;
  float width = xFace ? vCityExt.z : vCityExt.x;
  float h = vCityRel.y;
  float faceId = (xFace ? 1.0 : 3.0) + sign(xFace ? n.x : n.z);
  float lights = uCityNight * uCityLights;
  if (st < 3.5) {
    // Windowed facades: 0 glass curtain wall, 1 office/shop, 2 apartments, 3 houses.
    vec2 cellSize = st < 0.5 ? vec2(1.6, 3.9) : st < 1.5 ? vec2(3.1, 3.5) : st < 2.5 ? vec2(5.5, 2.9) : vec2(3.6, 2.8);
    vec2 margin = st < 0.5 ? vec2(0.06, 0.2) : st < 1.5 ? vec2(0.2, 0.3) : st < 2.5 ? vec2(0.08, 0.4) : vec2(0.3, 0.35);
    float topY = st < 0.5 ? 0.97 : 0.88;
    vec2 cell = vec2(along, h) / cellSize;
    vec2 id = floor(cell);
    vec2 f = fract(cell);
    float inFacade = step(0.9, along) * step(along, width - 0.9) * step(h, vCityExt.y - 0.9)
      * step(st < 2.5 ? 0.0 : 0.6, h) * wallF;
    float win = step(margin.x, f.x) * step(f.x, 1.0 - margin.x) * step(margin.y, f.y) * step(f.y, topY);
    vec2 fw = fwidth(cell);
    float far = smoothstep(0.2, 0.55, max(fw.x, fw.y));
    float cover = (1.0 - 2.0 * margin.x) * (topY - margin.y);
    float glass = mix(win, cover, far) * inFacade;
    float rnd = cityHash(id + vec2(faceId * 37.0, seed * 131.0));
    float litFrac = (st < 0.5 ? 0.42 : st < 1.5 ? 0.5 : st < 2.5 ? 0.55 : 0.4) * (0.55 + 0.7 * fract(seed * 7.31));
    float lit = mix(step(rnd, litFrac), litFrac, far);
    vec3 pane = st < 0.5
      ? mix(diffuseColor.rgb * 0.75, uCitySky * 0.85, 0.5)
      : mix(vec3(0.07, 0.08, 0.12), uCitySky * 0.6, 0.35 + 0.25 * fract(rnd * 3.1));
    diffuseColor.rgb = mix(diffuseColor.rgb, pane, glass * 0.85);
    if (st > 1.5) {
      // Balcony bands on apartments.
      float band = step(f.y, 0.3) * inFacade * (1.0 - far);
      diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 1.12, band * step(st, 2.5));
    }
    diffuseColor.rgb *= mix(1.0, 0.8, step(0.6, n.y)); // darker flat roofs
    vec3 warm = mix(vec3(1.0, 0.7, 0.4), vec3(0.72, 0.86, 1.0), step(0.72, fract(rnd * 13.7 + seed)));
    cityEmit = warm * glass * lit * lights * (st < 0.5 ? 0.85 : 0.75);
    // Shop fronts: the ground floor of offices and towers glows warmly at night.
    float shop = step(0.4, h) * (1.0 - step(4.2, h)) * step(st, 1.5) * step(0.9, along) * step(along, width - 0.9) * wallF;
    cityEmit += vec3(1.0, 0.76, 0.48) * shop * lights * 0.6;
  } else if (st > 4.5 && st < 5.5) {
    // Neon sign: a lit frame and blocky glyphs. Visible by day, blazing after dark.
    vec2 g = floor(vec2(along * 1.1, h * 1.3));
    float glyph = step(0.38, cityHash(g + seed * 91.0)) * step(0.5, along) * step(along, width - 0.5) * step(0.5, h) * step(h, vCityExt.y - 0.5);
    float frame = 1.0 - step(0.25, along) * step(along, width - 0.25) * step(0.25, h) * step(h, vCityExt.y - 0.25);
    float pat = max(glyph, frame) * wallF + (1.0 - wallF) * 0.5;
    diffuseColor.rgb = mix(diffuseColor.rgb * 0.45, diffuseColor.rgb, pat);
    cityEmit = diffuseColor.rgb * (0.2 + lights * 2.6) * (0.3 + 0.7 * pat);
  } else if (st > 5.5 && st < 6.5) {
    cityEmit = diffuseColor.rgb * (0.12 + lights * 2.4); // lanterns and lamps
  } else if (st > 6.5 && st < 7.5) {
    // Lattice tower: thin cross-braced bars cut out of the shell. Bars widen with distance
    // (so they never alias away) and the shell turns solid once they would fill the cell.
    float u = along / 6.0;
    float v = h / 6.0;
    float aa = fwidth(u + v);
    float wBar = 0.07 + aa * 0.8;
    float f1 = fract(u + v);
    float f2 = fract(u - v);
    float f3 = fract(v * 0.5);
    float d = min(min(min(f1, 1.0 - f1), min(f2, 1.0 - f2)), min(f3, 1.0 - f3) * 1.6);
    if (d > wBar && wBar < 0.32) discard;
    float t = h / max(vCityExt.y, 1.0);
    float band = step(0.55, t) * step(0.72, fract(t * 7.0));
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.92), band);
    cityEmit = diffuseColor.rgb * lights * 0.7;
  } else if (st > 7.5) {
    float blink = step(0.2, sin(uCityTime * 2.4 + seed * 6.283));
    cityEmit = diffuseColor.rgb * (0.25 + lights * 3.0 * blink);
  }
}`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        /* glsl */ `#include <emissivemap_fragment>
totalEmissiveRadiance += cityEmit;`,
      );
  };
  mat.customProgramCacheKey = () => 'city-building';
  return mat;
}

/** sRGB hex -> linear vec3 literal for GLSL. */
function lin(hex: string): string {
  const c = new THREE.Color(hex);
  return `vec3(${c.r.toFixed(4)}, ${c.g.toFixed(4)}, ${c.b.toFixed(4)})`;
}

/**
 * Ground material: vertex colours give each block its ground (paving, gravel, grass, water's
 * edge); the street grid is drawn analytically on top from world position, because it is a
 * regular lattice: asphalt, tree-lined sidewalks, dashed lane lines, zebra crossings, and
 * pools of lamplight after dark. `aRoad` switches local streets off inside parks.
 */
export function createGroundMaterial(u: CityUniforms, city: CityLayout): THREE.Material {
  const mat = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: getToonGradient() });
  const f = (v: number) => v.toFixed(3);
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        /* glsl */ `#include <common>
attribute float aRoad;
varying float vRoad;
varying vec3 vGround;`,
      )
      .replace(
        '#include <project_vertex>',
        /* glsl */ `#include <project_vertex>
vGround = (modelMatrix * vec4(transformed, 1.0)).xyz;
vRoad = aRoad;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        /* glsl */ `#include <common>
uniform float uCityNight;
uniform float uCityLights;
varying float vRoad;
varying vec3 vGround;
#define CS ${f(city.S)}
#define AH ${f(city.AH)}
#define SH ${f(city.SH)}
#define C1 ${f(city.c1)}
#define C2 ${f(city.c2)}`,
      )
      .replace(
        '#include <color_fragment>',
        /* glsl */ `#include <color_fragment>
vec3 groundEmit = vec3(0.0);
{
  vec2 p = vGround.xz;
  vec2 m = mod(p, CS);
  vec2 da = min(m, CS - m);
  vec2 ds = min(abs(m - C1), abs(m - C2));
  float aa = max(fwidth(p.x), fwidth(p.y));
  float dry = smoothstep(0.1, 0.5, vGround.y - ${f(Config.world.waterLevel)});
  float avX = 1.0 - smoothstep(AH - aa, AH + aa, da.x);
  float avZ = 1.0 - smoothstep(AH - aa, AH + aa, da.y);
  float av = max(avX, avZ);
  float stX = (1.0 - smoothstep(SH - aa, SH + aa, ds.x)) * vRoad * (1.0 - av);
  float stZ = (1.0 - smoothstep(SH - aa, SH + aa, ds.y)) * vRoad * (1.0 - av);
  float st = max(stX, stZ);
  // Avenue sidewalks are the outer 4 m (outside the crossing); street sidewalks 2.5 m into the block.
  float walkX = avX * smoothstep(AH - 4.0 - aa, AH - 4.0 + aa, da.x) * (1.0 - avZ);
  float walkZ = avZ * smoothstep(AH - 4.0 - aa, AH - 4.0 + aa, da.y) * (1.0 - avX);
  float walkSt = (1.0 - smoothstep(SH + 2.5 - aa, SH + 2.5 + aa, min(ds.x, ds.y))) * vRoad * (1.0 - av) * (1.0 - st);
  float walk = max(max(walkX, walkZ), walkSt);
  float road = max(av, st) * (1.0 - walk);
  float lineFade = 1.0 - smoothstep(0.12, 0.45, aa);
  // Lanes: dashed dividers 5.5 and 11 m out, a solid centre line, solid edge lines.
  float w = 0.13 + aa * 0.5;
  float dashZ = step(0.45, fract(p.y / 9.0));
  float dashX = step(0.45, fract(p.x / 9.0));
  float laneX = (1.0 - smoothstep(w, w + aa, abs(da.x - 5.5))) * dashZ
    + (1.0 - smoothstep(w, w + aa, abs(da.x - 11.0))) * dashZ
    + (1.0 - smoothstep(w, w + aa, da.x)) + (1.0 - smoothstep(w, w + aa, abs(da.x - (AH - 4.6))));
  float laneZ = (1.0 - smoothstep(w, w + aa, abs(da.y - 5.5))) * dashX
    + (1.0 - smoothstep(w, w + aa, abs(da.y - 11.0))) * dashX
    + (1.0 - smoothstep(w, w + aa, da.y)) + (1.0 - smoothstep(w, w + aa, abs(da.y - (AH - 4.6))));
  float lanes = min(1.0, laneX * avX * (1.0 - avZ) + laneZ * avZ * (1.0 - avX));
  // Zebra crossings just outside each crossing.
  float zx = step(0.5, fract(p.y / 1.5)) * avZ * step(AH + 0.6, da.x) * (1.0 - step(AH + 4.4, da.x)) * (1.0 - step(AH - 4.0, da.y));
  float zz = step(0.5, fract(p.x / 1.5)) * avX * step(AH + 0.6, da.y) * (1.0 - step(AH + 4.4, da.y)) * (1.0 - step(AH - 4.0, da.x));
  float stLine = (1.0 - smoothstep(w, w + aa, min(ds.x, ds.y))) * step(0.5, fract((stX > stZ ? p.y : p.x) / 7.0)) * st;
  float marks = min(1.0, lanes * (1.0 - walk) + max(zx, zz) + stLine) * lineFade;
  vec3 col = diffuseColor.rgb;
  col = mix(col, ${lin('#b9b2ad')}, walk * dry);
  col = mix(col, ${lin('#5d5966')}, road * dry);
  col = mix(col, ${lin('#e8e2d6')}, marks * road * dry * 0.85);
  diffuseColor.rgb = col;
  // Lamplight pools along the avenue sidewalks after dark.
  vec2 qx = vec2(da.x - (AH - 2.5), mod(p.y, 26.0) - 13.0);
  vec2 qz = vec2(da.y - (AH - 2.5), mod(p.x, 26.0) - 13.0);
  float pool = exp(-dot(qx, qx) / 14.0) * avX * (1.0 - avZ) + exp(-dot(qz, qz) / 14.0) * avZ * (1.0 - avX);
  groundEmit = ${lin('#ffc98a')} * pool * dry * uCityNight * uCityLights * 0.35;
}`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        /* glsl */ `#include <emissivemap_fragment>
totalEmissiveRadiance += groundEmit;`,
      );
  };
  mat.customProgramCacheKey = () => 'city-ground';
  return mat;
}
