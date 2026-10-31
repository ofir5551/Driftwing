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
Touch: drag relative to touch start steers; a second finger tapped (or held) anywhere while one
steers flaps (boosts); very quick taps are latched so no step misses them. There is no on-screen
flap button: it covered the view and a second finger works for either hand. A Steering setting
(pause menu, touch only) swaps that for on-screen buttons plus a Boost button (held = keep
flapping): a D-pad, eight-way at the bottom left (rest between two arrows for a diagonal, slide
round without lifting), or Side arrows, a compact cluster under each thumb: a tall turn button at
the edge (left on the left, right on the right) with up and down stacked just inside it, so each is
a short nudge away. Up and down are on both sides so two thumbs reach every diagonal; a thumb slides
between its buttons (the nearest one is pressed). Boost sits above the right cluster. Or Split: a
D-pad under each thumb, the left one without a right arrow and the right one without a left, both
climbing and diving. One pad works at a time: while one is held the other ignores touches and fades,
so the turns never mix. Boost sits above the right pad. Either way, double-tap an arrow for a trick,
as on the keyboard. Drag stays the default. Gamepad: left stick + A.
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
- **City of Gold**: Jerusalem's walled Old City on its hills, opening in the golden hour. The warm
  one: ancient stone that glows, a sense of arrival, swooping over roofs and down valleys.
- **Red Canyons**: red sandstone canyons, arches and mesas (the Colorado Plateau), opening in the
  midday glare. The free one: wide open sky, speed down a canyon, threading stone arches.

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

## City of Gold

Mood: warm, timeless, a little reverent; the feeling of arriving at a holy city. Golden
limestone everywhere, softened by dust and distance; a few vivid accents: the gilded dome and
its blue tiles, lead-grey church domes, cypress green, the red earth of the terraces. It opens in
a lingering golden hour (the day runs at 1.4x), the sun at the bird's back.

