import * as THREE from 'three';
import { Config } from '../core/Config';
import { commitInstances } from './instances';

/** Layer of the shadow-only caster proxies: the shadow camera sees it, the main camera doesn't. */
export const SHADOW_LAYER = 1;

/**
 * Shadow-only copies of an instanced shape, holding just the instances near the bird. An
 * instanced mesh is never frustum-culled (its instances span the view), so letting the real
 * mesh cast would draw every instance out to the draw distance into a shadow map that covers
 * ~150 m round the bird. The proxy lives on SHADOW_LAYER: the sun's shadow camera renders it,
 * the main camera never does. Refilled alongside its mesh (when the chunk set changes), so it
 * keeps instances out to the shadow box plus a refill's worth of flight (`reach`).
 */
export class ShadowCasters {
  readonly mesh: THREE.InstancedMesh;
  private n = 0;
  private cx = 0;
  private cz = 0;
  private r2 = 0;

  constructor(geometry: THREE.BufferGeometry, material: THREE.Material, capacity: number) {
    this.mesh = new THREE.InstancedMesh(geometry, material, capacity);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    this.mesh.layers.set(SHADOW_LAYER);
    this.mesh.name = 'shadow-casters';
  }

  /** Start a refill round (px, pz); `reach` is how far the bird may fly before the next one. */
  begin(px: number, pz: number, reach: number): void {
    this.n = 0;
    this.cx = px;
    this.cz = pz;
    const r = Config.render.shadows > 0 ? Config.light.shadowRange * Math.SQRT2 + reach : 0;
    this.r2 = r * r;
  }

  /** Offer an instance at (x, z) with its world matrix; kept if near enough. */
  add(x: number, z: number, m: THREE.Matrix4): void {
    if (this.n >= this.mesh.instanceMatrix.count) return;
    if ((x - this.cx) ** 2 + (z - this.cz) ** 2 > this.r2) return;
    this.mesh.setMatrixAt(this.n++, m);
  }

  end(): void {
    commitInstances(this.mesh, this.n);
  }

  dispose(): void {
    this.mesh.dispose();
  }
}
