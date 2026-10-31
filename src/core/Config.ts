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
  tricks: {
    cooldown: 0.25, // s after a trick before the next can start
    rollRate: 13, // rad/s peak spin of a barrel roll (~0.7 s per turn with the ease in and out)
    rollAccel: 70, // rad/s^2 spin-up and braking
    rollHop: 5, // m sideways per turn, toward the roll
    maxRolls: 3, // turns a held roll can reach
    loopRadiusPerSpeed: 0.34, // m of loop radius per m/s of entry speed (a loop takes ~2.4 s)
    loopMin: 8, // m, smallest loop (a smaller fit becomes no loop at all)
    loopMax: 26, // m, largest loop (after a fast dive)
    loopDip: 0.2, // fraction of entry speed lost over the top (it comes back on the way down)
    loopDrift: 0.18, // forward drift round the loop as a fraction of speed: exits ~1.1 r ahead
    divePitch: 1.2, // rad nose-down in a dive-bomb (~70 deg)
    diveMin: 0.6, // s, shortest stoop (a quick double tap)
    diveScalePerSec: 0.4, // score multiplier gained per second of stoop past diveMin (uncapped while held)
    diveBoost: 5, // m/s added as the wings tuck
    diveGravity: 1.8, // extra pull on top of the usual dive gravity
    diveExtraSpeed: 14, // m/s the dive-bomb may run past maxSpeed
    diveMinHeight: 30, // m above the surface needed to start one
    divePullTime: 0.9, // s of fall left when the pull-out starts, whatever the hold
    pullTime: 0.7, // s of firm pull-out after the stoop
    pullPitch: 0.35, // rad nose-up at the start of the pull-out
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
    loopWatch: 2.4, // distance (in loop radii) from which the camera watches a loop
  },
  input: {
    mouseDeadZone: 0.06, // fraction of half-screen
    mouseRange: 0.6, // pointer offset (fraction of half-screen) that maps to full input
    touchRadius: 70, // px of drag for full input
    doubleTap: 0.26, // s between two presses of a direction that make a trick gesture
    flickDistance: 110, // px the steering finger must travel within flickTime to flick a trick
    flickTime: 0.12, // s
    padDeadZone: 0.22, // fraction of the D-pad's radius round its centre that presses nothing
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
  canyon: {
    // Plan (read when a level is created).
    canyonScale: 0.0006, // frequency of the canyon noise: a canyon every ~800 m
    floorMin: 38, // m, half width of the canyon floor in its narrowest reaches
    floorMax: 82, // m, half width of the floor where it opens out
    riverMin: 9, // m, half width of the river down the middle of the floor
    riverMax: 16,
    wall: 120, // m, horizontal run of a wall from the floor to the rim
    bands: 4, // rock bands in a wall: each a cliff over a bench
    cliff: 0.42, // share of a band's run taken by its cliff (the rest is the bench)
    plateau: 125, // m, mean height of the rim and the desert above it
    plateauVar: 16, // m, rim and plateau swell either way
    mesa: 70, // m, flat-topped mesas and buttes rising off the plateau
    archCell: 420, // m, grid cell that may hold one arch (in the canyon or out on the plateau)
    greatAhead: 330, // m along the canyon from the spawn to the Great Arch
    greatSpan: 46, // m, half span of the Great Arch's opening
    greatRise: 62, // m, height of its opening
    hoodooCell: 24, // m, grid cell that may hold one hoodoo near the rim
    // Atmosphere and light.
    mist: 0.3, // dawn mist in the canyons (it burns off by day)
    mistTop: 30, // m, the dawn mist lies below this
    mistFar: 0.24, // dust haze: far mesas fade in layers
    mesasDistance: 3000, // m, how far the painted mesas on the horizon pretend to be
  },
  ground: {
    // Painted detail over the terrain's vertex colours (GroundDetail), all fading with distance.
    mottle: 0.24, // brightness swing of the broad paint patches
    strokes: 0.11, // brightness swing of the fine brush strokes on gentle ground
    strata: 0.12, // darkening of the rock bands on steep ground
    bump: 0.6, // strength of the small surface bumps the light catches
    warmth: 0.13, // warm/cool hue drift across the patches
    detailFar: 520, // m, beyond this the near detail (strokes, bumps) has faded out
  },
  jerusalem: {
    // Plan (read when a level is created).
    plateau: 64, // m, the Old City's ground inside the walls (it tilts a little, see the layout)
    wallHeight: 13, // m, the walls stand this far above the city's ground
    towerEvery: 46, // m between wall towers
    fabricRoof: 9, // m, the Old City's roofscape counts as soft ground this high
    townRoof: 11, // m, hill-town and new-city roofs count as soft ground this high
    forestCanopy: 9, // m, pine forest counts as soft ground this high
    hillScale: 0.0013, // frequency of the rolling Judean hills
    hills: 46, // m, swell of the hills either way
    wadiScale: 0.0009, // frequency of the wadi noise: a valley every ~1 km
    wadiDepth: 34, // m, how deep a wadi cuts below the hills
    wadiWidth: 150, // m, half width of a wadi from its floor to its rim
    terraceStep: 3, // m, rise of one olive terrace
    // Atmosphere and light.
    mist: 0.35, // morning mist pooled in the valleys (it burns off by day)
    mistTop: 46, // m, the valley mist lies below this
    mistFar: 0.2, // distance haze: far hills fade in layers
    hillsDistance: 3200, // m, how far the painted hills on the horizon pretend to be
    flood: 1, // floodlight on the walls and landmarks after dark
    lights: 1, // brightness of windows and lamps after dark
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
    treeSway: 0.0025, // wind sway of tree crowns (m of push per m^2 of height up the tree)
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
    trickGain: 0.06, // flow per landed trick (before the variety and size multipliers)
    trickPoints: 4, // points per trick, in basePoints
    trickRepeat: 0.5, // multiplier for repeating the last trick (rolls either way count as one)
    trickVariety: 1.3, // multiplier for a trick unlike the last two
  },
  journey: {
    // Light: the lifetime total that opens the journey's unlocks. It ignores flow on purpose:
    // the score is the skill number, light is time well spent, so a relaxed flight earns its wisps.
    wisp: 1, // light per wisp
    lantern: 10, // light per lantern reached (a lantern lighting by itself gives none)
    trick: 2, // light per landed trick
    bankEvery: 10, // s between saves in flight (pausing and leaving the page save too)
  },
  unlocks: {
    // Light at which each journey milestone opens (~180 light for a 6-minute flight).
    emberTrail: 120,
    city: 300,
    duskRosePlumage: 480,
    karst: 750,
    jadeMistTrail: 950,
    swallow: 1150,
    fjord: 1250,
    frostPlumage: 1500,
    jerusalem: 1800,
    auroraTrail: 2050,
    canyon: 2400,
    gildedPlumage: 2700,
    crane: 3000,
  },
  lantern: {
    // A lit lantern is a destination: fly through its column of light to reach it.
    reachRadius: 16, // m from the column's axis that counts (generous: the beam itself is narrower)
    reachBelow: 12, // m below the orb that still counts, so skimming its foot works too
    points: 20, // bonus for reaching one, in basePoints, at the full flow it refills
    boost: 9, // m/s forward surge on reaching one
    lift: 6, // m/s upward lift on reaching one
    guide: 400, // m within which the autopilot heads for a lantern still to reach
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
    treeDetail: 280, // m, trees nearer than this use their detailed shapes
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
    treeDetail: number;
    clouds: number;
    bloom: boolean;
    maxPixelRatio: number;
    particles: number;
  }
> = {
  low: {
    drawDistance: 650,
    treeDistance: 420,
    treeDetail: 0,
    clouds: 22,
    bloom: false,
    maxPixelRatio: 1,
    particles: 0.4,
  },
  medium: {
    drawDistance: 900,
    treeDistance: 620,
    treeDetail: 200,
    clouds: 34,
    bloom: true,
    maxPixelRatio: 1.5,
    particles: 0.7,
  },
  high: {
    drawDistance: 1150,
    treeDistance: 820,
    treeDetail: 280,
    clouds: 46,
    bloom: true,
    maxPixelRatio: 2,
    particles: 1,
  },
};
