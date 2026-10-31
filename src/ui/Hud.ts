import type { Progress } from '../core/Progress';

const R = 26;
const CIRC = 2 * Math.PI * R;
const NOTICE_SECONDS = 3.5;
const NOTICE_GAP = 0.9; // s after a toast fades before a waiting notice shows

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
  /** Notices waiting for the toast (journey unlocks), so they never cut a hint or lantern short. */
  private readonly notices: string[] = [];
  private noticeGap = 0;
  /** The toast on screen came from the notice queue. */
  private showingNotice = false;
  private readonly trickEl: HTMLDivElement;
  private trickTimer = 0;
  private stoopTenths = -1;
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
    // A notice cut short goes back to the front of the queue.
    if (this.showingNotice && this.toastTimer > 1) this.notices.unshift(this.toastEl.textContent);
    this.show(text, seconds, false);
  }

  /**
   * A quiet message that waits for the toast to be free. It is shown from `update` (a frame),
   * so a toast raised later in the same step (a lantern awakening) still goes first.
   */
  notice(text: string): void {
    this.notices.push(text);
  }

  private show(text: string, seconds: number, notice: boolean): void {
    this.showingNotice = notice;
    this.toastEl.textContent = text;
    this.toastEl.classList.toggle('notice', notice);
    this.toastEl.classList.add('show');
    this.toastTimer = seconds;
  }

  /** A landed trick's (or reached lantern's) name and points: smaller and quicker than a toast, never covering one. */
  trick(name: string, points: number): void {
    this.stoopTenths = -1; // the live readout's text was just replaced
    this.trickEl.textContent = points > 0 ? `${name}  +${points.toLocaleString()}` : name;
    this.trickEl.classList.remove('show');
    void this.trickEl.offsetWidth; // restart the CSS transition for back-to-back tricks
    this.trickEl.classList.add('show');
    this.trickTimer = 1.4;
  }

  /**
   * The running dive-bomb multiplier. Called every step, so the text is only rebuilt when the
   * displayed tenth changes; it fades on its own shortly after the calls stop.
   */
  stoop(scale: number): void {
    const tenths = Math.round(scale * 10);
    if (tenths !== this.stoopTenths) {
      this.stoopTenths = tenths;
      this.trickEl.textContent = `Dive-bomb  ×${(tenths / 10).toFixed(1)}`;
    }
    this.trickEl.classList.add('show');
    this.trickTimer = 0.3;
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
    // Paused, the toast is hidden: a notice keeps its time for when play resumes.
    if (this.toastTimer > 0 && !(forceShow && this.showingNotice)) {
      this.toastTimer -= dt;
      if (this.toastTimer <= 0) {
        this.toastEl.classList.remove('show');
        this.noticeGap = NOTICE_GAP;
      }
    }
    // Notices wait for play (not the title screen, not paused) and for the toast to be free.
    if (this.notices.length > 0 && this.visible && !forceShow && this.toastTimer <= 0) {
      this.noticeGap -= dt;
      if (this.noticeGap <= 0) this.show(this.notices.shift()!, NOTICE_SECONDS, true);
    }
  }
}
