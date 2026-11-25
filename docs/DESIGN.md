# Driftwing design

## Pillars

- Flow, not challenge: no fail state, timer or enemies. Every collision is a soft bounce.
- 30 seconds to delight: the first arc of wisps is in view within seconds of pressing Play.
- Painterly calm: soft palettes, fog, gentle bloom, paper grain. No hard outlines or realism.
- Phone first: the main way to play is a phone held upright. Every screen is laid out for a
  320-430 px wide portrait viewport first (an iPhone SE at 320x568 must fit), then widened for
  landscape and desktop. New features add no buttons or gestures: a phone has drag to steer, a
  tap (or Boost) to flap and flicks for tricks, and that is the whole vocabulary.

## Flight

Arcade glide. Constant forward motion; pitch trades speed (dive = faster, climb = slower) with
soft min/max speed. Steering is critically damped; turns bank into the curve and auto-level.
Flap (Space / click / button): gentle lift + speed boost, short cooldown, no stamina.
Soft altitude bounds push back gently. Water contact skims with a splash and a small slowdown.
Land never bumps the bird (see "Ground floor" under decisions): it glides above it. Chase camera: spring-damped, FOV widens with speed, follows roll slightly, looks ahead.
Thermals lift the bird for free. Soft ceiling at 400 m above water, above the cloud layer (300 m in Neon Bay, per level).
Holding climb makes the bird beat its wings (a small lift and push every 0.4 s, stronger the
steeper the climb, with a soft whoosh); the flap button stays the big boost, but a burst out of
cruise: flaps add no speed past `flapSpeedCap` (45 m/s, scaled per bird), only lift. Nose-down pulls
harder (1.35x) and speed above cruise bleeds off slowly, so a full dive reaches ~70 m/s
(cruise 26, top speed 68) with wings fully tucked, and the speed carries into a zoom climb.

## Controls

Mouse: pointer offset from centre steers (optional pointer lock). Click/Space flaps.
Keyboard: WASD/arrows steer, Space flap, M mute, P/Esc pause.
Touch: drag relative to touch start steers, and the same finger taps to flap (boost), so drag is
one-handed. A tap is a touch that lifts quickly (`Config.input.tapMax`) without moving past
`tapSlop`; it flaps on lifting, as only then is it known not to start a drag, so drags never flap.
Once tapping, a touch landing within `tapChain` of the last tap flaps as it lands: rhythmic tapping
feels instant and keeps boosting (the flap cooldown paces it), and a tap-tap-drag boosts then
steers. Flaps are latched so no step misses them. Other fingers are ignored. (It used to be a
second finger tapped or held, which a one-handed player can't do.) There is no on-screen flap
button: it covered the view. A Steering setting
(pause menu, touch only) swaps that for on-screen buttons plus a Boost button (held = keep
flapping): a D-pad, eight-way at the bottom left (rest between two arrows for a diagonal, slide
round without lifting), or Side arrows, a compact cluster under each thumb: a tall turn button at
the edge (left on the left, right on the right) with up and down stacked just inside it, so each is
a short nudge away. Up and down are on both sides so two thumbs reach every diagonal; a thumb slides
between its buttons (the nearest one is pressed). Boost sits above the right cluster. Or Split: a
D-pad under each thumb, the left one without a right arrow and the right one without a left, both
climbing and diving. One pad works at a time: while one is held the other ignores touches and fades,
so the turns never mix. Boost sits above the right pad. Either way, double-tap an arrow for a trick,
as on the keyboard. Drag stays the default. A Left-handed switch (shown for the button schemes)
mirrors them: the D-pad goes bottom right and Boost bottom left; Side arrows and Split keep a cluster
under each thumb (their turns stay on their own sides) and only Boost moves, over the left one.
Gamepad: left stick + A.
A Controls panel (title and pause screens) lists the controls for the current device.

## World

Endless chunks from seeded noise: valleys, lakes, instanced low-poly forests, floating islands,
drifting clouds. Day cycle dawn -> day -> golden hour -> dusk drives sky gradient, fog and light.
Post: bloom, paper grain, vignette, colour grade.

## Rendering

Shared lighting and ground detail every level gets (a level only sets strengths). The aim is
believable places in the same cartoon style: things sit on the ground, light has direction,
the ground has texture up close. Every number is in `Config.light`, `Config.cover` and
`Config.levelLight` (per level), gated by the quality preset (`render.*`):

| Preset key                                   | low | medium     | high        |
| -------------------------------------------- | --- | ---------- | ----------- |
| `shadows`: sun shadow map                    | off | off        | on          |
| `contactShadows`: blobs under trees          | off | on         | on          |
| `cloudShadows`: drifting cloud shadows       | off | on         | on          |
| `lightShafts`: screen-space sun shafts       | off | off        | on          |
| `coverDistance` / `coverDensity`: grass ring | off | 60 m, 60 % | 80 m, 100 % |

- **Sun shadows** (`fx/SunShadows`): a 4096 PCF map (2048 on touch devices) in a ±400 m box that follows the bird, fading out with distance,
  snapped to the light-space texel grid so its edges don't crawl. Partial (`levelLight.*.shadows`
  is the darkness, ~0.5-0.6) so a shadow reads as painted shade. Terrain chunks receive but do not cast;
  trees cast through `ShadowCasters`, near-only copies on a shadow-only layer (an instanced mesh
  is never culled, so the real one would draw every tree into the map). `LitScenery` makes every
  lit mesh of a level receive. A low sun fades shadows by intensity and skips the pass (by
  night the moon is the light, and casts faint ones).
