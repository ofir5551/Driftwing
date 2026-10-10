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
Thermals lift the bird for free.

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
