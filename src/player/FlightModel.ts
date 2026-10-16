import { Config } from '../core/Config';
import { clamp, expDecay, smoothstep, springStep, type Spring } from '../core/math';
import {
  advanceTrick,
  createTrickState,
  loopSpeed,
  startTrick,
  type TrickKind,
  type TrickState,
} from './Tricks';

/**
 * Pure arcade glide model. No Three.js, no DOM: state in, state out, so it is unit-tested.
 *
 * The bird always moves along its nose direction at `speed`. Instead of real lift/drag we use
 * an energy-like trade: pitching down converts height into speed and pitching up the reverse,
 * plus a gentle relaxation to cruise speed. On top of that sits `liftVy`, an extra vertical
 * velocity from flaps, thermals, bounces and the soft altitude bounds, which decays over time.
 */
export interface FlightInput {
  steerX: number; // -1..1, +1 = turn right
  steerY: number; // -1..1, +1 = nose up
  flap: boolean; // held
  /** One-shot: a trick gesture this step (see Tricks). */
  trick?: TrickKind | null;
  /** The gesture is still held (extends a roll or a dive-bomb). */
  trickHeld?: boolean;
}

export interface FlightEnv {
  /** Ground height (terrain) at x,z. Water is handled separately via Config.world.waterLevel. */
  groundAt(x: number, z: number): number;
  /** Upward acceleration from thermals at a position (m/s^2). */
  thermalAt(x: number, y: number, z: number): number;
}

export type Contact = 'none' | 'ground' | 'water';

export interface FlightState {
  x: number;
  y: number;
  z: number;
  yaw: number; // heading; forward = (sin yaw, 0, cos yaw)
  pitch: number; // +up
  bank: number; // visual roll, +right wing down
  speed: number;
  liftVy: number;
  pitchSpring: Spring;
  turnSpring: Spring; // x = current yaw rate (rad/s), +left
  bankSpring: Spring;
  flapTimer: number; // cooldown remaining
  /** Seconds since the last flap; Bird uses it to animate the wing beat. */
  sinceFlap: number;
  /** Set during a step: what the bird touched (for SFX/FX). */
  contact: Contact;
  /** Strength (m/s into the surface) of this step's contact. */
  contactStrength: number;
  /** True only on the step a flap fired. */
  flapped: boolean;
  climbBeatTimer: number; // cooldown remaining
  /** Seconds since the last climb wingbeat; Bird animates it like a softer flap. */
  sinceClimbBeat: number;
  /** True only on the step a climb wingbeat fired. */
  climbBeat: boolean;
  trick: TrickState;
  /** Extra pitch from a loop (0..2pi), on top of `pitch`, which stays the gliding pitch. */
  trickPitch: number;
  /** Extra roll from a barrel roll, on top of `bank` (so the camera doesn't follow it). */
  spin: number;
}

export function createFlightState(x = 0, y = 60, z = 0, yaw = 0): FlightState {
  return {
    x,
    y,
    z,
    yaw,
    pitch: 0,
    bank: 0,
    speed: Config.flight.cruiseSpeed,
    liftVy: 0,
    pitchSpring: { x: 0, v: 0 },
    turnSpring: { x: 0, v: 0 },
    bankSpring: { x: 0, v: 0 },
    flapTimer: 0,
    sinceFlap: 99,
    contact: 'none',
    contactStrength: 0,
    flapped: false,
    climbBeatTimer: 0,
    sinceClimbBeat: 99,
    climbBeat: false,
    trick: createTrickState(),
    trickPitch: 0,
    spin: 0,
  };
}

export function surfaceAt(env: FlightEnv, x: number, z: number): number {
  return Math.max(env.groundAt(x, z), Config.world.waterLevel);
}

