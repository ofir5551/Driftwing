import * as THREE from 'three';
import { Config } from '../../core/Config';
import { smoothstep } from '../../core/math';
import type { DayCycle } from '../DayCycle';
import { mulberry32 } from '../noise';

/** m: the box round the camera the dragonflies wrap in. */
const RANGE = 56;

const vert = /* glsl */ `
attribute vec4 aSeed;
attribute vec2 aPart;
uniform vec3 uCam;
uniform float uTime;
uniform float uGround;
uniform vec2 uSlope;
varying float vA;
varying float vWing;

float h(float n) { return fract(sin(n * 127.1 + 11.7) * 43758.5453); }

/** The k-th spot a dragonfly darts to, round its anchor (metres). */
vec3 spot(float k, float s) {
  return vec3(h(k * 3.1 + s) - 0.5, h(k * 5.7 + s * 1.3), h(k * 7.3 + s * 2.1) - 0.5) * vec3(7.0, 2.5, 7.0);
}

void main() {
  float s = aSeed.w * 97.0;
  // Hover, then dart to the next spot: a quick move at the start of each beat, a hang after.
  float beat = uTime / (1.6 + aSeed.z * 1.8) + aSeed.w * 13.0;
  float k = floor(beat);
  vec3 a = spot(k, s);
  vec3 b = spot(k + 1.0, s);
  vec3 off = mix(a, b, smoothstep(0.0, 0.16, fract(beat)));
  off += vec3(sin(uTime * 6.0 + s), sin(uTime * 8.0 + s * 2.0) * 0.6, cos(uTime * 7.0 + s)) * 0.05;
  vec2 anchor = aSeed.xy * ${RANGE.toFixed(1)};
  vec2 rel = mod(anchor - uCam.xz + ${(RANGE / 2).toFixed(1)}, ${RANGE.toFixed(1)}) - ${(RANGE / 2).toFixed(1)} + off.xz;
  // Low over the ground (a plane through the ground under the camera, tilted to its slope).
  float y = uGround + dot(uSlope, rel) + 1.2 + off.y;
  // Face the way it last darted.
  vec2 d = normalize((b - a).xz + vec2(1e-4, 0.0));
  vec3 v = position;
  if (aPart.x > 0.5) {
    // Wings: a blur of quick beats.
    v.y += sin(uTime * 60.0 + s + v.x * 3.0) * 0.03 * abs(v.x) * 6.0;
  }
  vec3 world = vec3(uCam.x + rel.x, y, uCam.z + rel.y) + vec3(v.x * d.y + v.z * d.x, v.y, -v.x * d.x + v.z * d.y);
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
  // Fade toward the box's edge, and out right at the lens (none fills the view).
  float edge = (1.0 - smoothstep(${(RANGE * 0.3).toFixed(1)}, ${(RANGE * 0.48).toFixed(1)}, length(rel)))
    * smoothstep(2.5, 6.0, distance(world, cameraPosition));
  vA = edge * (aPart.x > 0.5 ? 0.22 : 1.0);
  vWing = aPart.x;
}`;

const frag = /* glsl */ `
uniform vec3 uBody;
uniform vec3 uWingCol;
uniform float uShow;
varying float vA;
varying float vWing;
void main() {
  float a = vA * uShow;
  if (a <= 0.01) discard;
  gl_FragColor = vec4(mix(uBody, uWingCol, vWing), a);
  #include <colorspace_fragment>
}`;

/**
 * Red dragonflies over the valley by day: a few hundred in a box that wraps round the camera,
 * held low over the ground under it (a plane tilted to its slope), each hovering and then
 * darting to a new spot a few metres off, its wings a pale blur. Seen when flying low over the
 * meadows and the water; gone by dusk. One draw, all motion in the shader.
 */
export class Dragonflies {
  readonly mesh: THREE.Mesh;
  private readonly material: THREE.ShaderMaterial;
  private readonly max: number;

