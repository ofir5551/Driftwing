import { Config } from '../core/Config';
import type { Game } from '../core/Game';
import type { Progress } from '../core/Progress';
import { clamp } from '../core/math';
import { AudioEngine } from './AudioEngine';
import { Music, type MusicParams } from './Music';
import { Sfx } from './Sfx';
import type { MusicStyle } from './styles';

/** Connects gameplay events and flight state to the music and SFX. */
export class GameAudio {
  readonly engine = new AudioEngine();
  private readonly music = new Music(this.engine);
  private readonly sfx = new Sfx(this.engine);
  private readonly params: MusicParams = {
    speed: 0,
    altitude: 0,
    flow: 0,
    dayKey: 0,
    paused: false,
  };

  constructor(game: Game, progress: Progress) {
    this.engine.onReady(() => {
      this.music.start();
      this.sfx.start();
    });
    game.events.on('flap', () => this.sfx.flap());
    game.events.on('wingbeat', () => this.sfx.wingbeat());
    game.events.on('wisp', (e) => this.music.playWispNote(e.flow));
    game.events.on('lantern', () => this.music.lantern());
    game.events.on('trickStart', (e) => {
      this.music.trick(e.kind);
      if (e.kind === 'dive') this.sfx.dive();
      else if (e.kind !== 'loop') this.sfx.roll();
    });
    game.events.on('trick', (e) => this.music.land(e.kind));
    game.events.on('contact', (e) => this.sfx.contact(e.kind, e.strength));
    game.events.on('thermal', (e) => this.sfx.thermal(e.inside));
    // Audio params are smoothed with setTargetAtTime, so ~10 updates/s is plenty and keeps
    // AudioParam automation lists short.
    let last = 0;
    game.onFrame(() => {
      const now = performance.now();
      if (!this.engine.ready || now - last < 100) return;
      last = now;
      const c = Config.flight;
      const s = game.flight;
      const p = this.params;
      p.speed = clamp((s.speed - c.minSpeed) / (c.maxSpeed - c.minSpeed), 0, 1);
      p.altitude = clamp((s.y - Config.world.waterLevel) / c.maxAltitude, 0, 1);
      p.flow = progress.flow;
      p.dayKey = game.day.keyIndex;
      p.paused = game.mode === 'paused';
      this.music.setParams(p);
      this.sfx.update(p.speed, p.paused);
    });
  }

  /** Level change: the music takes on the level's style. */
  setStyle(style: MusicStyle): void {
    this.music.setStyle(style);
  }

  /** Call from a user gesture. */
  unlock(): void {
    this.engine.unlock();
  }
}
