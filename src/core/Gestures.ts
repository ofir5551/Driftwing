import { Config } from './Config';

/**
 * Touch and trick gestures, kept free of the DOM so they are unit-tested: a double tap of a
 * direction (keys, gamepad stick, D-pad), a flick of the steering finger and the D-pad's
 * eight-way press. Times are in seconds.
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
 * A column of three buttons (up, turn, down) a thumb can slide along: which one a thumb dy px
 * from the middle button's centre presses (screen y down), given the button pitch. 1 up, 0 the
 * middle, -1 down. Only height counts, so a thumb drifting sideways off the column keeps its button.
 */
export function stackPress(dy: number, pitch: number): number {
  if (dy < -pitch / 2) return 1;
  if (dy > pitch / 2) return -1;
  return 0;
}