- **Contact shadows** (`world/ContactShadows`): one instanced draw of soft blobs, laid on the
  slope (or flat at the foot of anything on a ledge or roof). Trees own one; any decor can.
  Lighter when the shadow map is on (they're the occlusion at the foot then).
- **Cloud shadows** (`world/CloudShadow`): value-noise patches drifting with the cloud wind,
  dimming only the direct sun; applied by `LitScenery` to every lit material, off at night.
- **Light shafts** (`fx/shaders/shafts`): a 24-tap march toward the sun's screen position
  gathering bright sky, before bloom; skipped when the sun is down or off screen.
- **Ground cover** (`world/GroundCover`): grass tufts (and flower drifts) scattered on each
  terrain chunk's own lattice, coloured from the ground, swaying in rolling gusts. A level opts
  in with a `CoverStyle` on its `ChunkManager` (the Highlands, Jade River, City of Gold, Red
  Canyons, whose style adds its own shapes: sagebrush, prickly pear, tumbleweeds; Coral Atolls:
  ferns, driftwood, shells, and seagrass under the clear water; and Aurora Fjords: heather,
  crowberry and moss; Ringmoon Shallows: moss cushions, trumpet flowers, spore puffs and sea
  moss); `paint` gets every component of the style's `extra` attribute (`t.extras`).

## Levels

Chosen on the title screen as cards (a grid on wide screens; on phones one row that swipes
sideways and centres the pick); the attract flight behind the menu switches to the picked
world at once (a short veil hides the rebuild). The pause menu's "Levels" tile returns to the
title. The pick and a best score per level persist. A level is a `LevelDef` (name, opening time of
day, day length, music keys, sky mountain, ceiling) that creates a `World`: terrain, streamed scenery,
what counts as solid, a steering assist, and hooks for wisp patterns and thermal placement.

- **Highlands**: the original endless landscape, lived in (see Highlands below).
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
- **Sea of Clouds**: granite spires standing out of a sea of cloud (Huangshan's summits), opening
  at sunrise. The lofty one: above everything, weightless, skimming the cloud tops.
- **Coral Atolls**: rings of coral reef round turquoise lagoons in the open Pacific (the
  Tuamotus, Bora Bora's high island, Palau's rock islands), opening in the late morning. The
  playful one: bright and sunny, low over glassy water, skipping like a stone.
- **Ringmoon Shallows**: a shallow jade sea on a moon of a ringed gas giant, with two suns and an
  old ship standing in the water, opening in the afternoon. The vast one: another world, the
  giant filling the sky, slow and strange and enormous.

## Highlands

The open, bright one: a real highland country in the cartoon style. Rivers run along every
valley floor (a channel below the water, banks, a flood plain a couple of metres up, bluffs
where a high valley is cut), with a dirt road along one bank. The low, gentle country is
farmed: a rotated patchwork of fields (wheat, pasture, plough, crop rows, rapeseed, meadow)
with hedge margins, dry-stone walls and fences with gates, hay on the wheat, sheep on the
pasture. Villages string along the roads (cottages facing the road, barns, windmills with
turning sails, chimney smoke), clustering at a few hubs; farmsteads stand alone in the fields.
Forests have edges against the fields, glades and birches; rocks crop out on steep and high
ground and along the rivers; reeds line every shore, rowing boats bob off it, flocks wheel
overhead. Grass and wildflower drifts grow round the bird, wheat stands tall, the plough is
bare. Dawn has mist in the valleys; a thin haze layers the ridges all day.

- Code: `Terrain` (`LandField`: rivers, farmland), `world/highlands/`: `HighlandsLayout` (pure:
  the field grid, farmed fields, the road, buildings and the flight floor over them),
  `HighlandsScatter` (pure: trees and small scenery per chunk), `HighlandsDecor` (instancing,
  LOD, shadows, smoke), `Land` (ground colour; fields and road in the terrain shader),
  `crops` (the ground-cover style), `shapes`, `materials`.
- Per preset (`render.*`): `propDistance` 280 / 480 / 650 m (buildings, rocks, bushes; low keeps
  only these), `smallPropDistance` 0 / 200 / 320 m (walls, fences, hay, sheep, reeds, logs,
  boats, flocks), `propDetail` 0 / 110 / 160 m (bushes and boulders swap to far shapes beyond),
  grass ring off / 60 m / 80 m. Rivers, roads, fields, mist: every preset (free on the GPU).
- Cost at the pilot's viewpoints (triangles / draw calls, whole frame): medium 146-201k / ~132
  (was 135-180k / ~114), high 311-426k / ~165 (was 317-470k / ~145), low 68-76k / ~93.

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
into the sky dome.

The waterfront: the grid is straight and the shores curve, so the grid stops at a bayside road
(14 m, two lanes each way) that follows the shore, with a 10 m promenade between it and the
seawall (a stone coping and railing, lamps every 24 m, a row of pines and cherries left open where
each avenue ends, so every avenue meets the road on a zebra and ends in a little plaza looking
out over the bay). Every north-south avenue and street ends there in a T; east-west roads stop
a green strip short of it rather than run alongside as one wide band of asphalt. Blocks the shore
cuts into become waterfront parks; every building keeps 3 m back from the road's kerb. Where the
river meets the bay, the promenade and the road cross its mouth on one wide bridge. The river has
a 7 m walk along the top of each stone embankment, lined with cherry trees leaning over the water
(after Meguro river); buildings keep back from it, and the grid crosses on its bridges. The
embankments are straight stone walls from below the water to a coping level with the walk (railing
on its edge), and the coping is the flight floor over them. A bridge is the road it carries: its
surface meets the road a couple of metres past each bank's top and slopes evenly between the two
heights, painted by the ground's own street pass (lanes, sidewalks, crossings and rails run straight
over), on a slab with a shadowed beam, parapets at the edges and stone abutments down the banks;
cars ride that surface. A road meeting the river at a glancing angle (past about 65 degrees from
square) runs along it and gets no deck, and the embankment runs on past it. About half the
avenues and a few side streets bridge the river (`avenueBridges` 0.47, `streetBridges` 0.05);
the rest end at the river walk on each bank, its railing in front of them, and their traffic
stops there (as it does wherever a road runs along a river without a deck). The river runs long
open stretches: about one bridge every 600 m of river, like a big city river. It was one every
125 m when every road crossed; players asked for fewer, chose 265 m from four densities shown
(125, 265, 360 and 780 m), then asked for more space twice (340 m, then 600 m). North-
south expressways cross the bay as bridges with no pier on the promenade or the road; east-west
ones run only on avenues the bay never reaches, so no deck stops in mid-air. Dusk lights the city: a hashed share of windows, shop fronts, neon, lanterns
and lamp pools on the avenues. Music: night-neon lo-fi at 78 BPM, koto plucks over a mellow
keys pad and a soft swung beat, in a drier room; yo pentatonic by day, hirajoshi after dusk.

Flight among buildings: walls are solid but soft. A look-ahead (about a second) climbs over a
roof within reach, dips under a deck or beam, or veers to the more open side of a tall wall; on
contact the bird glances off, turning along the wall and losing a little speed. Wisps run down
the avenues at street-canyon height, changing lanes and turning a quarter at crossings, circle
towers, or glide over the roofs; the opening ribbon goes through the torii and up the spawn
avenue.

Neon Bay is the skill level (playtest feedback: "flying straight and occasionally turning"
collected nearly everything). Runs are 4-8 wisps (were 6-11) and turn at 75 % of crossings
(55 %), on a tight 30 m arc where it fits (the 40 m arc is the fallback); towers are circled more
often (35 %, after 2 patterns rather than 3). Along a run the ribbon changes lanes: a flattened
sine (`weaveSharp`) holds one lane 12 m off the centre line, swerves across, holds the other,
easing in after the merge and out before the turn. The lanes sit past the magnet's 11 m reach,
so flying the centre line misses them; lane-change lines are planned 8 m clear of walls,
pillars and decks (straight lanes 3.5 m) and fall back to a straight lane where they would not
fit. All of it is `Config.city` (`weave*`, `run*`, `turnChance`, `turnRadius`, `spiralChance`).

The city is lived in. Buildings are painted, not cardboard: one box shader pass (no vertices)
shades every corner, wall top and roof rim as if rounded over ~1.5 m (never under ~2.5 px, so far
towers soften too), with a dry-brush edge light, a two-octave paint wash, weathering streaks, a
darker foot, sky light up the height and a painted cornice; windows have a lintel shadow and a
pale sill, and glass mirrors the sky at grazing angles and up high. All of it reads each part's
own frame (scale then yaw), so turned parts are right. Pillars, lanterns and tanks are 16-sided
and smooth; trees are soft-shaded (normals lean toward their corner's average) with a one-crown
distant shape beyond `treeFar`. The streets: ginkgo rows in kerbed tree pits, street lamps at the
back of the sidewalk over the painted pools of lamplight, a bus shelter per avenue side, traffic
signals on every crossing (the green lamp glows), vending machines on the corners, power poles
and sagging cables along the low-rise side streets, awnings and lit signboards over the shop
fronts. Flat roofs carry parapets, water tanks, condensers, antennas and stair huts; some
podiums and apartment roofs are lawns with small trees. Towers come in five shapes, each from
its own dice so the blocks around them stay put: plain shafts, wedding cakes stepping in at half
and four fifths of their height (a parapet on each ledge), slim pencils a little taller, twins
on one podium (wisps circle the pair as one tower) and a few turned 45 degrees (solid as a
stepped diamond of three boxes). Tall pencil buildings and apartment slabs step their top floors
back from the street (Tokyo's slant-line rule), with the roof kit on the upper roof. The avenues
have a planted median (kerb, clipped hedge, a small tree every 32 m but none under an
expressway's pillars), open at every crossing; side streets meet them on zebras. Built blocks
and plazas are paved in flags (`aCityLand` 0.2; the shader lays a running bond), and the ground
their buildings leave is used: per block either a coin car park (parked cars nose-in) or trees
in kerbed pits with a planter and bench here and there; plazas get benches round the fountain
and a ring of trees round the edge. Expressway decks are painted with their own lanes (a double
line, dashed lanes, solid edges) and carry pale sound walls between the buildings. Parks grow
lawns with a ring of flower beds round the centre and wildflower drifts; house gardens short
grass (`cover.ts`). The promenade and the river walks have benches (and the river walk a
railing and lamps). Traffic: cars down every avenue, the bayside road and the expressway decks
(driving on the left), mostly cars but kei cars, taxis (lit roof signs), box trucks and buses
too, trams on every third avenue over painted rails, ferries looping across the bay and water
taxis along its shores, their lights glowing after dark. Harbours stand along the bay (one always just west
of the spawn): concrete piers with ship-to-shore gantry cranes (solid), container stacks, a
cargo ship alongside and boats moored down the piers; the waterfront blocks behind become
container yards. Towers, props and cranes cast sun shadows on high; props have contact shadows
on medium and high; a thin haze lies low in the street canyons (`levelLight.city.haze`).

- Code: `CityLayout` (the props, power lines and roofs with the buildings), `CityHarbour`,
  `props`, `shapes`, `cover`, `traffic` (pure: lanes and vehicles), `CityTraffic`, `CityDecor`.
- Per preset: street furniture, roof kits, parapets and cars within `smallPropDistance`
  0 / 200 / 320 m, moored boats and ferries within `propDistance`; low has the facade pass,
  round pillars and soft trees but no props or traffic. Grass ring off / 60 / 80 m.
- Cost at the review's viewpoints (triangles / draw calls, whole frame): medium 95-243k /
  115-146 (was 111-255k / 108-127), high 222-485k / 154-193 (was 242-480k / 140-173), low
  64-140k / 83-94 (was 61-130k / 83-94).

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
Every mesh tier (hero within `render.heroDetail`, mid, far) is lathed from one shared skin
(the profile times smooth noise lumps), so tiers match and vines can sit on the stone; the
summit dome's rings step along its arc (no pinched apex). The limestone shader (`rock.ts`) adds
vertical flutes, rain streaks and moss on every sky-facing ledge; pines crown the summits,
shrubs and vine curtains cling to the walls, mossy boulders lie on the scree mound at the foot.
Some summits carry a red pavilion, some lower ones a seven-storey pagoda.

The lived-in valley: the paddy country swells into low hills cut into level terraces (1.1 m
steps); the terrain shader paints each field along the terrace contours (flooded mirrors of the
sky with a sun glint, young green rice, ripening gold) with bunds between, and the ground cover
grows the rice in them. Footpaths wander between the villages along the zero contours of their
own noise, a towpath follows each bank, and where a path meets the river a multi-arch stone
bridge crosses it. Villages of whitewashed houses and halls under upturned eaves (every roof
under the village's soft flight floor), cormorant fishers' rafts, sampans moored off the
villages, water buffalo in the paddies and wallowing in the shallows, farmers in conical hats.
Reeds stand at the water's edge, bamboo and broadleaf groves (with undergrowth) line the banks
and the inland woods; the paddies stay open fields.

- Code: `world/karst/`: `KarstLayout` (pure: rivers, terraces, paths, bridges, pillars and
  queries), `skin` (the shared rock surface), `KarstScatter` (pure: trees, buildings, boats,
  boulders, vines, life per chunk), `KarstDecor` (instancing, LOD, shadows), `Land` (ground
  colour and the paddy/path shader), `cover`, `rock`, `RiverMist`, `geometry` (rock, bamboo),
  `shapes` (props), `KarstWisps`, `KarstWorld`.
- Per preset: hero pillars off / 120 / 260 m, rock flutes and streaks off / on / on, houses and
  boats out to the tree distance (near shapes within twice `propDetail`), boulders, buffalo and
  farmers within `smallPropDistance`, vines within 1.6x that, grass and rice off / 60 / 80 m.
  Pillars, buildings, bridges, boats and boulders cast sun shadows on high; props get contact
  shadows on medium and high.
- Cost (whole frame, 390x844, three views): medium 325-372k / ~132 calls (was 385-405k / ~115),
  high 626-714k / ~168 (was 664-684k / ~148), low 170-178k / ~92 (was 205-224k / ~90).

Atmosphere: a valley mist (shared uniforms, patched into the level's toon materials, the
ground and the water shader) lies below ~55 m, drifts in slow banks, clears near the bird and thickens with
distance; it is thickest at dawn and thins by midday. At first light long sheets of river mist
lie a few metres over the water near the bird, gone by mid-morning. A distance haze fades far pillars in
layers. Low billboard mist banks drift between the pillars. Three rings of karst peaks are
painted round the horizon in the sky dome, each layer a deeper wash with mist at its foot.
Lanterns (houses, rafts, pavilions) are red paper by day and glow (HDR, bloomed) after dark.
Music is a sparse guqin at 56 BPM: notes slide up into pitch and bloom a slow vibrato, with
falling grace notes, over a sine pad, a root-and-fifth drone and deep reverb, no arpeggio. It
walks the Chinese modes: shang at dawn, gong by day, zhi at golden hour, jue at dusk, yu at night.

Flight: pillars are solid but soft, flown with the city's look-ahead and wall glance; the
summit dome pushes up (skim it), the walls push straight out from the axis. Village roofs and
bridge decks are soft ground (the floor rises over them, eased along the river at a bridge).
Wisps: the river is the spine (low ribbons following its bends, hopping over the bridges); slaloms weave between pillars (of the clear
candidates, the one passing most rock wins); now and then a spiral climbs the last ~100 m of a
tall pillar and crosses its summit. Every pattern is checked 9 m clear of rock and ground, and
a slowly updated trend heading keeps the ribbon from doubling back.

## Aurora Fjords

Mood: hushed, vast, starlit. The first level to open at night: a deep blue polar night (never
black) with the aurora overhead, lingering (the day runs at half speed) before a low sun turns
the snow pink at dawn and gold in the afternoon. Late autumn on the Norwegian west coast (after
Lofoten, Geiranger and the Sognefjord): the first snow on the heights and in the plateau's
hollows, the birches gold, the heather in bloom. Cold palette with warm accents: red and ochre
houses, lamplit windows, gold birch, the lighthouse.

Plan: fjords run along the zero contour of a low-frequency noise (as Jade River's rivers),
120-240 m wide, endless in every direction; spawn is mid-fjord through the origin, facing along
it. From the water: a deep bed, a pebble strand up to ~38 m wide (from a noise, ~56 m round a
village), then a glacial wall that is steep at its foot and rounds over at the lip
(1 - (1 - t)^2.2 over 150 m) onto a plateau of ~100-200 m that throws up ridged peaks away from
the walls. Ridged noise scores the walls into buttresses; its crease is rounded (`softAbs`), as
is the peaks', because the wall is a 4 m lattice climbing 150-250 m in 150 m and a sharp ridge
drew a sawtooth skyline. Each quad is split along its flatter diagonal (as Red Canyons), so the
wall's foot and lip are straight lines rather than a per-cell zigzag.

The ground is painted per pixel (`rock.ts`, from the terrain's `aLand`: distance from the water,
a street's distance, a waterfall's spray, the snow climate). The cliffs' relief lives in the
shader, in the wall's own plane (its horizontal tangent by height, so it never streaks): couloirs
down the face, rounded slabs, pale water-washed streaks and dark meltwater stains, a black tide
band at the water, turf and moss on the gentler steps below the treeline. Snow lies per pixel
from the vertices' snow climate (a ramp through a snowline ~185 m that wanders ±45 m, plus
snowfields in the plateau's hollows): on the flat, and on a cliff only where the tilted normal
turns up into a ledge, with wind ripples on the fields. The strand gets a pebble beach, a wet
band and broken foam at the water, the villages' gravel streets and lanes, and lush moss round a
waterfall's stream. The rock's normal replaces GroundDetail's bump on the cliffs.

Geography: spruce on the lower walls and gold autumn birch in drifts on the strands and slopes
(near, far and distant shapes); boulder beaches along stretches of shore picked by a noise, and
rockfall at the walls' feet; waterfalls (one in a 480 m cell at most, the first ~470 m down the
fjord from the spawn) from the plateau's lip down the wall, hung off the rock by how steep it is
and fraying as they fall, then across the strand to the water as a stream, with spray billowing
at the foot; heather, crowberry, moss and grass (`cover.ts`) on the strands and the snow-free
fell, cotton grass and harebell in drifts. Pans of sea ice (16-sided near, 8 far) and smooth
icebergs (tabular or peaked) drift on the open water. A lighthouse (32 sides, a gallery and a
dome) stands on the shore ~260 m down the fjord from the spawn.

Life (`FjordSites`, pure): fishing villages on the strands, a home village ~170 m down the fjord on
the bird's right and one in a 900 m cell at most elsewhere. Each widens its strand, then lays two
rows of wooden houses either side of a gravel street (falu red, ochre, white, now and then a
two-storey house or a blue-grey one; windows lit after dark), a white church in the home village
and some others, tarred or red boathouses on posts at the water, jetties with fishing boats
moored at their ends and lanes up to the street, and fish-drying racks at either end. Gulls wheel
over the villages, fishing boats steam slowly round circles out on the open water, seals haul out
on the bigger floes and sea eagles circle high over the walls (a few per kilometre). Roofs lift
the flight floor (`ground`), so the bird and the wisps pass over the houses.

Atmosphere: the aurora is three curtains painted into the sky dome, each with a folded,
wandering hem, fine rays bunching and thinning along it, green at the hem fading to violet
above, swelling and thinning along its length and drifting slowly; it comes out with the stars
and bloom halos it, and lies softly reflected in the calm water within ~90 m of the shore (an
additive grid of water round the bird carrying the shore distance; `levelLight.fjord.reflect`).
A low sea smoke (the shared mist shader) lies on the water, thickest at night, and a distance
haze layers the far walls; by day both thin (`dayHaze`), so the walls read as rock. At first
light fog banks lie low on the water (`levelLight.fjord.fog`). After dark the windows glow and
the lighthouse sweeps a beam (two additive cones fading along their length). On high, the walls,
buildings, racks, rocks and bergs cast sun shadows (props through ShadowCasters); buildings, racks
and rocks get contact shadows on medium and high. Music: glassy, celesta-like bells at 62 BPM over
a hardanger-style open-fifth drone, a slow high music-box arpeggio and the largest reverb;
suspended at dawn, major by day, dorian at golden hour and under the aurora, minor at dusk.

Flight: the walls are terrain, not props. `solidTop` reports terrain above the strand as solid,
so the city's look-ahead veers along the fjord before a wall (or climbs if the lip is within
reach); a bird that still touches a steep slope (gradient > 0.9) glances off it downhill.
Icebergs are soft ground (skimmed), village roofs lift the floor; the lighthouse is solid. Wisps:
the fjord is the spine (low ribbons following its bends and swinging across the channel), glides
carry on over the plateau, and generic patterns run only far out on the plateau.

- Per preset (`render.*`): houses, boathouses, jetties, floes and bergs always; racks, boats,
  gulls and eagles within `propDistance`; boulders and seals within `smallPropDistance`; near
  floes and boulders within `propDetail`; the cliffs' relief off on low (`rockDetail`); cover in
  the shared grass ring.
- Cost at the viewpoints in `perf.md` of the review (triangles / draw calls, whole frame): see
  the decisions log.

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

The country is lived in (`world/jerusalem/`). Roads leave the gates (Jaffa Road, the Hebron
and Nablus roads, the Jericho road over the Mount of Olives, the road along the north wall);
in the hills, roads wind between the towns (a noise's zero lines) and one follows a bank of
every wadi; footpaths wander and peter out. Every valley floor has a dry bed of pale pebbles
with oleanders in pink flower along its banks, and the level floors are walled fields (stubble,
red plough, green crop, fallow) instead of terraces. The orchard slopes step down in terraces
with a dry-stone wall along every riser (traced along the contour), olives on the flats.
Limestone breaks out of the steep and high ground in bedded shelves and boulders; grey-green
garrigue (thorny burnet, sage) grows in drifts; goats and sheep graze with a shepherd;
cypresses line stretches of road. The ground cover is dry golden grass in patches with bare
stony ground and cushions of thyme, red anemones under the olives, spring flowers in drifts.
Roofs carry black water tanks, washing lines and pots; market stalls line David Street, the
Cardo, the way in from Lions Gate and the town roads; swifts wheel over the roofs.

Light: the stone has rounded arrises painted into its normals and weathering that holds at a
distance; tree crowns are soft (rounded normals, painted leaf clumps); house domes near the
bird are rounder. The golden hour keeps a cool sky fill: the hemisphere is blue-lavender,
stone turned from the sun takes the sky's hue, and the far haze leans toward the sky above
rather than the horizon, so shade reads blue-violet against the gold. On high the stone,
walls and big props cast sun shadows; props get contact shadows on medium and high.

- Code: `JerusalemLayout` (pure: also the tracks as signed distances, the walled fields, roof
  clutter and stalls on the houses), `JerusalemScatter` (pure, per chunk: terrace and field
  walls, rocks, garrigue, oleanders, flocks, swifts, road cypresses), `props` (records),
  `land` (the terrain's `aJLand`: road, path and bed distances and the habitat; roads, paths,
  beds and risers painted in the terrain shader), `cover` (the ground-cover style), `shapes`,
  `materials` (stone, foliage detail, the props' painted dry stone), `JerusalemDecor`.
- Per preset: props within `propDistance` 280 / 480 / 650 m (rocks, garrigue, oleanders; low
  keeps only these), small props within `smallPropDistance` 0 / 200 / 320 m (walls, animals,
  roof clutter, stalls, swifts), near shapes and round domes within `propDetail` 0 / 110 /
  160 m, distant tree shapes beyond `treeFar` - / 330 / 470 m, grass ring off / 60 / 80 m.
- Cost at the review's viewpoints (triangles / draw calls, whole frame, golden hour): medium
  281-373k / 122-148 (was 301-391k / 108-128), high 561-694k / 159-193 (was 582-680k /
  143-173), low 147-209k / 82-99 (was 139-210k / 81-95).

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
shifted by noise, so the ledges meander while the strata stay level. Scree piles at the foot of
every cliff (a concave apron at about the angle of repose, a fifth of the cliff's rise), dry washes
wander across the floors as sandy beds and cut gullies into the plateau, and slickrock swells into
low bare domes on the plateau (and a little on the benches). Beyond the rim the plateau swells
gently and throws up flat-topped mesas (a talus skirt, sheer walls, now and then a butte stepped on
top) away from the canyons. The rock is painted per pixel from world height (`rock.ts`): uneven
level layers of deep red, rust, orange and pale sandstone pulled toward one family, a dark seam
under each ledge, fine laminations, desert varnish hanging in streaks down the steep faces and
vertical flutes (a tilt of the normal) down the cliffs; the arches, hoodoos, boulders and the
dwellings' brows wear the same layers at the same heights. The floor's ground is painted from a
per-vertex field (`aLand`): the road with its wheel ruts, rippled wash beds, cross-bedded
slickrock in cream and salmon, rubble on the scree. A green corridor follows the river: lush grass,
cottonwoods, coyote willow at the water's edge; sagebrush, bunchgrass, rabbitbrush in yellow bloom,
prickly pear and tumbleweeds scatter the dry floors and plateau, wildflowers fill the washes as if
after rain, junipers stand on the benches and plateau, and banded hoodoos with darker cap stones
crowd the rims and the wider benches.

Life: a dirt road runs along every canyon floor on one side, a post-and-wire fence beside it in
stretches. Ranches stand on the wide stretches of floor beside the road (one ~150 m on from the
spawn): a red barn, a house with a porch, a lattice windmill whose fan turns over a stock tank, a
corral with horses, hay, cottonwoods by the house and cattle grazing out on the floor; their pad is
levelled and the flight floor lifts over the roofs. Cliff dwellings (generic, not any real site):
masonry rooms and a round tower on the first bench, tucked under a brow of rock that juts from the
cliff over a darkened hollow; the first stands past the Great Arch on the bend's wall, framed in
the opening on the way in. Hawks circle on the thermals (now and then a pair of ravens) and the odd
dust devil wanders across the floor or the plateau, lives for a while and fades.

Arches: one shape for all of them, a band between two half ellipses (the opening, and the back
1.3x as wide and 1.24x as high) with legs running into the ground, scaled per arch. The Great
Arch (46 m half span, 62 m rise) stands across the floor ~330 m down the canyon from the spawn,
where the floor opens out to hold its legs; smaller ones stand across straight reaches of the
canyons (one in a 420 m grid cell at most, snapped to the centre line), and fins with a window
through them stand on level ground out on the plateau. A cell's first spot decides as it always
did; when it found no canyon arch and stood no fin, up to `archTries` (6) more spots look for a
canyon arch, so one stands every ~1 km down a canyon (gaps of 4-7 km used to leave the journeys
nowhere to go; see Destinations). Painted mesas and buttes ring the horizon
in three washes of the rock's shade.

Atmosphere: a dust haze layers the far rims and mesas all day; a little mist lies in the canyons
at first light and burns off by mid-morning, and by day a thinner warm dust haze fills them
(`levelLight.canyon.haze`). The sunlit red walls bounce warm light into the canyon's shade, low
between the walls and under the arches (`bounce`). On high, arches, hoodoos, boulders and the
sites cast through ShadowCasters; contact shadows lie under rocks, shrubs, hoodoos and stock.
Music: a desert guitar (a saw and a square an octave
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
generic patterns run only far out in the desert. A dwelling's brow is solid (the look-ahead sees
it as wall); ranch roofs only lift the flight floor.

- Code: `world/canyon/`: `CanyonLayout` (pure: canyons, walls with scree, washes, slickrock,
  arches, hoodoos, queries), `CanyonSites` (pure: ranches and cliff dwellings, their levelled
  ground and flight floor), `CanyonScatter` (pure: trees, sites and small props per chunk),
  `CanyonDecor` (instancing, LOD, shadows), `rock` (the strata, land and bounce shader patch),
  `cover` (the ground-cover style), `geometry` (rock and trees), `shapes` (props), `materials`.
- Per preset (`render.*`): hoodoos smooth within `hoodooDetail` 0 / 220 / 320 m; ranches, dwellings
  and brows always; boulders, sagebrush, stock and fences within `smallPropDistance`; hawks and
  dust devils within `propDistance`; desert cover in the shared grass ring.
- Cost at the pilot's viewpoints (triangles / draw calls, whole frame): medium 155-178k / ~118
  (was 163-177k / ~100), high 328-378k / ~150 (was 308-340k / ~127), low 80-89k / ~81 (was
  97-105k / ~78).

## Sea of Clouds

Mood: serene, lofty, weightless; the feeling of being above everything. It opens as the sun
clears the cloud sea, ahead and a little right of the bird (`sunTurn`), beside the Sky Gate, and
the day runs at 1.3x: a deep high-altitude blue by day, honey at golden hour, rose and violet at
dusk and a moonlit silver sea under the stars. The ground light is the cloud's bounce (lilac,
blue-grey), never earth's, and the fog is the far sea's colour, so the horizon melts into it;
the water plane far below takes the same colour where it shows past the last chunk.

Plan: the ground is the cloud sea at ~40 m: long swells, rounded heaps from |noise| (round tops,
sharp creases where it crosses zero, the shape of cumulus seen from above; plain noise rolled
like dunes and read as sand), now and then a big heap rising 26 m, and cloud piled softly against
every spire's foot. Spires stand on a 100 m jittered grid (up to two per cell, clustered by a
noise into ranges with open sea between, hash coordinates offset so cells mirrored through the
origin differ), their bases hidden in the cloud. Five silhouettes (column, needle, tiered tower,
massif, leaning blade) share one profile, a tapering column with stepped tiers under a flat
summit dome, which is also what the bird collides with. Each silhouette is lathed from its skin
(`skin.ts`, pure): granite breaks along horizontal sheeting joints, and at each joint the rock
above steps back to leave a ledge round part of the spire (a mask of whole angular frequencies,
so the seam closes) and then leans back out, an overhang over it, with a groove at the joint
that fades in and out round the rock; the joints dip a little across the spire so the ledges
slope rather than ring it; one joint per shape is a wide, low alcove under an overhang; broad
chimneys run down the faces. The skin only cuts into the rock (it is at most 2 % over the
profile), so the collision profile stays the envelope of what is drawn. Three mesh tiers, all
smooth-shaded and indexed: the finest (26 sides, rings packed round every joint for the groove)
for spires whose flank is within `render.heroDetail`, a near one (16 sides, the ledges' lip and
inner edge) out to `spireLod` (520 m at the high draw distance, scaled with the preset) and a
far one (7 sides). The fine granite is painted per pixel (`granite.ts`): vertical fractures as
whole multiples of the angle round the spire's own axis (an `aRock` vertex attribute carries
the lathe's direction and radius), about 8 m apart and warped, and sheeting joints by height,
both open lines that start and stop (iso-lines of a 3D noise close into loops on a lathe and
drew ovals), the blocks between them pillowed so the light rolls over each one; stone tone and
speckle, ochre and grey-green lichen, dark water stains, moss and turf where the rock faces the
sky, and snow on ledges and summits above a ragged snowline (~228 m). Relief and fine paint
fade by `rockFar` and are off on low (`render.rockDetail`).

Ground cover (`PeaksScatter`, pure, read from the skin so things sit on the drawn stone): every
ledge wide enough holds moss cushions, alpine grass, boulders, old snow above the snowline,
dwarf pines leaning out over the drop and now and then a stone shrine; the summits carry turf,
grass, boulders and snow between their windswept pines (flat pads on a crooked trunk; near,
far and a 22-triangle distant shape past `treeFar`), and more pines reach out from the cliffs.

Life: the Sky Gate stands 400 m ahead of the spawn, two great columns 104 m apart joined by a
hanging plank bridge with rope rails and prayer flags (blue, white, red, green, yellow). The
monastery on the taller one has a main hall, a side hall and a three-storey tower, a dormitory,
a bell pavilion, a white stupa, an incense burner and stone lanterns in its courtyard and a
front gate, lines of flags from the tower's eaves down to the terrace wall, lit windows and
lanterns, and a stair cut round its spire (one turn and a bit, granite steps on a wall into
the rock, lamp posts every few metres) from the bridge's deck up to the summit. A long line of
flags runs from its terrace across to the other gate summit. Hermitages crown some of the
tallest spires; a hermit's hut (stilts, whitewash, a red door, a lamp) stands in the alcove of
about a third of the spires that have one; little six-post pavilions stand on bare summits.
Rope bridges (plank segments, flags along one rail, lamps at each end) and lines of prayer
flags hang between neighbouring spires (`PeaksSites`, pure: anchored in stone at both ends,
clear of every other spire and of the opening run). Flocks of red-crowned cranes in a V wheel
on wide circles over the summits (high enough to clear everything under them), moved and
flapped in the vertex shader.

Atmosphere: the cloud sea has its own paint (cauliflower lobes riding the wind and slowly
warped so they boil rather than slide, tilted into the normal so the toon bands break into
heaped puffs, lilac in the creases, a glow from the sky's light so cloud is never dark) and is
alive: broad heaps drift with the wind over the fixed swells while each stretch of sea swells and
sinks on its own ~40 s breath, so the surface keeps changing shape like a time-lapse. The shared mist rests on the cloud tops (`uMistBase`) and
reaches 30 m up, dissolving the spires' feet; the sea itself takes only the fog. Banks of cloud
drift round the spires' waists, their puffs wandering and swelling so each bank changes
shape, and the bird can fly through them; the sky's own clouds float
140 m higher than usual. Two ranges of great snow peaks are painted round the horizon (jagged
pyramids, the face toward the sun lit and coloured by it, pink at sunrise), standing out of the
cloud sea's haze. Lanterns on the temples, stair, huts, pavilions and bridges, and the
monastery's and huts' windows, glow after dark.

Gaps open in the cloud sea out on the open water (one in a 650 m cell at most, never where a
spire's foot would show; a home gap 80 m left of the opening glide): the drawn surface
(`PeaksLayout.surface`) falls away through walls of cloud going blue in their own shade to a
valley floor at 5 m (just over the water plane) painted as dark forest, terraced fields and a
river's thread under the haze that fills it, small in scale so it reads as far below. Only the
drawing opens: flight, wisps and spires keep the cloud top (`height`), so the bird floats over a
gap as on a thin veil. The cloud sea glows warm on heaps that face a low sun and gets a silver
lining on tops seen against the sun or moon (`levelLight.peaks.warm`, `lining`), and from
mid-morning to the golden hour shafts of sun slant through the haze onto the sea (`beams`:
long additive quads along the sunlight turned to the camera, out over open cloud, faded near
the bird and end-on; geometry, so medium has them, following the cloud-shadow preset). On high,
spires, temples, huts, pavilions, shrines and boulders cast sun shadows (spires onto the cloud
tops and each other) through ShadowCasters, and the screen-space shafts are a little stronger
(0.7); huts, pavilions, shrines, boulders and dwarf pines get contact shadows on medium and high.

Flight: the cloud sea is soft ground, skimmed like water with a puff of cloud (`World.skimColor`).

Flying into the cloud: out on open cloud the sea is soft (`PeaksLayout.softness`, the flight
model's `softAt`). The bird rests lower over it (`cloudSkim`, 2.5 m, brushing the tops), and
while the stick asks for a descent the cushion's floor drops to `cloudDepth` (6 m) under the
tops, so any descent, gentle or steep, glides in and levels out about 5 m down; inside, the
cloud soaks up sinking and extra lift. It allows a breath (`cloudHold`, 2.5 s; it comes back out
of the cloud at `cloudRecover`), then, or as soon as the stick is let go, the floor rises to the
skim and the bird is lifted out at a shallow climb (`cloudClimb`, judged `cloudLead` s ahead so it
arrives level): it surfaces at its skim, never leaping out. Held down, it glides in, out and in
again every few seconds; nothing is gained or lost, it is only feel. Near rock (within
`softNear`-`softFar` of a spire's reach, where the rock goes on down under the cloud and a
glance off it would be unseen) and round a gap (whose walls would show the bird) the cloud is
the usual floor. Going in: the whole bird melts into the mist over the last `cloudFade` m above
the top and is gone as far under it (`Bird`'s veil: its colour into the cloud's and a rising
noise dissolving it, with the parts nearest the top going first), a crown of puffs (some in the
cloud's lilac shade) rolls out, a hollow closes over it and a ring of churned cloud spreads on
the tops (`cloudSea`'s plunges); a soft "fwump" plays and the whole mix closes through a lowpass
(`AudioEngine.setMuffle`). Under: the camera does not follow. Over soft cloud it never sinks
below where it rides while the bird skims the tops (`cloudSkim` plus its own height over the
cloud at the bird, clear of the heaps ahead), a floor tied to the place, not switched on in time,
and it watches the cloud where the bird went in: a swell rides over the bird with its dim shape
showing through, puffs churning up over it. Out: the bird fades back in as it rises, vapour peels off it, another ring spreads and a
rising rush plays. The blob shadow fades as the bird sinks. Tuned in `Config.flight.cloud*`,
`camera.cloud*` and `peaks.soft*`, `veil*`, `ripple`.
Spires are solid but soft, flown with the city's look-ahead and wall glance; summits push up
(skim them). The bridge is a solid box with an underside: the look-ahead eases the nose under
it, and touching it pushes the bird up off the deck or down under it. Ledge cover, huts and
dwarf pines stand inside the rock's solid envelope; pavilions inside the summit's crown. Rope
bridges and flag lines are soft (the bird brushes through them as through a cloud bank) and
every wisp ribbon keeps `ropeClear` (10 m) from them, so they are never a wall in the flow's
way. Music: a breathy bamboo
flute (a sine and a soft triangle with band-passed breath on the pitch, a chiff as it speaks,
bending up from a little flat, a slow vibrato on held notes) at 60 BPM over a wide high sine pad
and an open-fifth drone, a slow glinting arpeggio an octave up with flow, and the largest reverb;
lydian at dawn (the raised fourth floats), major by day, suspended in the golden hour, dorian at
dusk, minor at night.

Wisps: the opening ribbon rises gently down the open corridor and threads the Sky Gate 40 m
under the bridge. Then: skims that ride 7 m over the cloud tops, following the heaps (from high
up a skim glides straight down first and only then weaves); slaloms between spires at the height
the ribbon is flying; glides that sink back toward the sea; and swings that join a spire's
circle on a tangent, climb about 315 degrees round it and cross its summit. Every pattern is
checked 9 m clear of rock, 10 m clear of every rope and 3 m over the cloud before anything
spawns.

- Code: `world/peaks/`: `profile` (the silhouettes), `PeaksLayout` (pure: cloud sea and its
  gaps, spires, the gate, queries), `skin` (pure: joints, ledges, alcove, chimneys),
  `PeaksSites` (pure: ropes, the monastery stair, crane flocks), `PeaksScatter` (pure: pines,
  ledge cover, huts, pavilions, temples, lanterns and windows per spire), `PeaksWisps`,
  `PeaksDecor` (instancing, three spire tiers, near/far props, casters, contact shadows),
  `granite` (the rock shader), `cloudSea` (the sea's shader: lobes, heave, gaps, glow),
  `geometry` (spires, pines, temples, the gate bridge), `shapes` (props), `materials` (props
  with fluttering flags, cranes, sunbeams), `PeaksWorld`.
- Per preset (`render.*`): spire tiers by `heroDetail` (0 / 120 / 260 m) and `spireLod` scaled by
  `drawDistance`; ledge and summit cover, dwarf pines and shrines within `smallPropDistance`;
  huts, pavilions, the stair, ropes, flags, lanterns and windows within `propDistance`; near
  boulders and dwarf pines within `propDetail`; distant pines past `treeFar`; granite relief
  off on low (`rockDetail`); sunbeams with `cloudShadows`.
- Cost at five views (triangles / draw calls, whole frame): medium 123-153k / 132-148 (was
  146-167k / 115-133), high 245-271k / 145-179 (was 229-255k / 126-154), low 85-109k / 93-110
  (was 82-102k / 92-103).

## Coral Atolls

Mood: playful, sunny, easy; a holiday. Where the other levels ask for awe or stillness, this
one asks the bird to play: bounce low over clear water, skim the surf, flick between rocks. It
opens in the late morning (phase 0.14), when the lagoons are brightest, and the day runs at
1.2x: a deep clean blue overhead by day, gold in the evening, a coral-pink and violet dusk and a
warm blue night. The sun is turned (`sunTurn`) to go down ahead of the spawn, behind the high
island's fang. Saturation is lifted a touch (1.06): this is the one level allowed to be vivid.

Plan: deep ocean (~42 m) with an atoll in most cells of a 1100 m grid (centres jittered by 10 %,
so rings never cross; neighbours of the big home ring shrink or drop out). Each atoll is a ring
whose radius wobbles with three harmonics; everything on it is a function of the angle round
it: the reef flat a hand under the water rising to a crest on the ocean side, then a steep wall
easing onto the ocean floor; inside, pale sand flats deepening into a ~7 m lagoon of long sand
swells and coral heads; islets (motus) of sand and palms where a noise sampled round a circle is
high (about half the ring, so they close up seamlessly); and one or two passes cut deep through
the reef with no islets. The home atoll (540 m) sits 330 m ahead of the spawn with its passes
ahead-right and behind, so the first view across the lagoon meets an unbroken ring of palms. Its
high island is a ridged volcanic cone (radial gullies, wandering a little round it) and a fang
beside it, sheer through the middle and rounded at the crown, rising to ~165 m; about a third
of the other atolls hold a smaller one. A curving pier of thatched overwater bungalows on stilts
runs off the home island's shore toward the spawn's right, and off an islet in about half the
other lagoons. Mushroom rocks (Palau's rock islands: a jungle dome on a stem the sea has
undercut at the waterline) stand in clusters in the lagoons, clear of islands, piers and the
opening run; four silhouettes are lathed from one notched profile the collisions share, each
pulled in (never out) to a lopsided plan so no two read alike. Boats (a little catamaran with a
white sail, an outrigger canoe) lie moored on the lagoons.

Water and colour: the level turns the water nearly clear (`waterClarity`, 0.8): looking down,
the water plane is a light veil and the seabed's vertex colours show through, so the terrain
paints the lagoons by depth (white sand, aqua shallows, turquoise, the blue of a pass, the
deep blue of the ocean), with pale coral rubble on the reef flats and coral heads dark in the
lagoons. At grazing angles the water turns back into a mirror of the sky (fresnel), so the
far sea still reads as sea. Every other level keeps clarity 0, the painted veil.

Diving under: deep water is a soft surface like Sea of Clouds' cloud (`AtollLayout.softness`,
the flight model's `softAt`, with the top at the water level): full over `diveDeep` (8 m) of
water, none by `diveShallow` (3.5 m), judged by the shallowest seabed within `diveLook` (a reef
wall or a coral head rises fast), none under a hut or pier and fading out toward every rock (its
stem runs on down). So the open ocean and the passes take the whole dive (about 5 m down), a
7 m lagoon about 4 m (3 m clear of the sand), a 6 m lagoon a dip, and reefs and shallows none. It
is the cloud's glide (in while the stick asks for a descent, a breath of `cloudHold`, out level at
the skim, letting go brings it out), but only while the stick asks to go in or the bird is still
coming out: otherwise level flight over deep water skims and splashes off it as before, and its
minimum-altitude push rests while the water is open (under water it built up and flung the bird
out). Never onto the seabed: the floor keeps `clearance` over it. The water stays clear, so the
bird stays in sight: under the surface it takes the deep water's tint (`waterTint`, the palette's
water leaning to the open ocean's blue), the whole bird more of it with depth (`waterDeepTint`),
and nothing dissolves; the water plane adds its veil and, at grazing angles, its mirror. The
camera keeps its water-skim height over it and may aim `waterAim` m down to follow the bird.
Going in: a splash and a ring of foam, a "bloop" under the splash, and the mix muffled; under,
bubbles break the surface over the bird and now and then one rises past it with a chirp; out,
droplets stream off it and fall back over a smaller splash.

Atmosphere: no valley mist, only a light sea haze fading the far atolls. Surf breaks round every
outer reef: one strip per atoll in view (built as it comes into draw distance, freed when it
leaves) with a crest line where the swell breaks and bands of foam rolling in over the flat,
none in the passes. After dark the churned water glows a bioluminescent cyan (HDR, bloomed).
Trade-wind cumulus are painted round the horizon (the `cumulus` backdrop): two rows of flat-based
heaps of domed towers with cauliflower tops, each tower lit where it faces the sun and taking its
colour (gold, then pink), a cool shade on the far side. Windows of the bungalows and lanterns on
the pier and the boats' mastheads glow after dark.

Flight: the water is the ground here; the bird skims it with a spray, not dust
(`World.skimColor`). Palms, jungle and bungalow roofs are soft canopy. Mushroom rocks are solid
but soft, flown with the city's look-ahead and wall glance (their domes push up: skim them). The
high islands are terrain the look-ahead reports as solid above 8 m, so the bird veers round the
fang rather than being lifted up its face. Music: a wooden marimba (a sine with the bar's tuned
fourth harmonic and an inharmonic knock that dies in tens of milliseconds; long notes rolled)
at 88 BPM, the quickest of any level, over a light triangle pad, a skipping arpeggio an octave
up with flow and an island lilt (log drums on 1, the "and" of 2 and 4, a shaker on every
eighth), in an open-air room. Suspended at dawn, a bright major by day, mixolydian in the golden
hour, a softer major at dusk, suspended at night.

Wisps: skipping-stone hops are the spine: the ribbon dips to 4 m over the water (or the palm
tops) and bounds 6-10 m up again every three or four wisps. The opening hops cross the home
lagoon toward the fang, and the first swing then curves round the island's shoulder. Out of a
lagoon, the hops aim at the next atoll ahead within a turn of the trend (through a pass when one
faces the ribbon). Near a reef: rim runs, an arc along it over the surf and the islets. In a
lagoon with rocks: slaloms between them. Swings walk round a high island at a height among its
shoulders, as far out as the land needs, for about half a turn. Generic patterns (and their
thermal spirals) get one pattern in ten. Every pattern is checked 9 m clear of rock and land
sideways and 2.5 m over the water, palms and roofs before anything spawns.

Lived in. The ground is painted per pixel (`land.ts`) from a per-vertex `aAtoll` (reef-flat
share, the ocean side of a shore, seagrass, coral): wherever the paint is green above the
beach, the jungle is a carpet of tree crowns (each its own tint, dark gaps between, a domed
normal; on steep ground the two wall planes), so the slopes between the trees read as forest,
not felt, and the mushroom rocks' caps wear the same crowns. Every shore has a band of wet sand
with a sheen of the sky, and a lace of foam at the waterline that swashes up and back (higher on
the ocean side of an islet); the outer reef's surf (`Surf`) breaks beyond it. The reef crest
dries in patches a hand above the sea (`crest`): pale rubble and coralline crust with tide pools
between. Through the clear water: ripples in the bare sand, seagrass meadows on the sandy
shallows, and coral gardens of pink, purple, mustard and teal heads on the lagoon knolls, with
instanced coral heads near the bird. Sand bars wander over the lagoons' sand flats, the zero
contour of a noise stretched round the ring, rising just clear of the water in stretches.

Life: a fishing village stands off the home island's shore on the spawn's left (across the
island from the bungalows) and off an islet in about 45 % of the other atolls: a plank walkway
out over the water with stilt huts either side on gangways (woven walls, tall thatch flaring at
the eaves, a porch and a ladder), a branch, and huts on the sand behind with cooking fires whose
smoke drifts downwind. The lagoon floor rises to a sandy shelf under each village, so the huts
stand on short stilts in light water. Outrigger canoes are pulled up on the beaches (many by a
village), bows to the water; a few are out paddling; nets hang on poles in the shallows. Schools
of fish, turtles and eagle rays swim in the lagoons, and frigatebirds hang high over the islands
while terns work low over the reef. Moving things follow a circle round their instance's origin
in the vertex shader (radius and direction from a hash of the origin that the scatter shares,
so every circle is checked to stay in open water); nothing moves on the CPU. Hut roofs and the
walkways are soft ground (`roofAt`), like the bungalows; rocks keep clear of villages.

Foliage: jungle trees and shrubs are soft lobes whose normals blend their own ellipsoid's with
the whole crown's, so the toon bands sweep round a tree as one mass instead of a cluster of
gems; palms have smooth trunks and fronds lit as one arching blade. Jungle trees fill about a
third of the island's cells (the painted crowns fill the rest), and palms and jungle have cheap
distant shapes beyond `treeFar`. The mushroom rocks' domes are spaced by arc with the lumps
calming toward the apex: round crowns, no spikes (the collision profile is unchanged).

Light: on high, palms, huts, bungalows and the high islands cast sun shadows (huts and bungalows
through ShadowCasters); contact shadows lie under trees, huts on land, beached canoes and fires
on medium and high; light shafts are brighter (`levelLight.atoll.shafts` 0.55) for the sun
through the jungle and the palms. The water stays bright and clear.

- Code: `world/atoll/`: `AtollLayout` (pure: reefs, crest, sand bars, seagrass, islands, rocks,
  piers, villages and their shelf, queries), `AtollScatter` (pure: trees, village sites, the
  lagoons' life), `AtollDecor` (instancing, LOD, casters, contact shadows, smoke), `land` (the
  ground's paint), `cover` (the ground-cover style), `materials` (the life's motion, smoke),
  `shapes` (props), `geometry` (rocks, trees, bungalows, boats), `Surf`, `AtollWisps`.
- Per preset (`render.*`): villages always; canoes, nets, fires, paddlers and seabirds within
  `propDistance`; coral heads, fish, turtles and rays within `smallPropDistance` (none on low);
  beach and jungle cover and seagrass in the shared grass ring (none on low).
- Cost at the review's viewpoints (triangles / draw calls, whole frame): medium 144-202k / 119-140
  (was 160-202k / 108-128), high 269-379k / 146-191 (was 257-349k / 133-178), low 98-141k /
  87-103 (was 93-134k / 86-97). Low keeps the smooth rocks for the nearest 160 m only.

## Ringmoon Shallows

Mood: vast, epic and strange; another world. Every other level is a place on Earth; this one is
not, and it should feel enormous and quiet rather than hostile. It opens in the afternoon (phase
0.36) and the day runs at 1.4x: a jade-green sky over a teal sea by day, a long gold double
sunset, a turquoise and violet dusk and a deep blue-green night. Saturation 1.04.

The sky: a ringed gas giant (`giant` backdrop) hangs ahead and to the left of the spawn, ~0.2
rad in angular radius, 0.3 rad up. It is a sphere ray-traced in the sky shader: cream, amber and
jade bands by latitude round a tilted pole, a pale oval storm, lit as a gibbous by the sun with a
dim night side and a soft limb; its rings are a disc in its equatorial plane with a gap, drawn
behind or in front of the planet as the ray meets them, shadowed by the planet behind it, and
their shadow bands the lit face. The air veils it by day and less at night. A second, smaller
white sun trails the first by 0.42 rad round the sky, a little lower (sky only; the scene keeps
one light), so every sunset happens twice. The suns go down to the right of the ship.

Plan: a shallow sea (~5 m) over pale sand with violet and amber moss beds, fairly clear water
(`waterClarity` 0.55) so they show through. Islets are low moss tables (3-8 m) rising in a
terrace or two, most of the sea (channels of water between them), rust ledges on their steps, carrying coil fronds
(a stalk whose top is still rolled up like a fiddlehead), fans of glassy reeds and clusters of glow bulbs.
Beyond the islets lies mainland: broad land a kilometre or two across (~21 % of the world, kept
240 m off the opening run and well clear of the ship), a flat moss shore rising inland into
rolling hills up to ~46 m, teal up their flanks and gold on their crowns, never cliffs (no
steeper than ~1.3 in 1); islets fade out where it begins. Plants thin out inland so the hills
read as open moss. Altogether ~58 % of the world is land. Basalt spires stand in groves on a 64 m grid, from 38 to 150 m: three silhouettes (needle,
stout column, jointed finger) lathed from one profile with a flared foot and knuckles, leaning
up to 0.15 m per m. The lean is a shear in each instance's matrix and every query follows the
leaning axis. The ship stands 470 m ahead of the spawn, its long axis turned almost across the
view: an original design, a ribbed seed pod of weathered ivory shell 176 m long, pointed at both
ends, a seam split along its back with a crack of light in it, nodes along the back and a lamp
under the belly, on four plain splayed legs. Its belly is 27 m over the water. Two tall spires
(150 and 124 m) stand past either end of it, leaning in a little. The opening run (spawn to
beyond the ship) is kept clear of islets and spires.

Alien things are spread over the land, one family designed for the level (ivory shell, copper
and orange accents, teal light): landing pods (upright teardrops on three thin legs with a
copper band and a lit hatch) set down in twos and threes; crystal clusters (violet and teal
six-sided shafts that glow faintly at night); and, rarely and only on bigger land, beacon
towers: a slim 45-55 m mast with two tilted copper rings turning opposite ways round it (in
the vertex shader, no matrix updates) and a teal tip that pulses after dark. Pods and crystals
stay under the frond canopy, so the bird glides over them; beacons are solid (slim at the mast,
wide at the rings), and now and then a ribbon loops round one at the height of its rings.

Flight: the water is the ground; skims throw a pale green spray. Fronds and reeds are soft
canopy. Spires, hull and legs are solid but soft, flown with the city's look-ahead and wall
glance. The hull is an ellipsoid the drawn pod stays inside (pulled in, never out): the bird is
pushed out of it along the ray from its centre, so down under the belly (nose eased down), up
over the back (a skim) and sideways at the ends. Its underside is in `hit`, so the look-ahead
eases under it rather than climbing. Music: a distant horn (two detuned saws through a lowpass
that swells open as the note speaks, sliding up into pitch) at 50 BPM, the slowest of any
level, over a deep wide sawtooth pad, an open-fifth drone and a slow arpeggio an octave up with
flow, in the biggest room. Suspended at dawn, lydian by day, whole-tone in the golden hour, dorian
at dusk and minor at night.

Wisps: the opening ribbon runs low across the shallows and straight under the middle of the
ship's belly (a third of the way up to it), then climbs on past it. After that: slaloms through
the groves (planned 16 m clear of stone: in a grove the look-ahead sees stone on both sides at
once), low skims over the water and the frond tops in a slow swell, and every few patterns a
swing round a spire over 90 m tall, at a height among its knuckles, far enough out to clear
its lean. Generic patterns (and their thermal spirals) only where no spire stands within 240 m.
No ribbon runs through a floater: the planner's clearance check includes the space each one
drifts through, and generic patterns ride over it (`wispFloor`).

Lived in. Believable here means a coherent alien ecology with a small explorers' presence, still
painted and calm. The ground is painted per pixel (`land.ts`) from a per-vertex `aRing`
(distance to a path, sand bar, mainland, islet): the moss is a carpet of small cushions in
patches of deeper violet, teal and gold (a light dappling, not tiles: a Voronoi cell with a
strong dome read as paving and was toned right down); the islets' terrace risers are basalt
columns with joints down them; every shore has a band of wet sand catching the sky, a lace of
foam swashing at the waterline and tide pools on the flats above it (something small glows in
some of them at night). Through the clear shallows the sea floor shows sand ripples, the moss
beds as clumps and, after dark, spores in the beds that glow and twinkle. Sand bars wander over
the open shallows (the zero contour of a stretched noise, off the opening run and the ship),
just awash in stretches and a pale shoal elsewhere.

Basalt: the spires are bundles of columns, painted per pixel (`rock.ts`): each column a flat
face (the shading normal turned to its middle, so the toon bands step face to face), its own
cool or warm grey, thin joints, and cross joints at its own spacing with a pale lip, half of
them whole. Column widths wander (a periodic noise warps the angle) and they follow the lean
(cut from the mesh's unit space). Joints and cracks fade where a pixel spans much of a column,
so far spires never show a grid. The meshes are finer (14 x 26 near, 8 x 10 far). On the islets'
terraces, clusters of hexagonal column stubs step down the risers.

Ground cover (`cover.ts`): violet moss tufts on the islets and teal on the hills, moss
cushions, trumpet flowers (a curving stalk, a pink bell lit gold inside) and spore puffs among
them, drifts of teal, magenta, gold and lilac blossoms; dark sea moss in the beds under the
water; bare on the wet sand, the paths, the bars and the rock.

Explorers: whoever came down in the landing pods camps by them. About three groups of pods in
four have an outpost: one or two domed habs (a pale shell on a pad, round windows lit teal, an
entry tunnel with a warm door, crates stacked by it), a mast with a dish and a pulsing tip, and a
lit path from the pods to each, lamps either side; the paths and the trodden ground round each
hab are painted with lit studs along their edges. A camp stands on a sand spit beside the ship
(on the spawn's side, toward its right end, its own little island: islets and mainland keep
off it): three habs in an arc facing the ship, an awning over a table and crates, two masts,
lamps along the spit and down to the beach, a skiff moored off it. All of it is soft (under the
canopy, glided over).

Life: glow bulbs (three on nodding stalks, teal, gold or violet) in clusters on the moss;
schools of slim fish with glowing flanks circling in the shallows; herds of grazers on the
mainland's hills: pale six-legged beasts with a violet frill and a long neck that sweeps down
to the moss, shuffling round their patch with a tripod gait; and floaters, jelly-like bells 6 m
across with ribbon tendrils, drifting high on slow circles over the sea and the islets (35-80
m up), bobbing and pulsing, rims and tendril tips glowing after dark. Moving things follow a
circle round their instance's origin in the vertex shader (radius and direction from a hash
the scatter shares, as on the atolls), and every circle is checked: fish in water at least 1.7
m deep and clear of stone, grazers on level moss (within 0.6 m all round) clear of stone, the
alien things, the paths and each other, floaters clear of every spire, beacon and the ship,
tendrils and all, and off the opening run.

Light: one directional light, so the level adds two fills in its own materials (`materials.ts`,
`withMoonLight`): the giant's light, a wrapped diffuse from its side of the sky in its cream
colour (strongest when its face toward us is lit, the ringlight's teal after dark), and the
second sun's from where it trails the first, so faces in the main sun's shade get a soft warm
side. Strengths in `levelLight.ringmoon` (`giant`, `sun2`). Props glow from a per-vertex
`aGlow` (crystals faintly, bulbs, hatches, windows, lamps, fish, floaters; the beacons' tips and
the masts' lights pulse): a little by day, HDR after dark for the bloom. On high, spires,
landing pods, habs and beacons cast sun shadows through near-only proxies, and the ship (one
mesh) casts too; pods, habs, masts, crystals, beacons, bulbs and steps get contact shadows on
medium and high.

- Code: `world/ringmoon/`: `RingmoonLayout` (pure: plan, spires, ship, alien things, the camp,
  sand bars, outposts, floaters, life circles, queries), `RingmoonScatter` (pure: fronds,
  explorers' parts, bulbs, steps, fish, grazers), `RingmoonDecor` (instancing, LOD, casters,
  contact shadows), `land` (the ground's paint), `rock` (basalt), `cover`, `materials` (fills,
  glow, the life's motion), `shapes` (explorers, life, cover shapes), `geometry` (spires, ship,
  flora, pods near and far, beacons, crystals), `RingmoonWisps`.
- Per preset (`render.*`): outposts, camp, bulbs, steps, grazers and pods' near shapes within
  `propDistance` / `propDetail` (pods beyond use a tenth of the triangles); fish within
  `smallPropDistance` (none on low); cover in the shared grass ring (none on low); fronds and
  reeds have distant shapes beyond `treeFar`. Low keeps the finer spires for the nearest 160 m.
- Cost at the review's viewpoints (triangles / draw calls, whole frame): medium 238-287k /
  124-143 (was 289-311k / 113-134), high 400-480k / 134-168 (was 473-491k / 121-155), low
  135-159k / 91-104 (was 153-179k / 87-100). The distant fronds and far pods pay for the rest.

## Gameplay

Wisps in arcs/ribbons ahead of the player. Quick chains fill a flow meter (score multiplier,
music intensity) that decays slowly. Every N wisps a lantern lights up with a celebration and the
music modulates. A lit lantern is an optional destination: flying through its light refills
flow, pays a bonus and gives a surge of speed and lift. Minimal HUD that fades when idle: the
flow ring round the wisp count and the lanterns reached. The score is kept for the pause menu and
the Rest card, out of the sightline while flying, and a reached lantern says "Lantern reached"
without its points (light and the bell say the rest). Only the first lantern to light gets a
toast. Start screen, pause menu (volume, quality, invert-Y), settings and best score in
localStorage.

## Destinations (built, every level)

Players said the game felt good for a while and then aimless, and they lost interest within the
first flight: following wisps has no beginning, middle or end. So each flight is now a run of
journeys. A **beacon**, a tall column of warm light, rises over a landmark far ahead; the
wisps lean toward it, so simply following them gets there; reaching it ends the journey with a
flare, a surge, a held chord, flow refilled, "<name> reached" and 40 light (a lantern gives 10).
Seven seconds later the next beacon rises. Calm by design: no clock, nothing to fail or miss,
and a missed approach is just circling back.

- Pacing: the first beacon rises 4 s into a flight ("A beacon rises over Hidden Window", queued
  behind any hint), at least 1 km along the way (about 40-80 s). Later ones are at least 1.6 km
  along (about a minute or two). A bird that strays more than 5.2 km from a beacon gets a nearer
  one. Only while playing: the title's bot flies with no beacon.
- The Rest card lists the flight's journeys ("Journeyed to Hidden Window · Owl Gate").
- Red Canyons: the destinations are the canyon arches (never the Great Arch, which the opening
  ribbon already threads). From the bird, a walk snaps to the nearest canyon's centre line and
  follows it the way the bird faces until a canyon arch far enough along; its route is that
  centre line. Only ahead: a destination behind would turn the ribbon back past the bird, so with
  none in reach (4.6 km) there is none for now and the tracker asks again 5 s later. Each arch
  keeps its name (a first word and a kind from its seed: "Coyote Arch", "Hidden Window").
- The canyon planner leans its trend along the route (toward the point 320 m past its nearest
  one). While the cursor is down in the canyon within 250 m of the route, its runs follow the
  route's own direction there (aiming ahead cut across hairpins and sent the ribbon over the
  rim), and on the last 680 m they come down to the floor from any height, so the ribbon threads
  the arch. The generic patterns stay out while a journey is on.
- Arriving is flying **through the beacon's light**, as with a lantern: within 18 m of its axis
  (`Config.destinations.reach`), at any height down to 15 m below its foot. At first anywhere
  near the landmark counted; the stray joining then felt unearned. So the column stands where
  the route ends, where the ribbons run: in the arch's opening, on the river or fjord beside
  the landmark, beside an isle, spire or high island, on the avenue round Neon Bay's centre
  block, over a town or outpost. The cairn and its stray stay by the landmark itself.
- Leading through it: within `goalLineUp` (260 m; Neon Bay 455 m, its grid turns ribbons away)
  every open-country planner flies straight at the column, and the ribbons and their planner
  share one `GoalLean` that notes each wisp laid: a ribbon that runs 250 m past without one
  in the light turns back for another pass. The beam fades near its axis only to a quarter
  (it used to vanish within 200 m, fine when passing near was enough).
- The beacon (`world/Beacon.ts`): an additive cylinder, brightest facing the camera, fading
  upward and near its axis (so flying into it never floods the screen). The far plane follows
  the draw distance (845 m on low quality) and a beacon can be 4 km off, so the vertex shader
  draws a far one at 85 % of the far plane along the same line of sight, scaled about the camera
  (the projection is unchanged), widening with distance so it stays a stroke on a phone.
- Tested headless: the bot (no flaps, no eyes for the beacon) gets its first arrival in 42-80 s
  on six seeds and about four in six minutes on most. It can lose the ribbon round a tight
  hairpin (one seed manages two), which a player looking at the beacon would not.
- Code: `world/Destinations.ts` (pure: `Destination`, `DestinationSource`, `DestinationTracker`),
  a level's source as `World.destinations` (`world/canyon/destinations.ts`), the planner's
  optional `WispPlanner.setGoal(route)`, `arrival`/`destination` events (light in `main.ts`,
  `Music.arrived`), `Config.destinations`.
- Next: approach courses with calm medals (gates threaded, no clock).

### Every level's destinations

Two shapes of journey, both in shared code, each level giving only its landmarks:

- **Walks** (`world/walk.ts`) where the level's natural ways are channels along a noise's zero
  contour: down the bird's own channel, the way it faces, to the first landmark beside it far
  enough along; the route is the centre line, the way the ribbons already run. Red Canyons (its
  own walk, the first), Jade River (stone bridges, and pagodas standing over the water) and
  Aurora Fjords (fishing villages on the strand, waterfalls down the walls).
- **Picks across open country** (`world/landmarks.ts`): the landmark ahead (within a cone, then
  anywhere) nearest ~1.3x the least distance, and a straight route to it, ending beside a solid
  landmark (`aside`) or at an open way in (`end`). Highlands (the floating isles: beacon from the
  top, cairn on the turf, the route beside the isle, never under its hanging rock), Neon Bay
  (lattice towers, the beacon from the top, and grand shrines; arrival anywhere round the
  centre block, since the avenues are ~120 m off), City of Gold (hill towns, found by sampling
  the town field on a 420 m grid, a town's towers being too costly to build for a search; the
  cairn on its roofs), Sea of Clouds (spires 150 m and up, the cairn on the summit), Coral
  Atolls (each atoll's high island, beacon from its fang and cairn on its beach, else its
  stilt village) and Ringmoon Shallows (the explorers' outposts, the cairn at the end of the
  lit path).
- Never a hidden find: not the Highlands isles' undersides, Jade River's summit pavilions, the fjords'
  lighthouse, Sea of Clouds' hermitages and monastery, the home atoll, Ringmoon's beacon towers
  and ship. City of Gold's Old City stays the opening ribbon's.
- Grids with small cells (pillars 72 m, spires 100 m, Ringmoon's props 130 m) are sampled every
  third cell: thousands of cells over a 4.6 km search would thrash the layouts' cell caches.
- Leaning the ribbons (`world/goal.ts`, `GoalLean`): every planner's trend becomes the way to
  the goal (the aim 320 m along the route past its nearest point), and its detours (swings and
  spirals round a landmark, reef-ring runs, tower spirals) wait until the journey ends; they
  lead the bird off the way. On the open levels a ribbon that overshoots by 500 m without the
  bird arriving turns back (the ribbon runs ~400 m ahead of the bird, so less is usual). The
  generic patterns (the Highlands have no planner) turn toward the goal at most 0.6 rad a
  pattern, along the lowest way within 1.35 rad of it, and straight in on the last 680 m:
  snapping each pattern at the goal sent ribbons up hills no gliding bird could follow, and
  drifting there missed isles by 150 m. Neon Bay's runs set off along the avenue axis toward the
  goal unless that turns back on the ribbon (a U-turn ribbon runs back past the bird, which
  loses it, and the ribbon restarts ahead of the bird for ever); while the goal lies well off to
  one side the ribbon glides over the roofs, turning a little each time.
- Tested headless (`tests/journeys.test.ts`, four seeds, six minutes, through the light): bars
  set at what the bot manages. Best: Red Canyons and Aurora Fjords (4 journeys a seed). Hardest:
  Neon Bay (the street grid: 4 arrivals, two seeds none, and the bot glances walls about twice
  as often as without a journey); Jade River, City of Gold and Sea of Clouds each have one seed
  that arrives nowhere in six minutes.

### What waits there: a lit cairn and a stray (built)

Step 1 left the destination an ordinary arch: nothing said "you have arrived somewhere". Now
each destination has a **cairn** (stacked sandstone, ~3 m, a lantern on a post that flickers
and glows brighter at night, sparks rising from it while its bird waits), standing on the floor
inside the opening beside one leg, out of the river and well under the ribbon's line, so it is
framed in the arch on the way in. On its top stone perches a **stray**, wings folded. On arrival
it takes off and joins the player's **flock**.

- The flock is kept for good (the save's `flock`: each bird's plumage, oldest first, up to 400)
  and flies with the bird in every level, on the title's backdrop too, so progress is something
  seen, not a number. A screen holds the newest 12; the rest are kept and counted. The first
  bird ever is announced ("A bird joins your flock"); after that, seeing it join says it.
- Where they fly: round and a little ahead of the bird (4.5-15 m), not in a V behind it. The
  camera sits 6 m behind and, on a phone held upright, sees a narrow cone: a trailing V would be
  off screen or in the lens. Each slot's sideways reach grows with how far ahead it is (the view
  widens), slots are spread by low-discrepancy sequences (any flock size fills the space and a
  bird keeps its place as more join), and they drift slowly. A little below the bird on average:
  the camera is 1.5 m up, so it sees their backs, not edge-on wings.
- How they follow: each bird's offset from the bird springs (critically damped, its own
  stiffness) toward its slot turned by the bird's heading and pitch. Offsets, not positions: a
  world-position spring trails 2v/w behind (30 m at a Phoenix's cruise); offsets keep up at any
  speed and lag only in turns, so the flock swings round a bend together. A joining bird starts
  from its perch's offset and climbs to its place, flapping. They flap when the bird flaps (each
  a little late), while it climbs, and now and then on their own; otherwise they glide with
  wings in a V. The level's `pushPoint` and flight floor keep them out of rock and off the ground.
- Look: one instanced mesh (~60 triangles a bird, wingbeat and fold in the vertex shader from a
  per-vertex `aWing` and per-instance `aBird`), near-white vertex shading times a pastel tint
  (eight, `world/flockTints.ts`: the save keeps indices, so the list only grows), and the
  player bird's trick of a soft self-light on faces turned away. Grey shading times mid-toned
  tints read as dark brown blots against red rock; flat wings from behind read as dotted lines.
- The Rest card adds "A bird joined · a flock of 7" under the journeys. `?flock=N` flies N birds
  for screenshots without touching the save.
- Code: `world/Flock.ts` (mesh, springs, perch), `world/formation.ts` (pure: slots, the
  heading-turned offset, the spring; tested), `world/Roost.ts` (the cairn), a destination's
  `roost` and `tint`, `Journey.joinFlock`.

## Progression (proposed)

Status: steps 1-7 of the build order are built (light, the track, saving, journey bars, unlock
notices, the Rest card, level locks, the Aviary with plumages and trails, the shared bird rig,
the Swallow and the Crane), and the Phoenix, the final bird; the rest is design.
Direction (revised): players should work toward a mix of things, led by **new birds that fly
differently**, then **discoveries** in the levels and **bird mastery**; plumages and trails stay
as a cheap cosmetic extra. Goal: every short flight (2-10 min) moves something
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
always close. Only what can be used is on the track: the Swallow and the Crane were taken off it
until they could be flown (a milestone that opens nothing is a broken promise), then came back
earlier than first planned, since new birds are the heart of it.

|    ✧ | Unlock                                         | Flight (~180 ✧ each) |
| ---: | ---------------------------------------------- | -------------------: |
|    0 | Highlands, the Tern, Sea plumage, Breeze trail |                start |
|  120 | Ember trail                                    |                    1 |
|  300 | **Neon Bay**                                   |                    2 |
|  480 | **Swallow** (and its own plumage)              |                    3 |
|  750 | **Jade River**                                 |                  4-5 |
|  950 | Dusk Rose plumage                              |                  5-6 |
| 1100 | Jade Mist trail                                |                    6 |
| 1250 | **Aurora Fjords**                              |                    7 |
| 1500 | Frost plumage                                  |                  8-9 |
| 1650 | **Crane** (and its own plumage)                |                    9 |
| 1800 | **City of Gold**                               |                   10 |
| 2050 | Aurora trail                                   |                11-12 |
| 2300 | **Red Canyons**                                |                   13 |
| 2550 | Gilded plumage                                 |                14-15 |
| 2800 | **Sea of Clouds**                              |                16-17 |
| 3050 | **Coral Atolls**                               |                   17 |
| 3300 | **Ringmoon Shallows**                          |                18-19 |
| 3550 | **Phoenix** (and its own plumage): the end     |                   20 |

From the Aurora trail on, milestones are 250 apart (about a flight and a half), so each of the
last worlds gets its own Rest card; they used to bunch up (3000, 3150, 3230 and 3300).

The Phoenix is the last milestone of the track, whatever comes later: the Falcon and the
Albatross will fill the stretch between Red Canyons and it. Beyond it, light keeps counting on the title screen (an open question: maybe a rare plumage
every 1000).

- The track's thresholds are `Config.unlocks` (one number per milestone id, so the debug panel
  retunes them); the light per event is `Config.journey`; names and kinds live in `Journey.ts`. Unlocks are worked out from light, plus a `granted` list written whenever something
  unlocks, so a later retune can grant things but never take them back.
- Existing players: any level with a saved best score above 0 counts as unlocked from the first
  run, so nobody loses a world they already fly.
- `?level=` still opens any level (for development) but does not unlock it. `?journey=N` sets
  light for testing. `?unlocked` opens every level on the picker for that session without
  granting or saving anything.

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
- Hints are lessons, each learned by doing it once and saved in the settings (`taught`), so a
  returning player flies without a word. "Follow the wisps" until a wisp is gathered; at 3.4 s
  "how to steer" (the one thing a newcomer must know) until the player has steered for most of a
  second; then, once steering is known, "how to boost", at most once a flight, until the first
  flap. A hint waits for a free toast. Toasts sit below the bird (it flies at about 58% of the
  height), never on the horizon where each level's opening landmark rises. A save from before
  lessons were kept that has light already knows the wisps and steering.
- The title screen shows the same journey bar under the level cards.

### Level locks

Open levels show, plus only the next locked one, dashed and dimmed, with its name and "Opens at
750 ✧" in place of the blurb, so the next world is something to look forward to; a line under
the cards says how many more lie further along. (All nine used to show, which on a fresh save
read as a wall of locks and pushed Aviary and Controls off an iPhone SE.) Tapping the locked card
does nothing but glow the journey bar below (that is where the answer is). An open level not
flown yet (no best score) wears a small "New" mark until it is flown. A saved pick that is
still locked (picked but never flown before locks existed) falls back to the Highlands, so the
attract flight behind the title only ever flies open levels. `?level=` still loads any level.

### Aviary (birds and cosmetics)

Built: a title-screen panel (beside Controls) with three tabs, **Bird**, **Plumage** and
**Trail**, one row showing at a time so the card stays short on a phone and has room for more
birds. The Bird row says what the picked bird does (tapping a locked bird says so too). Picking a
bird puts on its own plumage, which the player can then change. Locked items keep their name and
a faded swatch and say when they open; tapping one glows it (and, on wide screens, the panel's
journey bar). Picking one dresses the attract-flight
bird behind the menu at once: that bird is the live preview, so no second renderer is needed. The
card stands aside (left on wide screens, low on tall ones) so the bird stays in view, and the
trail is held visible (`Config.aviary.trailPreview`) since the bot's glide is too lazy to show it.
Picks persist in the settings (`species`, `plumage`, `trail`); a pick whose milestone is not open (picked in
a `?journey=` or `?unlocked` session) is not worn but not forgotten either. Unlock cards for
birds, feathers and trails point to the Aviary.

- **Plumage** is a palette of colour roles (belly, back, cap, wing lead / trail, covert, dusky
  edge, underwing, bill, primary base / mid / tip, tail base / tip): today's constants at the top
  of `Bird.ts`, gathered into a `Plumage` record (`player/Plumage.ts`). Every painted part of the
  bird registers its painter, so a plumage change repaints the colour attributes in place
  (menu-time, not a hot path); Sea is byte-identical to the bird before plumages. Every
  species has its own signature plumage, plus the shared set (Sea, Dusk Rose, Frost, Gilded),
  which reads through the same roles. Plumages are checked against all six levels at dawn,
  midday and night, so the bird never vanishes into a palette.
- **Trails** (`fx/TrailStyle.ts`) set the wingtip ribbon's tip and tail colours: Breeze (today's
  white), Ember, Jade Mist, Aurora (drifting between green and violet along the ribbon and over
  time). Flow still warms the ribbon toward the wisp colour, fully on Breeze (as before) and only
  a little on the coloured trails so they keep their hue. Wisps, lanterns and pickup particles
  never change colour: they are gameplay and must read the same everywhere.

### Species

The heart of the progression: each bird is a new way to fly. Planned: the **Tern** (today's
bird, the all-rounder), the **Swallow**, the **Crane**, then the **Falcon** and the
**Albatross**. Each is a trade-off, none is strictly better, and every stat change stays within
±15 % so the wisp planner's assumptions (15 m spacing, ≤6 m rise per wisp) hold for all of them.

Revised: stat multipliers alone read as "a little different", so each bird also gets one
**signature move** that changes how a level is played. No move is ever required: every wisp
path still works for every bird; a move only makes some lines easier or more fun. Phone first
means no new input: a signature is either **passive** (it happens when the bird does something it
already does) or a bird's own version of an **existing trick** (same gesture, different move).

| Bird      | Feel             | Signature                                                                                                                                 | Shines in                  |
| --------- | ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| Tern      | All-rounder      | The dive-bomb stoop (already in)                                                                                                          | Everywhere                 |
| Swallow   | Quick, darting   | **Flick**: its roll is a sharp sideways dart with a little speed (the roll gesture); **skim**: flying low over water speeds it up (built) | Neon Bay, Jade River       |
| Crane     | Slow, stately    | **Thermal rider**: thermals lift it 1.8×; dive speed carries further (built)                                                              | Highlands, City of Gold    |
| Falcon    | Fast, heavy      | **Stoop master**: its dive-bomb (the dive gesture) builds speed faster and deeper; weaker climbs                                          | Red Canyons, Aurora Fjords |
| Albatross | Long, lazy wings | **Updraft rider**: lift along cliff faces and over waves, rarely needs to flap; turns poorly                                              | Aurora Fjords, coasts      |
| Phoenix   | Blazing fast     | **Speed**: cruises at 1.6× everyone's speed; glows and sheds embers (built; the final bird)                                               | Open country, night        |

- The first new bird comes early: the Swallow is at 480 ✧ (about flight 3), with Dusk Rose and
  Jade Mist moved on to 950 and 1100. Players who already had them keep them.
- A bird joining the track after players have passed its threshold still gets its Rest card:
  saves record the track they have `seen`, and a milestone opened on load is revealed quietly
  only if it was on that track (a retune lowered it), not if it is new (saves from before the
  list count as having seen everything but the Swallow).

- **Swallow** (built): quick and darting. Small and compact, a round head with a tiny bill, a
  short arm and a long hand of close-packed primaries swept back into a sickle (held swept in a
  glide), a deep forked tail with streamers; its plumage is a steel-blue back (a mid blue, so
  it reads against a night sea), rust face and throat, cream belly. Flight: turn rate and
  response ×1.2, flap cooldown ×0.85, flap lift ×0.9, speed above cruise bleeds ×1.15 faster
  (agile, but a dive doesn't carry as far); quicker wingbeats (×0.78); camera ×0.9. Its roll is
  a dart: ×2.4 the sideways hop (~12 m a turn) and +4 m/s as it starts. **Skim**: within 5 m of
  water it gains up to 8 m/s² (full at the surface), and touching water costs it nothing. The
  first idea, a gain only on contact, did nothing: the soft altitude floor and terrain assist
  keep any bird off the water but for a few frames a bounce, so the cushion is a height band
  instead. Cruise relaxation balances it: a long skim settles near 50 m/s, never runs away.
- **Crane** (built, 1650 ✧): slow and stately. A long neck held straight out (the torso lathe
  drawn out, painted from `torso.neck` in the throat colour, so it flows from the breast without
  a seam), a small head with a long horn bill, long legs trailing past a short square tail, long
  broad wings whose five primaries spread like fingers. Its plumage is pale ash grey with a
  black neck and face, black fingertips and a red crown patch: the cap edge is part of the
  shape (`head.cap`), since the Tern's dark cap runs down the nape and the Crane's red must not
  (from behind it read as a red ball). Flight: turn rate and response ×0.85, flap lift ×1.15,
  flap cooldown ×1.2, speed above cruise bleeds ×0.8 (after a dive it keeps ~2 m/s more than the
  Tern 3 s later), wingbeats ×1.35 slower, camera ×1.12. **Thermal rider** (passive): thermals
  lift it 1.8× as hard (`FlightTuning.thermal`), so a column it finds carries it high.
- **Phoenix** (built, 3300 ✧, the final bird): a creature of fire, our own design (a fiery
  phoenix in general, not any game's character). A slim body under a tall crest, a short hooked
  bill, long wings whose primaries fan like flames and a fan of eight long tail plumes. Its
  plumage runs gold, flame orange and crimson to rose tips and is self-lit (`PlumageDef.glow`,
  a shader uniform 0 for every other plumage; it flickers gently), so it blooms and reads at
  night. It sheds embers (`species.embers` per second) that leave with 90 % of its velocity and
  light drag: first they were left standing in the world, and the camera (6 m back at 40 m/s)
  flew through them, so they ballooned into blurs at the lens. Flight: `speed` ×1.6 (cruise and
  minimum, ~42 m/s), `topSpeed` ×1.3 (~88 m/s), and turn ×1.45 so its turning circle (speed /
  turn) stays near the Tern's: the rule for every bird is now that circle, not the factors
  alone. Its roll hops ×1.5. In 90 s of the bot it gathers ~50 % more wisps than the Tern in
  Neon Bay and the canyons (it covers more ground) and never glances a wall there.
- Jade River's pillar slaloms are the hard case for the slow-turning and the very fast: the bot
  gets 72 % (Crane) and 79 % (Phoenix, three soft glances) of the Tern's wisps there. That is
  each bird's trade-off, as designed; if players find it frustrating, the Crane's turn is the
  first number to raise.
- **Falcon** and **Albatross**: shapes and numbers to design on the rig.
- A species is a `SpeciesDef` (`player/Species.ts`): a `BirdShape` (`player/BirdShape.ts`: torso
  profile, head, bill, crest, feet, tail, wing arm / hand outlines, arch, primaries, glide
  sweep), its own plumage, and its `Config.species` entry: `FlightTuning` multipliers over
  `Config.flight` and `Config.tricks` (the Tern's are all 1 and 0, so its arithmetic is the bare
  model's), chase distance and wingbeat tempo. All species share one rig, so the pose and
  wingbeat code drives every bird; `Bird.setShape` rebuilds in place, so the scene node and
  wingtip anchors stay the same objects. The Tern on the rig was checked identical to the bird
  before it: every mesh's geometry, colours and transform match exactly.
- Tests fly each bird's tuning through the bot over Neon Bay and the canyons, each on a fresh
  world (a world's wisp planner keeps state between flights, which once made the Tern score 116
  against its own 153): every bird must gather at least 90 % of the Tern's wisps.
- Saves from before `seen` existed count as having seen everything but the birds added since
  (`ADDED_LATER` in `Journey.ts`), so a bird new to the track always gets its card.
- The Aviary's picks are `border-box` and, on a phone, 59 px: four to a row on an iPhone SE
  (its row is 254 px), so four birds or seven plumages stay within two rows and the card ends
  well above the bird. The portrait card rule is `.menu.aviary .card`: the general rule comes
  later in the sheet and silently won with `.aviary .card`.

### Discoveries (built) and bird mastery (proposed)

The "mix" beyond birds, and what gives the cosmetics a purpose beyond light:

- **Discoveries** (v1, built): three hidden moments per level, never on the wisps' ribbons (a
  test flies the bot through every level by day and by night and makes none), so following the
  wisps never stumbles on one: they are for the curious.

  | Level             | Finds                                                              |
  | ----------------- | ------------------------------------------------------------------ |
  | Highlands         | atop a floating isle, beneath one, above the clouds                |
  | Neon Bay          | the crown of a tall tower, up the river (low, 3 s), across the bay |
  | Jade River        | a summit pavilion, round a tall pillar, the paddies by moonlight   |
  | Aurora Fjords     | round the lighthouse, an iceberg's back, under the aurora (night)  |
  | City of Gold      | over the golden dome, along the old walls (4 s), round a tower     |
  | Red Canyons       | over the Great Arch, through a far arch, a hoodoo's cap            |
  | Sea of Clouds     | the monastery, a hermitage lantern, among the stars (night)        |
  | Coral Atolls      | over the bungalows, the fang's summit, round the fang by moonlight |
  | Ringmoon Shallows | round the old ship, along its back, round a beacon's rings         |

  A find is a pure test in `world/<level>/finds.ts` against the layout (a place, a place held
  for a few seconds, or a full turn round a pivot), looked at ten times a second while playing.
  In flight it is only light and a chime: a burst of gold, a soft flash and three high notes,
  no words. The Rest card names the flight's finds ("Found: Over the Great Arch"), each gives
  25 light, and each open level's card marks them in its corner (●○○). Saved in the journey
  (`found`). Night finds come round with the day, so nothing is missable. Not yet: finding a
  level's set opening its plumage, and Ringmoon's ship lighting a pair of its nodes per level.

- **Bird mastery**: three gentle goals per bird that teach its signature (e.g. "Swallow: flick
  through five wisps in a row"); finishing them opens that bird's plumage and trail.

### Save format

`driftwing:journey` = `{ v: 1, light, granted: string[], revealed: string[], seen: string[],
found: string[], flock: number[] }`,
loaded with the same guards as settings (bad or missing fields fall back to defaults; storage
errors mean no progress is saved, never a crash). `revealed` makes each unlock card show once;
`seen` is the track as the save knew it (see Species). The Aviary picks (`species`, `plumage`,
`trail`) are settings: `driftwing:settings`.

### Code shape

- `core/Journey.ts` (pure, Vitest): the track, light for events, `bank(state, delta)` returning
  newly unlocked items, `nextMilestone(light)`, `isUnlocked(state, id)`.
- `main.ts` wires the events (`wisp`, `lanternReached`, `trick`) into the journey while
  `playing`, and banks at the points listed above.
- `ui/Menu.ts`: journey bar, locked cards, Rest card, Aviary panel. `ui/Hud.ts`: unlock toast.
- `player/Species.ts` (the birds) + `player/BirdShape.ts` (their bodies) + the shared rig in
  `Bird.ts`; `player/Plumage.ts` for the palettes; `Config.species` for how each flies.

### Build order

1. Light + journey core + banking + journey bar (title, pause) + unlock toast. (built)
2. Rest card. (built)
3. Level locks. (built)
4. Plumage roles + trails + Aviary panel (Tern only); birds off the track. (built)
5. Bird rig refactor (Tern unchanged, checked part by part). (built)
6. The Swallow: shape, multipliers, the dart and the skim; the Aviary's Bird tab; back on the
   track, earlier. (built)
7. The Crane and thermal riding. (built)
8. Discoveries: the journal and one or two levels first.
9. The Falcon and the Albatross, then bird mastery.

## Audio

Generative ambient on Web Audio: detuned pads -> lowpass -> synthesized convolution reverb,
sub drone, sparse pentatonic bells on a slow grid. Wisp pickups play the next note of a phrase,
quantized to the grid. Speed opens the filter, altitude shifts voicing, flow adds arp/shimmer.
Key drifts with the day cycle. Each level has a `MusicStyle` (`audio/styles.ts`): keys, tempo,
progression, voice (bell, koto, guqin, glass, oud, guitar, flute), pad, drone fifth, reverb, arpeggio, beat. SFX: flap whoosh, speed-scaled wind, splash. Lookahead scheduler.

## Decisions log

- Three.js WebGLRenderer + `three/examples/jsm` postprocessing (WebGPU is not yet broadly safe on phones).
- Fixed 60 Hz physics step + interpolated rendering so feel is frame-rate independent.
- Playwright (headless Chromium + SwiftShader) for automated screenshots during development.
- Neutral input = level flight (no slow sink). Gliding should never feel like a resource drain;
  flaps and thermals are for climbing and fun, not for staying aloft.
- Climb authority fades near min speed, so "hold up" levels off instead of stalling.
- Terrain assist: the model samples the ground ~1.4 s ahead and lifts the nose to clear it.
- Ground floor: players said bumping the ground broke the immersion, so over land (terrain, canopy,
  roofs, the cloud sea: everything `groundAt` reports above the water) the bird keeps `groundHeight`
  (4 m) clear and never scrapes. It is a cushion, not a wall: near the floor the nose-down allowance
  fades to level (`groundCushion`, judged `groundLead` s ahead at the current sink rate so a fast dive
  eases out early), and the terrain assist asks for a wider berth. The hard clamp is only a backstop
  for steep slopes: no bounce, no lost speed, and no dust or sound (`Game.step` only emits a ground
  `contact` when a level's `collide` reports a wall strike, which still glances off). Water is
  unchanged (splash, bounce, the Swallow's skim); the margin blends between the two over `shoreBlend`
  metres of terrain above the shoreline. Tuned in `Config.flight`.
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
  Hints are lessons learned by doing (see "In flight and the Rest card"): the wisps, then
  steering, then boosting, each saved once learned.
- Pause: P/Esc, the touch pause button, losing pointer lock, or hiding the tab. Music ducks.
- Settings (volume, mute, quality, invert-Y, touch steering) and best score persist in localStorage (guarded).
- Adaptive quality (`AdaptiveScale`, numbers in `Config.adaptive`): frames are judged in
  one-second windows by their share of slow frames (over 21 ms), never by an average, so the
  burst of long frames that streaming causes cannot trigger a drop. Two slow windows in a row
  drop the render scale 0.15 (floor 0.55); six fast ones raise it 0.1, and a raise that is
  undone within 12 s doubles the wait for the next (up to 2 min), so the scale settles instead
  of sawing. In Auto quality, hitting the floor steps the preset down. Phones default to
  Medium. Pixel ratio is capped per preset (max 2).
- The render scale resizes only the composer's targets; the canvas keeps its size and the last
  pass upscales onto it. Resizing the canvas clears it, and doing that after the frame was drawn
  presented a blank frame at every change (the picture cut out every few seconds on phones).
  The adaptive step also runs before the frame is drawn, not after.
- Streaming never does a row of work in one frame: a chunk is built in stages (terrain, the
  level's extra attributes, scenery) with the 2 ms budget checked between them; props that
  scatter lazily do so one chunk a frame (`ChunkDecor.prepare`), and the instance refill waits
  for them; contact shadows cache each blob's ground frame; instance buffers upload only the
  instances in use (`world/instances.ts`), not their worst-case capacity.
- Per-pixel cost on a phone held upright, where land fills most of the screen: the sky is drawn
  after the opaque scene and depth-tested at the far plane, so its shader runs only where sky
  shows; the terrain's painted relief takes one noise sample and screen-space derivatives
  where it took six samples (it fades out where a pixel is wider than the dabs).
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
- The city's waterfront is cut from two distances per ground vertex (`aEdge`): metres inland of
  the seawall (along z: the shores run east-west and curve gently) and metres back from a river
  bank's top (the river noise's distance from its bank value over its gradient). Both are smooth,
  so the shader cuts crisp bands from their interpolation even on the coarse LOD. The layout uses
  the same two (`shoreDist`, `bankDist`) to keep buildings, trees and expressway piers off the
  promenade, the bayside road and the river walks, and tests check it.
- Bridges were one flat stone box at 3.3 m: no asphalt or lanes, and the road beside a river is
  0.3-0.5 m higher, so the road's ground hid the deck's ends behind a ragged edge and cars sank
  into it. Now the deck's road surface (`BridgeDecks`, which paints the expressway decks too)
  is drawn with the ground material, whose
  street pass reads only world position (the deck's `aEdge` says "far from any bank"), so the
  markings line up with no new shader. Its height comes from one query, `CityLayout.deckAt`, used
  by the traffic too. A crossing is the run of the road line between bank tops sampled across the
  road's whole width (a slanting crossing reaches one side first), owned by the superblock that
  holds its middle so a river on a superblock edge gets one bridge. Over a river mouth the bayside
  road's deck slopes between the ground at the ends of its run in the same way.
- Neon Bay's realism pass (towers, stepped tops, medians, paving, gap filling, expressway
  lanes, car bodies) moved the city's wisp routes. Measured over 16 seeds x 4 minutes the bot
  did better than before (1.30 wisps/s and 0.66 wall glances a minute, from 1.11 and 1.81), and
  the Crane's share of the Tern's haul rose (0.67 from 0.63 over 8 seeds), but single seeds
  swing either way (a different tower ahead sends the bot somewhere else entirely). So the city's
  bot test and the species test now pool their bars over several seeds instead of one or two.
  Costs: a superblock takes ~15 % longer to lay out, and the view ~17 % more triangles (mostly
  12-triangle boxes: medians, walls, tiers), with draw calls unchanged but for the new car
  bodies.
- The terrain mesh (4 m quads) can only draw a river bank as a ragged ramp, so the embankment walls
  (6 m segments, each cell of a 4 m lattice stepped onto the wall's middle line) cover the slope
  from the channel's edge to just past the top; a segment that touches a bridge keeps whichever
  half is clear, and the bridge's abutments reach 3 m past its sides to meet them.
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
- More believable places, same cartoon style (players asked for detail, not smoother facets):
  first the shared layer every level gets (see Rendering), then each level's own life (fields,
  villages, animals, paths), a few levels at a time. A Highlands prototype of the whole look was
  approved as the reference.
- Shadow map on high only, soft and partial: a full-strength map turns shade into black cut-outs on the
  toon bands; ~0.55-0.6 reads as painted shade. Casters are near-only proxies on layer 1, since
  instanced meshes are never culled. `castShadow` changes only with the preset or level (a
  one-off recompile of lit materials, a short hitch when Auto steps the preset down); the sun's
  height fades shadows by intensity and skips the pass at low sun, so dawn and dusk never
  recompile. At night the moon is the light, so moonlit shadows stay (faint) and so does the pass.
- The shadow map reaches 400 m round the bird (4096 texels; 2048 on touch devices) and its
  shadows fade out with distance from the bird (62-92% of the range, `fadeSunShadow`), where
  contact shadows return to full strength. At 150 m with a hard edge, shadows appeared out of
  nowhere as the bird flew up to them, worst at golden hour when they are long.
- Terrain does not cast into the shadow map (trees, buildings and props do). The map is a
  box round the bird; a hill's shadow in a low sun is far longer, so only the part inside the
  box was drawn: a dark patch round the bird, lit land beyond, unrolling as it flew. Slopes
  turned from the sun are already darkened by the toon shading. A level can opt back in
  (`ChunkOptions.castShadow`).
- Contact shadows everywhere trees stand (medium and high) instead of the shadow map on medium:
  one 2-triangle blob per tree near the bird costs nothing next to a second scene pass.
- Cloud shadows and receiving shadows are applied by walking a level's scenery (`LitScenery`,
  on a level switch and once a second for streamed meshes) rather than by each level opting in:
  every lit built-in material gets them; custom shaders (water, the cloud sea, facades) don't.
- Ground cover reads the terrain chunk's own vertex lattice (heights, ground colours) instead of
  sampling the height field: tufts sit exactly on the drawn surface and match its colour, and a
  chunk's scatter costs ~1-3 ms (one chunk per frame). Its blades keep the up normal on both
  faces (double-sided blades flipped it on the back and went dark, specks from altitude).
  Cost on high: ~160k triangles in the 95 m ring (Highlands 205k -> 378k at the spawn view);
  medium ~28k (127k -> 155k). The ring on high is now 80 m (~115k), to make room for the
  Highlands' scenery.
- Highlands rivers follow the valley noise's zero line; distance from it is the noise over its
  gradient (first order), so widths read in metres anywhere without a river network. Saddles,
  where the gradient vanishes, become lakes or gaps, which reads naturally.
- Highlands fields are farmed or not as a whole, decided at each field's centre (`cellFarmed`).
  Painting a smooth per-vertex farmland mask left faceted wedges where it crossed its threshold
  inside terrain triangles. Each vertex now carries its field's 3x3 farmed mask as an exact
  integer, read through a `flat` varying: a fragment finds its own field's bit, so field edges
  are the grid's straight lines, and walls, crops and hay follow the same answer. The crop hash
  is integer arithmetic exact in float32 (tested against a float32 emulation of the GLSL).
- Highlands buildings are placed eagerly per chunk (cached, pure) because the flight floor and
  the wisps need them everywhere; everything small scatters lazily within prop distance. The
  flight floor scans only the chunks within a building's reach of the point (usually one):
  ~0.1 us a call against ~0.7 us for the height itself, so no further cache was needed.
- Highlands props get flat contact shadows (no ground lookups at refill: their records carry the
  ground height at their foot); trees keep the slope-laid ones. Bushes and boulders have far
  shapes (~20 triangles) beyond `propDetail`; with the 80 m grass ring that keeps high near 400k.
- City of Gold's tracks are signed distances (noise contours n / |grad n|, polylines signed
  by side), not unsigned: a 1.6 m path or a 7 m bed falls between two vertices of the 4 m
  terrain lattice, where an unsigned distance interpolates to a positive minimum and the line
  vanishes; a signed one crosses zero exactly. They live outside `at()` (only the ground's
  paint, the cover and the scatter need them), so flight queries don't pay for them.
- City of Gold's valley floors stopped being terraced (a terrace on a level floor is no
  terrace): they hold walled fields instead, and its terrace walls are traced by marching
  squares on the raw ground's contour through the middle of each riser, one piece per 7 m
  cell, so they follow the hillside as continuous walls (a 5 m grid cost twice the time for
  no visible gain). A riser taller than 1.7 steps is skipped: the slope gave up on terracing.
- City of Gold's props scatter one chunk a frame (the nearest first; all at once behind the
  title), refilling only the props: a chunk's scatter costs ~4 ms in Node, and crossing into
  new ground brings in several at once. Road cypresses join at the next full refill.
- Trees beyond `render.treeFar` take a distant shape (~14 triangles: an octahedral crown with
  fully rounded normals and a stub of trunk) where a tree is a few pixels across; City of
  Gold's olive groves were most of its triangles, and this paid for the new scenery (medium
  stays at today's count). Levels opt in by handing Trees distant shapes.
- City of Gold's golden hour read as one orange: the fill light, the fog and the haze were all
  warm. The fill is now a cool lavender (hemisphere), stone faces turned from the sun take the
  sky's hue (`coolShade`), and the far haze leans toward the sky overhead.
- Red Canyons lived in (after the Highlands): the rock strata and varnish moved from vertex
  colours (4 m apart, 11 m far; they smeared into zigzags on 30 m cliffs) into a per-pixel patch
  shared by the walls, arches, hoodoos and boulders. Arches are a swept tube of rounded sections
  inside the collision band (lumps only shrink it) instead of a 14-segment extrusion; hoodoos are
  smooth lathes with a cheaper far cut, slim ones narrowed per instance (one mesh, not two).
- Each canyon chunk owns its index and splits each quad along the diagonal whose corners are
  nearer in height, so a cliff's foot and lip follow the split instead of zigzagging across it.
  The zigzag had faked fluting on the cliffs; flutes are now a normal tilt across steep rock.
- Ground cover gained optional extra shapes per style (shrubs, cacti, tumbleweeds; one draw each)
  and the whole extra attribute (`t.extras`): the canyon's paint reads road, wash, slickrock and a
  brow's shade from its `aLand` without calling the layout per tuft (that was ~30 ms a chunk).
- Ranches and cliff dwellings sit in their own grid cells, well inside them, so the terrain asks
  one cell per query; a site being placed marks its cell empty first (placing reads heights,
  which ask for the site) and puts back the layout's scratch results.
- Cliff dwellings are a brow (half dome, solid) jutting over rooms on a levelled bench, with the
  cliff behind darkened through `aLand`: a heightfield can't hold an overhang, and carving one
  would need a per-site mesh. The brow's dome is `browTop`, shared by the flight floor.
- Sagebrush left the Trees (it was drawn to 620 m on medium, ~34k triangles of specks) for the
  small props and the cover ring; that paid for the near trees, smooth hoodoos and the sites.
  Medium stays at its old cost, high grew ~10 %, low fell ~15 %.
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
- The Aviary card sits at the top on an upright phone (the chase camera holds the bird at about
  mid-screen, measured at 60-62 % of the height on SE, 14 and Pixel 7), compact, with Done beside
  the title; the subtitle and journey bar show on wide screens only. The title card scrolls
  instead of cutting off its last buttons, and on short upright phones it tightens and drops
  the open levels' blurbs.
- Neon Bay difficulty, measured with bots over the same seeds. Before: the precise bot gathered
  ~1.6 wisps/s while steering a third of the time, and one that never turned (matching height
  only) still gathered 54 % of that; no other level was above 22 %. After: no-turning flight
  gathers 39 % (62 against 86 wisps per two minutes), the precise bot steers half the time and
  keeps its rate (1.33/s over 25 min). What was tried and dropped: a steady zigzag (±8 m, every
  6 wisps) was harder to follow than to ignore, since flying its centre line caught every
  crossing through the magnet, and it cut the precise bot by 30 %; a height bob dipped runs
  under the decks and tripled the wall glances for no extra challenge; a smaller magnet for the
  city alone did no better than lanes past the usual one. Costs: wall glances rose to about one
  a minute for the bot (about half while chasing a wisp it missed mid-swerve, which a person
  would let go), and slow turners pay: over 90 s the Crane gathers ~45 % of the Tern's wisps
  (the Swallow 129 %, the Phoenix 191 %). If the Crane feels punished there, raising its turn
  or the city's `turnRadius` is the first lever.
- Milestones that open nothing are taken off the track rather than shown: the Swallow and
  Crane were there before birds could be flown, and a player told "Swallow unlocked" had no
  Swallow. A test now checks every milestone opens a level, plumage or trail that exists.
- Plumages repaint the bird in place (each painted part keeps its painter) rather than
  rebuilding it: `Game.bird`, its wingtip anchors and its scene node stay the same objects.
- `hash2(-x, -z)` equals `hash2(x, z)` when x and z are both odd (the multiplies are odd and
  negation flips them alike), which stood identical arches in cells mirrored through the spawn.
  The canyon offsets its cell coordinates far from the origin rather than change the shared hash,
  which would reshuffle every other level.
- Sea of Clouds' ground is a cloud sea drawn as ordinary terrain chunks with their own shader,
  not a volume: the flight model, the look-ahead, the camera and the wisp floor all work on a
  height field already, and skimming the cloud tops is the level's water. Its heaps come from
  |noise|: plain noise at any amplitude rolled like dunes and read as sand in the golden hour.
- The shared mist gained a base height (`uMistBase`, 0 for every other level) so it can rest on
  the cloud tops; the cloud sea's own material leaves the low mist out (on the sea it flattened
  every billow to one wash) and takes only the fog.
- The cloud sea's motion is a vertex heave in its shader, not a moving height field: the flight
  model, wisps, finds and look-ahead keep a fixed ground. It stays under `groundHeight` (the
  bird's floor over the sea) and flattens round the camera, whose floor is 1.2 m over the field.
- Flying into the cloud sea is a soft floor in the flight model (`FlightEnv.softAt`), not a
  volume the bird flies in: the stay is a few metres and a few seconds, so lowering the cushion's
  floor under the tops gives it, and wisps, finds and the look-ahead keep the cloud top. The
  cloud sea is opaque terrain, so the bird is hidden by the depth test alone; the veil (the whole
  bird fading and dissolving through the top's last metres) is what keeps the cloud from reading
  as a floor the bird is cut by. Its marks (hollow, ring, swell, the bird's shape) multiply the
  lit colour, not the paint: the sunlit tops are close to white, and a darker paint alone
  vanished under the light. The puffs' colour is the mist's lifted and capped, as the lit tops
  outshine the mist most at night but by day the lift made the puffs bloom.
- The first build was a dolphin's dip: only a steep dive went in (the cushion levelled gentler
  descents on the tops), a buoyancy spring growing with depth threw the bird out within a second
  or two with a leap of several metres, and holding the dive porpoised. Players found it hard to
  get in and it did not feel like flying into cloud. Now the cloud opens to any descent, holds the
  bird a breath and eases it out level.
- The camera first rose a few metres to look down on the bird's spot, and shook: its floor and
  aim read the cloud's height raw, and the heaps meet in sharp creases (|noise|), so at dive speed
  each crease jolted the lens; it also stopped dead on its floor in one frame as it followed a
  dive down. The next build glided level over the tops, but as a mode eased on and off in time:
  for a moment after going in the lens still followed the bird down, and climbing out it hung
  low, looking up at the bird, until the mode let go and it snapped back. Now the floor is a
  place: over soft cloud (the bird's `softAt`, which changes only over tens of metres near rock)
  the lens never sinks below where it rides at the skim, so nothing switches and nothing jumps.
  The floor (the skim's height over the cloud at the bird, `cloudClear` over the heaps under the
  lens and 0.3-0.9 s ahead) rides a critically damped spring (`cloudOmega`), so its speed never
  jumps and the look-ahead makes up for its lag, and the lens eases onto it through a smooth max
  (`cloudSoft`, its rounding taken off the skim's height so the skim view is unchanged). Measured
  over a held dive and a release: the lens never below the bird (at least 1.5 m over it) and at
  least 1.5 m over the cloud under it, its vertical acceleration a mean of 6.9 m/s^2 (95th
  percentile 19), the bird's own 6.1 (18); the first build's was 181 (519).
- Coral Atolls' deep water reuses the cloud's soft surface (the flight model's top is the higher
  of ground and water) rather than a swimming model, so the feel is the same in both. Unlike
  cloud, water is soft only while the bird goes in or comes out: level flight over the open
  ocean is the level's skim-and-splash play and stays as it was. The submerged bird is shown,
  not hidden (the water is clear); a dissolve would have read as the bird vanishing in glass.
- Sea of Clouds hands over to the generic wisp patterns only out over open cloud (no spire within
  260 m), and when nothing fits it wheels round with short glides instead: near a spire a
  generic pattern lifts its path straight over the summit, a 100 m jump the bot could not climb
  (as the fjords found with their walls). Swings join the spire's circle on a tangent and sweep
  315 degrees so the crossing over the summit continues the ribbon's heading; leaving across the
  crown after half a turn made a hairpin, and a spire is only chosen if its summit can be
  reached at 80 % of the steepest rise. In a two-minute headless flight per seed the bot gathers
  ~1.5-1.7 wisps/s and glances off rock 0-1 times.
- Sea of Clouds joined the journey at 3000 light, after the Gilded plumage and before the
  Phoenix, which stays the end of the track. Saves from before it treat it as new to the track
  (`ADDED_LATER`), so a player already past 3000 still gets its card.
- Coral Atolls' water is the shared water plane with a clarity (`LevelDef.waterClarity`, 0 for
  every other level): the alpha drops where the view looks down and returns to the sky mirror
  at grazing angles, so the terrain's vertex colours paint the lagoons by depth. A depth-aware
  water shader would need a depth texture; painting the seabed reuses what the chunks already
  do and costs nothing.
- The surf is geometry, not part of the water shader: the water plane does not know where the
  reefs are. One strip per atoll in view, built on demand (a few hundred quads) and freed as it
  leaves the draw distance, all sharing one animated material.
- Coral Atolls' rocks are mushrooms, not pillars: a notch at the waterline under a jungle dome
  (Palau), so they read as a different place from Jade River's karst. The first profile flared
  slowly from the notch to the cap and read as flowerpots; the dome now starts a few metres over
  the water. Under a cap's overhang is air: the solid test only applies the dome's vertical
  margin above where the dome begins.
- Coral Atolls' ribbon first wandered along its trend and rarely met a reef or an island (hops
  every time); the hops now aim at the next atoll ahead within a turn of the trend, through a
  pass that faces the ribbon. In a two-minute headless flight per seed the bot gathers ~1.5-1.8
  wisps/s with no glances.
- Coral Atolls joined the journey at 3150 light, after Sea of Clouds and before the Phoenix,
  which stays the end of the track (`ADDED_LATER`, as Sea of Clouds).
- Installable web app (PWA), so phones can install it from the browser and play offline. No
  plugin dependency: a small Vite plugin builds `src/sw.ts` into `sw.js` with the build's file
  list and a version hash. The worker precaches each build in its own cache. Pages are network
  first (`no-cache`, 4 s timeout, then the cached build), so an online launch always opens the
  newest deploy; hashed assets are cache first (matched with `ignoreVary`: the page requests them
  in CORS mode). A new worker waits instead of taking over, keeping the old cache so a running
  game never loses files; the page swaps it in (skip-waiting, then reload) only on the title, on
  returning there or when the app is hidden. The icons are the one painted asset, generated
  from SVG by `scripts/icons.mjs`; the bird and wisps stay inside the maskable safe zone.
- Ringmoon Shallows is the first level not on Earth: a moon of a ringed gas giant with two suns
  and an old ship in its shallows, all designed for Driftwing. The giant is ray-traced in the
  sky shader (a sphere and a ring plane at unit distance), so it costs nothing in geometry and
  is identical from anywhere in the endless world, like the other backdrops.
- Ringmoon's spires lean, which the other levels' pillars and rocks never did. The mesh is the
  same unit lathe; the lean is a shear (column 1 of the instance matrix carries lx, lz), and
  `solidTop`/`pushPoint` move the axis with height. Toon shading hides the slightly skewed
  normals.
- The ship's collision is an ellipsoid, and the drawn hull's cross-section is (1 - s^2)^0.72 of
  it along the length (pointier than the ellipsoid's sqrt), so the bird never meets the hull
  before it is drawn. Pushing out radially from the centre instead of along the true normal
  keeps it to one closed-form step and gives the right exits: down under the belly, up over the
  back.
- Ringmoon's first groves were too dense (spires 64 m apart with gaps ~30 m): in a slalom the
  look-ahead saw stone on both sides, swerved the bot off the ribbon and the path re-anchored
  ~14 times in two minutes (~1.2 wisps/s). Groves fill at most ~64 % of cells and slaloms are
  planned 16 m clear: ~1.5-1.75 wisps/s, no glances, on four seeds.
- Ringmoon joined the journey at 3230 light, after Coral Atolls and before the Phoenix, which
  stays the end of the track (`ADDED_LATER`). Nine level cards make five rows on an upright
  phone; under 620 px of height the title tightens its cards so Play stays in view on an
  iPhone SE.
- Ringmoon's islets first covered ~21 % of the surface and the level read as open water with
  stone in it. They now cover ~46 % (`isleShare` 0.48): broad moss tables with channels of
  water between them, still kept off the opening run and the ship.
- Ringmoon gained mainland with rolling hills beside the islets (~58 % land in all). Coming
  down off a hill a ribbon dropping 5 m per wisp sent the bot diving to ~40 m/s, too fast for
  the next slalom's bends, and one seed fell to ~100 wisps in two minutes. Ribbons now drop at
  most 3 m per wisp and slaloms only start on the flat: ~200 wisps on five seeds, no glances.
- Ringmoon's alien things are one original family (teardrop landers, ringed beacons,
  crystals) sharing the level's palette. Landers and crystals are capped under the 9 m frond
  canopy so they cost no collisions; only the beacons are solid, profiled so the look-ahead
  sees the rings coming. Swings round a beacon orbit at >= 48 m: the ribbon turns at most
  0.3 rad per wisp.
- A persona review (`docs/reviews/persona-review.md`: a calm minimalist, a Journey fan, a daily
  returner, a curious explorer and a non-gamer) led to five changes:
  - Hints became saved lessons. "Once per visit" repeated them on nearly every phone launch
    (phones unload the tab), the second hint taught an optional two-handed boost before
    steering was ever mentioned, and without a flap the same sentence came back at 14 s. Now
    steering comes first, boosting once steering is known, never twice in a flight. Toasts moved
    from the top fifth to below the bird, off each opening's landmark.
  - The title shows open levels plus the next locked one (it reversed "locked level cards stay
    visible"); all five reviewers read nine priced cards as a wall of locks.
  - The late track is spaced 250 light apart (Red Canyons 2300 to the Phoenix 3550): Sea of
    Clouds, Coral Atolls, Ringmoon and the Phoenix had arrived within about a flight and a half.
    Granted unlocks are kept, so nobody loses a world.
  - The score left the in-flight HUD (it stays on pause and the Rest card), "Lantern reached"
    lost its points and only the first lantern to light gets a toast.
  - Discoveries v1 (see Progression). The first night finds were low skims (a river village, the
    cloud sea, a lagoon); the night ribbon test showed the wisps already fly there, so they
    became the paddies away from the river, the heights, and a turn round the fang. City of
    Gold's "tower's tip" moved to a turn round a tower's shaft for the same reason (its swings
    pass over the tips).
- The pause card was one long column (Resume, three stacked buttons, then volume, mute, quality,
  invert and steering) that scrolled on every phone. It is now Resume plus three tiles (Rest,
  Levels, Settings), and Settings is its own card: a speaker button that mutes beside the volume
  slider, chips for steering and quality, switches for invert and a new Left-handed option, and
  Controls as a link. "Invert vertical steering" read as "flip the pad", so it is now "Invert
  climb / dive" with a hint. Left-handed mirrors the button schemes: the D-pad goes right and Boost
  left; Side arrows and Split keep their turns on their own sides and only move Boost.
- On phones the title's level cards are one sideways-swiping row (snapping, the next card peeking
  in) instead of a two-column grid that pushed Play, the Aviary and Controls off an iPhone SE. The
  row has room for the blurbs again.
- The Aviary is called "Birds" on screen (the title button, its card and the unlock cards'
  "pick them in Birds"): a plainer word. The code keeps the `aviary` names.
- Jade River lived in (after the Highlands' pattern). The pillars' per-vertex random jitter
  became smooth noise on one shared skin: every tier is the same rock, and things placed on the
  walls (vines, shrubs) read the same surface. The paddies are terraces cut into low hills, and
  the shader paints them from the land's height before the cut (passed per vertex with the bank
  distance, the paddy share and the path distance), so the fields follow the contours at pixel
  sharpness on a 4 m lattice; the field kind is an integer hash exact in float32, shared with the
  rice in the ground cover. Groves no longer grow on the paddies: open fields read as farmed
  land, and the ~25 % fewer trees paid for the ground cover, hero pillars and props (medium is
  8-16 % cheaper than before at three views, with ~17 more draw calls).
- Bridges stand where a footpath's contour crosses a river's (a two-dimensional Newton step from
  each cell's centre), only on narrower reaches, away from the opening run and the pillars. They
  are soft ground rather than solids: the floor ramps up over 16 m either side along the river,
  and river ribbons look four wisps ahead to climb over the deck.
- A house's roof must fit under the village's soft floor at its centre and its corners; a hall
  or two-storey house that does not becomes a cottage (checked again at its own footprint).
- Vines are straight strands whose instance basis runs from their foot to their top along the
  wall: pushed out over any bulge between, shortened where the wall falls away under them, and
  dropped where a neighbouring pillar's rock is in the way.
- Coral Atolls lived in (after the Highlands' pattern). The review found faceted jungle and
  shrubs, flat green slopes between the trees, mushroom rocks with jagged two-pronged crowns and
  long horizontal stripes on the fang. The stripes were the shared `GroundDetail` wall bump: it
  sampled one diagonal plane (x + z, y), which is constant across walls facing 45 and 225
  degrees, so the noise only varied with height there. It now projects on the zy and xy planes
  by which way the wall faces (every level's cliffs; flat ground skips it). The crown carpet is
  the atoll's own patch (`land.ts`, after `withGroundDetail`), not a change to the shared shader.
- Atoll villages first stood over the 7 m lagoon: through the clear water their stilts hung
  like long sticks. Stilt villages are built over the shallows, so the lagoon floor now rises to
  a sandy shelf (about 1.7 m deep) under each village; the shelf is in `height`, applied after
  the village is planned on the plain seabed.
- The atoll's moving life (fish, turtles, rays, paddled canoes, seabirds) follows circles in the
  vertex shader whose radius and direction come from a hash of the instance's origin. The
  scatter computes the same hash (fract of a small linear form, which float32 matches to well
  under a part in a thousand) and checks the whole circle stays over water deep enough and clear
  of rock, roofs and villages, so nothing swims through the land or a hut.
- The atoll's painted coral gardens started as bright polka dots that read as confetti through
  the water; they are now sparse, half-tinted heads in a darker mottled bed, blurring far off
  into a faint warm patch. To pay for the cover, huts and life on medium, jungle trees fill a
  third of the island's cells instead of 45 % (the crowns paint the rest) and palms and jungle
  have distant shapes beyond `treeFar`.
- Neon Bay lived in: every building was a box with one flat toon colour per face, so corners
  snapped between bands and towers read as cardboard. The fix is a shader pass, not geometry:
  the shading normal leans toward the neighbouring face near every edge (a fake rounded arris),
  plus paint wash, streaks, a darker foot and a cornice, all in the part's own frame (the old
  face frame assumed axis-aligned boxes). Cost is fragment work only.
- The city's trees got a distant shape (one crown, ~26 tris) beyond `treeFar`; it pays for the
  props and traffic, so medium's triangles went down while it gained ~18 draw calls.
- Traffic is endless lanes, not paths with spawn points: vehicle k on a lane sits at
  k _ spacing + jitter(k) + speed _ t, so cars never pop when the lanes are replanned and the
  frame's placement is arithmetic over arrays. Lanes are clipped to the road (an avenue's T at
  the bayside road, east-west roads' green strips) and fade over 8 m at a clipped end. Crossing
  traffic passes through itself at junctions; at this density it is rarely seen.
- Power poles and their cable runs are thin solids (the look-ahead sees them); street lamps,
  signals and street trees are not, but lamps stand at the back of the sidewalk so their heads
  stay clear of the avenue wisp lanes 12 m off the centre line (a test flies the wisps against
  every prop). Cranes, piers, container stacks and the ship are solid; the harbour clips each
  solid to the superblock that asks, since a superblock only indexes its own boxes.
- Water taxis pick their lane's distance offshore so it passes between the piers of every
  expressway bridge in reach and clear of the bay torii; ferry routes keep away from harbours,
  expressway lines and the spawn's view of the torii.
- Sea of Clouds lived in. The spires were flat-shaded 9-sided prisms (polygons, not rock);
  smoothing them alone was rejected as a tweak. Each silhouette now has a skin that only cuts
  into the collision profile (ledges, grooves, an alcove, chimneys), so collisions, the summit
  query and the wisp clearance are unchanged while the drawn rock gets its shape; things that
  sit on the rock read the skin. The first per-pixel joints were iso-lines of a 3D noise, which
  close into loops on a lathe and drew ovals on every face; fractures are now whole multiples
  of the angle round each spire's own axis (`aRock`) and sheeting joints follow height, so they
  are open lines. Ledge cover and dwarf pines are props within `smallPropDistance` (the Trees
  would have drawn them to `treeDistance`); the granite pine got a distant shape past `treeFar`,
  which pays for the indexed spire lathes: medium is 2-21 % cheaper than before at five views,
  with 15-19 more draw calls; high +5-10 % (shadow casters), low -6 to +10 %.
- Rope bridges and flag lines between spires are soft rather than solid: an oriented thin box
  would need its own look-ahead (the shared one sees axis-aligned boxes) and would be a wall
  across the gap between two spires. The planner keeps every ribbon 10 m off them instead, and
  the autopilot test counts wisps near a rope as failures.
- Gaps in the cloud sea open only in the drawn surface: the water plane is at 0, so the valley
  floor can be just 35 m below the cloud top, and a bird diving into a 40 m hole would meet
  steep terrain walls. Flight, wisps and spires keep the cloud top; the valley is painted at a
  small scale and hazed so it reads far below.
- Sunbeams are geometry, not the shafts pass, so medium (no shafts) has them; they show only
  from mid-morning to the golden hour, since a low sun laid them along the sea and an end-on
  beam through the camera washed the whole screen.
- On high, a shadow map that has never been drawn leaves every shadow-receiving draw failing
  (a depth sampler bound to no depth texture: the scene vanishes) until the sun rises past
  `light.shadowSunMin`. Sea of Clouds opened at sunrise with the sun just below it. SunShadows
  now draws the map once whenever shadows switch on, whatever the sun, so no level depends on
  its opening sun (Sea of Clouds' dawn sun is back at 0.06).
- Ringmoon lived in: "believable" on another world means a coherent ecology (moss, bulbs,
  grazers, fish, floaters) and a small explorers' presence by the landing pods and the ship,
  not more alien machines. Everything new is soft (under the canopy) except what was already
  solid; the floaters are not solid either, but the wisp planner treats the space each drifts
  through as taken, so no ribbon leads the bird into one.
- Ringmoon's scene keeps one directional light. The giant's light and the second sun's are fills
  added in the level's own materials (`withMoonLight`), like the canyon's bounce: a real second
  light would recompile every material of every level and cost every lit fragment.
- Night glow on Ringmoon is a per-vertex `aGlow` on one shared prop material (and the life
  material) instead of separate basic-material meshes: the lander hatches, beacon tips and
  crystals' glow folded into their meshes, so glowing parts cost no draw calls of their own.
- Ringmoon's spires first got dark vertical joints and regular cracks: from a few hundred metres
  they read as staves or brickwork (wood, not stone). The columns now differ in width, their
  joints are faint and fade where a pixel spans much of a column, half the cross joints show,
  and the column faces carry the read (each its own normal and grey).
- The herd cells (220 m) are wider than a chunk (160 m): a cell belongs to the chunk whose index
  range holds it (the ceil/ceil partition every scatter uses), not the chunk holding its jittered
  centre; checking both dropped most herds.
- Tapping to boost (drag steering) made nonstop flapping the easy thing to do, and it reached
  ~67 m/s in level flight while climbing 100 m in 12 s: as fast as a full dive (~70), with
  height gained instead of spent. Flaps now stop adding speed at `flapSpeedCap` (45 m/s): boost is
  a burst, and diving is how to go really fast.
- The loop (flick or double-tap up) is gone, with its camera that watched it from the side, its
  scripted speed and its music run. Up has no trick now; rolls and the dive-bomb remain.
- Taps faster than the flap cooldown were simply lost, which reads as the game ignoring you. A
  press in the last `flapBuffer` (0.25 s) of the cooldown is now kept and flaps the moment it ends;
  earlier presses are still dropped, so no flap comes long after its tap.
- Destinations: a flight needed an arc. A beacon over a landmark ahead that the wisps lead to, and
  an arrival, was chosen over a timer or a fail state (the first pillar stands). Red Canyons
  first: its arches are natural ends. Picking any canyon arch across the land and routing over
  the plateau failed: a ribbon down in a canyon cannot climb its 125 m walls toward a goal across
  them, and climbing out along the canyon flip-flopped when the goal lay square across it. Walking
  down the bird's own canyon works (the ribbons already run there), once arches stand often enough.
- The flock flies ahead of the bird, not behind: on a phone held upright the chase camera sees a
  cone a few metres wide at the bird, so a V behind it was invisible. Followers spring their
  offsets from the bird rather than world positions, so they keep up at any speed.
- Journeys on every level: walks down a channel where the level has channels (canyons, rivers,
  fjords), picks across open country elsewhere. Picking a pagoda across Jade River's pillar
  forest failed (the ribbons could not thread to one); walking down the river to the next one
  works. Neon Bay's ribbons first circled round towers near the goal and U-turned at the
  opening; both are now ruled out mid-journey.
- Arrival means flying through the beacon's light, not passing near the landmark. Bot arrivals
  over four seeds in six minutes, near -> through: Red Canyons 16 -> 16, Aurora Fjords 16 -> 16,
  Coral Atolls 10 -> 10, Highlands 9 -> 8, City of Gold 7 -> 7, Ringmoon 5 -> 7, Sea of
  Clouds 8 -> 6, Jade River 4 -> 4, Neon Bay 4 -> 4 (two seeds there, and one each in Jade
  River, City of Gold and Sea of Clouds, arrive nowhere in six minutes).
