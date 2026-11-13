import './ui/styles.css';
import { Game } from './core/Game';
import { Gameplay } from './core/Gameplay';
import { Config } from './core/Config';
import { Journey, parseJourney, type Unlock } from './core/Journey';
import {
  loadBest,
  loadJourney,
  loadSettings,
  saveBest,
  saveJourney,
  saveSettings,
  type Settings,
} from './core/Settings';
import { GameAudio } from './audio/GameAudio';
import { isLevelId, LEVEL_LIST } from './levels';
import type { LevelId } from './levels/World';
import type { TimeOfDay } from './world/DayCycle';
import { Menu, type MenuHandlers } from './ui/Menu';
import { DEFAULT_PLUMAGE, plumageDef } from './player/Plumage';
import { DEFAULT_TRAIL, trailDef } from './fx/TrailStyle';
import { DEFAULT_SPECIES, speciesDef } from './player/Species';
import { applyUpdate, registerServiceWorker, updateReady } from './pwa';
import { findName } from './world/Discoveries';

const params = new URLSearchParams(location.search);
const app = document.getElementById('app')!;
const ui = document.createElement('div');
ui.id = 'ui';
document.body.appendChild(ui);

const settings = loadSettings();
// The journey (lifetime light). `?autopilot` never earns (the bot would fill it), and
// `?journey=N` starts a throwaway journey at N light that is never saved.
const earns = !params.has('autopilot');
const testLight = params.get('journey');
const keepsJourney = earns && testLight === null;
const journey =
  testLight === null
    ? new Journey(loadJourney())
    : new Journey(parseJourney({ light: Number(testLight) }));
// `?unlocked` opens every level, plumage and trail for this session without granting (or
// saving) anything.
journey.allOpen = params.has('unlocked');
// Levels flown before the journey existed stay open whatever the light.
if (testLight === null) for (const l of LEVEL_LIST) if (loadBest(l.id) > 0) journey.grant(l.id);
// The last level picked, unless it is still locked (picked, never flown, before levels had
// locks). `?level=` opens any level for development without unlocking it.
if (!journey.isLevelOpen(settings.level)) settings.level = 'highlands';
const urlLevel = params.get('level');
const game = new Game(app, ui, isLevelId(urlLevel) ? urlLevel : settings.level, settings.timeOfDay);
const gameplay = new Gameplay(game, ui);
const audio = new GameAudio(game, gameplay.progress);
// A find already made is never made again (in any session that keeps the journey).
gameplay.discoveries.known = (id) => journey.hasFound(id);
gameplay.progress.best = loadBest(game.level.id);
audio.setStyle(game.level.music);

/** Dresses the bird from the Aviary picks; a pick whose milestone is not open (a `?journey=`
 *  or `?unlocked` session picked it) falls back to the default without forgetting it. */
function dress(): void {
  const b = speciesDef(settings.species);
  game.setSpecies(journey.isOpen(b.unlock) ? b : speciesDef(DEFAULT_SPECIES));
  const p = plumageDef(settings.plumage);
  const t = trailDef(settings.trail);
  const worn = journey.isOpen(p.unlock) ? p : plumageDef(DEFAULT_PLUMAGE);
  game.bird.setPlumage(worn.colors, worn.glow ?? 0);
  gameplay.setTrail(journey.isOpen(t.unlock) ? t : trailDef(DEFAULT_TRAIL));
}
dress();

let bankTimer = 0;

function bankJourney(): void {
  bankTimer = 0;
  if (!keepsJourney || !journey.dirty) return;
  saveJourney(journey.toData());
  journey.dirty = false;
}

function earn(amount: number): void {
  if (!earns) return;
  const opened = journey.earn(amount);
  if (opened.length > 0) announce(opened);
}

function announce(opened: readonly Unlock[]): void {
  const names = opened.map((u) => u.name);
  gameplay.hud.notice(`✧ ${names.join(' · ')} unlocked`);
  game.events.emit('unlock', { names });
  bankJourney(); // an unlock is worth saving at once
}

const veil = document.createElement('div');
veil.className = 'veil';
ui.appendChild(veil);

function applySettings(s: Settings): void {
  audio.engine.setVolume(s.volume);
  audio.engine.setMuted(s.muted);
  Config.input.invertY = s.invertY;
  game.input.touch.setScheme(s.touchSteer);
  if (!params.has('quality')) {
    game.autoQuality = s.quality === 'auto';
    if (s.quality !== 'auto' && s.quality !== game.quality) game.setQuality(s.quality);
  }
  saveSettings(s);
}

