import * as THREE from 'three';
import { Config } from '../core/Config';
import type { DayCycle } from './DayCycle';

const vert = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = normalize((modelMatrix * vec4(position, 0.0)).xyz);
  vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_Position = p;
  gl_Position.z = p.w * 0.9999; // pin just inside the far plane, whatever the dome radius
}`;

const frag = /* glsl */ `
uniform vec3 uTop;
uniform vec3 uHorizon;
uniform vec3 uBottom;
uniform vec3 uFog;
uniform vec3 uSun;
uniform vec3 uSunDir;
uniform float uStars;
uniform float uTime;
uniform float uMountain;
uniform vec2 uMountainDir;
uniform float uMountainBase;
uniform float uMountainFade;
uniform float uRidges;
uniform float uRidgeBase;
uniform vec3 uInk;
uniform float uAurora;
uniform float uHills;
uniform float uHillsBase;
uniform float uMesas;
uniform float uMesasBase;
uniform vec3 uMesaInk;
varying vec3 vDir;

float hash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

float hash1(float x) { return fract(sin(x * 127.1 + 11.7) * 43758.5453); }

// A ring of karst peaks around the horizon: n cells of azimuth, each holding one steep-sided,
// round-topped peak of random width and a height that is usually low and now and then towers
// (so the skyline never reads as an even wall). Periodic in azimuth.
float ridge(float az, float n, float seed) {
  float x = (az / 6.2831853 + 0.5) * n;
  float c = floor(x);
  float h = 0.0;
  for (int k = -1; k <= 1; k++) {
    float cc = c + float(k);
    float id = mod(cc, n) + seed;
    float centre = cc + 0.5 + (hash1(id) - 0.5) * 0.7;
    float w = 0.25 + 0.4 * hash1(id + 7.3);
    float q = (x - centre) / w;
    float dome = sqrt(max(1.0 - q * q, 0.0));
    float tall = hash1(id + 3.1);
    h = max(h, dome * (0.2 + 0.8 * tall * tall));
  }
  return h;
}

// A ring of mesas and buttes around the horizon: n cells of azimuth, most holding one
// flat-topped table on sheer walls over a talus skirt (a narrow butte or a long mesa), some
// left empty as open desert. Periodic in azimuth.
float mesa(float az, float n, float seed) {
  float x = (az / 6.2831853 + 0.5) * n;
  float c = floor(x);
  float h = 0.0;
  for (int k = -1; k <= 1; k++) {
    float cc = c + float(k);
    float id = mod(cc, n) + seed;
    if (hash1(id + 5.7) < 0.3) continue;
    float centre = cc + 0.5 + (hash1(id) - 0.5) * 0.4;
    float wide = hash1(id + 7.3);
    float w = 0.08 + 0.34 * wide * wide;
    float q = abs(x - centre) / w;
    // Narrow buttes stand taller than the long tables, so the skyline never reads as a wall.
    float top = (0.3 + 0.5 * hash1(id + 3.1)) * (1.0 + 0.7 * (1.0 - wide));
    float wall = 1.0 - smoothstep(0.75, 1.0, q);
    float skirt = 1.0 - smoothstep(0.85, 1.7 + wide, q);
    h = max(h, max(wall * top, skirt * top * 0.5));
  }
  return h;
}

