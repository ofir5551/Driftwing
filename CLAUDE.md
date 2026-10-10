# Driftwing: notes for agents

Calm, painterly bird-gliding game. Vite + TypeScript (strict) + Three.js, Web Audio, no assets.
The design lives in `docs/DESIGN.md`. Read it before changing feel, visuals or audio.

## Commands

- `npm run dev`: dev server (http://localhost:5173). Add `?debug` for the lil-gui tuning panel and stats.
- `npm run check`: typecheck, lint, tests and production build. Run it before every commit.
- `npm run typecheck` / `npm run lint` / `npm test` / `npm run build` / `npm run format`
- `node scripts/shot.mjs <url> <out.png> [waitMs] [clickSelector] [w] [h]`: headless screenshot (needs the dev server).
- `npm run shots`: README screenshots into `shots/` (needs the dev server).
- URL flags: `?debug`, `?autopilot` (bot steers toward wisps, used for screenshots), `?time=0..1` (day phase), `?seed=N`, `?quality=low|medium|high`.

## Conventions

- Strict TS, no `any`. Small modules. Comment the _why_ for flight and audio-scheduling math.
- Every tunable number goes in `src/core/Config.ts` (exposed in the debug panel). No magic numbers in systems.
- Hot paths (`update`/`render`) must not allocate: reuse scratch `Vector3`s at module scope, pool objects.
- Pure logic (flight model, noise, music scheduler) stays free of Three scene/DOM so Vitest can test it in Node.
- Y is up. The bird's heading is a yaw angle; forward = (sin yaw, 0, cos yaw) rotated by pitch.

## Architecture

- `core/Loop.ts`: fixed 60 Hz physics step with an accumulator; render gets `alpha` for interpolation. dt is clamped.
- `core/Game.ts`: owns renderer, scene, systems; wires input -> flight -> world -> fx -> audio -> HUD.
- `core/Events.ts`: tiny typed event bus (wisp collected, flap, splash, lantern lit...) so audio/fx/ui stay decoupled.
- `player/FlightModel.ts`: pure arcade glide physics (state in, state out). `Bird.ts` is visuals only.
- `world/`: seeded noise -> height function shared by terrain mesh, collisions, tree and wisp placement.
  `ChunkManager` streams pooled terrain chunks around the player.
- `fx/Composer.ts`: render -> bloom -> painterly pass (grain, vignette, grade) -> output.
- `audio/`: `AudioEngine` (context, master bus, reverb), `Music` (lookahead scheduler), `Sfx`.
- `ui/`: plain DOM HUD and menus, styles in `ui/styles.css`.
