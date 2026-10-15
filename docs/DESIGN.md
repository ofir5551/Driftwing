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
Thermals lift the bird for free. Soft ceiling at 400 m above water, above the cloud layer (300 m in Neon Bay, per level).
Holding climb makes the bird beat its wings (a small lift and push every 0.4 s, stronger the
steeper the climb, with a soft whoosh); the flap button stays the big boost. Nose-down pulls
harder (1.35x) and speed above cruise bleeds off slowly, so a full dive reaches ~70 m/s
(cruise 26, top speed 68) with wings fully tucked, and the speed carries into a zoom climb.

## Controls

Mouse: pointer offset from centre steers (optional pointer lock). Click/Space flaps.
Keyboard: WASD/arrows steer, Space flap, M mute, P/Esc pause.
Touch: drag relative to touch start steers; a second finger tapped (or held) anywhere while one steers
flaps (boosts); very quick taps are latched so no step misses them. There is no on-screen flap button:
it covered the view and a second finger works for either hand. Gamepad: left stick + A.
A Controls panel (title and pause screens) lists the controls for the current device.

## World

Endless chunks from seeded noise: valleys, lakes, instanced low-poly forests, floating islands,
drifting clouds. Day cycle dawn -> day -> golden hour -> dusk drives sky gradient, fog and light.
Post: bloom, paper grain, vignette, colour grade.

## Levels

Chosen on the title screen as cards; the attract flight behind the menu switches to the picked
world at once (a short veil hides the rebuild). The pause menu's "Change level" returns to the
title. The pick and a best score per level persist. A level is a `LevelDef` (name, opening time of
day, day length, music keys, sky mountain, ceiling) that creates a `World`: terrain, streamed scenery,
what counts as solid, a steering assist, and hooks for wisp patterns and thermal placement.

- **Highlands**: the original endless landscape (see World).
- **Neon Bay**: an endless Japanese bay city, a Tokyo/Osaka blend, opening at dusk.
- **Jade River**: misty limestone pillars along a jade river (the Li River at Guilin), opening
  at dawn. The quiet one: Highlands is open and bright, Neon Bay buzzes at dusk, Jade River is
  a scroll painting in the morning mist.
- **Aurora Fjords**: deep Norwegian fjords under the northern lights, opening at night. The hushed
  one: vast walls, black water, the sky moving overhead.

## Neon Bay

Plan: 240 m superblocks bounded by 40 m avenues (4 m tree-lined sidewalks), each split into
3x3 blocks by 12 m streets. A bay runs east-west (spawn out on the water facing south, the sun
setting over the skyline), a river meanders through with flat bridges, and a density field that
peaks at a core just inland picks each block: glass towers (podium, tower, setback crown,
antenna, blinking aviation lights), narrow mid-rises with blade signs and rooftop billboards
(more along the river, after Dotonbori), apartment slabs, tiled gable-roof houses with gardens,
parks (cherry, zelkova, pine, ponds, a pavilion), plazas, shrines (torii, approach path, stone
lanterns, haiden and honden with copper or cypress roofs, a grove; sometimes an Inari tunnel of
small torii), temples (gate, main hall, five-storey pagoda), grand wooded shrines and lattice
broadcast towers in their own parks. Avenue crossings keep open corner plazas (a koban or a
tree). Landmarks: a giant torii standing in the bay on the spawn line, elevated expressways
(north-south decks at 15 m, east-west at 23 m) that cross the bay as bridges, and Fuji painted
into the sky dome. Dusk lights the city: a hashed share of windows, shop fronts, neon, lanterns
and lamp pools on the avenues. Music: night-neon lo-fi at 78 BPM, koto plucks over a mellow
keys pad and a soft swung beat, in a drier room; yo pentatonic by day, hirajoshi after dusk.

Flight among buildings: walls are solid but soft. A look-ahead (about a second) climbs over a
roof within reach, dips under a deck or beam, or veers to the more open side of a tall wall; on
contact the bird glances off, turning along the wall and losing a little speed. Wisps run down
the avenues at street-canyon height, turning a quarter at crossings, circle towers, or glide
over the roofs; the opening ribbon goes through the torii and up the spawn avenue.

## Jade River

Mood: still, contemplative, ink-wash. Muted colour (the post saturation is scaled to 0.82 and
the level paints its own palettes: paper-pale mist, jade water), with a few warm accents: red
pavilions and lanterns, the wisps' gold.

