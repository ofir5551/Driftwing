import * as THREE from 'three';
import { Config } from '../core/Config';
import { clamp, expDecay, smoothstep } from '../core/math';
import { getToonGradient } from '../world/Terrain';
import { WingBeat } from './WingBeat';

/** Interpolated pose handed from the flight model to visuals. */
export interface Pose {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  bank: number;
  speed: number;
}

// Palette (sRGB). A pale tern-like seabird: warm-grey mantle, dark cap, warm-to-dusky primaries.
const BELLY = '#f7f1e8';
const BACK = '#cdbfb3';
const CAP = '#4b4253';
const WING_LEAD = '#ebdfd0';
const WING_TRAIL = '#cdbdb0';
const PRIMARY_BASE = '#d9c9b9';
const PRIMARY_MID = '#e7a37c';
const PRIMARY_TIP = '#4e4458';
const TAIL_BASE = '#e9ddcf';
const TAIL_TIP = '#bf8f7b';

/** Primaries, outermost first: pivot on the hand (span, chord), fan angle (rad back), length. */
const PRIMARIES: [number, number, number, number][] = [
  [0.32, 0.05, 0.08, 0.6],
  [0.25, 0.01, 0.19, 0.58],
  [0.18, -0.03, 0.3, 0.54],
  [0.11, -0.07, 0.41, 0.49],
  [0.04, -0.11, 0.52, 0.44],
];
const PRIMARY_FOLD = 0.35; // fan angle the primaries collapse toward when tucked
const TAIL_FEATHERS = 6;
const DOWNSTROKE = 0.3; // how far the downstroke goes, relative to the upstroke

const scratch = new THREE.Color();
const scratch2 = new THREE.Color();

/** Writes a per-vertex colour attribute from a function of the vertex position. */
function paint(
  g: THREE.BufferGeometry,
  colorAt: (x: number, y: number, z: number, out: THREE.Color) => void,
): THREE.BufferGeometry {
  const pos = g.getAttribute('position');
  const col = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    colorAt(pos.getX(i), pos.getY(i), pos.getZ(i), scratch);
    col.set([scratch.r, scratch.g, scratch.b], i * 3);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return g;
}

const solid = (hex: string) => (_x: number, _y: number, _z: number, out: THREE.Color) =>
  out.set(hex);

/** Gradient across stops at t = 0, 0.5, 1. */
function gradient(t: number, a: string, b: string, c: string, out: THREE.Color): THREE.Color {
  return t < 0.5
    ? out.set(a).lerp(scratch2.set(b), t * 2)
    : out.set(b).lerp(scratch2.set(c), (t - 0.5) * 2);
}

/** Flat polygon in the XZ plane from (span, chord) points. Earcut handles concave outlines. */
function panel(points: [number, number][]): THREE.BufferGeometry {
  const shape = new THREE.Shape(points.map(([x, z]) => new THREE.Vector2(x, z)));
  return new THREE.ShapeGeometry(shape).rotateX(Math.PI / 2); // (x, y) -> (x, 0, y)
}

/**
 * One feather as a strip along +x in the XZ plane: rounded base, broad vane, pointed tip.
 * Built station by station (not earcut) so the base-to-tip colour gradient interpolates cleanly.
 */
