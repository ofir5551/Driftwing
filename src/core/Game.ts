import * as THREE from 'three';
import { Config, QUALITY, type QualityLevel } from './Config';
import { Events } from './Events';
import { Input } from './Input';
import { Loop, STEP } from './Loop';
import { angleDelta, clamp, lerp } from './math';
import { createDebugPanel } from './DebugPanel';
import { Bird, type Pose } from '../player/Bird';
import { ChaseCamera } from '../player/ChaseCamera';
import {
  createFlightState,
  stepFlight,
  type FlightEnv,
  type FlightInput,
} from '../player/FlightModel';
import { Composer } from '../fx/Composer';
import { LEVELS } from '../levels';
import type { LevelDef, LevelId, Spawn, World } from '../levels/World';
import { Clouds } from '../world/Clouds';
import { DAY_SKY, DayCycle, presetPhase, type TimeOfDay } from '../world/DayCycle';
import { Sky } from '../world/Sky';
import type { HeightField } from '../world/Terrain';
import { Water } from '../world/Water';

const params = new URLSearchParams(location.search);

export type Mode = 'menu' | 'playing' | 'paused';

export class Game {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly events = new Events();
  readonly input: Input;
  readonly day: DayCycle;
  /** The level being flown and its streamed world (swapped by setLevel). */
  level!: LevelDef;
  world!: World;
  /** Where the current level starts the bird (screenshot scripts frame views from it). */
  spawn!: Spawn;
  readonly flight = createFlightState(0, 45, 0, 0);
  readonly pose: Pose = {
    x: 0,
    y: 0,
    z: 0,
    yaw: 0,
    pitch: 0,
    bank: 0,
    speed: 0,
    trickPitch: 0,
    spin: 0,
    loopR: 0,
  };
  readonly chase: ChaseCamera;
  readonly bird = new Bird();
  readonly composer: Composer;
  private readonly prev = {
    x: 0,
    y: 0,
    z: 0,
    yaw: 0,
    pitch: 0,
    bank: 0,
    speed: 0,
    trickPitch: 0,
    spin: 0,
  };
  private readonly sky = new Sky();
  private readonly water = new Water();
  private readonly clouds: Clouds;
  private readonly sun = new THREE.DirectionalLight('#fff', 2);
  private readonly hemi = new THREE.HemisphereLight('#fff', '#888', 1.4);
  private readonly loop: Loop;
  private readonly env: FlightEnv;
  /** Systems that want a fixed-step tick or a per-frame update hook in (M3+). */
  private readonly stepHooks: ((dt: number) => void)[] = [];
  private readonly frameHooks: ((dt: number, time: number) => void)[] = [];
  mode: Mode = 'menu';
  time = 0;
  quality: QualityLevel = 'high';
  pixelRatio = 1;
  /** Resolution multiplier from adaptive quality (0.55..1). */
  renderScale = 1;
  /** When true, sustained slow frames also step the preset down (high -> medium -> low). */
  autoQuality = true;
  private readonly camGround = (x: number, z: number): number => this.world.field.height(x, z);
  private readonly camPush = (p: THREE.Vector3): void => this.world.pushPoint(p, 1.2);
  private perfTimer = 0;
  private fastTime = 0;
  readonly autopilot = params.has('autopilot');
  private timeOfDay: TimeOfDay = 'auto';
  /** Autopilot steering target, set by gameplay (wisps) when available. */
  autopilotTarget: { x: number; y: number; z: number } | null = null;

