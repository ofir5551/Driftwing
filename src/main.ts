import './ui/styles.css';
import { Game } from './core/Game';
import { Gameplay } from './core/Gameplay';

const app = document.getElementById('app')!;
const ui = document.createElement('div');
ui.id = 'ui';
document.body.appendChild(ui);

const game = new Game(app, ui);
const gameplay = new Gameplay(game, ui);
game.start();
game.setMode('playing');
gameplay.hud.visible = true;
Object.assign(window, { __dw: game, __gp: gameplay });
