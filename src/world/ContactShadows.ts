import * as THREE from 'three';
import { Config } from '../core/Config';
import { commitInstances } from './instances';

/** Ground height at x,z (a level's terrain); used to lay a contact shadow on the slope. */
export type GroundFn = (x: number, z: number) => number;

/** Strength and fade distance, shared by every contact-shadow mesh (Game sets them per frame). */
export const contactUniforms = {
  uStrength: { value: 0 },
  uFar: { value: 280 },
};

/** Where a blob lies: on the ground (tilted to its slope) or flat at the object's foot. */
export interface BlobFrame {
  y: number;
  nx: number;
  ny: number;
  nz: number;
}

/**
 * Lay a contact shadow for an object standing at (x, y, z). If the ground is within 1.5 m of
 * the object's foot, the blob sits on the ground and tilts with its slope (central differences
 * over `r`, the blob's size, so it hugs what it covers); otherwise the object stands on something
 * else (a ledge, a roof, a spire) and the blob lies flat at its foot. Pure: unit-tested.
 */
export function blobFrame(
  ground: GroundFn | null,
  x: number,
  y: number,
  z: number,
  r: number,
  out: BlobFrame,
): BlobFrame {
  out.y = y;
  out.nx = 0;
  out.ny = 1;
  out.nz = 0;
  if (!ground) return out;
  const g = ground(x, z);
  if (Math.abs(g - y) > 1.5) return out;
  const e = Math.max(0.5, r * 0.5);
  const gx = (ground(x + e, z) - ground(x - e, z)) / (2 * e);
  const gz = (ground(x, z + e) - ground(x, z - e)) / (2 * e);
  const len = Math.hypot(gx, 1, gz);
  out.y = g;
  out.nx = -gx / len;
  out.ny = 1 / len;
  out.nz = -gz / len;
  return out;
}

/** Cached blob frames kept before the cache starts over (a long flight's worth of ground). */
const FRAME_CACHE = 60000;
const frame: BlobFrame = { y: 0, nx: 0, ny: 1, nz: 0 };
const m = new THREE.Matrix4();
const q = new THREE.Quaternion();
const p = new THREE.Vector3();
const s = new THREE.Vector3();
const n = new THREE.Vector3();
const UP = new THREE.Vector3(0, 1, 0);

let material: THREE.ShaderMaterial | null = null;
/** One shared material: a soft radial darkening that fades out by uFar. */
function blobMaterial(): THREE.ShaderMaterial {
  material ??= new THREE.ShaderMaterial({
    uniforms: contactUniforms,
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying float vDist;
      void main() {
        vUv = uv * 2.0 - 1.0;
        vec4 wp = modelMatrix * instanceMatrix * vec4(position, 1.0);
        vDist = distance(wp.xyz, cameraPosition);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uStrength;
      uniform float uFar;
      varying vec2 vUv;
      varying float vDist;
      void main() {
        float a = 1.0 - smoothstep(0.0, 1.0, dot(vUv, vUv));
        a *= a * uStrength * (1.0 - smoothstep(uFar * 0.6, uFar, vDist));
        gl_FragColor = vec4(0.08, 0.09, 0.15, a);
      }`,
    transparent: true,
    depthWrite: false,
    // Drawn just over the ground it lies on, never through what stands in front.
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -4,
  });
  return material;
}

/**
 * Soft contact shadows: a dark radial blob under each tree or prop, laid on the slope, so
 * nothing floats. On medium and high (render.contactShadows); with the shadow map on (high)
 * they are lighter, standing in for the ambient occlusion at the foot. One instanced draw per
 * owner (Trees owns one; any level's decor can own another), refilled with its instances.
 */
export class ContactShadows {
  readonly mesh: THREE.InstancedMesh;
  private n = 0;
  private cx = 0;
  private cz = 0;
  private r2 = 0;
  /**
   * Blob frames already worked out, by position. A frame costs five samples of the level's
   * height field, and every refill asks again for the same trees and props: uncached, that was
   * most of a refill on the levels with heavy terrain. The ground never changes under a level.
   */
  private readonly frames = new Map<number, Float32Array>();

  constructor(capacity: number) {
    const disc = new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2);
    this.mesh = new THREE.InstancedMesh(disc, blobMaterial(), capacity);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 1; // after the opaque ground
    this.mesh.name = 'contact-shadows';
  }

  /** Start a refill round centred on (px, pz). */
  begin(px: number, pz: number): void {
    this.n = 0;
    this.cx = px;
    this.cz = pz;
    const r = Config.render.contactShadows > 0 ? Config.light.contactRange : 0;
    this.r2 = r * r;
  }

  /** A blob of radius r under an object standing at (x, y, z); kept if within range. */
  add(x: number, y: number, z: number, r: number, ground: GroundFn | null): void {
    if (this.n >= this.mesh.instanceMatrix.count) return;
    if ((x - this.cx) ** 2 + (z - this.cz) ** 2 > this.r2) return;
    let fy = y;
    n.set(0, 1, 0);
    if (ground) {
      // Quarter-metre cells: two things that close share a slope anyway.
      const k = (Math.round(x * 4) + 0x200000) * 0x400000 + (Math.round(z * 4) + 0x200000);
      let f = this.frames.get(k);
      if (!f) {
        if (this.frames.size > FRAME_CACHE) this.frames.clear();
        blobFrame(ground, x, y, z, r, frame);
        f = new Float32Array([frame.y, frame.nx, frame.ny, frame.nz]);
        this.frames.set(k, f);
      }
      fy = f[0];
      n.set(f[1], f[2], f[3]);
    }
    q.setFromUnitVectors(UP, n);
    m.compose(p.set(x, fy + 0.08, z), q, s.set(r, 1, r));
    this.mesh.setMatrixAt(this.n++, m);
  }

  end(): void {
    commitInstances(this.mesh, this.n);
  }

  dispose(): void {
    this.frames.clear();
    this.mesh.geometry.dispose();
    this.mesh.dispose();
  }
}
