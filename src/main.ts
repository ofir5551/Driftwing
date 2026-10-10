import './ui/styles.css';
import { Game } from './core/Game';
import { Gameplay } from './core/Gameplay';
import { GameAudio } from './audio/GameAudio';

const app = document.getElementById('app')!;
const ui = document.createElement('div');
ui.id = 'ui';
document.body.appendChild(ui);

const game = new Game(app, ui);
const gameplay = new Gameplay(game, ui);
const audio = new GameAudio(game, gameplay.progress);
game.start();
game.setMode('playing');
gameplay.hud.visible = true;

game.onFrame(() => {
  if (game.input.mutePressed) {
    game.input.mutePressed = false;
    audio.engine.setMuted(!audio.engine.isMuted);
  }
});

// Browsers only allow audio after a user gesture.
const unlock = () => audio.unlock();
for (const ev of ['pointerdown', 'keydown', 'touchstart'])
  addEventListener(ev, unlock, { once: true });

Object.assign(window, { __dw: game, __gp: gameplay, __audio: audio });