Plan: rivers run along the zero contour of a low-frequency noise (distance = |n| / |grad n|),
40-90 m wide, endless in every direction; spawn is on the river through the origin, facing
along it. Limestone pillars stand on a 72 m jittered grid (up to two per cell, density from a
clustering noise, giants in the dense clusters), never within reach of a river. Five
silhouettes (sugarloaf, dome, needle, leaning, pot-bellied) are lathed from one radius profile
(flared foot, belly, narrowing neck, round summit dome, lean) that the collisions use as well.
Each has fluted rock with dark rain streaks, moss on ledges, pines on the crown, shrubs on the
walls and a scree mound in the terrain; some summits carry a red pavilion. The valley floor has
terraced paddies (flooded, young, ripening), bamboo along the banks, broadleaf groves,
whitewashed villages with dark gable roofs, and cormorant fishers' rafts on the water.

Atmosphere: a valley mist (shared uniforms, patched into the level's toon materials and the
water shader) lies below ~55 m, drifts in slow banks, clears near the bird and thickens with
distance; it is thickest at dawn and thins by midday. A distance haze fades far pillars in
layers. Low billboard mist banks drift between the pillars. Three rings of karst peaks are
painted round the horizon in the sky dome, each layer a deeper wash with mist at its foot.
Lanterns (houses, rafts, pavilions) are red paper by day and glow (HDR, bloomed) after dark.
Music is a sparse guqin at 56 BPM: notes slide up into pitch and bloom a slow vibrato, with
falling grace notes, over a sine pad, a root-and-fifth drone and deep reverb, no arpeggio. It
walks the Chinese modes: shang at dawn, gong by day, zhi at golden hour, jue at dusk, yu at night.

Flight: pillars are solid but soft, flown with the city's look-ahead and wall glance; the
summit dome pushes up (skim it), the walls push straight out from the axis. Wisps: the river
is the spine (low ribbons following its bends); slaloms weave between pillars (of the clear
candidates, the one passing most rock wins); now and then a spiral climbs the last ~100 m of a
tall pillar and crosses its summit. Every pattern is checked 9 m clear of rock and ground, and
a slowly updated trend heading keeps the ribbon from doubling back.

## Aurora Fjords

Mood: hushed, vast, starlit. The first level to open at night: a deep blue polar night (never
black) with the aurora overhead, lingering (the day runs at half speed) before a low winter sun
turns the snow pink at dawn and gold in the afternoon. Cold palette with a few warm accents: red
huts, lamplit windows, the lighthouse.

Plan: fjords run along the zero contour of a low-frequency noise (as Jade River's rivers),
120-240 m wide, endless in every direction; spawn is mid-fjord through the origin, facing along
it. From the water: a deep bed, a pebble strand up to ~38 m wide (from a noise), then a glacial
wall that is steep at its foot and rounds over at the lip (1 - (1 - t)^2.2 over 150 m) onto a
plateau of ~100-200 m that throws up ridged peaks away from the walls. Ridged noise scores the
walls into buttresses and gullies. Spruce (snow-tipped, ~40 triangles) stand on the strands
and lower walls under a treeline; red rorbu huts on stilts line the strand in hamlets, facing
the water; pans of sea ice and icebergs (a jagged faceted lump, tabular or peaked) drift on the
open water. A lighthouse stands on the shore ~260 m down the fjord from the spawn.

Atmosphere: the aurora is three curtains painted into the sky dome, each with a folded,
wandering hem, fine rays bunching and thinning along it, green at the hem fading to violet
above, swelling and thinning along its length and drifting slowly; it comes out with the stars
and bloom halos it. A low sea smoke (the shared mist shader) lies on the water, thickest at
night, and a distance haze layers the far walls. After dark hut windows glow and the
lighthouse sweeps a beam (two additive cones fading along their length). Music: glassy,
celesta-like bells at 62 BPM over a hardanger-style open-fifth drone, a slow high music-box
arpeggio and the largest reverb; suspended at dawn, major by day, dorian at golden hour and
under the aurora, minor at dusk.

Flight: the walls are terrain, not props. `solidTop` reports terrain above the strand as solid,
so the city's look-ahead veers along the fjord before a wall (or climbs if the lip is within
reach); a bird that still touches a steep slope (gradient > 0.9) glances off it downhill.
Icebergs are soft ground (skimmed); the lighthouse is solid. Wisps: the fjord is the spine (low
ribbons following its bends and swinging across the channel), glides carry on over the plateau,
and generic patterns run only far out on the plateau.

