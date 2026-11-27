import {
  isUnlockId,
  unlockAt,
  type Journey,
  type Unlock,
  type UnlockId,
  type UnlockKind,
} from '../core/Journey';
import { CHANGELOG, VERSION, formatDate, unseen } from '../core/Changelog';
import { DEV_CHANNEL } from '../core/channel';
import type { Settings } from '../core/Settings';
import { FULL_GAME_URL } from '../core/channel';
import { LEVEL_LIST, LISTED_LEVELS, PERSONAL_LEVEL } from '../levels';
import type { LevelId } from '../levels/World';
import { TIME_OF_DAY_LIST, type TimeOfDay } from '../world/DayCycle';
import { LEVEL_FINDS } from '../world/Discoveries';
import {
  DEFAULT_PLUMAGE,
  PLUMAGES,
  plumageDef,
  type PlumageDef,
  type PlumageId,
} from '../player/Plumage';
import { DEFAULT_TRAIL, TRAILS, trailDef, type TrailDef, type TrailId } from '../fx/TrailStyle';
import {
  DEFAULT_SPECIES,
  SPECIES,
  speciesDef,
  type SpeciesDef,
  type SpeciesId,
} from '../player/Species';
import {
  fullscreenSupport,
  isFullscreen,
  onFullscreenChange,
  toggleFullscreen,
} from './Fullscreen';

export interface MenuHandlers {
  play(): void;
  /** A level card was picked on the title screen (only open levels can be). */
  selectLevel(id: LevelId): void;
  /** An open level not flown yet: its card wears a "New" mark. */
  isNewLevel(id: LevelId): boolean;
  /** A time-of-day chip was picked on the title screen. */
  selectTime(t: TimeOfDay): void;
  /** An open bird, plumage or trail was picked in the Aviary. */
  selectSpecies(id: SpeciesId): void;
  selectPlumage(id: PlumageId): void;
  selectTrail(id: TrailId): void;
  /** The Aviary opened or closed (the trail shows on a lazy glide while it is open). */
  aviary(open: boolean): void;
  /** Pause menu or Rest card -> back to the title screen to pick another level. */
  toTitle(): void;
  /** Pause menu -> end the flight with the Rest card. */
  rest(): void;
  /** Rest card -> a new flight from where the bird is. */
  keepFlying(): void;
  resume(): void;
  pause(): void;
  change(s: Settings): void;
  /** What's new was opened: everything in it has now been seen. */
  newsSeen(): void;
}

/** What's new: the changelog, newest first; releases since the player last looked wear "New". */
const newsHtml = (fresh: ReadonlySet<string>) => `<div class="settings-head">
    <h2>What’s new</h2><button class="btn primary" id="news-done">Done</button>
  </div>
  <p class="news-sub">Driftwing ${VERSION}${DEV_CHANNEL ? ' (dev)' : ''}</p>
  ${CHANGELOG.map(
    (e) => `<section class="release${fresh.has(e.version) ? ' fresh' : ''}">
      <h3><span class="release-version">${e.version}</span> ${e.title}${
        fresh.has(e.version) ? ' <span class="release-new">New</span>' : ''
      }</h3>
      <p class="release-date">${formatDate(e.date)}</p>
      <ul>${e.items.map((i) => `<li>${i}</li>`).join('')}</ul>
    </section>`,
  ).join('')}`;

/** The Controls panel. Every list is built; `body.touch` picks the one for this device and
 *  `body.steer-*` the touch steering scheme. */
