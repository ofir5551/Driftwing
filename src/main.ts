import './ui/styles.css';
import { Game } from './core/Game';
import { Gameplay } from './core/Gameplay';
import { Config } from './core/Config';
import { loadBest, loadSettings, saveBest, saveSettings, type Settings } from './core/Settings';
import { GameAudio } from './audio/GameAudio';
import { Menu, type MenuHandlers } from './ui/Menu';

const params = new URLSearchParams(location.search);
const app = document.getElementById('app')!;
const ui = document.createElement('div');
ui.id = 'ui';
document.body.appendChild(ui);

const settings = loadSettings();
const game = new Game(app, ui);
const gameplay = new Gameplay(game, ui);
const audio = new GameAudio(game, gameplay.progress);
gameplay.progress.best = loadBest();

function applySettings(s: Settings): void {
  audio.engine.setVolume(s.volume);
  audio.engine.setMuted(s.muted);
  Config.input.invertY = s.invertY;
  document.body.classList.toggle('left-handed', s.leftHanded);
  if (!params.has('quality')) {
    game.autoQuality = s.quality === 'auto';
    if (s.quality !== 'auto' && s.quality !== game.quality) game.setQuality(s.quality);
  }
  saveSettings(s);
}

function persistBest(): void {
  if (gameplay.progress.best > loadBest()) saveBest(gameplay.progress.best);
}

let flapped = false;
let playTime = 0;
let hintShown = false;

const handlers: MenuHandlers = {
  play() {
    audio.unlock(); // Play is the user gesture that lets the browser start audio
    applySettings(settings);
    gameplay.progress.reset();
    game.setMode('playing');
    gameplay.hud.visible = true;
    menu.showPlaying();
    playTime = 0;
    hintShown = false;
    gameplay.hud.toast('Follow the wisps', 3);
  },
  pause() {
    if (game.mode !== 'playing') return;
    game.setMode('paused');
    document.body.classList.add('paused');
    const p = gameplay.progress;
    menu.showPause(p.score, p.best, p.count);
    persistBest();
  },
  resume() {
    if (game.mode !== 'paused') return;
    audio.unlock();
    game.setMode('playing');
    document.body.classList.remove('paused');
    menu.showPlaying();
  },
  change: applySettings,
};
const menu = new Menu(ui, settings, handlers);

game.events.on('flap', () => (flapped = true));
game.events.on('lantern', persistBest);
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
    // One gentle nudge if the player hasn't discovered flapping yet.
    if (!hintShown && !flapped && playTime > 14) {
      hintShown = true;
      const touch = document.body.classList.contains('touch');
      gameplay.hud.toast(
        touch
          ? 'Hold the wing button, or tap with a second finger, to flap'
          : 'Hold Space or click to flap',
        4,
      );
    }
  }
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) handlers.pause();
});
addEventListener('pagehide', persistBest);
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
menu.showStart(gameplay.progress.best);
game.start();
if (params.has('autopilot')) handlers.play(); // screenshots / demos: skip the title

Object.assign(window, { __dw: game, __gp: gameplay, __audio: audio });
