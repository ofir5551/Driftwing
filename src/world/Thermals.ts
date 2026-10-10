import * as THREE from 'three';
import { Config } from '../core/Config';
import { smoothstep } from '../core/math';
import { hash2 } from './noise';

export interface Thermal {
  x: number;
  z: number;
  base: number; // ground height
  r: number;
  top: number;
}

const CELL = 420;
const MOTES = 140;

export const ThermalTuning = {
  strength: 13, // m/s^2 upward at the column centre (equilibrium climb ~8 m/s with liftDecay)
  height: 170, // m above ground the column reaches
};

// Motes spiral up the column entirely in the vertex shader: per-mote angle/radius/phase/speed
// are static attributes, time does the rest.
const vert = /* glsl */ `
attribute vec4 aMote; // angle, radius (0..1), phase (0..1), speed
uniform float uTime;
uniform float uRadius;
uniform float uHeight;
uniform float uHalfHeight;
varying float vAlpha;
void main() {
  float h = fract(aMote.z + uTime * aMote.w / uHeight);
  float ang = aMote.x + uTime * (0.6 + aMote.w * 0.02) + h * 4.0;
  float rad = uRadius * aMote.y * (0.75 + 0.35 * h);
  vec3 p = vec3(sin(ang) * rad, h * uHeight, cos(ang) * rad);
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = 0.55 * projectionMatrix[1][1] * uHalfHeight / max(-mv.z, 0.1);
  vAlpha = smoothstep(0.0, 0.12, h) * smoothstep(1.0, 0.6, h);
}`;

const frag = /* glsl */ `
uniform vec3 uColor;
varying float vAlpha;
void main() {
  float r = length(gl_PointCoord - 0.5);
  float a = smoothstep(0.5, 0.0, r) * vAlpha * 0.75;
  if (a < 0.01) discard;
  gl_FragColor = vec4(uColor, a);
}`;

// A barely-there shimmering column so thermals read from a distance.
const colVert = /* glsl */ `
varying vec2 vUv;
varying float vFacing;
void main() {
  vUv = uv;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  // Fade the silhouette (grazing angles) so the column has no hard glassy edges.
  vec3 n = normalize(normalMatrix * normal);
  vFacing = abs(dot(n, normalize(-mv.xyz)));
  gl_Position = projectionMatrix * mv;
}`;
const colFrag = /* glsl */ `
uniform vec3 uColor;
uniform float uTime;
varying vec2 vUv;
varying float vFacing;
void main() {
  float bands = 0.6 + 0.4 * sin(vUv.y * 18.0 - uTime * 2.0 + vUv.x * 12.566);
  float a = smoothstep(0.0, 0.15, vUv.y) * smoothstep(1.0, 0.5, vUv.y) * bands * 0.14 * vFacing * vFacing;
  gl_FragColor = vec4(uColor, a);
}`;

/** Rising-air columns on a sparse grid, placed on open low ground. Lift the bird for free. */
export class Thermals {
  readonly group = new THREE.Group();
  readonly active: Thermal[] = [];
  private readonly pool: THREE.Group[] = [];
  private readonly used: THREE.Group[] = [];
  private readonly moteGeo: THREE.BufferGeometry;
  private readonly moteMat: THREE.ShaderMaterial;
  private readonly colMat: THREE.ShaderMaterial;
  private readonly colGeo: THREE.CylinderGeometry;
  private lastCx = NaN;
  private lastCz = NaN;
  private wasInside = false;

