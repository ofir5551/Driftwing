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
  /** World position of the orb (also what `reach` and `pending` hand out: no allocation). */
  orbPos: THREE.Vector3;
  reached: boolean;
  /** Seconds since reached (drives the flare). */
  sinceReached: number;
  /** Eased beam strength: full while waiting to be reached, a calm glow after. */
  glow: number;
  /** Spark emission accumulator while waiting. */
  spark: number;
}

/** Spark emitter for lanterns still to reach (Gameplay owns the particle pools). */
export type SparkFn = (x: number, y: number, z: number) => void;

/**
 * Beacons that ignite when the player reaches a wisp milestone. Each spawns on the ground ahead
 * of the bird (so it's always seen) and ignites over a couple of seconds. A lit lantern is a
 * destination: its column is wide and bright, with sparks rising round it, until the bird flies
 * through it (`reach`); then it flares and settles to a calm landmark. Oldest is recycled after MAX.
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
    return {
      root,
      orb,
      beam,
      beamMat,
      lit: 0,
      age: 0,
      orbPos: new THREE.Vector3(),
      reached: false,
      sinceReached: 0,
      glow: 1,
      spark: 0,
    };
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
    l.reached = false;
    l.glow = 1;
    l.spark = 0;
    return l.orbPos.set(x, l.root.position.y + 10.8, z);
  }

  /**
   * If the bird at (x, y, z) is inside the light column of a lantern it hasn't reached yet,
   * mark it reached and return its orb position. The column runs from just below the orb up
   * through the whole beam, so any height counts: steering toward the light is all it takes.
   */
  reach(x: number, y: number, z: number): THREE.Vector3 | null {
    const c = Config.lantern;
    const r2 = c.reachRadius * c.reachRadius;
    for (const l of this.items) {
      if (!l.root.visible || l.reached) continue;
      const o = l.orbPos;
      const dx = x - o.x;
      const dz = z - o.z;
      if (dx * dx + dz * dz > r2 || y < o.y - c.reachBelow) continue;
      l.reached = true;
      l.sinceReached = 0;
      return o;
    }
    return null;
  }

  /** The nearest lantern still to reach within `maxDist` (horizontal), or null. */
  pending(x: number, z: number, maxDist: number): THREE.Vector3 | null {
    let best: THREE.Vector3 | null = null;
    let bestD2 = maxDist * maxDist;
    for (const l of this.items) {
      if (!l.root.visible || l.reached) continue;
      const dx = l.orbPos.x - x;
      const dz = l.orbPos.z - z;
      const d2 = dx * dx + dz * dz;
      if (d2 < bestD2) {
        bestD2 = d2;
        best = l.orbPos;
      }
    }
    return best;
  }

  /** Put every lantern out (level switch). */
  reset(): void {
    for (const l of this.items) l.root.visible = false;
    this.nextSlot = 0;
  }

  update(dt: number, time: number, spark: SparkFn, sparkRate: number): void {
    const radius = Config.lantern.reachRadius;
    for (const l of this.items) {
      if (!l.root.visible) continue;
      l.age += dt;
      l.lit += (1 - l.lit) * expDecay(1.2, dt);
      l.sinceReached += dt;
      l.glow += ((l.reached ? 0.45 : 1) - l.glow) * expDecay(0.7, dt);
      // Reaching it sends a bright flare up the column that fades over a couple of seconds.
      const flare = l.reached ? 1.6 * Math.exp(-l.sinceReached * 1.8) : 0;
      const pulse = 0.9 + 0.1 * Math.sin(time * 2 + l.root.position.x);
      const mat = l.orb.material as THREE.MeshBasicMaterial;
      // HDR orb colour (> 1) so the bloom pass gives it a warm glow.
      mat.color.setRGB(
        0.42 + 2.2 * l.lit * pulse,
        0.39 + 1.6 * l.lit * pulse,
        0.46 + 0.7 * l.lit * pulse,
      );
      l.beamMat.uniforms.uIntensity.value = l.lit * (l.glow + flare);
      l.beamMat.uniforms.uTime.value = time;
      // The beam shoots up quickly on ignition, then settles to a calm column. While it waits
      // to be reached it is wider and breathes, so it reads as somewhere to go.
      const wide = 1 + (l.glow - 0.45) * (1.4 + 0.25 * Math.sin(time * 1.6 + l.orbPos.z));
      l.beam.scale.set(wide, 40 + 260 * Math.min(1, l.age / 1.6), wide);
      if (l.reached) continue;
      // Sparks drift up around the reach radius, marking how close is close enough.
      l.spark += dt * sparkRate * l.lit;
      while (l.spark >= 1) {
        l.spark -= 1;
        const a = Math.random() * Math.PI * 2;
        const r = radius * (0.55 + 0.4 * Math.random());
        spark(
          l.orbPos.x + Math.sin(a) * r,
          l.orbPos.y - 6 + Math.random() * 70,
          l.orbPos.z + Math.cos(a) * r,
        );
      }
    }
  }
}
