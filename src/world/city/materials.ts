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

/** Painterly facade uniforms: getters read Config live, so ?debug tunes them without a recompile. */
const CC = Config.city;
const paintUniforms = {
  uCityBevel: {
    get value() {
      return CC.bevel;
    },
  },
  uCityWash: {
    get value() {
      return CC.wash;
    },
  },
  uCityStreaks: {
    get value() {
      return CC.streaks;
    },
  },
  uCityBase: {
    get value() {
      return CC.baseShade;
    },
  },
  uCitySkyGrade: {
    get value() {
      return CC.skyGrade;
    },
  },
  uCityWinDepth: {
    get value() {
      return CC.windowDepth;
    },
  },
  uCityEdgeLight: {
    get value() {
      return CC.edgeLight;
    },
  },
  uCityGlassSky: {
    get value() {
      return CC.glassSky;
    },
  },
};

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
  box = false,
): THREE.Material {
  const mat = new THREE.MeshToonMaterial({ gradientMap: getToonGradient(), side });
  // The painterly pass (rounded edges, wash, weathering, the foot's shade, the cornice, window
  // depth) reads a box's own face frame, so it is compiled only into the box mesh's program.
  if (box) mat.defines = { CITY_BOX: '' };
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u, paintUniforms);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        /* glsl */ `#include <common>
attribute vec2 aStyle;
varying vec2 vCityStyle;
varying vec3 vCityN;
varying vec3 vCityRel;
varying vec3 vCityExt;
varying vec3 vCityW;
varying vec2 vCityAx;`,
      )
      .replace(
        '#include <project_vertex>',
        /* glsl */ `#include <project_vertex>
{
  // The part's own frame: every part is a scale then a yaw, so its unit shape's local position
  // times the scale is metres from its corner (x, z) and base (y) whichever way it is turned.
  // Turned parts (railings along a curving shore, piers, crane booms) keep their windows,
  // edges and cornices on their own faces.
  vec3 sc = vec3(length(instanceMatrix[0].xyz), length(instanceMatrix[1].xyz), length(instanceMatrix[2].xyz));
  vCityRel = vec3((transformed.x + 0.5) * sc.x, transformed.y * sc.y, (transformed.z + 0.5) * sc.z);
  vCityExt = sc;
  vCityN = objectNormal;
  vCityAx = instanceMatrix[0].xz / max(sc.x, 1e-4);
  vCityW = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
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
uniform float uCityBevel;
uniform float uCityWash;
uniform float uCityStreaks;
uniform float uCityBase;
uniform float uCitySkyGrade;
uniform float uCityWinDepth;
uniform float uCityGlassSky;
uniform float uCityEdgeLight;
varying vec3 vCityRel;
varying vec3 vCityExt;
varying vec3 vCityW;
varying vec2 vCityAx;
${HASH}
float cityNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(cityHash(i), cityHash(i + vec2(1.0, 0.0)), f.x),
    mix(cityHash(i + vec2(0.0, 1.0)), cityHash(i + vec2(1.0, 1.0)), f.x), f.y);
}`,
      )
      .replace(
        '#include <color_fragment>',
        /* glsl */ `#include <color_fragment>
vec3 cityEmit = vec3(0.0);
vec3 cityTilt = vec3(0.0);
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
#ifdef CITY_BOX
    // Glass mirrors the sky: more at grazing angles and higher up (less street to reflect).
    vec3 wn = vec3(n.x * vCityAx.x - n.z * vCityAx.y, n.y, n.x * vCityAx.y + n.z * vCityAx.x);
    vec3 vdir = normalize(cameraPosition - vCityW);
    float fres = pow(1.0 - clamp(dot(wn, vdir), 0.0, 1.0), 3.0);
    float up = smoothstep(10.0, 160.0, vCityW.y);
    pane = mix(pane, uCitySky * 1.05, uCityGlassSky * (st < 0.5 ? 0.45 * fres + 0.35 * up : 0.3 * fres));
    // Depth: each pane is shaded under its lintel; a pale sill sits under it (fades far off).
    float lintel = smoothstep(topY, topY - 0.16 * (topY - margin.y) - 0.04, f.y);
    pane *= mix(1.0, mix(0.55, 1.0, lintel), uCityWinDepth * (1.0 - far));
    float sill = step(margin.y - 0.07, f.y) * step(f.y, margin.y) * step(margin.x, f.x) * step(f.x, 1.0 - margin.x);
    diffuseColor.rgb *= 1.0 + 0.35 * uCityWinDepth * sill * inFacade * (1.0 - far) * step(0.5, st);
#endif
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
#ifdef CITY_BOX
  if (st > 8.5 && st < 9.5) {
    // Shipping container: corrugated sides (ribs every 0.3 m, fading far off), a darker band
    // of doors at each end and a pale stencilled stripe.
    float rib = fract(along / 0.3);
    float rfar = smoothstep(0.08, 0.25, fwidth(along / 0.3));
    float ribs = mix(smoothstep(0.0, 0.5, abs(rib - 0.5)), 0.5, rfar);
    diffuseColor.rgb *= mix(1.0, 0.86 + 0.22 * ribs, wallF);
    float doors = 1.0 - step(0.35, along) * step(along, width - 0.35);
    diffuseColor.rgb *= 1.0 - 0.18 * doors * wallF;
    diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.9), step(abs(h / vCityExt.y - 0.78), 0.05) * wallF * 0.25);
  }
  if (st < 4.5 || st > 8.5) {
    // Painterly pass: hides the box facets without a single extra vertex.
    // Rounded edges: near a vertical corner (or a wall's top edge, or a roof's rim) the shading
    // normal leans toward the neighbouring face, so the toon bands turn the corner softly
    // instead of snapping. The width never drops under ~2.5 px, so far towers get soft edges too.
    bool roof = n.y > 0.6;
    float cityEdge = 0.0;
    vec3 tilt = vec3(0.0);
    if (!roof) {
      float r = max(uCityBevel, fwidth(along) * 2.5);
      float wL = 1.0 - smoothstep(0.0, r, along);
      float wR = 1.0 - smoothstep(0.0, r, width - along);
      float rt = max(uCityBevel, fwidth(h) * 2.5);
      float wT = 1.0 - smoothstep(0.0, rt, vCityExt.y - h);
      vec3 ax = xFace ? vec3(0.0, 0.0, 1.0) : vec3(1.0, 0.0, 0.0);
      tilt = (wR - wL) * ax * 0.9 + vec3(0.0, wT * 0.9, 0.0);
      cityEdge = max(max(wL, wR), wT);
    } else {
      vec2 rr = max(vec2(uCityBevel), fwidth(vCityRel.xz) * 2.5);
      vec2 lo = 1.0 - smoothstep(vec2(0.0), rr, vCityRel.xz);
      vec2 hi = 1.0 - smoothstep(vec2(0.0), rr, vCityExt.xz - vCityRel.xz);
      vec2 t = (hi - lo) * 0.9;
      tilt = vec3(t.x, 0.0, t.y);
      cityEdge = max(max(lo.x, lo.y), max(hi.x, hi.y));
    }
    // The tilt is in the part's frame: turn it with the part's yaw into the world.
    cityTilt = vec3(tilt.x * vCityAx.x - tilt.z * vCityAx.y, tilt.y, tilt.x * vCityAx.y + tilt.z * vCityAx.x);
    // Paint wash: broad and finer patches of lighter/darker, warmer/cooler paint.
    vec2 q = roof ? vCityW.xz : vec2(along + seed * 97.0, vCityW.y);
    q += faceId * 17.3;
    float wash = (cityNoise(q / 11.0) - 0.5) * 1.3 + (cityNoise(q / 3.1 + 7.0) - 0.5) * 0.7;
    float tint = cityNoise(q / 23.0 + 31.0);
    vec3 c = diffuseColor.rgb * (1.0 + uCityWash * wash * 2.0);
    c *= mix(vec3(0.96, 0.99, 1.05), vec3(1.04, 1.0, 0.95), tint);
    if (!roof) {
      // Weathering streaks run down from the roof line, near only.
      float sfar = smoothstep(0.08, 0.3, fwidth(along));
      float s = cityNoise(vec2(along * 1.4 + seed * 50.0, h * 0.07));
      c *= 1.0 - uCityStreaks * smoothstep(0.55, 0.9, s) * (1.0 - sfar);
      // Shade at the foot (the street's contact shadow; buildings are sunk 3 m, so both the
      // part's own base and the street level count), sky light toward the top.
      float foot = min(smoothstep(0.0, 7.0, h), smoothstep(2.0, 9.0, vCityW.y));
      c *= mix(1.0 - uCityBase, 1.0, foot);
      c *= 1.0 + uCitySkyGrade * (smoothstep(0.0, 140.0, vCityW.y) * 2.0 - 0.6);
      // A painted cornice: a pale cap along the roof line over a soft shadow (fades far off).
      float top = vCityExt.y - h;
      float cfar = smoothstep(0.15, 0.6, fwidth(h));
      float cap = (1.0 - smoothstep(0.55, 0.75, top)) * (1.0 - cfar);
      float under = smoothstep(0.6, 0.9, top) * (1.0 - smoothstep(0.9, 2.2, top)) * (1.0 - cfar);
      c *= 1.0 + uCityEdgeLight * 1.2 * cap - 0.18 * under * step(4.0, vCityExt.y);
    } else {
      // Flat roofs: tar patches, near only.
      c *= 1.0 - 0.08 * smoothstep(0.6, 0.8, cityNoise(vCityW.xz / 2.3)) * (1.0 - smoothstep(0.3, 1.0, fwidth(vCityW.x)));
    }
    // Dry-brush edge: worn corners and rims catch a little light whatever the sun does.
    c *= 1.0 + uCityEdgeLight * cityEdge;
    diffuseColor.rgb = c;
  }
#endif
}`,
      )
      .replace(
        '#include <emissivemap_fragment>',
        /* glsl */ `#include <emissivemap_fragment>
totalEmissiveRadiance += cityEmit;
normal = normalize(normal + (viewMatrix * vec4(cityTilt, 0.0)).xyz);`,
      );
  };
  mat.customProgramCacheKey = () => (box ? 'city-building-box' : 'city-building');
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
 * pools of lamplight after dark. `aRoad` switches local streets off inside parks; `aEdge` (metres
 * from the seawall and from the river banks' tops) stops the grid at the bayside road and paints
 * the promenade, the road, the river walks and the stone embankments.
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
attribute vec2 aEdge;
varying float vRoad;
varying vec2 vEdge;
varying vec3 vGround;`,
      )
      .replace(
        '#include <project_vertex>',
        /* glsl */ `#include <project_vertex>
vGround = (modelMatrix * vec4(transformed, 1.0)).xyz;
vRoad = aRoad;
vEdge = aEdge;`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        /* glsl */ `#include <common>
uniform float uCityNight;
uniform float uCityLights;
varying float vRoad;
varying vec2 vEdge;
varying vec3 vGround;
#define PROM ${f(Config.city.promenade)}
#define BR ${f(Config.city.bayRoad)}
#define RIN ${f(city.roadIn)}
#define RW ${f(city.riverWalk)}
#define EWIN ${f(city.eastWestIn)}
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
  // East-west roads (nearly parallel to the shore) stop short of the bayside road, leaving a
  // green strip, instead of running alongside it as one wide band of asphalt.
  float ew = smoothstep(EWIN - aa, EWIN + aa, vEdge.x);
  float avZ = (1.0 - smoothstep(AH - aa, AH + aa, da.y)) * ew;
  float av = max(avX, avZ);
  float stX = (1.0 - smoothstep(SH - aa, SH + aa, ds.x)) * vRoad * (1.0 - av);
  float stZ = (1.0 - smoothstep(SH - aa, SH + aa, ds.y)) * vRoad * (1.0 - av) * ew;
  float st = max(stX, stZ);
  // Avenue sidewalks are the outer 4 m (outside the crossing); street sidewalks 2.5 m into the block.
  float walkX = avX * smoothstep(AH - 4.0 - aa, AH - 4.0 + aa, da.x) * (1.0 - avZ);
  float walkZ = avZ * smoothstep(AH - 4.0 - aa, AH - 4.0 + aa, da.y) * (1.0 - avX);
  float walkSt = max(1.0 - smoothstep(SH + 2.5 - aa, SH + 2.5 + aa, ds.x),
    (1.0 - smoothstep(SH + 2.5 - aa, SH + 2.5 + aa, ds.y)) * ew) * vRoad * (1.0 - av) * (1.0 - st);
  float walk = max(max(walkX, walkZ), walkSt);
  float road = max(av, st) * (1.0 - walk);
  // The waterfront: vEdge.x is metres inland of the seawall, vEdge.y metres back from the top of
  // a river bank. The grid stops at the bayside road (and leaves the river banks to its bridges).
  float sd = vEdge.x;
  float bd = vEdge.y;
  float grid = smoothstep(RIN - aa, RIN + aa, sd) * smoothstep(-aa, aa, bd);
  walk *= grid;
  road *= grid;
  float prom = smoothstep(-aa, aa, sd) * (1.0 - smoothstep(PROM - aa, PROM + aa, sd));
  float bay = smoothstep(PROM - aa, PROM + aa, sd) * (1.0 - smoothstep(RIN - aa, RIN + aa, sd));
  float kerb = smoothstep(RIN - aa, RIN + aa, sd) * (1.0 - smoothstep(RIN + 3.0 - aa, RIN + 3.0 + aa, sd)) * (1.0 - road);
  float rwalk = smoothstep(-aa, aa, bd) * (1.0 - smoothstep(RW - aa, RW + aa, bd)) * (1.0 - road) * (1.0 - bay);
  float embank = max(1.0 - smoothstep(-aa, aa, sd), 1.0 - smoothstep(-aa, aa, bd));
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
  // Each N-S avenue and street crosses the kerb on a zebra where it meets the bayside road.
  float zb = step(0.5, fract(p.x / 1.5)) * max(avX * (1.0 - avZ), stX) * step(RIN + 0.6, sd) * (1.0 - step(RIN + 4.4, sd));
  marks = max(marks, zb * lineFade);
  // The bayside road's lanes: a double centre line, dashed lane lines, solid edges.
  float bo = abs(sd - (PROM + BR * 0.5));
  float bayMarks = (1.0 - smoothstep(w, w + aa, abs(bo - 0.25)))
    + (1.0 - smoothstep(w, w + aa, abs(bo - BR * 0.25))) * dashX
    + (1.0 - smoothstep(w, w + aa, abs(bo - (BR * 0.5 - 0.5))));
  bayMarks = min(1.0, bayMarks) * bay * lineFade;
  // Promenade paving: 3 x 2.5 m flags, and a stone coping along the seawall.
  float sw = 0.06 + aa * 0.5;
  float seam = max(
    1.0 - smoothstep(sw, sw + aa, abs(fract(p.x / 3.0 + 0.5) - 0.5) * 3.0),
    1.0 - smoothstep(sw, sw + aa, abs(fract(sd / 2.5 + 0.5) - 0.5) * 2.5)) * lineFade;
  float coping = 1.0 - smoothstep(0.8 - aa, 0.8 + aa, sd);
  vec3 col = diffuseColor.rgb;
  col = mix(col, mix(${lin('#d3c7b5')}, ${lin('#b4aa9c')}, max(seam * 0.6, coping)), prom * dry);
  col = mix(col, ${lin('#d6ccba')}, rwalk * dry);
  col = mix(col, ${lin('#b9b2ad')}, max(walk, kerb) * dry);
  col = mix(col, ${lin('#5d5966')}, max(road, bay) * dry);
  col = mix(col, ${lin('#e8e2d6')}, max(marks * road, bayMarks) * dry * 0.85);
  // The seawall and the river embankments: dressed stone down to the water.
  col = mix(col, ${lin('#8f8983')}, embank * dry);
  diffuseColor.rgb = col;
  // Lamplight pools along the avenue sidewalks after dark.
  vec2 qx = vec2(da.x - (AH - 2.5), mod(p.y, 26.0) - 13.0);
  vec2 qz = vec2(da.y - (AH - 2.5), mod(p.x, 26.0) - 13.0);
  float pool = (exp(-dot(qx, qx) / 14.0) * avX * (1.0 - avZ) + exp(-dot(qz, qz) / 14.0) * avZ * (1.0 - avX)) * grid;
  // And under the promenade's lamps (every 24 m, 1.6 m in from the railing).
  vec2 qp = vec2(mod(p.x + 12.0, 24.0) - 12.0, sd - 2.6);
  pool += exp(-dot(qp, qp) / 12.0) * prom;
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

/**
 * The props' material (street furniture, rooftop clutter, boats, traffic): toon with vertex
 * colours over the instance tint. `aProp.x` glows (lamp heads, signals, signs, vending fronts:
 * faintly by day, HDR after dark so bloom picks them up); `aProp.yz` pulls a parapet's inner
 * wall in by a fixed 0.3 m against the instance's scale. Double-sided for the cable ribbons.
 */
export function createPropMaterial(u: CityUniforms): THREE.MeshToonMaterial {
  const mat = new THREE.MeshToonMaterial({
    vertexColors: true,
    gradientMap: getToonGradient(),
    side: THREE.DoubleSide,
  });
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, u);
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute vec3 aProp;\nvarying float vPropGlow;',
      )
      .replace(
        '#include <begin_vertex>',
        /* glsl */ `#include <begin_vertex>
vPropGlow = aProp.x;
#ifdef USE_INSTANCING
  vec2 pScale = vec2(length(instanceMatrix[0].xyz), length(instanceMatrix[2].xyz));
  transformed.xz += aProp.yz * 0.3 / max(pScale, vec2(0.5));
#endif`,
      );
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform float uCityNight;\nuniform float uCityLights;\nvarying float vPropGlow;',
      )
      .replace(
        '#include <emissivemap_fragment>',
        /* glsl */ `#include <emissivemap_fragment>
totalEmissiveRadiance += diffuseColor.rgb * vPropGlow * (0.12 + uCityNight * uCityLights * 2.4);`,
      );
  };
  mat.customProgramCacheKey = () => 'city-prop';
  return mat;
}
