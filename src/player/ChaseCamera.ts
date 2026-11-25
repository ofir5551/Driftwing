import * as THREE from 'three';
import { Config } from '../core/Config';
import { angleDelta, clamp, expDecay, springStep, type Spring } from '../core/math';
import type { Pose } from './Bird';

/** max(a, b) with a rounded corner `k` wide (k <= 0: the plain max). Continuous in k too. */
function smoothMax(a: number, b: number, k: number): number {
  if (k <= 1e-6) return Math.max(a, b);
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.max(a, b) + h * h * k * 0.25;
}

/**
 * Spring-damped chase camera, sprung in polar coordinates around the bird.
 *
 * Springing the camera's world position makes a critically damped follower trail by 2v/omega
 * metres at speed v (about 15 m in a fast dive), and springing a cartesian offset makes it cut
 * inside turns and swoop too close. Springing the orbit *angles* (yaw, pitch) and the distance
 * separately keeps the bird a steady size on screen while turns still swing the camera wide and
 * settle without wobble. The camera looks slightly ahead along the heading and borrows a
 * fraction of the bank so turns feel like leaning into the curve.

 */
export class ChaseCamera {
  readonly camera: THREE.PerspectiveCamera;
  private readonly yaw: Spring = { x: 0, v: 0 };
  private readonly pitch: Spring = { x: 0, v: 0 };
  private readonly dist: Spring = { x: 0, v: 0 };
  private roll = 0;
  private fov = Config.camera.baseFov;
  private initialised = false;
  private readonly target = new THREE.Vector3();
  private readonly chasePos = new THREE.Vector3();
  /** The species' chase distance (a small bird is watched from a little closer). */
  distanceScale = 1;
  /**
   * 0..1: how soft the surface under the bird is (the cloud sea away from rock and gaps, deep
   * water). Over it the camera never sinks below where it rides while the bird skims it: the bird
   * may glide in, the camera does not follow it down or look up at it on the way out. It is a
   * place, not a mode, so nothing switches on or off in time and nothing jumps.
   */
  soft = 0;
  /** The cloud top over the bird, eased (the aim's floor). */
  private topY = 0;
  /** The lens's floor over soft cloud, sprung (continuous in speed, so it never jolts). */
  private readonly floorS: Spring = { x: 0, v: 0 };
  private floorOn = false;

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(Config.camera.baseFov, aspect, 0.3, 2000);
  }

  update(
    p: Pose,
    dt: number,
    groundAt: (x: number, z: number) => number,
    push?: (pos: THREE.Vector3) => void,
  ): void {
    const c = Config.camera;
    // Pull back a touch at speed so fast flight reads as fast without losing the bird.
    // Portrait screens are narrow: back off and widen the view so the bird and the path ahead fit.
    const narrow = clamp(1 / this.camera.aspect, 1, 2.2) - 1;
    const targetDist =
      c.distance * this.distanceScale * (1 + narrow * 0.22) +
      Math.max(0, p.speed - Config.flight.cruiseSpeed) * 0.04;
    // Only part of the pitch: dives are seen from above, climbs from below, horizon stays calm.
    const targetPitch = p.pitch * c.pitchFollow;
    // The soft surface's top under the bird: the cloud, or the water over a seabed.
    const water = Config.world.waterLevel;
    const ground0 = groundAt(p.x, p.z);
    const here = Math.max(ground0, water);
    const fresh = !this.initialised;
    if (fresh) {
      this.topY = here;
      this.floorOn = false;
      this.yaw.x = p.yaw;
      this.pitch.x = targetPitch;
      this.dist.x = targetDist;
      this.yaw.v = this.pitch.v = this.dist.v = 0;
      this.initialised = true;
    }
    // Unwrap the target yaw next to the current one so the spring never spins the long way round.
    springStep(this.yaw, this.yaw.x + angleDelta(this.yaw.x, p.yaw), c.posOmega, dt);
    springStep(this.pitch, targetPitch, c.posOmega, dt);
    springStep(this.dist, targetDist, c.posOmega * 0.6, dt);

    const d = this.dist.x;
    const back = d * Math.cos(this.pitch.x);
    const cx = p.x - Math.sin(this.yaw.x) * back;
    const cz = p.z - Math.cos(this.yaw.x) * back;
    const ground = Math.max(groundAt(cx, cz), Config.world.waterLevel);
    // The cloud top over the bird, eased: the cloud's heaps meet in sharp creases, so taken
    // straight at speed it jolts the lens (a shake) each time the bird crosses one.
    this.topY += (here - this.topY) * expDecay(c.cloudEase, dt);
    const cam = this.camera;
    const fx = Math.sin(p.yaw);
    const fz = Math.cos(p.yaw);
    let y = p.y + c.height - Math.sin(this.pitch.x) * d;
    const k = this.soft;
    if (k > 0) {
      // The floor: where the lens rides while the bird skims (its resting skim plus the camera's
      // own height) over the cloud at the bird, and clear of the highest heap under the lens and
      // where it will be in 0.3, 0.6 and 0.9 s. The cloud is creased and heaped, so the floor
      // rides a critically damped spring: its speed never jumps, and looking ahead makes up for
      // its lag, so the lens has risen before it reaches a heap.
      const run = p.speed * 0.3;
      const fwx = Math.sin(this.yaw.x) * run;
      const fwz = Math.cos(this.yaw.x) * run;
      let heaps = ground;
      for (let n = 1; n <= 3; n++) heaps = Math.max(heaps, groundAt(cx + n * fwx, cz + n * fwz));
      // The floor is exactly the lens's height at the skim, so it never sits lower than that
      // while the bird is under (the smooth max below lifts the skim view itself by at most
      // `cloudSoft` / 4, a hand's breadth); heaps keep `cloudClear`.
      const band = c.cloudSoft * k;
      const skim = ground0 >= water ? Config.flight.cloudSkim : Config.flight.clearance;
      const want = Math.max(here + skim + c.height, heaps + c.cloudClear);
      const fs = this.floorS;
      if (!this.floorOn) {
        fs.x = want;
        fs.v = 0;
        this.floorOn = true;
      } else springStep(fs, want, c.cloudOmega, dt);
      // The lens eases onto the floor (a smooth max over `cloudSoft` m), it never stops dead on
      // it. Under it, only a hand's clearance off the raw cloud (taken raw, it would jolt again).
      const hard = ground + 1.2 - 0.6 * k;
      const floor = Math.max(hard, hard + (fs.x - hard) * k);
      y = smoothMax(y, floor, band);
    } else this.floorOn = false;
    // Never under the ground (or into the cloud).
    y = Math.max(y, ground + (k > 0 ? 0.6 : 1.2));
    this.chasePos.set(cx, y, cz);
    push?.(this.chasePos); // keep the lens out of buildings when flying close to walls
    cam.position.copy(this.chasePos);

    const la = c.lookAhead;
    this.target.set(p.x + fx * la, p.y + Math.sin(p.pitch) * la * 0.5 + 1.1, p.z + fz * la);
    // A bird in soft cloud (the cloud sea) is watched where it went in, along the tops: the lens
    // stays over the cloud, so aiming under it would only fill the view with the cloud. The aim
    // follows the bird's height continuously down to the tops, so it never snaps.
    // Clear water shows the bird under it, so there the aim may follow it down `waterAim` m.
    const aim = this.topY + (ground0 >= water ? c.cloudAim : -c.waterAim);
    if (k > 0 && aim > this.target.y) this.target.y += (aim - this.target.y) * k;
    cam.up.set(0, 1, 0);
    cam.lookAt(this.target);
    this.roll += (p.bank * c.rollFollow - this.roll) * expDecay(6, dt);
    cam.rotateZ(-this.roll);

    // FOV widens with speed: the cheapest, strongest sense of velocity.
    const base = c.baseFov + narrow * 18;
    const targetFov = clamp(
      base + (p.speed - Config.flight.cruiseSpeed) * c.fovPerSpeed,
      base - 4,
      c.maxFov + narrow * 18,
    );
    this.fov += (targetFov - this.fov) * expDecay(3, dt);
    if (Math.abs(cam.fov - this.fov) > 0.01) {
      cam.fov = this.fov;
      cam.updateProjectionMatrix();
    }
  }

  snap(): void {
    this.initialised = false;
  }
}