  constructor(
    container: HTMLElement,
    ui: HTMLElement,
    levelId: LevelId,
    timeOfDay: TimeOfDay = 'auto',
  ) {
    this.timeOfDay = timeOfDay;
    this.renderer = new THREE.WebGLRenderer({
      antialias: false,
      powerPreference: 'high-performance',
    });
    this.renderer.info.autoReset = false; // the composer renders several passes; count the whole frame
    container.appendChild(this.renderer.domElement);

    Config.world.seed = Number(params.get('seed') ?? Config.world.seed);
    this.day = new DayCycle(params.has('time') ? Number(params.get('time')) : 0.06);
    this.chase = new ChaseCamera(innerWidth / innerHeight);
    this.input = new Input(this.renderer.domElement, ui);
    this.clouds = new Clouds(Config.world.seed, QUALITY.high.clouds);
    this.composer = new Composer(this.renderer, this.scene, this.chase.camera);
    this.env = {
      groundAt: (x, z) => this.world.flightGround(x, z),
      thermalAt: () => 0,
    };

    this.scene.fog = new THREE.Fog('#fff', 200, 1000);
    this.scene.add(
      this.sky.mesh,
      this.sun,
      this.sun.target,
      this.hemi,
      this.bird.root,
      this.water.mesh,
      this.clouds.mesh,
    );
    const q = params.get('quality');
    this.setQuality(q === 'low' || q === 'medium' || q === 'high' ? q : this.defaultQuality());
    this.setLevel(levelId);

    addEventListener('resize', () => this.resize());
    // Mobile browsers report the new size a moment after rotation.
    addEventListener('orientationchange', () => setTimeout(() => this.resize(), 250));
    this.loop = new Loop(
      (dt) => this.step(dt),
      (alpha, frameDt) => this.render(alpha, frameDt),
    );
    if (params.has('debug'))
      void createDebugPanel((gui) => {
        const stats = { fps: 0, chunks: 0, pending: 0, quality: this.quality };
        const f = gui.addFolder('stats');
        f.add(stats, 'fps').listen().disable();
        f.add(stats, 'chunks').listen().disable();
        f.add(stats, 'pending').listen().disable();
        f.add(stats, 'quality', ['low', 'medium', 'high']).onChange((v: QualityLevel) =>
          this.setQuality(v),
        );
        f.add(this.day, 'phase', 0, 1, 0.001).listen();
        setInterval(() => {
          stats.fps = Math.round(1000 / this.loop.frameMs);
          stats.chunks = this.world.chunkCount;
          stats.pending = this.world.pending;
        }, 500);
      });
  }

  private defaultQuality(): QualityLevel {
    const coarse = matchMedia('(pointer: coarse)').matches;
    return coarse ? 'medium' : 'high';
  }

  setQuality(level: QualityLevel): void {
    this.quality = level;
    const q = QUALITY[level];
    Config.render.drawDistance = q.drawDistance;
    Config.render.treeDistance = q.treeDistance;
    Config.render.clouds = q.clouds;
    this.composer.setBloomEnabled(q.bloom);
    this.pixelRatio = Math.min(devicePixelRatio, q.maxPixelRatio);
    this.renderScale = 1;
    this.resize();
  }

  /**
   * Swap the world for another level: dispose the old scenery, build the new one around its
   * spawn point, put the bird there and reset time of day. Gameplay and audio follow the
   * 'level' event.
   */
  setLevel(id: LevelId): void {
    if (this.world) {
      this.scene.remove(this.world.group);
      this.world.dispose();
    }
    this.level = LEVELS[id];
    Config.flight.maxAltitude = this.level.maxAltitude;
    const { world, spawn } = this.level.create(Config.world.seed);
    this.world = world;
    this.spawn = spawn;
    this.scene.add(world.group);
    Object.assign(this.flight, createFlightState(spawn.x, spawn.y, spawn.z, spawn.yaw));
    world.prime(spawn.x, spawn.z);
    this.copyPrev();
    this.chase.snap();
    this.day.setKeys(this.level.sky ?? DAY_SKY);
    this.setTimeOfDay(this.timeOfDay);
    this.sky.backdrop = this.level.backdrop;
    this.events.emit('level', { id });
  }

  /**
   * Pick the time of day: 'auto' runs the level's own cycle from its start phase, anything else
   * holds that keyframe. A `?time=` URL flag overrides this for debugging and screenshots.
   */
  setTimeOfDay(t: TimeOfDay): void {
    this.timeOfDay = t;
    if (params.has('time')) return;
    this.day.frozen = t !== 'auto';
    this.day.setPhase(t === 'auto' ? this.level.startPhase : presetPhase(t));
  }

