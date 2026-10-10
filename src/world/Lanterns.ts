import * as THREE from 'three';
import { Config } from '../core/Config';
import { expDecay } from '../core/math';
import { getToonGradient } from './Terrain';

const MAX = 10;

// The beam: a tall additive cone that fades upward, the lantern's "I'm lit" signal from afar.
const beamVert = /* glsl */ `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const beamFrag = /* glsl */ `
uniform vec3 uColor;
uniform float uIntensity;
uniform float uTime;
varying vec2 vUv;
void main() {
  float shimmer = 0.8 + 0.2 * sin(vUv.y * 30.0 - uTime * 3.0 + vUv.x * 25.13);
  float a = pow(1.0 - vUv.y, 2.2) * shimmer * uIntensity * 0.35;
  gl_FragColor = vec4(uColor * 1.4, a);
}`;

interface Lantern {
  root: THREE.Group;
  orb: THREE.Mesh;
  beam: THREE.Mesh;
  beamMat: THREE.ShaderMaterial;
  lit: number; // 0..1 ignition progress
  age: number;
}

/**
 * Beacons that ignite when the player reaches a wisp milestone. Each spawns on the ground ahead
 * of the bird (so it's always seen), ignites over a couple of seconds and stays lit as a
 * landmark. Oldest is recycled after MAX.
 */
export class Lanterns {
  readonly group = new THREE.Group();
  private readonly items: Lantern[] = [];
  private nextSlot = 0;
  private readonly stoneMat: THREE.MeshToonMaterial;
  private readonly orbGeo = new THREE.IcosahedronGeometry(1.4, 1);
  private readonly color = new THREE.Color('#ffcf7a');

  constructor() {
    this.stoneMat = new THREE.MeshToonMaterial({
      color: '#cbb9c9',
      gradientMap: getToonGradient(),
    });
  }

  private make(): Lantern {
    const root = new THREE.Group();
    const pillar = new THREE.Mesh(new THREE.CylinderGeometry(1.1, 1.6, 9, 6), this.stoneMat);
    pillar.position.y = 4.5;
    const cap = new THREE.Mesh(new THREE.ConeGeometry(2.6, 2.2, 6), this.stoneMat);
    cap.position.y = 13.6;
    const posts: THREE.Mesh[] = [];
    for (let i = 0; i < 3; i++) {
      const p = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 3.6, 4), this.stoneMat);
      const a = (i / 3) * Math.PI * 2;
      p.position.set(Math.sin(a) * 1.5, 10.8, Math.cos(a) * 1.5);
      posts.push(p);
    }
    const orb = new THREE.Mesh(this.orbGeo, new THREE.MeshBasicMaterial({ color: '#6d6476' }));
    orb.position.y = 10.8;
    const beamMat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: this.color }, uIntensity: { value: 0 }, uTime: { value: 0 } },
      vertexShader: beamVert,
      fragmentShader: beamFrag,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
    });
    const beamGeo = new THREE.CylinderGeometry(4, 1.2, 1, 12, 1, true);
    beamGeo.translate(0, 0.5, 0);
    const beam = new THREE.Mesh(beamGeo, beamMat);
    beam.position.y = 10.8;
    beam.renderOrder = 5;
    root.add(pillar, cap, ...posts, orb, beam);
    return { root, orb, beam, beamMat, lit: 0, age: 0 };
  }

  /** Place and ignite a lantern at ground position (x, z). Returns its orb position. */
  ignite(x: number, groundY: number, z: number): THREE.Vector3 {
    let l = this.items[this.nextSlot];
    if (!l) {
      l = this.make();
      this.items.push(l);
      this.group.add(l.root);
    }
    this.nextSlot = (this.nextSlot + 1) % MAX;
    l.root.position.set(x, Math.max(groundY, Config.world.waterLevel) - 0.5, z);
    l.root.visible = true;
    l.lit = 0;
    l.age = 0;
    return new THREE.Vector3(x, l.root.position.y + 10.8, z);
  }

  update(dt: number, time: number): void {
    for (const l of this.items) {
      l.age += dt;
      l.lit += (1 - l.lit) * expDecay(1.2, dt);
      const pulse = 0.9 + 0.1 * Math.sin(time * 2 + l.root.position.x);
      const mat = l.orb.material as THREE.MeshBasicMaterial;
      // HDR orb colour (> 1) so the bloom pass gives it a warm glow.
      mat.color.setRGB(
        0.42 + 2.2 * l.lit * pulse,
        0.39 + 1.6 * l.lit * pulse,
        0.46 + 0.7 * l.lit * pulse,
      );
      l.beamMat.uniforms.uIntensity.value = l.lit;
      l.beamMat.uniforms.uTime.value = time;
      // The beam shoots up quickly on ignition, then settles to a calm column.
      l.beam.scale.set(1, 40 + 260 * Math.min(1, l.age / 1.6), 1);
    }
  }
}
