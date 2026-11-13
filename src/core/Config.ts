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
    clearance: 1.6, // m the bird's body keeps above the water, and the margin for solid scenery
    groundHeight: 4, // m the bird never goes below over land (treetops, roofs and cloud sea too)
    groundCushion: 6, // m above that floor over which the nose is eased level, so it glides in
    groundLead: 0.7, // s of current sink rate the cushion looks ahead, so fast dives ease out early
    shoreBlend: 3, // m of terrain above the water over which the water margin blends into the land floor
    terrainLookahead: 1.4, // s ahead to sample the ground for the climb assist
    terrainAssist: 1.6, // how strongly the nose lifts to clear terrain ahead
    bounce: 0.55, // fraction of downward speed returned as upward speed on contact
    skimSlowdown: 0.18, // fraction of speed lost per second while skimming
    skimHeight: 5, // m above the water within which a skimming bird (species.waterSkim) gains speed
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
    // Wisp ribbons (CityWisps). Long straight avenue runs in one lane let a player line up once
    // and hold (over half the wisps with no turning at all), so runs change lanes and turn more:
    // the city should ask for steering about half the time. Every line is still checked clear
    // of the scenery, and a run falls back to a straight lane with the wide turn where a lane
    // change would clip something. See DESIGN's decisions log for the measurements.
    weaveLateral: 12, // m either side of the centre a run's lanes sit (past the 11 m magnet)
    weaveSharp: 1.6, // >1 flattens the sway into hold, swerve, hold (lane changes, not a zigzag)
    weavePeriod: 12, // wisps per there-and-back across the avenue (180 m, ~7 s at cruise)
    weaveMargin: 8, // m a lane-change line keeps from walls, pillars and decks (straight lanes 3.5)
    runMin: 4, // wisps straight down an avenue before the next turn
    runMax: 8,
    turnChance: 0.75, // runs that turn at the next crossing
    turnRadius: 30, // m, a tight quarter turn (~0.9 rad/s at cruise); the fallback arc is 40 m
    spiralChance: 0.35, // patterns that circle a tower (when one is near)
    // The volcano painted into the sky: how far away it pretends to be. Its foot sits on the
    // sea at this distance, so climbing sinks it a little below the horizon (400 m -> ~3.5 deg).
    mountainDistance: 6500, // m
    mountainFootFade: 0.05, // rad below the foot over which it dissolves into the haze
  },
  peaks: {
    // Plan (read when a level is created).
    cloud: 40, // m, mean height of the cloud sea's surface (the ground the bird skims)
    swell: 6, // m, long swells in the cloud sea, either way
    billow: 9, // m, rounded heaps of cloud on the swells, creased between
    dome: 26, // m, cloud heaps rising off the sea now and then
    heap: 6, // m, cloud piled against the foot of every spire
    spireCell: 100, // m, grid cell holding up to two spires
    spireMin: 13, // m, base radius of the smallest spires
    spireMax: 32, // m, base radius of the largest (before the cluster boost)
    spireTop: 330, // m, no summit rises above this (the ceiling is 420)
    spireLod: 520, // m, beyond this spires use the coarse mesh (chosen when chunks change)
    gateAhead: 400, // m from the spawn to the Sky Gate (two spires and a bridge)
    gateHalf: 52, // m, each gate spire's centre off the line the bird flies
    bridgeY: 150, // m, the gate bridge's deck where it meets the rock
    bridgeSag: 5, // m, how far the deck sags in the middle
    // Atmosphere and light.
    mist: 0.75, // the cloud sea's breath: mist hugging its surface, dissolving the spires' feet
    mistRise: 30, // m above the cloud sea that mist reaches
    mistFar: 0.36, // distance haze: far spires fade in layers
    banks: 0.6, // opacity of the cloud banks drifting round the spires' waists
    billowDetail: 0.55, // strength of the cauliflower lobes painted on the cloud sea
    glow: 0.3, // how much the cloud sea glows with the sky's light (clouds are never dark)
    summitsDistance: 5000, // m, how far the painted snow peaks on the horizon pretend to be
    lanterns: 1, // brightness of temple and bridge lanterns after dark
  },
  atoll: {
    // Plan (read when a level is created).
    cell: 1100, // m, grid cell that may hold one atoll (centres jitter a little, so rings never cross)
    radiusMin: 220, // m, reef ring radius of the smallest atolls
    radiusMax: 340, // m, of the largest (the home atoll is bigger)
    homeRadius: 540, // m, the home atoll round the spawn, with the high island in its lagoon
    homeAhead: 330, // m from the spawn to the home atoll's centre
    reefWidth: 34, // m, half width of the reef flat
    lagoonDepth: 7, // m, the lagoon floor's mean depth
    ocean: 42, // m, depth of the open ocean between atolls
    motu: 2.6, // m, height of the palm islets on the reef above the water
    motuShare: 0.5, // about this share of every reef carries islets
    canopy: 8, // m, palm and jungle canopy counts as soft ground this high
    islandChance: 0.3, // chance an atoll other than home has a smaller high island
    islandRadius: 175, // m, base radius of the home high island
    islandHeight: 165, // m, the summit of its fang (the ceiling is 300)
    solidAbove: 8, // m, land higher than this counts as solid for the look-ahead (the island)
    rockCell: 60, // m, grid cell that may hold one mushroom rock in a lagoon
    rockMin: 8, // m, cap radius of the smallest mushroom rocks
    rockMax: 17, // m, of the largest
    rockLod: 450, // m, beyond this rocks use the coarse mesh (chosen when chunks change)
    // Atmosphere and light.
    clarity: 0.8, // how clear the water is: 0 opaque (other levels), 1 glass-clear over the sand
    surf: 1, // brightness of the surf breaking on the outer reefs
    glow: 1, // bioluminescence in the surf after dark
    windows: 1, // brightness of bungalow windows and boat lanterns after dark
    mistFar: 0.16, // sea haze: far atolls fade into the horizon
    cumulusDistance: 25000, // m, how far the painted cumulus towers on the horizon pretend to be
    cumulusBase: 600, // m, their flat bases' height
  },
  ringmoon: {
    // Plan (read when a level is created).
    depth: 5, // m, the shallow sea's mean depth over its moss beds
    isleScale: 0.0024, // frequency of the islet noise: a table of moss every ~400 m
    isleShare: 0.48, // about this share of the sea carries islets (~46 % land: islets and channels)
    isleTop: 3.2, // m, the islets' moss tables above the water (terraces rise a little higher)
    landScale: 0.0006, // frequency of the mainland noise: broad land a kilometre or two across
    landShare: 0.24, // about this share of the world is mainland (on top of the islets)
    hillHeight: 46, // m, the tallest rolling moss hills inland
    canopy: 9, // m, coil fronds and reed fans on the islets count as soft ground this high
    spireCell: 64, // m, grid cell that may hold one basalt spire
    spireMin: 6, // m, base radius of the slimmest spires
    spireMax: 13, // m, of the stoutest
    spireLow: 38, // m, height of the shortest spires
    spireHigh: 150, // m, of the tallest (the ceiling is 320)
    lean: 0.15, // most a spire leans: metres sideways per metre up
    spireLod: 460, // m, beyond this spires use the coarse mesh (chosen when chunks change)
    // The ship: an old seed-pod vessel resting on four legs in the shallows ahead of the spawn.
    shipAhead: 470, // m from the spawn to the ship's middle
    shipYaw: 1.25, // rad, its long axis turned almost across the view, so it reads end to end
    shipLength: 88, // m, half its length
    shipWidth: 30, // m, half its beam
    shipHeight: 18, // m, half the hull's height
    shipBelly: 27, // m, the underside above the water: room to fly beneath it
    legRadius: 2.4, // m, each leg's thickness (solid)
    // Alien things on the land, all one family (ivory shell, copper, teal light).
    propCell: 130, // m, grid cell that may hold one group of alien things
    podChance: 0.22, // chance a cell on land holds a few landing pods (soft, glided over)
    crystalChance: 0.24, // chance it holds crystal clusters instead (soft)
    beaconChance: 0.07, // chance it holds a beacon tower instead (solid, on bigger land)
    beaconHeight: 50, // m, a beacon tower's height (each varies a little)
    ringSpin: 0.35, // rad/s, how fast a beacon's rings turn
    // Atmosphere and light.
    clarity: 0.55, // how clear the shallows are: the moss beds show through (0 opaque, 1 glass)
    mistFar: 0.22, // sea haze: far spires fade into the jade horizon
    giantSize: 0.2, // rad, angular radius of the ringed gas giant in the sky
    giantAz: 0.35, // rad, its azimuth from the spawn's heading (positive: to the left)
    giantEl: 0.3, // rad, its height above the horizon
    sun2: 0.42, // rad the second, smaller sun trails the first round the sky
    glow: 1, // brightness of the reed tips, ship lights and pods after dark
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
    // Light at which each journey milestone opens (~180 light for a 6-minute flight). A bird
    // joins the track only once it can be flown (the Crane is still to come): see DESIGN.
    emberTrail: 120,
    city: 300,
    swallow: 480, // the first new way to fly comes early, about flight 3
    karst: 750,
    duskRosePlumage: 950,
    jadeMistTrail: 1100,
    fjord: 1250,
    frostPlumage: 1500,
    crane: 1650, // the second new bird, about flight 9
    jerusalem: 1800,
    auroraTrail: 2050,
    canyon: 2400,
    gildedPlumage: 2700,
    peaks: 3000,
    atoll: 3150,
    ringmoon: 3230, // the newest level, just before the final bird
    phoenix: 3300, // the final bird, the end of the track (later birds go before it)
  },
  aviary: {
    trailPreview: 0.6, // lowest wingtip-trail opacity while the Aviary is open (the bot glides lazily)
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
  species: {
    // Each bird's flight as multipliers on `flight` and `tricks` (see FlightTuning), plus its
    // chase distance and wingbeat tempo. The Tern is the model itself: every factor 1, every
    // addition 0. Keep factors near 1 (about +-20 %) so every bird can fly the wisp ribbons.
    tern: {
      turn: 1,
      flapLift: 1,
      flapCooldown: 1,
      bleed: 1,
      rollHop: 1,
      rollBoost: 0,
      waterSkim: 0,
      thermal: 1,
      speed: 1, // cruise and minimum speed
      topSpeed: 1,
      embers: 0, // embers shed per second
      camera: 1, // chase distance
      beat: 1, // wingbeat period
    },
    swallow: {
      // Quick and darting: turns sharper and flaps more often, but each flap lifts less and dive
      // speed bleeds away sooner. Its roll is a dart, and skimming water speeds it up.
      turn: 1.2,
      flapLift: 0.9,
      flapCooldown: 0.85,
      bleed: 1.15,
      rollHop: 2.4, // a dart covers ~12 m sideways per turn (the Tern's roll ~5 m)
      rollBoost: 4, // m/s as it darts
      waterSkim: 8, // m/s^2 low over water (settles near 50 m/s on a long skim)
      thermal: 1,
      speed: 1,
      topSpeed: 1,
      embers: 0,
      camera: 0.9, // a smaller bird: the camera sits a little closer
      beat: 0.78, // quicker, shallower-feeling strokes
    },
    crane: {
      // Slow and stately: wide, lazy turns and fewer, stronger flaps; dive speed carries far.
      // It rides thermals: a column lifts it far faster than the others.
      turn: 0.85,
      flapLift: 1.15,
      flapCooldown: 1.2,
      bleed: 0.8,
      rollHop: 1,
      rollBoost: 0,
      waterSkim: 0,
      thermal: 1.8,
      speed: 1,
      topSpeed: 1,
      embers: 0,
      camera: 1.12, // a big bird: the camera sits a little farther back
      beat: 1.35, // slow, deep strokes
    },
    phoenix: {
      // The last bird: blazing fast. It cruises at 1.6x everyone's speed; it turns 1.45x as fast
      // so its turning circle stays near the Tern's and the wisp ribbons stay in reach. It sheds
      // embers as it flies.
      turn: 1.45,
      flapLift: 1.1,
      flapCooldown: 1,
      bleed: 1,
      rollHop: 1.5,
      rollBoost: 0,
      waterSkim: 0,
      thermal: 1,
      speed: 1.6, // cruise ~42 m/s against 26
      topSpeed: 1.3, // ~88 m/s flat out
      embers: 40,
      emberCarry: 0.9, // share of the bird's velocity an ember leaves with (its wake trails gently)
      camera: 1.05,
      beat: 0.9,
    },
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
