import { Config } from '../../core/Config';
import { angleDelta, clamp } from '../../core/math';
import type { FlightInput, FlightState } from '../../player/FlightModel';

/**
 * Flying among buildings, as pure functions over the flight state (unit-tested): a look-ahead
 * that veers or climbs before a wall, and a glance that turns the bird along a wall it touches.
 * Neither ever stops the bird; a building is a soft nudge, like everything else in Driftwing.
 */

/** Solid lookup: top of the solid at a point grown by margin, or -Infinity; bottom in `bottom`. */
export interface Solids {
  solidTop(x: number, y: number, z: number, margin: number): number;
  readonly hit: ArrayLike<number>;
}

const MARGIN = 2.5;
const STEP = 5;
let hitTop = 0;
let hitBottom = 0;

/** Distance along a heading (and the current pitch) to the first solid, or `range` if clear. */
function march(s: FlightState, solids: Solids, yaw: number, range: number): number {
  const fx = Math.sin(yaw);
  const fz = Math.cos(yaw);
  const cp = Math.cos(s.pitch + s.trickPitch);
  const sp = Math.sin(s.pitch + s.trickPitch);
  for (let d = STEP; d <= range; d += STEP) {
    const top = solids.solidTop(s.x + fx * cp * d, s.y + sp * d, s.z + fz * cp * d, MARGIN);
    if (top !== -Infinity) {
      hitTop = top;
      hitBottom = solids.hit[1];
      return d;
    }
  }
  return range;
}

/**
 * Look ahead about a second of flight. A roof within reach: pull up over it. An underside
 * above (a deck, a gate beam): ease the nose down under it. A tall wall: veer toward whichever
 * side is more open, and climb as well if both sides are blocked. Strength grows as the wall
 * gets closer, so a bird flying down the middle of an avenue never feels it.
 */
export function avoidSolids(s: FlightState, input: FlightInput, solids: Solids): void {
  const c = Config.city;
  const range = Math.max(18, s.speed * c.avoidLook);
  const d0 = march(s, solids, s.yaw, range);
  if (d0 >= range) return;
  const urgency = 1 - d0 / range;
  const top = hitTop;
  if (hitBottom > s.y + 1) {
    input.steerY = Math.min(input.steerY, -urgency * c.avoidClimb * 0.7);
    return;
  }
  if (top + 3 - s.y < 12 + s.speed * 0.3) {
    input.steerY = Math.max(input.steerY, clamp(urgency * c.avoidClimb * 1.4, 0, 1));
    return;
  }
  const left = march(s, solids, s.yaw + 0.6, range);
  const right = march(s, solids, s.yaw - 0.6, range);
  if (Math.max(left, right) <= d0 + STEP)
    input.steerY = Math.max(input.steerY, clamp(urgency * c.avoidClimb, 0, 1));
  // steerX +1 turns right (yaw decreasing).
  const dir = right >= left ? 1 : -1;
  input.steerX = clamp(input.steerX + dir * urgency * c.avoidSteer, -1, 1);
}

/**
 * The bird touched a wall whose outward normal is (nx, nz): kick its turn rate so it peels
 * away along the wall (banking as it does, since bank follows turn rate), and shave speed in
 * proportion to how head-on the hit was. Self-limiting: once the heading runs along the wall
 * there is nothing left to turn.
 */
export function glanceOffWall(s: FlightState, nx: number, nz: number): void {
  const c = Config.city;
  const fx = Math.sin(s.yaw);
  const fz = Math.cos(s.yaw);
  const into = fx * nx + fz * nz; // < 0 while heading into the wall
  if (into >= 0) return;
  let tx = fx - nx * into;
  let tz = fz - nz * into;
  if (Math.hypot(tx, tz) < 1e-3) {
    // Dead on: slide whichever way the bird was already turning (yaw rate > 0 = left).
    const sign = s.turnSpring.x >= 0 ? 1 : -1;
    tx = -nz * sign;
    tz = nx * sign;
  }
  // Lean a little away from the wall so the bird peels off instead of scraping along it.
  const target = Math.atan2(tx + nx * 0.35, tz + nz * 0.35);
  // A critically damped spring released at rate r turns through 2r/omega in total.
  const want = (angleDelta(s.yaw, target) * c.glance * Config.flight.turnOmega) / 2;
  if (Math.sign(want) !== Math.sign(s.turnSpring.x) || Math.abs(want) > Math.abs(s.turnSpring.x)) {
    s.turnSpring.x = want;
    s.turnSpring.v = 0;
  }
  // Per step in contact (a glance lasts a handful of steps): head-on costs the most.
  s.speed *= 1 + c.glanceSlow * into * 0.15;
}
