import * as THREE from 'three';
import { Config } from '../../core/Config';

/**
 * Aurora Fjords' ground, painted per pixel. The walls are a height field on a 4 m lattice that
 * climbs 150-250 m in a 150 m run, so any relief built from vertices turns to sawteeth and
 * stretched stripes; here the cliffs' relief lives in the shader instead, in the wall's own
 * plane (its horizontal tangent by height, so it never streaks): long couloirs down the face,
 * blocky slabs that catch the light as facets, meltwater stains hanging from the ledges and a
 * dark tide band at the water. Snow lies per pixel from the vertices' snow climate: on the
 * flat above a ragged snowline and in the snowfields, and on a cliff only on its ledges (where
 * the tilted normal turns up). The strand gets a pebble beach, a wet band and broken foam at
 * the water, the villages' gravel streets and the spray-wet ground round the waterfalls.
 *
 * The rock's normal replaces GroundDetail's bump on the cliffs: its wall term was projected on
 * one diagonal plane and drew long horizontal stripes on walls facing along it (45°/225°).
 * Needs `withGroundDetail` applied first (it reuses its varyings and noise). Terrain only: it
 * reads the chunk's `aLand` (FjordLayout.landAt: bank, street, waterfall, snow).
 */
const K = Config.fjord;

const uniforms = {
  uRockRelief: {
    get value() {
      return K.rockRelief;
    },
  },
  uRockFar: {
    get value() {
      return K.rockFar;
    },
  },
  uRockLight: { value: new THREE.Color('#8f949c') },
  uRockDark: { value: new THREE.Color('#4b505a') },
  uRockWarm: { value: new THREE.Color('#7a6f66') },
  uSnowLit: { value: new THREE.Color('#f3f6fb') },
  uSnowShade: { value: new THREE.Color('#bccbe2') },
};

const PARS = /* glsl */ `
uniform float uRockRelief;
uniform float uRockFar;
uniform vec3 uRockLight;
uniform vec3 uRockDark;
uniform vec3 uRockWarm;
uniform vec3 uSnowLit;
uniform vec3 uSnowShade;
varying vec4 vLand;
// Relief of a cliff at distance al along its face and height y (metres of bulge, roughly):
// couloirs (vertical gullies wandering a little as they descend, ~45 m apart), blocky slabs
// (domain-warped value noise in plates with a soft riser between) and fine grain.
float fjGully(float al, float y) {
  float w = gNoise(vec2(al * 0.021, y * 0.009)) * 6.0;
  return smoothstep(0.25, 1.0, sin(al * 0.14 + w));
}
float fjRelief(float al, float y, float low) {
  vec2 q = vec2(al * 0.055, y * 0.085);
  q += (vec2(gNoise(q * 0.6 + 3.1), gNoise(q * 0.6 + 7.7)) - 0.5) * 1.6;
  float sl = gNoise(q) * 4.0;
  float plate = (floor(sl) + smoothstep(0.45, 1.0, fract(sl))) * 0.25;
  return -fjGully(al, y) * 1.4 + plate * 0.9 * low + 0.3 * gNoise(vec2(al * 0.45, y * 0.3));
}`;

