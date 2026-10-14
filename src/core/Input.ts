import { Config } from './Config';
import { DoubleTap, type Dir } from './Gestures';
import { clamp } from './math';
import type { FlightInput } from '../player/FlightModel';
import type { TrickKind } from '../player/Tricks';
import { TouchControls } from '../ui/TouchControls';

type Device = 'mouse' | 'keys' | 'touch' | 'pad';

/**
 * Merges mouse, keyboard, touch and gamepad into one FlightInput. Steering comes from the most
 * recently used device (so a resting mouse pointer doesn't fight the keyboard); flap is the OR
 * of every source. Trick gestures: double-tap a direction (keys, stick), flick the steering
 * finger (touch) or right-click toward a direction (mouse); keeping it held extends the trick.
 */
export class Input {
  readonly state: FlightInput = {
    steerX: 0,
    steerY: 0,
    flap: false,
    trick: null,
    trickHeld: false,
  };
  readonly touch: TouchControls;
  /** One-shot actions, consumed by Game each frame. */
  pausePressed = false;
  mutePressed = false;
  private device: Device = 'mouse';
  private readonly keys = new Set<string>();
  private mx = 0;
  private my = 0;
  private mouseFlap = false;
  private padFlap = false;
  private padPausePrev = false;
  private locked = false;
  private readonly keyTaps = new DoubleTap();
  private readonly padTaps = new DoubleTap();
  private padDir: Dir | null = null;
  private rightDown = false;
  /** A gesture waiting for the next step, and the direction it was made in (for the hold). */
  private pending: Dir | null = null;
  private trickDir: Dir | null = null;
  /** False while menus are open so clicks on buttons don't flap. */
  enabled = false;

