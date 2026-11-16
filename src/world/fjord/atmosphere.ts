import * as THREE from 'three';
import { Config } from '../../core/Config';
import { hash2 } from '../noise';
import type { FjordLayout } from './FjordLayout';

/** Floats per fog bank: x, y, z, length, height, phase. */
export const FOG_STRIDE = 6;

/**
 * Where the dawn's fog banks lie round (px, pz): one long sheet per grid cell whose fjord
 * centre line (a few Newton steps from the cell's middle) runs through it, low over the water.
 * Pure; writes into `out` (cleared first) and returns the count.
 */
export function fogSpots(
  L: FjordLayout,
  px: number,
  pz: number,
  out: Float32Array,
  c: { x: number; z: number },
): number {
  const K = Config.fjord;
  const cell = K.fogCell;
  const R = K.fogRange;
  const cap = out.length / FOG_STRIDE;
  let n = 0;
  for (let j = Math.floor((pz - R) / cell); j <= Math.floor((pz + R) / cell); j++)
    for (let i = Math.floor((px - R) / cell); i <= Math.floor((px + R) / cell); i++) {
      if (n >= cap) return n;
      if (hash2(i, j, L.seed + 490) > 0.75) continue;
      let x = (i + 0.5) * cell;
      let z = (j + 0.5) * cell;
      if ((x - px) ** 2 + (z - pz) ** 2 > R * R) continue;
      for (let k = 0; k < 3; k++) {
        L.toCentre(x, z, c);
        x = c.x;
        z = c.z;
      }
      if (x < i * cell || x >= (i + 1) * cell || z < j * cell || z >= (j + 1) * cell) continue;
      if (L.fjord(x, z) > -L.fw * 0.4) continue;
      const h = hash2(i, j, L.seed + 491);
      // Off the centre line a little, toward one shore or the other.
      const side = (hash2(i, j, L.seed + 492) - 0.5) * L.fw * 0.9;
      const g = Math.hypot(L.fgx, L.fgz) || 1;
      const o = n * FOG_STRIDE;
      out[o] = x + (L.fgx / g) * side;
      out[o + 1] = 3 + h * 4;
      out[o + 2] = z + (L.fgz / g) * side;
      out[o + 3] = 90 + h * 90;
      out[o + 4] = 9 + hash2(i, j, L.seed + 493) * 9;
      out[o + 5] = h * 6.283;
      n++;
    }
  return n;
}

const NOISE = /* glsl */ `
float aHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float aNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(aHash(i), aHash(i + vec2(1.0, 0.0)), u.x),
             mix(aHash(i + vec2(0.0, 1.0)), aHash(i + vec2(1.0, 1.0)), u.x), u.y);
}`;

/**
 * Fog banks at first light: long, soft sheets lying low over the water near the bird, drifting
 * and breathing in the morning's colour (after Jade River's river mist). One instanced draw,
 * refilled when the bird has moved 60 m; hidden outside the dawn.
 */
export class FogBanks {
  readonly mesh: THREE.InstancedMesh;
  private readonly spots: Float32Array;
  private readonly sheet: THREE.InstancedBufferAttribute;
  private readonly material: THREE.ShaderMaterial;
  private readonly c = { x: 0, z: 0 };
  private readonly m = new THREE.Matrix4();
  private lastX = NaN;
  private lastZ = NaN;