## Gameplay

Wisps in arcs/ribbons ahead of the player. Quick chains fill a flow meter (score multiplier,
music intensity) that decays slowly. Every N wisps a lantern lights up with a celebration and the
music modulates. Minimal HUD that fades when idle. Start screen, pause menu (volume, quality,
invert-Y), settings and best score in localStorage.

## Audio

Generative ambient on Web Audio: detuned pads -> lowpass -> synthesized convolution reverb,
sub drone, sparse pentatonic bells on a slow grid. Wisp pickups play the next note of a phrase,
quantized to the grid. Speed opens the filter, altitude shifts voicing, flow adds arp/shimmer.
Key drifts with the day cycle. Each level has a `MusicStyle` (`audio/styles.ts`): keys, tempo,
progression, voice (bell, koto, guqin, glass), pad, drone fifth, reverb, arpeggio, beat. SFX: flap whoosh, speed-scaled wind, splash. Lookahead scheduler.

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
- Bird: stylised tern-like seabird. One lathed body from tail to neck (flat back, fuller belly,
  pinched neck) so it doesn't read as stacked blobs; a stretched head with a dark cap sloping from
  bill to nape, eye under the cap edge, a long orange bill. Arm + hand wings with five separate primaries that fan open when slow and fold in a dive, a
  slightly forked six-feather tail, a head that stays level through banks and looks into turns.
- Wingbeats are cosmetic (`WingBeat`, pure): flap-and-glide bursts of 2-4 beats every 1.4-6 s,
  more often when slow, none while tucked in a dive. Player flaps and climb beats are strokes
  fired by the flight model on the same oscillator, so bursts and flaps blend without snapping. Strokes start and
  end on the glide pose (sin-shaped, up first); the hand lags the arm and folds on the upstroke.
- Wisps: 56 pooled, laid out as continuous patterns (arc, wave, dive, climb, thermal spiral)
  from a path cursor ahead of the player, ~15 m apart (~0.6 s at cruise). The cursor keeps a
  preferred height above ground: 22 m normally, raised by thermal spirals (24 wisps, ~125 m),
  climbs (+35 m) and re-anchoring at the player's height (up to 240 m; also when the player is
  150 m above or below the path), then sinking 1.5 m per wisp so high ribbons read as a long
  glide down. Rises are capped at 6 m per wisp. Magnet radius 11 m, collect radius 3.6 m: near misses count. Missed wisps quietly expire. Wisps shrink as they
  are absorbed so pickups never flash the screen. Gold by day, moonlit cyan at night.
- Flow: +0.03 per pickup plus a chain bonus; ~18 quick pickups fill it; drains 0.05/s after a
  2 s grace. Score multiplier up to 5x. Every 24 wisps (about once a minute for a human) a lantern beacon ignites ~170 m ahead.
- Thermals on a 420 m grid over low ground, 300 m tall; ~13 m/s^2 lift at the core. Spiral wisp patterns
  are placed around them so players learn thermals by following wisps.
- FX: one additive and one alpha particle pool (ring buffers), wingtip ribbons faded near the
  lens, shader-wrapped air motes that stretch into streaks with speed, blob shadow for height.
- Audio: eighth-note grid (70 BPM in the Highlands), 25 ms timer + 150 ms lookahead. Chords change every two bars
  through a pentatonic progression; key/mode per day keyframe (D sus, E maj, A maj, F# min,
  D min pentatonic), applied on chord boundaries so changes are never abrupt. Lanterns modulate
  up a fourth (wrapped to +-6 semitones) with a bell flourish. Wisp notes quantize to the
  sixteenth grid and come from a phrase generator that resolves to the tonic every 8 notes.
