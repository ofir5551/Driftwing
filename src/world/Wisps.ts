import * as THREE from 'three';
import { Config } from '../core/Config';
import { clamp } from '../core/math';
import { mulberry32 } from './noise';

export interface Wisp {
  x: number;
  y: number;
  z: number;
  alive: boolean;
  phase: number;
  /** 0..1 spawn-in animation. */
  grow: number;
  sparkle: number;
  /** Spawn order: the ribbon's sequence, which the autopilot follows. */
  seq: number;
}

type Pattern = 'arc' | 'wave' | 'dive' | 'climb' | 'spiral';

/** Where the next pattern starts: the end of the last one, heading onward. */
export interface WispCursor {
  x: number;
  y: number;
  z: number;
  heading: number;
  /** Preferred height above the wisp floor. */
  clear: number;
  valid: boolean;
}

/**
 * Level-specific wisp patterns (city avenues, tower spirals). `pattern` lays wisps from the
 * cursor through `spawn`, leaves the cursor at the pattern's end and returns true, or returns
 * false to let a generic pattern run.
 */
export interface WispPlanner {
  pattern(
    c: WispCursor,
    rand: () => number,
    spawn: (x: number, y: number, z: number) => void,
    /** Free wisps in the pool: a pattern longer than this is cut short. */
    free: number,
  ): boolean;
}

const vert = /* glsl */ `
attribute float aPhase;
uniform float uTime;
varying vec2 vUv;
varying float vPulse;
void main() {
  vUv = uv;
  vec3 center = (instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xyz;
  float scale = length(instanceMatrix[0].xyz);
  vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
  vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
  vPulse = 0.85 + 0.15 * sin(uTime * 3.0 + aPhase * 6.28);
  vec3 wp = center + (right * position.x + up * position.y) * scale * vPulse;
  gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
}`;

