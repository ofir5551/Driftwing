# Driftwing: notes for agents

Calm, painterly bird-gliding game. Vite + TypeScript (strict) + Three.js, Web Audio, no assets.
The design and decisions log live in `docs/DESIGN.md`. Read it before changing feel, visuals or audio.

## Commands

- `npm run dev`: dev server (http://localhost:5173). `?debug` opens the lil-gui tuning panel (all of `Config`) and stats.
- `npm run check`: typecheck, lint, tests and production build. Run it before every commit.
- `npm run typecheck` / `npm run lint` / `npm test` / `npm run build` / `npm run preview` / `npm run format`
- `node scripts/shot.mjs <url> <out.png> [waitMs] [clickSelector] [w] [h]`: one headless screenshot.
- `npm run shots`: regenerate README screenshots into `docs/screenshots/` (needs a running server).
- `node scripts/level-shots.mjs <level> [--at x,y,z,yaw,pitch,phase]`: review a level (title, phone, dawn,
  golden, night, altitude shots into `shots/<level>/` + triangle report). New levels: the `new-level` skill.
- URL flags: `?debug`, `?autopilot` (skips the title; a bot flies toward wisps), `?time=0..1` (day phase),
  `?seed=N`, `?quality=low|medium|high`, `?journey=N` (a throwaway journey at N light, never saved), `?level=highlands|city|karst|fjord|jerusalem|canyon|peaks|atoll|ringmoon|eden`,
  `?unlocked` (every level, plumage and trail open, nothing granted or saved), `?flock=N` (fly N
  flock birds, never saved), `?fsprompt` (show the launch fullscreen card even if dismissed or automated).
- Screenshot scripts take `CHROMIUM_PATH` to use a system Chromium (e.g. `/opt/pw-browsers/chromium`).
- Automation hooks on `window`: `__dw` (Game, `info()`), `__gp` (Gameplay), `__audio` (GameAudio),
  `__journey` (Journey: lifetime light and unlocks).
- Headless Chromium: on Windows `--use-angle=d3d11` uses the real GPU; elsewhere SwiftShader works but is slow.

## Conventions

- Phone first: most players hold a phone upright. Lay screens out for 320-430 px portrait first
  (iPhone SE 320x568 must fit) and add no new buttons or gestures. Check UI with Playwright's
  `devices['iPhone SE']`, `devices['iPhone 14']`, `devices['Pixel 7']`.

- Strict TS, no `any`. Small modules. Comment the _why_ for flight and audio-scheduling math.
- Every tunable number goes in `src/core/Config.ts` (auto-exposed in the debug panel).
- Hot paths (`step`/`frame`/`render`) must not allocate: reuse scratch vectors at module scope, pool objects.
- Pure logic (flight model, noise, progress/flow, loop, music scales/scheduler) stays free of Three scene/DOM
  so Vitest can test it in Node.
- Y is up. Heading is a yaw angle; forward = (sin yaw, 0, cos yaw). Facing +z, the bird's right is -x.
- Colours are authored as sRGB hex; shaders output linear and end with `#include <colorspace_fragment>`.
  Post runs in linear HDR; values > 1 are what bloom picks up (wisp cores, lantern orbs).

## Architecture

- `main.ts`: wires Game + Gameplay + GameAudio + Menu, settings persistence, pause/mute/hints.
- Two channels on one Pages site (`.github/workflows/pages.yml`, same file on both branches):
  `main` at the root for players, `dev` under `/dev/` built with `VITE_CHANNEL=dev`
  (`core/channel.ts`: everything unlocked, no journey saved, its own settings keys, no service
  worker; URL flags still apply). Ship by merging `dev` into `main`.
- `pwa.ts` + `sw.ts`: installable app. The service worker precaches each build (offline play);
  `vite.config.ts` builds it to `sw.js` with the file list. Updates reload only on the title.
  Files added to `public/` must be listed in `PUBLIC_FILES` there. Icons: `scripts/icons.mjs`.
- `core/Loop.ts`: fixed 60 Hz step + accumulator; render gets `alpha` to interpolate. dt clamped.
- `core/AdaptiveScale.ts`: pure adaptive-resolution logic (windows of slow frames; `Config.adaptive`).
  It scales the composer's targets only: never resize the canvas in flight (it blanks a frame).
- `core/Game.ts`: renderer, scene, flight, camera, sky/water/clouds, adaptive resolution/quality, and the
  current level's `World` (`setLevel` swaps it in place). Modes: `menu` (bot flies the attract backdrop),
  `playing`, `paused`. `onStep`/`onFrame` hooks.
- `levels/`: `World` interface + `LevelDef`; `Highlands` (chunks, scenery, islands), `City`, `Karst`
  (Jade River, with its own palettes), `Fjord` (Aurora Fjords), `Jerusalem` (City of Gold),
  `Canyon` (Red Canyons), `Peaks` (Sea of Clouds), `Atoll` (Coral Atolls), `Ringmoon` (Ringmoon Shallows),
  `Eden` (Tal and Hadar's wedding flight, off the journey track: always open); `index`
  registry.
- `core/Gameplay.ts`: wisps, flow (`Progress`), thermals, lanterns, particles, trails, wind, HUD.
- `core/Journey.ts`: lifetime light, the unlock track and the discoveries found (pure; saved by
  `Settings`). See DESIGN's Progression.
- `world/LanternNotes.ts`: the notes a lantern holds and the picker (pure; the recent ones saved
  by `Settings`, so a note waits 30 others before coming back). Eden opts out (`lanternNotes`).
- `world/Discoveries.ts`: every level's hidden finds (names, `LEVEL_FINDS`) and the tracker
  (pure); each level's tests are `world/<level>/finds.ts` (Highlands: `world/highlands/`), handed
  to Gameplay as `World.discoveries`. Finds must stay off the wisps' ribbons (a test flies them).
- `world/Destinations.ts`: a flight's journeys (pure tracker: a beacon over a landmark ahead, the
  wisps lean toward it via `WispPlanner.setGoal`, arrival ends it). A level offers them as
  `World.destinations` (every level: `world/<level>/destinations.ts`, Highlands in
  `levels/Highlands.ts`), built on `world/landmarks.ts` (a pick across open country) or
  `world/walk.ts` (down a river, fjord or canyon); planners lean via `world/goal.ts`. `world/Beacon.ts`
  draws the column of light, `world/Roost.ts` the lit cairn where a stray perches. Arriving adds
  it to the flock: `world/Flock.ts` (instanced birds round the player's, in every level; saved
  in the journey) with the pure slot/spring math in `world/formation.ts`. See DESIGN's Destinations.
- `core/Events.ts`: typed bus (flap, contact, cloud, wisp, lantern, thermal, discovery, destination, arrival, unlock) so audio/fx/ui stay decoupled.
- `player/FlightModel.ts`: pure arcade glide physics; a bird's `FlightTuning` (its
  `Config.species` entry) scales it, neutral for the Tern. `Bird.ts` visuals only: one rig built
  from a `BirdShape.ts` and repainted from a `Plumage.ts` palette. `Species.ts`: the birds (shape,
  plumage, tuning). `ChaseCamera.ts` polar springs. `fx/TrailStyle.ts`: wingtip trail colours.
