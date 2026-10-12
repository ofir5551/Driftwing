import type { Settings } from '../core/Settings';

export interface MenuHandlers {
  play(): void;
  resume(): void;
  pause(): void;
  change(s: Settings): void;
}

const isTouch = () => matchMedia('(pointer: coarse)').matches;

/** Start screen and pause menu, plain DOM. The world keeps flying behind both. */
export class Menu {
  private readonly start: HTMLDivElement;
  private readonly pause: HTMLDivElement;
  private readonly pauseBtn: HTMLButtonElement;
  private readonly best: HTMLElement;
  private readonly pauseStats: HTMLElement;

  constructor(ui: HTMLElement, settings: Settings, h: MenuHandlers) {
    const controls = isTouch()
      ? `<li><b>Drag</b> anywhere to steer</li><li><b>Hold the wing button</b> (or tap with a second finger) to flap</li>`
      : `<li><b>Mouse</b> or <b>WASD</b> to steer</li><li><b>Click</b> or <b>Space</b> to flap</li><li><b>P</b> pause · <b>M</b> mute · <b>L</b> lock pointer</li>`;
    this.start = this.panel(
      'start',
      `<h1>Driftwing</h1>
       <p class="tag">Glide. Gather the light. Breathe.</p>
       <button class="btn primary" id="play-btn">Play</button>
       <ul class="controls">${controls}</ul>
       <p class="best" hidden></p>`,
    );
    this.best = this.start.querySelector('.best')!;
    this.pause = this.panel(
      'pause',
      `<h2>Paused</h2>
       <p class="pause-stats"></p>
       <button class="btn primary" id="resume-btn">Resume</button>
       <div class="settings">
         <label>Volume <input type="range" id="vol" min="0" max="1" step="0.01"></label>
         <label class="row"><input type="checkbox" id="mute"> Mute</label>
         <label>Quality
           <select id="quality">
             <option value="auto">Auto</option><option value="low">Low</option>
             <option value="medium">Medium</option><option value="high">High</option>
           </select>
         </label>
         <label class="row"><input type="checkbox" id="invert"> Invert vertical steering</label>
         <label class="row touch-only"><input type="checkbox" id="lefty"> Left-handed (flap button on the left)</label>
       </div>`,
    );
    this.pauseStats = this.pause.querySelector('.pause-stats')!;
    this.pauseBtn = document.createElement('button');
    this.pauseBtn.className = 'pause-btn';
    this.pauseBtn.setAttribute('aria-label', 'Pause');
    this.pauseBtn.innerHTML = '<span></span><span></span>';
    ui.append(this.start, this.pause, this.pauseBtn);

    this.start.querySelector('#play-btn')!.addEventListener('click', () => h.play());
    this.pause.querySelector('#resume-btn')!.addEventListener('click', () => h.resume());
    this.pauseBtn.addEventListener('click', () => h.pause());
    const vol = this.pause.querySelector<HTMLInputElement>('#vol')!;
    const mute = this.pause.querySelector<HTMLInputElement>('#mute')!;
    const quality = this.pause.querySelector<HTMLSelectElement>('#quality')!;
    const invert = this.pause.querySelector<HTMLInputElement>('#invert')!;
    const lefty = this.pause.querySelector<HTMLInputElement>('#lefty')!;
    const sync = () => {
      vol.value = String(settings.volume);
      mute.checked = settings.muted;
      quality.value = settings.quality;
      invert.checked = settings.invertY;
      lefty.checked = settings.leftHanded;
    };
    sync();
    this.syncInputs = sync;
    const changed = () => {
      settings.volume = Number(vol.value);
      settings.muted = mute.checked;
      settings.quality = quality.value as Settings['quality'];
      settings.invertY = invert.checked;
      settings.leftHanded = lefty.checked;
      h.change(settings);
    };
    for (const el of [vol, mute, quality, invert, lefty]) el.addEventListener('input', changed);
    // Keep keyboard/mouse events on menus from steering or flapping the bird.
    for (const p of [this.start, this.pause])
      p.addEventListener('pointerdown', (e) => e.stopPropagation());
  }

  /** Re-read settings into the form (e.g. after M toggles mute). */
  syncInputs: () => void;

  private panel(cls: string, html: string): HTMLDivElement {
    const el = document.createElement('div');
    el.className = `menu ${cls}`;
    el.innerHTML = `<div class="card">${html}</div>`;
    return el;
  }

  showStart(best: number): void {
    if (best > 0) {
      this.best.hidden = false;
      this.best.textContent = `Best: ${best.toLocaleString()}`;
    }
    this.start.classList.add('show');
    this.pause.classList.remove('show');
    this.pauseBtn.classList.remove('show');
  }

  showPlaying(): void {
    this.start.classList.remove('show');
    this.pause.classList.remove('show');
    this.pauseBtn.classList.add('show');
  }

  showPause(score: number, best: number, wisps: number): void {
    this.syncInputs();
    this.pauseStats.textContent = `${wisps} wisps · ${score.toLocaleString()} points · best ${best.toLocaleString()}`;
    this.pause.classList.add('show');
    this.pauseBtn.classList.remove('show');
  }
}
