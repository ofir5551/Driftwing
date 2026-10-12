# Driftwing

A calm, painterly bird-gliding game for the browser. Glide over an endless dreamy landscape,
follow ribbons of glowing wisps and build a melody as you gather them. No fail state, no timer,
no enemies. Everything (terrain, trees, sky, music, sound) is generated procedurally: the
repository contains no art or audio assets.

![Title screen at dawn](docs/screenshots/title.jpg)

| Day                                | Golden hour                                 |
| ---------------------------------- | ------------------------------------------- |
| ![Day](docs/screenshots/day.jpg)   | ![Golden hour](docs/screenshots/golden.jpg) |
| **Dusk**                           | **Twilight**                                |
| ![Dusk](docs/screenshots/dusk.jpg) | ![Twilight](docs/screenshots/twilight.jpg)  |

<img src="docs/screenshots/mobile.jpg" alt="Portrait phone layout" width="240">

## Play

```bash
npm install
npm run dev        # http://localhost:5173
```

| Action       | Mouse / keyboard                             | Touch                                         | Gamepad    |
| ------------ | -------------------------------------------- | --------------------------------------------- | ---------- |
| Steer        | Pointer offset from centre, or WASD / arrows | Drag anywhere (relative to where you touched) | Left stick |
| Flap         | Click or hold Space                          | Hold the wing button, or tap a second finger  | A / RT     |
| Pause        | P or Esc                                     | Pause button (top right)                      | Start      |
| Mute         | M                                            | Pause menu                                    |            |
| Pointer lock | L (optional, relative mouse steering)        |                                               |            |

Fly through wisps to score. Quick chains fill the **flow** ring, which multiplies points (up to
5x) and brings extra layers into the music. Every 24 wisps a lantern ignites ahead of you and
the music modulates. Rising **thermals** (sparkling columns) lift you for free. Brushing the
ground or water is only ever a soft skim.

## Develop

| Command           | What it does                                                                                 |
| ----------------- | -------------------------------------------------------------------------------------------- |
| `npm run dev`     | Dev server. Add `?debug` for the lil-gui tuning panel (every value in `src/core/Config.ts`). |
| `npm run check`   | Typecheck, lint, unit tests and production build.                                            |
| `npm test`        | Vitest: flight model, noise determinism, flow/score, fixed-step loop, music scheduler.       |
| `npm run build`   | Static production build in `dist/` (relative paths, deployable anywhere).                    |
| `npm run preview` | Serve the production build.                                                                  |
| `npm run shots`   | Regenerate the README screenshots (needs a running dev or preview server).                   |

URL flags: `?debug`, `?autopilot` (a bot flies and collects, used for screenshots),
`?time=0..1` (time of day), `?seed=N` (world seed), `?quality=low|medium|high`.

Pushing to `main` deploys to GitHub Pages via `.github/workflows/pages.yml` (enable Pages with
"GitHub Actions" as the source in the repository settings).

## How it works

- **Flight**: an arcade glide model (`src/player/FlightModel.ts`) that trades height for speed,
  steers through critically damped springs and can't stall or crash, at a fixed 60 Hz step with
  interpolated rendering.
- **World**: seeded simplex noise drives one height function shared by terrain chunks (streamed,
  pooled, two LODs), instanced forests, wisp placement and collisions. A palette-driven day cycle
  tints sky, fog, light, water and the post grade.
- **Look**: soft toon banding, gentle bloom, a paper-grain/edge-wobble/grade/vignette pass.
- **Music**: a Web Audio lookahead scheduler plays detuned pads, a drone, FM bells and
  flow-driven layers in pentatonic keys that drift with the time of day. Each wisp plays the
  next note of a phrase, quantized to the beat.

See [`docs/DESIGN.md`](docs/DESIGN.md) for the design and the decisions log.