/** Colour pass: after GroundDetail's paint (anchored before alphamap_fragment). */
const COLOR = /* glsl */ `
vec3 fN = normalize(vGNrm);
float fDist = distance(vGPos, cameraPosition);
float fNear = 1.0 - smoothstep(uRockFar * 0.45, uRockFar, fDist);
float fN1 = gNoise(vGPos.xz * 0.09);
float fN2 = gNoise(vGPos.xz * 0.43 + 3.7);
// Cliff or turf: interpolated normals across 4 m triangles would draw the lattice's zigzags at
// a sharp threshold, so a wide ramp broken by noise makes the edge ragged instead.
float fEdge = (1.0 - fN.y) + 0.22 * (fN1 - 0.5) + 0.12 * (fN2 - 0.5);
float fRock = smoothstep(0.24, 0.5, fEdge) * smoothstep(0.6, 2.5, vGPos.y + 2.0 * fN2);
vec3 fWN = fN;
float fBank = vLand.x;
if (fRock > 0.0) {
  vec2 tg = normalize(vec2(-fN.z, fN.x) + 1e-5);
  float al = dot(vGPos.xz, tg);
  float y = vGPos.y;
  // Slabs fade out in the bottom 15 m (blocks at the waterline read as masonry).
  float low = smoothstep(4.0, 18.0, y);
  float r0 = fjRelief(al, y, low);
  if (fNear > 0.0) {
    float dA = (fjRelief(al + 0.9, y, low) - r0) / 0.9;
    float dY = (fjRelief(al, y + 0.9, low) - r0) / 0.9;
    vec3 upFace = normalize(vec3(0.0, 1.0, 0.0) - fN * fN.y);
    fWN = normalize(fN - (vec3(tg.x, 0.0, tg.y) * dA + upFace * dY) * 0.9 * uRockRelief * fNear);
  }
  float gully = fjGully(al, y);
  // Grey gneiss in lighter and darker plates, warmer where it weathers, darker in the gullies.
  float tone = gNoise(vec2(al * 0.012, y * 0.02)) * 0.6 + gNoise(vec2(al * 0.05, y * 0.04)) * 0.4;
  tone += (gNoise(vec2(al * 0.004, y * 0.005) + 5.0) - 0.5) * 0.8;
  // Pale water-washed streaks down the face.
  tone += 0.35 * smoothstep(0.6, 0.9, gNoise(vec2(al * 0.09, y * 0.006 + 2.0)));
  vec3 rc = mix(uRockDark, uRockLight, clamp(tone * 0.95 + r0 * 0.1 + 0.05, 0.0, 1.0));
  rc = mix(rc, uRockWarm, smoothstep(0.55, 0.9, gNoise(vec2(al * 0.008, y * 0.006) + 11.0)) * 0.5);
  rc *= 1.0 - 0.22 * gully;
  // Meltwater stains: dark streaks hanging down the face from the ledges, thinning downward.
  float st = gNoise(vec2(al * 0.32, y * 0.011 + 4.0)) * 0.7 + gNoise(vec2(al * 1.1, y * 0.035)) * 0.3;
  st = smoothstep(0.55, 0.85, st) * (0.6 + 0.4 * smoothstep(0.3, 0.8, gNoise(vec2(al * 0.05, y * 0.05))));
  rc = mix(rc, vec3(0.16, 0.17, 0.19), st * 0.55);
  // The tide band: black lichen and wet rock just above the water.
  rc *= 1.0 - 0.45 * (1.0 - smoothstep(0.4, 3.5 + 1.5 * fN1, y));
  // Turf, moss and birch scrub cling to the gentler steps and ledges below the treeline, in
  // patches and along the ledges: the green-banded walls of a western fjord.
  float ledge = smoothstep(0.12, 0.45, fWN.y) * smoothstep(0.5, 0.72, gNoise(vec2(al * 0.025, y * 0.11) + 2.0) + 0.2 * fN1);
  vec3 turf = mix(vec3(0.29, 0.36, 0.2), vec3(0.42, 0.4, 0.22), gNoise(vec2(al * 0.05, y * 0.05)));
  rc = mix(rc, turf, ledge * (1.0 - smoothstep(60.0, 120.0, y + 20.0 * fN2)) * 0.85);
  // Far off the paint calms to the rock's mean (no shimmer).
  rc = mix(mix(uRockDark, uRockLight, 0.55), rc, 0.35 + 0.65 * fNear);
  diffuseColor.rgb = mix(diffuseColor.rgb, rc, fRock);
}
{
  float gentle = 1.0 - fRock;
  // The water's edge: a wet band and broken foam where the sea laps.
  float wy = vGPos.y + 0.12 * sin(vGPos.x * 0.21 + vGPos.z * 0.17) + 0.18 * (fN1 - 0.5);
  diffuseColor.rgb *= 1.0 - 0.3 * (1.0 - smoothstep(0.1, 0.9, wy)) * step(-0.5, wy);
  float foam = (1.0 - smoothstep(0.0, 0.16, abs(wy - 0.06))) * smoothstep(0.35, 0.6, fN2);
  // Pebble beach above it: rounded stones in greys, darker in the gaps, smaller toward the water.
  float beach = (1.0 - smoothstep(3.5, 8.0, fBank + 5.0 * (fN1 - 0.5))) * gentle * step(-0.6, vGPos.y);
  if (beach > 0.0 && fNear > 0.0) {
    vec2 pp = vGPos.xz * (1.1 + 0.5 * smoothstep(4.0, 0.0, fBank));
    vec2 pc = floor(pp);
    vec2 pf = fract(pp) - 0.5 - (vec2(gHash(pc), gHash(pc + 7.1)) - 0.5) * 0.4;
    float pd = length(pf * vec2(1.0, 1.0 + 0.4 * gHash(pc + 3.3)));
    float stone = 1.0 - smoothstep(0.3, 0.42, pd);
    vec3 pcol = mix(vec3(0.42, 0.42, 0.43), vec3(0.72, 0.71, 0.68), gHash(pc + 1.7));
    pcol *= 0.85 + 0.25 * (1.0 - pd);
    vec3 pb = mix(vec3(0.2, 0.2, 0.21), pcol, stone);
    diffuseColor.rgb = mix(diffuseColor.rgb, pb, beach * fNear * 0.85);
  }
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.9, 0.94, 0.96), foam * 0.75);
  // A village's gravel street and its lanes down to the jetties: a track with two ruts.
  float street = (1.0 - smoothstep(0.75, 1.15, vLand.y + 0.3 * (fN2 - 0.5))) * gentle;
  if (street > 0.0) {
    float rut = smoothstep(0.18, 0.0, abs(vLand.y - 0.45)) * (0.6 + 0.4 * fN2);
    vec3 sc = vec3(0.5, 0.48, 0.43) * (1.0 - 0.18 * rut) * (0.94 + 0.12 * fN2);
    diffuseColor.rgb = mix(diffuseColor.rgb, sc, street * 0.9);
  }
  // Round a waterfall: dark wet rock in its spray, lush moss on the strand beside the stream.
  float wet = 1.0 - smoothstep(0.35, 1.0, vLand.z + 0.3 * (fN1 - 0.5));
  diffuseColor.rgb *= 1.0 - 0.35 * wet * fRock;
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.2, 0.36, 0.16), wet * gentle * 0.6);
}
// Snow: on the flat above the ragged snowline and in the snowfields; on a cliff only where its
// tilted normal turns up into a ledge. A little blue in the shade of its own relief.
float fSnow = 0.0;
{
  float rag = gNoise(vGPos.xz * 0.045) * 0.6 + gNoise(vGPos.xz * 0.19 + 9.0) * 0.4;
  float lie = smoothstep(0.62, 0.9, fWN.y);
  fSnow = smoothstep(0.44, 0.56, vLand.w * (0.35 + 0.85 * lie) + (rag - 0.5) * 0.45);
  vec3 snc = mix(uSnowShade, uSnowLit, smoothstep(0.55, 0.95, fWN.y));
  // Wind-carved ripples on the snowfields.
  snc *= 1.0 - 0.035 * smoothstep(0.5, 1.0, sin(dot(vGPos.xz, vec2(0.62, 0.78)) * 0.8 + fN1 * 5.0)) * fNear;
  diffuseColor.rgb = mix(diffuseColor.rgb, snc, fSnow);
}`;

