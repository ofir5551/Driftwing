import { angleDelta, clamp } from '../src/core/math';
import type { Spawn, World } from '../src/levels/World';
import { createFlightState, stepFlight, type FlightInput } from '../src/player/FlightModel';
import { Wisps } from '../src/world/Wisps';

/**
 * The title-screen bot (Game.autopilotInput's steering) flying a level's ribbons headless for
 * `seconds`, with the level's assist and collisions. Returns wisps gathered, wall contacts
 * (glances) and wisps found inside solids by `inSolid` (sampled twice a second).
 */
export function flyBot(
  world: World,
  spawn: Spawn,
  seed: number,
  seconds: number,
  inSolid: (x: number, y: number, z: number) => boolean,
): { got: number; glances: number; inside: number } {
  const s = createFlightState(spawn.x, spawn.y, spawn.z, spawn.yaw);
  const wisps = new Wisps(
    seed,
    (x, z) => world.wispFloor(x, z),
    () => null,
  );
  wisps.planner = world.planner;
  const env = { groundAt: (x: number, z: number) => world.flightGround(x, z), thermalAt: () => 0 };
  const inp: FlightInput = { steerX: 0, steerY: 0, flap: false };
  let got = 0;
  let glances = 0;
  let touching = false;
  let inside = 0;
  for (let i = 0; i < 60 * seconds; i++) {
    const t = wisps.nextTarget(s.x, s.z, s.yaw);
    if (t) {
      inp.steerX = clamp(-angleDelta(s.yaw, Math.atan2(t.x - s.x, t.z - s.z)) * 2.2, -1, 1);
      inp.steerY = clamp((t.y - s.y) * 0.08, -0.8, 0.8);
    }
    world.assist(s, inp);
    stepFlight(s, inp, env, 1 / 60);
    const hit = world.collide(s) > 0;
    if (hit && !touching) glances++;
    touching = hit;
    wisps.update(1 / 60, s.x, s.y, s.z, s.yaw, () => got++);
    if (i % 30 === 0) for (const v of wisps.list) if (v.alive && inSolid(v.x, v.y, v.z)) inside++;
  }
  world.dispose();
  return { got, glances, inside };
}
