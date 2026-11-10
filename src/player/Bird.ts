import * as THREE from 'three';
import { Config } from '../core/Config';
import { clamp, expDecay, smoothstep } from '../core/math';
import { getToonGradient } from '../world/Terrain';
import { WingBeat } from './WingBeat';
import { DEFAULT_PLUMAGE, plumageDef, type PlumageColors } from './Plumage';
import { TERN_SHAPE, type BirdShape, type Outline } from './BirdShape';

/** Interpolated pose handed from the flight model to visuals. */
export interface Pose {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  bank: number;
  speed: number;
  /** Loop angle on top of pitch, barrel-roll spin on top of bank (see FlightState). */
  trickPitch: number;
  spin: number;
  /** Radius of the loop being flown, 0 when not looping (the camera watches loops). */
  loopR: number;
}

const DOWNSTROKE = 0.3; // how far the downstroke goes, relative to the upstroke
const SKY_LIFT = 0.35; // glow of downward-facing plumage (see skyLift)

const scratch = new THREE.Color();
const scratch2 = new THREE.Color();

type ColorAt = (x: number, y: number, z: number, out: THREE.Color) => void;

/** The geometry's colour attribute, made on first use and rewritten in place by a repaint. */
function colorAttr(g: THREE.BufferGeometry): THREE.BufferAttribute {
  const count = g.getAttribute('position').count;
  const old = g.hasAttribute('color') ? g.getAttribute('color') : null;
  if (old instanceof THREE.BufferAttribute && old.count === count) return old;
  const attr = new THREE.BufferAttribute(new Float32Array(count * 3), 3);
  g.setAttribute('color', attr);
  return attr;
}

/** Writes a per-vertex colour attribute from a function of the vertex position. */
function paint(g: THREE.BufferGeometry, colorAt: ColorAt): THREE.BufferGeometry {
  const pos = g.getAttribute('position');
  const col = colorAttr(g);
  for (let i = 0; i < pos.count; i++) {
    colorAt(pos.getX(i), pos.getY(i), pos.getZ(i), scratch);
    col.setXYZ(i, scratch.r, scratch.g, scratch.b);
  }
  col.needsUpdate = true;
  return g;
}

/** Gradient across stops at t = 0, 0.5, 1. */
function gradient(t: number, a: string, b: string, c: string, out: THREE.Color): THREE.Color {
  return t < 0.5
    ? out.set(a).lerp(scratch2.set(b), t * 2)
    : out.set(b).lerp(scratch2.set(c), (t - 0.5) * 2);
}

/** Feather stations base to tip: (t along the feather, half width). */
const STATIONS: [number, number][] = [
  [0, 0.32],
  [0.18, 0.5],
  [0.5, 0.5],
  [0.75, 0.42],
  [0.92, 0.22],
  [1, 0],
];
/** Across each station: leading vane, shaft, trailing vane (the vertex order `feather` uses). */
const ACROSS = [1, 0, -1];
/** Shade of each: the raised shaft is paler, the narrow leading vane a shade darker. */
const ACROSS_SHADE = [0.86, 1.1, 0.97];

type FeatherColorAt = (t: number, out: THREE.Color) => void;

/**
 * One feather as a strip along +x in the XZ plane: rounded base, broad vane, pointed tip.
 * Built station by station (not earcut) so the base-to-tip colour gradient interpolates cleanly.
 * Three vertices across: the shaft is a raised, paler ridge, so each vane catches the light on
 * its own; the narrow leading vane is a shade darker, as on a real flight feather.
 */
