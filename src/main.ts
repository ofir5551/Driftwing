import './ui/styles.css';
import { Game } from './core/Game';

const app = document.getElementById('app')!;
const ui = document.createElement('div');
ui.id = 'ui';
document.body.appendChild(ui);

const game = new Game(app, ui);
game.start();
game.setMode('playing');
(window as unknown as { __dw: Game }).__dw = game;
