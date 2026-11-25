import { Config } from '../core/Config';

/**
 * Where the flock flies relative to the bird. Pure (no Three.js), so it is unit-tested.
 *
 * The flock flies round and a little ahead of the bird, not in a V behind it: the camera sits a
 * few metres behind, and on a phone held upright it sees only a narrow cone, so a V trailing
 * the bird would be off screen (or in the lens). Ahead, the cone widens with distance, so each
 * slot's sideways reach grows with how far ahead it is, and every bird stays in view.
 */

/** A slot in the bird's frame: metres ahead, to the right, and up. */
export interface Slot {
  ahead: number;
  right: number;
  up: number;
}

const frac = (v: number) => v - Math.floor(v);

/**
 * Slot `i` at time t: spread by low-discrepancy sequences (so a flock of any size fills the
 * space evenly, and each bird keeps its place as more join), breathing slowly so the flock
 * never looks pinned to the bird.
 */
export function slot(i: number, t: number, out: Slot): Slot {
  const F = Config.flock;
  const g1 = frac(0.31 + i * 0.6180339887);
  const g2 = frac(0.77 + i * 0.4142135624);
  const g3 = frac(0.13 + i * 0.7548776662);
  const ahead = F.aheadMin + (F.aheadMax - F.aheadMin) * g1;
  out.ahead = ahead + Math.sin(t * 0.23 + i * 1.7) * F.drift;
  out.right =
    (g2 * 2 - 1) * (F.sideMin + F.sideGrow * ahead) + Math.sin(t * 0.31 + i * 2.3) * F.drift;
  out.up = F.upMid + (g3 * 2 - 1) * F.upSpread + Math.sin(t * 0.4 + i) * F.drift * 0.5;
  return out;
}

/** Scratch for `toWorld`'s basis (no allocation per call). */
const basis = { fx: 0, fy: 0, fz: 0, rx: 0, rz: 0, ux: 0, uy: 0, uz: 0 };

/**
 * A slot as a world offset from the bird flying at yaw and pitch. Forward is (sin yaw, 0,
 * cos yaw) tilted by pitch; facing +z the bird's right is -x. Written into out[o..o+2].
 */
export function toWorld(s: Slot, yaw: number, pitch: number, out: Float32Array, o: number): void {
  const B = basis;
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);
  B.fx = Math.sin(yaw) * cp;
  B.fy = sp;
  B.fz = Math.cos(yaw) * cp;
  B.rx = -Math.cos(yaw);
  B.rz = Math.sin(yaw);
  // Up = right x forward (tilts back as the bird climbs).
  B.ux = -Math.sin(yaw) * sp;
  B.uy = cp;
  B.uz = -Math.cos(yaw) * sp;
  out[o] = B.fx * s.ahead + B.rx * s.right + B.ux * s.up;
  out[o + 1] = B.fy * s.ahead + B.uy * s.up;
  out[o + 2] = B.fz * s.ahead + B.rz * s.right + B.uz * s.up;
}

/**
 * One critically damped spring step of offset x (with velocity v) toward target, angular
 * frequency w: no overshoot, settles in about 4/w seconds. The flock springs its offsets from
 * the bird, not world positions, so it keeps up at any speed (a world spring would trail 2v/w
 * behind: 30 m at a Phoenix's cruise) and lags only in turns, swinging round like a flock.
 */
export function spring(
  x: Float32Array,
  v: Float32Array,
  target: Float32Array,
  o: number,
  w: number,
  dt: number,
): void {
  // Exact solution of x'' = -w^2 (x - t) - 2 w x' over dt (stable at any dt).
  const e = Math.exp(-w * dt);
  for (let k = o; k < o + 3; k++) {
    const d = x[k] - target[k];
    const c = v[k] + w * d;
    x[k] = target[k] + (d + c * dt) * e;
    v[k] = (c - w * (d + c * dt)) * e;
  }
}