function feather(length: number, width: number): THREE.BufferGeometry {
  const pos: number[] = [];
  const idx: number[] = [];
  for (const [t, hw] of STATIONS)
    for (const s of ACROSS)
      // Slightly asymmetric vane (narrow leading edge), like a real flight feather.
      pos.push(
        t * length,
        s === 0 ? 0.012 * width * (1 - t) * 4 : 0,
        s * hw * width * (s > 0 ? 0.8 : 1.2),
      );
  for (let i = 0; i < STATIONS.length - 1; i++)
    for (let j = 0; j < 2; j++) {
      const a = i * 3 + j;
      idx.push(a, a + 1, a + 3, a + 1, a + 4, a + 3);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Colours a `feather` base to tip. */
function paintFeather(g: THREE.BufferGeometry, colorAt: FeatherColorAt): THREE.BufferGeometry {
  const col = colorAttr(g);
  for (let i = 0; i < STATIONS.length; i++) {
    colorAt(STATIONS[i][0], scratch);
    for (let j = 0; j < 3; j++) {
      const f = ACROSS_SHADE[j];
      col.setXYZ(i * 3 + j, scratch.r * f, scratch.g * f, scratch.b * f);
    }
  }
  col.needsUpdate = true;
  return g;
}

/** Piecewise-linear z of an x-sorted (x, z) polyline at `x`. */
function polyZ(line: Outline, x: number): number {
  for (let i = 1; i < line.length; i++)
    if (x <= line[i][0]) {
      const [x0, z0] = line[i - 1];
      const [x1, z1] = line[i];
      return z0 + ((z1 - z0) * (x - x0)) / (x1 - x0 || 1);
    }
  return line[line.length - 1][1];
}

/**
 * Wing surface lofted between a leading and a trailing (x, z) outline, both sorted by x, with
 * rows across the chord so `yAt` can arch it into an airfoil. A flat panel lights as one flat
 * tone; the arch gives each wing a highlight along the front and a shaded fall to the trailing
 * edge, which is most of what makes it read as a solid wing. Front faces point down, like
 * `panel`'s, so the underwing tint still finds them.
 */
function wingSurface(
  lead: Outline,
  trail: Outline,
  yAt: (x: number, z: number) => number,
): THREE.BufferGeometry {
  const xs = [...new Set([...lead, ...trail].map(([x]) => x))].sort((a, b) => a - b);
  const ROWS = 5;
  const pos: number[] = [];
  const idx: number[] = [];
  for (const x of xs) {
    const z0 = polyZ(lead, x);
    const z1 = polyZ(trail, x);
    for (let r = 0; r < ROWS; r++) {
      const z = z0 + ((z1 - z0) * r) / (ROWS - 1);
      pos.push(x, yAt(x, z), z);
    }
  }
  for (let i = 0; i < xs.length - 1; i++)
    for (let r = 0; r < ROWS - 1; r++) {
      const a = i * ROWS + r;
      const b = a + ROWS;
      idx.push(a, a + 1, b, b, a + 1, b + 1);
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/**
 * Surfaces facing the ground glow faintly with their own colour: sky light bouncing off the
 * land and shining through thin feathers. Without it the belly and underwing fall into the
 * toon shadow tone and read as dull khaki against a bright sky.
 */
function skyLift(shader: THREE.WebGLProgramParametersWithUniforms, glow: { value: number }): void {
  // A burning plumage (the Phoenix's) also lights itself: uGlow is 0 for every other.
  shader.uniforms.uGlow = glow;
  shader.fragmentShader = shader.fragmentShader
    .replace('#include <common>', '#include <common>\nuniform float uGlow;')
    .replace(
      '#include <emissivemap_fragment>',
      `#include <emissivemap_fragment>
    float down = smoothstep(0.1, -0.8, inverseTransformDirection(normal, viewMatrix).y);
    totalEmissiveRadiance += diffuseColor.rgb * ${SKY_LIFT.toFixed(2)} * down;
    totalEmissiveRadiance += diffuseColor.rgb * uGlow;`,
    );
}

/** Tapered, flattened rod along +x from 0 to `length`: gives the wing's leading edge some body. */
function rod(length: number, r0: number, r1: number): THREE.BufferGeometry {
  return new THREE.CylinderGeometry(r1, r0, length, 10)
    .rotateZ(-Math.PI / 2) // +y (radiusTop end) -> +x
    .translate(length / 2, 0, 0)
    .scale(1, 0.5, 1);
}

/**
 * Stylised low-poly bird built from primitives on one shared rig. Local frame: +z forward, +y up,
 * +x = left wing. Wings are arm (shoulder) + hand (wrist) with five separate primaries that fan
 * out in slow flight and fold together in a dive; the tail is a fan of feathers, forked.
 * The measurements come from a `BirdShape` (the Tern by default); `setShape` rebuilds the bird
 * in place for another species, so `root` and the wingtip anchors stay the same objects.
 *
 * Colours come from a plumage (`Plumage.ts`). Every painted part registers how it is painted,
 * so `setPlumage` repaints the vertex colours in place instead of rebuilding the bird.
 */
export class Bird {
  readonly root = new THREE.Group();
  /** Wingtip anchors for trail ribbons (world positions via getWorldPosition). */
  readonly tipL = new THREE.Object3D();
  readonly tipR = new THREE.Object3D();
  private body = new THREE.Group();
  private head = new THREE.Group();
  private readonly shoulders: THREE.Group[] = [];
  private readonly elbows: THREE.Group[] = [];
  private readonly primaries: THREE.Group[] = [];
  private readonly tailFeathers: THREE.Group[] = [];
  private readonly beat = new WingBeat();
  private tuck = 0;
  private shape: BirdShape = TERN_SHAPE;
  /** The plumage being worn; the painters below read it each time they run. */
  private c: PlumageColors = plumageDef(DEFAULT_PLUMAGE).colors;
  private readonly repaints: (() => void)[] = [];
  private readonly under = new THREE.Color();
  /** The plumage's self-lit glow (a shader uniform, shared by both feather materials), which
   *  flickers a little around `glowBase` like a flame. */
  private readonly glow = { value: 0 };
  private glowBase = 0;
  private feetMat!: THREE.MeshToonMaterial;
  /** Materials made by the last build, disposed with it. */
  private materials: THREE.Material[] = [];

  constructor(shape: BirdShape = TERN_SHAPE) {
    this.root.add(this.body);
    this.build(shape);
  }

  /** Wingbeat period multiplier (a species' tempo: below 1 beats quicker). */
  set beatTempo(v: number) {
    this.beat.tempo = v;
  }

  /** Paints `g` now and again on every plumage change. */
  private paint(g: THREE.BufferGeometry, colorAt: ColorAt): THREE.BufferGeometry {
    this.repaints.push(() => paint(g, colorAt));
    return paint(g, colorAt);
  }

  /** A feather, painted now and again on every plumage change. */
  private feather(length: number, width: number, colorAt: FeatherColorAt): THREE.BufferGeometry {
    const g = feather(length, width);
    this.repaints.push(() => paintFeather(g, colorAt));
    return paintFeather(g, colorAt);
  }

  /** A painter for one plumage role. */
  private solid(role: keyof PlumageColors): ColorAt {
    return (_x, _y, _z, out) => {
      out.set(this.c[role]);
    };
  }

  /** Dresses the bird in a plumage (the Aviary: menu time, not a hot path). */
  setPlumage(colors: PlumageColors, glow = 0): void {
    this.glowBase = glow;
    this.glow.value = glow;
    this.c = colors;
    for (const r of this.repaints) r();
    this.under.set(colors.underwing);
    this.feetMat.color.set(colors.feet);
  }

  /** Rebuilds the bird as another species, keeping its plumage (menu time, not a hot path). */
  setShape(shape: BirdShape): void {
    if (shape === this.shape) return;
    this.body.traverse((o) => {
      if (o instanceof THREE.Mesh) (o.geometry as THREE.BufferGeometry).dispose();
    });
    for (const m of this.materials) m.dispose();
    this.root.remove(this.body);
    this.body = new THREE.Group();
    this.head = new THREE.Group();
    this.root.add(this.body);
    this.build(shape);
  }

  private build(shape: BirdShape): void {
    this.shape = shape;
    this.repaints.length = 0;
    this.shoulders.length = 0;
    this.elbows.length = 0;
    this.primaries.length = 0;
    this.tailFeathers.length = 0;
    const H = shape.head;
    const T = shape.tail;
    const W = shape.wing;
    const A = W.arch;
    // Airfoil arch of the arm: highest a quarter of the way back, falling to the trailing edge.
    const armArch = (x: number, z: number): number => {
      const u = clamp((A.lead - A.slope * x - z) / A.chord, 0, 1);
      return A.height * Math.sin(Math.PI * Math.sqrt(u));
    };
    // The hand carries on the arm's arch at the wrist and flattens out toward the tip.
    const handArch = (x: number, z: number) => armArch(W.arm, z) * (1 - x / W.hand);

    const toon = (color: string, extra: THREE.MeshToonMaterialParameters = {}) =>
      new THREE.MeshToonMaterial({ color, gradientMap: getToonGradient(), ...extra });
    // White base colour: vertex colours carry the plumage.
    const plumage = toon('#ffffff', { vertexColors: true });
    const feathers = toon('#ffffff', { vertexColors: true, side: THREE.DoubleSide });
    // Pale underwing and undertail: seen from below the bird is pale against the sky, as a
    // seabird is; the patterned upper side faces the chase camera.
    const under = this.under.set(this.c.underwing);
    const glowU = this.glow;
    feathers.onBeforeCompile = (shader) => {
      shader.uniforms.uUnder = { value: under };
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform vec3 uUnder;')
        .replace(
          '#include <color_fragment>',
          '#include <color_fragment>\nif (gl_FrontFacing) diffuseColor.rgb = mix(diffuseColor.rgb, uUnder, 0.55);',
        );
      skyLift(shader, glowU);
    };
    plumage.onBeforeCompile = (shader) => skyLift(shader, glowU);
    const feetMat = toon(this.c.feet);
    this.feetMat = feetMat;
    const eyeMat = new THREE.MeshBasicMaterial({ color: '#221d29' });
    const glintMat = new THREE.MeshBasicMaterial({ color: '#fff8ec' });
    this.materials = [plumage, feathers, feetMat, eyeMat, glintMat];

    // Torso: one lathed piece from tail to neck, so chest, neck and rump flow into each other
    // instead of reading as stacked blobs. Shoulders are widest, the neck pinches in under the
    // head, and the back is flattened over a fuller belly, the way a bird's body actually sits.
    const profile = shape.torso.profile.map(([r, y]) => new THREE.Vector2(r, y));
    const torsoGeo = new THREE.LatheGeometry(profile, 24).rotateX(Math.PI / 2); // axis -> +z
    const tp = torsoGeo.getAttribute('position');
    for (let i = 0; i < tp.count; i++) {
      const y = tp.getY(i);
      const z = tp.getZ(i);
      // Flat back, round belly, rump lifted a touch toward the tail.
      tp.setY(
        i,
        y * (y > 0 ? shape.torso.flatBack : 1) + smoothstep(-0.1, -0.6, z) * shape.torso.rump,
      );
      tp.setX(i, tp.getX(i) * shape.torso.widen);
    }
    torsoGeo.computeVertexNormals();
    // Mantle over the back and shoulders, fading to a pale rump; a warm flush on the breast; a
    // long neck (the Crane's) in the throat colour.
    const neck = shape.torso.neck;
    this.paint(torsoGeo, (_x, y, z, out) => {
      out
        .set(this.c.belly)
        .lerp(
          scratch2.set(this.c.breast),
          smoothstep(0.1, 0.3, z) * smoothstep(0.02, -0.12, y) * 0.6,
        )
        .lerp(scratch2.set(this.c.back), smoothstep(-0.01, 0.09, y) * smoothstep(-0.55, -0.3, z));
      if (neck !== null) out.lerp(scratch2.set(this.c.throat), smoothstep(neck, neck + 0.1, z));
    });
    const torso = new THREE.Mesh(torsoGeo, plumage);

    // Head on a neck pivot so it can stay level through banks, like a real bird's: a face (the
    // throat colour) under a dark cap, and the bill, so it reads at a glance.
    this.head.position.set(...H.pos);
    const skullGeo = new THREE.SphereGeometry(H.skull.r, 18, 12).scale(...H.skull.scale);
    // Cap edge slopes: high at the bill, through the top of the eye, low down the nape.
    this.paint(skullGeo, (_x, y, z, out) => {
      const edge = H.cap.edge + Math.max(0, z) * 0.1 - Math.max(0, -z) * H.cap.nape;
      out
        .set(this.c.throat)
        .lerp(scratch2.set(this.c.cap), smoothstep(edge - 0.015, edge + 0.015, y));
    });
    const skull = new THREE.Mesh(skullGeo, plumage);
    skull.position.z = H.skull.z;
    const beak = new THREE.Mesh(
      this.paint(
        new THREE.ConeGeometry(H.bill.r, H.bill.length, 10, 3).scale(0.85, 1, 1),
        (_x, y, _z, out) =>
          out.set(this.c.bill).lerp(scratch2.set(this.c.billTip), smoothstep(0.03, 0.09, y)),
      ),
      plumage,
    );
    beak.rotation.x = Math.PI / 2 + H.bill.droop; // tip forward, dipping a touch
    beak.position.set(...H.bill.pos);
    this.head.add(skull, beak);
    // A shaggy crest swept back off the nape (a tern's signature), so the head has a profile
    // rather than reading as a dark ball from behind.
    if (H.crest) {
      const crest = new THREE.Mesh(
        this.paint(
          new THREE.ConeGeometry(H.crest.r, H.crest.length, 7, 2)
            .rotateX(-Math.PI / 2)
            .scale(1, 0.45, 1),
          this.solid('cap'),
        ),
        plumage,
      );
      crest.position.set(...H.crest.pos);
      crest.rotation.x = H.crest.tilt; // tip lifts a little off the nape
      this.head.add(crest);
    }
    for (const s of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(H.eye.r, 8, 6), eyeMat);
      eye.position.set(s * H.eye.pos[0], H.eye.pos[1], H.eye.pos[2]);
      const glint = new THREE.Mesh(new THREE.SphereGeometry(0.008, 5, 4), glintMat);
      glint.position.set(s * 0.016, 0.01, 0.012);
      eye.add(glint);
      this.head.add(eye);
      // Feet tucked back under the tail, as in flight.
      const F = shape.feet;
      const foot = new THREE.Mesh(new THREE.ConeGeometry(F.r, F.length, 4), feetMat);
      foot.rotation.x = -Math.PI / 2;
      foot.position.set(s * F.pos[0], F.pos[1], F.pos[2]);
      this.body.add(foot);
    }

    // Tail: a fan of feathers pointing back, forked, the outer pair drawn out into streamers.
    const tail = new THREE.Group();
    tail.position.set(...T.pos);
    for (let i = 0; i < T.count; i++) {
      const u = Math.abs((i - (T.count - 1) / 2) / ((T.count - 1) / 2));
      const streamer = u ** 4;
      const f = new THREE.Group();
      const m = new THREE.Mesh(
        this.feather(
          T.length + u * T.spread + streamer * T.streamer,
          T.width * (1 - streamer * T.streamerNarrow),
          (t, out) => gradient(t, this.c.tailBase, this.c.tailBase, this.c.tailTip, out),
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
      gradient(t, this.c.primaryBase, this.c.primaryMid, this.c.primaryTip, out);
    // Front to back: a pale leading edge, the mantle, then a dusky trailing band.
    const wingShade = (_x: number, _y: number, z: number, out: THREE.Color) =>
      out
        .set(this.c.dusky)
        .lerp(scratch2.set(this.c.wingTrail), smoothstep(-0.25, -0.15, z))
        .lerp(scratch2.set(this.c.wingLead), smoothstep(0.04, 0.15, z));
    for (const side of [1, -1]) {
      // Arm: broad inner wing with a scalloped trailing edge of secondaries.
      const arm = new THREE.Mesh(
        this.paint(wingSurface(W.armLead, W.armTrail, armArch), wingShade),
        feathers,
      );
      // Coverts: a lighter layer over the front of the arm with its own scalloped edge, so the
      // wing reads as overlapping rows of feathers.
      const armCoverts = new THREE.Mesh(
        this.paint(
          wingSurface(W.covertLead, W.covertTrail, (x, z) => armArch(x, z) + 0.008),
          (_x, _y, z, out) =>
            out.set(this.c.covert).lerp(scratch2.set(this.c.wingLead), smoothstep(0.02, 0.13, z)),
        ),
        feathers,
      );
      // Leading edge starts inside the body so no rod end shows at the shoulder. It rides on
      // the front of the arch.
      const AE = W.armEdge;
      const armEdge = new THREE.Mesh(
        this.paint(rod(AE.length, AE.r0, AE.r1), this.solid('wingLead')),
        plumage,
      );
      armEdge.position.set(...AE.pos);
      // Rounded wrist so the joint stays closed when the hand bends.
      const wrist = new THREE.Mesh(
        this.paint(
          new THREE.SphereGeometry(W.wrist.r, 10, 6).scale(1, 0.5, 1),
          this.solid('wingLead'),
        ),
        plumage,
      );
      wrist.position.set(...W.wrist.pos);
      // Hand: coverts over the bases of the primaries, plus a thin leading edge. They start a
      // little inside the arm so no wedge opens at the wrist when the hand bends.
      const coverts = new THREE.Mesh(
        this.paint(
          wingSurface(W.handLead, W.handTrail, (x, z) => handArch(x, z) + 0.006),
          wingShade,
        ),
        feathers,
      );
      const HE = W.handEdge;
      const handEdge = new THREE.Mesh(
        this.paint(rod(HE.length, HE.r0, HE.r1), this.solid('wingLead')),
        plumage,
      );
      handEdge.position.set(...HE.pos);
      handEdge.rotation.z = HE.tilt; // follows the hand's arch down to the tip

      const shoulder = new THREE.Group();
      const elbow = new THREE.Group();
      shoulder.position.set(W.shoulder[0] * side, W.shoulder[1], W.shoulder[2]);
      shoulder.scale.x = side; // mirror the right wing
      elbow.position.x = W.arm;
      elbow.add(coverts, handEdge, wrist);
      const P = W.primaries;
      for (let i = 0; i < P.length; i++) {
        const [px, pz, , len] = P[i];
        const g = new THREE.Group();
        // Bases tuck just under the arched coverts.
        g.position.set(px, handArch(px, pz) - 0.004 - 0.002 * i, pz);
        const m = new THREE.Mesh(this.feather(len, W.primaryWidth, primaryColor), feathers);
        m.rotation.z = 0.05 * (P.length - i); // outer feathers curl up a little
        g.add(m);
        if (i === 0) {
          const anchor = side === 1 ? this.tipL : this.tipR;
          anchor.position.set(len, 0, 0);
          m.add(anchor);
        }
        elbow.add(g);
        this.primaries.push(g);
      }
      // Shoulder fairing: a flattened mound that rides with the wing and sinks into the body,
      // filling the notch a bare wing sheet leaves against the round torso. Mantle on top,
      // pale belly below, matching the body either side of the joint.
      const fairing = new THREE.Mesh(
        this.paint(new THREE.SphereGeometry(1, 14, 8).scale(...W.fairing.scale), (_x, y, _z, out) =>
          out.set(this.c.belly).lerp(scratch2.set(this.c.back), smoothstep(-0.03, 0.03, y)),
        ),
        plumage,
      );
      fairing.position.set(...W.fairing.pos);
      shoulder.add(fairing, arm, armCoverts, armEdge, elbow);
      this.shoulders.push(shoulder);
      this.elbows.push(elbow);
      this.body.add(shoulder);
    }
    this.body.scale.setScalar(shape.scale);
  }

  update(p: Pose, sinceFlap: number, sinceClimbBeat: number, time: number, dt: number): void {
    if (this.glowBase > 0)
      this.glow.value =
        this.glowBase * (0.86 + 0.09 * Math.sin(time * 7.3) + 0.05 * Math.sin(time * 17.1));
    this.root.position.set(p.x, p.y, p.z);
    this.root.rotation.set(-(p.pitch + p.trickPitch), p.yaw, p.bank + p.spin, 'YXZ');

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
    const W = this.shape.wing;
    // Some birds (the Swallow) hold their hands swept back in a glide; a stroke opens them.
    const sweep =
      Math.max(tuck * 0.95, descend * 0.25) + b.fold * 0.15 + W.glideSweep * (1 - b.weight);
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
      const base = W.primaries[i % W.primaries.length][2];
      this.primaries[i].rotation.y = W.fold + (base - W.fold) * spread;
    }

    // Tail fans and tilts with pitch for a bit of life.
    const fan = 0.22 + (1 - tuck) * 0.12 + Math.max(0, p.pitch) * 0.5 + slow * 0.1;
    const tilt = clamp(p.pitch * 0.6, -0.4, 0.4);
    const n = this.tailFeathers.length;
    const half = (n - 1) / 2;
    for (let i = 0; i < n; i++) {
      // +x feather -> backward is a yaw of PI/2.
      this.tailFeathers[i].rotation.set(0, Math.PI / 2 + ((i - half) / half) * fan, tilt);
    }

    // The body rises on the downstroke and dips on the upstroke.
    this.body.position.y = -b.arm * 0.05;
    // Head stays roughly level and looks into the turn, the way birds stabilise their gaze.
    this.head.rotation.set(p.pitch * 0.35, -p.bank * 0.25, -p.bank * 0.55);
  }
}