- `world/`: `noise` -> `Terrain` height field shared by `ChunkManager` (streaming in budgeted stages, LOD,
  generic per-chunk decor with an optional one-chunk-a-frame `prepare`, optional `GroundCover`),
  `instances` (`commitInstances`: end every instanced refill with it, it uploads only what is used), `Trees` (instanced; near, far and optional distant shapes; sun-shadow casters and contact shadows), `Islands`, `Wisps` (+ optional level `WispPlanner`), `Thermals`. `DayCycle`
  palette drives `Sky` (incl. the city's Fuji), `Water`, `Clouds`, lights, post.
  `GroundDetail`: painted terrain detail (patches, strokes, strata, bumps) patched into toon materials.
- `world/highlands/`: `HighlandsLayout` (pure: rotated field grid, farmed fields (decided whole,
  at the centre), the road along every river, buildings and `builtLift` for the flight floor),
  `HighlandsScatter` (pure: forest with glades and birches, rocks, bushes, logs, walls/fences,
  hay, sheep, reeds, boats, flocks per chunk), `HighlandsDecor` (instancing, near/far props,
  casters, contact shadows, chimney smoke), `Land` (ground colour; fields and road painted in the
  terrain shader from `aLand`), `crops` (ground-cover style), `shapes`, `materials`. The rivers and
  farmland are in `Terrain`'s `LandField`.
- `world/city/`: `CityLayout` (pure plan: superblocks -> parts, trees, solid boxes, props; the
  waterfront (bayside road, promenade, river walks) from `shoreDist`/`bankDist`; street furniture,
  power lines (thin solids), rooftop kits and gardens, shop fronts; queries), `CityHarbour` (pure:
  piers, gantry cranes, containers, a ship, moored boats; solids clipped per superblock), `props`
  (records), `traffic` (pure `TrafficPlan`: endless lanes, clipped and sampled per plan, vehicles
  placed per frame into preallocated buffers), `CityTraffic` (car, tram, ferry instancing),
  `collide` (pure look-ahead + wall glance), `BridgeDecks` (bridge and expressway road surfaces in
  the ground material; heights from `deckAt`, the embankments are in the layout), `CityWisps` (avenue/spiral/glide planner, paths
  checked clear), `CityDecor` (instanced buildings, trees in three distances, props, casters,
  contact shadows), `cover` (ground-cover style, `aCityLand`), `shapes` (props, vehicles),
  `geometry` (incl. soft city trees), `materials` (painterly facade, street and prop shaders),
  `CityWorld`.
- `world/karst/`: `KarstLayout` (pure: rivers, terraced paddies, footpaths and bridges, pillars +
  shared radius profile, terrain, queries), `skin` (pure: the rock surface every pillar tier is
  lathed from), `KarstScatter` (pure: trees, villages, pagodas, bridges, boats, boulders, vines,
  buffalo per chunk), `KarstDecor` (instancing, LOD, casters, contact shadows), `Land` (ground
  colour; paddies and paths painted in the terrain shader from `aKarst`), `cover` (ground cover
  with rice), `rock` (limestone shader), `RiverMist`, `KarstWisps` (river/slalom/spiral planner),
  `geometry` (rock, bamboo), `shapes` (props), `KarstWorld`.
  `world/Mist.ts`: shared valley-mist uniforms + `withMist` material patch (also in `Water`).
- `world/fjord/`: `FjordLayout` (pure: fjords, strand/wall/plateau terrain with rounded crags,
  icebergs, lighthouse, snow climate, the terrain's `aLand`; walls are terrain that `solidTop`
  reports for the look-ahead; `ground` includes the villages' roofs), `FjordSites` (pure: fishing
  villages that widen their strand (houses, church, boathouses, jetties, racks; solids that lift
  the flight floor; streets) and waterfalls), `FjordScatter` (pure: forest, village parts, floes,
  boulder beaches, seals, boats, gulls and eagles per chunk), `FjordDecor` (instancing, near/far,
  casters, contact shadows), `rock` (per-pixel cliff relief, ledge snow, beach, streets, spray),
  `cover`, `Waterfalls` (ribbons and spray), `atmosphere` (dawn fog banks, the aurora reflected
  near the shore), `materials` (props with lit windows, bobbing boats, circling birds; water),
  `geometry` (trees, ice, lighthouse), `shapes` (props), `FjordWisps`, `FjordWorld`. The aurora is
  the `aurora` backdrop in `Sky`.
- `world/jerusalem/`: `JerusalemLayout` (pure: designed Old City, valleys and landmarks round the
  origin blending into endless hills, wadis, terraces and towns; per-block parts, trees, roof
  clutter and stalls, and solids (oriented boxes, domed drums); low roofs are canopy; roads,
  paths and dry beds as signed distances (`track`), walled fields on the valley floors),
  `JerusalemScatter` (pure, per chunk: terrace walls by marching squares, field walls, rocks,
  garrigue, oleanders, flocks, swifts, road cypresses), `props` (records), `land` (terrain
  `aJLand` + roads/paths/beds/risers in the shader), `cover` (ground-cover style),
  `JerusalemWisps` (opening ribbon, land-hugging swoops, valley runs, landmark swings),
  `JerusalemDecor` (instanced stone, trees in three distances, props near/far, casters,
  contact shadows; scatters one chunk a frame), `materials` (stone shader with bevels,
  weathering and cool shade; foliage detail; painted dry stone), `shapes` (props), `geometry`,
  `JerusalemWorld`. Hills are the `hills` backdrop.
- `world/canyon/`: `CanyonLayout` (pure: canyons, stepped walls with scree at each cliff's foot,
  dry washes, slickrock, plateau and mesas, arches (half-elliptical bands, the Great Arch ahead
  of the spawn) and hoodoos; walls are terrain that `solidTop` reports, arches report their
  span's underside), `CanyonSites` (pure: ranches and cliff dwellings under a solid brow; pads,
  flight floor), `CanyonScatter` (pure: trees, sites, small props per chunk), `CanyonWisps`
  (canyon runs that thread arches, glides; on a journey, runs down the route to its arch),
  `destinations` (the journeys: down the bird's canyon to an arch), `CanyonDecor` (instancing, near/far, casters,
  contact shadows), `rock` (per-pixel strata, varnish, flutes, the road/wash/slickrock paint from
  `aLand`, bounce light), `cover`, `geometry`, `shapes`, `materials`, `CanyonWorld` (per-chunk
  diagonals, haze). Mesas are the `mesas` backdrop.
- `world/peaks/`: `PeaksLayout` (pure: the cloud sea as terrain (|noise| heaps) with gaps that
  open only in the drawn `surface` (flight keeps `height`), granite spires on one stepped
  `profile` (the collision envelope), the Sky Gate (two spires, a bridge solid with an
  underside, a monastery)), `skin` (pure: each silhouette's joints, sloping partial ledges,
  alcove and chimneys, only ever cutting in; meshes and props read it), `PeaksSites` (pure: rope
  bridges and flag lines between spires, soft and kept off ribbons by `clear`; the monastery
  stair; crane flocks), `PeaksScatter` (pure: pines, ledge and summit cover, alcove huts,
  pavilions, temples, lanterns and windows per spire), `PeaksWisps` (gate ribbon, cloud skims,
  slaloms, tangent swings over summits), `PeaksDecor` (three spire tiers, near/far props,
  casters, contact shadows), `granite` (per-pixel joints round the spire's axis from `aRock`,
  lichen, moss, snow), `cloudSea` (the sea's shader: lobes, heave, gaps, warm glow, lining,
  the marks of a dive into it), `geometry`, `shapes` (props), `materials` (flags, cranes,
  sunbeams), `PeaksWorld`. Snow peaks are the `summits` backdrop; the mist rests on the cloud
  tops via `uMistBase`. Open cloud is soft (`softness`, `World.softGround`): a descent glides in for
  a breath and out (`FlightEnv.softAt`), the bird melting into it (`Bird`'s veil).
- `world/atoll/`: `AtollLayout` (pure: atolls on a coarse grid, each a wobbly reef ring with
  motus and passes round a lagoon, a crest that dries in patches, sand bars, seagrass; mushroom
  rocks lathed from one notched profile; high islands (the home one's fang ahead of the spawn)
  that `solidTop` reports as solid; bungalow piers and fishing villages of stilt huts on a sandy
  shelf as soft canopy (`roofAt`)), `AtollScatter` (pure, per chunk: trees, the villages' huts,
  walkways and fires; canoes, nets, coral heads, fish, turtles, rays and seabirds, moving things
  on circles checked clear), `AtollWisps` (skipping-stone hops aimed at the next atoll, reef
  rims, rock slaloms, island swings), `AtollDecor` (instancing, near/far/distant trees, casters,
  contact shadows, smoke), `land` (the ground's paint from `aAtoll`: jungle crowns, wet sand and
  swash foam, tide pools, ripples, seagrass, coral gardens), `cover` (ground-cover style),
  `materials` (the life's vertex-shader motion, smoke), `shapes` (props), `Surf` (an animated
  foam strip per atoll in view), `geometry`, `AtollWorld`. Cumulus are the `cumulus` backdrop; the level's `waterClarity` lets
  the seabed's colours through the water. Deep water is soft (`softness`, `World.softGround`): a
  descent glides under it for a breath, the bird tinted but in sight.
- `world/ringmoon/`: `RingmoonLayout` (pure: a shallow sea with terraced moss islets, sand bars
  and mainland of rolling hills, leaning basalt spires lathed from one knuckled profile (the lean
  is a shear in the instance matrix; queries follow the leaning axis), the ship (an ellipsoid
  hull with an underside, four leg capsules), the two gate spires beside it, alien props on the
  land: landers and crystals (soft, under the canopy) and beacon towers (solid; rings spun in
  the shader); the explorers' outposts by the landers and the camp on its spit by the ship (habs,
  masts, lit paths; soft, `pathDist`), floaters on high circles (`floaterNear`: the planner's
  `clear` keeps ribbons off them) and the life circles (`LIFE_PATHS`)), `RingmoonScatter` (pure:
  fronds, outpost parts, glow bulbs, terrace steps, fish, grazers per chunk; moving things on
  checked circles), `RingmoonWisps` (the run under the ship, grove slaloms, skims, swings round
  tall spires), `RingmoonDecor` (instancing, near/far, casters, contact shadows), `land` (the
  ground's paint from `aRing`: moss cushions, basalt risers, shore foam, tide pools, seabed,
  paths), `rock` (per-pixel column faces and cracks on the spires and steps), `cover`,
  `materials` (the giant's and second sun's fills, `aGlow` night glow, the life's vertex
  motion), `shapes` (explorers, life, cover shapes), `geometry`, `RingmoonWorld`. The ringed
  giant and the second sun are the `giant` backdrop in `Sky`.
- `world/eden/`: Tal and Hadar's wedding flight. `EdenWorld` wraps a `HighlandsWorld` built on
  `EdenLayout`'s reshaped land (pure: three sites searched for level dry ground, each a meadow
  blended into the hills; the venue's parts in its own u/v frame (`VENUE`), the wave roof's
  height, soft lifts over its trees, the pictures as slabs `pushFrame` glances off), `journeys`
  (pure: Tal's picture, Hadar's, then the venue with no cairn; then the isles), `EdenWisps`
  (straight ribbon through each stop's light on the run in), `EdenScenery` (easels, venue,
  heart rose beds, sky lanterns in a shader; `SkyWords`: "Tal ♥ Hadar" in lantern light), `countryside` (pure, per 300 m cell: road arches
  and lights, heart groves, heart clouds, doves) drawn by `EdenCountry` (also the petals),
  `cover` (lavender and rose fields), `heart` (the shape; the lake in `EdenLayout`), `finds`, `photos` (the pictures, kept veiled as `photos/p0-2.bin`
  by `veil.ts`; make new ones with `node scripts/eden-photos.mjs`; `ui/PhotoCard` shows them on
  arrival). A destination may have no `roost` and its
  own `message`; `World.arrived` and `LevelDef.wispColor` are the level's hooks.
- Shared lighting (see DESIGN's Rendering): `fx/SunShadows` (shadow map round the bird, high),
  `world/ShadowCasters` (near-only caster proxies on layer 1), `world/ContactShadows` (blobs under
  trees/props), `world/CloudShadow` (drifting cloud shadows patch), `world/LitScenery` (gives every
  lit mesh of a level shadows and cloud shadows), `fx/shaders/shafts` (light shafts),
  `world/GroundCover` (grass and flowers on the chunk lattice; a level opts in with a `CoverStyle`).
  Strengths per level in `Config.levelLight`.
- `fx/`: `Composer` (render -> light shafts -> bloom -> painterly -> output), `Particles` (ring-buffer pools), `Trails`,
  `Wind` (speed streaks), `BlobShadow`.
- `audio/`: `AudioEngine` (context, buses, synthesized reverb), `Music` (lookahead scheduler, layers),
  `Sfx`, `scales` (pure theory + `StepScheduler`), `GameAudio` (event wiring).
- `ui/`: `Hud`, `Menu`, `TouchControls`, `styles.css`. `Fullscreen` (API/iPhone/standalone detection,
  platform), `FullscreenPrompt` (the launch card: Go fullscreen + install guide per platform, the
  browser's own Install button via `pwa.ts`'s held `beforeinstallprompt`; skipped when standalone,
  fullscreen, dismissed for good, `?autopilot` or `navigator.webdriver`).