// Core + soft halo + faint cross glint, additive. HDR values > 1 feed the bloom pass.
const frag = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uCore;
varying vec2 vUv;
varying float vPulse;
void main() {
  vec2 c = vUv - 0.5;
  float r = length(c) * 2.0;
  float core = smoothstep(0.22, 0.0, r);
  float halo = pow(max(1.0 - r, 0.0), 2.5);
  float glint = (smoothstep(0.06, 0.0, abs(c.x)) + smoothstep(0.06, 0.0, abs(c.y))) * smoothstep(1.0, 0.1, r) * 0.25;
  // Normal blending (not additive) so the warm halo still reads against a bright day sky;
  // the HDR core (> 1) is what the bloom pass turns into glow.
  float a = clamp(core + halo * 0.75 + glint, 0.0, 1.0);
  if (a < 0.003) discard;
  vec3 col = mix(uColor * vPulse, uCore * 3.0, core / max(a, 0.001));
  gl_FragColor = vec4(col, a);
}`;

/**
 * Wisps are laid out in flowing patterns ahead of the player: arcs, ribbons, dives, climbs and
 * thermal spirals. A "cursor" remembers where the last pattern ended so successive patterns
 * join into one continuous path; if the player wanders off, the cursor re-anchors in front of
 * them. Missed wisps simply expire behind the bird. No penalty, ever.
 */
export class Wisps {
  readonly mesh: THREE.InstancedMesh;
  readonly list: Wisp[] = [];
  private readonly rand: () => number;
  private readonly cursor: WispCursor = { x: 0, y: 40, z: 0, heading: 0, clear: 22, valid: false };
  planner: WispPlanner | null = null;
  // Planner wisps are placed exactly: the planner has already cleared them of scenery.
  private readonly spawnAt = (x: number, y: number, z: number): void => {
    this.spawn(x, y, z, true);
  };
  private readonly m = new THREE.Matrix4();
  private readonly u: Record<string, THREE.IUniform>;
  private spawned = 0;

  constructor(
    seed: number,
    private readonly groundAt: (x: number, z: number) => number,
    private readonly thermalNear: (
      x: number,
      z: number,
      radius: number,
    ) => { x: number; z: number; r: number } | null,
  ) {
    this.rand = mulberry32(seed + 501);
    for (let i = 0; i < Config.wisps.max; i++)
      this.list.push({
        x: 0,
        y: -999,
        z: 0,
        alive: false,
        phase: i * 0.618,
        grow: 0,
        sparkle: 0,
        seq: 0,
      });
    const geo = new THREE.PlaneGeometry(1, 1);
    const phases = new Float32Array(Config.wisps.max);
    for (let i = 0; i < phases.length; i++) phases[i] = (i * 0.618) % 1;
    geo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phases, 1));
    this.u = {
      uTime: { value: 0 },
      uColor: { value: new THREE.Color('#ffd27a') },
      uCore: { value: new THREE.Color('#fff8e6') },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.u,
      vertexShader: vert,
      fragmentShader: frag,
      transparent: true,
      depthWrite: false,
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, Config.wisps.max);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 4;
  }

  private safeY(x: number, z: number, y: number): number {
    const g = Math.max(this.groundAt(x, z), Config.world.waterLevel);
    return clamp(
      y,
      g + Config.wisps.minClearance,
      Config.world.waterLevel + Config.flight.maxAltitude - 25,
    );
  }

  private spawn(x: number, y: number, z: number, exact = false): boolean {
    const w = this.list.find((v) => !v.alive);
    if (!w) return false;
    w.x = x;
    w.y = exact
      ? Math.min(y, Config.world.waterLevel + Config.flight.maxAltitude - 25)
      : this.safeY(x, z, y);
    w.seq = this.spawned;
    w.z = z;
    w.alive = true;
    w.grow = 0;
    w.sparkle = this.rand();
    this.spawned++;
    return true;
  }

  /** Re-anchor the path just ahead of the player. */
  private anchor(px: number, py: number, pz: number, yaw: number): void {
    const c = this.cursor;
    const ahead = 110;
    c.heading = yaw + (this.rand() - 0.5) * 0.5;
    c.x = px + Math.sin(yaw) * ahead;
    c.z = pz + Math.cos(yaw) * ahead;
    c.y = py;
    // Start the path at the player's own height (within reason) so flying high still finds wisps.
    const g = Math.max(this.groundAt(c.x, c.z), Config.world.waterLevel);
    c.clear = clamp(py - g, Config.wisps.cruiseClearance, Config.wisps.maxClearance);
    c.valid = true;
  }

  private free(): number {
    let n = 0;
    for (const w of this.list) if (!w.alive) n++;
    return n;
  }

  /** Drop every wisp and restart the path (level switch). */
  reset(): void {
    for (const w of this.list) w.alive = false;
    this.cursor.valid = false;
  }

  private spawnPattern(): void {
    const T = Config.wisps;
    const c = this.cursor;
    if (this.planner?.pattern(c, this.rand, this.spawnAt, this.free())) {
      c.x += Math.sin(c.heading) * T.gap;
      c.z += Math.cos(c.heading) * T.gap;
      return;
    }
    // Prefer a thermal spiral when one is close to the path: it teaches thermals by example.
    const th = this.thermalNear(
      c.x + Math.sin(c.heading) * 120,
      c.z + Math.cos(c.heading) * 120,
      160,
    );
    const roll = this.rand();
    const kind: Pattern =
      th && roll < 0.55
        ? 'spiral'
        : (['arc', 'wave', 'arc', 'dive', 'climb'] as const)[Math.floor(this.rand() * 5)];
    const n = 7 + Math.floor(this.rand() * 5);
    const sp = T.spacing;

    if (kind === 'spiral' && th) {
      // Rising helix around the thermal column.
      const g = Math.max(this.groundAt(th.x, th.z), Config.world.waterLevel);
      const r = th.r * 0.75;
      const start = Math.atan2(c.x - th.x, c.z - th.z);
      const count = T.spiralCount;
      const step = (Math.PI * 2.4) / 14; // ~1.2 turns per 14 wisps, whatever the count
      const turn = this.rand() < 0.5 ? 1 : -1;
      for (let i = 0; i < count; i++) {
        const a = start + turn * i * step;
        this.spawn(th.x + Math.sin(a) * r, g + 18 + i * T.spiralRise, th.z + Math.cos(a) * r);
      }
      const a = start + turn * count * step;
      c.x = th.x + Math.sin(a) * r;
      c.z = th.z + Math.cos(a) * r;
      c.y = g + 18 + count * T.spiralRise;
      // Leave the thermal high: the following patterns glide down slowly from the top.
      c.clear = clamp(c.y - g, T.cruiseClearance, T.maxClearance);
      c.heading = a + turn * Math.PI * 0.5;
    } else {
      const turnTotal =
        kind === 'arc'
          ? (this.rand() < 0.5 ? -1 : 1) * (0.7 + this.rand() * 1.0)
          : (this.rand() - 0.5) * 0.4;
      const amp = kind === 'wave' ? 9 + this.rand() * 6 : 0;
      for (let i = 0; i < n; i++) {
        const s = i / (n - 1);
        c.heading += turnTotal / n;
        c.x += Math.sin(c.heading) * sp;
        c.z += Math.cos(c.heading) * sp;
        // The path's preferred height above ground ('clear') sinks slowly back to cruise after
        // a thermal or climb, like a bird gliding down; climbs raise it a little per wisp.
        if (kind === 'climb') c.clear += T.climbGain / n;
        else c.clear -= T.glideSink;
        c.clear = clamp(c.clear, T.cruiseClearance, T.maxClearance);
        // Ease the path height toward it so the ribbon follows valleys and hills without asking
        // for sudden climbs; rises are capped to what a flapping bird can actually follow.
        const g = Math.max(this.groundAt(c.x, c.z), Config.world.waterLevel);
        c.y += Math.min((g + c.clear - c.y) * 0.25, T.maxRise);
        let y = c.y;
        let lx = 0;
        if (kind === 'wave') lx = Math.sin(s * Math.PI * 2) * amp;
        if (kind === 'dive') y -= Math.sin(s * Math.PI) * 16;
        const rx = Math.cos(c.heading);
        const rz = -Math.sin(c.heading);
        this.spawn(c.x + rx * lx, y, c.z + rz * lx);
      }
    }
    // Gap before the next pattern.
    c.x += Math.sin(c.heading) * T.gap;
    c.z += Math.cos(c.heading) * T.gap;
  }

  /**
   * Fixed-step update: spawn ahead, expire behind, magnet + collect. `onCollect` fires per
   * pickup with the wisp position.
   */
  update(
    dt: number,
    px: number,
    py: number,
    pz: number,
    yaw: number,
    onCollect: (w: Wisp) => void,
  ): void {
    const T = Config.wisps;
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    const c = this.cursor;
    let upcoming = 0;
    let nearAhead = Infinity;
    for (const w of this.list) {
      if (!w.alive) continue;
      const dx = w.x - px;
      const dy = w.y - py;
      const dz = w.z - pz;
      const d = Math.hypot(dx, dy, dz);
      const along = dx * fx + dz * fz;
      if (along < -90 || d > 900) {
        w.alive = false; // missed: quietly expire
        continue;
      }
      if (along > 0) {
        upcoming++;
        nearAhead = Math.min(nearAhead, d);
      }
      w.grow = Math.min(1, w.grow + dt * 1.5);
      if (d < T.magnetRadius) {
        // Gentle magnet: drift toward the bird so near-misses still count.
        const pull = Math.min(d, T.magnetSpeed * dt * (1 - d / T.magnetRadius + 0.3));
        w.x -= (dx / d) * pull;
        w.y -= (dy / d) * pull;
        w.z -= (dz / d) * pull;
      }
      if (d < T.collectRadius) {
        w.alive = false;
        onCollect(w);
      }
    }
    // Re-anchor when the path is behind us, far above or below us (say after riding a
    // thermal high), or when the bird has left it: far away with no wisp ahead in reach. A
    // path that merely wanders off to the side or runs far ahead is still the path, and
    // re-anchoring then would start a second ribbon on top of the first.
    const cdx = c.x - px;
    const cdz = c.z - pz;
    const ahead = cdx * fx + cdz * fz;
    const off = Math.hypot(cdx, cdz);
    if (
      !c.valid ||
      ahead < -40 ||
      Math.abs(c.y - py) > T.reanchorHeight ||
      (off > 650 && nearAhead > 280)
    )
      this.anchor(px, py, pz, yaw);

    let guard = 0;
    // Only lay a new pattern when the pool has room for it: patterns that cannot spawn would
    // still move the cursor on, and the ribbon would run away from the bird.
    // Nor while the path end is already far ahead (its wisps would expire as they spawn).
    while (
      upcoming < T.keepAhead &&
      guard++ < 3 &&
      this.free() >= 12 &&
      Math.hypot(c.x - px, c.z - pz) < 600
    ) {
      const before = this.spawned;
      this.spawnPattern();
      upcoming += this.spawned - before;
    }
  }

  /**
   * The next wisp for the autopilot: the earliest in the ribbon that is still ahead, so it
   * follows spirals and street corners in order instead of cutting across them. Falls back to
   * the nearest wisp roughly ahead.
   */
  nextTarget(px: number, pz: number, yaw: number): Wisp | null {
    let best: Wisp | null = null;
    let bestScore = Infinity;
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
    for (const w of this.list) {
      if (!w.alive) continue;
      const dx = w.x - px;
      const dz = w.z - pz;
      if (dx * fx + dz * fz < 4 || dx * dx + dz * dz > 220 * 220) continue;
      if (w.seq < bestScore) {
        bestScore = w.seq;
        best = w;
      }
    }
    if (best) {
      // Pure pursuit: aim at a carrot ~24 m along the ribbon rather than the very next wisp,
      // which at a few metres away would demand a hard correction and an overshoot.
      const first = best.seq;
      let carrot = best;
      for (const w of this.list) {
        if (!w.alive || w.seq <= carrot.seq || w.seq > first + 3) continue;
        if (Math.hypot(carrot.x - px, carrot.z - pz) >= 24) break;
        carrot = w;
      }
      return carrot;
    }
    bestScore = Infinity;
    for (const w of this.list) {
      if (!w.alive) continue;
      const dx = w.x - px;
      const dz = w.z - pz;
      const along = dx * fx + dz * fz;
      if (along < 8) continue;
      const score = Math.hypot(dx, dz) + Math.abs(dx * fz - dz * fx) * 1.5;
      if (score < bestScore) {
        bestScore = score;
        best = w;
      }
    }
    return best;
  }

  render(time: number, color: THREE.Color, px: number, py: number, pz: number): void {
    this.u.uTime.value = time;
    this.u.uColor.value.copy(color);
    let k = 0;
    for (const w of this.list) {
      if (!w.alive) continue;
      // Shrink while being absorbed by the magnet so a pickup never flashes the whole screen.
      const d = Math.hypot(w.x - px, w.y - py, w.z - pz);
      const absorb = 0.25 + 0.75 * Math.min(1, d / Config.wisps.magnetRadius);
      const s = 4.4 * absorb * (w.grow * w.grow * (3 - 2 * w.grow));
      // Lazy bob so the ribbon breathes.
      const bob = Math.sin(time * 1.3 + w.phase * 6.28) * 0.35;
      this.m.makeScale(s, s, s).setPosition(w.x, w.y + bob, w.z);
      this.mesh.setMatrixAt(k++, this.m);
    }
    this.mesh.count = k;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
