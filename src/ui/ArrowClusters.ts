import { DoubleTap, nearest, type Dir } from '../core/Gestures';
import type { SteerHandlers } from './DirectionPad';
import { Finger } from './Finger';

/** One thumb's group of buttons: its CSS classes (which place it) and its directions in DOM order. */
export interface Cluster {
  cls: string;
  dirs: readonly Dir[];
}

/**
 * Side arrows: a compact cluster under each thumb, a tall turn button on the outside (left on the
 * left edge, right on the right) with up and down stacked just inside it. Up and down are on both
 * sides so two thumbs reach every diagonal (one thumb turning while the other climbs or dives).
 */
export const SIDE_ARROWS: readonly Cluster[] = [
  { cls: 'side-arrows left', dirs: ['left', 'up', 'down'] },
  { cls: 'side-arrows right', dirs: ['right', 'up', 'down'] },
];

/**
 * Split: left and right under one thumb, up and down under the other. Which side is which is
 * CSS (`body.split-swap`, the Swap sides setting), so swapping needs no rebuild.
 */
export const SPLIT_ARROWS: readonly Cluster[] = [
  { cls: 'split-turn', dirs: ['left', 'right'] },
  { cls: 'split-climb', dirs: ['up', 'down'] },
];

/**
 * Touch steering from clusters of arrow buttons, one thumb per cluster. Each thumb presses the
 * button nearest to it, so it slides between its buttons without lifting and keeps the closest
 * one when it drifts off. Double-tapping an arrow is a trick, as on the keyboard.
 */
export class ArrowClusters {
  private readonly els: HTMLDivElement[] = [];
  private readonly buttons: HTMLSpanElement[][] = [];
  private readonly fingers: Finger[] = [];
  private readonly taps = new DoubleTap();
  /** Pressed direction per cluster. */
  private readonly held: (Dir | null)[];
  /** Button centres per cluster in px, measured when the thumb goes down. */
  private readonly xs: Float64Array[];
  private readonly ys: Float64Array[];

  constructor(
    ui: HTMLElement,
    private readonly clusters: readonly Cluster[],
    private readonly h: SteerHandlers,
  ) {
    this.held = clusters.map(() => null);
    this.xs = clusters.map((c) => new Float64Array(c.dirs.length));
    this.ys = clusters.map((c) => new Float64Array(c.dirs.length));
    clusters.forEach((c, i) => {
      const el = document.createElement('div');
      el.className = `arrow-cluster ${c.cls}`;
      el.setAttribute('aria-hidden', 'true');
      el.innerHTML = c.dirs.map((d) => `<span class="arrow-btn ${d}"></span>`).join('');
      ui.appendChild(el);
      const btns = [...el.querySelectorAll<HTMLSpanElement>('.arrow-btn')];
      this.els.push(el);
      this.buttons.push(btns);
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
    });
  }

  private move(i: number, px: number, py: number, now: number): void {
    const dir = this.clusters[i].dirs[nearest(this.xs[i], this.ys[i], px, py)];
    if (dir === this.held[i]) return;
    // Each button touched or slid onto counts as one press of its direction for the double tap.
    if (this.taps.press(dir, now)) this.h.trick(dir);
    this.set(i, dir);
  }

  private set(i: number, dir: Dir | null): void {
    this.held[i] = dir;
    this.buttons[i].forEach((b, k) => b.classList.toggle('on', this.clusters[i].dirs[k] === dir));
    const has = (d: Dir) => (this.held.includes(d) ? 1 : 0);
    // Opposite directions held by two thumbs cancel out, as opposite keys do.
    this.h.steer(has('right') - has('left'), has('up') - has('down'));
  }

  /** Hiding lets go of anything held. */
  setShown(v: boolean): void {
    for (const el of this.els) el.classList.toggle('show', v);
    if (!v) for (const f of this.fingers) f.release();
  }
}
