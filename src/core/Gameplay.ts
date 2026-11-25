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
import type { TrailDef } from '../fx/TrailStyle';
import { Wind } from '../fx/Wind';
import { Hud } from '../ui/Hud';
import { Lanterns } from '../world/Lanterns';
import { Thermals } from '../world/Thermals';
import { Wisps } from '../world/Wisps';
import { DiscoveryTracker, type DiscoveryDef } from '../world/Discoveries';
import { Beacon } from '../world/Beacon';
import { Flock } from '../world/Flock';
import { LANTERN, PERCH_HEIGHT, Roost } from '../world/Roost';
import { DestinationTracker } from '../world/Destinations';
import { LANTERN_NOTES, NotePicker } from '../world/LanternNotes';
import { loadSeenNotes, saveSeenNotes } from './Settings';

const GOLD = new THREE.Color('#ffd27a');
const MOON = new THREE.Color('#a9e8ff');
const SPLASH = new THREE.Color('#eaf6ff');
const DUST = new THREE.Color('#e3cfa8');
const LEAF = new THREE.Color('#a6d17e');
const WHITE = new THREE.Color('#ffffff');
/** Multiplier for cloud puffs in their own shade (a cool lilac, as the cloud sea's creases). */
const SHADE = new THREE.Color('#dedaf0');
const EMBER = new THREE.Color('#ff8a33');
const EMBER_HOT = new THREE.Color('#ffd27a');

/**
 * Gameplay layer on top of the flight sandbox: wisps, flow, thermals, lanterns and the
 * feedback that makes them feel good (particles, trails, wind, HUD).
 */