const CONTROLS_HTML = `<h2>Controls</h2>
  <div class="controls-list touch-only">
    <ul class="controls touch-drag">
      <li><b>Drag</b> anywhere to steer, relative to where your finger went down</li>
      <li><b>Tap</b> to flap; keep tapping to keep boosting. One finger does it all</li>
      <li><b>Flick</b> the steering finger for a trick: left or right rolls, down dives. Keep pushing to stretch it</li>
    </ul>
    <ul class="controls touch-dpad">
      <li><b>D-pad</b> under one thumb to steer; rest between two arrows for a diagonal, or slide round without lifting</li>
      <li><b>Boost</b> under the other thumb to flap (hold to keep flapping)</li>
      <li><b>Double-tap</b> an arrow for a trick: left or right rolls, down dives. Keep holding it to stretch it</li>
    </ul>
    <ul class="controls touch-split">
      <li><b>Two pads</b>: the left one turns <b>left</b>, the right one turns <b>right</b>, and both climb and dive. One works at a time: while you hold one, the other rests. Rest between two arrows for a diagonal, or slide round without lifting</li>
      <li><b>Boost</b> above one of the pads to flap (hold to keep flapping)</li>
      <li><b>Double-tap</b> an arrow for a trick: left or right rolls, down dives. Keep holding it to stretch it</li>
    </ul>
    <ul class="controls touch-arrows">
      <li><b>Left</b> and <b>right</b> under each thumb, with <b>up</b> and <b>down</b> beside both, so one thumb turns while the other climbs or dives. Slide between them without lifting</li>
      <li><b>Boost</b> above one of the clusters to flap (hold to keep flapping)</li>
      <li><b>Double-tap</b> an arrow for a trick: left or right rolls, down dives. Keep holding it to stretch it</li>
    </ul>
    <ul class="controls">
      <li><b>Pause</b> with the button at the top right. <b>Settings</b> (on the title or in Pause) pick <b>Drag</b>, <b>D-pad</b>, <b>Arrows</b> or <b>Split</b> steering, and <b>Left-handed</b> swaps the buttons' sides</li>
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
      <li><b>Double-tap</b> a direction for a trick: left or right rolls, down dives</li>
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

/** Line icons for the pause tiles and the title's buttons (stroked in currentColor by the CSS). */
const ICON = {
  rest: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/></svg>',
  levels:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6l6-2 6 2 6-2v14l-6 2-6-2-6 2z"/><path d="M9 4v14M15 6v14"/></svg>',
  settings:
    '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/></svg>',
  bird: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 13c3-1 5-3.5 6.5-6 1.5 2 2.5 4 3.5 6.5 2-3 5-5.5 10-6.5-3 3-5 6-7 9.5H8z"/><path d="M8 16.5l-2 3"/></svg>',
};

/** A row of chips that picks one value (Steering, Quality). */
const chipsHtml = (id: string, label: string, opts: readonly (readonly [string, string])[]) =>
  `<div class="chips" id="${id}" role="radiogroup" aria-label="${label}">${opts
    .map(
      ([v, l]) =>
        `<button class="time chip" role="radio" aria-checked="false" data-value="${v}">${l}</button>`,
    )
    .join('')}</div>`;

/** An on/off row: a name, a one-line hint and a switch. The whole row is the button. */
const switchHtml = (id: string, name: string, hint: string) =>
  `<button class="switch-row" id="${id}" role="switch" aria-checked="false">
     <span class="switch-text"><span>${name}</span><small>${hint}</small></span>
     <span class="switch" aria-hidden="true"></span>
   </button>`;

/** Settings, opened from the title or the pause card (Done goes back to whichever). It sits at
 *  the bottom of the screen, under the thumb, with Done as its one bright button. */
const SETTINGS_HTML = `<h2>Settings</h2>
  <div class="setting">${switchHtml('sound', 'Sound', 'Music and effects')}</div>
  <div class="setting touch-only">
    <p class="setting-label">Touch steering</p>
    ${chipsHtml('steer', 'Touch steering', [
      ['drag', 'Drag'],
      ['dpad', 'D-pad'],
      ['arrows', 'Arrows'],
      ['split', 'Split'],
    ])}
    <p class="steer-hint"></p>
    <div class="lefty-row">${switchHtml('lefty', 'Left-handed', 'D-pad right, Boost left')}</div>
  </div>
  <div class="setting">${switchHtml('invert', 'Invert climb / dive', 'Push up to dive, down to climb')}</div>
  <div class="setting">
    <p class="setting-label">Graphics</p>
    ${chipsHtml('quality', 'Quality', [
      ['auto', 'Auto'],
      ['low', 'Low'],
      ['medium', 'Med'],
      ['high', 'High'],
    ])}
  </div>
  <div class="settings-links">
    <button class="btn ghost controls-btn">How to fly</button>
    <button class="btn ghost news-btn" id="news-btn" title="Driftwing ${VERSION}"><span class="news-dot" aria-hidden="true"></span>What’s new</button>
  </div>
  <button class="btn primary" id="settings-done">Done</button>`;

/** What the steering chips' scheme does, under them. */
const STEER_HINT: Record<Settings['touchSteer'], string> = {
  drag: 'Drag anywhere to steer, tap to flap.',
  dpad: 'A D-pad under one thumb, Boost under the other.',
  arrows: 'Left and right under each thumb, up and down beside them.',
  split: 'Two pads: the left turns left, the right turns right.',
};

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
  /** Names of the discoveries made this flight. */
  finds: readonly string[];
  /** Names of the journeys' destinations reached this flight (a bird joined at each). */
  reached: readonly string[];
  /** Birds in the flock now. */
  flock: number;
}

const KIND_LABEL: Record<UnlockKind, string> = {
  level: 'New place',
  species: 'New bird',
  plumage: 'New plumage',
  trail: 'New trail',
};
const KIND_DETAIL: Record<Exclude<UnlockKind, 'level' | 'species'>, string> = {
  plumage: 'New feathers: pick them in Birds',
  trail: 'New wingtip colours: pick them in Birds',
};

/** One Aviary row's item: what the menu needs from a bird, a plumage or a trail. */
interface Pick {
  id: string;
  name: string;
  unlock: PlumageDef['unlock'];
  /** CSS background for its swatch. */
  swatch: string;
}

type Row = 'species' | 'plumage' | 'trail';

const plumageSwatch = ({ colors: c }: PlumageDef) =>
  `linear-gradient(135deg, ${c.cap} 0 24%, ${c.back} 24% 50%, ${c.belly} 50% 76%, ${c.primaryMid} 76%)`;
const trailSwatch = (t: TrailDef) =>
  t.drift > 0
    ? `linear-gradient(90deg, ${t.tip}, ${t.tail}, ${t.tip})`
    : `linear-gradient(90deg, ${t.tip}, ${t.tail})`;
const speciesSwatch = (b: SpeciesDef) => plumageSwatch(plumageDef(b.plumage));

/** The Aviary's rows, one tab each: birds first, the heart of it. */
const ROWS: readonly { row: Row; label: string; picks: Pick[] }[] = [
  {
    row: 'species',
    label: 'Bird',
    picks: SPECIES.map((b) => ({ ...b, swatch: speciesSwatch(b) })),
  },
  {
    row: 'plumage',
    label: 'Plumage',
    picks: PLUMAGES.map((p) => ({ ...p, swatch: plumageSwatch(p) })),
  },
  { row: 'trail', label: 'Trail', picks: TRAILS.map((t) => ({ ...t, swatch: trailSwatch(t) })) },
];

const pickUnlock = (row: Row, id: string): Pick['unlock'] =>
  row === 'species'
    ? speciesDef(id as SpeciesId).unlock
    : row === 'plumage'
      ? plumageDef(id as PlumageId).unlock
      : trailDef(id as TrailId).unlock;

const picksHtml = (row: Row, label: string, picks: Pick[]) =>
  `<div class="aviary-row" data-row="${row}" role="tabpanel" aria-label="${label}"${row === 'species' ? '' : ' hidden'}>
   <div class="picks" role="radiogroup" aria-label="${label}">${picks
     .map(
       (p) =>
         `<button class="pick" role="radio" aria-checked="false" data-row="${row}" data-id="${p.id}">
            <span class="swatch" style="background: ${p.swatch}"></span>
            <span class="pick-name">${p.name}</span><span class="pick-lock"></span>
          </button>`,
     )
     .join('')}</div>${row === 'species' ? '<p class="bird-blurb"></p>' : ''}
   </div>`;

/**
 * The Aviary: which bird, and what it wears. One row at a time behind tabs, so the card stays
 * short on a phone; the bird gliding behind it is the live preview.
 */
const AVIARY_HTML = `<div class="aviary-head">
    <h2>Birds</h2><button class="btn primary" id="aviary-done">Done</button>
  </div>
  <p class="aviary-sub">Your bird flies your choice behind this card.</p>
  <div class="aviary-tabs" role="tablist">${ROWS.map(
    (r) =>
      `<button class="time aviary-tab" role="tab" data-tab="${r.row}" aria-selected="false">${r.label}</button>`,
  ).join('')}</div>
  ${ROWS.map((r) => picksHtml(r.row, r.label, r.picks)).join('')}
  ${JOURNEY_HTML}`;
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
  private readonly settingsPanel: HTMLDivElement;
  private readonly news: HTMLDivElement;
  private readonly newsBtn: HTMLButtonElement;
  private readonly aviary: HTMLDivElement;
  /** A personal channel's last card (the full game, or keep flying); unused elsewhere. */
  private readonly finale: HTMLDivElement;
  private readonly picks: HTMLButtonElement[];
  private readonly tabs: HTMLButtonElement[];
  private readonly birdBlurb: HTMLElement;
  /** The Aviary tab showing (kept between visits). */
  private tab: Row = 'species';
  /** The screen the Controls panel returns to. */
  private helpFrom: HTMLDivElement | null = null;
  private readonly pauseBtn: HTMLButtonElement;
  private readonly playBtn: HTMLButtonElement;
  private readonly dots: HTMLElement;
  /** The screen Settings returns to (the title or the pause card). */
  private settingsFrom: HTMLDivElement | null = null;
  /** The level whose card sits in the middle of the row (may be locked). */
  private focused: LevelId | null = null;
  private swipeTimer = 0;
  private readonly selectLevel: (id: LevelId) => void;
  private readonly pauseStats: HTMLElement;
  private readonly levelCards: HTMLButtonElement[];
  private readonly journeyBars: HTMLElement[];
  private readonly timeChips: HTMLButtonElement[];
  /** Only exists where the Fullscreen API does. */
  private fsBtn?: HTMLButtonElement;

  constructor(
    ui: HTMLElement,
    private readonly settings: Settings,
    private readonly journey: Journey,
    h: MenuHandlers,
    /** The version whose What's new the player last saw. */
    seenVersion: string,
  ) {
    // A personal stage (e.g. a wedding invitation) has its own title.
    const personal = PERSONAL_LEVEL?.personal;
    this.start = this.panel(
      'start',
      `<div class="title-top"><h1></h1><p class="tag"></p></div>
       <div class="title-bottom">
       <div class="levels" role="radiogroup" aria-label="Level">${LISTED_LEVELS.map(
         (l) =>
           `<button class="level" role="radio" aria-checked="false" data-level="${l.id}">
              <span class="level-name">${l.name}</span><span class="level-blurb">${l.blurb}</span>
              <span class="level-finds" hidden></span>
            </button>`,
       ).join('')}</div>
       <div class="level-dots" aria-hidden="true"></div>
       <div class="times" role="radiogroup" aria-label="Time of day">${TIME_OF_DAY_LIST.map(
         (t) =>
           `<button class="time" role="radio" aria-checked="false" data-time="${t.id}">${t.label}</button>`,
       ).join('')}</div>
       <button class="btn primary" id="play-btn">Play</button>
       ${JOURNEY_HTML}
       <nav class="title-nav" aria-label="More">
         <button class="nav-btn" id="aviary-btn">${ICON.bird}<span>Birds</span></button>
         <button class="nav-btn" id="title-settings-btn">${ICON.settings}<span>Settings</span><span class="news-dot" aria-hidden="true"></span></button>
       </nav>
       </div>`,
    );
    this.start.querySelector('h1')!.textContent = personal?.title ?? 'Driftwing';
    this.start.querySelector('.tag')!.textContent =
      personal?.tag ?? 'Glide. Gather the light. Breathe.';
    this.playBtn = this.start.querySelector<HTMLButtonElement>('#play-btn')!;
    this.dots = this.start.querySelector<HTMLElement>('.level-dots')!;
    this.pause = this.panel(
      'pause',
      `<h2>Paused</h2>
       <p class="pause-stats"></p>
       ${JOURNEY_HTML}
       <button class="btn primary" id="resume-btn">Resume</button>
       <div class="pause-tiles">
         <button class="tile" id="rest-btn" title="End this flight and see how it went">${ICON.rest}<span>Rest</span></button>
         <button class="tile" id="title-btn" title="Back to the title to pick a level">${ICON.levels}<span>Levels</span></button>
         <button class="tile" id="settings-btn">${ICON.settings}<span>Settings</span></button>
       </div>`,
    );
    this.pauseStats = this.pause.querySelector('.pause-stats')!;
    this.settingsPanel = this.panel('settings-panel', SETTINGS_HTML);
    this.help = this.panel('help', CONTROLS_HTML);
    this.rest = this.panel(
      'rest',
      `<h2>Rest</h2>
       <p class="rest-sub"></p>
       <div class="tally"></div>
       <p class="rest-best"></p>
       <p class="rest-reached" hidden></p>
       <p class="rest-finds" hidden></p>
       ${JOURNEY_HTML}
       <div class="unlock-cards"></div>
       <button class="btn primary" id="fly-btn">Keep flying</button>
       <button class="btn ghost" id="rest-title-btn">Title</button>`,
    );
    this.aviary = this.panel('aviary', AVIARY_HTML);
    const fresh = new Set(unseen(seenVersion).map((e) => e.version));
    this.news = this.panel('news', newsHtml(fresh));
    this.finale = this.panel(
      'finale',
      `<h2></h2>
       <p class="finale-sub"></p>
       <a class="btn primary" id="full-game-btn" href="${FULL_GAME_URL}">Play the full game</a>
       <button class="btn ghost" id="finale-fly-btn">Keep flying</button>`,
    );
    this.journeyBars = [this.start, this.pause, this.rest, this.aviary].map((p) =>
      p.querySelector<HTMLElement>('.journey')!,
    );
    this.pauseBtn = document.createElement('button');
    this.pauseBtn.className = 'pause-btn';
    this.pauseBtn.setAttribute('aria-label', 'Pause');
    this.pauseBtn.innerHTML = '<span></span><span></span>';
    ui.append(
      this.start,
      this.pause,
      this.settingsPanel,
      this.rest,
      this.help,
      this.aviary,
      this.news,
      this.finale,
      this.pauseBtn,
    );
    this.setupFullscreen(ui);

    this.playBtn.addEventListener('click', () => {
      if (!this.playBtn.disabled) h.play();
    });
    this.selectLevel = (id) => h.selectLevel(id);
    this.levelCards = [...this.start.querySelectorAll<HTMLButtonElement>('.level')];
    // Swiping picks: the card that comes to rest in the middle is the place. Tapping a card
    // slides it there; tapping the middle one when it is locked shows how close it is.
    for (const card of this.levelCards)
      card.addEventListener('click', () => {
        const id = card.dataset.level as LevelId;
        if (id !== this.focused) this.centreLevel(id, true);
        else if (!this.journey.isLevelOpen(id)) this.nudgeJourney(this.journeyBars[0]);
      });
    const row = this.levelCards[0].parentElement!;
    row.addEventListener(
      'scroll',
      () => {
        clearTimeout(this.swipeTimer);
        this.swipeTimer = window.setTimeout(() => this.settle(), 120);
      },
      { passive: true },
    );
    this.isNewLevel = (id) => h.isNewLevel(id);
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
    this.finale.querySelector('#finale-fly-btn')!.addEventListener('click', () => h.resume());
    if (personal) {
      this.finale.querySelector('h2')!.textContent = personal.finaleTitle;
      this.finale.querySelector('.finale-sub')!.textContent = personal.finaleText;
      // Only the title is left to go back to, and it is the stage's own.
      this.pause.querySelector('#title-btn span')!.textContent = 'Title';
    }
    this.settingsPanel
      .querySelector('.controls-btn')!
      .addEventListener('click', () => this.showHelp(this.settingsPanel));
    this.pause
      .querySelector('#settings-btn')!
      .addEventListener('click', () => this.showSettings(this.pause));
    this.start
      .querySelector('#title-settings-btn')!
      .addEventListener('click', () => this.showSettings(this.start));
    this.settingsPanel
      .querySelector('#settings-done')!
      .addEventListener('click', () => this.only(this.settingsFrom ?? this.start));
    this.help.querySelector('#controls-back')!.addEventListener('click', () => this.hideHelp());
    this.start.querySelector('#aviary-btn')!.addEventListener('click', () => {
      this.showAviary();
      h.aviary(true);
    });
    this.aviary.querySelector('#aviary-done')!.addEventListener('click', () => {
      h.aviary(false);
      this.only(this.start);
    });
    this.newsBtn = this.settingsPanel.querySelector<HTMLButtonElement>('#news-btn')!;
    this.markNews(fresh.size > 0);
    this.newsBtn.addEventListener('click', () => {
      this.only(this.news);
      this.news.querySelector('.card')!.scrollTop = 0;
      this.markNews(false); // the releases keep their "New" until the next visit
      h.newsSeen();
    });
    this.news
      .querySelector('#news-done')!
      .addEventListener('click', () => this.only(this.settingsPanel));
    // A personal link (e.g. a wedding invitation) is not the game's release: no What's new.
    if (personal) {
      this.newsBtn.remove();
      this.markNews(false);
    }
    this.birdBlurb = this.aviary.querySelector<HTMLElement>('.bird-blurb')!;
    this.tabs = [...this.aviary.querySelectorAll<HTMLButtonElement>('.aviary-tab')];
    for (const tab of this.tabs)
      tab.addEventListener('click', () => {
        this.tab = tab.dataset.tab as Row;
        this.markTabs();
      });
    this.picks = [...this.aviary.querySelectorAll<HTMLButtonElement>('.pick')];
    for (const pick of this.picks)
      pick.addEventListener('click', () => {
        const id = pick.dataset.id!;
        const row = pick.dataset.row as Row;
        // A bird says what it does whether or not it is open yet.
        if (row === 'species') this.birdBlurb.textContent = speciesDef(id as SpeciesId).blurb;
        if (!this.journey.isOpen(pickUnlock(row, id))) {
          // The pick says when it opens; the bar (wide screens only) says how close that is.
          this.nudge(pick);
          this.nudgeJourney(this.journeyBars[3]);
          return;
        }
        if (row === 'species') h.selectSpecies(id as SpeciesId);
        else if (row === 'plumage') h.selectPlumage(id as PlumageId);
        else h.selectTrail(id as TrailId);
        this.markPicks();
      });
    this.syncInputs = this.setupSettings(h);
    // Keep keyboard/mouse events on menus from steering or flapping the bird.
    for (const p of this.panels()) p.addEventListener('pointerdown', (e) => e.stopPropagation());
  }

  private panels(): HTMLDivElement[] {
    return [
      this.start,
      this.pause,
      this.settingsPanel,
      this.rest,
      this.help,
      this.aviary,
      this.news,
      this.finale,
    ];
  }

  /** A glow on What's new, and on the title's Settings button that leads to it, while there are
   *  releases the player hasn't seen. */
  private markNews(unread: boolean): void {
    this.newsBtn.classList.toggle('unread', unread);
    this.start.querySelector('#title-settings-btn')!.classList.toggle('unread', unread);
  }

  /** Settings over the title or the pause card; Done goes back there. */
  private showSettings(from: HTMLDivElement): void {
    this.settingsFrom = from;
    this.syncInputs();
    this.only(this.settingsPanel);
  }

  /**
   * The Settings card: chips and switches write straight into `settings` and hand it to
   * `change`. Returns the function that redraws the card from `settings` (e.g. after M mutes).
   */
  private setupSettings(h: MenuHandlers): () => void {
    const s = this.settings;
    const p = this.settingsPanel;
    const sound = p.querySelector<HTMLButtonElement>('#sound')!;
    const lefty = p.querySelector<HTMLButtonElement>('#lefty')!;
    const invert = p.querySelector<HTMLButtonElement>('#invert')!;
    const chips = (id: string) => [...p.querySelectorAll<HTMLButtonElement>(`#${id} .chip`)];
    const steer = chips('steer');
    const quality = chips('quality');
    const mark = (group: HTMLButtonElement[], value: string) => {
      for (const c of group) {
        const on = c.dataset.value === value;
        c.classList.toggle('selected', on);
        c.setAttribute('aria-checked', String(on));
      }
    };
    const sync = () => {
      sound.setAttribute('aria-checked', String(!s.muted));
      mark(steer, s.touchSteer);
      mark(quality, s.quality);
      invert.setAttribute('aria-checked', String(s.invertY));
      lefty.setAttribute('aria-checked', String(s.leftHanded));
      // Drag steering has no buttons to swap, and the one D-pad moves wholesale while side arrows
      // and split keep a cluster under each thumb, so only Boost changes sides.
      p.querySelector<HTMLElement>('.lefty-row')!.hidden = s.touchSteer === 'drag';
      p.querySelector('.steer-hint')!.textContent = STEER_HINT[s.touchSteer];
      lefty.querySelector('small')!.textContent =
        s.touchSteer === 'dpad' ? 'D-pad right, Boost left' : 'Boost over the left thumb';
    };
    const changed = () => {
      sync();
      h.change(s);
    };
    sound.addEventListener('click', () => {
      s.muted = !s.muted;
      changed();
    });
    invert.addEventListener('click', () => {
      s.invertY = !s.invertY;
      changed();
    });
    lefty.addEventListener('click', () => {
      s.leftHanded = !s.leftHanded;
      changed();
    });
    for (const c of steer)
      c.addEventListener('click', () => {
        s.touchSteer = c.dataset.value as Settings['touchSteer'];
        changed();
      });
    for (const c of quality)
      c.addEventListener('click', () => {
        s.quality = c.dataset.value as Settings['quality'];
        changed();
      });
    sync();
    return sync;
  }

  /** Re-read settings into the form (e.g. after M toggles mute). */
  syncInputs: () => void;
  private readonly isNewLevel: (id: LevelId) => boolean;

  private panel(cls: string, html: string): HTMLDivElement {
    const el = document.createElement('div');
    el.className = `menu ${cls}`;
    el.innerHTML = `<div class="card">${html}</div>`;
    return el;
  }

  /** Corner button on the title and pause screens (never mid-flight). The launch card
   *  (FullscreenPrompt) is the one that asks, and explains Add to Home Screen on iPhone. */
  private setupFullscreen(ui: HTMLElement): void {
    if (fullscreenSupport() !== 'api') return;
    const btn = document.createElement('button');
    btn.className = 'fs-btn';
    btn.innerHTML =
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>';
    ui.appendChild(btn);
    this.fsBtn = btn;
    const sync = (on: boolean) => {
      btn.setAttribute('aria-label', on ? 'Exit fullscreen' : 'Enter fullscreen');
      btn.classList.toggle('active', on);
    };
    sync(isFullscreen());
    onFullscreenChange(sync);
    btn.addEventListener('click', () => void toggleFullscreen());
    btn.addEventListener('pointerdown', (e) => e.stopPropagation());
  }

  /** Swap Settings for the Controls panel; Back returns to it. */
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

  /** The bird flown and what it wears: each saved pick while its milestone is open, else the
   *  default. */
  private worn(): Record<Row, string> {
    const s = this.settings;
    const j = this.journey;
    return {
      species: j.isOpen(speciesDef(s.species).unlock) ? s.species : DEFAULT_SPECIES,
      plumage: j.isOpen(plumageDef(s.plumage).unlock) ? s.plumage : DEFAULT_PLUMAGE,
      trail: j.isOpen(trailDef(s.trail).unlock) ? s.trail : DEFAULT_TRAIL,
    };
  }

  /** Shows the picked tab's row only. */
  private markTabs(): void {
    for (const tab of this.tabs) {
      const on = tab.dataset.tab === this.tab;
      tab.classList.toggle('selected', on);
      tab.setAttribute('aria-selected', String(on));
    }
    for (const row of this.aviary.querySelectorAll<HTMLElement>('.aviary-row'))
      row.hidden = row.dataset.row !== this.tab;
  }

  /** Locked picks keep their name and swatch but say when they open; the worn one is marked. */
  private markPicks(): void {
    const worn = this.worn();
    this.birdBlurb.textContent = speciesDef(worn.species as SpeciesId).blurb;
    for (const pick of this.picks) {
      const id = pick.dataset.id!;
      const row = pick.dataset.row as Row;
      const unlock = pickUnlock(row, id);
      const open = this.journey.isOpen(unlock);
      const on = id === worn[row];
      pick.classList.toggle('locked', !open);
      pick.classList.toggle('selected', on);
      pick.setAttribute('aria-checked', String(on));
      pick.setAttribute('aria-disabled', String(!open));
      pick.querySelector('.pick-lock')!.textContent =
        open || unlock === null ? '' : `${unlockAt(unlock).toLocaleString()} ✧`;
    }
  }

  private showAviary(): void {
    this.markTabs();
    this.markPicks();
    this.showJourney(this.journeyBars[3], false);
    this.only(this.aviary);
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
    for (const p of this.panels()) p.classList.toggle('show', p === panel);
    this.pauseBtn.classList.toggle('show', panel === null);
    // Not over the Aviary or Settings: on a phone their cards reach the top corner.
    this.fsBtn?.classList.toggle(
      'show',
      panel !== null &&
        panel !== this.aviary &&
        panel !== this.settingsPanel &&
        panel !== this.news,
    );
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
    const reached = r.querySelector<HTMLElement>('.rest-reached')!;
    reached.hidden = t.reached.length === 0;
    const n = t.reached.length;
    reached.replaceChildren(
      `Journeyed to ${t.reached.join(' · ')}`,
      document.createElement('br'),
      `${n === 1 ? 'A bird' : `${n} birds`} joined · a flock of ${t.flock}`,
    );
    const finds = r.querySelector<HTMLElement>('.rest-finds')!;
    finds.hidden = t.finds.length === 0;
    finds.textContent = `Found: ${t.finds.join(' · ')}`;
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
        : u.kind === 'species'
          ? `${SPECIES.find((b) => b.unlock === u.id)?.blurb ?? ''} Pick it in Birds.`
          : KIND_DETAIL[u.kind];
    el.innerHTML = `<span class="unlock-kind">${KIND_LABEL[u.kind]}</span><b></b><span class="unlock-detail"></span>`;
    el.querySelector('b')!.textContent = u.name;
    el.querySelector('.unlock-detail')!.textContent = detail;
    return el;
  }

  /** A gentle glow on a journey bar (something locked was tapped). */
  private nudgeJourney(bar: HTMLElement): void {
    this.nudge(bar);
  }

  /** Restarts an element's `nudge` animation. */
  private nudge(el: HTMLElement): void {
    el.classList.remove('nudge');
    void el.offsetWidth; // restart the animation
    el.classList.add('nudge');
  }

  /**
   * Open levels, then only the next one still locked (it keeps its name and says when it opens),
   * so a new player sees a place or two and Play rather than a wall of locks. Open ones not flown
   * yet say "New".
   */
  private markLevels(): void {
    let nextLocked: UnlockId | null = null;
    for (const { id } of LEVEL_LIST) {
      if (this.journey.isLevelOpen(id) || !isUnlockId(id)) continue;
      if (nextLocked === null || unlockAt(id) < unlockAt(nextLocked)) nextLocked = id;
    }
    for (const card of this.levelCards) {
      const id = card.dataset.level as LevelId;
      const level = LEVEL_LIST.find((l) => l.id === id);
      const open = this.journey.isLevelOpen(id);
      const isNew = open && this.isNewLevel(id);
      card.hidden = !open && id !== nextLocked;
      card.classList.toggle('locked', !open);
      card.classList.toggle('new', isNew);
      card.setAttribute('aria-disabled', String(!open));
      // Its hidden finds, one mark each (filled once found), on open levels.
      const marks = card.querySelector<HTMLElement>('.level-finds')!;
      const total = LEVEL_FINDS[id].length;
      const got = this.journey.foundIn(id);
      marks.hidden = !open || total === 0;
      card.classList.toggle('has-finds', !marks.hidden);
      marks.textContent = '●'.repeat(got) + '○'.repeat(total - got);
      marks.title = `Hidden finds: ${got} of ${total}`;
      card.querySelector('.level-blurb')!.textContent =
        open || !isUnlockId(id)
          ? (level?.blurb ?? '')
          : `Opens at ${unlockAt(id).toLocaleString()} ✧`;
    }
    this.dots.replaceChildren(
      ...this.levelCards
        .filter((c) => !c.hidden)
        .map((c) => {
          const dot = document.createElement('span');
          dot.dataset.level = c.dataset.level;
          return dot;
        }),
    );
  }

  /**
   * The card in the middle: open, it is the pick (the selected glow, its dot, Play); locked, Play
   * says when it opens and the bar says how far that is.
   */
  private markFocus(id: LevelId): void {
    this.focused = id;
    const open = this.journey.isLevelOpen(id);
    for (const card of this.levelCards) {
      const on = card.dataset.level === id && open;
      card.classList.toggle('selected', on);
      card.setAttribute('aria-checked', String(on));
    }
    for (const dot of this.dots.children)
      dot.classList.toggle('on', (dot as HTMLElement).dataset.level === id);
    this.playBtn.disabled = !open;
    this.playBtn.classList.toggle('locked', !open);
    const bar = this.journeyBars[0];
    this.showJourney(bar, false);
    if (open || !isUnlockId(id)) {
      this.playBtn.textContent = 'Play';
      return;
    }
    const at = unlockAt(id);
    this.playBtn.textContent = `Opens at ${at.toLocaleString()} ✧`;
    const name = LEVEL_LIST.find((l) => l.id === id)?.name ?? '';
    bar.querySelector('.journey-next')!.textContent =
      `${Math.max(0, at - this.journey.light).toLocaleString()} more to open ${name}`;
    this.nudgeJourney(bar);
  }

  /** The row came to rest: the card nearest its middle is the one in focus. */
  private settle(): void {
    if (!this.onTitle) return;
    const row = this.levelCards[0].parentElement!;
    const mid = row.scrollLeft + row.clientWidth / 2;
    let best: HTMLButtonElement | null = null;
    let bestD = Infinity;
    for (const card of this.levelCards) {
      if (card.hidden) continue;
      const d = Math.abs(card.offsetLeft + card.offsetWidth / 2 - mid);
      if (d < bestD) {
        bestD = d;
        best = card;
      }
    }
    const id = best?.dataset.level as LevelId | undefined;
    if (!id || id === this.focused) return;
    this.markFocus(id);
    if (this.journey.isLevelOpen(id)) this.selectLevel(id);
  }

  showStart(_best: number, level: LevelId): void {
    this.markLevels();
    this.markFocus(level);
    // Glide to a new pick while the title is up; jump straight there when it first appears.
    const shown = this.onTitle;
    this.only(this.start);
    this.centreLevel(level, shown);
  }

  /** Bring a card to the middle of the row (swiping does the same; `settle` then picks it). */
  private centreLevel(level: LevelId, smooth: boolean): void {
    const row = this.levelCards[0].parentElement!;
    const card = this.levelCards.find((c) => c.dataset.level === level);
    if (!card) return;
    const left = card.offsetLeft - (row.clientWidth - card.offsetWidth) / 2;
    row.scrollTo({ left, behavior: smooth ? 'smooth' : 'auto' });
  }

  /** The title screen is up (nothing on it is lost by a reload). */
  get onTitle(): boolean {
    return this.start.classList.contains('show');
  }

  /** The Eden channel's last card, over the paused flight. */
  showFinale(): void {
    this.only(this.finale);
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
