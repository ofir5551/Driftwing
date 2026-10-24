import { DoubleTap, stackPress, type Dir } from '../core/Gestures';
import type { SteerHandlers } from './DirectionPad';
import { Finger } from './Finger';

/**
 * Touch "Side arrows" steering: a column of up, turn and down buttons at each edge of the screen,
 * the left turn on the left and the right turn on the right. Up and down sit on both sides so two
 * thumbs reach every diagonal (one thumb turning while the other climbs or dives). A thumb can
 * slide along its column without lifting; double-tapping an arrow is a trick, as on the keyboard.
 */
export class SideArrows {
  private readonly cols: HTMLDivElement[] = [];
  /** Per column, top to bottom: up, turn, down. */
  private readonly buttons: HTMLSpanElement[][] = [];
  private readonly fingers: Finger[] = [];
  private readonly taps = new DoubleTap();
  /** Pressed button per column: 1 up, 0 turn, -1 down, null none. Left column first. */
  private readonly slot: (number | null)[] = [null, null];
  /** Middle button centre and button pitch per column, in px, measured when the thumb goes down. */
  private readonly cy = [0, 0];
  private readonly pitch = [1, 1];

  constructor(
    ui: HTMLElement,
    private readonly h: SteerHandlers,
  ) {
    for (const [i, side] of (['left', 'right'] as const).entries()) {
      const col = document.createElement('div');
      col.className = `side-arrows ${side}`;
      col.setAttribute('aria-hidden', 'true');
      col.innerHTML = ['up', side, 'down']
        .map((d) => `<span class="arrow-btn ${d}"></span>`)
        .join('');
      ui.appendChild(col);
      const btns = [...col.querySelectorAll<HTMLSpanElement>('.arrow-btn')];
      this.cols.push(col);
      this.buttons.push(btns);
      this.fingers.push(
        new Finger(col, {
          down: (_x, py, now) => {
            const top = btns[0].getBoundingClientRect();
            const mid = btns[1].getBoundingClientRect();
            this.cy[i] = mid.top + mid.height / 2;
            this.pitch[i] = mid.top - top.top;
            this.move(i, py, now);
          },
          move: (_x, py, now) => this.move(i, py, now),
          up: () => this.set(i, null),
        }),
      );
    }
  }

  private move(i: number, py: number, now: number): void {
    const s = stackPress(py - this.cy[i], this.pitch[i]);
    if (s === this.slot[i]) return;
    // Each button touched or slid onto counts as one press of its direction for the double tap.
    const dir: Dir = s === 1 ? 'up' : s === -1 ? 'down' : i === 0 ? 'left' : 'right';
    if (this.taps.press(dir, now)) this.h.trick(dir);
    this.set(i, s);
  }

  private set(i: number, s: number | null): void {
    this.slot[i] = s;
    const b = this.buttons[i];
    b[0].classList.toggle('on', s === 1);
    b[1].classList.toggle('on', s === 0);
    b[2].classList.toggle('on', s === -1);
    const [l, r] = this.slot;
    // Up on one side and down on the other cancel out, as opposite keys do.
    const x = (r === 0 ? 1 : 0) - (l === 0 ? 1 : 0);
    const y = (l === 1 || r === 1 ? 1 : 0) - (l === -1 || r === -1 ? 1 : 0);
    this.h.steer(x, y);
  }

  /** Hiding lets go of anything held. */
  setShown(v: boolean): void {
    for (const col of this.cols) col.classList.toggle('show', v);
    if (!v) for (const f of this.fingers) f.release();
  }
}