  constructor(private readonly groundAt: (x: number, z: number) => number) {
    const motes = new Float32Array(MOTES * 4);
    for (let i = 0; i < MOTES; i++) {
      motes.set(
        [
          Math.random() * Math.PI * 2,
          Math.sqrt(Math.random()),
          Math.random(),
          8 + Math.random() * 10,
        ],
        i * 4,
      );
    }
    this.moteGeo = new THREE.BufferGeometry();
    this.moteGeo.setAttribute(
      'position',
      new THREE.BufferAttribute(new Float32Array(MOTES * 3), 3),
    );
    this.moteGeo.setAttribute('aMote', new THREE.BufferAttribute(motes, 4));
    this.moteMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uRadius: { value: 20 },
        uHeight: { value: ThermalTuning.height },
        uHalfHeight: { value: 400 },
        uColor: { value: new THREE.Color('#fff4dc') },
      },
      vertexShader: vert,
      fragmentShader: frag,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    this.colGeo = new THREE.CylinderGeometry(1, 0.7, 1, 16, 1, true);
    this.colGeo.translate(0, 0.5, 0);
    this.colMat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: new THREE.Color('#fff0d0') }, uTime: { value: 0 } },
      vertexShader: colVert,
      fragmentShader: colFrag,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
  }

  private thermalAt(i: number, j: number): Thermal | null {
    const seed = Config.world.seed;
    if (hash2(i, j, seed + 60) > 0.38) return null;
    const x = (i + 0.25 + hash2(i, j, seed + 61) * 0.5) * CELL;
    const z = (j + 0.25 + hash2(i, j, seed + 62) * 0.5) * CELL;
    const base = Math.max(this.groundAt(x, z), Config.world.waterLevel);
    if (base > 70) return null; // keep them over valleys and meadows
    const r = 18 + hash2(i, j, seed + 63) * 10;
    return { x, z, base, r, top: base + ThermalTuning.height };
  }

  update(px: number, pz: number): void {
    const cx = Math.floor(px / CELL);
    const cz = Math.floor(pz / CELL);
    if (cx === this.lastCx && cz === this.lastCz) return;
    this.lastCx = cx;
    this.lastCz = cz;
    for (const g of this.used) {
      this.group.remove(g);
      this.pool.push(g);
    }
    this.used.length = 0;
    this.active.length = 0;
    const r = Math.ceil(Math.min(Config.render.drawDistance, 700) / CELL);
    for (let j = cz - r; j <= cz + r; j++)
      for (let i = cx - r; i <= cx + r; i++) {
        const t = this.thermalAt(i, j);
        if (!t) continue;
        const g = this.pool.pop() ?? this.makeVisual();
        g.position.set(t.x, t.base, t.z);
        const motes = g.children[0] as THREE.Points;
        const col = g.children[1] as THREE.Mesh;
        motes.scale.set(t.r / 20, 1, t.r / 20);
        col.scale.set(t.r, ThermalTuning.height, t.r);
        this.group.add(g);
        this.used.push(g);
        this.active.push(t);
      }
  }

  private makeVisual(): THREE.Group {
    const g = new THREE.Group();
    const pts = new THREE.Points(this.moteGeo, this.moteMat);
    pts.frustumCulled = false;
    const col = new THREE.Mesh(this.colGeo, this.colMat);
    col.renderOrder = 2;
    g.add(pts, col);
    return g;
  }

  render(time: number, halfHeight: number, tint: THREE.Color): void {
    this.moteMat.uniforms.uTime.value = time;
    this.moteMat.uniforms.uHalfHeight.value = halfHeight;
    this.moteMat.uniforms.uColor.value.copy(tint);
    this.colMat.uniforms.uTime.value = time;
    this.colMat.uniforms.uColor.value.copy(tint);
  }

  /** Upward acceleration at a point: strongest at the core, fading at the rim and top. */
  lift(x: number, y: number, z: number): number {
    for (const t of this.active) {
      const d2 = (x - t.x) ** 2 + (z - t.z) ** 2;
      if (d2 > t.r * t.r) continue;
      const core = 1 - d2 / (t.r * t.r);
      const fade = 1 - smoothstep(t.top - 50, t.top, y);
      return ThermalTuning.strength * core * fade;
    }
    return 0;
  }

  /** Returns a state change (true = entered, false = left) or null if unchanged. */
  insideChanged(x: number, y: number, z: number): boolean | null {
    const inside = this.lift(x, y, z) > 0.5;
    if (inside === this.wasInside) return null;
    this.wasInside = inside;
    return inside;
  }

  nearest(x: number, z: number, radius: number): Thermal | null {
    let best: Thermal | null = null;
    let bd = radius * radius;
    for (const t of this.active) {
      const d = (x - t.x) ** 2 + (z - t.z) ** 2;
      if (d < bd) {
        bd = d;
        best = t;
      }
    }
    return best;
  }
}
