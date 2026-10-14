/**
 * Every tunable lives here. Values are plain mutable numbers so the ?debug panel can edit them
 * live; systems read them each frame instead of caching. Units: metres, seconds, radians.
 */
export const Config = {
  flight: {
    cruiseSpeed: 26, // speed the bird relaxes to in level flight
    minSpeed: 15, // soft floor: below this the nose is gently pushed down, never a stall
    maxSpeed: 68, // soft ceiling: extra drag above it
    speedRelax: 0.35, // 1/s, how quickly speed returns to cruise from below
    speedRelaxFast: 0.18, // 1/s, slower bleed above cruise so dive speed carries into the pull-up
    gravityAlongPath: 14, // m/s^2 traded between speed and pitch (dive = faster, climb = slower)
    diveGravity: 1.35, // multiplier on gravityAlongPath when nose-down: dives build speed faster
    maxClimb: 0.6, // rad, ~34 deg nose-up at full input
    maxDive: 0.85, // rad, ~49 deg nose-down at full input
    pitchOmega: 3.2, // critically damped spring frequency for pitch response
    maxTurnRate: 1.15, // rad/s yaw rate at full input
    turnOmega: 3.6, // spring frequency for turn-rate response
    bankPerTurn: 0.75, // rad of bank per rad/s of yaw rate
    maxBank: 1.0, // rad
    bankOmega: 5, // spring frequency for visual bank
    flapLift: 7.5, // m/s of upward velocity added per flap
    flapBoost: 4, // m/s of forward speed added per flap
    flapCooldown: 0.45, // s between flaps while held
    liftDecay: 1.6, // 1/s, how quickly the extra vertical velocity fades
    climbBeatPitch: 0.12, // rad nose-up (while steering up) above which the bird beats its wings
    climbBeatInterval: 0.4, // s between climb wingbeats
    climbBeatLift: 1.7, // m/s of upward velocity per climb wingbeat (at the steepest climb)
    climbBeatBoost: 0.8, // m/s of forward speed per climb wingbeat
    minAltitude: 6, // m above water level the bird is gently pushed back up from
    // m above water level where a soft ceiling starts. Overwritten by the level's ceiling on a
    // level switch (LevelDef.maxAltitude); exposed here for live tuning.
    maxAltitude: 400,
    boundsPush: 0.06, // strength of the soft altitude push (per metre of overshoot)
    clearance: 1.6, // m the bird's body keeps above the ground/water surface
    terrainLookahead: 1.4, // s ahead to sample the ground for the climb assist
    terrainAssist: 1.6, // how strongly the nose lifts to clear terrain ahead
    bounce: 0.55, // fraction of downward speed returned as upward speed on contact
    skimSlowdown: 0.18, // fraction of speed lost per second while skimming
  },
  camera: {
    distance: 6.2,
    height: 1.5,
    lookAhead: 6,
    posOmega: 5.5, // spring frequency for camera position
    baseFov: 62,
    fovPerSpeed: 0.55, // extra degrees of FOV per m/s above cruise
    maxFov: 90,
    rollFollow: 0.35, // fraction of the bird's bank the camera adopts
    pitchFollow: 0.4, // fraction of the bird's pitch used to place the camera
  },
  input: {
    mouseDeadZone: 0.06, // fraction of half-screen
    mouseRange: 0.6, // pointer offset (fraction of half-screen) that maps to full input
    touchRadius: 70, // px of drag for full input
    invertY: false,
  },
  fjord: {
    // Plan (read when a level is created).
    fjordScale: 0.00055, // frequency of the fjord noise: a fjord every ~900 m
    fjordMin: 60, // m, half width of the narrowest reaches
    fjordMax: 120, // m, half width of the broadest
    shelfMax: 38, // m, widest flat strand between water and wall (huts stand on it)
    wall: 150, // m, horizontal run of a wall from the strand to the plateau's lip
    plateau: 150, // m, mean plateau height above the water
    plateauVar: 55, // m, plateau swell either way
    peaks: 110, // m, ridged peaks rising off the plateau, away from the walls
    treeline: 75, // m, spruce stop climbing here
    snowline: 55, // m, snow lies above this on anything but cliffs
    bergCell: 110, // m, grid cell that may hold one iceberg
    lighthouseAhead: 260, // m along the fjord from the spawn to the lighthouse
    // Atmosphere.
    aurora: 1, // brightness of the aurora curtains (they show as the stars come out)
    seaSmoke: 0.5, // low mist over the water, thickest at night
    mistTop: 22, // m, the sea smoke lies below this
    mistFar: 0.32, // distance haze: far walls fade in layers
    windows: 1, // brightness of hut windows and the lighthouse after dark
    beamSpeed: 0.5, // rad/s, the lighthouse beam's sweep
  },
  world: {
    seed: 1337,
    chunkSize: 160,
    chunkRes: 40, // quads per chunk side (near LOD)
    farRes: 14, // quads per chunk side beyond lodDistance
    lodDistance: 420,
    waterLevel: 0,
    dayLength: 420, // seconds for a full dawn -> dusk -> twilight cycle
    treeCell: 11, // m, scatter grid for trees
    canopyHeight: 9, // m, dense forest counts as "ground" this high for soft skimming
    buildBudgetMs: 4, // max chunk-building time per frame
    cloudDrift: 3, // m/s
  },
  city: {
    // Street grid (the layout reads these when a city is created; the ground shader matches).
    superblock: 240, // m between avenue centre lines
    avenueHalf: 20, // half width of an avenue: 40 m boulevards with 4 m tree-lined sidewalks
    streetHalf: 6, // half width of a local street
    canopy: 7, // m, park and forest canopy counts as soft ground this high
    // Flying among buildings.
    avoidLook: 1.1, // s of flight scanned ahead for walls
    avoidSteer: 1.5, // how hard the bird veers toward the open side of a wall ahead
    avoidClimb: 1.2, // how hard it pulls up over a roof it can clear
    glance: 0.9, // fraction of the angle into a wall turned away on contact
    glanceSlow: 0.25, // speed lost against a wall, scaled by how head-on (about 0.04 per step head-on)
    lights: 1, // brightness of windows, neon and lamps after dark
    // The volcano painted into the sky: how far away it pretends to be. Its foot sits on the
    // sea at this distance, so climbing sinks it a little below the horizon (400 m -> ~3.5 deg).
    mountainDistance: 6500, // m
    mountainFootFade: 0.05, // rad below the foot over which it dissolves into the haze
  },
  karst: {
    // Plan (read when a level is created).
    riverScale: 0.0008, // frequency of the river noise: a river every ~700 m
    riverMin: 24, // m, half width of the narrowest reaches
    riverMax: 44, // m, half width of the broadest
    pillarCell: 72, // m, grid cell holding up to two pillars
    pillarMin: 12, // m, base radius of the smallest pillars
    pillarMax: 34, // m, base radius of the largest (before the dense-cluster boost)
    pillarTop: 250, // m, no summit rises above this (the ceiling is 320)
    pillarLod: 480, // m, beyond this pillars use the coarse mesh (chosen when chunks change)
    canopy: 9, // m, bamboo and groves count as soft ground this high
    // Atmosphere.
    mist: 0.85, // valley mist at dawn; it thins through the day and gathers again at dusk
    mistTop: 55, // m, the mist lies below this
    mistFar: 0.42, // distance haze: far pillars fade in layers, like ink washes
    ridgeDistance: 2600, // m, how far the painted ridges on the horizon pretend to be
    lanterns: 1, // brightness of lanterns after dark
  },
  flow: {
    gain: 0.03, // flow per pickup
    chainBonus: 0.003, // extra flow per link in the current chain (capped)
    chainWindow: 2.6, // s between pickups that still counts as a chain
    grace: 2.0, // s after a pickup before flow starts draining
    decay: 0.05, // flow lost per second while draining (full meter drains in ~20 s)
    basePoints: 10,
    flowMultiplier: 4, // full flow = 5x points
    wispsPerLantern: 24,
  },
  wisps: {
    max: 56,
    keepAhead: 26, // spawn new patterns while fewer upcoming wisps than this
    spacing: 15, // m between wisps (~0.6 s at cruise: a gentle rhythm)
    gap: 55, // m between patterns
    collectRadius: 3.6,
    magnetRadius: 11,
    magnetSpeed: 26,
    cruiseClearance: 22, // preferred path height above ground
    minClearance: 7,
    maxClearance: 240, // highest the path rides above ground (after spirals, climbs, or a high anchor)
    glideSink: 1.5, // m per wisp the path sinks back toward cruiseClearance: a long, gentle glide down
    maxRise: 6, // m per wisp the path may climb, so it never asks for more than a flapping bird can do
    climbGain: 35, // m of extra height a 'climb' pattern adds to the path
    spiralCount: 24, // wisps in a thermal spiral
    spiralRise: 4.5, // m per wisp up the thermal spiral
    reanchorHeight: 150, // m between the path and the player before the path restarts at the player
  },
  thermals: {
    strength: 13, // m/s^2 upward at the column centre (equilibrium climb ~8 m/s with liftDecay)
    height: 300, // m above ground the column reaches
  },
  bird: {
    // Visual wingbeats only: the flight model is untouched, so the bird's own beats are cosmetic.
    flapPeriod: 0.42, // s, one full down-up stroke for a player flap
    climbBeatPeriod: 0.4, // s per stroke while climbing: matches climbBeatInterval, strokes run back to back
    climbAmplitude: 0.75, // fraction of a full flap stroke
    idleBeatPeriod: 0.34, // s per stroke of the bird's own occasional wingbeats
    idleAmplitude: 0.55, // fraction of a full flap stroke
    idleBeatsMin: 2, // beats per burst
    idleBeatsMax: 4,
    idleGapMin: 1.4, // s of glide between bursts when slow or climbing
    idleGapMax: 6, // s of glide between bursts in fast level flight
    blendRate: 10, // 1/s, how fast the wings ease into and out of a beat
  },
  render: {
    // Overwritten by the quality preset (see Quality.ts); exposed here for live tuning.
    drawDistance: 1100,
    treeDistance: 800,
    fogStart: 0.25, // fraction of draw distance where fog begins
    bloomStrength: 0.35,
    bloomRadius: 0.6,
    bloomThreshold: 0.92,
    grain: 0.05,
    vignette: 0.32,
    saturation: 1.08,
    clouds: 46,
  },
};

export type ConfigType = typeof Config;

export type QualityLevel = 'low' | 'medium' | 'high';

/** Presets: draw distance, density and post costs. Applied over Config.render. */
export const QUALITY: Record<
  QualityLevel,
  {
    drawDistance: number;
    treeDistance: number;
    clouds: number;
    bloom: boolean;
    maxPixelRatio: number;
    particles: number;
  }
> = {
  low: {
    drawDistance: 650,
    treeDistance: 420,
    clouds: 22,
    bloom: false,
    maxPixelRatio: 1,
    particles: 0.4,
  },
  medium: {
    drawDistance: 900,
    treeDistance: 620,
    clouds: 34,
    bloom: true,
    maxPixelRatio: 1.5,
    particles: 0.7,
  },
  high: {
    drawDistance: 1150,
    treeDistance: 820,
    clouds: 46,
    bloom: true,
    maxPixelRatio: 2,
    particles: 1,
  },
};
