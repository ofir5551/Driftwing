import * as THREE from 'three';
import { Config } from '../core/Config';
import { clamp } from '../core/math';

// A destination's column of light. The far plane follows the draw distance (under 1 km on low
// quality) and a destination can be 4 km off, so the vertex shader draws a far beacon just
// inside the far plane (`uFar` metres) along the same line of sight, scaled
// about the camera: the projection is unchanged, so it sits exactly where it would on the
// horizon (nothing beyond the fog is drawn there to hide it wrongly). It also widens with
// distance, so a 3 km beacon is still a readable stroke on a phone, not a hairline.
const vert = /* glsl */ `
uniform float uFar;
uniform float uWiden;
varying vec2 vUv;
varying float vFace;
void main() {
  vUv = uv;
  vec3 axis = (modelMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  float d = max(length(axis.xz - cameraPosition.xz), 1.0);
  wp.xz = axis.xz + (wp.xz - axis.xz) * max(1.0, d / uWiden);
  wp.xyz = cameraPosition + (wp.xyz - cameraPosition) * min(1.0, uFar / d);
  // Brightest where the column faces the camera: a soft core instead of bright edges.
  vec3 n = normalize(vec3(position.x, 0.0, position.z));
  vec3 toCam = normalize(vec3(cameraPosition.x - wp.x, 0.0, cameraPosition.z - wp.z));
  vFace = abs(dot(n, toCam));
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;

const frag = /* glsl */ `
uniform vec3 uColor;
uniform float uIntensity;
uniform float uTime;
varying vec2 vUv;
varying float vFace;
void main() {
  float rise = fract(vUv.y * 6.0 - uTime * 0.25);
  float shimmer = 0.85 + 0.15 * sin(rise * 6.2832);
  float fade = pow(1.0 - vUv.y, 1.6) * smoothstep(0.0, 0.02, vUv.y);
  float a = fade * pow(vFace, 1.5) * shimmer * uIntensity;
  // Over 1 in the core, so bloom gives it a halo.
  gl_FragColor = vec4(uColor * (0.8 + 1.2 * vFace), a);
}`;

/**
 * The beacon over a flight's destination: a tall column of light that rises when a journey
 * begins, glows while it waits, flares when the bird arrives and fades. One at a time.
 */
export class Beacon {
  readonly mesh: THREE.Mesh;
  private readonly mat: THREE.ShaderMaterial;
  /** 0..1 how lit it is; eases toward `target`. */
  private level = 0;
  private target = 0;
  /** Seconds left of the arrival flare. */
  private flare = 0;
  private readonly color = new THREE.Color('#ffe7cf');

  constructor() {
    this.mat = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: this.color },
        uIntensity: { value: 0 },
        uTime: { value: 0 },
        uFar: { value: 800 },
        uWiden: { value: Config.destinations.beamWiden },
      },
      vertexShader: vert,
      fragmentShader: frag,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      fog: false,
    });
    const geo = new THREE.CylinderGeometry(1.8, 1, 1, 16, 8, true);
    geo.translate(0, 0.5, 0);
    this.mesh = new THREE.Mesh(geo, this.mat);
    // The shader moves it (far beacons are drawn nearer), so the bounds would cull it wrongly.
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 6;
    this.mesh.visible = false;
  }

  /** Raise the beacon over (x, z), its foot at y. */
  show(x: number, y: number, z: number): void {
    const K = Config.destinations;
    this.mesh.position.set(x, y, z);
    this.mesh.scale.set(K.beamRadius, K.beamHeight, K.beamRadius);
    this.mesh.visible = true;
    this.level = 0;
    this.flare = 0;
    this.target = 1;
  }

  /** The bird arrived: a flare, then the light goes out. */
  arrive(): void {
    this.flare = 1.2;
    this.target = 0;
  }

  /** Put it out at once (a new flight or level). */
  hide(): void {
    this.mesh.visible = false;
    this.level = this.target = this.flare = 0;
  }

  update(dt: number, time: number, camera: THREE.PerspectiveCamera): void {
    if (!this.mesh.visible) return;
    const K = Config.destinations;
    // Rises over ~2.5 s; after an arrival it fades over ~3 s under the flare.
    this.level += clamp(this.target - this.level, -dt / 3, dt / 2.5);
    this.flare = Math.max(0, this.flare - dt);
    if (this.level <= 0 && this.target === 0 && this.flare === 0) {
      this.mesh.visible = false;
      return;
    }
    // Fade near its axis, so flying through it never floods the screen.
    const p = this.mesh.position;
    const cam = camera.position;
    const near = clamp(Math.hypot(cam.x - p.x, cam.z - p.z) / K.beamNear, 0.15, 1);
    const u = this.mat.uniforms;
    u.uIntensity.value = (this.level * 0.55 + this.flare * 0.9) * near;
    u.uTime.value = time;
    u.uFar.value = camera.far * K.beamFar;
    u.uWiden.value = K.beamWiden;
  }
}