  constructor(private readonly L: FjordLayout) {
    const cap = 120;
    this.spots = new Float32Array(cap * FOG_STRIDE);
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
            return Config.fjord.fogRange;
          },
        },
      },
      vertexShader: /* glsl */ `
        attribute vec4 aSheet;
        uniform float uTime;
        uniform float uRange;
        varying vec2 vUv;
        varying float vFade;
        varying float vPhase;
        void main() {
          vUv = uv;
          vPhase = aSheet.z;
          vec3 base = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
          base.xz += vec2(sin(uTime * 0.04 + aSheet.z), cos(uTime * 0.03 + aSheet.z * 1.3)) * 8.0;
          vec4 mv = viewMatrix * vec4(base, 1.0);
          float dist = length(mv.xyz);
          mv.xy += position.xy * vec2(aSheet.x, aSheet.y) * (1.0 + 0.08 * sin(uTime * 0.11 + aSheet.z));
          gl_Position = projectionMatrix * mv;
          vFade = smoothstep(30.0, 110.0, dist) * (1.0 - smoothstep(uRange * 0.75, uRange, dist));
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uColor;
        uniform float uOpacity;
        uniform float uTime;
        varying vec2 vUv;
        varying float vFade;
        varying float vPhase;
        ${NOISE}
        void main() {
          vec2 q = vUv * 2.0 - 1.0;
          float body = (1.0 - smoothstep(0.25, 1.0, abs(q.x))) * (1.0 - smoothstep(-0.3, 1.0, q.y)) * smoothstep(-1.0, -0.5, q.y);
          float wisp = aNoise(vec2(q.x * 2.5 + uTime * 0.03 + vPhase, q.y * 1.8 + vPhase)) * 0.6
            + aNoise(vec2(q.x * 6.0 - uTime * 0.05, q.y * 4.0 + vPhase)) * 0.4;
          float a = body * smoothstep(0.2, 0.7, wisp) * uOpacity * vFade;
          if (a < 0.004) discard;
          gl_FragColor = vec4(uColor, a);
          #include <colorspace_fragment>
        }`,
      transparent: true,
      depthWrite: false,
    });
    this.mesh = new THREE.InstancedMesh(quad, this.material, cap);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
    this.mesh.name = 'fog-banks';
    this.mesh.visible = false;
  }

  update(px: number, pz: number): void {
    if (!this.mesh.visible) return;
    if (Math.hypot(px - this.lastX, pz - this.lastZ) < 60) return;
    this.lastX = px;
    this.lastZ = pz;
    const n = fogSpots(this.L, px, pz, this.spots, this.c);
    const S = this.spots;
    const A = this.sheet.array as Float32Array;
    for (let k = 0; k < n; k++) {
      const o = k * FOG_STRIDE;
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

  /** Per frame: the fog's colour and how much of it the hour allows (0..1). */
  frame(color: THREE.Color, amount: number, time: number): void {
    const u = this.material.uniforms;
    (u.uColor.value as THREE.Color).copy(color);
    u.uOpacity.value = amount;
    u.uTime.value = time;
    const was = this.mesh.visible;
    this.mesh.visible = amount > 0.01;
    if (this.mesh.visible && !was) this.lastX = NaN; // refill on the way in
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.mesh.dispose();
  }
}

/** Cells either side of the reflection grid's centre, and their size (m). */
const GRID = 16;
const GRID_STEP = 40;

/**
 * The aurora softly reflected in the calm water near the shore: a grid of water round the
 * bird (at sea level, snapped to its cells, refilled when the bird has moved 120 m) carrying
 * the distance from the shore per vertex, drawn additively over the water. The fragment
 * mirrors the view ray off a gently rippled surface and paints the sky's curtains along it
 * (a cheaper copy of Sky's aurora: the reflection is soft), strongest in the sheltered water
 * within ~70 m of the shore and at grazing angles. Hidden by day.
 */
export class AuroraReflection {
  readonly mesh: THREE.Mesh;
  private readonly shore: THREE.BufferAttribute;
  private readonly material: THREE.ShaderMaterial;
  private cx = NaN;
  private cz = NaN;
  readonly uniforms = {
    uAurora: { value: 0 },
    uTime: { value: 0 },
  };

  constructor(private readonly L: FjordLayout) {
    const n = GRID * 2 + 1;
    const g = new THREE.PlaneGeometry(
      GRID * 2 * GRID_STEP,
      GRID * 2 * GRID_STEP,
      GRID * 2,
      GRID * 2,
    );
    g.rotateX(-Math.PI / 2);
    g.deleteAttribute('uv');
    g.deleteAttribute('normal');
    this.shore = new THREE.BufferAttribute(new Float32Array(n * n), 1);
    g.setAttribute('aShore', this.shore);
    this.material = new THREE.ShaderMaterial({
      uniforms: this.uniforms,
      vertexShader: /* glsl */ `
        attribute float aShore;
        varying float vShore;
        varying vec3 vWorld;
        void main() {
          vShore = aShore;
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorld = wp.xyz;
          gl_Position = projectionMatrix * viewMatrix * wp;
        }`,
      fragmentShader: /* glsl */ `
        uniform float uAurora;
        uniform float uTime;
        varying float vShore;
        varying vec3 vWorld;
        void main() {
          // Sheltered water near the shore is calm enough to mirror the sky.
          float calm = smoothstep(-95.0, -35.0, vShore) * (1.0 - smoothstep(-3.0, 0.0, vShore));
          if (calm <= 0.0) discard;
          vec3 v = normalize(cameraPosition - vWorld);
          vec2 rp = vWorld.xz;
          vec2 rip = vec2(sin(rp.x * 0.23 + uTime * 0.7) + sin(rp.y * 0.31 - uTime * 0.5),
                          cos(rp.y * 0.19 + uTime * 0.6) + cos(rp.x * 0.27 + uTime * 0.4)) * 0.018;
          vec3 d = normalize(vec3(-v.x + rip.x, v.y, -v.z + rip.y));
          float h = d.y;
          float az = atan(d.x, d.z);
          vec3 glow = vec3(0.0);
          for (int i = 0; i < 3; i++) {
            float fi = float(i);
            float t = uTime * (0.03 + 0.012 * fi);
            float fold = sin(az * 3.0 + fi * 2.1 + t) + 0.6 * sin(az * 7.0 - fi * 1.3 - t * 1.7);
            float y = h - (0.2 + 0.09 * fi + 0.035 * fold);
            float vv = smoothstep(-0.02, 0.01, y) * exp(-max(y, 0.0) * (4.0 + 2.0 * fi));
            float swell = smoothstep(0.35, 0.9, 0.5 + 0.5 * sin(az * 2.0 + fi * 2.7 - t * 0.7));
            vec3 c = mix(vec3(0.25, 1.35, 0.7), vec3(0.65, 0.28, 1.0), smoothstep(0.02, 0.2, y));
            glow += c * vv * swell * (1.0 - 0.25 * fi);
          }
          float fres = 0.35 + 0.65 * pow(1.0 - max(v.y, 0.0), 3.0);
          gl_FragColor = vec4(glow * uAurora * calm * fres, 1.0);
          #include <colorspace_fragment>
        }`,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.mesh = new THREE.Mesh(g, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2; // over the water
    this.mesh.position.y = Config.world.waterLevel + 0.05;
    this.mesh.name = 'aurora-reflection';
    this.mesh.visible = false;
  }

  /** Follow the bird: snap to the grid and refill the shore distances when it moves on. */
  update(px: number, pz: number): void {
    if (!this.mesh.visible) return;
    const cx = Math.round(px / (GRID_STEP * 3)) * GRID_STEP * 3;
    const cz = Math.round(pz / (GRID_STEP * 3)) * GRID_STEP * 3;
    if (cx === this.cx && cz === this.cz) return;
    this.cx = cx;
    this.cz = cz;
    this.mesh.position.x = cx;
    this.mesh.position.z = cz;
    const pos = this.mesh.geometry.getAttribute('position');
    const S = this.shore.array as Float32Array;
    for (let i = 0; i < pos.count; i++) S[i] = this.L.fjord(cx + pos.getX(i), cz + pos.getZ(i));
    this.shore.needsUpdate = true;
  }

  /** Per frame: how bright (the sky's aurora strength times the level's reflection). */
  frame(aurora: number, time: number): void {
    this.uniforms.uAurora.value = aurora;
    this.uniforms.uTime.value = time;
    const was = this.mesh.visible;
    this.mesh.visible = aurora > 0.01;
    if (this.mesh.visible && !was) this.cx = NaN;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
