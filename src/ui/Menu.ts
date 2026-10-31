import { unlockAt, type Journey, type Unlock, type UnlockKind } from '../core/Journey';
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
  /** Pause menu or Rest card -> back to the title screen to pick another level. */
  toTitle(): void;
  /** Pause menu -> end the flight with the Rest card. */
  rest(): void;
  /** Rest card -> a new flight from where the bird is. */
  keepFlying(): void;
  resume(): void;
  pause(): void;
  change(s: Settings): void;
}

/** The Controls panel. Every list is built; `body.touch` picks the one for this device and
 *  `body.steer-*` the touch steering scheme. */
const CONTROLS_HTML = `<h2>Controls</h2>
  <div class="controls-list touch-only">
    <ul class="controls touch-drag">
      <li><b>Drag</b> anywhere to steer, relative to where your finger went down</li>
      <li><b>Tap with a second finger</b> while steering to boost (hold to keep flapping)</li>
      <li><b>Flick</b> the steering finger for a trick: left or right rolls, up loops, down dives. Keep pushing to stretch it</li>
    </ul>
    <ul class="controls touch-dpad">
      <li><b>D-pad</b> at the bottom left to steer; rest between two arrows for a diagonal, or slide round without lifting</li>
      <li><b>Boost</b> at the bottom right to flap (hold to keep flapping)</li>
      <li><b>Double-tap</b> an arrow for a trick: left or right rolls, up loops, down dives. Keep holding it to stretch it</li>
    </ul>
    <ul class="controls touch-split">
      <li><b>Two pads</b>: the left one turns <b>left</b>, the right one turns <b>right</b>, and both climb and dive. One works at a time: while you hold one, the other rests. Rest between two arrows for a diagonal, or slide round without lifting</li>
      <li><b>Boost</b> above the right pad to flap (hold to keep flapping)</li>
      <li><b>Double-tap</b> an arrow for a trick: left or right rolls, up loops, down dives. Keep holding it to stretch it</li>
    </ul>
    <ul class="controls touch-arrows">
      <li><b>Left</b> and <b>right</b> under each thumb, with <b>up</b> and <b>down</b> beside both, so one thumb turns while the other climbs or dives. Slide between them without lifting</li>
      <li><b>Boost</b> above the right arrows to flap (hold to keep flapping)</li>
      <li><b>Double-tap</b> an arrow for a trick: left or right rolls, up loops, down dives. Keep holding it to stretch it</li>
    </ul>
    <ul class="controls">
      <li><b>Pause</b> with the button at the top right. Pick <b>Drag</b>, <b>D-pad</b>, <b>Side arrows</b> or <b>Split</b> steering there</li>
    </ul>
  </div>
  <div class="controls-list desktop-only">
    <h3>Mouse</h3>
    <ul class="controls">
      <li><b>Move</b> the pointer away from the centre to steer</li>
      <li><b>Click</b> to boost (hold to keep flapping)</li>
      <li><b>Right-click</b> toward a direction for a trick; hold it to stretch the trick</li>
    </ul>
    <h3>Keyboard</h3>
    <ul class="controls">
      <li><b>WASD</b> or <b>arrows</b> to steer, <b>Space</b> to boost</li>
      <li><b>Double-tap</b> a direction for a trick: left or right rolls, up loops, down dives</li>
      <li><b>P</b> or <b>Esc</b> pause · <b>M</b> mute · <b>L</b> lock the pointer</li>
    </ul>
    <h3>Gamepad</h3>
    <ul class="controls">
      <li><b>Left stick</b> to steer, <b>A</b> or <b>RT</b> to boost, <b>Start</b> to pause</li>
      <li><b>Push the stick</b> to the edge twice for a trick</li>
    </ul>
  </div>
  <button class="btn primary" id="controls-back">Back</button>`;

/** The journey bar: lifetime light, the next milestone and how close it is. Title and pause. */
const JOURNEY_HTML = `<div class="journey" title="Light: gathered from wisps, lanterns and tricks. It opens new places and birds.">
    <div class="journey-head"><span class="journey-light"></span><span class="journey-next"></span></div>
    <div class="journey-track"><div class="journey-fill"></div></div>
  </div>`;

