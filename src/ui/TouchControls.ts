import { Config } from '../core/Config';
import { clamp } from '../core/math';

/**
 * Touch: drag anywhere to steer, relative to where the finger went down (a floating stick),
 * plus a dedicated flap button. Works in portrait and landscape because nothing is anchored
 * to a fixed stick position. While one finger steers, a second finger touching anywhere else
 * also flaps (held = repeat), so the flap never needs the button's exact spot.
 */
export class TouchControls {
  steerX = 0;
  steerY = 0;
  /** Held flap (button or second finger), or a tap too quick for the 60 Hz step to see. */
  get flap(): boolean {
    const f = this.held || this.tap;
    this.tap = false;
    return f;
  }
  private held = false;
  private tap = false;
  private flapId: number | null = null;
  /** True once any touch has been seen: switches hints/UI to touch mode. */
  active = false;
  private steerId: number | null = null;
  private ox = 0;
  private oy = 0;
  private readonly button: HTMLButtonElement;
  private readonly ring: HTMLDivElement;
  private readonly knob: HTMLDivElement;

  constructor(surface: HTMLElement, ui: HTMLElement) {
    this.button = document.createElement('button');
    this.button.className = 'flap-btn';
    this.button.setAttribute('aria-label', 'Flap');
    this.button.innerHTML =
      '<svg viewBox="0 0 48 48" aria-hidden="true"><path d="M6 30c8-2 12-10 18-16 6 6 10 14 18 16-7 0-12-3-18-8-6 5-11 8-18 8z" fill="currentColor"/></svg>';
    this.ring = document.createElement('div');
    this.ring.className = 'touch-ring';
    this.knob = document.createElement('div');
    this.knob.className = 'touch-knob';
    this.ring.appendChild(this.knob);
    ui.append(this.button, this.ring);

    const press = (down: boolean) => (e: Event) => {
      e.preventDefault();
      this.setFlap(down);
    };
    this.button.addEventListener('touchstart', press(true), { passive: false });
    this.button.addEventListener('touchend', press(false));
    this.button.addEventListener('touchcancel', press(false));

    surface.addEventListener(
      'touchstart',
      (e) => {
        this.setActive();
        for (const t of Array.from(e.changedTouches)) {
          if (this.steerId !== null && this.flapId === null) {
            // A second finger anywhere flaps for as long as it stays down.
            this.flapId = t.identifier;
            this.setFlap(true);
          } else if (this.steerId === null) {
            this.steerId = t.identifier;
            this.ox = t.clientX;
            this.oy = t.clientY;
            this.ring.style.transform = `translate(${t.clientX}px, ${t.clientY}px)`;
            this.ring.classList.add('show');
            this.knob.style.transform = '';
          }
        }
        e.preventDefault();
      },
      { passive: false },
    );
    surface.addEventListener(
      'touchmove',
      (e) => {
        for (const t of Array.from(e.changedTouches)) {
          if (t.identifier !== this.steerId) continue;
          const r = Config.input.touchRadius;
          let dx = (t.clientX - this.ox) / r;
          let dy = (t.clientY - this.oy) / r;
          const len = Math.hypot(dx, dy);
          if (len > 1) {
            // Drag past the rim: drag the origin along so reversing direction is instant.
            this.ox = t.clientX - (dx / len) * r;
            this.oy = t.clientY - (dy / len) * r;
            this.ring.style.transform = `translate(${this.ox}px, ${this.oy}px)`;
            dx /= len;
            dy /= len;
          }
          this.steerX = clamp(dx, -1, 1);
          this.steerY = clamp(-dy, -1, 1);
          this.knob.style.transform = `translate(${dx * 28}px, ${dy * 28}px)`;
        }
        e.preventDefault();
      },
      { passive: false },
    );
    const end = (e: TouchEvent) => {
      for (const t of Array.from(e.changedTouches)) {
        if (t.identifier === this.flapId) {
          this.flapId = null;
          this.setFlap(false);
        }
        if (t.identifier === this.steerId) {
          this.steerId = null;
          this.steerX = 0;
          this.steerY = 0;
          this.ring.classList.remove('show');
        }
      }
    };
    surface.addEventListener('touchend', end);
    surface.addEventListener('touchcancel', end);
    if (matchMedia('(pointer: coarse)').matches) this.setActive();
  }

  private setFlap(down: boolean): void {
    if (down) {
      this.tap = true;
      navigator.vibrate?.(8); // a faint tick where supported (Android); ignored elsewhere
    }
    this.held = down;
    this.button.classList.toggle('down', down);
  }

  private setActive(): void {
    if (this.active) return;
    this.active = true;
    document.body.classList.add('touch');
  }

  /** Show or hide the on-screen controls (hidden in menus). */
  setVisible(v: boolean): void {
    this.button.style.display = v ? '' : 'none';
    if (!v) this.ring.classList.remove('show');
  }
}
