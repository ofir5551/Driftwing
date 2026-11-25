import * as THREE from 'three';
import { Config } from '../core/Config';
import { getToonGradient } from './Terrain';

/** The cairn's size: big enough to read from 50 m on a phone (a waist-high one was a speck). */
const SIZE = 1.7;
/** Height of the cairn's top stone, where the stray perches (m above its foot). */
export const PERCH_HEIGHT = 1.7 * SIZE;
/** Where its lantern hangs, in its own frame (Gameplay raises sparks from it). */
export const LANTERN = { x: 0.72 * SIZE, y: 2.64 * SIZE, z: 0.2 * SIZE } as const;

/**
 * The marker at a destination: a cairn of stacked, flattened stones with a lantern on a short
 * post beside the top, where the destination's stray perches. Its lantern glows (over 1 in
 * linear, so bloom haloes it), brighter at night, flickering a little like a flame. One is
 * moved to each new destination; it stays lit after the arrival until the next beacon rises.
 */
export class Roost {
  readonly group = new THREE.Group();
  private readonly glowMat = new THREE.MeshBasicMaterial({ color: '#ffd9a0' });
  private readonly base = new THREE.Color('#ffd9a0');

  constructor() {
    const stone = new THREE.MeshToonMaterial({ color: '#c9a184', gradientMap: getToonGradient() });
    const dark = new THREE.MeshToonMaterial({ color: '#5e4636', gradientMap: getToonGradient() });
    // Stones: each smaller and turned, so the stack reads as gathered by hand.
    const stones: [number, number, number, number][] = [
      [0.95, 0.42, 0.21, 0.2],
      [0.78, 0.36, 0.6, 1.3],
      [0.6, 0.3, 0.93, 2.4],
      [0.44, 0.26, 1.22, 0.7],
      [0.3, 0.22, 1.47, 1.9],
    ];
    for (const [r, h, y, turn] of stones) {
      const m = new THREE.Mesh(new THREE.DodecahedronGeometry(1, 0), stone);
      m.scale.set(r, h, r * 0.86);
      m.position.set(0, y, 0);
      m.rotation.y = turn;
      this.group.add(m);
    }
    // The lantern on its post, a little off the top so the stray has the top stone to itself.
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 2.6, 5), dark);
    post.position.set(0.72, 1.3, 0.2);
    const cap = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.2, 6), dark);
    cap.position.set(0.72, 2.86, 0.2);
    const glow = new THREE.Mesh(new THREE.IcosahedronGeometry(0.17, 1), this.glowMat);
    glow.position.set(0.72, 2.64, 0.2);
    this.group.add(post, cap, glow);
    for (const c of this.group.children) {
      c.position.multiplyScalar(SIZE);
      c.scale.multiplyScalar(SIZE);
    }
    this.group.visible = false;
  }

  /** Stand it at (x, y, z) (its foot), turned to yaw. */
  show(x: number, y: number, z: number, yaw: number): void {
    this.group.position.set(x, y, z);
    this.group.rotation.y = yaw;
    this.group.visible = true;
  }

  hide(): void {
    this.group.visible = false;
  }

  /** The lantern's flame: brighter as the stars come out, flickering. */
  update(time: number, stars: number): void {
    if (!this.group.visible) return;
    const F = Config.flock;
    const flicker = 0.88 + 0.08 * Math.sin(time * 9.1) + 0.04 * Math.sin(time * 23.7);
    this.glowMat.color
      .copy(this.base)
      .multiplyScalar((F.cairnLight + F.cairnNight * stars) * flicker);
  }
}
