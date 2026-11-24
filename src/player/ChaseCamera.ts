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
   * 0..1: the bird is sinking into soft cloud (below its resting skim). The camera does not
   * follow it in: it glides on over the tops at the height it had while the bird skimmed them
   * (`camera.cloudHeight`, plus `cloudLift` to look down from higher if wanted), and watches the
   * cloud where the bird went in. Eased here (`engage`) so it takes over and lets go smoothly.
   */
  submerged = 0;
  private engage = 0;
  /** The camera's floor over the cloud and the cloud top over the bird, eased (see update). */
  private floorY = 0;
  private topY = 0;
  /** The lens's height while the bird is in the cloud (sprung; tracks it otherwise, for a smooth hand-over). */
  private readonly ySpring: Spring = { x: 0, v: 0 };

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
    const here = groundAt(p.x, p.z);
    const fresh = !this.initialised;
    if (fresh) {
      this.engage = 0;
      this.topY = here;
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
    this.engage +=
      (this.submerged - this.engage) * expDecay(this.submerged > this.engage ? 3 : 1.2, dt);
    const k = this.engage;
    const ground = Math.max(groundAt(cx, cz), Config.world.waterLevel);
    let floor = ground + 1.2;
    // The cloud top over the bird, eased: the cloud's heaps meet in sharp creases, so taken
    // straight at speed it jolts the lens (a shake) each time the bird crosses one.
    this.topY += (here - this.topY) * expDecay(c.cloudEase, dt);
    if (k > 0.001) {
      // Engaged, the floor is where the lens rode while the bird skimmed the tops, over the
      // cloud at the bird as well as under the lens (the lens may be in a trough between heaps,
      // which would hide where the bird went in).
      // The heaps ahead count too (where the lens will be in 0.3 and 0.6 s), so the floor has
      // already risen when the lens reaches one, rather than skimming it a hand's breadth up.
      // It is not eased here: the height's spring below smooths it, and two lags stacked left
      // the lens behind the heaps.
      const run = p.speed * 0.3;
      const fwx = Math.sin(this.yaw.x) * run;
      const fwz = Math.cos(this.yaw.x) * run;
      const heaps = Math.max(
        ground,
        groundAt(cx + fwx, cz + fwz),
        groundAt(cx + 2 * fwx, cz + 2 * fwz),
      );
      const want = Math.max(heaps + 1.2, this.topY + c.cloudHeight + k * c.cloudLift);
      this.floorY = want;
      // The eased floor takes over early, before the raw one can jolt.
      floor = Math.max(ground + 0.5, floor + (this.floorY - floor) * Math.min(1, k * 4));
    } else this.floorY = floor;
    const cam = this.camera;
    const fx = Math.sin(p.yaw);
    const fz = Math.cos(p.yaw);
    // Following the bird down, the lens would stop dead on its floor in one frame and jolt.
    // Engaged, the floor is a soft limit (a smooth max over `cloudSoft` m) and the height rides a
    // spring; otherwise the spring only tracks the lens (its height and speed), so it takes over
    // without a step and slows the lens over a few frames, never in one. Off soft cloud the floor
    // is the plain one, as before.
    let y = p.y + c.height - Math.sin(this.pitch.x) * d;
    const ys = this.ySpring;
    if (k > 0.01) {
      springStep(ys, smoothMax(y, floor, c.cloudSoft), c.cloudOmega, dt);
      y = Math.max(ys.x, ground + 0.5);
    } else {
      y = Math.max(y, floor);
      ys.v = fresh ? 0 : (y - ys.x) / dt;
      ys.x = y;
    }
    this.chasePos.set(cx, y, cz);
    push?.(this.chasePos); // keep the lens out of buildings when flying close to walls
    cam.position.copy(this.chasePos);

    const la = c.lookAhead;
    this.target.set(p.x + fx * la, p.y + Math.sin(p.pitch) * la * 0.5 + 1.1, p.z + fz * la);
    // A bird under soft cloud (the cloud sea) is watched where it went in, along the tops: the
    // lens stays over the cloud, so aiming under it would only fill the view with the cloud.
    // Eased by the same engagement, so the aim settles on the tops rather than snapping to them.
    const aim = this.topY + c.cloudAim;
    if (k > 0.001 && aim > this.target.y) this.target.y += (aim - this.target.y) * k;
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