/** Normal pass: after GroundDetail's bump (anchored before emissivemap_fragment). */
const NORMAL = /* glsl */ `
if (fRock > 0.0 && fNear > 0.0) {
  normal = normalize(mix(normal, (viewMatrix * vec4(fWN, 0.0)).xyz, fRock));
}`;

/** The fjord terrain's ground and rock paint (see the file comment). Returns the material. */
export function withFjordRock<T extends THREE.Material>(m: T): T {
  const prev = m.onBeforeCompile.bind(m);
  const prevKey = m.customProgramCacheKey.bind(m);
  m.onBeforeCompile = (shader, renderer) => {
    prev(shader, renderer);
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec4 aLand;\nvarying vec4 vLand;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLand = aLand;');
    // After GroundDetail's pars (gNoise, gHash and the world-position varyings).
    shader.fragmentShader = shader.fragmentShader
      .replace('float gBumpAt(', `${PARS}\nfloat gBumpAt(`)
      .replace('#include <alphamap_fragment>', `${COLOR}\n#include <alphamap_fragment>`)
      .replace('#include <emissivemap_fragment>', `${NORMAL}\n#include <emissivemap_fragment>`);
  };
  m.customProgramCacheKey = () => `${prevKey()}|fjord-rock`;
  return m;
}
