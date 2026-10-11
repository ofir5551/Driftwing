# Driftwing design

## Pillars

- Flow, not challenge: no fail state, timer or enemies. Every collision is a soft bounce.
- 30 seconds to delight: the first arc of wisps is in view within seconds of pressing Play.
- Painterly calm: soft palettes, fog, gentle bloom, paper grain. No hard outlines or realism.

## Flight

Arcade glide. Constant forward motion; pitch trades speed (dive = faster, climb = slower) with
soft min/max speed. Steering is critically damped; turns bank into the curve and auto-level.
Flap (Space / click / button): gentle lift + speed boost, short cooldown, no stamina.
Soft altitude bounds push back gently. Ground/water contact skims with a puff/splash and a small
slowdown. Chase camera: spring-damped, FOV widens with speed, follows roll slightly, looks ahead.
Thermals lift the bird for free. Soft ceiling at 400 m above water, above the cloud layer.

## Controls

Mouse: pointer offset from centre steers (optional pointer lock). Click/Space flaps.
Keyboard: WASD/arrows steer, Space flap, M mute, P/Esc pause.
Touch: drag relative to touch start steers, on-screen flap button. Gamepad: left stick + A.

## World

Endless chunks from seeded noise: valleys, lakes, instanced low-poly forests, floating islands,
drifting clouds. Day cycle dawn -> day -> golden hour -> dusk drives sky gradient, fog and light.
Post: bloom, paper grain, vignette, colour grade.

## Gameplay

Wisps in arcs/ribbons ahead of the player. Quick chains fill a flow meter (score multiplier,
music intensity) that decays slowly. Every N wisps a lantern lights up with a celebration and the
music modulates. Minimal HUD that fades when idle. Start screen, pause menu (volume, quality,
invert-Y), settings and best score in localStorage.

## Audio

Generative ambient on Web Audio: detuned pads -> lowpass -> synthesized convolution reverb,
sub drone, sparse pentatonic bells on a slow grid. Wisp pickups play the next note of a phrase,
quantized to the grid. Speed opens the filter, altitude shifts voicing, flow adds arp/shimmer.
Key drifts with the day cycle. SFX: flap whoosh, speed-scaled wind, splash. Lookahead scheduler.

## Decisions log

- Three.js WebGLRenderer + `three/examples/jsm` postprocessing (WebGPU is not yet broadly safe on phones).
- Fixed 60 Hz physics step + interpolated rendering so feel is frame-rate independent.
- Playwright (headless Chromium + SwiftShader) for automated screenshots during development.
- Neutral input = level flight (no slow sink). Gliding should never feel like a resource drain;
  flaps and thermals are for climbing and fun, not for staying aloft.
- Climb authority fades near min speed, so "hold up" levels off instead of stalling.
- Terrain assist: the model samples the ground ~1.4 s ahead and lifts the nose to clear it.
- Steering up = climb by default (pointer above centre, W/Up). Invert-Y flips it.
- Chase camera springs its orbit angles and distance, not world position: a world-space spring
  trails by 2v/omega at speed and an offset spring cuts inside turns; polar keeps the bird steady.
- Portrait screens widen FOV and back the camera off.
- Lighting uses MeshToonMaterial with a soft (linearly filtered) 4-step gradient: banded but not cel.
- World streaming: 160 m chunks, two LODs (40 and 14 quads/side, switch at 420 m), built
  nearest-first within a per-frame time budget; LOD swaps keep the old mesh until the new one
  exists. Trees are two global InstancedMeshes refilled from chunk scatter lists on change.
- Forest canopy counts as soft "ground" for flight (bird skims treetops, never clips trunks).
- Clouds: billboarded instanced puffs; wrapping/drift computed in the vertex shader (no CPU).
- Floating islands on a 560 m grid with a soft ellipsoid push-out.
- Water: one camera-following plane, palette tint + fresnel + ripple normals + sun glint. No
  reflections (calm, cheap, painterly).
- Post: half-res bloom (high threshold so only glints/wisps bloom) -> painterly pass (paper
  fibre texture, edge wobble, graded shadows, saturation, vignette) -> OutputPass.
- Bird: stylised low-poly gull. Lathed body (pale belly, warm-grey back via vertex colours),
  arm + hand wings with five separate primaries that fan open when slow and fold in a dive, a
  slightly forked six-feather tail, a head that stays level through banks and looks into turns.
- Wingbeats are cosmetic (`WingBeat`, pure): flap-and-glide bursts of 2-4 beats every 1.4-6 s,
  more often when slow or climbing, none while tucked in a dive. A player flap is one stronger
  stroke on the same oscillator, so bursts and flaps blend without snapping. Strokes start and
  end on the glide pose (sin-shaped, up first); the hand lags the arm and folds on the upstroke.
- Wisps: 56 pooled, laid out as continuous patterns (arc, wave, dive, climb, thermal spiral)
  from a path cursor ahead of the player, ~15 m apart (~0.6 s at cruise). The cursor keeps a
  preferred height above ground: 22 m normally, raised by thermal spirals (24 wisps, ~125 m),
  climbs (+35 m) and re-anchoring at the player's height (up to 240 m; also when the player is
  150 m above or below the path), then sinking 1.5 m per
  wisp so high ribbons read as a long glide down. Rises are capped at 6 m per wisp. Magnet radius 11 m,
  collect radius 3.6 m: near misses count. Missed wisps quietly expire. Wisps shrink as they
  are absorbed so pickups never flash the screen. Gold by day, moonlit cyan at night.
- Flow: +0.03 per pickup plus a chain bonus; ~18 quick pickups fill it; drains 0.05/s after a
  2 s grace. Score multiplier up to 5x. Every 24 wisps (about once a minute for a human) a lantern beacon ignites ~170 m ahead.
- Thermals on a 420 m grid over low ground, 300 m tall; ~13 m/s^2 lift at the core. Spiral wisp patterns
  are placed around them so players learn thermals by following wisps.
- FX: one additive and one alpha particle pool (ring buffers), wingtip ribbons faded near the
  lens, shader-wrapped air motes that stretch into streaks with speed, blob shadow for height.
- Audio: 70 BPM eighth-note grid, 25 ms timer + 150 ms lookahead. Chords change every two bars
  through a pentatonic progression; key/mode per day keyframe (D sus, E maj, A maj, F# min,
  D min pentatonic), applied on chord boundaries so changes are never abrupt. Lanterns modulate
  up a fourth (wrapped to +-6 semitones) with a bell flourish. Wisp notes quantize to the
  sixteenth grid and come from a phrase generator that resolves to the tonic every 8 notes.
- Mix: sub drone kept low (most of its energy moved to the octave) so phones still hear it;
  the context suspends when the tab is hidden; master fades in on unlock.
- Menus: the title screen floats over a live attract flight (bot steering toward wisps), so the
  first frame is already the game. Play is the audio-unlock gesture and continues seamlessly.
  One-time hints: "Follow the wisps" on start; a flap hint only if the player hasn't flapped by 14 s.
- Pause: P/Esc, the touch pause button, losing pointer lock, or hiding the tab. Music ducks.
- Settings (volume, mute, quality, invert-Y) and best score persist in localStorage (guarded).
- Adaptive quality: below ~47 fps for a second, render scale drops 0.1 (floor 0.55); after 6 s
  comfortably fast it creeps back 0.05. In Auto quality, hitting the floor steps the preset down.
  Phones default to Medium. Pixel ratio is capped per preset (max 2).
- Debug-only lil-gui is a dynamic import, so it is a separate chunk players never download.
