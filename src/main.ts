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
// Levels flown before the journey existed stay open whatever the light.
if (testLight === null) for (const l of LEVEL_LIST) if (loadBest(l.id) > 0) journey.grant(l.id);
// The last level picked, unless it is still locked (picked, never flown, before levels had
// locks). `?level=` opens any level for development without unlocking it.
if (!journey.isLevelOpen(settings.level)) settings.level = 'highlands';
const urlLevel = params.get('level');
const game = new Game(app, ui, isLevelId(urlLevel) ? urlLevel : settings.level, settings.timeOfDay);
const gameplay = new Gameplay(game, ui);
const audio = new GameAudio(game, gameplay.progress);
gameplay.progress.best = loadBest(game.level.id);
audio.setStyle(game.level.music);

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

let flapped = false;
let playTime = 0;
/** The level's saved best when the flight began (so the Rest card can say "a new best"). */
let bestBefore = 0;
let welcomed = false;
let hintShown = false;
let boostHintShown = false;
const isTouch = () => document.body.classList.contains('touch');
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
    bestBefore = loadBest(game.level.id);
    game.setMode('playing');
    gameplay.hud.visible = true;
    menu.showPlaying();
    playTime = 0;
    // Hints are once per visit: a second flight (Keep flying, or Play again) needs none.
    if (!welcomed) gameplay.hud.toast('Follow the wisps', 3);
    welcomed = true;
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
  toTitle() {
    if (game.mode === 'playing') return; // from the pause menu or the Rest card
    persist();
    game.setMode('menu');
    document.body.classList.remove('paused');
    gameplay.hud.visible = false;
    menu.showStart(gameplay.progress.best, game.level.id);
  },
};
const menu = new Menu(ui, settings, journey, handlers);

game.events.on('flap', () => (flapped = true));
// These only fire while playing (the attract flight doesn't score).
game.events.on('wisp', () => earn(Config.journey.wisp));
game.events.on('lanternReached', () => earn(Config.journey.lantern));
game.events.on('trick', () => earn(Config.journey.trick));
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
    // Drag steering has no boost button, so say how to boost once "Follow the wisps" has faded.
    if (!boostHintShown && playTime > 3.4) {
      boostHintShown = true;
      if (isTouch() && settings.touchSteer === 'drag') gameplay.hud.toast(flapHint(), 4);
    }
    // One gentle nudge if the player hasn't discovered flapping yet.
    if (!hintShown && !flapped && playTime > 14) {
      hintShown = true;
      gameplay.hud.toast(flapHint(), 4);
    }
  }
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) handlers.pause();
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

Object.assign(window, { __dw: game, __gp: gameplay, __audio: audio, __journey: journey });
