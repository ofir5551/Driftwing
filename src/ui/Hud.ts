import type { Progress } from '../core/Progress';

const R = 26;
const CIRC = 2 * Math.PI * R;

/**
 * Minimal HUD: a flow ring around the wisp count, the score beneath, lanterns reached beside.
 * It fades away when nothing is happening so the landscape gets the screen.
 */
export class Hud {
  readonly el: HTMLDivElement;
  private readonly arc: SVGCircleElement;
  private readonly count: HTMLSpanElement;
  private readonly score: HTMLSpanElement;
  private readonly lanterns: HTMLSpanElement;
  private readonly toastEl: HTMLDivElement;
  private toastTimer = 0;
  private readonly trickEl: HTMLDivElement;
  private trickTimer = 0;
  private opacity = 0;
  private lastCount = -1;
  private lastScore = -1;
  private lastLanterns = -1;
  visible = false;

  constructor(ui: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'hud';
    this.el.innerHTML = `
      <div class="hud-ring">
        <svg viewBox="0 0 64 64" aria-hidden="true">
          <circle cx="32" cy="32" r="${R}" class="ring-bg"/>
          <circle cx="32" cy="32" r="${R}" class="ring-flow" stroke-dasharray="${CIRC}" stroke-dashoffset="${CIRC}"/>
        </svg>
        <span class="hud-count">0</span>
      </div>
      <div class="hud-side">
        <span class="hud-score">0</span>
        <span class="hud-lanterns" title="Lanterns reached"></span>
      </div>`;
    this.toastEl = document.createElement('div');
    this.toastEl.className = 'toast';
    this.trickEl = document.createElement('div');
    this.trickEl.className = 'trick-toast';
    ui.append(this.el, this.toastEl, this.trickEl);
    this.arc = this.el.querySelector('.ring-flow')!;
    this.count = this.el.querySelector('.hud-count')!;
    this.score = this.el.querySelector('.hud-score')!;
    this.lanterns = this.el.querySelector('.hud-lanterns')!;
  }

  toast(text: string, seconds = 3): void {
    this.toastEl.textContent = text;
    this.toastEl.classList.add('show');
    this.toastTimer = seconds;
  }

  /** A landed trick's (or reached lantern's) name and points: smaller and quicker than a toast, never covering one. */
  trick(name: string, points: number): void {
    this.trickEl.textContent = points > 0 ? `${name}  +${points.toLocaleString()}` : name;
    this.trickEl.classList.remove('show');
    void this.trickEl.offsetWidth; // restart the CSS transition for back-to-back tricks
    this.trickEl.classList.add('show');
    this.trickTimer = 1.4;
  }

  pulse(): void {
    this.el.classList.remove('pop');
    void this.el.offsetWidth; // restart the CSS animation
    this.el.classList.add('pop');
  }

  update(dt: number, p: Progress, forceShow: boolean): void {
    // Visible while active (recent pickups or flow), then a slow fade out.
    const active = forceShow || p.idle < 4 || p.flow > 0.05;
    const target = this.visible && active ? 1 : this.visible ? 0 : 0;
    this.opacity += (target - this.opacity) * Math.min(1, dt * (target > this.opacity ? 6 : 0.8));
    this.el.style.opacity = this.opacity.toFixed(3);
    if (p.count !== this.lastCount) {
      this.lastCount = p.count;
      this.count.textContent = String(p.count);
    }
    if (p.score !== this.lastScore) {
      this.lastScore = p.score;
      this.score.textContent = p.score.toLocaleString();
    }
    if (p.reached !== this.lastLanterns) {
      this.lastLanterns = p.reached;
      this.lanterns.textContent = p.reached > 0 ? `✦ ${p.reached}` : '';
    }
    this.arc.style.strokeDashoffset = (CIRC * (1 - p.flow)).toFixed(1);
    this.el.classList.toggle('flowing', p.flow > 0.6);
    if (this.trickTimer > 0) {
      this.trickTimer -= dt;
      if (this.trickTimer <= 0) this.trickEl.classList.remove('show');
    }
    if (this.toastTimer > 0) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) this.toastEl.classList.remove('show');
    }
  }
}
