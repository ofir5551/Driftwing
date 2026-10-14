import type { Settings } from '../core/Settings';
import { LEVEL_LIST } from '../levels';
import type { LevelId } from '../levels/World';
import { TIME_OF_DAY_LIST, type TimeOfDay } from '../world/DayCycle';
import {
  fullscreenSupport,
  isFullscreen,
  onFullscreenChange,
  toggleFullscreen,
} from './Fullscreen';

export interface MenuHandlers {
  play(): void;
  /** A level card was picked on the title screen. */
  selectLevel(id: LevelId): void;
  /** A time-of-day chip was picked on the title screen. */
  selectTime(t: TimeOfDay): void;
  /** Pause menu -> back to the title screen to pick another level. */
  toTitle(): void;
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
  private readonly levelCards: HTMLButtonElement[];
  private readonly timeChips: HTMLButtonElement[];
  /** Only exists where the Fullscreen API does. */
  private fsBtn?: HTMLButtonElement;

  constructor(ui: HTMLElement, settings: Settings, h: MenuHandlers) {
    const controls = isTouch()
      ? `<li><b>Drag</b> anywhere to steer</li><li><b>Hold the wing button</b> (or tap with a second finger) to flap</li>`
      : `<li><b>Mouse</b> or <b>WASD</b> to steer</li><li><b>Click</b> or <b>Space</b> to flap</li><li><b>P</b> pause · <b>M</b> mute · <b>L</b> lock pointer</li>`;
    this.start = this.panel(
      'start',
      `<h1>Driftwing</h1>
       <p class="tag">Glide. Gather the light. Breathe.</p>
       <div class="levels" role="radiogroup" aria-label="Level">${LEVEL_LIST.map(
         (l) =>
           `<button class="level" role="radio" aria-checked="false" data-level="${l.id}">
              <span class="level-name">${l.name}</span><span class="level-blurb">${l.blurb}</span>
            </button>`,
       ).join('')}</div>
       <div class="times" role="radiogroup" aria-label="Time of day">${TIME_OF_DAY_LIST.map(
         (t) =>
           `<button class="time" role="radio" aria-checked="false" data-time="${t.id}">${t.label}</button>`,
       ).join('')}</div>
       <button class="btn primary" id="play-btn">Play</button>
       <button class="fs-nudge" hidden>⤢ Best played fullscreen</button>
       <p class="fs-tip" hidden>For fullscreen, tap Share, then <b>Add to Home Screen</b>, and open Driftwing from there.</p>
       <ul class="controls">${controls}</ul>
       <p class="best" hidden></p>`,
    );
    this.best = this.start.querySelector('.best')!;
    this.pause = this.panel(
      'pause',
      `<h2>Paused</h2>
       <p class="pause-stats"></p>
       <button class="btn primary" id="resume-btn">Resume</button>
       <button class="btn ghost" id="title-btn">Change level</button>
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
    this.setupFullscreen(ui);

    this.start.querySelector('#play-btn')!.addEventListener('click', () => h.play());
    this.levelCards = [...this.start.querySelectorAll<HTMLButtonElement>('.level')];
    for (const card of this.levelCards)
      card.addEventListener('click', () => h.selectLevel(card.dataset.level as LevelId));
    this.timeChips = [...this.start.querySelectorAll<HTMLButtonElement>('.time')];
    for (const chip of this.timeChips)
      chip.addEventListener('click', () => {
        const t = chip.dataset.time as TimeOfDay;
        settings.timeOfDay = t;
        this.markTime(t);
        h.selectTime(t);
      });
    this.markTime(settings.timeOfDay);
    this.pause.querySelector('#resume-btn')!.addEventListener('click', () => h.resume());
    this.pause.querySelector('#title-btn')!.addEventListener('click', () => h.toTitle());
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

  /** Corner button on the title and pause screens (never mid-flight), a nudge on the title, or an
   *  install tip where iPhone has no API. */
  private setupFullscreen(ui: HTMLElement): void {
    const support = fullscreenSupport();
    const nudge = this.start.querySelector<HTMLButtonElement>('.fs-nudge')!;
    const tip = this.start.querySelector<HTMLElement>('.fs-tip')!;
    if (support === 'ios') tip.hidden = false;
    if (support !== 'api') return;
    const btn = document.createElement('button');
    btn.className = 'fs-btn';
    btn.innerHTML =
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>';
    ui.appendChild(btn);
    this.fsBtn = btn;
    const sync = (on: boolean) => {
      btn.setAttribute('aria-label', on ? 'Exit fullscreen' : 'Enter fullscreen');
      btn.classList.toggle('active', on);
      nudge.hidden = on;
    };
    sync(isFullscreen());
    onFullscreenChange(sync);
    for (const el of [btn, nudge]) {
      el.addEventListener('click', () => void toggleFullscreen());
      el.addEventListener('pointerdown', (e) => e.stopPropagation());
    }
  }

  private markTime(t: TimeOfDay): void {
    for (const chip of this.timeChips) {
      const on = chip.dataset.time === t;
      chip.classList.toggle('selected', on);
      chip.setAttribute('aria-checked', String(on));
    }
  }

  showStart(best: number, level: LevelId): void {
    this.best.hidden = best <= 0;
    this.best.textContent = `Best: ${best.toLocaleString()}`;
    for (const card of this.levelCards) {
      const on = card.dataset.level === level;
      card.classList.toggle('selected', on);
      card.setAttribute('aria-checked', String(on));
    }
    this.start.classList.add('show');
    this.pause.classList.remove('show');
    this.pauseBtn.classList.remove('show');
    this.fsBtn?.classList.add('show');
  }

  showPlaying(): void {
    this.start.classList.remove('show');
    this.pause.classList.remove('show');
    this.pauseBtn.classList.add('show');
    this.fsBtn?.classList.remove('show');
  }

  showPause(score: number, best: number, wisps: number): void {
    this.syncInputs();
    this.pauseStats.textContent = `${wisps} wisps · ${score.toLocaleString()} points · best ${best.toLocaleString()}`;
    this.pause.classList.add('show');
    this.pauseBtn.classList.remove('show');
    this.fsBtn?.classList.add('show');
  }
}