/** What the Rest card tallies for the flight just ended. */
export interface RestTally {
  /** The level's name. */
  level: string;
  wisps: number;
  lanterns: number;
  tricks: number;
  score: number;
  best: number;
  newBest: boolean;
  seconds: number;
}

const KIND_LABEL: Record<UnlockKind, string> = {
  level: 'New place',
  species: 'New bird',
  plumage: 'New plumage',
  trail: 'New trail',
};
const KIND_DETAIL: Record<Exclude<UnlockKind, 'level'>, string> = {
  species: 'A new bird to fly',
  plumage: 'New feathers for your bird',
  trail: 'New colours for your wingtip trails',
};
const FILL_MS = 900; // matches .journey-fill's transition
const STEP_MS = 1150; // one fill plus a breath before the next

/** Start screen and pause menu, plain DOM. The world keeps flying behind both. */
export class Menu {
  private readonly start: HTMLDivElement;
  private readonly pause: HTMLDivElement;
  private readonly rest: HTMLDivElement;
  /** Bumped whenever the Rest card's animation should stop (it is shown again or left). */
  private restToken = 0;
  private readonly help: HTMLDivElement;
  /** The screen the Controls panel returns to. */
  private helpFrom: HTMLDivElement | null = null;
  private readonly pauseBtn: HTMLButtonElement;
  private readonly best: HTMLElement;
  private readonly pauseStats: HTMLElement;
  private readonly levelCards: HTMLButtonElement[];
  private readonly journeyBars: HTMLElement[];
  private readonly timeChips: HTMLButtonElement[];
  /** Only exists where the Fullscreen API does. */
  private fsBtn?: HTMLButtonElement;

