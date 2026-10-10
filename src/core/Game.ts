import * as THREE from 'three';
import { Config, QUALITY, type QualityLevel } from './Config';
import { Events } from './Events';
import { Input } from './Input';
import { Loop, STEP } from './Loop';
import { angleDelta, clamp, lerp, smoothstep } from './math';
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
import { ChunkManager } from '../world/ChunkManager';
import { Clouds } from '../world/Clouds';
import { DayCycle } from '../world/DayCycle';
import { Islands } from '../world/Islands';
import { Sky } from '../world/Sky';
import { createHeightField, type HeightField } from '../world/Terrain';
import { Water } from '../world/Water';

const params = new URLSearchParams(location.search);

export type Mode = 'menu' | 'playing' | 'paused';

export class Game {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly events = new Events();
  readonly input: Input;
  readonly day: DayCycle;
  readonly field: HeightField;
  readonly flight = createFlightState(0, 45, 0, 0);
  readonly pose: Pose = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, bank: 0, speed: 0 };
  readonly chase: ChaseCamera;
  readonly bird = new Bird();
  readonly chunks: ChunkManager;
  readonly islands: Islands;
  readonly composer: Composer;
  private readonly prev = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, bank: 0, speed: 0 };
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
  private perfTimer = 0;
  private fastTime = 0;
  readonly autopilot = params.has('autopilot');
  /** Autopilot steering target, set by gameplay (wisps) when available. */
  autopilotTarget: { x: number; y: number; z: number } | null = null;

  constructor(container: HTMLElement, ui: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({
      antialias: false,
      powerPreference: 'high-performance',
    });
    this.renderer.info.autoReset = false; // the composer renders several passes; count the whole frame
    container.appendChild(this.renderer.domElement);

    Config.world.seed = Number(params.get('seed') ?? Config.world.seed);
    this.field = createHeightField(Config.world.seed);
    this.day = new DayCycle(params.has('time') ? Number(params.get('time')) : 0.06);
    this.chase = new ChaseCamera(innerWidth / innerHeight);
    this.input = new Input(this.renderer.domElement, ui);
    this.chunks = new ChunkManager(this.field);
    this.islands = new Islands(this.field);
    this.clouds = new Clouds(Config.world.seed, QUALITY.high.clouds);
    this.composer = new Composer(this.renderer, this.scene, this.chase.camera);
    this.env = {
      groundAt: (x, z) => this.flightGround(x, z),
      thermalAt: () => 0,
    };

    this.scene.fog = new THREE.Fog('#fff', 200, 1000);
    this.scene.add(
      this.sky.mesh,
      this.sun,
      this.sun.target,
      this.hemi,
      this.bird.root,
      this.chunks.group,
      this.islands.group,
      this.water.mesh,
      this.clouds.mesh,
    );
    const q = params.get('quality');
    this.setQuality(q === 'low' || q === 'medium' || q === 'high' ? q : this.defaultQuality());
    this.chunks.prime(this.flight.x, this.flight.z);
    this.islands.update(this.flight.x, this.flight.z);
    this.copyPrev();

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
          stats.chunks = this.chunks.count;
          stats.pending = this.chunks.pending;
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

  /** Terrain plus a soft "canopy" over dense forest, so the bird skims treetops instead of clipping trees. */
  flightGround(x: number, z: number): number {
    const h = this.field.height(x, z);
    if (h < 1.2 || h > 115) return h;
    return h + smoothstep(0.45, 0.8, this.field.forest(x, z)) * Config.world.canopyHeight;
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
  }

  private step(dt: number): void {
    if (this.mode === 'paused') return;
    this.copyPrev();
    const inp = this.input.update();
    if (this.mode === 'menu' || this.autopilot) this.autopilotInput(inp);
    const s = this.flight;
    stepFlight(s, inp, this.env, dt);
    const pushed = this.islands.push(s, Config.flight.clearance);
    if (pushed > 0) {
      s.liftVy = Math.max(s.liftVy, 3);
      s.speed *= 1 - 0.1 * dt;
      if (s.contact === 'none') {
        s.contact = 'ground';
        s.contactStrength = Math.max(s.contactStrength, pushed * 10);
      }
    }
    if (s.flapped) this.events.emit('flap', { x: s.x, y: s.y, z: s.z });
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

    this.day.update(dt, Config.world.dayLength);
    this.bird.update(o, s.sinceFlap + alpha * STEP, this.time, dt);
    this.chase.update(o, Math.max(dt, 1e-4), (x, z) => this.field.height(x, z));
    this.chunks.update(o.x, o.z);
    this.islands.update(o.x, o.z);
    const cam = this.chase.camera;
    this.applyPalette();
    this.sky.update(this.day, cam, this.time);
    this.water.update(this.day, cam, this.time);
    this.clouds.update(this.day, cam.position, this.time);
    for (const fn of this.frameHooks) fn(dt, this.time);
    this.composer.render(this.day, this.time, dt);
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
      chunks: this.chunks.count,
      calls: this.renderer.info.render.calls,
      tris: this.renderer.info.render.triangles,
    };
  }
}
