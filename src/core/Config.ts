/**
 * Every tunable lives here. Values are plain mutable numbers so the ?debug panel can edit them
 * live; systems read them each frame instead of caching. Units: metres, seconds, radians.
 */
export const Config = {
  flight: {
    cruiseSpeed: 26, // speed the bird relaxes to in level flight
    minSpeed: 15, // soft floor: below this the nose is gently pushed down, never a stall
    maxSpeed: 58, // soft ceiling: extra drag above it
    speedRelax: 0.35, // 1/s, how quickly speed returns to cruise
    gravityAlongPath: 14, // m/s^2 traded between speed and pitch (dive = faster, climb = slower)
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
    minAltitude: 6, // m above water level the bird is gently pushed back up from
    maxAltitude: 220, // m above water level where a soft ceiling starts
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
    maxFov: 82,
    rollFollow: 0.35, // fraction of the bird's bank the camera adopts
    pitchFollow: 0.4, // fraction of the bird's pitch used to place the camera
  },
  input: {
    mouseDeadZone: 0.06, // fraction of half-screen
    mouseRange: 0.6, // pointer offset (fraction of half-screen) that maps to full input
    touchRadius: 70, // px of drag for full input
    invertY: false,
  },
  world: {
    seed: 1337,
    chunkSize: 160,
    chunkRes: 40, // quads per chunk side
    waterLevel: 0,
  },
};

export type ConfigType = typeof Config;
