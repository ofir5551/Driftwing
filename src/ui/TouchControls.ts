import { Config } from '../core/Config';
import { Flick, type Dir } from '../core/Gestures';
import { clamp } from '../core/math';
import type { TouchSteer } from '../core/Settings';
import { DirectionPad } from './DirectionPad';

/**
 * Touch: drag anywhere to steer, relative to where the finger went down (a floating stick).
 * Works in portrait and landscape because nothing is anchored to a fixed stick position.
 * While one finger steers, a second finger touching anywhere else flaps (held = repeat), so
 * there is no button to find and nothing covers the view. A fast flick of the steering finger
 * is a trick gesture (see Gestures). The Buttons steering setting swaps all of this for an
 * on-screen D-pad and boost button (DirectionPad); touches elsewhere then do nothing.
 */
export class TouchControls {
  steerX = 0;
  steerY = 0;
  /** Held flap (second finger), or a tap too quick for the 60 Hz step to see. */
  get flap(): boolean {
    const f = this.held || this.tap;
    this.tap = false;
    return f;
  }
  private held = false;
  private tap = false;
  private readonly flicker = new Flick();
  private trick: Dir | null = null;
  /** Direction of a trick gesture (flick or D-pad double tap) since the last call (consumed). */
  takeTrick(): Dir | null {
    const f = this.trick;
    this.trick = null;
    return f;
  }
  /** True while the steering finger is down. */
  get steering(): boolean {
    return this.steerId !== null;
  }
  private flapId: number | null = null;
  /** True once any touch has been seen: switches hints/UI to touch mode. */
  active = false;
  private steerId: number | null = null;
  private ox = 0;
  private oy = 0;
  private readonly ring: HTMLDivElement;
  private readonly knob: HTMLDivElement;
  private readonly pad: DirectionPad;
  private scheme: TouchSteer = 'drag';
  private shown = false;

  constructor(surface: HTMLElement, ui: HTMLElement) {
    this.ring = document.createElement('div');
    this.ring.className = 'touch-ring';
    this.knob = document.createElement('div');
    this.knob.className = 'touch-knob';
    this.ring.appendChild(this.knob);
    ui.appendChild(this.ring);
    this.pad = new DirectionPad(ui, {
      steer: (x, y) => {
        this.steerX = x;
        this.steerY = y;
      },
      boost: (down) => this.setFlap(down),
      trick: (dir) => (this.trick = dir),
    });

    surface.addEventListener(
      'touchstart',
      (e) => {
        this.setActive();
        e.preventDefault();
        if (this.scheme === 'buttons') return;
        for (const t of Array.from(e.changedTouches)) {
          if (this.steerId !== null && this.flapId === null) {
            // A second finger anywhere flaps for as long as it stays down.
            this.flapId = t.identifier;
            this.setFlap(true);
          } else if (this.steerId === null) {
            this.steerId = t.identifier;
            this.ox = t.clientX;
            this.oy = t.clientY;
            this.flicker.start(t.clientX, t.clientY, e.timeStamp / 1000);
            this.ring.style.transform = `translate(${t.clientX}px, ${t.clientY}px)`;
            this.ring.classList.add('show');
            this.knob.style.transform = '';
          }
        }
      },
      { passive: false },
    );
    surface.addEventListener(
      'touchmove',
      (e) => {
        for (const t of Array.from(e.changedTouches)) {
          if (t.identifier !== this.steerId) continue;
          this.trick = this.flicker.move(t.clientX, t.clientY, e.timeStamp / 1000) ?? this.trick;
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
        if (t.identifier === this.flapId) this.releaseFlap();
        if (t.identifier === this.steerId) this.releaseSteer();
      }
    };
    surface.addEventListener('touchend', end);
    surface.addEventListener('touchcancel', end);
    if (matchMedia('(pointer: coarse)').matches) this.setActive();
  }

  private releaseFlap(): void {
    this.flapId = null;
    this.setFlap(false);
  }

  private releaseSteer(): void {
    this.steerId = null;
    this.steerX = 0;
    this.steerY = 0;
    this.ring.classList.remove('show');
  }

  private setFlap(down: boolean): void {
    if (down) {
      this.tap = true;
      navigator.vibrate?.(8); // a faint tick where supported (Android); ignored elsewhere
    }
    this.held = down;
  }

  private setActive(): void {
    if (this.active) return;
    this.active = true;
    document.body.classList.add('touch');
  }

  /** Drag or Buttons steering (the Steering setting). Switching lets go of anything held. */
  setScheme(s: TouchSteer): void {
    if (s === this.scheme) return;
    this.scheme = s;
    document.body.classList.toggle('steer-buttons', s === 'buttons');
    this.releaseSteer();
    this.releaseFlap();
    this.setVisible(this.shown);
  }

  /** Show or hide the on-screen controls (hidden in menus). */
  setVisible(v: boolean): void {
    this.shown = v;
    if (!v) this.ring.classList.remove('show');
    this.pad.setShown(v && this.scheme === 'buttons');
  }
}