/** Saves the best score and the journey. */
function persist(): void {
  const id = game.level.id;
  if (gameplay.progress.best > loadBest(id)) saveBest(id, gameplay.progress.best);
  bankJourney();
}

let switching = false;
/** Fade to a veil, rebuild the world for the new level behind it, fade back in. */
function switchLevel(id: LevelId): void {
  if (switching || id === game.level.id || !journey.isLevelOpen(id)) return;
  switching = true;
  persist();
  veil.classList.add('show');
  setTimeout(() => {
    game.setLevel(id);
    audio.setStyle(game.level.music);
    gameplay.progress.best = loadBest(id);
    settings.level = id;
    saveSettings(settings);
    menu.showStart(gameplay.progress.best, id);
    veil.classList.remove('show');
    switching = false;
  }, 380);
}

let playTime = 0;
/** The level's saved best when the flight began (so the Rest card can say "a new best"). */
let bestBefore = 0;

// First-flight lessons (Config.hints): each is learned by doing it once and saved, so a
// returning player flies without a word. Steering comes first; boosting only once steering is
// known, and never twice in a flight. A save from before lessons were kept: light means the
// player has already gathered wisps and steered to them.
if (journey.light > 0) settings.taught.wisps = settings.taught.steer = true;
let steerTime = 0;
/** Play time at which steering was learned this flight (-1: known before, or not yet). */
let steerLearnedAt = -1;
let steerHinted = false;
let boostHinted = false;
function learn(lesson: keyof Settings['taught']): void {
  if (settings.taught[lesson]) return;
  settings.taught[lesson] = true;
  if (earns) saveSettings(settings); // the autopilot teaches nobody
}
const isTouch = () => document.body.classList.contains('touch');
const steerHint = () =>
  !isTouch()
    ? 'Move the pointer to steer'
    : settings.touchSteer === 'drag'
      ? 'Slide your finger to steer'
      : 'Use the arrows to steer';
const flapHint = () =>
  !isTouch()
    ? 'Hold Space or click to boost'
    : settings.touchSteer !== 'drag'
      ? 'Tap Boost to flap'
      : 'Tap with a second finger to boost';

const handlers: MenuHandlers = {
  play() {
    audio.unlock(); // Play is the user gesture that lets the browser start audio
    applySettings(settings);
    gameplay.progress.reset();
    journey.newFlight();
    gameplay.discoveries.restart();
    bestBefore = loadBest(game.level.id);
    game.setMode('playing');
    gameplay.hud.visible = true;
    menu.showPlaying();
    playTime = 0;
    steerTime = 0;
    steerLearnedAt = -1;
    steerHinted = boostHinted = false;
    if (!settings.taught.wisps) gameplay.hud.toast('Follow the wisps', 3);
  },
  rest() {
    if (game.mode !== 'paused') return;
    persist();
    const p = gameplay.progress;
    // The bot takes the bird on, so it keeps gliding behind the card (the title's backdrop flight).
    game.setMode('menu');
    document.body.classList.remove('paused');
    gameplay.hud.visible = false;
    gameplay.hud.clearMessages(); // unlock notices still waiting are on the card instead
    menu.showRest(
      {
        level: game.level.name,
        wisps: p.count,
        lanterns: p.reached,
        tricks: p.tricks,
        score: p.score,
        best: p.best,
        newBest: p.score > bestBefore,
        seconds: playTime,
        finds: journey.flightFinds.map(findName),
      },
      journey.unrevealed(),
    );
    journey.reveal();
    bankJourney();
  },
  keepFlying() {
    handlers.play();
  },
  pause() {
    if (game.mode !== 'playing') return;
    game.setMode('paused');
    document.body.classList.add('paused');
    const p = gameplay.progress;
    menu.showPause(p.score, p.best, p.count);
    persist();
  },
  resume() {
    if (game.mode !== 'paused') return;
    audio.unlock();
    game.setMode('playing');
    document.body.classList.remove('paused');
    menu.showPlaying();
  },
  change: applySettings,
  selectLevel: switchLevel,
  isNewLevel: (id) => id !== 'highlands' && loadBest(id) <= 0,
  selectTime(t: TimeOfDay) {
    settings.timeOfDay = t;
    game.setTimeOfDay(t);
    saveSettings(settings);
  },
  selectSpecies(id) {
    const b = speciesDef(id);
    if (!journey.isOpen(b.unlock)) return;
    settings.species = id;
    settings.plumage = b.plumage; // a new bird arrives in its own feathers
    saveSettings(settings);
    dress();
  },
  selectPlumage(id) {
    if (!journey.isOpen(plumageDef(id).unlock)) return;
    settings.plumage = id;
    saveSettings(settings);
    dress();
  },
  selectTrail(id) {
    if (!journey.isOpen(trailDef(id).unlock)) return;
    settings.trail = id;
    saveSettings(settings);
    dress();
  },
  aviary(open) {
    // The bot's glide is lazy, so the trail would barely show: hold it visible while picking.
    gameplay.trailPreview = open ? Config.aviary.trailPreview : 0;
  },
  toTitle() {
    if (game.mode === 'playing') return; // from the pause menu or the Rest card
    persist();
    game.setMode('menu');
    document.body.classList.remove('paused');
    gameplay.hud.visible = false;
    menu.showStart(gameplay.progress.best, game.level.id);
    updateIfCalm();
  },
};
const menu = new Menu(ui, settings, journey, handlers);

