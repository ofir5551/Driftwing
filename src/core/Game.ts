import * as THREE from 'three';
import { Config } from './Config';
import { Events } from './Events';
import { Input } from './Input';
import { Loop, STEP } from './Loop';
import { angleDelta, lerp } from './math';
import { createDebugPanel } from './DebugPanel';
import { Bird, type Pose } from '../player/Bird';
import { ChaseCamera } from '../player/ChaseCamera';
import { createFlightState, stepFlight, type FlightEnv } from '../player/FlightModel';
import { DayCycle } from '../world/DayCycle';
import { Sky } from '../world/Sky';
import {
  createChunkGeometry,
  createHeightField,
  fillChunkGeometry,
  getToonGradient,
  type HeightField,
} from '../world/Terrain';

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
  private readonly prev = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, bank: 0, speed: 0 };
  readonly pose: Pose = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, bank: 0, speed: 0 };
  private readonly chase: ChaseCamera;
  private readonly sky = new Sky();
  private readonly bird = new Bird();
  private readonly sun = new THREE.DirectionalLight('#fff', 2);
  private readonly hemi = new THREE.HemisphereLight('#fff', '#888', 1.4);
  private readonly loop: Loop;
  private readonly env: FlightEnv;
  mode: Mode = 'menu';
  time = 0;
  readonly autopilot = params.has('autopilot');

  constructor(container: HTMLElement, ui: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setSize(innerWidth, innerHeight);
    container.appendChild(this.renderer.domElement);

    Config.world.seed = Number(params.get('seed') ?? Config.world.seed);
    this.field = createHeightField(Config.world.seed);
    this.day = new DayCycle(params.has('time') ? Number(params.get('time')) : 0.08);
    this.chase = new ChaseCamera(innerWidth / innerHeight);
    this.input = new Input(this.renderer.domElement, ui);
    this.env = {
      groundAt: (x, z) => this.field.height(x, z),
      thermalAt: () => 0,
    };

    this.scene.fog = new THREE.Fog('#fff', 120, 900);
    this.scene.add(this.sky.mesh, this.sun, this.sun.target, this.hemi, this.bird.root);
    this.buildStaticTerrain();
    this.copyPrev();

    addEventListener('resize', () => this.resize());
    this.loop = new Loop(
      (dt) => this.step(dt),
      (alpha, frameDt) => this.render(alpha, frameDt),
    );
    if (params.has('debug')) void createDebugPanel(() => {});
  }

  // ponytail: fixed 9x9 grid until ChunkManager streams chunks in M2.
  private buildStaticTerrain(): void {
    const mat = new THREE.MeshToonMaterial({ vertexColors: true, gradientMap: getToonGradient() });
    const size = Config.world.chunkSize;
    for (let j = -4; j <= 4; j++)
      for (let i = -4; i <= 4; i++) {
        const g = createChunkGeometry(Config.world.chunkRes);
        fillChunkGeometry(g, this.field, i * size, j * size, size, Config.world.chunkRes);
        const m = new THREE.Mesh(g, mat);
        m.position.set(i * size, 0, j * size);
        this.scene.add(m);
      }
    const water = new THREE.Mesh(
      new THREE.PlaneGeometry(4000, 4000).rotateX(-Math.PI / 2),
      new THREE.MeshToonMaterial({
        color: '#8fb6d0',
        gradientMap: getToonGradient(),
        transparent: true,
        opacity: 0.85,
      }),
    );
    water.position.y = Config.world.waterLevel;
    this.scene.add(water);
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
    stepFlight(this.flight, inp, this.env, dt);
    const s = this.flight;
    if (s.flapped) this.events.emit('flap', { x: s.x, y: s.y, z: s.z });
  }

  /** Gentle attract-mode steering: lazy S-curves that keep a comfortable height. */
  private autopilotInput(inp: { steerX: number; steerY: number; flap: boolean }): void {
    const s = this.flight;
    inp.steerX = Math.sin(this.time * 0.23) * 0.55 + Math.sin(this.time * 0.61) * 0.2;
    const ground = Math.max(this.field.height(s.x, s.z), Config.world.waterLevel);
    inp.steerY = THREE.MathUtils.clamp((ground + 28 - s.y) * 0.05, -0.6, 0.6);
    inp.flap = false;
  }

  private render(alpha: number, frameDt: number): void {
    const paused = this.mode === 'paused';
    const dt = paused ? 0 : frameDt;
    this.time += dt;
    if (this.input.pausePressed) {
      this.input.pausePressed = false;
    }
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

    this.bird.update(o, s.sinceFlap + alpha * STEP, this.time, dt);
    this.chase.update(o, Math.max(dt, 1e-4), (x, z) => this.field.height(x, z));
    const cam = this.chase.camera;
    this.applyPalette();
    this.sky.update(this.day, cam, this.time);
    this.renderer.render(this.scene, cam);
  }

  private applyPalette(): void {
    const pal = this.day.palette;
    const fog = this.scene.fog as THREE.Fog;
    fog.color.copy(pal.fog);
    this.sun.color.copy(pal.sun);
    this.sun.intensity = pal.sunIntensity;
    this.sun.position.copy(this.day.sunDir).multiplyScalar(100).add(this.bird.root.position);
    this.sun.target.position.copy(this.bird.root.position);
    this.hemi.color.copy(pal.hemiSky);
    this.hemi.groundColor.copy(pal.hemiGround);
    this.hemi.intensity = pal.hemiIntensity;
  }

  private resize(): void {
    this.renderer.setSize(innerWidth, innerHeight);
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
    };
  }
}
