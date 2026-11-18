import { Config } from './Config';

/**
 * Touch and trick gestures, kept free of the DOM so they are unit-tested: a double tap of a
 * direction (keys, gamepad stick, D-pad), a flick of the steering finger, one-finger tap flaps
 * and the D-pad's eight-way press. Times are in seconds.
 */
export type Dir = 'left' | 'right' | 'up' | 'down';

/** Two presses of the same direction within Config.input.doubleTap. */
export class DoubleTap {
  private last: Dir | null = null;
  private at = -Infinity;

  /** Register a press; true if it completes a double tap (a third press starts over). */
  press(dir: Dir, now: number): boolean {
    const hit = dir === this.last && now - this.at <= Config.input.doubleTap;
    this.last = hit ? null : dir;
    this.at = now;
    return hit;
  }
}

const SAMPLES = 16;

/**
 * A fast stroke: the finger travels Config.input.flickDistance px within flickTime. Ordinary
 * steering moves the finger a few dozen px at a time; a flick covers more than the whole
 * steering radius in a blink. One stroke fires once: the history restarts after a flick.
 */
export class Flick {
  private readonly t = new Float64Array(SAMPLES);
  private readonly x = new Float64Array(SAMPLES);
  private readonly y = new Float64Array(SAMPLES);
  private n = 0;
  private head = 0;

  start(x: number, y: number, now: number): void {
    this.n = 0;
    this.push(x, y, now);
  }

  /** Feed a finger position (screen px, y down). Returns the flick's direction, if one fired. */
  move(x: number, y: number, now: number): Dir | null {
    this.push(x, y, now);
    const { flickDistance, flickTime } = Config.input;
    // Walk back through the recent samples for the largest displacement within the window.
    for (let i = 1; i < this.n; i++) {
      const k = (this.head - 1 - i + SAMPLES * 2) % SAMPLES;
      if (now - this.t[k] > flickTime) break;
      const dx = x - this.x[k];
      const dy = y - this.y[k];
      if (dx * dx + dy * dy >= flickDistance * flickDistance) {
        this.start(x, y, now);
        if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 'right' : 'left';
        return dy > 0 ? 'down' : 'up';
      }
    }
    return null;
  }

  private push(x: number, y: number, now: number): void {
    this.t[this.head] = now;
    this.x[this.head] = x;
    this.y[this.head] = y;
    this.head = (this.head + 1) % SAMPLES;
    this.n = Math.min(this.n + 1, SAMPLES);
  }
}

/**
 * One-handed flapping for drag steering: the steering finger taps to flap, so no second finger
 * is needed. A tap is a touch that lifts within Config.input.tapMax having moved less than
 * tapSlop px; it flaps on lifting, since only then is it known not to be the start of a drag
 * (drags never flap). Once tapping, a touch landing within tapChain of the last tap's lift
 * flaps the moment it lands, so tapping in a rhythm feels instant and keeps boosting (the
 * flight model's flap cooldown paces it). A tap that already flapped on landing doesn't flap
 * again on lifting, and a chained touch may carry on into a drag: tap, tap, then steer.
 */
export class TapFlap {
  private downAt = 0;
  private sx = 0;
  private sy = 0;
  private moved = false;
  private flapped = false;
  private lastTap = -Infinity;

  /** Finger down at (x, y) px. True if it flaps now (it continues a run of taps). */
  down(x: number, y: number, now: number): boolean {
    this.downAt = now;
    this.sx = x;
    this.sy = y;
    this.moved = false;
    this.flapped = now - this.lastTap <= Config.input.tapChain;
    return this.flapped;
  }

  /** Finger moved to (x, y) px. Past tapSlop the touch is a drag, not a tap. */
  move(x: number, y: number): void {
    const dx = x - this.sx;
    const dy = y - this.sy;
    const slop = Config.input.tapSlop;
    if (dx * dx + dy * dy > slop * slop) this.moved = true;
  }

  /** Finger lifted. True if it flaps now (a tap that didn't flap on landing). */
  up(now: number): boolean {
    const tap = !this.moved && now - this.downAt <= Config.input.tapMax;
    this.lastTap = tap ? now : -Infinity;
    return tap && !this.flapped;
  }

  /** Forget the run (scheme change, controls hidden). */
  reset(): void {
    this.lastTap = -Infinity;
  }
}

/** tan(22.5 deg): splits the D-pad into eight equal 45 degree sectors, four arrows and four diagonals. */
const DIAGONAL = Math.tan(Math.PI / 8);

/**
 * D-pad: what a thumb at (dx, dy) px from the pad's centre (screen y down) presses. Nothing inside
 * the dead zone; otherwise an axis counts while the thumb is within 67.5 degrees of it, so resting
 * between two arrows presses both. Writes -1, 0 or 1 into out (y up, like steering).
 */
export function padPress(
  dx: number,
  dy: number,
  deadZone: number,
  out: { x: number; y: number },
): void {
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  if (dx * dx + dy * dy < deadZone * deadZone) {
    out.x = 0;
    out.y = 0;
    return;
  }
  out.x = ax > ay * DIAGONAL ? Math.sign(dx) : 0;
  out.y = ay > ax * DIAGONAL ? -Math.sign(dy) : 0;
}

/**
 * Which of a cluster of buttons (centres xs[i], ys[i]) a thumb at (x, y) presses: the nearest.
 * A sliding thumb moves between neighbours without gaps, and one that drifts off the cluster
 * keeps the button it is closest to rather than letting go.
 */
export function nearest(
  xs: ArrayLike<number>,
  ys: ArrayLike<number>,
  x: number,
  y: number,
): number {
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < xs.length; i++) {
    const d = (xs[i] - x) ** 2 + (ys[i] - y) ** 2;
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}
