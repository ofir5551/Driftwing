import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Config } from '../core/Config';
import { clamp } from '../core/math';
import { FLOCK_TINTS } from './flockTints';
import { slot, spring, toWorld, type Slot } from './formation';
import { getToonGradient } from './Terrain';

/** Shared clock for the wingbeats (set each frame). */
const flockTime = { value: 0 };

/** Wing tip's distance from the body axis (m, before scaling): aWing is |x| over this. */
const SPAN = 1.15;

/**
 * A small bird, nose along +z, wings out along x (~60 triangles). Vertex colours shade it
 * (dark back and wingtips, pale belly); each instance's tint multiplies over them. `aWing` is
 * how far out along a wing a vertex lies (signed by side, 0 on the body): the shader beats and
 * folds the wings with it.
 */
function birdGeometry(): THREE.BufferGeometry {
  const prep = (g: THREE.BufferGeometry, color: string, belly?: string) => {
    const geo = g.index ? g.toNonIndexed() : g;
    geo.deleteAttribute('uv');
    geo.deleteAttribute('normal');
    const pos = geo.getAttribute('position');
    const col = new Float32Array(pos.count * 3);
    const wing = new Float32Array(pos.count);
    const a = new THREE.Color(color);
    const b = new THREE.Color(belly ?? color);
    const c = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      c.copy(a).lerp(b, pos.getY(i) < 0 ? 1 : 0);
      c.toArray(col, i * 3);
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('aWing', new THREE.BufferAttribute(wing, 1));
    return geo;
  };
  const body = prep(
    new THREE.OctahedronGeometry(1, 1).scale(0.13, 0.11, 0.42),
    '#8c8378',
    '#f4efe6',
  );
  const head = prep(
    new THREE.IcosahedronGeometry(0.1, 0).translate(0, 0.05, 0.38),
    '#d6d6d6',
    '#ffffff',
  );
  const bill = prep(
    new THREE.ConeGeometry(0.03, 0.12, 4).rotateX(Math.PI / 2).translate(0, 0.04, 0.52),
    '#3a3430',
  );
  // Tail: a forked fan behind.
  const tail = new THREE.BufferGeometry();
  tail.setAttribute(
    'position',
    new THREE.Float32BufferAttribute(
      [
        0, 0.02, -0.3, -0.16, 0.02, -0.62, 0, 0.02, -0.5, 0, 0.02, -0.3, 0, 0.02, -0.5, 0.16, 0.02,
        -0.62,
      ],
      3,
    ),
  );
  const tailG = prep(tail, '#d6d6d6');
  // Wings: an inner and an outer panel each side, the tips swept back.
  const w: number[] = [];
  for (const sd of [-1, 1]) {
    const x = (v: number) => v * sd;
    w.push(x(0.08), 0.04, 0.12, x(0.55), 0.04, 0.06, x(0.08), 0.04, -0.12);
    w.push(x(0.08), 0.04, -0.12, x(0.55), 0.04, 0.06, x(0.55), 0.04, -0.2);
    w.push(x(0.55), 0.04, 0.06, x(SPAN), 0.04, -0.28, x(0.55), 0.04, -0.2);
  }
  const wingG = new THREE.BufferGeometry();
  wingG.setAttribute('position', new THREE.Float32BufferAttribute(w, 3));
  const wings = prep(wingG, '#f2f2f2');
  const pos = wings.getAttribute('position');
  const aw = wings.getAttribute('aWing') as THREE.BufferAttribute;
  const col = wings.getAttribute('color') as THREE.BufferAttribute;
  for (let i = 0; i < pos.count; i++) {
    const f = pos.getX(i) / SPAN;
    aw.setX(i, f);
    // Darker toward the tips.
    const k = 1 - 0.35 * Math.abs(f);
    col.setXYZ(i, col.getX(i) * k, col.getY(i) * k, col.getZ(i) * k);
  }
  const g = mergeGeometries([body, head, bill, tailG, wings])!;
  g.computeVertexNormals();
  return g;
}

/**
 * Toon-lit with the wingbeat in the vertex shader. Per instance `aBird` = (phase, flap 0..1,
 * fold 0..1): flap blends a glide's slight dihedral into full beats; fold tucks the wings
 * back along the body (a perched bird).
 */
