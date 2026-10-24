import { Config } from '../core/Config';
import { DoubleTap, padPress, type Dir } from '../core/Gestures';

export interface PadHandlers {
  steer(x: number, y: number): void;
  boost(down: boolean): void;
  trick(dir: Dir): void;
}

/** Arrow order in the DOM, and the steering each one lights up for. */
const ARROWS: readonly Dir[] = ['up', 'right', 'down', 'left'];

/**
 * Touch "Buttons" steering: an eight-way D-pad at the bottom left and a boost button at the bottom
 * right. The pad follows the finger that went down on it, so the thumb can rest between two arrows
 * for a diagonal and slide round (even off the rim) without lifting, like a controller's D-pad.
 * Double-tapping an arrow is a trick, as on the keyboard.
 */
export class DirectionPad {
  private readonly pad: HTMLDivElement;
  private readonly knob: HTMLDivElement;
  private readonly arrows: HTMLSpanElement[];
  private readonly boostBtn: HTMLButtonElement;
  private readonly taps = new DoubleTap();
  private readonly press = { x: 0, y: 0 };
  private padId: number | null = null;
  private boostId: number | null = null;
  /** Pad centre and radius in px, measured when the thumb goes down. */
  private cx = 0;
  private cy = 0;
  private r = 1;
  private x = 0;
  private y = 0;

  constructor(
    ui: HTMLElement,
    private readonly h: PadHandlers,
  ) {
    this.pad = document.createElement('div');
    this.pad.className = 'dpad';
    this.pad.setAttribute('aria-hidden', 'true');
    this.pad.innerHTML =
      ARROWS.map((d) => `<span class="dpad-arrow ${d}"></span>`).join('') +
      '<div class="dpad-knob"></div>';
    this.arrows = [...this.pad.querySelectorAll<HTMLSpanElement>('.dpad-arrow')];
    this.knob = this.pad.querySelector<HTMLDivElement>('.dpad-knob')!;
    this.boostBtn = document.createElement('button');
    this.boostBtn.className = 'boost-btn';
    this.boostBtn.setAttribute('aria-label', 'Boost');
    this.boostBtn.textContent = 'Boost';
    ui.append(this.pad, this.boostBtn);

    // preventDefault on touchstart also stops the browser's emulated mouse events and zooming.
    const opts = { passive: false };
    this.pad.addEventListener(
      'touchstart',
      (e) => {
        e.preventDefault();
        if (this.padId !== null) return;
        const t = e.changedTouches[0];
        const rect = this.pad.getBoundingClientRect();
        this.cx = rect.left + rect.width / 2;
        this.cy = rect.top + rect.height / 2;
        this.r = rect.width / 2;
        this.padId = t.identifier;
        this.pad.classList.add('on');
        this.move(t.clientX, t.clientY, e.timeStamp / 1000);
      },
      opts,
    );
    this.pad.addEventListener(
      'touchmove',
      (e) => {
        e.preventDefault();
        for (const t of Array.from(e.changedTouches))
          if (t.identifier === this.padId) this.move(t.clientX, t.clientY, e.timeStamp / 1000);
      },
      opts,
    );
    const padEnd = (e: TouchEvent) => {
      for (const t of Array.from(e.changedTouches))
        if (t.identifier === this.padId) this.releasePad();
    };
    this.pad.addEventListener('touchend', padEnd);
    this.pad.addEventListener('touchcancel', padEnd);

    this.boostBtn.addEventListener(
      'touchstart',
      (e) => {
        e.preventDefault();
        if (this.boostId !== null) return;
        this.boostId = e.changedTouches[0].identifier;
        this.boostBtn.classList.add('on');
        this.h.boost(true);
      },
      opts,
    );
    const boostEnd = (e: TouchEvent) => {
      for (const t of Array.from(e.changedTouches))
        if (t.identifier === this.boostId) this.releaseBoost();
    };
    this.boostBtn.addEventListener('touchend', boostEnd);
    this.boostBtn.addEventListener('touchcancel', boostEnd);
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

  private releasePad(): void {
    this.padId = null;
    this.pad.classList.remove('on');
    this.knob.style.transform = '';
    this.set(0, 0);
  }

  private releaseBoost(): void {
    if (this.boostId === null) return;
    this.boostId = null;
    this.boostBtn.classList.remove('on');
    this.h.boost(false);
  }

  /** Shown only while playing in Buttons mode; hiding lets go of anything held. */
  setShown(v: boolean): void {
    this.pad.classList.toggle('show', v);
    this.boostBtn.classList.toggle('show', v);
    if (v) return;
    if (this.padId !== null) this.releasePad();
    this.releaseBoost();
  }
}
