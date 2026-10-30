import { Finger } from './Finger';

/** The on-screen Boost button of the D-pad and side-arrow steering: held = keep flapping. */
export class BoostButton {
  private readonly el: HTMLButtonElement;
  private readonly finger: Finger;

  constructor(ui: HTMLElement, boost: (down: boolean) => void) {
    this.el = document.createElement('button');
    this.el.className = 'boost-btn';
    this.el.setAttribute('aria-label', 'Boost');
    this.el.textContent = 'Boost';
    ui.appendChild(this.el);
    this.finger = new Finger(this.el, {
      down: () => boost(true),
      move: () => {},
      up: () => boost(false),
    });
  }

  /** Hiding lets go if held. */
  setShown(v: boolean): void {
    this.el.classList.toggle('show', v);
    if (!v) this.finger.release();
  }
}
