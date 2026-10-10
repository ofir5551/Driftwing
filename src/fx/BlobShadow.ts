import * as THREE from 'three';
import { Config } from '../core/Config';
import { smoothstep } from '../core/math';

/**
 * A soft dark ellipse under the bird. Cheaper than shadow maps and, more importantly, it tells
 * the player how high they are above the ground: the single most useful cue for skimming.
 */
export class BlobShadow {
  readonly mesh: THREE.Mesh;
  private readonly mat: THREE.ShaderMaterial;
  private readonly n = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 1, 0);

  constructor() {
    this.mat = new THREE.ShaderMaterial({
      uniforms: { uOpacity: { value: 0.3 }, uColor: { value: new THREE.Color('#3b3350') } },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `uniform float uOpacity; uniform vec3 uColor; varying vec2 vUv;
        void main(){ float r = length(vUv - 0.5) * 2.0; gl_FragColor = vec4(uColor, smoothstep(1.0, 0.2, r) * uOpacity); }`,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -4,
    });
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), this.mat);
    this.mesh.renderOrder = 1;
  }

  update(
    x: number,
    y: number,
    z: number,
    yaw: number,
    groundAt: (x: number, z: number) => number,
  ): void {
    const g = groundAt(x, z);
    const water = Config.world.waterLevel;
    const surface = Math.max(g, water);
    const h = y - surface;
    const fade = 1 - smoothstep(4, 45, h);
    this.mesh.visible = fade > 0.01;
    if (!this.mesh.visible) return;
    // Tilt to the local slope so the blob hugs hillsides.
    if (g > water) {
      const e = 1.5;
      this.n
        .set(
          groundAt(x - e, z) - groundAt(x + e, z),
          2 * e,
          groundAt(x, z - e) - groundAt(x, z + e),
        )
        .normalize();
    } else this.n.set(0, 1, 0);
    this.mesh.quaternion.setFromUnitVectors(this.up, this.n);
    this.mesh.rotateY(yaw);
    this.mesh.position.set(x, surface + 0.15, z);
    const s = 2.2 + h * 0.05;
    this.mesh.scale.set(s * 1.3, 1, s);
    this.mat.uniforms.uOpacity.value = 0.32 * fade;
  }
}