  constructor(
    seed: number,
    /** The surface under a point (ground, canopy or water) they hover over. */
    private readonly ground: (x: number, z: number) => number,
  ) {
    const n = (this.max = Config.maple.dragonflies);
    const rand = mulberry32(seed * 23 + 9);
    // One dragonfly, ~0.5 m long (larger than life, so it reads from the bird): a thin
    // red body along +z and two pairs of wings across it.
    const body = [
      0, 0, 0.17, 0.04, 0, 0, -0.04, 0, 0, 0.04, 0, 0, 0, 0, -0.17, -0.04, 0, 0,
      // The same again stood upright, so the body shows from the side as well as from above.
      0, 0, 0.17, 0, 0.04, 0, 0, -0.04, 0, 0, 0.04, 0, 0, 0, -0.17, 0, -0.04, 0,
    ];
    const wings: number[] = [];
    for (const s of [-1, 1])
      for (const z of [0.04, -0.03])
        wings.push(0, 0, z + 0.025, s * 0.16, 0.005, z, 0, 0, z - 0.025);
    // Half as big again as the figures above: a dragonfly must read from the bird's height.
    for (const list of [body, wings]) for (let i = 0; i < list.length; i++) list[i] *= 1.6;
    const per = (body.length + wings.length) / 3;
    const pos = new Float32Array(n * per * 3);
    const part = new Float32Array(n * per * 2);
    const sd = new Float32Array(n * per * 4);
    for (let i = 0; i < n; i++) {
      const s = [rand(), rand(), rand(), rand()];
      const shape = [...body, ...wings];
      for (let v = 0; v < per; v++) {
        pos.set(shape.slice(v * 3, v * 3 + 3), (i * per + v) * 3);
        part[(i * per + v) * 2] = v >= body.length / 3 ? 1 : 0;
        sd.set(s, (i * per + v) * 4);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('aPart', new THREE.BufferAttribute(part, 2));
    g.setAttribute('aSeed', new THREE.BufferAttribute(sd, 4));
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uCam: { value: new THREE.Vector3() },
        uTime: { value: 0 },
        uGround: { value: 0 },
        uSlope: { value: new THREE.Vector2() },
        uBody: { value: new THREE.Color('#d7372a') },
        uWingCol: { value: new THREE.Color('#f2ead8') },
        uShow: { value: 1 },
      },
      vertexShader: vert,
      fragmentShader: frag,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    this.mesh = new THREE.Mesh(g, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.name = 'dragonflies';
    const u = this.material.uniforms;
    // The ground plane under the camera, measured as it renders (three queries a frame).
    this.mesh.onBeforeRender = (_r, _s, camera) => {
      const c = camera.position;
      u.uCam.value.copy(c);
      const g0 = this.ground(c.x, c.z);
      const e = 8;
      u.uGround.value = g0;
      u.uSlope.value.set(
        (this.ground(c.x + e, c.z) - g0) / e,
        (this.ground(c.x, c.z + e) - g0) / e,
      );
      // Far above the ground they would be specks: fade them out as the camera climbs.
      this.height = c.y - g0;
    };
  }

  private height = 0;
  private readonly body = new THREE.Color();

  frame(time: number, day: DayCycle): void {
    const u = this.material.uniforms;
    u.uTime.value = time;
    const p = day.palette;
    const lit = smoothstep(-0.02, 0.2, day.sunDir.y);
    u.uShow.value = lit * (1 - smoothstep(25, 60, this.height));
    // Lit by the hour: the red glows in the low sun.
    this.body
      .set('#d7372a')
      .multiply(p.sun)
      .multiplyScalar(0.55 + 0.5 * p.sunIntensity * lit);
    u.uBody.value.copy(this.body);
    u.uWingCol.value.copy(p.hemiSky).lerp(p.sun, 0.4);
    const share = Math.max(0.25, Config.render.coverDensity);
    const per = this.mesh.geometry.getAttribute('position').count / this.max;
    this.mesh.geometry.setDrawRange(0, Math.floor(this.max * share) * per);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