  constructor(
    ui: HTMLElement,
    settings: Settings,
    private readonly journey: Journey,
    h: MenuHandlers,
  ) {
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
       ${JOURNEY_HTML}
       <button class="btn primary" id="play-btn">Play</button>
       <button class="btn ghost controls-btn">Controls</button>
       <button class="fs-nudge" hidden>⤢ Best played fullscreen</button>
       <p class="fs-tip" hidden>For fullscreen, tap Share, then <b>Add to Home Screen</b>, and open Driftwing from there.</p>
       <p class="best" hidden></p>`,
    );
    this.best = this.start.querySelector('.best')!;
    this.pause = this.panel(
      'pause',
      `<h2>Paused</h2>
       <p class="pause-stats"></p>
       ${JOURNEY_HTML}
       <button class="btn primary" id="resume-btn">Resume</button>
       <button class="btn ghost" id="rest-btn" title="End this flight and see how it went">Rest</button>
       <button class="btn ghost" id="title-btn">Change level</button>
       <button class="btn ghost controls-btn">Controls</button>
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
         <label class="touch-only">Steering
           <select id="steer">
             <option value="drag">Drag anywhere</option><option value="dpad">D-pad</option>
             <option value="arrows">Side arrows</option>
             <option value="split">Split</option>
           </select>
         </label>
       </div>`,
    );
    this.pauseStats = this.pause.querySelector('.pause-stats')!;
    this.help = this.panel('help', CONTROLS_HTML);
    this.rest = this.panel(
      'rest',
      `<h2>Rest</h2>
       <p class="rest-sub"></p>
       <div class="tally"></div>
       <p class="rest-best"></p>
       ${JOURNEY_HTML}
       <div class="unlock-cards"></div>
       <button class="btn primary" id="fly-btn">Keep flying</button>
       <button class="btn ghost" id="rest-title-btn">Title</button>`,
    );
    this.journeyBars = [this.start, this.pause, this.rest].map((p) =>
      p.querySelector<HTMLElement>('.journey')!,
    );
    this.pauseBtn = document.createElement('button');
    this.pauseBtn.className = 'pause-btn';
    this.pauseBtn.setAttribute('aria-label', 'Pause');
    this.pauseBtn.innerHTML = '<span></span><span></span>';
    ui.append(this.start, this.pause, this.rest, this.help, this.pauseBtn);
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
    this.pause.querySelector('#rest-btn')!.addEventListener('click', () => h.rest());
    this.rest.querySelector('#fly-btn')!.addEventListener('click', () => h.keepFlying());
    this.rest.querySelector('#rest-title-btn')!.addEventListener('click', () => h.toTitle());
    this.pauseBtn.addEventListener('click', () => h.pause());
    for (const from of [this.start, this.pause])
      from.querySelector('.controls-btn')!.addEventListener('click', () => this.showHelp(from));
    this.help.querySelector('#controls-back')!.addEventListener('click', () => this.hideHelp());
    const vol = this.pause.querySelector<HTMLInputElement>('#vol')!;
    const mute = this.pause.querySelector<HTMLInputElement>('#mute')!;
    const quality = this.pause.querySelector<HTMLSelectElement>('#quality')!;
    const invert = this.pause.querySelector<HTMLInputElement>('#invert')!;
    const steer = this.pause.querySelector<HTMLSelectElement>('#steer')!;
    const sync = () => {
      vol.value = String(settings.volume);
      mute.checked = settings.muted;
      quality.value = settings.quality;
      invert.checked = settings.invertY;
      steer.value = settings.touchSteer;
    };
    sync();
    this.syncInputs = sync;
    const changed = () => {
      settings.volume = Number(vol.value);
      settings.muted = mute.checked;
      settings.quality = quality.value as Settings['quality'];
      settings.invertY = invert.checked;
      settings.touchSteer = steer.value as Settings['touchSteer'];
      h.change(settings);
    };
    for (const el of [vol, mute, quality, invert, steer]) el.addEventListener('input', changed);
    // Keep keyboard/mouse events on menus from steering or flapping the bird.
    for (const p of [this.start, this.pause, this.rest, this.help])
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

  /** Swap the title or pause card for the Controls panel; Back returns to it. */
  private showHelp(from: HTMLDivElement): void {
    this.helpFrom = from;
    from.classList.remove('show');
    this.help.classList.add('show');
  }

  private hideHelp(): void {
    this.help.classList.remove('show');
    this.helpFrom?.classList.add('show');
    this.helpFrom = null;
  }

  private markTime(t: TimeOfDay): void {
    for (const chip of this.timeChips) {
      const on = chip.dataset.time === t;
      chip.classList.toggle('selected', on);
      chip.setAttribute('aria-checked', String(on));
    }
  }

  /** Redraws the journey bars; `flight` adds what this flight has earned (the pause screen). */
  private showJourney(bar: HTMLElement, flight: boolean): void {
    const j = this.journey;
    const next = j.next();
    const gained =
      flight && j.flightLight > 0 ? `  +${j.flightLight.toLocaleString()} this flight` : '';
    bar.querySelector('.journey-light')!.textContent = `✧ ${j.light.toLocaleString()}${gained}`;
    bar.querySelector('.journey-next')!.textContent = next
      ? `Next: ${next.name} at ${unlockAt(next.id).toLocaleString()}`
      : 'Journey complete';
    bar.querySelector<HTMLElement>('.journey-fill')!.style.transform =
      `scaleX(${j.fraction().toFixed(3)})`;
  }

  /** Shows only `panel` (or none), with the pause button only while flying. */
  private only(panel: HTMLDivElement | null): void {
    this.restToken++;
    for (const p of [this.start, this.pause, this.rest, this.help])
      p.classList.toggle('show', p === panel);
    this.pauseBtn.classList.toggle('show', panel === null);
    this.fsBtn?.classList.toggle('show', panel !== null);
  }

  /**
   * The end of a flight: the tally, then the journey bar filling from where the flight began to
   * where it ended, a card rising for each unlock as the bar reaches it. Unlocks from earlier
   * flights that never had a card appear at once.
   */
  showRest(t: RestTally, unlocks: readonly Unlock[]): void {
    this.only(this.rest);
    const token = this.restToken;
    const j = this.journey;
    const r = this.rest;
    const min = Math.floor(t.seconds / 60);
    r.querySelector('.rest-sub')!.textContent =
      min > 0 ? `${t.level} · ${min} min` : `${t.level} · under a minute`;
    const stat = (n: number, label: string) =>
      `<div><b>${n.toLocaleString()}</b><span>${label}</span></div>`;
    r.querySelector('.tally')!.innerHTML =
      stat(t.wisps, t.wisps === 1 ? 'wisp' : 'wisps') +
      stat(t.lanterns, t.lanterns === 1 ? 'lantern' : 'lanterns') +
      stat(t.tricks, t.tricks === 1 ? 'trick' : 'tricks') +
      stat(t.score, 'points');
    const best = r.querySelector<HTMLElement>('.rest-best')!;
    best.textContent = t.newBest ? 'A new best' : `Best ${t.best.toLocaleString()}`;
    best.classList.toggle('new', t.newBest);
    const cards = r.querySelector<HTMLElement>('.unlock-cards')!;
    cards.replaceChildren();

    // The bar starts where the flight began; the light counts up as it fills.
    const bar = this.journeyBars[2];
    this.showJourney(bar, false);
    const fill = bar.querySelector<HTMLElement>('.journey-fill')!;
    const lightEl = bar.querySelector<HTMLElement>('.journey-light')!;
    const setFill = (f: number, instant: boolean) => {
      if (instant) fill.style.transition = 'none';
      fill.style.transform = `scaleX(${f.toFixed(3)})`;
      if (instant) {
        void fill.offsetWidth; // apply the jump before the transition comes back
        fill.style.transition = '';
      }
    };
    setFill(j.startFraction, true);
    const fills = Math.min(j.flightOpened, unlocks.length);
    const early = unlocks.length - fills;
    for (let i = 0; i < early; i++) cards.appendChild(this.unlockCard(unlocks[i]));
    const later = (ms: number, fn: () => void) =>
      setTimeout(() => token === this.restToken && fn(), ms);
    let at = 450;
    for (let i = 0; i < fills; i++) {
      later(at, () => setFill(1, false));
      later(at + FILL_MS, () => {
        cards.appendChild(this.unlockCard(unlocks[early + i]));
        setFill(0, true);
      });
      at += STEP_MS;
    }
    later(at, () => setFill(j.fraction(), false));

    const from = j.startLight;
    const to = j.light;
    const t0 = performance.now() + 450;
    const span = Math.max(FILL_MS, at + FILL_MS - 450);
    lightEl.textContent = `✧ ${from.toLocaleString()}`;
    const count = (now: number) => {
      if (token !== this.restToken) return;
      const k = Math.min(1, Math.max(0, (now - t0) / span));
      const eased = 1 - (1 - k) * (1 - k);
      const v = Math.round(from + (to - from) * eased);
      lightEl.textContent = `✧ ${v.toLocaleString()}  +${(v - from).toLocaleString()}`;
      if (k < 1) requestAnimationFrame(count);
    };
    if (to > from) requestAnimationFrame(count);
  }

  private unlockCard(u: Unlock): HTMLElement {
    const el = document.createElement('div');
    el.className = `unlock-card ${u.kind}`;
    const detail =
      u.kind === 'level'
        ? (LEVEL_LIST.find((l) => l.id === u.id)?.blurb ?? '')
        : KIND_DETAIL[u.kind];
    el.innerHTML = `<span class="unlock-kind">${KIND_LABEL[u.kind]}</span><b></b><span class="unlock-detail"></span>`;
    el.querySelector('b')!.textContent = u.name;
    el.querySelector('.unlock-detail')!.textContent = detail;
    return el;
  }

  showStart(best: number, level: LevelId): void {
    this.showJourney(this.journeyBars[0], false);
    this.best.hidden = best <= 0;
    this.best.textContent = `Best: ${best.toLocaleString()}`;
    for (const card of this.levelCards) {
      const on = card.dataset.level === level;
      card.classList.toggle('selected', on);
      card.setAttribute('aria-checked', String(on));
    }
    this.only(this.start);
  }

  showPlaying(): void {
    this.only(null);
  }

  showPause(score: number, best: number, wisps: number): void {
    this.syncInputs();
    this.showJourney(this.journeyBars[1], true);
    this.pauseStats.textContent = `${wisps} wisps · ${score.toLocaleString()} points · best ${best.toLocaleString()}`;
    this.only(this.pause);
  }
}
