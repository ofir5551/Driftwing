export interface FingerHandlers {
  down(x: number, y: number, now: number): void;
  move(x: number, y: number, now: number): void;
  up(): void;
}

/**
 * Follows the first finger that goes down on an element until it lifts (times in seconds). Touch
 * events stay with the element a touch started on, so moves keep coming after the finger slides
 * off it: that is what lets a thumb slide between buttons. preventDefault on touchstart also
 * stops the browser's emulated mouse events and double-tap zoom.
 */
export class Finger {
  private id: number | null = null;

  constructor(
    private readonly el: HTMLElement,
    private readonly h: FingerHandlers,
  ) {
    const opts = { passive: false };
    el.addEventListener(
      'touchstart',
      (e) => {
        e.preventDefault();
        if (this.id !== null) return;
        const t = e.changedTouches[0];
        this.id = t.identifier;
        el.classList.add('on');
        h.down(t.clientX, t.clientY, e.timeStamp / 1000);
      },
      opts,
    );
    el.addEventListener(
      'touchmove',
      (e) => {
        e.preventDefault();
        for (const t of Array.from(e.changedTouches))
          if (t.identifier === this.id) h.move(t.clientX, t.clientY, e.timeStamp / 1000);
      },
      opts,
    );
    const end = (e: TouchEvent) => {
      for (const t of Array.from(e.changedTouches)) if (t.identifier === this.id) this.release();
    };
    el.addEventListener('touchend', end);
    el.addEventListener('touchcancel', end);
  }

  /** Let go as if the finger lifted (e.g. when the control is hidden). */
  release(): void {
    if (this.id === null) return;
    this.id = null;
    this.el.classList.remove('on');
    this.h.up();
  }
}