export class Gameplay {
  readonly progress = new Progress();
  readonly hud: Hud;
  readonly wisps: Wisps;
  readonly thermals: Thermals;
  /** The level's hidden finds (main.ts tells it which are already found). */
  readonly discoveries = new DiscoveryTracker();
  /** The flight's journeys: the destination ahead and those reached (main.ts restarts it). */
  readonly destinations = new DestinationTracker();
  private readonly beacon = new Beacon();
  /** The birds gathered on the journeys (main.ts hands it the kept flock). */
  readonly flock = new Flock();
  private readonly roost = new Roost();
  /** Rising sparks round the cairn while its stray waits (accumulator). */
  private roostSpark = 0;
  private readonly lanterns = new Lanterns();
  /** What the lanterns hold; it remembers the notes shown lately, across flights. */
  private readonly notes = new NotePicker(LANTERN_NOTES, loadSeenNotes());
  private readonly glow = new Particles(2400, true);
  private readonly soft = new Particles(900, false);
  private readonly trails = new Trails();
  private readonly wind = new Wind();
  private readonly shadow = new BlobShadow();
  private readonly wispColor = new THREE.Color();
  /** The level's own wisp colour, parsed once per level (a hex string parse allocates). */
  private readonly levelWisp = new THREE.Color();
  private levelWispHex: string | undefined;
  private readonly vel = new THREE.Vector3();
  private readonly lanternTarget = new THREE.Vector3();
  private readonly tmp = new THREE.Color();
  private contactFx = 0;
  /** Seconds until the next puff of the wake churned up over a bird under the cloud. */
  private wakeTimer = 0;
  /** Puffs in the cloud's shade (lilac), mixed in so the churned cloud reads as heaped. */
  private readonly cloudShade = new THREE.Color();
  /** Embers owed but not yet shed (a fractional count carried between frames). */
  private emberDebt = 0;
  /** Lowest trail opacity, so the Aviary can show the trail on a lazy glide (0 in play). */
  trailPreview = 0;
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
      this.beacon.mesh,
      this.flock.mesh,
      this.roost.group,
    );
    this.thermals.update(game.flight.x, game.flight.z);
    this.discoveries.setLevel(game.world.discoveries);
    this.destinations.setSource(game.world.destinations ?? null);

    game.onStep((dt) => this.step(dt));
    game.onFrame((dt, time) => this.frame(dt, time));
    game.events.on('contact', (e) => this.onContact(e.kind, e.x, e.y, e.z, e.strength));
    game.events.on('level', () => this.onLevel());
    game.events.on('flap', () => this.flock.flap());
    game.events.on('cloud', (e) =>
      e.water
        ? this.onWaterDive(e.inside, e.x, e.z, e.strength)
        : this.onCloud(e.inside, e.x, e.z, e.strength),
    );
  }

  /**
   * A burning bird (the Phoenix) sheds embers from behind its body. Each leaves with most of the
   * bird's velocity and light drag, so the embers fall back gently into a glowing wake and burn
   * out before they reach the camera; left standing in the world, the camera (6 m back, at 40
   * m/s) flew through them and they ballooned into blurs at the lens.
   */
  private shedEmbers(
    dt: number,
    x: number,
    y: number,
    z: number,
    yaw: number,
    density: number,
  ): void {
    const rate = this.game.species.tuning.embers;
    if (rate <= 0 || this.game.mode === 'paused') return;
    this.emberDebt += rate * density * dt;
    const bx = -Math.sin(yaw);
    const bz = -Math.cos(yaw);
    while (this.emberDebt >= 1) {
      this.emberDebt -= 1;
      const back = 0.8 + Math.random() * 1.6;
      const side = (Math.random() - 0.5) * 1.6;
      this.tmp.copy(EMBER).lerp(EMBER_HOT, Math.random());
      const v = this.vel;
      const carry = Config.species.phoenix.emberCarry;
      this.glow.emit(
        x + bx * back - bz * side,
        y + (Math.random() - 0.5) * 0.6,
        z + bz * back + bx * side,
        v.x * carry + (Math.random() - 0.5) * 1.5,
        v.y * carry + 0.8 + Math.random() * 1.2,
        v.z * carry + (Math.random() - 0.5) * 1.5,
        0.5 + Math.random() * 0.4,
        0.45 + Math.random() * 0.35,
        this.tmp,
        -1.2,
        0.25,
      );
    }
  }

  /** The wingtip trail's style (the Aviary). */
  setTrail(style: TrailDef): void {
    this.trails.setStyle(style);
  }

  /** A new flight: the old journey ends; the first beacon of this one rises shortly. */
  newFlight(): void {
    this.destinations.restart();
    this.endFlight();
  }

  /** The flight is over (Rest, the title): the beacon goes out and the ribbons wander freely. */
  endFlight(): void {
    this.beacon.hide();
    this.roost.hide();
    this.flock.clearPerch();
    this.wisps.setGoal(null);
  }

  /** The wisps' daytime colour: the level's own, else gold. */
  private levelWispColor(hex: string | undefined): THREE.Color {
    if (!hex) return GOLD;
    if (hex !== this.levelWispHex) {
      this.levelWisp.set(hex);
      this.levelWispHex = hex;
    }
    return this.levelWisp;
  }

  /** New level: clear the old world's wisps, thermals and lanterns; the path restarts at the bird. */
  private onLevel(): void {
    const g = this.game;
    this.wisps.reset();
    this.wisps.planner = g.world.planner;
    this.wisps.setGoal(null);
    this.thermals.reset();
    this.thermals.update(g.flight.x, g.flight.z);
    this.lanterns.reset();
    this.discoveries.setLevel(g.world.discoveries);
    this.destinations.setSource(g.world.destinations ?? null);
    this.beacon.hide();
    this.roost.hide();
    this.flock.clearPerch();
    this.flock.snap();
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
      const find = this.discoveries.step(dt, s.x, s.y, s.z, g.day.palette.stars);
      if (find) this.discover(find);
      const change = this.destinations.step(dt, s.x, s.y, s.z, s.yaw);
      if (change === 'set') this.beginJourney();
      else if (change === 'arrived') this.arrive();
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
    // Light and a bell say it: the points go to the score, not the screen. The words are the
    // lantern's note (Eden keeps a quiet "Lantern reached").
    if (g.level.lanternNotes ?? true) {
      const L = Config.lantern;
      const note = this.notes.pick(L.noteGap, L.noteRare, Math.random);
      this.hud.note(note.text, L.noteSeconds, note.by);
      saveSeenNotes(this.notes.seen);
    } else {
      this.hud.trick('Lantern reached', 0);
    }
    this.hud.pulse();
    g.events.emit('lanternReached', { x, y, z, points });
  }

  /** A beacon rises over the next destination, and the ribbons start leaning toward it. */
  private beginJourney(): void {
    const g = this.game;
    const d = this.destinations.current!;
    this.beacon.show(d.x, d.y, d.z, d.beacon);
    const r = d.roost;
    if (r) {
      this.roost.show(r.x, r.y, r.z, r.yaw);
      this.flock.perchAt(r.x, r.y + PERCH_HEIGHT, r.z, r.yaw, d.tint);
    } else {
      this.roost.hide();
      this.flock.clearPerch();
    }
    this.wisps.setGoal(d.route);
    const first = this.destinations.reachedNames.length === 0;
    // Words only for where it leads; the column of light says the rest.
    this.hud.notice(first ? `A beacon rises over ${d.name}` : `Onward to ${d.name}`);
    g.events.emit('destination', { name: d.name, x: d.x, y: d.y, z: d.z, first });
  }

  /** Reached the journey's end: the beacon flares, light and a surge, and its name. */
  private arrive(): void {
    const g = this.game;
    const s = g.flight;
    const d = this.destinations.last!;
    const K = Config.destinations;
    this.beacon.arrive();
    this.wisps.setGoal(null);
    // The stray takes off from its cairn and joins (a puff of feathers as it goes). No cairn:
    // no bird joins (tint -1).
    const r = d.roost;
    const tint = r ? this.flock.join(s.x, s.y, s.z) : -1;
    if (r) this.soft.burst(10, r.x, r.y + PERCH_HEIGHT, r.z, 3, 0.9, 0.5, WHITE, -1, 1.5);
    gust(s, K.boost, K.lift);
    this.glow.burst(70, s.x, s.y, s.z, 16, 1.8, 2, GOLD, -0.8, 5);
    this.glow.burst(50, d.x, s.y + 20, d.z, 26, 2.8, 2.4, WHITE, 2, 12);
    g.composer.flash = Math.max(g.composer.flash, K.flash);
    this.progress.flow = 1;
    this.hud.toast(d.message ?? `${d.name} reached`, 3.5);
    this.hud.pulse();
    g.world.arrived?.(d.id);
    g.events.emit('arrival', { id: d.id, name: d.name, x: s.x, y: s.y, z: s.z, tint });
  }

  /** A hidden find: no words in flight (the Rest card names it), just light and a chime. */
  private discover(d: DiscoveryDef): void {
    const g = this.game;
    const s = g.flight;
    this.glow.burst(40, s.x, s.y, s.z, 10, 1.6, 1.8, GOLD, -0.6, 3);
    this.glow.burst(24, s.x, s.y + 6, s.z, 14, 2.2, 1.4, WHITE, 1.5, 5);
    g.composer.flash = Math.max(g.composer.flash, Config.discoveries.flash);
    this.hud.pulse();
    g.events.emit('discovery', { id: d.id, name: d.name, x: s.x, y: s.y, z: s.z });
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
    if (n === 1)
      this.hud.toast(
        (g.level.lanternNotes ?? true)
          ? 'A lantern awakens: something waits inside'
          : 'A lantern awakens: fly through its light',
      );
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
      const col = leafy ? LEAF : (g.world.skimColor ?? DUST);
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

  /**
   * Plunging into the cloud throws a crown of cloud up round the hole and out across the tops;
   * bursting out, vapour streams off the bird and trails it up into the air.
   */
  private onCloud(inside: boolean, x: number, z: number, strength: number): void {
    const g = this.game;
    const col = g.world.softColor ?? WHITE;
    const shade = this.cloudShade.copy(col).multiply(SHADE);
    // Puffs sit a little over the tops: a flat sprite crossing the cloud's surface is cut sharp.
    const top = g.flightGround(x, z) + 1.2;
    const k = Math.min(1, 0.4 + strength / 18);
    const n = Math.round((14 + 22 * k) * this.soft.density);
    const s = g.flight;
    const fx = Math.sin(s.yaw);
    const fz = Math.cos(s.yaw);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      if (inside) {
        // A ring rolling outward low over the tops, and a few thrown higher from the hole.
        const out = 3 + Math.random() * 6 * k;
        const high = i % 4 === 0;
        this.soft.emit(
          x + ca * 1.5,
          top + 0.6,
          z + sa * 1.5,
          ca * out + fx * s.speed * 0.15,
          high ? 5 + Math.random() * 6 * k : 1 + Math.random() * 2.5,
          sa * out + fz * s.speed * 0.15,
          1.3 + Math.random() * 0.8,
          high ? 2 + Math.random() * 1.5 : 3 + Math.random() * 2.5,
          i % 3 === 1 ? shade : col,
          high ? 3 : -0.2,
          1.6,
        );
      } else {
        // Vapour peeling off the bird as it rises: carried up with it, then left behind.
        const r = Math.random() * 2;
        const carry = 0.25 + Math.random() * 0.4;
        this.soft.emit(
          s.x + ca * r,
          Math.max(top + 0.4, s.y - Math.random() * 2),
          s.z + sa * r,
          fx * s.speed * carry + ca * 2,
          2 + Math.random() * 4 * k,
          fz * s.speed * carry + sa * 2,
          0.9 + Math.random() * 0.8,
          2 + Math.random() * 2,
          i % 3 === 1 ? shade : col,
          -0.4,
          1.8,
        );
      }
    }
  }

  /**
   * Gliding under deep water: a splash and a ring of foam spreading on the surface; coming out,
   * droplets stream off the bird and fall back, over a smaller splash.
   */
  private onWaterDive(inside: boolean, x: number, z: number, strength: number): void {
    const g = this.game;
    const s = g.flight;
    const sea = Config.world.waterLevel;
    const k = Math.min(1, 0.4 + strength / 14);
    const n = Math.round((16 + 24 * k) * this.soft.density);
    const fx = Math.sin(s.yaw);
    const fz = Math.cos(s.yaw);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const ca = Math.cos(a);
      const sa = Math.sin(a);
      if (inside || i % 3 === 0) {
        // Spray thrown up round the hole (falling back), and a ring of foam on the water.
        const foam = i % 2 === 0;
        const out = foam ? 3 + Math.random() * 4 * k : 1.5 + Math.random() * 3;
        this.soft.emit(
          x + ca * 1.2,
          sea + (foam ? 0.25 : 0.4),
          z + sa * 1.2,
          ca * out + fx * s.speed * 0.1,
          foam ? 0.4 : (inside ? 5 : 3) + Math.random() * 5 * k,
          sa * out + fz * s.speed * 0.1,
          foam ? 1.2 + Math.random() * 0.6 : 0.7 + Math.random() * 0.4,
          foam ? 1.4 + Math.random() * 1.2 : 0.45 + Math.random() * 0.5,
          SPLASH,
          foam ? 0 : 12,
          foam ? 1.8 : 0.5,
        );
      } else {
        // Droplets streaming off the bird as it rises, carried a little, then falling.
        const r = Math.random() * 1.2;
        this.soft.emit(
          s.x + ca * r,
          Math.max(sea + 0.3, s.y - Math.random()),
          s.z + sa * r,
          fx * s.speed * (0.2 + Math.random() * 0.3) + ca,
          2 + Math.random() * 3,
          fz * s.speed * (0.2 + Math.random() * 0.3) + sa,
          0.6 + Math.random() * 0.5,
          0.3 + Math.random() * 0.35,
          SPLASH,
          12,
          0.4,
        );
      }
    }
  }

  /**
   * While the bird is under the cloud a trail of churned puffs rises over it, to follow it by;
   * under water, bubbles break the surface over it.
   */
  private frameWake(dt: number): void {
    const g = this.game;
    const s = g.flight;
    if (s.cloud <= Config.flight.cloudIn || dt <= 0) {
      this.wakeTimer = 0;
      return;
    }
    const sea = Config.world.waterLevel;
    if (g.flightGround(s.x, s.z) < sea) {
      this.wakeTimer -= dt;
      while (this.wakeTimer <= 0) {
        this.wakeTimer += 1 / (34 * this.soft.density + 1e-3);
        const spread = 0.8 + s.cloud * 0.12;
        this.soft.emit(
          s.x + (Math.random() - 0.5) * 2 * spread,
          sea + 0.15,
          s.z + (Math.random() - 0.5) * 2 * spread,
          (Math.random() - 0.5) * 0.6,
          0.2 + Math.random() * 0.4,
          (Math.random() - 0.5) * 0.6,
          0.5 + Math.random() * 0.5,
          0.15 + Math.random() * 0.25,
          SPLASH,
          0,
          1.2,
        );
      }
      return;
    }
    const col = g.world.softColor ?? WHITE;
    const shade = this.cloudShade.copy(col).multiply(SHADE);
    this.wakeTimer -= dt;
    let n = 0;
    while (this.wakeTimer <= 0) {
      this.wakeTimer += 1 / (30 * this.soft.density + 1e-3);
      const top = g.flightGround(s.x, s.z);
      // Deeper, the swell over the bird is broader and gentler.
      const spread = 1 + s.cloud * 0.25;
      this.soft.emit(
        s.x + (Math.random() - 0.5) * 2 * spread,
        top + 1.3,
        s.z + (Math.random() - 0.5) * 2 * spread,
        (Math.random() - 0.5) * 2,
        1 + Math.random() * 2,
        (Math.random() - 0.5) * 2,
        0.9 + Math.random() * 0.6,
        2 + Math.random() * 1.6 * spread,
        n++ % 3 === 1 ? shade : col,
        -0.2,
        1.4,
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
    this.frameWake(dt);

    // Wisps glow gold by day (or the level's own colour) and turn moonlit cyan as the stars
    // come out.
    this.wispColor
      .copy(this.levelWispColor(g.level.wispColor))
      .lerp(MOON, smoothstep(0.3, 0.9, pal.stars));
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
    this.beacon.update(dt, time, g.chase.camera);
    this.roost.update(time, pal.stars);
    this.flock.update(dt, time, pose, g.world);
    // Sparks rise from the cairn's lantern while its stray waits, so it reads up close.
    const cur = this.destinations.current;
    const r = cur?.roost;
    if (r && dt > 0 && Math.hypot(r.x - pose.x, r.z - pose.z) < 300) {
      this.roostSpark -= dt * 5 * density;
      if (this.roostSpark < 0) {
        this.roostSpark += 1;
        // The lantern in the cairn's frame, turned by its yaw.
        const c = Math.cos(r.yaw);
        const sn = Math.sin(r.yaw);
        const L = LANTERN;
        this.lanternSpark(r.x + L.x * c + L.z * sn, r.y + L.y + 0.2, r.z - L.x * sn + L.z * c);
      }
    }

    const c = Config.flight;
    const speedT = clamp((pose.speed - c.cruiseSpeed) / (c.maxSpeed - c.cruiseSpeed), 0, 1);
    const cam = g.chase.camera.position;
    // Tricks draw bright ribbons: a roll leaves a spiral.
    const trailIntensity =
      g.flight.trick.kind !== null
        ? 0.9
        : Math.min(0.85, speedT * 0.7 + Math.abs(pose.bank) * 0.45);
    this.trails.update(
      dt,
      [g.bird.tipL, g.bird.tipR],
      cam,
      Math.max(trailIntensity, this.trailPreview),
      this.wispColor,
      this.progress.flow,
    );
    const cp = Math.cos(pose.pitch);
    this.vel
      .set(Math.sin(pose.yaw) * cp, Math.sin(pose.pitch), Math.cos(pose.yaw) * cp)
      .multiplyScalar(pose.speed);
    this.shedEmbers(dt, pose.x, pose.y, pose.z, pose.yaw, density);
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