  /** Bare terrain of the current level. */
  get field(): HeightField {
    return this.world.field;
  }

  /** Soft ground for flight: terrain plus canopy (see World.flightGround). */
  flightGround(x: number, z: number): number {
    return this.world.flightGround(x, z);
  }

  onStep(fn: (dt: number) => void): void {
    this.stepHooks.push(fn);
  }

  onFrame(fn: (dt: number, time: number) => void): void {
    this.frameHooks.push(fn);
  }

  setThermalSource(fn: (x: number, y: number, z: number) => number): void {
    this.env.thermalAt = fn;
  }

  start(): void {
    this.loop.start();
  }

  setMode(mode: Mode): void {
    this.mode = mode;
    this.input.enabled = mode === 'playing';
    this.input.touch.setVisible(mode === 'playing');
    if (mode !== 'playing') this.input.releasePointerLock();
  }

  get frameMs(): number {
    return this.loop.frameMs;
  }

  private copyPrev(): void {
    const s = this.flight;
    const p = this.prev;
    p.x = s.x;
    p.y = s.y;
    p.z = s.z;
    p.yaw = s.yaw;
    p.pitch = s.pitch;
    p.bank = s.bank;
    p.speed = s.speed;
    p.trickPitch = s.trickPitch;
    p.spin = s.spin;
  }

  private step(dt: number): void {
    if (this.mode === 'paused') return;
    this.copyPrev();
    const inp = this.input.update();
    if (this.mode === 'menu' || this.autopilot) this.autopilotInput(inp);
    const s = this.flight;
    this.world.assist(s, inp);
    stepFlight(s, inp, this.env, dt);
    const hit = this.world.collide(s);
    if (hit > 0 && s.contact === 'none') {
      s.contact = 'ground';
      s.contactStrength = Math.max(s.contactStrength, hit);
    }
    if (s.flapped) this.events.emit('flap', { x: s.x, y: s.y, z: s.z });
    if (s.climbBeat) this.events.emit('wingbeat', { x: s.x, y: s.y, z: s.z });
    if (s.contact !== 'none')
      this.events.emit('contact', {
        kind: s.contact,
        x: s.x,
        y: s.y,
        z: s.z,
        strength: s.contactStrength,
      });
    for (const fn of this.stepHooks) fn(dt);
  }

  /**
   * Bot steering for the menu backdrop and ?autopilot screenshots: heads for the gameplay
   * target when there is one, otherwise drifts in lazy S-curves at a comfortable height.
   */
  private autopilotInput(inp: FlightInput): void {
    const s = this.flight;
    const t = this.autopilotTarget;
    if (t) {
      const desired = Math.atan2(t.x - s.x, t.z - s.z);
      inp.steerX = clamp(-angleDelta(s.yaw, desired) * 2.2, -1, 1);
      inp.steerY = clamp((t.y - s.y) * 0.08, -0.8, 0.8);
    } else {
      inp.steerX = Math.sin(this.time * 0.23) * 0.55 + Math.sin(this.time * 0.61) * 0.2;
      const ground = Math.max(this.flightGround(s.x, s.z), Config.world.waterLevel);
      inp.steerY = clamp((ground + 30 - s.y) * 0.05, -0.6, 0.6);
    }
    inp.flap = this.mode === 'menu' ? false : inp.flap;
  }

