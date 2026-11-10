/**
 * The measurements a bird is built from. Every species shares one rig (body, head, two wings of
 * arm + hand + five primaries, a tail of feathers), so the pose and wingbeat code in `Bird`
 * drives them all; a species is just different numbers here. Units are the bird's local frame
 * before `scale` (+z forward, +y up, +x the left wing). Pure data.
 */
export type Vec3 = readonly [number, number, number];
/** (span, chord) outline points, sorted by span. */
export type Outline = readonly (readonly [number, number])[];
/** One primary: pivot on the hand (span, chord), fan angle (rad back), length. */
export type Primary = readonly [number, number, number, number];

/** A tapered rod along the leading edge. */
export interface EdgeRod {
  readonly length: number;
  readonly r0: number;
  readonly r1: number;
  readonly pos: Vec3;
}

export interface BirdShape {
  readonly scale: number;
  readonly torso: {
    /** Lathe profile tail to neck: (radius, position along the body). */
    readonly profile: Outline;
    /** The back is squashed to this over a fuller belly. */
    readonly flatBack: number;
    /** Rump lift toward the tail. */
    readonly rump: number;
    readonly widen: number;
  };
  readonly head: {
    readonly pos: Vec3;
    readonly skull: { readonly r: number; readonly scale: Vec3; readonly z: number };
    readonly eye: { readonly r: number; readonly pos: Vec3 };
    readonly bill: {
      readonly r: number;
      readonly length: number;
      readonly pos: Vec3;
      /** Dip of the tip below straight ahead (rad). */
      readonly droop: number;
    };
    /** A crest swept back off the nape (the Tern's), or none. */
    readonly crest: {
      readonly r: number;
      readonly length: number;
      readonly pos: Vec3;
      readonly tilt: number;
    } | null;
  };
  readonly feet: { readonly r: number; readonly length: number; readonly pos: Vec3 };
  readonly tail: {
    readonly pos: Vec3;
    readonly count: number;
    /** Centre feather length; outer feathers add `spread`, and the outermost pair `streamer`. */
    readonly length: number;
    readonly spread: number;
    readonly streamer: number;
    readonly width: number;
    /** How much narrower the streamers are than the centre feathers (0..1). */
    readonly streamerNarrow: number;
  };
  readonly wing: {
    readonly shoulder: Vec3;
    /** Arm span: where the elbow (wrist joint) sits. */
    readonly arm: number;
    readonly armLead: Outline;
    readonly armTrail: Outline;
    readonly covertLead: Outline;
    readonly covertTrail: Outline;
    /** Airfoil arch: leading edge z at the shoulder, its slope along the span, chord, height. */
    readonly arch: {
      readonly lead: number;
      readonly slope: number;
      readonly chord: number;
      readonly height: number;
    };
    readonly armEdge: EdgeRod;
    readonly wrist: { readonly r: number; readonly pos: Vec3 };
    /** Hand span: the arch flattens out to nothing at the tip. */
    readonly hand: number;
    readonly handLead: Outline;
    readonly handTrail: Outline;
    readonly handEdge: EdgeRod & { readonly tilt: number };
    readonly primaries: readonly Primary[];
    readonly primaryWidth: number;
    /** Fan angle the primaries collapse toward when tucked. */
    readonly fold: number;
    readonly fairing: { readonly scale: Vec3; readonly pos: Vec3 };
    /** Extra sweep of the hand in a glide (rad): swallows glide with their wings swept back. */
    readonly glideSweep: number;
  };
}

/** The Tern: a pale seabird with long, gull-like wings and a forked tail. (The original bird.) */
export const TERN_SHAPE: BirdShape = {
  scale: 1.35,
  torso: {
    profile: [
      [0.015, -0.6],
      [0.06, -0.5],
      [0.1, -0.36],
      [0.148, -0.2],
      [0.185, -0.04],
      [0.19, 0.08],
      [0.17, 0.2],
      [0.13, 0.29],
      [0.1, 0.36],
      [0.095, 0.42],
      [0.04, 0.47],
    ],
    flatBack: 0.7,
    rump: 0.04,
    widen: 1.06,
  },
  head: {
    pos: [0, 0.06, 0.36],
    skull: { r: 0.13, scale: [0.86, 0.86, 1.25], z: 0.14 },
    eye: { r: 0.024, pos: [0.093, 0.004, 0.21] },
    bill: { r: 0.036, length: 0.26, pos: [0, -0.012, 0.39], droop: 0.08 },
    crest: { r: 0.075, length: 0.2, pos: [0, 0.05, -0.02], tilt: 0.25 },
  },
  feet: { r: 0.018, length: 0.13, pos: [0.045, -0.095, -0.38] },
  tail: {
    pos: [0, 0.02, -0.5],
    count: 6,
    length: 0.32,
    spread: 0.12,
    streamer: 0.18,
    width: 0.11,
    streamerNarrow: 0.4,
  },
  wing: {
    shoulder: [0.1, 0.07, 0.08],
    arm: 0.62,
    armLead: [
      [0, 0.17],
      [0.62, 0.13],
    ],
    armTrail: [
      [0, -0.26],
      [0.09, -0.23],
      [0.18, -0.27],
      [0.27, -0.21],
      [0.36, -0.25],
      [0.45, -0.18],
      [0.53, -0.22],
      [0.62, -0.15],
    ],
    covertLead: [
      [0, 0.15],
      [0.6, 0.12],
    ],
    covertTrail: [
      [0, -0.1],
      [0.05, -0.12],
      [0.13, -0.07],
      [0.21, -0.11],
      [0.29, -0.06],
      [0.37, -0.1],
      [0.45, -0.05],
      [0.52, -0.08],
      [0.6, -0.04],
    ],
    arch: { lead: 0.17, slope: 0.065, chord: 0.42, height: 0.045 },
    armEdge: { length: 0.6, r0: 0.045, r1: 0.03, pos: [0.04, 0.028, 0.12] },
    wrist: { r: 0.032, pos: [0, 0.028, 0.11] },
    hand: 0.38,
    handLead: [
      [-0.06, 0.13],
      [0.3, 0.08],
      [0.38, 0.02],
    ],
    handTrail: [
      [-0.06, -0.16],
      [0.14, -0.13],
      [0.3, -0.07],
      [0.38, 0.02],
    ],
    handEdge: { length: 0.36, r0: 0.03, r1: 0.01, pos: [0, 0.026, 0.1], tilt: -0.07 },
    primaries: [
      [0.32, 0.05, 0.08, 0.6],
      [0.25, 0.01, 0.19, 0.58],
      [0.18, -0.03, 0.3, 0.54],
      [0.11, -0.07, 0.41, 0.49],
      [0.04, -0.11, 0.52, 0.44],
    ],
    primaryWidth: 0.15,
    fold: 0.35,
    fairing: { scale: [0.16, 0.05, 0.21], pos: [0.05, -0.008, -0.04] },
    glideSweep: 0,
  },
};

