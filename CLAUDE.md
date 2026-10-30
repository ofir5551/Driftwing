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
  `?seed=N`, `?quality=low|medium|high`, `?level=highlands|city|karst|fjord`.
- Screenshot scripts take `CHROMIUM_PATH` to use a system Chromium (e.g. `/opt/pw-browsers/chromium`).
- Automation hooks on `window`: `__dw` (Game, `info()`), `__gp` (Gameplay), `__audio` (GameAudio).
- Headless Chromium: on Windows `--use-angle=d3d11` uses the real GPU; elsewhere SwiftShader works but is slow.

## Conventions

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
- `core/Loop.ts`: fixed 60 Hz step + accumulator; render gets `alpha` to interpolate. dt clamped.
- `core/Game.ts`: renderer, scene, flight, camera, sky/water/clouds, adaptive resolution/quality, and the
  current level's `World` (`setLevel` swaps it in place). Modes: `menu` (bot flies the attract backdrop),
  `playing`, `paused`. `onStep`/`onFrame` hooks.
- `levels/`: `World` interface + `LevelDef`; `Highlands` (chunks, trees, islands), `City`, `Karst`
  (Jade River, with its own palettes), `Fjord` (Aurora Fjords); `index` registry.
- `core/Gameplay.ts`: wisps, flow (`Progress`), thermals, lanterns, particles, trails, wind, HUD.
- `core/Events.ts`: typed bus (flap, contact, wisp, lantern, thermal) so audio/fx/ui stay decoupled.
- `player/FlightModel.ts`: pure arcade glide physics. `Bird.ts` visuals only. `ChaseCamera.ts` polar springs.
- `world/`: `noise` -> `Terrain` height field shared by `ChunkManager` (streaming, LOD, generic per-chunk
  decor), `Trees` (instanced), `Islands`, `Wisps` (+ optional level `WispPlanner`), `Thermals`. `DayCycle`
  palette drives `Sky` (incl. the city's Fuji), `Water`, `Clouds`, lights, post.
  `GroundDetail`: painted terrain detail (patches, strokes, strata, bumps) patched into toon materials.
- `world/city/`: `CityLayout` (pure plan: superblocks -> parts, trees, solid boxes; queries), `collide`
  (pure look-ahead + wall glance), `CityWisps` (avenue/spiral/glide planner, paths checked clear),
  `CityDecor` (instanced meshes), `geometry`, `materials` (facade + street shaders), `CityWorld`.
- `world/karst/`: `KarstLayout` (pure: rivers, pillars + shared radius profile, terrain, queries),
  `KarstWisps` (river/slalom/spiral planner), `KarstDecor`, `geometry`, `KarstWorld`.
  `world/Mist.ts`: shared valley-mist uniforms + `withMist` material patch (also in `Water`).
- `world/fjord/`: `FjordLayout` (pure: fjords, strand/wall/plateau terrain, icebergs, lighthouse;
  walls are terrain that `solidTop` reports for the look-ahead), `FjordWisps`, `FjordDecor`,
  `geometry`, `FjordWorld`. The aurora is the `aurora` backdrop in `Sky`.
- `fx/`: `Composer` (render -> bloom -> painterly -> output), `Particles` (ring-buffer pools), `Trails`,
  `Wind` (speed streaks), `BlobShadow`.
- `audio/`: `AudioEngine` (context, buses, synthesized reverb), `Music` (lookahead scheduler, layers),
  `Sfx`, `scales` (pure theory + `StepScheduler`), `GameAudio` (event wiring).
- `ui/`: `Hud`, `Menu`, `TouchControls`, `styles.css`.
