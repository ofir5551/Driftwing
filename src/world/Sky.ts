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
varying vec3 vDir;

float hash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
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
    float m = smoothstep(prof + 0.0015, prof - 0.0015, hm) * step(0.0005, prof)
      * smoothstep(-uMountainFade, 0.0, hm);
    if (m > 0.0) {
      vec2 side = normalize(-uMountainDir * 0.6 + vec2(uMountainDir.y, -uMountainDir.x) * sign(da));
      float lit = 0.82 + 0.3 * dot(side, normalize(uSunDir.xz + 1e-5)) * smoothstep(-0.1, 0.1, uSunDir.y);
      vec3 rock = mix(uTop, uFog, 0.5) * 0.8 * lit;
      float snowLine = 0.2 * (0.62 + 0.06 * sin(da * 41.0) + 0.04 * sin(da * 97.0));
      float bright = clamp(dot(uFog, vec3(0.4)) * 1.5, 0.3, 1.0);
      vec3 snow = mix(uHorizon, vec3(1.0), 0.5) * bright * lit;
      vec3 mc = mix(rock, snow, smoothstep(snowLine - 0.002, snowLine + 0.002, hm));
      mc = mix(mc, uFog, mix(0.55, 0.12, smoothstep(0.0, 0.12, hm)));
      col = mix(col, mc, m);
      peak = m;
    }
    // From altitude the plain between the world's fogged edge and the far foot isn't drawn, and
    // the sky there (skyBottom) doesn't match the fog, so the world's edge showed as a seam and
    // the foot as a straight line floating on a band. Paint it as the haze it would be, and the
    // higher the camera, the thicker the mist bank along the foot, so the mountain rises out of
    // it. Near the ground (foot at the horizon) this is all hidden behind the city.
    float lift = clamp(-uMountainBase * 25.0, 0.0, 1.0);
    float mist = max(smoothstep(0.0, -uMountainFade, hm), exp(-max(hm, 0.0) * 28.0) * 0.75 * lift);
    col = mix(col, uFog, mist);
    peak *= 1.0 - mist;
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

export class Sky {
  readonly mesh: THREE.Mesh;
  /** Paint the distant volcano (the city level). */
  mountain = false;
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
    this.u.uMountain.value = this.mountain ? 1 : 0;
    // Elevation (as the sine the shader compares against) of a foot at sea level that far away.
    const drop = Config.world.waterLevel - camera.position.y;
    this.u.uMountainBase.value = drop / Math.hypot(drop, Config.city.mountainDistance);
    this.u.uMountainFade.value = Config.city.mountainFootFade;
    this.mesh.position.copy(camera.position);
  }
}