function feather(length: number, width: number, colorAt: (t: number, out: THREE.Color) => void) {
  const stations: [number, number][] = [
    [0, 0.32],
    [0.18, 0.5],
    [0.5, 0.5],
    [0.75, 0.42],
    [0.92, 0.22],
    [1, 0],
  ];
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  for (const [t, hw] of stations) {
    colorAt(t, scratch);
    for (const s of [1, -1]) {
      // Slightly asymmetric vane (narrow leading edge), like a real flight feather.
      pos.push(t * length, 0, s * hw * width * (s > 0 ? 0.8 : 1.2));
      col.push(scratch.r, scratch.g, scratch.b);
    }
  }
  for (let i = 0; i < stations.length - 1; i++) {
    const a = i * 2;
    idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Tapered, flattened rod along +x from 0 to `length`: gives the wing's leading edge some body. */
function rod(length: number, r0: number, r1: number): THREE.BufferGeometry {
  return new THREE.CylinderGeometry(r1, r0, length, 10)
    .rotateZ(-Math.PI / 2) // +y (radiusTop end) -> +x
    .translate(length / 2, 0, 0)
    .scale(1, 0.5, 1);
}

/**
 * Stylised low-poly tern-like seabird built from primitives. Local frame: +z forward, +y up, +x = left wing.
 * Wings are arm (shoulder) + hand (wrist) with five separate primaries that fan out in slow
 * flight and fold together in a dive; the tail is a fan of six feathers, slightly forked.
 */
export class Bird {
  readonly root = new THREE.Group();
  /** Wingtip anchors for trail ribbons (world positions via getWorldPosition). */
  readonly tipL = new THREE.Object3D();
  readonly tipR = new THREE.Object3D();
  private readonly body = new THREE.Group();
  private readonly head = new THREE.Group();
  private readonly shoulders: THREE.Group[] = [];
  private readonly elbows: THREE.Group[] = [];
  private readonly primaries: THREE.Group[] = [];
  private readonly tailFeathers: THREE.Group[] = [];
  private readonly beat = new WingBeat();
  private tuck = 0;

  constructor() {
    const toon = (color: string, extra: THREE.MeshToonMaterialParameters = {}) =>
      new THREE.MeshToonMaterial({ color, gradientMap: getToonGradient(), ...extra });
    // White base colour: vertex colours carry the plumage.
    const plumage = toon('#ffffff', { vertexColors: true });
    const feathers = toon('#ffffff', { vertexColors: true, side: THREE.DoubleSide });
    const beakMat = toon('#ef8a4a');
    const feetMat = toon('#e2804f');
    const eyeMat = new THREE.MeshBasicMaterial({ color: '#221d29' });
    const glintMat = new THREE.MeshBasicMaterial({ color: '#fff8ec' });

    // Torso: one lathed piece from tail to neck, so chest, neck and rump flow into each other
    // instead of reading as stacked blobs. Shoulders are widest, the neck pinches in under the
    // head, and the back is flattened over a fuller belly, the way a bird's body actually sits.
    const profile = [
      [0.015, -0.6],
      [0.06, -0.5],
      [0.11, -0.36],
      [0.155, -0.2],
      [0.185, -0.04],
      [0.19, 0.08],
      [0.17, 0.2],
      [0.13, 0.29],
      [0.1, 0.36],
      [0.095, 0.42],
      [0.04, 0.47],
    ].map(([r, y]) => new THREE.Vector2(r, y));
    const torsoGeo = new THREE.LatheGeometry(profile, 16).rotateX(Math.PI / 2); // axis -> +z
    const tp = torsoGeo.getAttribute('position');
    for (let i = 0; i < tp.count; i++) {
      const y = tp.getY(i);
      const z = tp.getZ(i);
      // Flat back, round belly, rump lifted a touch toward the tail.
      tp.setY(i, y * (y > 0 ? 0.7 : 1) + smoothstep(-0.1, -0.6, z) * 0.04);
      tp.setX(i, tp.getX(i) * 1.06);
    }
    torsoGeo.computeVertexNormals();
    paint(torsoGeo, (_x, y, _z, out) =>
      out.set(BELLY).lerp(scratch2.set(BACK), smoothstep(-0.01, 0.09, y)),
    );
    const torso = new THREE.Mesh(torsoGeo, plumage);

    // Head on a neck pivot so it can stay level through banks, like a real bird's. Tern-like:
    // a pale face under a dark cap, and a long slim orange bill, so it reads at a glance.
    this.head.position.set(0, 0.06, 0.36);
    const skullGeo = new THREE.SphereGeometry(0.13, 18, 12).scale(0.86, 0.86, 1.25);
    // Cap edge slopes: high at the bill, through the top of the eye, low down the nape.
    paint(skullGeo, (_x, y, z, out) => {
      const edge = 0.012 + Math.max(0, z) * 0.1 - Math.max(0, -z) * 0.35;
      out.set(BELLY).lerp(scratch2.set(CAP), smoothstep(edge - 0.015, edge + 0.015, y));
    });
    const skull = new THREE.Mesh(skullGeo, plumage);
    skull.position.z = 0.14;
    const beak = new THREE.Mesh(new THREE.ConeGeometry(0.036, 0.26, 8).scale(0.85, 1, 1), beakMat);
    beak.rotation.x = Math.PI / 2 + 0.08; // tip forward, dipping a touch
    beak.position.set(0, -0.012, 0.39);
    this.head.add(skull, beak);
    for (const s of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.024, 8, 6), eyeMat);
      eye.position.set(s * 0.093, 0.004, 0.21);
      const glint = new THREE.Mesh(new THREE.SphereGeometry(0.008, 5, 4), glintMat);
      glint.position.set(s * 0.016, 0.01, 0.012);
      eye.add(glint);
      this.head.add(eye);
      // Feet tucked back under the tail, as in flight.
      const foot = new THREE.Mesh(new THREE.ConeGeometry(0.018, 0.13, 4), feetMat);
      foot.rotation.x = -Math.PI / 2;
      foot.position.set(s * 0.045, -0.095, -0.38);
      this.body.add(foot);
    }

    // Tail: a fan of feathers pointing back, outer ones longer for a shallow fork.
    const tail = new THREE.Group();
    tail.position.set(0, 0.02, -0.5);
    for (let i = 0; i < TAIL_FEATHERS; i++) {
      const u = Math.abs((i - (TAIL_FEATHERS - 1) / 2) / ((TAIL_FEATHERS - 1) / 2));
      const f = new THREE.Group();
      const m = new THREE.Mesh(
        feather(0.34 + u * 0.14, 0.11, (t, out) =>
          gradient(t, TAIL_BASE, TAIL_BASE, TAIL_TIP, out),
        ),
        feathers,
      );
      m.position.y = -u * 0.006; // centre feathers on top
      f.add(m);
      tail.add(f);
      this.tailFeathers.push(f);
    }
    this.body.add(torso, this.head, tail);

    const primaryColor = (t: number, out: THREE.Color) =>
      gradient(t, PRIMARY_BASE, PRIMARY_MID, PRIMARY_TIP, out);
    const wingShade = (_x: number, _y: number, z: number, out: THREE.Color) =>
      out.set(WING_TRAIL).lerp(scratch2.set(WING_LEAD), smoothstep(-0.2, 0.12, z));
    for (const side of [1, -1]) {
      // Arm: broad inner wing with a scalloped trailing edge of secondaries. (span, chord) points.
      const arm = new THREE.Mesh(
        paint(
          panel([
            [0, 0.17],
            [0.62, 0.13],
            [0.62, -0.15],
            [0.53, -0.22],
            [0.45, -0.18],
            [0.36, -0.25],
            [0.27, -0.21],
            [0.18, -0.27],
            [0.09, -0.23],
            [0, -0.26],
          ]),
          wingShade,
        ),
        feathers,
      );
      // Leading edge starts inside the body so no rod end shows at the shoulder.
      const armEdge = new THREE.Mesh(paint(rod(0.6, 0.045, 0.03), solid(WING_LEAD)), plumage);
      armEdge.position.set(0.04, 0, 0.12);
      // Rounded wrist so the joint stays closed when the hand bends.
      const wrist = new THREE.Mesh(
        paint(new THREE.SphereGeometry(0.032, 10, 6).scale(1, 0.5, 1), solid(WING_LEAD)),
        plumage,
      );
      wrist.position.z = 0.11;
      // Hand: coverts over the bases of the primaries, plus a thin leading edge.
      const coverts = new THREE.Mesh(
        paint(
          panel([
            [0, 0.13],
            [0.3, 0.08],
            [0.38, 0.02],
            [0.3, -0.07],
            [0.14, -0.13],
            [0, -0.17],
          ]),
          wingShade,
        ),
        feathers,
      );
      coverts.position.y = 0.006;
      const handEdge = new THREE.Mesh(paint(rod(0.36, 0.03, 0.01), solid(WING_LEAD)), plumage);
      handEdge.position.z = 0.1;

      const shoulder = new THREE.Group();
      const elbow = new THREE.Group();
      shoulder.position.set(0.1 * side, 0.07, 0.08);
      shoulder.scale.x = side; // mirror the right wing
      elbow.position.x = 0.62;
      elbow.add(coverts, handEdge, wrist);
      for (let i = 0; i < PRIMARIES.length; i++) {
        const [px, pz, , len] = PRIMARIES[i];
        const g = new THREE.Group();
        g.position.set(px, -0.002 * i, pz);
        const m = new THREE.Mesh(feather(len, 0.15, primaryColor), feathers);
        m.rotation.z = 0.05 * (PRIMARIES.length - i); // outer feathers curl up a little
        g.add(m);
        if (i === 0) {
          const anchor = side === 1 ? this.tipL : this.tipR;
          anchor.position.set(len, 0, 0);
          m.add(anchor);
        }
        elbow.add(g);
        this.primaries.push(g);
      }
      shoulder.add(arm, armEdge, elbow);
      this.shoulders.push(shoulder);
      this.elbows.push(elbow);
      this.body.add(shoulder);
    }
    this.root.add(this.body);
    this.body.scale.setScalar(1.35);
  }

  update(p: Pose, sinceFlap: number, sinceClimbBeat: number, time: number, dt: number): void {
    this.root.position.set(p.x, p.y, p.z);
    this.root.rotation.set(-p.pitch, p.yaw, p.bank, 'YXZ');

    const tuckTarget = WingBeat.tuck(p.speed, p.pitch);
    this.tuck += (tuckTarget - this.tuck) * expDecay(4, dt);
    const slow = smoothstep(Config.flight.cruiseSpeed, Config.flight.minSpeed, p.speed);

    const b = this.beat;
    b.update(dt, sinceFlap, sinceClimbBeat, p.speed, p.pitch, this.tuck);
    // A bird can't beat folded wings: any stroke (a boost mid-dive included) opens them, and they
    // fold back as the stroke fades if the dive goes on.
    const tuck = this.tuck * (1 - b.weight);
    // Gentle descents keep the wings open, just swept back a little.
    const descend = smoothstep(-0.05, -0.35, p.pitch) * (1 - b.weight);

    // Glide pose: a gull's shallow "M" (arms up, hands drooping) with a slow breathing sway and
    // a little flex in turns. Beats ride on top; the hand flattens out while beating.
    const sway = Math.sin(time * 1.6);
    // Tucked, the arms drop flush along the body instead of holding the glide dihedral.
    // A real stroke is lopsided: the wings swing high on the upstroke but the downstroke ends
    // only a little below level. A symmetric swing dips them far under the body, which from the
    // chase camera reads as the wings folding down. The hand follows the same rule.
    const arm = b.arm > 0 ? b.arm : b.arm * DOWNSTROKE;
    const hand = b.hand > 0 ? b.hand : b.hand * DOWNSTROKE;
    const shoulderAngle =
      (0.14 + sway * 0.035 - Math.abs(p.bank) * 0.05 + slow * 0.05) * (1 - tuck) -
      tuck * 0.08 +
      arm * 0.85;
    const elbowAngle =
      (-0.14 + Math.sin(time * 1.6 - 0.7) * 0.03 + tuck * 0.1) * (1 - b.weight * 0.7) + hand * 0.5;
    const sweep = Math.max(tuck * 0.95, descend * 0.25) + b.fold * 0.15;
    for (let i = 0; i < 2; i++) {
      // Shoulders rotate in the unmirrored body frame, so the right wing needs flipped signs;
      // elbows live inside the mirrored shoulder, so the same values mirror automatically.
      const side = i === 0 ? 1 : -1;
      this.shoulders[i].rotation.set(0, tuck * 0.75 * side, shoulderAngle * side);
      this.elbows[i].rotation.set(0, sweep, elbowAngle);
    }
    // Primaries fan open ("fingers") when slow, close up in a dive and on the upstroke.
    const spread = clamp(1 - tuck * 0.85 - b.fold * 0.15 + slow * 0.15, 0.1, 1.15);
    for (let i = 0; i < this.primaries.length; i++) {
      const base = PRIMARIES[i % PRIMARIES.length][2];
      this.primaries[i].rotation.y = PRIMARY_FOLD + (base - PRIMARY_FOLD) * spread;
    }

    // Tail fans and tilts with pitch for a bit of life.
    const fan = 0.22 + (1 - tuck) * 0.12 + Math.max(0, p.pitch) * 0.5 + slow * 0.1;
    const tilt = clamp(p.pitch * 0.6, -0.4, 0.4);
    const half = (TAIL_FEATHERS - 1) / 2;
    for (let i = 0; i < TAIL_FEATHERS; i++) {
      // +x feather -> backward is a yaw of PI/2.
      this.tailFeathers[i].rotation.set(0, Math.PI / 2 + ((i - half) / half) * fan, tilt);
    }

    // The body rises on the downstroke and dips on the upstroke.
    this.body.position.y = -b.arm * 0.05;
    // Head stays roughly level and looks into the turn, the way birds stabilise their gaze.
    this.head.rotation.set(p.pitch * 0.35, -p.bank * 0.25, -p.bank * 0.55);
  }
}