  constructor(
    private readonly canvas: HTMLCanvasElement,
    ui: HTMLElement,
  ) {
    this.touch = new TouchControls(canvas, ui);

    addEventListener('keydown', (e) => {
      if (e.repeat) return;
      const k = e.code;
      if (k === 'KeyP' || k === 'Escape') this.pausePressed = true;
      else if (k === 'KeyM') this.mutePressed = true;
      else if (k === 'KeyL' && this.enabled) this.togglePointerLock();
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(k))
        e.preventDefault();
      this.keys.add(k);
      if (this.isSteerKey(k)) {
        this.device = 'keys';
        const dir = keyDir(k);
        if (dir && this.keyTaps.press(dir, e.timeStamp / 1000)) this.pending = dir;
      }
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => {
      this.keys.clear();
      this.mouseFlap = false;
    });

    addEventListener('pointermove', (e) => {
      if (e.pointerType !== 'mouse') return;
      if (this.locked) {
        // Pointer lock: integrate relative motion into a virtual stick clamped to the unit circle.
        const s = 1 / (Math.min(innerWidth, innerHeight) * 0.5 * Config.input.mouseRange);
        this.mx = clamp(this.mx + e.movementX * s, -1, 1);
        this.my = clamp(this.my + e.movementY * s, -1, 1);
      } else {
        const half = Math.min(innerWidth, innerHeight) * 0.5;
        this.mx = (e.clientX - innerWidth / 2) / half;
        this.my = (e.clientY - innerHeight / 2) / half;
      }
      this.device = 'mouse';
    });
    canvas.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'mouse') return;
      if (e.button === 0) this.mouseFlap = true;
      if (e.button === 2) {
        // Right-click: a trick toward wherever the pointer is steering (centred: a loop).
        this.rightDown = true;
        this.device = 'mouse';
        const x = this.mx;
        const y = -this.my;
        this.pending =
          Math.abs(x) > Math.abs(y) ? (x > 0 ? 'right' : 'left') : y < -0.15 ? 'down' : 'up';
      }
    });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    addEventListener('pointerup', (e) => {
      if (e.pointerType !== 'mouse') return;
      if (e.button === 0) this.mouseFlap = false;
      if (e.button === 2) this.rightDown = false;
    });
    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
      if (this.locked) this.mx = this.my = 0;
    });
  }

  private isSteerKey(k: string): boolean {
    return /^(Key[WASD]|Arrow(Up|Down|Left|Right))$/.test(k);
  }

  togglePointerLock(): void {
    if (document.pointerLockElement) document.exitPointerLock();
    else this.canvas.requestPointerLock?.();
  }

  releasePointerLock(): void {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  /** Map a raw offset (fraction of half-screen) through dead zone and range to -1..1. */
  private shape(v: number): number {
    const dz = Config.input.mouseDeadZone;
    const a = Math.abs(v);
    if (a < dz) return 0;
    return Math.sign(v) * clamp((a - dz) / (Config.input.mouseRange - dz), 0, 1);
  }

  update(): FlightInput {
    const s = this.state;
    this.pollGamepad();
    if (this.touch.steerX !== 0 || this.touch.steerY !== 0) this.device = 'touch';
    let x = 0;
    let y = 0;
    switch (this.device) {
      case 'keys': {
        const k = this.keys;
        x =
          (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) -
          (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
        y =
          (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) -
          (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
        break;
      }
      case 'mouse':
        x = this.locked ? this.mx : this.shape(this.mx);
        y = -(this.locked ? this.my : this.shape(this.my));
        break;
      case 'touch':
        x = this.touch.steerX;
        y = this.touch.steerY;
        break;
      case 'pad':
        x = this.padX;
        y = this.padY;
        break;
    }
    const flick = this.touch.takeFlick();
    if (flick) {
      this.pending = flick;
      this.device = 'touch';
    }
    // The hold: still pushing the way the gesture went (right button for the mouse).
    const td = this.trickDir;
    s.trickHeld =
      this.enabled &&
      td !== null &&
      (this.device === 'mouse'
        ? this.rightDown
        : (td === 'left' ? -x : td === 'right' ? x : td === 'up' ? y : -y) > 0.4);
    s.trick = null;
    if (this.pending && this.enabled) {
      s.trick = trickFor(this.pending);
      this.trickDir = this.pending;
      s.trickHeld = true;
    }
    this.pending = null;
    if (Config.input.invertY) y = -y;
    s.steerX = this.enabled ? x : 0;
    s.steerY = this.enabled ? y : 0;
    s.flap =
      this.enabled && (this.keys.has('Space') || this.mouseFlap || this.touch.flap || this.padFlap);
    return s;
  }

  private padX = 0;
  private padY = 0;
  private pollGamepad(): void {
    const pad = navigator.getGamepads?.()[0];
    if (!pad) return;
    const dz = (v: number) => (Math.abs(v) < 0.15 ? 0 : (v - Math.sign(v) * 0.15) / 0.85);
    this.padX = dz(pad.axes[0] ?? 0);
    this.padY = -dz(pad.axes[1] ?? 0);
    if (this.padX !== 0 || this.padY !== 0) this.device = 'pad';
    // The stick snapped to an edge counts as a press of that direction (released past halfway).
    const ax = Math.abs(this.padX);
    const ay = Math.abs(this.padY);
    const edge: Dir | null =
      Math.max(ax, ay) > 0.85
        ? ax > ay
          ? this.padX > 0
            ? 'right'
            : 'left'
          : this.padY > 0
            ? 'up'
            : 'down'
        : null;
    if (edge && edge !== this.padDir && this.padTaps.press(edge, performance.now() / 1000))
      this.pending = edge;
    if (edge) this.padDir = edge;
    else if (Math.max(ax, ay) < 0.5) this.padDir = null;
    this.padFlap = !!(pad.buttons[0]?.pressed || pad.buttons[7]?.pressed);
    const pause = !!pad.buttons[9]?.pressed;
    if (pause && !this.padPausePrev) this.pausePressed = true;
    this.padPausePrev = pause;
  }
}

function keyDir(code: string): Dir | null {
  if (code === 'KeyW' || code === 'ArrowUp') return 'up';
  if (code === 'KeyS' || code === 'ArrowDown') return 'down';
  if (code === 'KeyA' || code === 'ArrowLeft') return 'left';
  if (code === 'KeyD' || code === 'ArrowRight') return 'right';
  return null;
}

/** Up (as steered: nose up, so it follows invert-Y) loops, down dive-bombs, sideways rolls. */
function trickFor(dir: Dir): TrickKind {
  const inv = Config.input.invertY;
  if (dir === 'left') return 'rollL';
  if (dir === 'right') return 'rollR';
  return (dir === 'up') !== inv ? 'loop' : 'dive';
}
