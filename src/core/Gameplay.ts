import * as THREE from 'three';
import { Config, QUALITY } from './Config';
import type { Game } from './Game';
import { Progress } from './Progress';
import { clamp, smoothstep } from './math';
import { BlobShadow } from '../fx/BlobShadow';
import { trickFamily, trickName, trickScale, type TrickKind } from '../player/Tricks';
import { Particles } from '../fx/Particles';
import { gust } from '../player/FlightModel';
import { Trails } from '../fx/Trails';
import { Wind } from '../fx/Wind';
import { Hud } from '../ui/Hud';
import { Lanterns } from '../world/Lanterns';
import { Thermals } from '../world/Thermals';
import { Wisps } from '../world/Wisps';

const GOLD = new THREE.Color('#ffd27a');
const MOON = new THREE.Color('#a9e8ff');
const SPLASH = new THREE.Color('#eaf6ff');
const DUST = new THREE.Color('#e3cfa8');
const LEAF = new THREE.Color('#a6d17e');
const WHITE = new THREE.Color('#ffffff');

/**
 * Gameplay layer on top of the flight sandbox: wisps, flow, thermals, lanterns and the
 * feedback that makes them feel good (particles, trails, wind, HUD).
 */
export class Gameplay {
  readonly progress = new Progress();
  readonly hud: Hud;
  readonly wisps: Wisps;
  readonly thermals: Thermals;
  private readonly lanterns = new Lanterns();
  private readonly glow = new Particles(2400, true);
  private readonly soft = new Particles(900, false);
  private readonly trails = new Trails();
  private readonly wind = new Wind();
  private readonly shadow = new BlobShadow();
  private readonly wispColor = new THREE.Color();
  private readonly vel = new THREE.Vector3();
  private readonly lanternTarget = new THREE.Vector3();
  private readonly tmp = new THREE.Color();
  private contactFx = 0;
  /** Rising sparks round a lantern still to reach (bound once: no per-frame closure). */
  private readonly lanternSpark = (x: number, y: number, z: number): void =>
    this.glow.emit(x, y, z, 0, 4 + Math.random() * 3, 0, 2.4, 1.5, GOLD, -0.5, 0.3);
  /** What the blob shadow lands on: roofs and decks below the bird, else the ground. */
  private readonly shadowGround: (x: number, z: number) => number;

  constructor(
    private readonly game: Game,
    ui: HTMLElement,
  ) {
    this.hud = new Hud(ui);
    this.shadowGround = (x, z) => game.world.surfaceBelow(x, game.pose.y, z);
    this.thermals = new Thermals(
      (x, z) => game.field.height(x, z),
      (x, z, r) => game.world.thermalOk(x, z, r),
    );
    this.wisps = new Wisps(
      Config.world.seed,
      (x, z) => game.world.wispFloor(x, z),
      (x, z, r) => this.thermals.nearest(x, z, r),
    );
    this.wisps.planner = game.world.planner;
    game.setThermalSource((x, y, z) => this.thermals.lift(x, y, z));
    game.scene.add(
      this.wisps.mesh,
      this.thermals.group,
      this.lanterns.group,
      this.glow.points,
      this.soft.points,
      this.trails.group,
      this.wind.mesh,
      this.shadow.mesh,
    );
    this.thermals.update(game.flight.x, game.flight.z);

    game.onStep((dt) => this.step(dt));
    game.onFrame((dt, time) => this.frame(dt, time));
    game.events.on('contact', (e) => this.onContact(e.kind, e.x, e.y, e.z, e.strength));
    game.events.on('level', () => this.onLevel());
  }

  /** New level: clear the old world's wisps, thermals and lanterns; the path restarts at the bird. */
  private onLevel(): void {
    const g = this.game;
    this.wisps.reset();
    this.wisps.planner = g.world.planner;
    this.thermals.reset();
    this.thermals.update(g.flight.x, g.flight.z);
    this.lanterns.reset();
    g.autopilotTarget = null;
  }

