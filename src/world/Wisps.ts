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
}

type Pattern = 'arc' | 'wave' | 'dive' | 'climb' | 'spiral';

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
  private readonly cursor = { x: 0, y: 40, z: 0, heading: 0, valid: false };
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
      this.list.push({ x: 0, y: -999, z: 0, alive: false, phase: i * 0.618, grow: 0, sparkle: 0 });
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

  private spawn(x: number, y: number, z: number): boolean {
    const w = this.list.find((v) => !v.alive);
    if (!w) return false;
    w.x = x;
    w.y = this.safeY(x, z, y);
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
    c.valid = true;
  }

  private spawnPattern(): void {
    const T = Config.wisps;
    const c = this.cursor;
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
      const count = 14;
      const turn = this.rand() < 0.5 ? 1 : -1;
      for (let i = 0; i < count; i++) {
        const a = start + turn * (i / count) * Math.PI * 2.4;
        this.spawn(th.x + Math.sin(a) * r, g + 18 + i * 4.5, th.z + Math.cos(a) * r);
      }
      const a = start + turn * Math.PI * 2.4;
      c.x = th.x + Math.sin(a) * r;
      c.z = th.z + Math.cos(a) * r;
      c.y = g + 18 + count * 4.5;
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
        // Ease the path height toward a comfortable cruise height above the terrain so the
        // ribbon follows valleys and hills without asking for sudden climbs.
        const g = Math.max(this.groundAt(c.x, c.z), Config.world.waterLevel);
        c.y += (g + T.cruiseClearance - c.y) * 0.25;
        let y = c.y;
        let lx = 0;
        if (kind === 'wave') lx = Math.sin(s * Math.PI * 2) * amp;
        if (kind === 'dive') y -= Math.sin(s * Math.PI) * 16;
        if (kind === 'climb') y += s * s * 26;
        const rx = Math.cos(c.heading);
        const rz = -Math.sin(c.heading);
        this.spawn(c.x + rx * lx, y, c.z + rz * lx);
      }
      if (kind === 'climb') c.y += 20;
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
    // Re-anchor when the path is behind us or far off to the side.
    const cdx = c.x - px;
    const cdz = c.z - pz;
    const ahead = cdx * fx + cdz * fz;
    const off = Math.hypot(cdx, cdz);
    if (!c.valid || ahead < -40 || off > 650) this.anchor(px, py, pz, yaw);

    let upcoming = 0;
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
      if (along > 0) upcoming++;
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
    let guard = 0;
    while (upcoming < T.keepAhead && guard++ < 3) {
      const before = this.spawned;
      this.spawnPattern();
      upcoming += this.spawned - before;
    }
  }

  /** The next wisp roughly ahead of the player (autopilot target). */
  nextTarget(px: number, pz: number, yaw: number): Wisp | null {
    let best: Wisp | null = null;
    let bestScore = Infinity;
    const fx = Math.sin(yaw);
    const fz = Math.cos(yaw);
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