// The bot flaps on the title too: only the player's own flaps teach boosting.
game.events.on('flap', () => game.mode === 'playing' && learn('boost'));
// These only fire while playing (the attract flight doesn't score).
game.events.on('wisp', () => {
  learn('wisps');
  earn(Config.journey.wisp);
});
game.events.on('lanternReached', () => earn(Config.journey.lantern));
game.events.on('trick', () => earn(Config.journey.trick));
game.events.on('discovery', (e) => {
  if (!earns || !journey.discover(e.id)) return;
  earn(Config.discoveries.light);
  bankJourney(); // a find is worth saving at once
});
game.events.on('lantern', persist);
game.onFrame((dt) => {
  const input = game.input;
  if (input.mutePressed) {
    input.mutePressed = false;
    settings.muted = !settings.muted;
    applySettings(settings);
    menu.syncInputs();
  }
  if (input.pausePressed) {
    input.pausePressed = false;
    if (game.mode === 'playing') handlers.pause();
    else if (game.mode === 'paused') handlers.resume();
  }
  if (game.mode === 'playing') {
    playTime += dt;
    bankTimer += dt;
    if (bankTimer >= Config.journey.bankEvery) bankJourney();
    teach(dt);
  }
});

/** One lesson at a time, each only while the toast is free (never over a lantern or unlock). */
function teach(dt: number): void {
  const h = Config.hints;
  const t = settings.taught;
  const steer = game.input.state;
  if (!t.steer) {
    if (Math.abs(steer.steerX) + Math.abs(steer.steerY) > h.steerInput) steerTime += dt;
    if (steerTime > h.steerLearned) {
      learn('steer');
      steerLearnedAt = playTime;
    } else if (!steerHinted && playTime > h.steerAt && !gameplay.hud.busy) {
      steerHinted = true;
      gameplay.hud.toast(steerHint(), 4);
    }
    return; // boosting waits until steering is known
  }
  if (t.boost || boostHinted || gameplay.hud.busy) return;
  if (playTime > h.boostAt && (steerLearnedAt < 0 || playTime > steerLearnedAt + h.boostGap)) {
    boostHinted = true;
    gameplay.hud.toast(flapHint(), 4);
  }
}

/** Reloads into a newer build that has downloaded (see pwa.ts), but only on the title, where
 *  a reload loses nothing: never mid-flight, on the pause menu or on the Rest card. */
function updateIfCalm(): void {
  if (!updateReady() || game.mode !== 'menu' || !menu.onTitle || switching) return;
  persist();
  applyUpdate();
}

document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    handlers.pause();
    updateIfCalm(); // out of sight, so the reload isn't even seen
  }
});
addEventListener('pagehide', persist);
// Leaving pointer lock (usually via Esc, which the browser swallows) pauses the game.
let wasLocked = false;
document.addEventListener('pointerlockchange', () => {
  const locked = !!document.pointerLockElement;
  if (wasLocked && !locked) handlers.pause();
  wasLocked = locked;
});
addEventListener('contextmenu', (e) => e.preventDefault());

applySettings(settings);
game.setMode('menu');
menu.showStart(gameplay.progress.best, game.level.id);
game.start();
if (params.has('autopilot')) handlers.play(); // screenshots / demos: skip the title

registerServiceWorker();

Object.assign(window, { __dw: game, __gp: gameplay, __audio: audio, __journey: journey });