  private step(dt: number): void {
    const g = this.game;
    const s = g.flight;
    this.thermals.update(s.x, s.z);
    const inside = this.thermals.insideChanged(s.x, s.y, s.z);
    if (inside !== null) g.events.emit('thermal', { inside });
    // In the menu the bot keeps collecting for the backdrop, but it doesn't score.
    const scoring = g.mode === 'playing';
    this.wisps.update(dt, s.x, s.y, s.z, s.yaw, (w) => {
      this.glow.burst(14, w.x, w.y, w.z, 7, 0.8, 0.45, this.wispColor, 0, 1);
      if (!scoring) return;
      const { lantern } = this.progress.collect();
      const p = this.progress;
      g.events.emit('wisp', {
        x: w.x,
        y: w.y,
        z: w.z,
        count: p.count,
        flow: p.flow,
        chain: p.chain,
      });
      this.hud.pulse();
      if (lantern) this.lightLantern();
    });
    if (scoring) this.progress.update(dt);
    const tr = s.trick;
    if (tr.started) g.events.emit('trickStart', { kind: tr.started, x: s.x, y: s.y, z: s.z });
    // Live multiplier through the stoop and the pull-out (stoop freezes once pulling).
    if (scoring && tr.kind === 'dive') this.hud.stoop(trickScale('dive', tr.stoop));
    if (tr.finished) this.landTrick(tr.finished, tr.size, scoring);
    if (scoring) {
      const orb = this.lanterns.reach(s.x, s.y, s.z);
      if (orb) this.reachLantern(orb.x, orb.y, orb.z);
    }
    // The bot prefers a lantern still to reach over the wisps (lanterns only light while scoring).
    const lantern = scoring ? this.lanterns.pending(s.x, s.z, Config.lantern.guide) : null;
    if (lantern) {
      this.lanternTarget.set(lantern.x, Math.max(s.y, lantern.y + 20), lantern.z);
      g.autopilotTarget = this.lanternTarget;
    } else {
      g.autopilotTarget = this.wisps.nextTarget(s.x, s.z, s.yaw);
    }
  }

  /** Flew through a lit lantern: full flow, a bonus, a surge of speed and lift, and a flare. */
  private reachLantern(x: number, y: number, z: number): void {
    const g = this.game;
    const s = g.flight;
    const points = this.progress.reachLantern();
    const c = Config.lantern;
    gust(s, c.boost, c.lift);
    this.glow.burst(50, s.x, s.y, s.z, 14, 1.4, 1.6, GOLD, -1, 4);
    this.glow.burst(40, x, y + 30, z, 20, 2.4, 2, WHITE, -2, 10);
    g.composer.flash = 0.45;
    this.hud.trick('Lantern reached', points);
    this.hud.pulse();
    g.events.emit('lanternReached', { x, y, z, points });
  }

  private landTrick(kind: TrickKind, size: number, scoring: boolean): void {
    const g = this.game;
    const s = g.flight;
    this.glow.burst(16, s.x, s.y, s.z, 6, 0.9, 0.7, this.wispColor);
    if (!scoring) return;
    const { points } = this.progress.trick(trickFamily(kind), trickScale(kind, size));
    this.hud.trick(trickName(kind, size), points);
    this.hud.pulse();
    g.events.emit('trick', { kind, size, points });
  }

  private lightLantern(): void {
    const g = this.game;
    const s = g.flight;
    // Ahead and a little to the side: it rises in view, and reaching it is a gentle turn away
    // from the wisp path, so it's a choice rather than something flown through by accident.
    const side = Math.random() < 0.5 ? -1 : 1;
    const a = s.yaw + side * 0.16;
    const x = s.x + Math.sin(a) * 170;
    const z = s.z + Math.cos(a) * 170;
    const orb = this.lanterns.ignite(x, g.world.surfaceBelow(x, Infinity, z), z);
    this.glow.burst(60, orb.x, orb.y, orb.z, 16, 2.2, 2.2, GOLD, -2, 6);
    this.glow.burst(30, orb.x, orb.y + 20, orb.z, 24, 2.6, 1.6, WHITE, 3, 8);
    g.composer.flash = 0.6;
    const n = this.progress.lanterns;
    // The first one says what lanterns are for; after that the sparks and beam say it.
    this.hud.toast(n === 1 ? 'A lantern awakens: fly through its light' : `Lantern ${n} awakens`);
    g.events.emit('lantern', { x: orb.x, y: orb.y, z: orb.z, index: n });
  }

