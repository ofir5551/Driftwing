import { Config } from '../core/Config';
import { DoubleTap, padPress, type Dir } from '../core/Gestures';
import { Finger } from './Finger';

/** What the on-screen steering controls report to TouchControls. */
export interface SteerHandlers {
  steer(x: number, y: number): void;
  trick(dir: Dir): void;
}

/** Arrow order in the DOM. */
const ARROWS: readonly Dir[] = ['up', 'right', 'down', 'left'];

/**
 * Touch "D-pad" steering: an eight-way pad at the bottom left. The pad follows the finger that
 * went down on it, so the thumb can rest between two arrows for a diagonal and slide round (even
 * off the rim) without lifting, like a controller's D-pad. Double-tapping an arrow is a trick, as
 * on the keyboard.
 */
export class DirectionPad {
  private readonly el: HTMLDivElement;
  private readonly knob: HTMLDivElement;
  private readonly arrows: HTMLSpanElement[];
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
  ) {
    this.el = document.createElement('div');
    this.el.className = 'dpad';
    this.el.setAttribute('aria-hidden', 'true');
    this.el.innerHTML =
      ARROWS.map((d) => `<span class="dpad-arrow ${d}"></span>`).join('') +
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
    this.arrows[0].classList.toggle('on', y > 0);
    this.arrows[1].classList.toggle('on', x > 0);
    this.arrows[2].classList.toggle('on', y < 0);
    this.arrows[3].classList.toggle('on', x < 0);
    this.h.steer(x, y);
  }

  /** Hiding lets go of anything held. */
  setShown(v: boolean): void {
    this.el.classList.toggle('show', v);
    if (!v) this.finger.release();
  }
}