Plan: the land round the origin is designed, after the real city (+z is north, -x is east, so it
reads like a map). The Old City is an irregular hexagon of walls about 640 m across on a plateau
that falls gently to the south-east; the Temple Mount is a raised, paved platform in its
south-east corner with the Dome of the Rock (marble and blue-tiled octagon, tiled drum, gilded
pointed dome on a dais), the Dome of the Chain, Al-Aqsa with its silver dome, square and round
minarets; the Western Wall faces an open plaza. The quarters are packed with stone houses on an
11 m jittered grid (flat roofs a storey or two up, a third with small domes, water heaters,
rooftop rooms, courtyards with a tree), split by David Street and the Cardo; the Holy
Sepulchre's grey domes, the Redeemer's tower, the Hurva's white dome and the Citadel with the
Tower of David's minaret rise out of them. The walls are crenellated pieces with a square tower
every ~46 m and gatehouses with dark arches (Damascus, Jaffa, Zion, Dung, Lions, Herod's, New),
and the sealed, double-domed Golden Gate. The Kidron runs under the east wall and the Hinnom wraps
round the west and south (valley floors as polylines); the Mount of Olives rises beyond the
Kidron with its cemetery of pale slabs, Gethsemane's grove and the Church of All Nations, Mary
Magdalene's gold onion domes, the Russian belfry and Augusta Victoria's tower; Mount Zion carries
the Dormition Abbey; the new city spreads over the western hills (the Montefiore windmill, a
grand hotel, the YMCA tower). Past ~1.3 km the designed land blends into endless Judean hills:
rounded ridges cut by wadis (the zero contours of a noise, as Jade River's rivers), terraced
olive orchards with dry-stone risers, Aleppo pine forest, and hill towns that crown the ridges
(flats with rooftop water heaters, domed village houses, red-roofed houses, square to the slope
so rows step down the hillside; now and then a minaret or bell tower).

Stone: one instanced material (boxes, domes, onion domes, drums, spires, octagons, merlons,
arches, water heaters, tile roofs) with a style per instance: ashlar courses laid in world
metres (so neighbouring pieces line up), small arched windows on houses and rows of them on
flats (lit warmly after dark), floodlight from the foot of walls and landmarks after dark (the
amber glow of the real walls at night), gold leaf with a sun glint and an HDR glow at night,
lead with a dull sheen, glazed tile. The valley mist pools in the Kidron at dawn and burns off;
a distance haze layers the hills; three washes of rolling hills are painted round the horizon.

Flight: low roofs (the Old City's fabric, the towns) and treetops are soft ground the bird skims;
walls, gatehouses, towers, domes, minarets and landmarks are solid, flown with the city's
look-ahead and wall glance. Music: an oud (two saws a few cents apart through a fast-closing
lowpass, settling from a touch sharp as on a fretless neck, with the odd risha tremolo) at 66
BPM over a sine pad and an open-fifth drone, qanun-like ripples with flow, maqsum on a frame
drum; nahawand at dawn and dusk, major pentatonic by day, hijaz in the golden hour and at night.

Wisps: the opening ribbon glides down off the Mount of Olives across the Kidron, over the east
wall, swings round the golden dome and runs low along David Street to Jaffa Gate. Then: swoops
that hug the land (12 m over roofs, 16 m elsewhere), weaving gently either side of a slowly
turning trend; runs along the Kidron, the Hinnom and the wadis; climbing swings round a minaret,
a tower or a dome.

## Red Canyons

Mood: free, fast, sunlit. The first level to open in the middle of the day: a hot white sun high
in a deep blue sky, with the red rock bouncing warm light into every shadow (the palette's ground
light is rust by day). The day runs at 1.2x toward a blazing orange sunset, a violet dusk and a
clear, starry desert night under a cool moon. Warm palette with two cool accents: the green river
with its cottonwoods, and the sky.

Plan: canyons run along the zero contour of a low-frequency noise (as the fjords), a canyon every
~800 m; spawn is mid-canyon through the origin, facing along it. From the middle: a green river
9-16 m either side of the centre line, a sandy floor rising gently to the wall's foot (38-82 m
from the centre), then a wall of four rock bands, each a cliff over a bench, at uneven heights,
up to a rim ~125 m above the river, over a 120 m run. The band profile is read at a distance
shifted by noise, so the ledges meander while the strata stay level. Beyond the rim the plateau
swells gently and throws up flat-topped mesas (a talus skirt, sheer walls, now and then a butte
stepped on top) away from the canyons. The ground is painted in level bands of deep red, rust,
orange and pale sandstone with desert varnish streaking the steepest faces and cream caprock on
the mesa tops. Cottonwoods line the river, sagebrush and juniper scatter the floors and plateau,
and banded hoodoos with darker cap stones crowd the rims and the wider benches.

Arches: one shape for all of them, a band between two half ellipses (the opening, and the back
1.3x as wide and 1.24x as high) with legs running into the ground, scaled per arch. The Great
Arch (46 m half span, 62 m rise) stands across the floor ~330 m down the canyon from the spawn,
where the floor opens out to hold its legs; smaller ones stand across straight reaches of the
canyons (one in a 420 m grid cell at most, snapped to the centre line), and fins with a window
through them stand on level ground out on the plateau. Painted mesas and buttes ring the horizon
in three washes of the rock's shade.

Atmosphere: a dust haze layers the far rims and mesas all day; a little mist lies in the canyons
at first light and burns off by mid-morning. Music: a desert guitar (a saw and a square an octave
apart through a slowly closing lowpass, picked up into pitch from a quarter tone flat, a slow
vibrato blooming on long notes) at 84 BPM over a triangle pad and an open-fifth drone, a galloping
arpeggio with flow and a long canyon echo; suspended at dawn, a wide major by day, a mixolydian
twang at sunset, minor at dusk and under the stars.

Flight: the walls and mesas are terrain, not props (as in the fjords): the look-ahead veers along
the canyon before a wall and a steep slope glances the bird off downhill. Arches and hoodoos are
solid: under a span the look-ahead eases the nose down through the opening, over the back it
climbs, and a touch pushes the bird the shortest way out (over the back, under the span, off a
leg or a face). Wisps: the canyon is the spine (low ribbons following its bends and swinging
across the floor); near an arch a ribbon pulls to the middle and to 0.42 of the opening's height
so it threads it, the Great Arch first. Glides carry on over the rims and the plateau, and
generic patterns run only far out in the desert.

## Gameplay

Wisps in arcs/ribbons ahead of the player. Quick chains fill a flow meter (score multiplier,
music intensity) that decays slowly. Every N wisps a lantern lights up with a celebration and the
music modulates. A lit lantern is an optional destination: flying through its light refills
flow, pays a bonus and gives a surge of speed and lift. Minimal HUD that fades when idle. Start screen, pause menu (volume, quality,
invert-Y), settings and best score in localStorage.

## Progression (proposed)

Status: steps 1-2 of the build order are built (light, the track, saving, journey bars, unlock
notices, the Rest card); the rest is design. Goal: every short flight (2-10 min) moves something
forward and lasts beyond the session, while staying strictly calm: nothing decays, nothing can
be lost or missed, there are no streaks, timers or daily rewards, and the score stays as it is.

### Light

One lifetime total, shown with its own glyph ✧ (the lantern ✦ stays the HUD's lantern count).
It only grows.

- A wisp gives 1, a reached lantern 10, a landed trick 2. A lantern lighting by itself (every 24
  wisps) gives nothing: flying to it is the choice being rewarded.
- Light ignores flow. Score (with its 5x multiplier) stays the skill number; light is the
  "time well spent" number, so a relaxed flight never earns less than its wisps.
- Earned only in `playing` mode: never by the attract flight or `?autopilot`.
- Banked to storage on pause, Rest, level change, `visibilitychange` (hidden), `pagehide` and
  every 10 s in flight, so closing the tab loses at most a few seconds.
- Pacing ("moderate"): a human gathers ~24 wisps/min and reaches a lantern most minutes, so
  ~30 light/min, ~180 for a 6-minute flight. A new level about every 2-3 flights, and the whole
  track in about a week of casual play (two or three flights a day).

### The journey track

Milestones on one path. Levels, plumages, trails and species are spaced out so the next thing is
always close.

|    ✧ | Unlock                                         | Flight (~180 ✧ each) |
| ---: | ---------------------------------------------- | -------------------: |
|    0 | Highlands, the Tern, Sea plumage, Breeze trail |                start |
|  120 | Ember trail                                    |                    1 |
|  300 | **Neon Bay**                                   |                    2 |
|  480 | Dusk Rose plumage                              |                    3 |
|  750 | **Jade River**                                 |                  4-5 |
|  950 | Jade Mist trail                                |                  5-6 |
| 1150 | **Swallow**                                    |                  6-7 |
| 1250 | **Aurora Fjords**                              |                    7 |
| 1500 | Frost plumage                                  |                  8-9 |
| 1800 | **City of Gold**                               |                   10 |
| 2050 | Aurora trail                                   |                11-12 |
| 2400 | **Red Canyons**                                |                13-14 |
| 2700 | Gilded plumage                                 |                   15 |
| 3000 | **Crane**                                      |                16-17 |

Beyond 3000, light keeps counting on the title screen (an open question: maybe a rare plumage
every 1000).

- The track's thresholds are `Config.unlocks` (one number per milestone id, so the debug panel
  retunes them); the light per event is `Config.journey`; names and kinds live in `Journey.ts`. Unlocks are worked out from light, plus a `granted` list written whenever something
  unlocks, so a later retune can grant things but never take them back.
- Existing players: any level with a saved best score above 0 counts as unlocked from the first
  run, so nobody loses a world they already fly.
- `?level=` still opens any level (for development) but does not unlock it. `?journey=N` sets
  light for testing.

### In flight and the Rest card

- Crossing a milestone mid-flight shows a quiet HUD notice ("✧ Ember trail unlocked", a cooler
  glow than hints) and three soft high notes a bar later (so they never land on a lantern's
  chord). Notices queue behind any toast on screen instead of replacing it, wait out a pause,
  and never show on the title. Nothing pauses and nothing has to be acknowledged.
- The pause menu gets a journey bar (✧ total, "+N this flight", the next milestone, a fill toward
  it) and a **Rest** button. Rest ends the flight: the game drops back to the menu mode, so the
  bot takes the bird on and it keeps gliding behind the card. The card names the level and the
  flight's length, tallies wisps, lanterns reached, tricks and points ("A new best" or the best),
  then fills the journey bar from where the flight began, counting the light up. Each milestone
  this flight crossed fills the bar to the end, raises its card (kind, name, and the level's
  blurb or a line for feathers, trails and birds) and starts the next segment. Unlocks from
  earlier flights that never had a card (the tab closed, or back to the title) appear at once:
  the save keeps a `revealed` list, so each card is shown once. Granted levels and quiet retunes
  never get one, nor do saves from before cards existed. Buttons: **Keep flying** (a new flight
  from where the bird is) and **Title**. Any toast or waiting notice is cleared (the card says
  it). The card is optional: pausing and closing the tab still bank everything.
- Hints ("Follow the wisps", how to boost) are once per visit: a second flight needs none.
- The title screen shows the same journey bar under the level cards.

### Level locks

Locked level cards stay visible but dimmed, with their name and "Opens at 750 ✧" in place of the
blurb, so the next world is something to look forward to, not hidden. They can't be selected.
The attract flight behind the title only flies unlocked levels.

### Aviary (bird cosmetics)

A title-screen panel (like Controls) with three rows: **Species**, **Plumage**, **Trail**. Locked
items show as soft silhouettes with their threshold. Picking one dresses the attract-flight bird
behind the menu at once: that bird is the live preview, so no second renderer is needed. Choices
persist.

- **Plumage** is a palette of colour roles (belly, back, cap, wing lead / trail, covert, dusky
  edge, underwing, bill, primary base / mid / tip, tail base / tip): today's constants at the top
  of `Bird.ts`, gathered into a `Plumage` record. Vertex colours are baked when the bird is
  built, so changing plumage rebuilds the colour attributes (menu-time, not a hot path). Every
  species has its own signature plumage, plus the shared set (Sea, Dusk Rose, Frost, Gilded),
  which reads through the same roles. Plumages are checked against all six levels at dawn,
  midday and night, so the bird never vanishes into a palette.
- **Trails** set the wingtip ribbon colour and opacity curve (`Trails` already takes a colour
  per update): Breeze (today's white), Ember, Jade Mist, Aurora (hue drifting along the ribbon).
  Wisps, lanterns and pickup particles never change colour: they are gameplay and must read the
  same everywhere.

### Species

Three birds: the **Tern** (today's bird, the all-rounder), the **Swallow** and the **Crane**.
Each flies slightly differently. Each is a trade-off, none is strictly better, and every
change stays within ±15 % so the wisp planner's assumptions (15 m spacing, ≤6 m rise per wisp)
hold for all of them.

- **Swallow**: quick and darting. Small and compact, long swept-back pointed wings, a deep
  forked tail with streamers; glossy blue-black back, rust throat, cream belly. Flight: turn
  response ×1.2, flap cooldown ×0.85, flap lift ×0.9, speed above cruise bleeds ×1.15 faster
  (agile, but a dive doesn't carry as far). Camera a little closer.
- **Crane**: slow and stately. Long neck held straight out, legs trailing past a short tail,
  long broad wings whose five primaries spread like fingers (the existing primary fan suits
  this); pale grey with a black neck and wingtips and a red crown. Flight: turn response ×0.85,
  flap lift ×1.15, flap cooldown ×1.2, speed above cruise bleeds ×0.8 (long glides, dives carry
  far). Wingbeats slower and deeper. Camera farther back.
- A species is a `SpeciesDef`: a geometry spec (body, neck, head, wing arm / hand, primaries,
  tail, legs), a default plumage, `WingBeat` timing, flight multipliers applied over
  `Config.flight`, and camera distance. All species share one rig (body, arm, hand, primaries,
  tail, head joints), so the existing pose and wingbeat code drives every bird. The first step
  of this work is turning `Bird.ts` into that rig with the Tern as its first spec, kept
  identical to today (screenshot compare) before any new bird is added.

### Save format

`driftwing:journey` = `{ v: 1, light, granted: string[], revealed: string[], species, plumage,
trail }`, loaded with the same guards as settings (bad or missing fields fall back to defaults;
storage errors mean no progress is saved, never a crash). `revealed` makes each unlock card show
once.

### Code shape

- `core/Journey.ts` (pure, Vitest): the track, light for events, `bank(state, delta)` returning
  newly unlocked items, `nextMilestone(light)`, `isUnlocked(state, id)`.
- `main.ts` wires the events (`wisp`, `lanternReached`, `trick`) into the journey while
  `playing`, and banks at the points listed above.
- `ui/Menu.ts`: journey bar, locked cards, Rest card, Aviary panel. `ui/Hud.ts`: unlock toast.
- `player/species/` (`tern`, `swallow`, `crane`) + the shared rig in `Bird.ts`;
  `player/Plumage.ts` for the palettes.

### Build order

1. Light + journey core + banking + journey bar (title, pause) + unlock toast.
2. Rest card.
3. Level locks.
4. Plumage roles + trails + Aviary panel (Tern only).
5. Bird rig refactor (Tern unchanged), then the Swallow with its flight multipliers.
6. The Crane.

## Audio

Generative ambient on Web Audio: detuned pads -> lowpass -> synthesized convolution reverb,
sub drone, sparse pentatonic bells on a slow grid. Wisp pickups play the next note of a phrase,
quantized to the grid. Speed opens the filter, altitude shifts voicing, flow adds arp/shimmer.
Key drifts with the day cycle. Each level has a `MusicStyle` (`audio/styles.ts`): keys, tempo,
progression, voice (bell, koto, guqin, glass, oud, guitar), pad, drone fifth, reverb, arpeggio, beat. SFX: flap whoosh, speed-scaled wind, splash. Lookahead scheduler.

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
- Lanterns are destinations, not decoration, but never pressure: no timer, no fade, nothing lost
  by ignoring one. Reaching one (anywhere in its column, 16 m radius, any height above the orb)
  fills flow, pays 20 base points at the full 5x, and gusts the bird (+9 m/s, +6 m/s lift, sharing
  the flap's lift cap). Waiting lanterns have a wide breathing beam and sparks rising at the reach
  radius; reached ones flare, then settle to a narrow calm column. The HUD's ✦ counts lanterns
  reached; a rolled bell chord answers the lighting's flourish. The autopilot heads for one within
  400 m, so `?autopilot` exercises it.
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
  One-time hints: "Follow the wisps" on start, then (touch drag only) "Tap with a second finger to boost";
  a flap hint only if the player hasn't flapped by 14 s.
- Pause: P/Esc, the touch pause button, losing pointer lock, or hiding the tab. Music ducks.
- Settings (volume, mute, quality, invert-Y, touch steering) and best score persist in localStorage (guarded).
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
- Painted ground detail (`GroundDetail`): a fragment-shader patch over the terrain's vertex
  colours (Highlands, Jade River, Aurora Fjords, City of Gold, the floating islands and the
  karst pillars):
  broad warm/cool paint patches, brush strokes on gentle ground, rock strata on steep ground and
  small bumps tilted into the normal so the toon bands break into dabs. All from world position,
  so it costs no vertices and never seams; the near detail fades out by `ground.detailFar`. Neon
  Bay keeps its own street shader.
- Tree LOD: every tree shape has a cheap far version (now top-lit: darker underside, sunlit
  crown, no extra triangles) and most have a detailed near one (broadleaf ~220 tris of lumpy
  lobes on a forked trunk, drooping five-tier pine, snow-shouldered spruce, arching bamboo;
  in City of Gold a lean ~110-tri olive for its dense groves, cypress, Aleppo pine, palm).
  Trees within `render.treeDetail` (0 / 200 / 280 m for low / medium / high) use the near shape,
  chosen when the chunk set changes. High-preset frames grew ~20% in the Highlands (220k ->
  265k triangles) and under 10% elsewhere.
- Tree crowns sway in the vertex shader (height squared, phase from position): no CPU cost.
- Bird plumage: grey mantle and upperwing over a white body, a lighter covert layer with its
  own scalloped edge, a dusky trailing edge, feathers with a raised pale shaft, a dark-tipped
  bill, and a pale underwing (front faces of the wing panels are the undersides).
- City of Gold opens on the Mount of Olives, the real postcard view: from the west the walls hid
  the city entirely. Levels may turn the sun's path (`sunTurn`); here it rides behind the Mount of
  Olives so the Old City is lit, not backlit, from the spawn.
- City of Gold's low roofs are a smooth canopy (soft ground), not solids: flying low over the
  Old City is skimming its roofscape, and the walls and towers are the only things to steer
  round. Houses are only placed where the canopy is full, and never taller than it.
- Its wisps swing round landmarks (under a half turn) instead of spiralling: in a full spiral a
  bird that misses a wisp faces it again on the next lap, and the bot circled back for each one.
  Heights are planned with a look past the pattern's end, so a ribbon never dives into a valley
  steeper on its far side than a ribbon may climb (the Kidron's Olives side), and candidates are
  penalised for a sharp corner where they join the last pattern.
- `withMist` runs a material's own `onBeforeCompile` patch first, so the stone shader carries the
  valley mist too.
- Red Canyons' arches are one instanced unit shape (an extruded half-elliptical band) scaled per
  arch, and the layout's collision is the same band analytically, so what the bird sees is what
  it hits. `solidTop` reports the opening's roof as the underside, which the shared look-ahead
  already reads as "ease under it" (it was written for the city's gates and decks).
- Canyon walls are stepped by reading a band profile at a noise-shifted distance, not by adding
  noise to heights: the ledges meander while every stratum stays level, as real rock does.
- `hash2(-x, -z)` equals `hash2(x, z)` when x and z are both odd (the multiplies are odd and
  negation flips them alike), which stood identical arches in cells mirrored through the spawn.
  The canyon offsets its cell coordinates far from the origin rather than change the shared hash,
  which would reshuffle every other level.