  private onContact(
    kind: 'ground' | 'water',
    x: number,
    y: number,
    z: number,
    strength: number,
  ): void {
    if (this.contactFx > 0) return;
    this.contactFx = 0.08;
    const g = this.game;
    const n = 5 + Math.min(14, strength * 1.5);
    if (kind === 'water') {
      const sy = Config.world.waterLevel + 0.2;
      for (let i = 0; i < n * this.soft.density; i++)
        this.soft.emit(
          x + (Math.random() - 0.5) * 2,
          sy,
          z + (Math.random() - 0.5) * 2,
          (Math.random() - 0.5) * 5,
          4 + Math.random() * 5,
          (Math.random() - 0.5) * 5,
          0.9,
          0.55,
          SPLASH,
          12,
          0.5,
        );
    } else {
      const ground = g.field.height(x, z);
      const leafy = g.flightGround(x, z) - ground > 2;
      const col = leafy ? LEAF : DUST;
      for (let i = 0; i < n * this.soft.density; i++)
        this.soft.emit(
          x + (Math.random() - 0.5) * 3,
          y - 1,
          z + (Math.random() - 0.5) * 3,
          (Math.random() - 0.5) * 4,
          1 + Math.random() * 2,
          (Math.random() - 0.5) * 4,
          1.4,
          leafy ? 0.35 : 1.4,
          col,
          leafy ? 2 : -0.3,
          1.2,
        );
    }
  }

  private frame(dt: number, time: number): void {
    const g = this.game;
    const pal = g.day.palette;
    const pose = g.pose;
    this.contactFx -= dt;
    const density = QUALITY[g.quality].particles;
    this.glow.density = this.soft.density = density;

    // Wisps glow gold by day and turn moonlit cyan as the stars come out.
    this.wispColor.copy(GOLD).lerp(MOON, smoothstep(0.3, 0.9, pal.stars));
    this.wisps.render(time, this.wispColor, pose.x, pose.y, pose.z);
    if (dt > 0) {
      for (const w of this.wisps.list) {
        if (!w.alive) continue;
        w.sparkle -= dt * 6 * density;
        if (w.sparkle < 0) {
          w.sparkle += 1;
          this.glow.emit(
            w.x + (Math.random() - 0.5) * 1.5,
            w.y + (Math.random() - 0.5) * 1.5,
            w.z + (Math.random() - 0.5) * 1.5,
            0,
            -0.6,
            0,
            1.1,
            0.35,
            this.wispColor,
            0,
            0.5,
          );
        }
      }
    }
    const halfH = g.renderer.domElement.height * 0.5; // gl_PointSize is in drawing-buffer pixels
    this.glow.update(dt, halfH);
    this.soft.update(dt, halfH);
    this.thermals.render(time, halfH, this.tmp.copy(WHITE).lerp(pal.sun, 0.3));
    this.lanterns.update(dt, time, this.lanternSpark, 14 * density);

    const c = Config.flight;
    const speedT = clamp((pose.speed - c.cruiseSpeed) / (c.maxSpeed - c.cruiseSpeed), 0, 1);
    const cam = g.chase.camera.position;
    // Tricks draw bright ribbons: a roll leaves a spiral, a loop a ring.
    const trailIntensity =
      g.flight.trick.kind !== null
        ? 0.9
        : Math.min(0.85, speedT * 0.7 + Math.abs(pose.bank) * 0.45);
    this.trails.update(
      dt,
      [g.bird.tipL, g.bird.tipR],
      cam,
      trailIntensity,
      this.tmp.copy(WHITE).lerp(this.wispColor, this.progress.flow * 0.6),
    );
    const pitch = pose.pitch + pose.trickPitch;
    const cp = Math.cos(pitch);
    this.vel
      .set(Math.sin(pose.yaw) * cp, Math.sin(pitch), Math.cos(pose.yaw) * cp)
      .multiplyScalar(pose.speed);
    this.wind.update(
      cam,
      this.vel,
      speedT,
      time,
      this.tmp.copy(WHITE).lerp(pal.skyHorizon, 0.3),
      density,
    );
    this.shadow.update(pose.x, pose.y, pose.z, pose.yaw, this.shadowGround);
    this.hud.update(dt, this.progress, g.mode === 'paused');
  }
}
