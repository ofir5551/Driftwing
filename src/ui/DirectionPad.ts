import { Config } from '../core/Config';
import { DoubleTap, padPress, type Dir } from '../core/Gestures';
import { Finger } from './Finger';

/** What the on-screen steering controls report to TouchControls. */
export interface SteerHandlers {
  steer(x: number, y: number): void;
  trick(dir: Dir): void;
}

export interface PadOptions {
  /** Extra CSS class, which places the pad. */
  cls?: string;
  /** A turn this pad never makes (Split: the left pad has no right, the right pad no left). */
  without?: 'left' | 'right';
}

/** Arrow order in the DOM. */
const ARROWS: readonly Dir[] = ['up', 'right', 'down', 'left'];

/**
 * Touch "D-pad" steering: an eight-way pad at the bottom left. The pad follows the finger that
 * went down on it, so the thumb can rest between two arrows for a diagonal and slide round (even
 * off the rim) without lifting, like a controller's D-pad. Double-tapping an arrow is a trick, as
 * on the keyboard. Split steering uses two of these, each without the other side's turn.
 */
export class DirectionPad {
  private readonly el: HTMLDivElement;
  private readonly knob: HTMLDivElement;
  private readonly arrows: HTMLSpanElement[];
  private readonly dirs: readonly Dir[];
  private readonly finger: Finger;
  private readonly taps = new DoubleTap();
  private readonly press = { x: 0, y: 0 };
  /** Pad centre and radius in px, measured when the thumb goes down. */
  private cx = 0;
  private cy = 0;
  private r = 1;
  private x = 0;
  private y = 0;

  constructor(
    ui: HTMLElement,
    private readonly h: SteerHandlers,
    private readonly opts: PadOptions = {},
  ) {
    this.dirs = ARROWS.filter((d) => d !== opts.without);
    this.el = document.createElement('div');
    this.el.className = opts.cls ? `dpad ${opts.cls}` : 'dpad';
    this.el.setAttribute('aria-hidden', 'true');
    this.el.innerHTML =
      this.dirs.map((d) => `<span class="dpad-arrow ${d}"></span>`).join('') +
      '<div class="dpad-knob"></div>';
    this.arrows = [...this.el.querySelectorAll<HTMLSpanElement>('.dpad-arrow')];
    this.knob = this.el.querySelector<HTMLDivElement>('.dpad-knob')!;
    ui.appendChild(this.el);

    this.finger = new Finger(this.el, {
      down: (px, py, now) => {
        const rect = this.el.getBoundingClientRect();
        this.cx = rect.left + rect.width / 2;
        this.cy = rect.top + rect.height / 2;
        this.r = rect.width / 2;
        this.move(px, py, now);
      },
      move: (px, py, now) => this.move(px, py, now),
      up: () => {
        this.knob.style.transform = '';
        this.set(0, 0);
      },
    });
  }

  private move(px: number, py: number, now: number): void {
    const dx = px - this.cx;
    const dy = py - this.cy;
    // The knob follows the thumb, held inside the pad so it reads as pressed rather than dragged.
    const len = Math.hypot(dx, dy);
    const k = len > this.r * 0.55 ? (this.r * 0.55) / len : 1;
    this.knob.style.transform = `translate(${dx * k}px, ${dy * k}px)`;

    padPress(dx, dy, this.r * Config.input.padDeadZone, this.press);
    // The missing turn's side of the pad still climbs and dives, it just never turns that way.
    const w = this.opts.without;
    if ((w === 'right' && this.press.x > 0) || (w === 'left' && this.press.x < 0)) this.press.x = 0;
    const { x, y } = this.press;
    if (x === this.x && y === this.y) return;
    // An arrow pressed on its own (touched, or slid onto from a neighbour) counts as one press of
    // that direction for the double tap. Landing straight on a diagonal presses no single arrow.
    const newX = x !== 0 && x !== this.x;
    const newY = y !== 0 && y !== this.y;
    let dir: Dir | null = null;
    if (newX && !newY) dir = x > 0 ? 'right' : 'left';
    else if (newY && !newX) dir = y > 0 ? 'up' : 'down';
    if (dir && this.taps.press(dir, now)) this.h.trick(dir);
    this.set(x, y);
  }

  private set(x: number, y: number): void {
    this.x = x;
    this.y = y;
    this.dirs.forEach((d, i) => {
      const on = d === 'up' ? y > 0 : d === 'down' ? y < 0 : d === 'right' ? x > 0 : x < 0;
      this.arrows[i].classList.toggle('on', on);
    });
    this.h.steer(x, y);
  }

  /** Hiding lets go of anything held. */
  setShown(v: boolean): void {
    this.el.classList.toggle('show', v);
    if (!v) this.finger.release();
  }
}
