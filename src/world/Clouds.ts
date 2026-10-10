import * as THREE from 'three';
import { Config } from '../core/Config';
import type { DayCycle } from './DayCycle';
import { mulberry32 } from './noise';

const PUFFS_PER_CLOUD = 7;
const WHITE = new THREE.Color(1, 1, 1);

// Billboarded puffs. Wrapping around the player and wind drift happen entirely in the vertex
// shader (toroidal domain centred on uOrigin), so the CPU never touches cloud instances.
const vert = /* glsl */ `
uniform vec3 uOrigin;
uniform float uTime;
uniform float uDomain;
uniform vec2 uWind;
varying vec2 vUv;
varying float vFade;
varying float vShade;
void main() {
  vUv = uv;
  vec3 base = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  float scale = length(instanceMatrix[0].xyz);
  vec2 rel = base.xz + uWind * uTime - uOrigin.xz;
  rel = mod(rel + 0.5 * uDomain, uDomain) - 0.5 * uDomain;
  vec3 center = vec3(uOrigin.x + rel.x, base.y, uOrigin.z + rel.y);
  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  vec3 wp = center + (right * position.x + up * position.y * 0.62) * scale;
  vec4 mv = viewMatrix * vec4(wp, 1.0);
  gl_Position = projectionMatrix * mv;
  float dist = -mv.z;
  // Fade at the domain edge (no popping on wrap) and when the camera is inside a puff.
  float edge = 1.0 - smoothstep(0.32, 0.5, max(abs(rel.x), abs(rel.y)) / uDomain);
  float near = smoothstep(scale * 0.25, scale * 1.1, dist);
  vFade = edge * near;
  vShade = clamp((position.y + 0.5), 0.0, 1.0);
}`;

const frag = /* glsl */ `
uniform vec3 uLit;
uniform vec3 uShadow;
uniform float uOpacity;
varying vec2 vUv;
varying float vFade;
varying float vShade;
void main() {
  vec2 c = vUv - 0.5;
  float r = length(c);
  // Lumpy edge: angular wobble makes each puff read as a brushed blob, not a perfect disc.
  float a = atan(c.y, c.x);
  float wob = 0.04 * sin(a * 5.0 + vUv.x * 3.0) + 0.03 * sin(a * 9.0);
  float alpha = smoothstep(0.5, 0.05, r + wob) * vFade * uOpacity;
  if (alpha < 0.01) discard;
  vec3 col = mix(uShadow, uLit, smoothstep(0.1, 0.85, vShade));
  gl_FragColor = vec4(col, alpha);
  #include <colorspace_fragment>
}`;

export class Clouds {
  readonly mesh: THREE.InstancedMesh;
  private readonly u: Record<string, THREE.IUniform>;

  constructor(seed: number, maxClouds = 60) {
    const rand = mulberry32(seed + 99);
    const count = maxClouds * PUFFS_PER_CLOUD;
    this.u = {
      uOrigin: { value: new THREE.Vector3() },
      uTime: { value: 0 },
      uDomain: { value: 2000 },
      uWind: { value: new THREE.Vector2(1, 0.4) },
      uLit: { value: new THREE.Color() },
      uShadow: { value: new THREE.Color() },
      uOpacity: { value: 0.75 },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.u,
      vertexShader: vert,
      fragmentShader: frag,
      transparent: true,
      depthWrite: false,
    });
    this.mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), mat, count);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    const m = new THREE.Matrix4();
    let k = 0;
    // Cloud bases spread over a unit domain; scaled to the real domain in update via uDomain.
    for (let c = 0; c < maxClouds; c++) {
      const cx = (rand() - 0.5) * 2000;
      const cz = (rand() - 0.5) * 2000;
      // Most clouds float high; some sit low enough that the bird can glide through them.
      const cy = rand() < 0.3 ? 70 + rand() * 60 : 150 + rand() * 120;
      const size = 45 + rand() * 50;
      for (let p = 0; p < PUFFS_PER_CLOUD; p++) {
        const s = size * (0.55 + rand() * 0.6) * (p === 0 ? 1.3 : 1);
        const ox = (rand() - 0.5) * size * 2.2;
        const oz = (rand() - 0.5) * size * 1.2;
        const oy = (rand() - 0.3) * size * 0.35;
        m.makeScale(s, s, s).setPosition(cx + ox, cy + oy, cz + oz);
        this.mesh.setMatrixAt(k++, m);
      }
    }
  }

  update(day: DayCycle, origin: THREE.Vector3, time: number): void {
    const p = day.palette;
    this.u.uOrigin.value.copy(origin);
    this.u.uTime.value = time;
    this.u.uDomain.value = Config.render.drawDistance * 1.9;
    const w = Config.world.cloudDrift;
    this.u.uWind.value.set(w, w * 0.4);
    // Lit tops pick up the sun colour; undersides lean toward the sky's lower tones.
    // Lit tops: the horizon colour pushed toward the sun; undersides lean to the upper sky.
    // Brightness follows the sun so clouds dim with the light instead of glowing at night.
    const b = Math.min(1, 0.45 + p.sunIntensity * 0.35);
    this.u.uLit.value.copy(p.skyHorizon).lerp(p.sun, 0.35).lerp(WHITE, 0.35).multiplyScalar(b);
    this.u.uShadow.value
      .copy(p.skyTop)
      .lerp(p.hemiGround, 0.35)
      .lerp(p.skyHorizon, 0.3)
      .multiplyScalar(b);
    this.mesh.count =
      Math.min(Config.render.clouds, this.mesh.instanceMatrix.count / PUFFS_PER_CLOUD) *
      PUFFS_PER_CLOUD;
  }
}
