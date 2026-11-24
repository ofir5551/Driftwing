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
    // m/s above which flaps add no more speed (scaled by the bird's speed): boosting is a burst
    // out of cruise, and diving stays the way to go really fast (nonstop flaps used to reach ~67)
    flapSpeedCap: 45,
    flapCooldown: 0.45, // s between flaps while held
    flapBuffer: 0.25, // s before the cooldown ends within which a press is kept and flaps on time
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
    // Soft cloud (a level's softAt, the Sea of Clouds): a dive sinks in and is buoyed back out.
    cloudSkim: 2.5, // m over the cloud tops the bird rests (it brushes them; the land floor is groundHeight)
    cloudLead: 0.1, // share of groundLead the cushion keeps over cloud, so a fast dive carries through the top
    cloudDip: 14, // m under the cloud top the bird can sink at most (a backstop; buoyancy turns it first)
    cloudBuoyancy: 2, // m/s^2 of lift per metre under the resting height
    cloudDrag: 1, // 1/s, how fast the cloud soaks up the bird's sinking
    cloudPitch: 0.06, // rad of nose-up per metre under the resting height, so the bird swims out
    cloudVeil: 2.4, // m over the cloud top through which the bird fades into the cloud's colour
    cloudIn: 0.6, // m under the top at which the bird counts as plunged in (it is out again at the top)
    cloudMuffle: 4, // m under the cloud top at which the whole mix is fully muffled
    cloudCutoff: 600, // Hz, the muffle's lowpass at its deepest
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
    cloudLift: 3.5, // m the camera rises over its floor while the bird is under soft cloud (it looks down on the wake)
    cloudSoft: 4, // m over which the lifted camera eases onto its floor instead of stopping dead
    cloudOmega: 5, // spring frequency of the lifted camera's height
    cloudEase: 3, // 1/s, how quickly the lifted camera follows the cloud's heaps (higher is stiffer, lower is smoother)
  },
  input: {
    mouseDeadZone: 0.06, // fraction of half-screen
    mouseRange: 0.6, // pointer offset (fraction of half-screen) that maps to full input
    touchRadius: 70, // px of drag for full input
    doubleTap: 0.26, // s between two presses of a direction that make a trick gesture
    flickDistance: 110, // px the steering finger must travel within flickTime to flick a trick
    flickTime: 0.12, // s
    tapMax: 0.22, // s, longest touch of the steering finger that still counts as a tap (flaps)
    tapSlop: 14, // px a tap may move before it counts as a drag
    tapChain: 0.35, // s from a tap's lift within which the next touch flaps as it lands
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
    snowline: 185, // m, snow lies above this (on cliffs only on the ledges); ragged by noise
    snowRag: 45, // m the snowline wanders up and down
    snowfields: 0.5, // share of the plateau's hollows below the snowline that hold snowfields
    crag: 12, // m, ridged crags that buttress the walls
    crease: 0.04, // rounding of the crag and peak ridges (a sharp crease saws the skyline)
    bergCell: 110, // m, grid cell that may hold one iceberg
    lighthouseAhead: 260, // m along the fjord from the spawn to the lighthouse
    // Villages and waterfalls (pure layout, read when a level is created).
    villageCell: 900, // m, grid cell that may hold one fishing village on a strand
    villageChance: 0.75, // chance a cell's strand has a village
    villageAhead: 170, // m along the fjord from the spawn to the home village (on the right)
    villageShelf: 56, // m, the strand a village widens to
    villageReach: 140, // m along the shore over which the village's strand widens
    fallCell: 480, // m, grid cell that may hold one waterfall down a wall
    fallChance: 0.6, // chance a cell's wall has a waterfall
    fallAhead: 470, // m along the fjord from the spawn to the first waterfall
    fallDrop: 85, // m, the least drop a waterfall needs
    boatCell: 240, // m, grid cell that may hold a fishing boat out on the water
    boatChance: 0.22, // chance a boat cell has a boat
    seals: 0.3, // share of the big floes with a seal hauled out on them
    eagleCell: 700, // m, grid cell that may hold a sea eagle soaring over the walls
    // Atmosphere.
    aurora: 1, // brightness of the aurora curtains (they show as the stars come out)
    seaSmoke: 0.5, // low mist over the water, thickest at night
    mistTop: 22, // m, the sea smoke lies below this
    mistFar: 0.32, // distance haze: far walls fade in layers
    windows: 1, // brightness of hut windows and the lighthouse after dark
    beamSpeed: 0.5, // rad/s, the lighthouse beam's sweep
    dayHaze: 0.45, // share of the night's sea smoke and far haze left by day (clearer walls)
    fogCell: 150, // m, grid cell along the fjords that may hold a fog bank
    fogRange: 700, // m round the bird that fog banks are drawn
    // Painted ground and rock (rock.ts; live).
    rockRelief: 1, // strength of the walls' gullies and slabs (tilts the light)
    rockFar: 650, // m, the relief fades out by this distance (flat paint beyond)
    falls: 1, // brightness of the waterfalls (and their spray)
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
    archTries: 6, // spots a cell tries for a canyon arch (the first also decides a plateau fin)
    greatAhead: 330, // m along the canyon from the spawn to the Great Arch
    greatSpan: 46, // m, half span of the Great Arch's opening
    greatRise: 62, // m, height of its opening
    hoodooCell: 24, // m, grid cell that may hold one hoodoo near the rim
    // Ground (pure layout, read when a level is created).
    talus: 0.2, // share of a cliff's rise its scree apron climbs at the foot
    talusRun: 0.22, // the apron's run out from the cliff foot, as a share of a band's run
    washScale: 0.0035, // frequency of the dry-wash noise: a wash every ~250 m
    washWidth: 4.5, // m, half width of a sandy wash bed
    washDepth: 0.8, // m, how deep a wash dips into the canyon floor
    gullyDepth: 3.5, // m, how deep a wash cuts into the plateau
    slickrock: 2.4, // m, swell of the bare slickrock domes on the benches and plateau
    roadOffset: 27, // m from a canyon's centre line to its dirt road (on one side)
    roadWidth: 2.3, // m, half width of the road
    ranchCell: 1100, // m, grid cell that may hold one ranch, on a wide stretch of floor
    ranchChance: 0.6, // chance a cell's wide stretch has a ranch
    ranchAhead: 150, // m along the canyon from the spawn where the first ranch is sought
    alcoveCell: 760, // m, grid cell that may hold one cliff dwelling in an alcove
    alcoveChance: 0.6, // chance a cell's wall has one
    alcoveAhead: 300, // m along the canyon from the spawn where the first is sought
    // Life (scatter).
    cattle: 6, // head of cattle grazing round a ranch
    hawks: 0.3, // chance a chunk has a hawk (or a pair of ravens) circling over it
    dustDevils: 0.1, // chance a chunk of open ground raises a dust devil now and then
    fences: 0.35, // share of the road (in stretches) with a post-and-wire fence beside it
    // Rock: per-pixel strata over the walls, arches and hoodoos (rock.ts).
    rockBand: 7.5, // m, height of one rock layer
    rockContrast: 0.5, // 0 every layer the same mean rock colour .. 1 the full palette
    rockSeam: 0.12, // darkening of the weathered seam under each ledge
    rockVarnish: 0.55, // desert varnish streaks hanging from the lip of each cliff
    archRings: 44, // rings along an arch's band (legs and span); smooth normals
    archSides: 14, // points round an arch's rounded cross-section
    hoodooSides: 12, // radial segments of a near hoodoo (far ones have 7)
    // Atmosphere and light.
    mist: 0.3, // dawn mist in the canyons (it burns off by day)
    mistTop: 30, // m, the dawn mist lies below this
    mistFar: 0.24, // dust haze: far mesas fade in layers
    hazeTop: 80, // m, by day a warm dust haze lies in the canyons below this
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
    // The lived-in country (world/jerusalem/; read when a level is created).
    roadWidth: 3, // m, half-width of a road
    pathWidth: 0.8, // m, half-width of a footpath
    roadScale: 0.0009, // frequency of the noise whose zero lines are the hill roads
    pathScale: 0.003, // ... and the footpaths (they peter out where pathMask is low)
    pathMask: 0.05, // noise level under which a footpath fades out
    wadiRoad: 24, // m from a wadi's floor line to the road along it
    bedWidth: 3.5, // m, half-width of a valley's dry pebble bed
    fieldCell: 32, // m, side of a walled field on the valley floors
    fieldAngle: 0.35, // rad, the field grid's turn off the world axes
    fields: 0.75, // chance a level, open cell of valley floor is a walled field
    terraceGrid: 7, // m, the marching grid that traces each terrace wall along its contour
    flocks: 0.4, // chance a chunk of open hills has a flock of goats or sheep
    swifts: 0.55, // chance a chunk over the roofs has swifts wheeling
    clutter: 0.6, // share of flat roofs with water tanks, washing or pots
    awnings: 0.55, // chance a house on a market street has a stall in front
    cypressLines: 0.45, // share of road length lined with cypresses
    // Stone and trees.
    bevel: 0.45, // m, rounded edge painted into box normals (widens to ~bevelPx px far away)
    bevelPx: 2, // px, the narrowest a painted bevel gets, so far edges stay soft
    weathering: 0.12, // brightness swing of the stone's weathering patches and run-off streaks
    coolShade: 0.6, // stone turned from the sun leans toward the sky's colour (cool shadows)
    foliageSoft: 0.85, // tree lobe normals: 0 flat facets, 1 a round crown (read at creation)
    foliageDetail: 1, // painted leaf clumps on tree crowns (colour dabs and a bumped normal)
  },
  /** The Highlands' lived-in landscape: rivers, farms, villages (world/highlands/). */
  highlands: {
    riverWidth: 7, // m, half-width of a river channel at its centre line
    riverWander: 0.45, // +- share the width swells and narrows along the river
    plainWidth: 46, // m from the river's centre where its flood plain ends
    plainHeight: 2.6, // m, the flood plain's height above the water
    clearings: 0.35, // share of the forest opened into glades
    roadOffset: 24, // m from the river's centre to the dirt road along one bank
    roadWidth: 2.6, // m, half-width of the road
    fieldCell: 34, // m, side of a field in the patchwork
    fieldAngle: 0.47, // rad, the patchwork grid's turn off the world axes
    fieldFarm: 0.42, // farmland (Terrain.farm) at a field's centre for it to be farmed
    village: 0.5, // chance a road plot gets a house (scaled up in a village's heart, down between)
    farmsteads: 0.1, // chance a pasture or meadow field has a farmstead
    smokeRise: 2.2, // m/s chimney smoke rises
    wallPieces: 6, // wall or fence pieces along a field's side (each follows the slope)
    flocks: 0.22, // chance a chunk has a flock of birds wheeling over it
    mist: 0.5, // valley mist at dawn (it lifts through the morning)
    mistTop: 26, // m, height the valley mist thins out by
    mistFar: 0.06, // far haze, all day: layers the distant ridges
  },
  /** Shared lighting and atmosphere: sun shadows, contact and cloud shadows, light shafts. */
  light: {
    shadowRange: 400, // m, half-size of the shadow map's box round the bird
    shadowMapSize: 4096, // texels per side
    shadowMapSizeTouch: 2048, // ... on touch devices (softer shadows, a quarter of the memory)
    shadowSoftness: 0.45, // m, blur of a shadow's edge
    shadowFadeStart: 0.62, // share of shadowRange where shadows begin to fade out with distance
    shadowFadeEnd: 0.92, // share of shadowRange where they are gone (inside the box's edge)
    shadowBias: -0.0004,
    shadowNormalBias: 0.25, // m, pushes the lookup off the surface (no acne on gentle slopes)
    shadowSunMin: 0.06, // sun height (sunDir.y) where shadows have faded out (low sun, night)
    shadowSunFull: 0.18, // sun height where shadows reach full strength
    contactStrength: 0.34, // darkness of a contact shadow at its centre
    contactWithShadows: 0.2, // ... where the shadow map draws the real shadow (ambient occlusion only)
    contactRange: 280, // m, contact shadows fade out by this distance
    contactSize: 0.85, // blob radius as a share of a tree's crown radius
    cloudScale: 0.0035, // 1/m: cloud-shadow patch frequency (smaller = bigger clouds)
    cloudCover: 0.56, // 0..1 noise threshold: higher = fewer, smaller cloud shadows
    cloudDriftZ: 1.2, // m/s the shadows drift along z (along x they keep world.cloudDrift)
    cloudSunMin: 0.03, // sun height where cloud shadows have faded out (dusk, night)
    cloudSunFull: 0.3, // sun height where they reach full strength
    shaftThreshold: 0.82, // luminance a pixel needs to send light down a shaft
    shaftReach: 0.75, // screen distance (uv) over which shafts fade from the sun
    shaftDecay: 0.95, // per-sample falloff along a shaft
  },
  /**
   * Per-level strengths of the shared lighting (0 = off; the quality preset gates them on top).
   * shadows: how dark a sun shadow is (1 = the sun fully blocked; lower reads as a painted shade).
   * clouds: how much a drifting cloud shadow dims the direct sun.
   * shafts: light-shaft brightness when the sun is in view.
   */
  levelLight: {
    highlands: { shadows: 0.62, clouds: 0.32, shafts: 0.5 },
    // haze: the low layer in the street canyons (up to hazeTop m); hazeFar: the distance haze.
    city: { shadows: 0.5, clouds: 0.22, shafts: 0.35, haze: 0.16, hazeTop: 30, hazeFar: 0.03 },
    karst: { shadows: 0.5, clouds: 0.22, shafts: 0.6 },
    // fog: banks lying low on the water at first light; reflect: the aurora in calm water
    // near the shore at night.
    fjord: { shadows: 0.55, clouds: 0.25, shafts: 0.5, fog: 0.75, reflect: 0.3 },
    jerusalem: { shadows: 0.6, clouds: 0.25, shafts: 0.45 },
    // bounce: warm light off the red walls into the canyon's shade; haze: dust in the canyons.
    canyon: { shadows: 0.6, clouds: 0.3, shafts: 0.4, bounce: 0.32, haze: 0.16 },
    // beams: shafts of sun through the sky's clouds onto the cloud sea (geometry, so medium has
    // them too; they follow the cloud-shadow preset); warm: the low sun's glow on the heaps;
    // lining: the silver edge of cloud tops seen against the sun.
    peaks: { shadows: 0.5, clouds: 0.25, shafts: 0.7, beams: 0.3, warm: 0.35, lining: 0.45 },
    atoll: { shadows: 0.55, clouds: 0.3, shafts: 0.55 },
    // giant: light off the ringed giant's lit face (a coloured fill from its side of the sky,
    // the ringlight at night); sun2: the second sun's soft fill from where it trails the first.
    ringmoon: { shadows: 0.5, clouds: 0.2, shafts: 0.5, giant: 0.32, sun2: 0.22 },
  },
  /** Adaptive resolution (AdaptiveScale): judged in one-second windows of frames. */
  adaptive: {
    slowMs: 21, // a frame longer than this is slow (~47 fps)
    hitchMs: 100, // a frame longer than this is a one-off hitch and is not counted
    slowShare: 0.5, // a window with more than this share of slow frames is slow
    fastShare: 0.1, // a window with less than this share is comfortably fast
    dropAfter: 2, // slow windows in a row before the resolution drops
    dropStep: 0.15, // render scale lost per drop
    raiseStep: 0.1, // render scale regained per raise
    raiseAfter: 6, // fast windows before a raise
    raiseHold: 12, // s: a drop this soon after a raise doubles the wait for the next raise
    raiseMax: 120, // fast windows, the longest that wait grows to
    floor: 0.55, // lowest render scale; below it Auto steps the preset down
  },
  /** Ground cover (GroundCover): grass tufts and flowers on the terrain's own lattice. */
  cover: {
    cell: 1.25, // m between tufts at full density
    sway: 0.22, // m of tuft-tip sway in the wind
    gustSpeed: 0.9, // how fast the gust fronts roll across the land
    refresh: 14, // m the bird moves before the ring is refilled
    rimFade: 0.3, // share of the ring (by area) over which tufts shrink toward its rim
    steep: 0.75, // lattice height range per lattice step above which ground is rock, not turf
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
    buildBudgetMs: 2, // chunk-building time per frame after which no new chunk is started
    cloudDrift: 3, // m/s
  },
  city: {
    // Street grid (the layout reads these when a city is created; the ground shader matches).
    superblock: 240, // m between avenue centre lines
    avenueHalf: 20, // half width of an avenue: 40 m boulevards with 4 m tree-lined sidewalks
    streetHalf: 6, // half width of a local street
    avenueBridges: 0.47, // share of avenues that cross a river on a bridge (the rest end at it)
    streetBridges: 0.05, // share of side streets that cross a river on a bridge
    medianHalf: 1.4, // half width of the planted median down each avenue (inner lanes at 2.75 m)
    canopy: 7, // m, park and forest canopy counts as soft ground this high
    // The waterfront (the layout and the ground shader read these when a city is created). The
    // grid is straight and the shore curves, so the grid stops at a bayside road that follows
    // the shore, with a promenade between it and the seawall.
    promenade: 10, // m from the seawall to the bayside road: railing, lamps and a row of trees
    bayRoad: 14, // m, width of the bayside road (two lanes each way)
    riverWalk: 7, // m, the walk along the top of each river bank, lined with cherry trees
    setback: 3, // m every building keeps from the bayside road's kerb and the river walk
    // Flying among buildings.
    avoidLook: 1.1, // s of flight scanned ahead for walls
    avoidSteer: 1.5, // how hard the bird veers toward the open side of a wall ahead
    avoidClimb: 1.2, // how hard it pulls up over a roof it can clear
    glance: 0.9, // fraction of the angle into a wall turned away on contact
    glanceSlow: 0.25, // speed lost against a wall, scaled by how head-on (about 0.04 per step head-on)
    lights: 1, // brightness of windows, neon and lamps after dark
    // Painterly facade pass (building shader, boxes only; no vertices). Hides the box facets.
    bevel: 1.5, // m, corners and roof edges are shaded as if rounded over this width (never < ~2 px)
    wash: 0.12, // brightness swing of the paint wash over walls and roofs
    streaks: 0.06, // darkening of the vertical weathering streaks (near only)
    baseShade: 0.28, // darkening at the foot of a wall (contact shadow from the street)
    skyGrade: 0.1, // walls lighten toward their tops (sky light), darken toward the street
    windowDepth: 0.45, // lintel shadow inside each window, light sill under it
    glassSky: 0.55, // glass towers mirror the sky at grazing angles and up high
    edgeLight: 0.1, // corners, rims and the painted cornice catch this much extra light
    cylinderSegments: 16, // sides of the shared cylinder (pillars, lanterns, tanks), smooth-shaded
    treeSoftness: 0.85, // how far tree normals lean from facets to a smooth crown (build time)
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
    spireLod: 520, // m, beyond this spires use the coarse mesh at the high draw distance (scaled with it)
    // (Spires whose flank is nearer than render.heroDetail use the finest mesh, with grooves.)
    gateAhead: 400, // m from the spawn to the Sky Gate (two spires and a bridge)
    gateHalf: 52, // m, each gate spire's centre off the line the bird flies
    bridgeY: 150, // m, the gate bridge's deck where it meets the rock
    bridgeSag: 5, // m, how far the deck sags in the middle
    // Life on the rock (pure layout, read when a level is created).
    ropeBridges: 0.3, // share of tall spires that hang a rope bridge to a neighbour
    flagLines: 0.3, // share that string a line of prayer flags to one instead
    ropeSpan: 120, // m, the farthest apart two spires' centres may be for a rope between them
    ropeClear: 10, // m every wisp ribbon keeps from a rope (they are soft, but never in the way)
    ledgeCover: 0.9, // share of the ledge spots wide enough that carry moss, grass, snow or a dwarf pine
    craneSpeed: 11, // m/s, cranes wheeling round their circle
    huts: 0.3, // share of the spires with an alcove that shelter a hermit's hut in it
    pavilions: 0.14, // share of the bare summits that carry a little pavilion
    flockCell: 900, // m, grid cell that may hold a flock of cranes wheeling over the sea
    flockChance: 0.6, // chance a flock cell has a flock
    flockTop: 395, // m, a flock that would have to fly higher than this to clear the summits is dropped
    gapCell: 650, // m, grid cell that may hold a gap in the cloud sea
    gapChance: 0.55, // chance a gap cell has one (only out on the open sea)
    gapMin: 34, // m, radius of the smallest gaps
    gapMax: 62, // m, of the largest
    gapFloor: 5, // m, the valley floor seen through a gap (the water plane is at 0)
    gapRim: 5, // m, cloud heaped round a gap's rim
    gapHome: [-80, 150], // m from the spawn (x, z) to the home gap, left of the opening glide
    // Diving into the cloud sea (the bird sinks in and is buoyed out; Config.flight.cloud*).
    softNear: 8, // m off a spire's reach inside which the cloud is solid floor again (rock under it)
    softFar: 30, // m off it beyond which the cloud is fully soft
    veilLight: 1.3, // brightness of the veil and plunge puffs against the mist's colour (the lit tops are brighter)
    veilMax: 0.78, // brightest channel of that colour (linear), so the puffs never bloom
    ripple: 1, // strength of the churned ring spreading on the cloud sea from a plunge
    // Atmosphere and light.
    mist: 0.75, // the cloud sea's breath: mist hugging its surface, dissolving the spires' feet
    mistRise: 30, // m above the cloud sea that mist reaches
    mistFar: 0.36, // distance haze: far spires fade in layers
    banks: 0.6, // opacity of the cloud banks drifting round the spires' waists
    bankChurn: 1, // how much the banks' puffs wander and swell, so each bank keeps changing shape
    seaDrift: 1.4, // m/s, the cloud sea's moving heaps and lobes ride the wind this fast
    heave: 2.2, // m, the cloud sea's surface swells and sinks this far (visual; under groundHeight)
    breath: 0.16, // rad/s, how fast a stretch of the cloud sea swells and sinks (~40 s a breath)
    billowDetail: 0.55, // strength of the cauliflower lobes painted on the cloud sea
    glow: 0.3, // how much the cloud sea glows with the sky's light (clouds are never dark)
    summitsDistance: 5000, // m, how far the painted snow peaks on the horizon pretend to be
    lanterns: 1, // brightness of temple and bridge lanterns after dark
    // Granite (granite.ts; live).
    rockRelief: 1, // strength of the joints and pillowed blocks (tilts the light)
    rockFar: 420, // m, the relief and fine paint fade out by this distance (off on low)
    ledgeMoss: 1, // moss and turf wherever the rock faces the sky
    snowline: 228, // m, snow lies on ledges and summits above this
    snowRag: 22, // m the snowline wanders up and down
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
    crest: 0.75, // m the reef crest rises in patches (bare rubble and tide pools at low water)
    sandbars: 1, // 0..1 strength of the sand bars on the lagoons' sand flats
    villageChance: 0.45, // chance an atoll other than home has a fishing village off an islet
    homeVillage: 2.3, // rad round the home island (from +z) of its village's beach
    jungle: 0.32, // share of island cells that hold a jungle tree (the ground paints the rest)
    // Life (scatter, within prop distance).
    canoes: 0.05, // chance an 18 m cell of beach has an outrigger canoe pulled up on it
    villageCanoes: 0.5, // ... near a village
    nets: 0.03, // chance a cell of the shallows has a fishing net on poles (near a village 0.35)
    fires: 0.012, // chance a cell of an islet's beach has a cooking fire (villages have two or three)
    smokeRise: 1.1, // m/s, how fast the cooking fires' smoke rises
    coral: 0.6, // density of the coral heads on the lagoon knolls
    fish: 0.3, // chance an 80 m cell of lagoon has a school of fish
    turtles: 0.08, // ... a turtle
    rays: 0.08, // ... an eagle ray
    paddlers: 0.07, // ... a canoe out paddling
    seabirds: 0.3, // chance a chunk has frigatebirds or terns overhead
    // Atmosphere and light.
    clarity: 0.8, // how clear the water is: 0 opaque (other levels), 1 glass-clear over the sand
    surf: 1, // brightness of the surf breaking on the outer reefs
    glow: 1, // bioluminescence in the surf after dark
    windows: 1, // brightness of bungalow windows and boat lanterns after dark
    mistFar: 0.16, // sea haze: far atolls fade into the horizon
    // The painted ground (land.ts).
    crowns: 1, // strength of the painted crown carpet on the jungle (tint, dark gaps, domes)
    crownSize: 5, // m, spacing of the painted crowns
    crownFar: 1400, // m, beyond this the crowns have faded out
    foam: 1, // the shore's swash: height of its reach and strength of its lace of foam
    tidePools: 1, // the reef flat's rubble, coralline crust and tide pools
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
    // Spires (read when a level is created): sides and rings of the lathed meshes.
    spireSides: 14, // near mesh (within spireLod): the painted column facets do the rest
    spireRings: 26, // near mesh rings, bunched toward the crown
    farSides: 8, // coarse mesh beyond spireLod (6 read as a hexagon on the skyline)
    farRings: 10,
    // Painted basalt on the spires and the terrace steps (rock.ts; live).
    columns: 16, // basalt columns round a spire (flat faces with joints between)
    relief: 2, // strength of the columns' facets and the drum cracks (tilts the light)
    cracks: 0.4, // darkness of the cracks between the column drums
    rockFar: 520, // m, the relief fades out by here (flat paint beyond)
    // The painted ground (land.ts; live).
    moss: 1, // the moss cushions on the islets and hills (tint, dark gaps, domes)
    mossSize: 0.7, // m, spacing of the painted cushions
    seabed: 1, // ripples, moss beds and spore glow on the sea floor
    foam: 1, // the shore's swash: its reach and its lace of foam
    tidePools: 1, // tide pools on the shore flats and the terrace steps
    sandbars: 1, // 0..1 strength of the sand bars in the open shallows (read when created)
    // The explorers' camp by the ship (read when a level is created).
    campAlong: 82, // m along the ship's length (toward the right end) to the camp's sand spit
    campOut: 78, // m out from the ship's side, toward the spawn
    campRadius: 44, // m, the spit's half length (half as wide)
    // Life (scatter, within prop distance).
    outposts: 0.75, // share of lander groups with an explorers' outpost (habs, mast, lit path)
    bulbs: 0.09, // chance a 12 m cell of moss has a cluster of glow bulbs
    fish: 0.35, // chance a 70 m cell of shallows has a school of glowing fish
    herds: 0.6, // chance a 220 m cell of mainland hills has a herd of grazers
    floaterCell: 300, // m, grid cell that may hold one drifting floater
    floaters: 0.45, // chance a floater cell has one
    steps: 0.35, // density of the basalt column steps on the islet terraces
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
    pillarSeg: 32, // radial segments of the hero pillar mesh (within render.heroDetail)
    pillarRings: 36, // rings of the hero pillar mesh
    flutes: 1.0, // strength of the rock shader's vertical solution flutes (normal tilt)
    streaks: 0.4, // darkness of the rock shader's rain streaks down the walls
    mossLedges: 0.75, // rock-shader moss on sky-facing rock (ledges, shoulders)
    canopy: 9, // m, bamboo and groves count as soft ground this high
    roofs: 11, // m, a village's roofs count as soft ground this high (at its heart)
    terraceStep: 1.1, // m, rise of one paddy terrace
    terraceHills: 6, // m, the paddy country swells into hills this high, terraced all the way up
    fieldCell: 26, // m, paddy fields are cut across the terraces on this grid
    pathScale: 0.0016, // frequency of the footpath noise: a path every ~300 m
    pathWidth: 1.3, // m, half width of a footpath
    towpath: 7, // m from the waterline to the towpath along each bank
    bridgeCell: 620, // m, grid cell that may hold one bridge (where a path crosses the river)
    bridgeChance: 0.85, // share of the cells that try
    bridgeMaxHalf: 36, // m, only reaches narrower than this (half width) are bridged
    bridgeSpawn: 520, // m, the opening run along the river stays open
    bridgeRise: 8, // m, the deck's crown above the water
    bridgeWidth: 6, // m, deck width
    bridgeEase: 16, // m along the river over which the flight floor ramps up over a bridge
    pagodaChance: 0.12, // share of the modest summits that carry a pagoda
    boulders: 1, // scree boulders at a pillar's foot (x 4 + radius / 4)
    vines: 1, // vine curtains down a pillar's walls (x 2 + height / 28, at most 10)
    paddyMirror: 0.85, // how much a flooded paddy mirrors the sky
    life: 0.16, // chance a 22 m cell of open valley has a buffalo or a farmer in it
    // Atmosphere.
    mist: 0.85, // valley mist at dawn; it thins through the day and gathers again at dusk
    mistTop: 55, // m, the mist lies below this
    mistFar: 0.42, // distance haze: far pillars fade in layers, like ink washes
    riverMist: 0.8, // opacity of the mist sheets lying over the river at dawn (gone by midday)
    riverMistCell: 70, // m, grid cell that may hold one river mist sheet
    riverMistRange: 700, // m, river mist is laid out (and fades out) within this
    riverMistRefresh: 40, // m the bird moves before the river mist is laid out again
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
  discoveries: {
    every: 0.1, // s between looks for a level's hidden finds (their tests query the layout)
    night: 0.6, // sky stars (0..1) from which a night-only find can be made
    light: 25, // journey light a find gives
    flash: 0.3, // screen flash on a find (a lantern lighting is 0.6)
  },
  destinations: {
    // Each flight is a journey: a beacon marks a landmark far ahead, the wisps lean toward it,
    // and reaching it ends the journey (light, a chord, a line on the Rest card), then the next
    // beacon rises. No clock and nothing to fail: see DESIGN's Destinations.
    firstDelay: 4, // s into a flight before the first beacon rises (after "Follow the wisps")
    nextDelay: 7, // s after an arrival before the next beacon rises (time to enjoy it)
    retry: 5, // s before asking again when no destination could be found from here
    stray: 5200, // m from the beacon beyond which a new, nearer one is chosen
    firstRoute: 1000, // m along the way, at least, to the flight's first destination (~40 s)
    minRoute: 1600, // m along the way, at least, to every later one (about a minute)
    maxRoute: 4600, // m along the way searched for one (ahead only; none in reach: ask again later)
    light: 40, // journey light for reaching a destination (a lantern gives 10)
    reach: 18, // m from the beacon's axis that counts as flying through its light (it is ~9-16 wide)
    reachBelow: 15, // m below the beacon's foot that still counts (skimming its foot)
    flash: 0.7, // screen flash on arrival
    boost: 8, // m/s forward surge on arrival
    lift: 5, // m/s upward lift on arrival
    beamHeight: 900, // m, the beacon's column of light
    beamRadius: 9, // m, its radius at the foot (it widens upward)
    beamFar: 0.85, // share of the camera's far plane at which farther beacons are drawn, scaled
    beamWiden: 700, // m from the camera beyond which the beam widens, so it stays readable far off
    beamNear: 70, // m from its axis inside which the beam fades (to a quarter), so it never floods the screen
  },
  flock: {
    // Each destination's stray, perched on its lit cairn, joins the flock on arrival. The flock
    // is kept for good and flies with the bird in every level (DESIGN: The flock).
    visible: 12, // most birds flown with at once (more are kept and counted)
    keep: 400, // most birds the save keeps
    aheadMin: 4.5, // m ahead of the bird, nearest slot
    aheadMax: 15, // m ahead, farthest slot (farther, they shrink to specks on a phone)
    sideMin: 1.4, // m either side at the bird
    sideGrow: 0.34, // m more either side per metre ahead (the camera's view widens with distance)
    upMid: -0.2, // m above the bird, on average (a little below: the camera, 1.5 m up, sees their backs)
    upSpread: 2, // m up or down from that
    drift: 1.1, // m each slot wanders, slowly
    stiffness: 2.2, // rad/s of the springs that keep birds in place (they settle in ~2 s)
    stiffnessVar: 0.35, // share by which each bird's spring differs (they never move as one)
    scale: 0.78, // size of a flock bird (its geometry spans 2.3 m: ~1.8 m wingspan)
    clearance: 1.6, // m every bird keeps from the ground and from rock
    flapAfter: 0.7, // s the flock flaps after the bird flaps (each a little late)
    joinFlap: 2.2, // s a bird that just joined flaps as it climbs to its place
    cairnLight: 1.4, // brightness of the cairn's lantern by day (night adds `cairnNight`)
    cairnNight: 1.8,
  },
  hints: {
    // First-flight lessons, each learned by doing it once (saved), so a returning player is
    // never taught again. Steering first: it is the one thing a newcomer must know.
    steerAt: 3.4, // s into a flight before "how to steer" (once "Follow the wisps" has faded)
    steerInput: 0.25, // steering stick magnitude (|x| + |y|) that counts as steering
    steerLearned: 0.8, // s of steering that teaches it (a brush of the screen doesn't)
    boostAt: 9, // s into a flight before "how to boost", only once steering is known
    boostGap: 4, // s after steering was learned before the boost hint (one lesson at a time)
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
    // The late track: about a flight and a half apart, so each of the last worlds gets its own
    // Rest card instead of three arriving together.
    auroraTrail: 2050,
    canyon: 2300,
    gildedPlumage: 2550,
    peaks: 2800,
    atoll: 3050,
    ringmoon: 3300, // the newest level, just before the final bird
    phoenix: 3550, // the final bird, the end of the track (later birds go before it)
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
    goalTurn: 0.6, // rad a generic pattern turns toward a journey's destination, at most
    goalLineUp: 260, // m from a journey's beacon within which every planner flies straight through it
    goalComeBack: 250, // m past a beacon (no wisp through its light) beyond which the ribbon turns back
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
    treeFar: 470, // m, trees beyond this use their distant shapes, if the level has them (0 = never)
    shadows: 1, // 1 = sun shadow map near the bird (on levels with a shadow strength)
    contactShadows: 1, // 1 = soft contact shadows under trees and props
    cloudShadows: 1, // multiplier on each level's drifting cloud shadows (0 = off)
    lightShafts: 1, // multiplier on each level's light shafts (0 = off)
    coverDistance: 80, // m, ground cover (grass, flowers) is drawn within this (0 = off)
    coverDensity: 1, // 0..1 share of the ground-cover tufts kept
    propDistance: 650, // m, a lived-in level's buildings, rocks and bushes are drawn within this
    smallPropDistance: 320, // m, walls, fences, animals, rooftop clutter, flocks (0 = none)
    propDetail: 160, // m, bushes, rocks and domes nearer than this use their detailed shapes
    heroDetail: 260, // m, hero landmarks (karst pillars) whose flank is nearer use their finest mesh
    rockDetail: 1, // 1 = the karst rock shader's flutes and streaks (a recompile when it changes)
    hoodooDetail: 320, // m, Red Canyons' hoodoos nearer than this use their smooth 12-sided shape
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
    treeFar: number;
    shadows: number;
    contactShadows: number;
    cloudShadows: number;
    lightShafts: number;
    coverDistance: number;
    coverDensity: number;
    propDistance: number;
    smallPropDistance: number;
    propDetail: number;
    heroDetail: number;
    hoodooDetail: number;
    rockDetail: number;
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
    treeFar: 0,
    shadows: 0,
    contactShadows: 0,
    cloudShadows: 0,
    lightShafts: 0,
    coverDistance: 0,
    coverDensity: 0,
    propDistance: 280,
    smallPropDistance: 0,
    propDetail: 0,
    heroDetail: 0,
    hoodooDetail: 0,
    rockDetail: 0,
    clouds: 22,
    bloom: false,
    maxPixelRatio: 1,
    particles: 0.4,
  },
  medium: {
    drawDistance: 900,
    treeDistance: 620,
    treeDetail: 200,
    treeFar: 330,
    shadows: 0,
    contactShadows: 1,
    cloudShadows: 1,
    lightShafts: 0,
    coverDistance: 60,
    coverDensity: 0.6,
    propDistance: 480,
    smallPropDistance: 200,
    propDetail: 110,
    heroDetail: 120,
    rockDetail: 1,
    hoodooDetail: 220,
    clouds: 34,
    bloom: true,
    maxPixelRatio: 1.5,
    particles: 0.7,
  },
  high: {
    drawDistance: 1150,
    treeDistance: 820,
    treeDetail: 280,
    treeFar: 470,
    shadows: 1,
    contactShadows: 1,
    cloudShadows: 1,
    lightShafts: 1,
    coverDistance: 80,
    coverDensity: 1,
    propDistance: 650,
    smallPropDistance: 320,
    propDetail: 160,
    heroDetail: 260,
    rockDetail: 1,
    hoodooDetail: 320,
    clouds: 46,
    bloom: true,
    maxPixelRatio: 2,
    particles: 1,
  },
};
