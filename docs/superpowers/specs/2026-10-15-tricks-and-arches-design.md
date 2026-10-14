# Tricks and arches

Goal: the controls already feel smooth; give the player deliberate, stylish moves ("cool stuff")
without breaking the pillars (no fail state, calm, painterly).

## Tricks

Triggered by gestures (keyboard and touch are the primary devices):

- Keyboard: double-tap a direction within ~250 ms. Holding after the second tap extends it.
- Touch: a fast flick of the steering finger; keeping the finger down extends it.
- Pad: stick snapped to the edge twice. Mouse: right-click + pointer direction.

| Trick       | Motion                                                    | Hybrid extension                  |
| ----------- | --------------------------------------------------------- | --------------------------------- |
| Barrel roll | 360 deg spin in ~0.6 s with a ~5 m sideways hop           | Keep holding: double/triple roll  |
| Loop        | Vertical circle (pitch sweeps 2 pi), same heading on exit | Radius grows with speed (8-26 m)  |
| Dive-bomb   | Nose ~70 deg down, tucked, extra pull, strong pull-out    | Lasts while down is held (<2.5 s) |

Authored, parameterised curves in a pure `player/Tricks.ts`, layered on `stepFlight` (speed and
integration still run). Never a failure: the loop's speed follows a scripted dip (no stall), the
loop shrinks to fit under the ceiling and clear the ground (or is not started), and a dive-bomb
pulls out early near the surface. Contacts don't end a trick: the soft bounce still applies. Spin is its own field (`spin`), so the chase camera
does not roll with it. During a loop the camera stops orbiting, stays upright and watches the
bird draw the circle, then springs back into chase.

## Arches

Fly-through arches in every level: mossy stone (Highlands, over lakes/low ground), karst arches
over the river (Jade River), ice arches (Fjords, glowing at night), torii gates over avenues
(Neon Bay). Openings ~20-40 m wide, ~22-45 m tall. Pure `world/Arches.ts`: `ArchDef`, crossing
test through the opening, half-ellipse ring soft collision. `World.arches` gives arches near a
point. Some wisp ribbons are bent through arches so players learn them.

## Scoring and feel

- `Progress.trick()` adds flow and points like a few wisps and joins the wisp chain. Repeating
  the last trick halves it, a trick unlike the last two adds 30%, bigger tricks add a little.
- Trick at an arch (active during the crossing, or started ~0.6 s after): x3. Plain pass: about
  one wisp. Tricks do not count toward lanterns.
- Feedback over the event bus (`trick`, `arch`): soft name toast, musical sting in the level's
  voice, brighter wingtip trails, small bursts.
- Discovery: the title-screen bot does tricks; one-time hints; a line in the pause menu.
- Out of scope: trick lists, unlocks, a second meter.