- Level music is a style, not a key table: changing only key and mode made every level the same
  piece. A level switch lands on the next chord boundary; the new tempo takes effect from the
  next step (the scheduler's step length changes inside its own callback), so nothing jumps.
- Mix: sub drone kept low (most of its energy moved to the octave) so phones still hear it;
  the context suspends when the tab is hidden; master fades in on unlock.
- Menus: the title screen floats over a live attract flight (bot steering toward wisps), so the
  first frame is already the game. Play is the audio-unlock gesture and continues seamlessly.
  One-time hints: "Follow the wisps" on start, then (touch only) "Tap with a second finger to boost";
  a flap hint only if the player hasn't flapped by 14 s.
- Pause: P/Esc, the touch pause button, losing pointer lock, or hiding the tab. Music ducks.
- Settings (volume, mute, quality, invert-Y) and best score persist in localStorage (guarded).
- Adaptive quality: below ~47 fps for a second, render scale drops 0.1 (floor 0.55); after 6 s
  comfortably fast it creeps back 0.05. In Auto quality, hitting the floor steps the preset down.
  Phones default to Medium. Pixel ratio is capped per preset (max 2).
- Debug-only lil-gui is a dynamic import, so it is a separate chunk players never download.
- Levels swap in place (dispose the old world, build the new one at its spawn, reset time of day)
  rather than reloading the page: audio stays unlocked and the title backdrop changes live.
- The city layout is one pure, seeded function (no Three.js): superblocks are generated on demand
  into parts (mesh, position, size, yaw, colour, style), trees and solid boxes, cached, and shared
  by the renderer, collisions and wisp planning. Unit-tested in Node.
- City rendering: six global instanced meshes (box, cylinder, gable, hip and ridge roofs, lattice)
  plus three tree shapes, refilled from live chunks when the chunk set changes. One toon material
  with a facade pass keyed by a per-instance style: window grids in world metres from the face
  normal (any box gets correctly sized floors), faded to their average at a distance; lit windows,
  neon, lanterns and aviation lights emit after dark (neon and beacons in HDR for bloom). The
  street grid is regular, so the ground shader draws asphalt, sidewalks, lane lines, crossings and
  lamp pools analytically from world position; a vertex attribute turns streets off in parks.
- City collisions: boxes bucketed per superblock on an 8x8 grid (covering 24 m around it, since
  avenue structures straddle edges), so a point query checks one cell. The push leaves through the
  nearest face (undersides only for floating decks and beams). A wall contact kicks the turn rate
  (a released critically damped spring turns 2r/omega in total) instead of snapping the heading.
- City wisps are planned as a whole polyline and only spawned if every segment is clear of solids
  (3.5 m margin). Avenue runs try canyon height, then low (9.5 m, under both deck levels, beside the
  pillars) and high (32 m). Turns are 40 m arcs that stay inside the crossing and its corner plazas
  even when cut, and go toward the ribbon's overall heading so it never doubles back. Runs follow
  on from the last wisp with no gap (an unchecked gap could cross a tower).
- Levels may paint their own day palettes (same phases and names as the default, so the
  time-of-day picker still works), scale the post saturation and pick a sky backdrop
  (none, Fuji, karst ridges).
- Jade River pillars use a detailed mesh within 480 m and a coarse one beyond (chosen when the
  chunk set changes); bamboo clumps are ~50 triangles. A frame is ~550k triangles at High
  (Highlands ~200k). Pillar queries scan the grid cells within reach; cells are cached.
- Wisps (all levels): the autopilot follows the ribbon in spawn order with a carrot ~24 m ahead
  (pure pursuit) instead of the nearest wisp; the path re-anchors only when it is behind the bird
  or the bird has left it (no wisp ahead in reach), not merely when it runs far ahead; no pattern
  is laid while the pool is nearly full or the path end is 600 m+ away (they would expire on
  spawn and the path would run away). In a 10 minute headless flight per seed the city bot
  gathers ~1.6 wisps/s and glances off a wall 0-6 times.
- Aurora Fjords' walls are terrain, not solids: a height field can't overhang and the flight model
  already floors the bird on it. The look-ahead reads terrain above the strand as solid (no
  underside), and a ground contact on a steep slope glances off downhill, so a wall is a turn,
  not a climb.
- Fjord wisps never hand over to the generic patterns near a wall: those lift a path straight up
  a slope steeper than any bird can climb (the bot ground up a wall at minimum speed). Hemmed in
  at a bend or a fjord's head, the planner follows the water either way or wheels round instead.
- The aurora is painted in the sky dome (no geometry): every azimuth frequency is a whole number
  so the curtains close round the sky without a seam.
- Title-screen level cards are a 2x2 grid: four in a row squeezed the names onto two lines.
