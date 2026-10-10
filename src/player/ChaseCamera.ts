import * as THREE from 'three';
import { Config } from '../core/Config';
import { angleDelta, clamp, expDecay, springStep, type Spring } from '../core/math';
import type { Pose } from './Bird';

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

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(Config.camera.baseFov, aspect, 0.3, 2000);
  }

  update(p: Pose, dt: number, groundAt: (x: number, z: number) => number): void {
    const c = Config.camera;
    // Pull back a touch at speed so fast flight reads as fast without losing the bird.
    // Portrait screens are narrow: back off and widen the view so the bird and the path ahead fit.
    const narrow = clamp(1 / this.camera.aspect, 1, 2.2) - 1;
    const targetDist =
      c.distance * (1 + narrow * 0.45) + Math.max(0, p.speed - Config.flight.cruiseSpeed) * 0.04;
    // Only part of the pitch: dives are seen from above, climbs from below, horizon stays calm.
    const targetPitch = p.pitch * c.pitchFollow;
    if (!this.initialised) {
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
    const floor = Math.max(groundAt(cx, cz), Config.world.waterLevel) + 1.2;
    const cam = this.camera;
    cam.position.set(cx, Math.max(p.y + c.height - Math.sin(this.pitch.x) * d, floor), cz);

    const la = c.lookAhead;
    const fx = Math.sin(p.yaw);
    const fz = Math.cos(p.yaw);
    this.target.set(p.x + fx * la, p.y + Math.sin(p.pitch) * la * 0.5 + 1.1, p.z + fz * la);
    cam.up.set(0, 1, 0);
    cam.lookAt(this.target);
    this.roll += (p.bank * c.rollFollow - this.roll) * expDecay(6, dt);
    cam.rotateZ(-this.roll);

    // FOV widens with speed: the cheapest, strongest sense of velocity.
    const base = c.baseFov + narrow * 14;
    const targetFov = clamp(
      base + (p.speed - Config.flight.cruiseSpeed) * c.fovPerSpeed,
      base - 4,
      c.maxFov + narrow * 14,
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