export function stepFlight(s: FlightState, input: FlightInput, env: FlightEnv, dt: number): void {
  const c = Config.flight;
  const water = Config.world.waterLevel;
  s.flapped = false;
  s.climbBeat = false;
  s.contact = 'none';
  s.contactStrength = 0;
  s.sinceFlap += dt;
  s.sinceClimbBeat += dt;
  advanceTrick(s, input.trickHeld ?? false, env, dt);
  if (input.trick) startTrick(s, input.trick, env);
  const tr = s.trick;
  const looping = tr.kind === 'loop';
  const diving = tr.kind === 'dive';

  // --- Pitch -------------------------------------------------------------------------------
  // Climb authority fades out as speed approaches minSpeed, so holding "up" can never stall the
  // bird: it simply levels off and the nose drifts down until speed recovers.
  const climbAuthority = smoothstep(c.minSpeed, c.minSpeed + 7, s.speed);
  const steerY = clamp(input.steerY, -1, 1);
  let targetPitch = steerY > 0 ? steerY * c.maxClimb * climbAuthority : steerY * c.maxDive;
  if (s.speed < c.minSpeed) targetPitch -= (c.minSpeed - s.speed) * 0.04;
  // A loop carries the nose round in trickPitch; the gliding pitch eases level underneath it.
  // A dive-bomb holds the nose down, then pulls out firmly (terrain assist still applies).
  if (looping) targetPitch = 0;
  else if (diving)
    targetPitch = tr.pulling
      ? Config.tricks.pullPitch * (1 - tr.t / Config.tricks.pullTime)
      : -Config.tricks.divePitch;

  // Terrain assist: sample the surface where we will be shortly and lift the nose if it would
  // put us underground. Forgiving by design; the player should rarely notice it working.
  const fx = Math.sin(s.yaw);
  const fz = Math.cos(s.yaw);
  const ahead = Math.max(1, s.speed * c.terrainLookahead);
  const aheadSurface = Math.max(
    surfaceAt(env, s.x + fx * ahead, s.z + fz * ahead),
    surfaceAt(env, s.x + fx * ahead * 0.5, s.z + fz * ahead * 0.5),
  );
  const shortfall = aheadSurface + c.clearance * 3 - s.y;
  if (shortfall > 0 && !looping) {
    targetPitch = Math.max(
      targetPitch,
      Math.min(c.maxClimb, (shortfall / ahead) * c.terrainAssist),
    );
  }

  // Soft altitude bounds bias the nose too, so the push feels like a gentle hand, not a wall.
  const over = s.y - (water + c.maxAltitude);
  if (over > 0) targetPitch = Math.min(targetPitch, -over * 0.01);

  springStep(s.pitchSpring, targetPitch, c.pitchOmega * (diving ? 1.5 : 1), dt);
  const pitchMin = diving ? -Config.tricks.divePitch - 0.1 : -c.maxDive - 0.1;
  s.pitch = clamp(s.pitchSpring.x, pitchMin, c.maxClimb + 0.1);

  // --- Turning & bank ------------------------------------------------------------------------
  // The yaw *rate* follows the input through a critically damped spring: turns ease in and out
  // with no overshoot, and releasing input naturally levels the wings because bank is derived
  // from the current turn rate.
  // No turning round a loop: yawing while inverted would scramble the circle.
  const steerX = looping ? 0 : clamp(input.steerX, -1, 1);
  springStep(s.turnSpring, -steerX * c.maxTurnRate, c.turnOmega, dt);
  s.yaw += s.turnSpring.x * dt;
  const targetBank = clamp(-s.turnSpring.x * c.bankPerTurn, -c.maxBank, c.maxBank);
  springStep(s.bankSpring, targetBank, c.bankOmega, dt);
  s.bank = s.bankSpring.x;

  // --- Speed ---------------------------------------------------------------------------------
  // dv/dt = -g*sin(pitch) (dive gains, climb loses) + relaxation toward cruise. Nose-down gets a
  // stronger pull and speed above cruise bleeds off slowly, so a dive builds real speed (about
  // 70 m/s flat out vs 26 cruise) and that speed carries through the pull-up into a zoom climb.
  // A dive-bomb pulls harder and may run past the usual top speed.
  const g =
    c.gravityAlongPath *
    (s.pitch < 0 ? c.diveGravity * (diving ? Config.tricks.diveGravity : 1) : 1);
  const top = c.maxSpeed + (diving ? Config.tricks.diveExtraSpeed : 0);
  const relax = s.speed > c.cruiseSpeed ? c.speedRelaxFast : c.speedRelax;
  let accel = -g * Math.sin(s.pitch) + (c.cruiseSpeed - s.speed) * relax;
  if (s.speed > top) accel -= (s.speed - top) * 1.5;
  if (s.speed < c.minSpeed) accel += (c.minSpeed - s.speed) * 2;
  s.speed = looping ? loopSpeed(tr) : Math.max(c.minSpeed * 0.6, s.speed + accel * dt);

  // --- Flap ----------------------------------------------------------------------------------
  // Taper the lift near the ceiling so mashing flap cannot punch through it.
  const ceilingFade = 1 - smoothstep(c.maxAltitude - 30, c.maxAltitude, s.y - water);
  s.flapTimer = Math.max(0, s.flapTimer - dt);
  if (input.flap && s.flapTimer <= 0 && !looping) {
    s.flapTimer = c.flapCooldown;
    s.sinceFlap = 0;
    s.flapped = true;
    s.liftVy = Math.min(s.liftVy + c.flapLift * ceilingFade, c.flapLift * 1.6);
    s.speed = Math.min(s.speed + c.flapBoost, c.maxSpeed + 4);
  }

  // --- Climb wingbeats -----------------------------------------------------------------------
  // Steering up with the nose up, the bird works for its height: steady beats, each a small lift
  // and push, stronger the steeper the climb. Much softer than a flap (which still matters), and
  // skipped right after one so the two never stack into a double beat.
  s.climbBeatTimer = Math.max(0, s.climbBeatTimer - dt);
  if (
    steerY > 0.15 &&
    tr.kind === null &&
    s.pitch > c.climbBeatPitch &&
    s.climbBeatTimer <= 0 &&
    s.sinceFlap > c.flapCooldown
  ) {
    s.climbBeatTimer = c.climbBeatInterval;
    s.sinceClimbBeat = 0;
    s.climbBeat = true;
    const steep = smoothstep(c.climbBeatPitch, c.maxClimb, s.pitch);
    s.liftVy = Math.min(
      s.liftVy + c.climbBeatLift * (0.5 + 0.5 * steep) * ceilingFade,
      c.flapLift * 1.6,
    );
    s.speed += c.climbBeatBoost;
  }

  // --- Vertical extras: thermals and soft bounds ---------------------------------------------
  // Round a loop the circle is the whole motion (its room was checked on entry).
  if (!looping) {
    s.liftVy += env.thermalAt(s.x, s.y, s.z) * dt;
    const minY = water + c.minAltitude;
    if (s.y < minY) s.liftVy += (minY - s.y) * c.boundsPush * 20 * dt;
    if (over > 0) s.liftVy -= over * c.boundsPush * 20 * dt;
  }
  s.liftVy -= s.liftVy * expDecay(c.liftDecay, dt);

  // --- Integrate -----------------------------------------------------------------------------
  const pitch = s.pitch + s.trickPitch;
  const cp = Math.cos(pitch);
  const vy = Math.sin(pitch) * s.speed + s.liftVy;
  // A loop drifts forward so it comes out a little ahead of where it went in; a roll hops
  // sideways (to its own side) by rollHop per turn.
  let along = cp * s.speed;
  let side = 0;
  if (looping) along += Config.tricks.loopDrift * s.speed;
  else if (tr.kind === 'rollL' || tr.kind === 'rollR')
    side = ((tr.kind === 'rollR' ? 1 : -1) * Config.tricks.rollHop * tr.rate) / (Math.PI * 2);
  // Right of the heading is (-cos yaw, 0, sin yaw).
  s.x += (fx * along - fz * side) * dt;
  s.z += (fz * along + fx * side) * dt;
  s.y += vy * dt;

  // --- Soft contact --------------------------------------------------------------------------
  // Never a crash: clamp above the surface, reflect part of the downward velocity as a bounce,
  // nudge the nose up and shave a little speed. The contact flag drives splash/dust FX.
  const ground = env.groundAt(s.x, s.z);
  const floor = Math.max(ground, water) + c.clearance;
  if (s.y < floor) {
    s.contact = ground >= water ? 'ground' : 'water';
    s.contactStrength = Math.max(0, -vy);
    s.y = floor;
    s.liftVy = Math.max(s.liftVy, s.contactStrength * c.bounce + 1.5);
    if (s.pitchSpring.x < 0 && !looping) {
      s.pitchSpring.x *= 0.5;
      s.pitchSpring.v = Math.max(s.pitchSpring.v, 0.8);
    }
    s.speed -= s.speed * c.skimSlowdown * dt * (s.contact === 'ground' ? 1.5 : 1);
  }
}

/** Unit forward vector of the nose, written into `out` (no allocation). */
export function forwardOf(s: FlightState, out: { x: number; y: number; z: number }): void {
  const pitch = s.pitch + s.trickPitch;
  const cp = Math.cos(pitch);
  out.x = Math.sin(s.yaw) * cp;
  out.y = Math.sin(pitch);
  out.z = Math.cos(s.yaw) * cp;
}

/**
 * A push from outside the bird (a reached lantern): a forward surge and some lift. The surge
 * bleeds off through the usual over-maxSpeed drag, and lift shares the flap cap so a gust on
 * top of flaps never launches the bird.
 */
export function gust(s: FlightState, boost: number, lift: number): void {
  const c = Config.flight;
  s.speed = Math.min(s.speed + boost, c.maxSpeed + boost);
  s.liftVy = Math.min(s.liftVy + lift, c.flapLift * 1.6);
}