void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 col = mix(uHorizon, uTop, pow(smoothstep(0.0, 1.0, h), 0.55));
  col = mix(col, uBottom, smoothstep(0.0, -0.3, h));
  // Haze: melt the horizon into the fog colour so distant terrain dissolves into the sky.
  col = mix(col, uFog, exp(-abs(h) * 9.0) * 0.75);


  // A distant volcano (the city's Fuji) painted into the dome: a concave cone with a flat
  // crater, snow streaking down from the top, lit on the sun side and sunk into the haze.
  // Heights are measured from its foot (uMountainBase, which drops as the camera climbs), and
  // below the foot it dissolves into the haze instead of filling the whole sector down to the
  // nadir: from altitude the ground no longer hides that, and it showed as a flat-sided slab.
  float peak = 0.0;
  if (uMountain > 0.5) {
    vec2 dh = normalize(d.xz + 1e-5);
    float da = atan(uMountainDir.x * dh.y - uMountainDir.y * dh.x, dot(uMountainDir, dh));
    float prof = pow(max(1.0 - abs(da) / 0.55, 0.0), 1.9) * 0.24;
    prof = min(prof, 0.205);
    float hm = h - uMountainBase;
    // Only above the foot, and it fades in over a soft band rather than starting at full
    // strength: a hard start drew a flat shelf along the foot with vertical cut-offs at the
    // cone's ends. The low flanks now thin out into the mist bank instead.
    float m = smoothstep(prof + 0.0015, prof - 0.0015, hm) * smoothstep(0.0, uMountainFade, hm);
    if (m > 0.0) {
      vec2 side = normalize(-uMountainDir * 0.6 + vec2(uMountainDir.y, -uMountainDir.x) * sign(da));
      float lit = 0.82 + 0.3 * dot(side, normalize(uSunDir.xz + 1e-5)) * smoothstep(-0.1, 0.1, uSunDir.y);
      vec3 rock = mix(uTop, uFog, 0.5) * 0.8 * lit;
      float snowLine = 0.2 * (0.62 + 0.06 * sin(da * 41.0) + 0.04 * sin(da * 97.0));
      float bright = clamp(dot(uFog, vec3(0.4)) * 1.5, 0.3, 1.0);
      vec3 snow = mix(uHorizon, vec3(1.0), 0.5) * bright * lit;
      vec3 mc = mix(rock, snow, smoothstep(snowLine - 0.002, snowLine + 0.002, hm));
      mc = mix(mc, uFog, mix(0.75, 0.12, smoothstep(0.0, 0.14, hm)));
      col = mix(col, mc, m);
      peak = m;
    }
    // From altitude the plain between the world's fogged edge and the far foot isn't drawn, and
    // the sky there (skyBottom) doesn't match the fog, so the world's edge showed as a seam and
    // the foot as a straight line floating on a band. Paint it as the haze it would be, and the
    // higher the camera, the thicker the mist bank along the foot, so the mountain rises out of
    // it. Near the ground (foot at the horizon) this is all hidden behind the city.
    float lift = clamp(-uMountainBase * 25.0, 0.0, 1.0);
    float mist = max(smoothstep(0.0, -uMountainFade, hm), exp(-max(hm, 0.0) * 20.0) * 0.85 * lift);
    col = mix(col, uFog, mist);
    peak *= 1.0 - mist;
  }

  // Jade River: layers of karst hills painted round the horizon, far to near, each a deeper
  // wash of ink with mist pooled at its foot, like the receding planes of a scroll painting.
  if (uRidges > 0.5) {
    float az = atan(d.x, d.z);
    float hm = h - uRidgeBase;
    for (int i = 0; i < 3; i++) {
      float fi = float(i);
      // ~2-3 deg wide and up to ~4-6 deg tall: peaks, taller than they are wide.
      float amp = 0.045 + 0.02 * fi;
      float top = ridge(az + fi * 1.9, 64.0 - fi * 14.0, fi * 17.0) * amp;
      float m = smoothstep(top + 0.0015, top - 0.0015, hm);
      if (m <= 0.0) continue;
      vec3 ink = mix(uFog, uInk, 0.16 + 0.15 * fi);
      ink = mix(ink, uFog, (1.0 - smoothstep(-0.004, amp * 0.75, hm)) * 0.8);
      col = mix(col, ink, m);
      peak = max(peak, m);
    }
    // Below the foot (from altitude) the haze carries on down to the world's edge.
    col = mix(col, uFog, smoothstep(0.0, -0.03, hm) * 0.85);
  }

  // City of Gold: the Judean hills rolling away in three washes, low and long and rounded
  // (whole-number azimuth waves, so they close round the sky), paler toward the east (-x),
  // where the land falls to the desert.
  if (uHills > 0.5) {
    float az = atan(d.x, d.z);
    float hm = h - uHillsBase;
    for (int i = 0; i < 3; i++) {
      float fi = float(i);
      float w = 1.0 + 0.55 * sin(az * (3.0 + fi) + fi * 1.7) + 0.35 * sin(az * (7.0 + 2.0 * fi) - fi * 0.9)
        + 0.18 * sin(az * (17.0 + 3.0 * fi) + fi * 2.3);
      float east = 0.5 + 0.5 * sin(az);
      float top = max(w, 0.08) * (0.011 + 0.007 * fi) * (1.0 - 0.35 * east);
      float m = smoothstep(top + 0.0015, top - 0.0015, hm);
      if (m <= 0.0) continue;
      vec3 ink = mix(uFog, uInk, (0.09 + 0.1 * fi) * (1.0 - 0.4 * east));
      ink = mix(ink, uFog, (1.0 - smoothstep(-0.004, top * 0.8, hm)) * 0.7);
      col = mix(col, ink, m);
      peak = max(peak, m);
    }
    col = mix(col, uFog, smoothstep(0.0, -0.03, hm) * 0.85);
  }

  // Red Canyons: mesas and buttes on the horizon in three washes, far to near, each a deeper
  // wash of the red rock's shade with faint level strata, dissolving into the dust at the foot.
  if (uMesas > 0.5) {
    float az = atan(d.x, d.z);
    float hm = h - uMesasBase;
    for (int i = 0; i < 3; i++) {
      float fi = float(i);
      float amp = 0.024 + 0.012 * fi;
      float top = mesa(az + fi * 2.3, 30.0 - fi * 7.0, fi * 13.0) * amp;
      float m = smoothstep(top + 0.0012, top - 0.0012, hm);
      if (m <= 0.0) continue;
      vec3 ink = mix(uFog, uMesaInk, 0.2 + 0.17 * fi);
      ink *= 0.97 + 0.05 * step(0.5, fract(hm * 160.0 + fi * 0.3));
      ink = mix(ink, uFog, (1.0 - smoothstep(-0.004, amp * 0.6, hm)) * 0.6);
      col = mix(col, ink, m);
      peak = max(peak, m);
    }
    col = mix(col, uFog, smoothstep(0.0, -0.03, hm) * 0.85);
  }

  // Aurora Fjords: three curtains of light hung across the sky. Each has a sharp, wandering
  // lower hem and fades upward from green to violet, is combed into fine vertical rays that
  // shimmer, and swells and thins along its length. Drifts slowly; bloom halos the brightest.
  // Every azimuth frequency is a whole number, so the curtains close round the sky seamlessly.
  if (uAurora > 0.0 && h > 0.0) {
    float az = atan(d.x, d.z);
    vec3 glow = vec3(0.0);
    for (int i = 0; i < 3; i++) {
      float fi = float(i);
      float t = uTime * (0.03 + 0.012 * fi);
      // The hem folds back and forth (a sum of incommensurate waves), so the curtain hangs in
      // pleats instead of a flat band.
      float fold = sin(az * 3.0 + fi * 2.1 + t) + 0.6 * sin(az * 7.0 - fi * 1.3 - t * 1.7)
        + 0.35 * sin(az * 13.0 + fi * 4.0 + t * 2.3);
      float hem = 0.2 + 0.09 * fi + 0.035 * fold;
      float y = h - hem;
      float v = smoothstep(-0.01, 0.004, y) * (0.35 + 0.65 * exp(-max(y, 0.0) * 22.0))
        * exp(-max(y, 0.0) * (4.0 + 2.0 * fi));
      // Rays: two beating combs of different pitch, bent by the folds, so they bunch and thin.
      float bend = fold * 2.0 + az * 61.0 + fi * 5.0;
      float rays = 0.35 + 0.65 * (0.5 + 0.5 * sin(bend * 1.7)) * (0.5 + 0.5 * sin(az * 23.0 - t * 3.0 + fi));
      float swell = smoothstep(0.35, 0.9, 0.5 + 0.5 * sin(az * 2.0 + fi * 2.7 - t * 0.7));
      vec3 c = mix(vec3(0.25, 1.35, 0.7), vec3(0.65, 0.28, 1.0), smoothstep(0.02, 0.2, y));
      glow += c * v * rays * swell * (1.0 - 0.25 * fi);
    }
    col += glow * uAurora * smoothstep(0.0, 0.06, h) * (1.0 - peak);
  }

  // Faint stars, only above the horizon haze; twinkle slowly.
  if (uStars > 0.0 && h > 0.02 && peak < 0.5) {
    vec3 cell = floor(d * 220.0);
    float r = hash(cell);
    float star = step(0.9965, r) * (0.5 + 0.5 * sin(uTime * (1.0 + r * 3.0) + r * 40.0));
    vec3 f = fract(d * 220.0) - 0.5;
    star *= smoothstep(0.35, 0.0, length(f));
    col += vec3(1.0, 0.96, 0.9) * star * uStars * smoothstep(0.02, 0.3, h) * 0.85;
  }
  // Soft sun: a small disc plus two wide glows. Kept gentle so bloom does the rest. The disc
  // sets behind the mountain; the glow still spills over its shoulder.
  float s = max(dot(d, uSunDir), 0.0);
  float vis = smoothstep(-0.15, 0.05, uSunDir.y);
  col += uSun * (smoothstep(0.9985, 0.9993, s) * 0.9 * (1.0 - peak) + pow(s, 40.0) * 0.35 + pow(s, 5.0) * 0.15) * vis;

  // Tiny dither to stop gradient banding on 8-bit displays.
  col += (hash(vec3(gl_FragCoord.xy, uTime)) - 0.5) / 255.0;
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}`;

/**
 * What a level paints into the sky beyond its world: nothing, Fuji, karst ridges, the aurora,
 * rolling hills, or desert mesas.
 */
export type Backdrop = 'none' | 'fuji' | 'karst' | 'aurora' | 'hills' | 'mesas';

export class Sky {
  readonly mesh: THREE.Mesh;
  backdrop: Backdrop = 'none';
  private readonly u: Record<string, THREE.IUniform>;

  constructor() {
    this.u = {
      uTop: { value: new THREE.Color() },
      uHorizon: { value: new THREE.Color() },
      uBottom: { value: new THREE.Color() },
      uFog: { value: new THREE.Color() },
      uSun: { value: new THREE.Color() },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uStars: { value: 0 },
      uTime: { value: 0 },
      uMountain: { value: 0 },
      // Ahead and to the right of the spawn, beside where the sun sets at dusk.
      uMountainDir: { value: new THREE.Vector2(0.5, -0.87).normalize() },
      uMountainBase: { value: 0 },
      uMountainFade: { value: 0.05 },
      uRidges: { value: 0 },
      uRidgeBase: { value: 0 },
      uInk: { value: new THREE.Color() },
      uAurora: { value: 0 },
      uHills: { value: 0 },
      uHillsBase: { value: 0 },
      uMesas: { value: 0 },
      uMesasBase: { value: 0 },
      uMesaInk: { value: new THREE.Color() },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.u,
      vertexShader: vert,
      fragmentShader: frag,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: false,
      fog: false,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 16), mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = -1;
    this.mesh.scale.setScalar(1000);
  }

  update(day: DayCycle, camera: THREE.Camera, time: number): void {
    const p = day.palette;
    this.u.uTop.value.copy(p.skyTop);
    this.u.uHorizon.value.copy(p.skyHorizon);
    this.u.uBottom.value.copy(p.skyBottom);
    this.u.uFog.value.copy(p.fog);
    this.u.uSun.value.copy(p.sun);
    this.u.uSunDir.value.copy(day.sunDir);
    this.u.uStars.value = p.stars;
    this.u.uTime.value = time;
    this.u.uMountain.value = this.backdrop === 'fuji' ? 1 : 0;
    this.u.uRidges.value = this.backdrop === 'karst' ? 1 : 0;
    this.u.uHills.value = this.backdrop === 'hills' ? 1 : 0;
    this.u.uMesas.value = this.backdrop === 'mesas' ? 1 : 0;
    // The aurora comes out with the stars.
    this.u.uAurora.value =
      this.backdrop === 'aurora' ? Math.max(0, (p.stars - 0.25) / 0.75) * Config.fjord.aurora : 0;
    // Elevation (as the sine the shader compares against) of a foot at sea level that far away.
    const drop = Config.world.waterLevel - camera.position.y;
    this.u.uMountainBase.value = drop / Math.hypot(drop, Config.city.mountainDistance);
    this.u.uRidgeBase.value = drop / Math.hypot(drop, Config.karst.ridgeDistance);
    this.u.uHillsBase.value = drop / Math.hypot(drop, Config.jerusalem.hillsDistance);
    this.u.uMesasBase.value = drop / Math.hypot(drop, Config.canyon.mesasDistance);
    // Ink: the upper sky deepened toward the ground light, so ridges darken with the day.
    this.u.uInk.value.copy(p.skyTop).lerp(p.hemiGround, 0.55).multiplyScalar(0.8);
    // Mesa shade: the ground light (red rock bounce by day) deepened toward the sky's top.
    this.u.uMesaInk.value.copy(p.hemiGround).lerp(p.skyTop, 0.25).multiplyScalar(0.85);
    this.u.uMountainFade.value = Config.city.mountainFootFade;
    this.mesh.position.copy(camera.position);
  }
}