  private render(alpha: number, frameDt: number): void {
    this.renderer.info.reset();
    const dt = this.mode === 'paused' ? 0 : frameDt;
    this.time += dt;
    const s = this.flight;
    const p = this.prev;
    const o = this.pose;
    o.x = lerp(p.x, s.x, alpha);
    o.y = lerp(p.y, s.y, alpha);
    o.z = lerp(p.z, s.z, alpha);
    o.yaw = p.yaw + angleDelta(p.yaw, s.yaw) * alpha;
    o.pitch = lerp(p.pitch, s.pitch, alpha);
    o.bank = lerp(p.bank, s.bank, alpha);
    o.speed = lerp(p.speed, s.speed, alpha);
    // Trick angles wrap back to 0 when a trick ends (a whole turn), so interpolate the short way.
    o.trickPitch = p.trickPitch + angleDelta(p.trickPitch, s.trickPitch) * alpha;
    o.spin = p.spin + angleDelta(p.spin, s.spin) * alpha;
    o.loopR = s.trick.kind === 'loop' ? s.trick.radius : 0;

    this.day.update(dt, Config.world.dayLength * this.level.dayScale);
    this.bird.update(o, s.sinceFlap + alpha * STEP, s.sinceClimbBeat + alpha * STEP, this.time, dt);
    this.chase.update(o, Math.max(dt, 1e-4), this.camGround, this.camPush);
    this.world.update(o.x, o.z);
    this.world.frame(dt, this.time, this.day);
    const cam = this.chase.camera;
    this.applyPalette();
    this.sky.update(this.day, cam, this.time);
    this.water.update(this.day, cam, this.time);
    this.clouds.update(this.day, cam.position, this.time);
    for (const fn of this.frameHooks) fn(dt, this.time);
    this.composer.render(this.day, this.time, dt, this.level.saturation ?? 1);
    this.adaptQuality(frameDt);
  }

  private applyPalette(): void {
    const pal = this.day.palette;
    const fog = this.scene.fog as THREE.Fog;
    fog.color.copy(pal.fog);
    fog.far = Config.render.drawDistance * 0.95;
    fog.near = fog.far * Config.render.fogStart;
    this.sun.color.copy(pal.sun);
    this.sun.intensity = pal.sunIntensity;
    this.sun.position.copy(this.day.sunDir).multiplyScalar(100).add(this.bird.root.position);
    this.sun.target.position.copy(this.bird.root.position);
    this.hemi.color.copy(pal.hemiSky);
    this.hemi.groundColor.copy(pal.hemiGround);
    this.hemi.intensity = pal.hemiIntensity;
    const cam = this.chase.camera;
    const far = Config.render.drawDistance * 1.3;
    if (cam.far !== far) {
      cam.far = far;
      cam.updateProjectionMatrix();
    }
  }

  /**
   * Adaptive resolution: if the smoothed frame time stays above ~47 fps worth, render fewer
   * pixels; when it has been comfortably fast for a while, creep back up. Asymmetric thresholds
   * and timers stop it oscillating. At the floor, auto mode drops a quality preset instead.
   */
  private adaptQuality(frameDt: number): void {
    if (this.mode === 'paused') return;
    this.perfTimer += frameDt;
    if (this.perfTimer < 1) return;
    this.perfTimer = 0;
    const ms = this.loop.frameMs;
    if (ms > 21) {
      this.fastTime = 0;
      if (this.renderScale > 0.6) {
        this.renderScale = Math.max(0.55, this.renderScale - 0.1);
        this.resize();
      } else if (this.autoQuality && this.quality !== 'low') {
        this.setQuality(this.quality === 'high' ? 'medium' : 'low');
      }
    } else if (ms < 17.8) {
      this.fastTime += 1;
      if (this.fastTime >= 6 && this.renderScale < 1) {
        this.fastTime = 0;
        this.renderScale = Math.min(1, this.renderScale + 0.05);
        this.resize();
      }
    }
  }

  resize(): void {
    const pr = this.pixelRatio * this.renderScale;
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(innerWidth, innerHeight);
    this.composer.setSize(innerWidth, innerHeight, pr);
    this.chase.camera.aspect = innerWidth / innerHeight;
    this.chase.camera.updateProjectionMatrix();
  }

  /** Small hook for automated screenshots/tests. */
  info(): Record<string, number | string> {
    const s = this.flight;
    return {
      x: s.x | 0,
      y: s.y | 0,
      z: s.z | 0,
      speed: +s.speed.toFixed(1),
      fps: +(1000 / this.loop.frameMs).toFixed(0),
      mode: this.mode,
      phase: +this.day.phase.toFixed(3),
      level: this.level.id,
      chunks: this.world.chunkCount,
      calls: this.renderer.info.render.calls,
      tris: this.renderer.info.render.triangles,
    };
  }
}
