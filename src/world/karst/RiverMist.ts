import * as THREE from 'three';
import { Config } from '../../core/Config';
import { hash2 } from '../noise';
import type { KarstLayout } from './KarstLayout';

const WHITE = new THREE.Color(1, 1, 1);

/** Floats per mist sheet: x, y, z, length, height, phase. */
export const MIST_STRIDE = 6;

/**
 * Where the river mist lies round (px, pz): one sheet per grid cell whose river centre line
 * (found by a few Newton steps from the cell's middle) runs through it, a few metres over the
 * water, long along the current. Pure; writes into `out` (cleared first) and returns the count.
 */
export function riverMistSpots(
  L: KarstLayout,
  px: number,
  pz: number,
  out: Float32Array,
  c: { x: number; z: number },
): number {
  const K = Config.karst;
  const cell = K.riverMistCell;
  const R = K.riverMistRange;
  const cap = out.length / MIST_STRIDE;
  let n = 0;
  for (let j = Math.floor((pz - R) / cell); j <= Math.floor((pz + R) / cell); j++)
    for (let i = Math.floor((px - R) / cell); i <= Math.floor((px + R) / cell); i++) {
      if (n >= cap) return n;
      if (hash2(i, j, L.seed + 360) > 0.7) continue;
      let x = (i + 0.5) * cell;
      let z = (j + 0.5) * cell;
      if ((x - px) ** 2 + (z - pz) ** 2 > R * R) continue;
      for (let k = 0; k < 3; k++) {
        L.toCentre(x, z, c);
        x = c.x;
        z = c.z;
      }
      if (x < i * cell || x >= (i + 1) * cell || z < j * cell || z >= (j + 1) * cell) continue;
      if (L.river(x, z) > -L.rw * 0.5) continue;
      const h = hash2(i, j, L.seed + 361);
      const o = n * MIST_STRIDE;
      out[o] = x;
      out[o + 1] = 2 + h * 4;
      out[o + 2] = z;
      out[o + 3] = 50 + h * 50;
      out[o + 4] = 7 + hash2(i, j, L.seed + 362) * 7;
      out[o + 5] = h * 6.283;
      n++;
    }
  return n;
}

const vert = /* glsl */ `
attribute vec4 aSheet; // length, height, phase, unused
uniform float uTime;
uniform float uRange;
varying vec2 vUv;
varying float vFade;
varying float vPhase;
void main() {
  vUv = uv;
  vPhase = aSheet.z;
  vec3 base = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  // Drift slowly downstream-ish and breathe, so the mist is never still.
  base.xz += vec2(sin(uTime * 0.05 + aSheet.z), cos(uTime * 0.04 + aSheet.z * 1.3)) * 6.0;
  vec4 mv = viewMatrix * vec4(base, 1.0);
  float dist = length(mv.xyz);
  // Facing the camera, but lying flatter the higher the bird looks down from.
  mv.xy += position.xy * vec2(aSheet.x, aSheet.y) * (1.0 + 0.08 * sin(uTime * 0.13 + aSheet.z));
  gl_Position = projectionMatrix * mv;
  // Clear round the bird (no sheet across the lens), fading out by the range's edge.
  vFade = smoothstep(35.0, 110.0, dist) * (1.0 - smoothstep(uRange * 0.75, uRange, dist));
}`;

const frag = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
uniform float uTime;
varying vec2 vUv;
varying float vFade;
varying float vPhase;
float mHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float mNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(mHash(i), mHash(i + vec2(1.0, 0.0)), u.x),
             mix(mHash(i + vec2(0.0, 1.0)), mHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
void main() {
  vec2 q = vUv * 2.0 - 1.0;
  // A long soft band, thinning to wisps at its ends and its top.
  float body = (1.0 - smoothstep(0.2, 1.0, abs(q.x))) * (1.0 - smoothstep(-0.2, 1.0, q.y)) * smoothstep(-1.0, -0.4, q.y);
  float wisp = mNoise(vec2(q.x * 3.0 + uTime * 0.04 + vPhase, q.y * 2.0 + vPhase))
    * 0.6 + mNoise(vec2(q.x * 7.0 - uTime * 0.06, q.y * 5.0 + vPhase)) * 0.4;
  float a = body * smoothstep(0.25, 0.75, wisp) * uOpacity * vFade;
  if (a < 0.004) discard;
  gl_FragColor = vec4(uColor, a);
  #include <colorspace_fragment>
}`;

/**
 * River mist: long, soft sheets lying a few metres over the water along the river near the
 * bird, drifting and breathing, in the valley mist's colour. Thick at dawn, gone by midday
 * (the same morning curve as the valley mist). One instanced draw of quads, refilled when the
 * bird has moved `riverMistRefresh` metres (writes into preallocated buffers).
 */
export class RiverMist {
  readonly mesh: THREE.InstancedMesh;
  private readonly spots: Float32Array;
  private readonly sheet: THREE.InstancedBufferAttribute;
  private readonly material: THREE.ShaderMaterial;
  private readonly c = { x: 0, z: 0 };
  private readonly m = new THREE.Matrix4();
  private lastX = NaN;
  private lastZ = NaN;

  constructor(private readonly L: KarstLayout) {
    const cap = 160;
    this.spots = new Float32Array(cap * MIST_STRIDE);
    const quad = new THREE.PlaneGeometry(1, 1);
    this.sheet = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4);
    quad.setAttribute('aSheet', this.sheet);
    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color() },
        uOpacity: { value: 0 },
        uTime: { value: 0 },
        uRange: {
          get value() {
            return Config.karst.riverMistRange;
          },
        },
      },
      vertexShader: vert,
      fragmentShader: frag,
      transparent: true,
      depthWrite: false,
    });
    this.mesh = new THREE.InstancedMesh(quad, this.material, cap);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
    this.mesh.name = 'river-mist';
  }

  update(px: number, pz: number): void {
    if (Math.hypot(px - this.lastX, pz - this.lastZ) < Config.karst.riverMistRefresh) return;
    this.lastX = px;
    this.lastZ = pz;
    const n = riverMistSpots(this.L, px, pz, this.spots, this.c);
    const S = this.spots;
    const A = this.sheet.array as Float32Array;
    for (let k = 0; k < n; k++) {
      const o = k * MIST_STRIDE;
      this.m.makeTranslation(S[o], S[o + 1], S[o + 2]);
      this.mesh.setMatrixAt(k, this.m);
      A[k * 4] = S[o + 3];
      A[k * 4 + 1] = S[o + 4];
      A[k * 4 + 2] = S[o + 5];
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.sheet.needsUpdate = true;
  }

  /** Per frame: the mist's colour and how much of it the hour allows (0..1). */
  frame(color: THREE.Color, amount: number, time: number): void {
    const u = this.material.uniforms;
    // A touch brighter than the valley's mist, so it lies luminous over the darker water.
    (u.uColor.value as THREE.Color).copy(color).lerp(WHITE, 0.2);
    u.uOpacity.value = amount * Config.karst.riverMist;
    u.uTime.value = time;
    this.mesh.visible = u.uOpacity.value > 0.01;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.mesh.dispose();
  }
}
