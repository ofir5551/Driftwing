import { DoubleTap, nearest, type Dir } from '../core/Gestures';
import type { SteerHandlers } from './DirectionPad';
import { Finger } from './Finger';

/**
 * Touch "Side arrows" steering: a compact cluster under each thumb, a tall turn button on the
 * outside (left on the left edge, right on the right) with up and down stacked just inside it, so
 * every button is a short nudge from where the thumb rests. Up and down are on both sides so two
 * thumbs reach every diagonal (one thumb turning while the other climbs or dives). A thumb slides
 * between its buttons without lifting; double-tapping an arrow is a trick, as on the keyboard.
 */
export class SideArrows {
  private readonly clusters: HTMLDivElement[] = [];
  /** Per cluster, in DOM order: turn, up, down. */
  private readonly buttons: HTMLSpanElement[][] = [];
  private readonly dirs: Dir[][] = [];
  private readonly fingers: Finger[] = [];
  private readonly taps = new DoubleTap();
  /** Pressed direction per cluster, left cluster first. */
  private readonly held: (Dir | null)[] = [null, null];
  /** Button centres per cluster in px, measured when the thumb goes down. */
  private readonly xs = [new Float64Array(3), new Float64Array(3)];
  private readonly ys = [new Float64Array(3), new Float64Array(3)];

  constructor(
    ui: HTMLElement,
    private readonly h: SteerHandlers,
  ) {
    for (const [i, side] of (['left', 'right'] as const).entries()) {
      const dirs: Dir[] = [side, 'up', 'down'];
      const el = document.createElement('div');
      el.className = `side-arrows ${side}`;
      el.setAttribute('aria-hidden', 'true');
      el.innerHTML = dirs.map((d) => `<span class="arrow-btn ${d}"></span>`).join('');
      ui.appendChild(el);
      const btns = [...el.querySelectorAll<HTMLSpanElement>('.arrow-btn')];
      this.clusters.push(el);
      this.buttons.push(btns);
      this.dirs.push(dirs);
      this.fingers.push(
        new Finger(el, {
          down: (px, py, now) => {
            btns.forEach((b, k) => {
              const r = b.getBoundingClientRect();
              this.xs[i][k] = r.left + r.width / 2;
              this.ys[i][k] = r.top + r.height / 2;
            });
            this.move(i, px, py, now);
          },
          move: (px, py, now) => this.move(i, px, py, now),
          up: () => this.set(i, null),
        }),
      );
    }
  }

  private move(i: number, px: number, py: number, now: number): void {
    const dir = this.dirs[i][nearest(this.xs[i], this.ys[i], px, py)];
    if (dir === this.held[i]) return;
    // Each button touched or slid onto counts as one press of its direction for the double tap.
    if (this.taps.press(dir, now)) this.h.trick(dir);
    this.set(i, dir);
  }

  private set(i: number, dir: Dir | null): void {
    this.held[i] = dir;
    this.buttons[i].forEach((b, k) => b.classList.toggle('on', this.dirs[i][k] === dir));
    const [l, r] = this.held;
    // Up on one side and down on the other cancel out, as opposite keys do.
    const x = (r === 'right' ? 1 : 0) - (l === 'left' ? 1 : 0);
    const y = (l === 'up' || r === 'up' ? 1 : 0) - (l === 'down' || r === 'down' ? 1 : 0);
    this.h.steer(x, y);
  }

  /** Hiding lets go of anything held. */
  setShown(v: boolean): void {
    for (const el of this.clusters) el.classList.toggle('show', v);
    if (!v) for (const f of this.fingers) f.release();
  }
}
