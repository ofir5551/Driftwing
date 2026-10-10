import * as THREE from 'three';
import { Config } from '../core/Config';
import { clamp, expDecay, smoothstep } from '../core/math';
import { getToonGradient } from '../world/Terrain';

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

const FLAP_TIME = 0.42; // one full down-up stroke

/** Flat polygon in the XZ plane (y = 0), triangulated as a fan from the first point. */
function panel(points: [number, number][]): THREE.BufferGeometry {
  const pos: number[] = [];
  for (let i = 1; i < points.length - 1; i++)
    for (const p of [points[0], points[i], points[i + 1]]) pos.push(p[0], 0, p[1]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.computeVertexNormals();
  return g;
}

/**
 * Stylised low-poly bird built from primitives. Local frame: +z forward, +y up, +x = left wing.
 * Wings are two-segment (shoulder + elbow) so a flap can whip the tips a beat behind the root.
 */
export class Bird {
  readonly root = new THREE.Group();
  /** Wingtip anchors for trail ribbons (world positions via getWorldPosition). */
  readonly tipL = new THREE.Object3D();
  readonly tipR = new THREE.Object3D();
  private readonly body = new THREE.Group();
  private readonly shoulders: THREE.Group[] = [];
  private readonly elbows: THREE.Group[] = [];
  private readonly tail = new THREE.Group();
  private tuck = 0;

  constructor() {
    const toon = (color: string, extra: THREE.MeshToonMaterialParameters = {}) =>
      new THREE.MeshToonMaterial({ color, gradientMap: getToonGradient(), ...extra });
    const bodyMat = toon('#eee2d2');
    const wingMat = toon('#e4d4c0', { side: THREE.DoubleSide });
    const tipMat = toon('#e7a37c', { side: THREE.DoubleSide });
    const beakMat = toon('#f2b45c');
    const eyeMat = new THREE.MeshBasicMaterial({ color: '#2f2a3a' });

    const torso = new THREE.Mesh(new THREE.IcosahedronGeometry(0.22, 1), bodyMat);
    torso.scale.set(1, 0.85, 2.3);
    torso.geometry.computeVertexNormals();
    const head = new THREE.Mesh(new THREE.IcosahedronGeometry(0.16, 0), bodyMat);
    head.position.set(0, 0.1, 0.5);
    const beak = new THREE.Mesh(new THREE.ConeGeometry(0.05, 0.2, 4), beakMat);
    beak.rotation.x = Math.PI / 2;
    beak.position.set(0, 0.07, 0.7);
    for (const s of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.025, 5, 4), eyeMat);
      eye.position.set(s * 0.1, 0.15, 0.58);
      this.body.add(eye);
    }
    const tailMesh = new THREE.Mesh(
      panel([
        [0, 0.05],
        [-0.12, -0.05],
        [-0.3, -0.55],
        [0, -0.42],
        [0.3, -0.55],
        [0.12, -0.05],
      ]),
      wingMat,
    );
    this.tail.position.set(0, 0.03, -0.38);
    this.tail.add(tailMesh);
    this.body.add(torso, head, beak, this.tail);

    for (const side of [1, -1]) {
      // Inner wing: broad, attached at the shoulder. Points are (span, chord) with span along +x.
      const inner = new THREE.Mesh(
        panel([
          [0, 0.2],
          [0, -0.22],
          [0.72, -0.24],
          [0.72, 0.16],
        ]),
        wingMat,
      );
      // Outer wing: swept, tapered, with a warm-tinted tip.
      const outer = new THREE.Mesh(
        panel([
          [0, 0.16],
          [0, -0.24],
          [0.45, -0.36],
          [0.62, -0.3],
          [0.58, -0.1],
        ]),
        wingMat,
      );
      const tip = new THREE.Mesh(
        panel([
          [0.45, -0.36],
          [0.62, -0.3],
          [0.58, -0.1],
        ]),
        tipMat,
      );
      tip.position.y = 0.002;
      const shoulder = new THREE.Group();
      const elbow = new THREE.Group();
      shoulder.position.set(0.12 * side, 0.06, 0.06);
      shoulder.scale.x = side; // mirror the right wing
      elbow.position.x = 0.72;
      elbow.add(outer, tip);
      const anchor = side === 1 ? this.tipL : this.tipR;
      anchor.position.set(0.6, 0, -0.28);
      elbow.add(anchor);
      shoulder.add(inner, elbow);
      this.shoulders.push(shoulder);
      this.elbows.push(elbow);
      this.body.add(shoulder);
    }
    this.root.add(this.body);
    this.body.scale.setScalar(1.4);
  }

  update(p: Pose, sinceFlap: number, time: number, dt: number): void {
    this.root.position.set(p.x, p.y, p.z);
    this.root.rotation.set(-p.pitch, p.yaw, p.bank, 'YXZ');

    // Fast dives tuck the wings back (a satisfying "stoop"); slow flight spreads them wide.
    const speedT = smoothstep(Config.flight.cruiseSpeed + 4, Config.flight.maxSpeed, p.speed);
    const tuckTarget = Math.max(speedT, smoothstep(-0.25, -0.7, p.pitch) * 0.8);
    this.tuck += (tuckTarget - this.tuck) * expDecay(4, dt);

    let shoulderAngle: number;
    let elbowAngle: number;
    if (sinceFlap < FLAP_TIME) {
      // One stroke: up -> hard down -> recover. The elbow lags the shoulder so tips whip.
      const ph = (sinceFlap / FLAP_TIME) * Math.PI * 2;
      shoulderAngle = Math.cos(ph) * 0.85 + 0.1;
      elbowAngle = Math.cos(ph - 0.9) * 0.5;
    } else {
      // Glide: slight dihedral with a slow breathing sway, plus a little flex in turns.
      shoulderAngle = 0.12 + Math.sin(time * 1.6) * 0.035 - Math.abs(p.bank) * 0.05;
      elbowAngle = -0.06 + Math.sin(time * 1.6 - 0.7) * 0.03;
    }
    for (let i = 0; i < 2; i++) {
      // Shoulders rotate in the unmirrored body frame, so the right wing needs flipped signs;
      // elbows live inside the mirrored shoulder, so the same values mirror automatically.
      const side = i === 0 ? 1 : -1;
      this.shoulders[i].rotation.set(0, this.tuck * 0.5 * side, shoulderAngle * side);
      this.elbows[i].rotation.set(0, this.tuck * 0.7, elbowAngle);
    }
    // Tail fans and tilts with pitch for a bit of life.
    this.tail.rotation.x = clamp(p.pitch * 0.6, -0.4, 0.4);
    this.tail.scale.x = 1 + (1 - this.tuck) * 0.15 + Math.max(0, p.pitch) * 0.6;
    // A tiny body bob while flapping.
    this.body.position.y =
      sinceFlap < FLAP_TIME ? Math.sin((sinceFlap / FLAP_TIME) * Math.PI * 2) * 0.05 : 0;
  }
}