function birdMaterial(): THREE.MeshToonMaterial {
  const m = new THREE.MeshToonMaterial({
    vertexColors: true,
    gradientMap: getToonGradient(),
    side: THREE.DoubleSide,
  });
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uFlockTime = flockTime;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nattribute float aWing;\nattribute vec3 aBird;\nuniform float uFlockTime;',
      )
      .replace(
        '#include <begin_vertex>',
        /* glsl */ `#include <begin_vertex>
{
  float span = abs(aWing);
  float beat = sin(uFlockTime * 15.0 + aBird.x * 6.2832);
  // Glide: wings held in a clear V (from behind, flat wings are an edge: a line). Flap: the
  // tips sweep well above and below the body.
  float lift = mix(0.34, 0.9 * beat, aBird.y) * (1.0 - aBird.z);
  transformed.y += span * ${SPAN.toFixed(2)} * lift;
  // Fold: wings drawn in along the body, tips back and a little down.
  transformed.x *= mix(1.0, 0.16, aBird.z);
  transformed.z -= span * 0.5 * aBird.z;
  transformed.y -= span * 0.06 * aBird.z;
}`,
      );
    // Like the player's bird: a soft lift of their own colour, more on faces turned down, so a
    // small bird seen against the light reads as its plumage, not a dark blot.
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>
    float down = smoothstep(0.1, -0.8, inverseTransformDirection(normal, viewMatrix).y);
    totalEmissiveRadiance += diffuseColor.rgb * (0.3 + 0.3 * down);`,
    );
  };
  m.customProgramCacheKey = () => 'flock-bird';
  return m;
}

const slotScratch: Slot = { ahead: 0, right: 0, up: 0 };
const target = new Float32Array(3);
const push = { x: 0, y: 0, z: 0 };
const mat = new THREE.Matrix4();
const quat = new THREE.Quaternion();
const euler = new THREE.Euler(0, 0, 0, 'YXZ');
const pos = new THREE.Vector3();
const scl = new THREE.Vector3();
const tint = new THREE.Color();

/** Where a bird flies: the pose Game interpolates for rendering. */
export interface FlockPose {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  bank: number;
  speed: number;
}

/** What the flock must not fly into (the level's world). */
export interface FlockGround {
  flightGround(x: number, z: number): number;
  pushPoint(p: { x: number; y: number; z: number }, margin: number): void;
}

/**
 * The birds gathered on the journeys, flying with the player's bird; and the next stray,
 * perched on its destination's cairn until the bird arrives and it joins. One instanced mesh:
 * the followers, then the perched stray in the last slot.
 */
export class Flock {
  readonly mesh: THREE.InstancedMesh;
  private readonly n: number;
  /** Followers flown (at most Config.flock.visible). */
  private count = 0;
  /** Each follower's offset from the bird (x, y, z) and its rate of change. */
  private readonly off: Float32Array;
  private readonly vel: Float32Array;
  private readonly bird: THREE.InstancedBufferAttribute;
  /** Seconds left of flapping, per follower. */
  private readonly flapFor: Float32Array;
  private readonly tints: number[] = [];
  private perched = false;
  private readonly perch = { x: 0, y: 0, z: 0, yaw: 0, tint: 0 };
  private snapNext = true;

  constructor() {
    const F = Config.flock;
    this.n = F.visible + 1;
    const geo = birdGeometry();
    this.bird = new THREE.InstancedBufferAttribute(new Float32Array(this.n * 3), 3);
    this.bird.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('aBird', this.bird);
    this.mesh = new THREE.InstancedMesh(geo, birdMaterial(), this.n);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < this.n; i++) {
      this.mesh.setColorAt(i, tint.set('#ffffff'));
      this.bird.setX(i, (i * 0.618) % 1);
    }
    this.mesh.count = 0;
    // Instances move every frame; bounds computed once would cull them wrongly.
    this.mesh.frustumCulled = false;
    this.off = new Float32Array(this.n * 3);
    this.vel = new Float32Array(this.n * 3);
    this.flapFor = new Float32Array(this.n);
  }

  /** The kept flock (tints in the order they joined); the newest fly. Snaps them to place. */
  setBirds(tints: readonly number[]): void {
    const F = Config.flock;
    this.tints.length = 0;
    const from = Math.max(0, tints.length - F.visible);
    for (let i = from; i < tints.length; i++) this.tints.push(tints[i]);
    this.count = this.tints.length;
    for (let i = 0; i < this.count; i++) this.paint(i, this.tints[i]);
    this.snapNext = true;
  }

  /** Put every bird straight in its place (a new level, or the bird moved far at once). */
  snap(): void {
    this.snapNext = true;
  }

  /** The next stray, perched on its cairn's top (x, y, z: the top), facing yaw. */
  perchAt(x: number, y: number, z: number, yaw: number, tintIndex: number): void {
    const P = this.perch;
    P.x = x;
    P.y = y;
    P.z = z;
    P.yaw = yaw;
    P.tint = tintIndex;
    this.perched = true;
    this.paint(this.n - 1, tintIndex);
  }

  clearPerch(): void {
    this.perched = false;
  }

  /**
   * The bird arrived: the perched stray takes off and joins, starting from its perch (as an
   * offset from the bird at bx, by, bz) and springing to its place. Returns its tint.
   */
  join(bx: number, by: number, bz: number): number {
    const P = this.perch;
    this.perched = false;
    const F = Config.flock;
    if (this.count >= F.visible) {
      // Full: the oldest flier gives its place up (it is still kept; only the newest fly).
      this.tints.shift();
      this.off.copyWithin(0, 3);
      this.vel.copyWithin(0, 3);
      this.flapFor.copyWithin(0, 1);
      for (let i = 0; i < this.tints.length; i++) this.paint(i, this.tints[i]);
      this.count--;
    }
    const i = this.count++;
    this.tints.push(P.tint);
    this.paint(i, P.tint);
    const o = i * 3;
    this.off[o] = P.x - bx;
    this.off[o + 1] = P.y - by;
    this.off[o + 2] = P.z - bz;
    this.vel.fill(0, o, o + 3);
    this.flapFor[i] = F.joinFlap;
    return P.tint;
  }

  /** The player's bird flapped: the flock follows suit, each a little late. */
  flap(): void {
    const F = Config.flock;
    for (let i = 0; i < this.count; i++)
      this.flapFor[i] = Math.max(this.flapFor[i], F.flapAfter + ((i * 0.37) % 1) * 0.2);
  }

  update(dt: number, time: number, p: FlockPose, world: FlockGround): void {
    flockTime.value = time;
    const F = Config.flock;
    const snap = this.snapNext;
    this.snapNext = false;
    const climbing = p.pitch > 0.18;
    for (let i = 0; i < this.count; i++) {
      const o = i * 3;
      toWorld(slot(i, time, slotScratch), p.yaw, p.pitch, target, 0);
      if (snap) {
        this.off.set(target, o);
        this.vel.fill(0, o, o + 3);
      } else {
        // Each bird's own stiffness, so the flock swings round a turn rather than as one.
        const w = F.stiffness * (1 + F.stiffnessVar * (((i * 0.6180339) % 1) * 2 - 1));
        this.springOne(o, w, dt);
      }
      // Keep off the ground and out of rock (the bird may skim where a wing's-width more can't).
      push.x = p.x + this.off[o];
      push.y = p.y + this.off[o + 1];
      push.z = p.z + this.off[o + 2];
      world.pushPoint(push, F.clearance);
      push.y = Math.max(push.y, world.flightGround(push.x, push.z) + F.clearance);
      this.off[o] = push.x - p.x;
      this.off[o + 1] = push.y - p.y;
      this.off[o + 2] = push.z - p.z;
      // Face the way it flies: the bird's velocity plus its own drift round it.
      const cp = Math.cos(p.pitch);
      const vx = Math.sin(p.yaw) * cp * p.speed + this.vel[o];
      const vy = Math.sin(p.pitch) * p.speed + this.vel[o + 1];
      const vz = Math.cos(p.yaw) * cp * p.speed + this.vel[o + 2];
      const h = Math.hypot(vx, vz);
      euler.set(-Math.atan2(vy, Math.max(h, 1e-3)), Math.atan2(vx, vz), p.bank * 0.8);
      this.place(i, push.x, push.y, push.z);
      // Flap: after the bird flaps, while climbing, just after joining, now and then for itself.
      this.flapFor[i] = Math.max(0, this.flapFor[i] - dt);
      const own = Math.sin(time * 0.45 + i * 2.9) > 0.86;
      const want = this.flapFor[i] > 0 || climbing || own ? 1 : 0;
      const f = this.bird.getY(i);
      this.bird.setY(i, f + clamp(want - f, -dt * 3, dt * 6));
      this.bird.setZ(i, Math.max(0, this.bird.getZ(i) - dt * 3));
    }
    if (this.perched) {
      const P = this.perch;
      euler.set(0, P.yaw, 0);
      this.place(this.n - 1, P.x, P.y, P.z);
      // A perched bird: wings folded, and now and then a little shuffle of them.
      const shuffle = Math.sin(time * 0.9) > 0.97 ? 0.75 : 1;
      this.bird.setXYZ(this.n - 1, 0, 0, shuffle);
    }
    // The perched stray is drawn from the last slot: move it down to just after the followers.
    if (this.perched && this.count < this.n - 1) this.copyInstance(this.n - 1, this.count);
    this.mesh.count = this.count + (this.perched ? 1 : 0);
    this.mesh.instanceMatrix.needsUpdate = true;
    this.bird.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  private springOne(o: number, w: number, dt: number): void {
    // spring() works on a 3-wide window at the same index in all three arrays, so step this
    // bird's offset against a target laid out at its own index.
    const tgt = springTarget;
    tgt[o] = target[0];
    tgt[o + 1] = target[1];
    tgt[o + 2] = target[2];
    spring(this.off, this.vel, tgt, o, w, dt);
  }

  private place(i: number, x: number, y: number, z: number): void {
    const s = Config.flock.scale;
    quat.setFromEuler(euler);
    mat.compose(pos.set(x, y, z), quat, scl.set(s, s, s));
    this.mesh.setMatrixAt(i, mat);
  }

  /** Copy instance `from` (matrix, colour, wing state) into slot `to`. */
  private copyInstance(from: number, to: number): void {
    this.mesh.getMatrixAt(from, mat);
    this.mesh.setMatrixAt(to, mat);
    this.mesh.getColorAt(from, tint);
    this.mesh.setColorAt(to, tint);
    this.bird.setXYZ(to, this.bird.getX(from), this.bird.getY(from), this.bird.getZ(from));
  }

  private paint(i: number, t: number): void {
    this.mesh.setColorAt(i, tint.set(FLOCK_TINTS[t % FLOCK_TINTS.length]));
  }
}

/** Scratch target laid out like the offsets (see springOne). */
const springTarget = new Float32Array((Config.flock.visible + 1) * 3);