/**
 * The Swallow: small and compact, a round head with a tiny bill, a short arm and a long hand of
 * narrow primaries swept back into a pointed sickle, and a deeply forked tail whose outer pair
 * trail long streamers. Nearly the Tern's span on a much smaller body.
 */
export const SWALLOW_SHAPE: BirdShape = {
  scale: 1.25,
  torso: {
    profile: [
      [0.012, -0.42],
      [0.05, -0.34],
      [0.09, -0.24],
      [0.13, -0.12],
      [0.155, 0],
      [0.155, 0.09],
      [0.135, 0.18],
      [0.11, 0.25],
      [0.095, 0.3],
      [0.085, 0.34],
      [0.035, 0.38],
    ],
    flatBack: 0.72,
    rump: 0.03,
    widen: 1.08,
  },
  head: {
    pos: [0, 0.05, 0.29],
    skull: { r: 0.115, scale: [0.95, 0.9, 1.05], z: 0.1 },
    eye: { r: 0.022, pos: [0.088, 0.012, 0.16] },
    bill: { r: 0.028, length: 0.09, pos: [0, -0.01, 0.24], droop: 0.05 },
    crest: null,
  },
  feet: { r: 0.012, length: 0.07, pos: [0.035, -0.08, -0.24] },
  tail: {
    pos: [0, 0.02, -0.36],
    count: 6,
    length: 0.22,
    spread: 0.12,
    streamer: 0.46,
    width: 0.1,
    streamerNarrow: 0.7,
  },
  wing: {
    shoulder: [0.085, 0.06, 0.05],
    arm: 0.36,
    armLead: [
      [0, 0.13],
      [0.36, 0.1],
    ],
    armTrail: [
      [0, -0.17],
      [0.07, -0.15],
      [0.14, -0.18],
      [0.21, -0.14],
      [0.28, -0.16],
      [0.36, -0.1],
    ],
    covertLead: [
      [0, 0.115],
      [0.34, 0.09],
    ],
    covertTrail: [
      [0, -0.06],
      [0.06, -0.08],
      [0.14, -0.04],
      [0.22, -0.07],
      [0.3, -0.03],
      [0.34, -0.04],
    ],
    arch: { lead: 0.13, slope: 0.08, chord: 0.3, height: 0.035 },
    armEdge: { length: 0.34, r0: 0.04, r1: 0.028, pos: [0.03, 0.022, 0.09] },
    wrist: { r: 0.028, pos: [0, 0.022, 0.085] },
    hand: 0.3,
    handLead: [
      [-0.05, 0.1],
      [0.24, 0.06],
      [0.3, 0.01],
    ],
    handTrail: [
      [-0.05, -0.12],
      [0.12, -0.1],
      [0.24, -0.05],
      [0.3, 0.01],
    ],
    handEdge: { length: 0.3, r0: 0.028, r1: 0.009, pos: [0, 0.02, 0.08], tilt: -0.07 },
    // Packed close and overlapping, so the hand reads as one swept blade, not spread fingers.
    primaries: [
      [0.27, 0.04, 0.36, 0.95],
      [0.21, 0.01, 0.4, 0.87],
      [0.15, -0.03, 0.44, 0.78],
      [0.09, -0.06, 0.48, 0.68],
      [0.03, -0.09, 0.52, 0.57],
    ],
    primaryWidth: 0.14,
    fold: 0.6,
    fairing: { scale: [0.12, 0.045, 0.16], pos: [0.04, -0.008, -0.03] },
    glideSweep: 0.18,
  },
};
