---
name: new-level
description: Build a new Driftwing level (stage/world) end to end. Use when the user asks for a new level, stage, world or biome, or to brainstorm one. Holds the level contract, which existing level to copy, shared building blocks, known traps and the definition of done, so the codebase needn't be re-explored.
---

# Building a Driftwing level

Read `docs/DESIGN.md` (Pillars, Levels, and the existing level sections) first: the bar is a
level with its own _mood_, not just new scenery. Then follow the steps below; open only the
files they name.

## 1. Agree the mood (before code)

Each level conveys a different feeling: Highlands is open and bright (dawn), Neon Bay is busy
and warm (dusk), Jade River is still and misty (ink-wash dawn). Pin down with the user, or
pick and say so if they delegate: the place, the feeling, opening time of day, palette
direction, music modes, the signature landmark/view, and what _flying_ there feels like
(open arcs, street canyons, slalom between pillars...). Nothing in Driftwing may punish: no
fail state, every collision is a soft glance.

## 2. Where a level plugs in

| File                                       | What to add                                                                                                                                                                                                                          |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/levels/World.ts`                      | id in `LevelId`. `World` (the interface to implement) and `LevelDef` live here.                                                                                                                                                      |
| `src/levels/<Name>.ts`                     | `LevelDef`: `name`, `blurb` (short, fits a card on a phone), `startPhase`, `dayScale`, `music`, `backdrop` (`none`/`fuji`/`karst`, or add one in `Sky.ts`), optional `sky` palettes and `saturation`, `maxAltitude`, `create(seed)`. |
| `src/levels/index.ts`                      | append to `LEVEL_LIST` (title cards, URL flag and settings follow).                                                                                                                                                                  |
| `src/world/<name>/`                        | `<Name>Layout` (pure), `<Name>World`, `<Name>Decor`, `<Name>Wisps`, `geometry`.                                                                                                                                                      |
| `src/core/Config.ts`                       | a section for every tunable number (shown in `?debug`).                                                                                                                                                                              |
| `src/audio/scales.ts`, `styles.ts`         | `<NAME>_KEYS` (5 keys: dawn, day, golden, dusk, twilight; add modes to `MODES` if needed) and a `<NAME>_MUSIC` style with its own tempo, voice, pad, reverb (no two levels share tempo+voice).                                       |
| `tests/<name>.test.ts`                     | layout + flight + music tests (step 5).                                                                                                                                                                                              |
| `scripts/shots.mjs`                        | a title shot and 3-4 placed viewpoints for the README.                                                                                                                                                                               |
| `README.md`, `docs/DESIGN.md`, `CLAUDE.md` | level bullet + screenshots; a design section and decisions-log lines; architecture line and `?level=` flag.                                                                                                                          |

`Settings`, `Menu` and `main.ts` need nothing: they read `LEVEL_LIST`. `Game.setLevel` applies
palettes, backdrop, ceiling and saturation; `Gameplay` reads the `World` hooks.

## 3. Copy the closest level

- **Terrain only** (hills, dunes, ice): `src/levels/Highlands.ts`. A `HeightField`, the
  default `ChunkManager`, `TreeDecor`; `planner = null` (generic wisp patterns).
- **Terrain + solid props on a grid** (pillars, rocks, trees you can hit, ruins):
  `src/world/karst/`. Pure layout with per-cell cached props and `solidTop`/`hit`/`pushPoint`
  queries; terrain from the same layout; chunk decor; a planner.
- **Constructed grid of boxes** (towns, ruins, docks): `src/world/city/` (boxes bucketed per
  superblock, analytic ground shader).

## 4. Shared building blocks (reuse, don't rewrite)

- **Solids**: implement `solidTop(x, y, z, margin)` (top or `-Infinity`) plus `hit`
  (`[x0, y0, z0, x1, y1, z1]`, `y0` = base) and `avoidSolids` / `glanceOffWall` from
  `world/city/collide.ts` give look-ahead steering and soft wall glances for free. `collide()`
  and `pushPoint()` follow `KarstWorld` / `CityWorld` (up-normal = skim, sideways = glance).
- **Ground**: `ChunkManager(field, { decor, material, color })`; `color` paints vertices.
  `flightGround` = terrain + soft canopy (trees, roofs) the bird skims.
- **Instanced decor**: a `ChunkDecor` (`scatter` per chunk, `rebuild` refills global
  `InstancedMesh`es); see `KarstDecor`. `Trees` takes custom geometries; `colored()` from
  `Trees.ts` paints primitives for `mergeGeometries`. Give meshes a `name` (shows in the
  triangle report).
- **Atmosphere**: `withMist(material)` + `mistUniforms` (`world/Mist.ts`) for valley mist and
  distance haze; set the uniforms in `World.frame`, zero them in `dispose`. `new Clouds(seed,
n, layer)` for low banks or extra cloud layers. Per-level palettes: `makePalette` +
  `DAY_SKY.map(...)` (same phases and names as the default day). Glow: HDR colours (> 1)
  in a `MeshBasicMaterial` bloom after dark.
- **Wisps**: a `WispPlanner` plans a whole polyline, checks it clear and only then spawns
  (`KarstWisps.ts` `pathClear`/`commit`). Keep the trend heading and the gap step-back in
  `commit`. Return `false` sometimes so generic patterns (and thermal spirals) appear.
  `wispFloor` must lift generic paths over solids.

## 5. Tests (`tests/<name>.test.ts`)

Copy `tests/karst.test.ts`: determinism per seed; spawn in open space with a clear run ahead;
props respect their rules; `pushPoint` exits sideways on a wall and upward on a top; and the
bot flight via `flyBot(world, spawn, seed, 120, inSolid)` from `tests/helpers.ts`:
`inside === 0`, `got > 150`, `glances <= 2` on two seeds.

## 6. Look at it

With `npm run dev` running: `node scripts/level-shots.mjs <id>` (add `--at x,y,z,yaw,pitch,phase`
for specific spots). It writes `shots/<id>/*.png` (title, phone title, dawn, golden, night,
altitude) and prints `info()` and the heaviest meshes. Read the PNGs, fix, repeat.
Check a runtime switch to another level: nothing (mist, palette) may leak.

## Traps already hit

- **NaN from an infinite push**: a push-out branch that can add `Infinity` (no surface
  overhead) poisons the flight state; the bird ends up at 0,0,0. Guard every branch.
- **Reset outputs only when you move**: clearing the push normal before an early `break`
  returned "pushed, normal 0".
- **Ribbons doubling back**: patterns choosing headings relative to the last pattern drift in
  circles; the cursor lands behind the bird and re-anchors constantly (wisps spawn and expire
  unseen, the bot gathers <0.8/s). Pick headings relative to a slow trend heading.
- **Margins**: the bot (and players) cut the inside of bends; plan paths ~9 m clear of rock,
  slalom amplitudes <= ~17 m.
- **Triangle budget**: High should stay under ~600k triangles (Highlands ~200k). A 7-culm
  bamboo clump was 532 triangles x 1400 = 728k; use ~50-triangle props and a coarse far LOD
  for big meshes.
- **Scratch state in layouts**: queries that leave results in fields (`river()` -> `rd`)
  must be read before the next query overwrites them.
- **Noise at the origin is 0**: simplex `fbm(0, 0) === 0`, handy (a contour passes through the
  spawn) but a trap if a feature assumes otherwise.
- **Painted horizons**: evenly sized round humps read as an aqueduct; vary heights strongly
  and keep peaks taller than wide.

## Done means

- `npm run check` passes; the bot test numbers above hold.
- Shots reviewed at dawn, golden, night, altitude and the phone title; triangles within budget.
- README, DESIGN (section + decisions log), CLAUDE.md and `scripts/shots.mjs` updated; README
  shots made with `npm run shots` (copy just the new level's files to `docs/screenshots/`).
