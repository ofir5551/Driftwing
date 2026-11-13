# Persona review (2026-11-13)

Five independent reviewers, each playing a different kind of player, read DESIGN and the code and
played the game headlessly on iPhone SE and iPhone 14 in portrait. None of them saw the others'
reports. This file merges them. Nothing has been implemented.

| Persona                       | In one line                                                                                                                                      |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| Calm minimalist (core player) | "The best moment is when the HUD fades and it's just a bird, a lake and fog. Getting there is noisier than it needs to be."                      |
| Journey fan                   | "In its best frames it already does what thatgamecompany does. But the places are a pilgrimage and the structure around them is a content list." |
| Daily returner                | "Calm, no nagging, and the Rest card is lovely. But the track ends in about 18 flights, and then the number just counts."                        |
| Curious explorer              | "I flew 4 km out into the moss hills and nothing noticed I'd been anywhere. A great view and no guidebook."                                      |
| Non-gamer                     | "I pressed Play and it flew, which was a relief. Nobody told me how to steer, and tapping did nothing."                                          |

The key claims below were checked against the code (file:line references are as of this commit).

## What everyone wants to keep

- **No fail state.** A hands-off bird flew level for 80 s and still collected wisps. Every persona
  named this as the foundation.
- **One tap from Play to flight**, with the attract flight carrying straight into play.
- **The HUD fades away when you're idle.** The minimalist's favourite moment.
- **Every level opens on a composed postcard** (the Sky Gate, the Great Arch, the ship, the
  lighthouse beam, the Dome). The Journey fan and the explorer called these real "chills" moments.
- **Wisps write the melody**, and flow changes the arrangement, not just the volume (`audio/Music.ts`).
  The Journey fan's favourite idea in the game.
- **Calm progression rules**: nothing decays, there are no streaks, nothing can be missed, and the
  Rest card count-up with its unlock card works well.
- **The Aviary uses the live bird as its preview.**

## Where the personas agree (strong signals)

1. **A fresh title screen is a wall of locks (all five).** 8 of 9 cards say "Opens at N ✧", with
   six time chips and a journey bar under them. On the SE the card is about 607 px of content in a
   544 px viewport, so Aviary and Controls fall below the fold and the attract flight is mostly
   hidden. It reads as "a price list" (returner), "a store shelf" (Journey fan) or "a test"
   (non-gamer).
2. **The first-minute hints are wrong for a phone (minimalist, non-gamer, Journey fan).**
   - Steering is never taught in flight. The second hint slot (3.4 s) goes to boosting with a
     second finger, which a one-handed player can't do (`src/main.ts:272-277`).
   - Without a flap, the 14 s nudge shows the **same sentence again** (`main.ts:279-282`).
   - The hints are "once per visit" (`main.ts:137-139`, unsaved), and phones often unload the tab
     between short sessions, so regular players see them on nearly every launch.
   - They sit mid-screen, right over each opening's focal point (the Dome, the Sky Gate, the ship).
3. **The end of the track clumps, and then nothing (returner, Journey fan, explorer).** Sea of
   Clouds 3000, Atolls 3150, Ringmoon 3230 and the Phoenix 3300 (`Config.ts:366-369`) land within
   about a flight and a half. Meanwhile 2050-3000 has three long gaps with one cosmetic. After the
   Phoenix the title says "Journey complete" and light counts for nothing. DESIGN's track table is
   also missing the Ringmoon row.
4. **The world doesn't answer the player (explorer, Journey fan, returner).** Threading the Great
   Arch or gliding under the ship fires nothing: `core/Events.ts` has no landmark or visit event.
   Every hand-built place sits on the opening ribbon, so each one is seen in the first 30 s of
   every flight, and nothing further out is singular. All three point to the proposed Discoveries
   (DESIGN build order, step 8) as the answer.
5. **Too many numbers in flight (minimalist, Journey fan).** There's the running score in the
   largest type, "Lantern reached +1,000", "Dive-bomb ×1.4" and a toast every lantern
   (`Gameplay.ts:204, 235`). During active play the HUD never fades, so the fade only helps idle
   players. The Rest card leads with a scoreboard rather than the place you flew.

## Where they disagree, and how to settle it

- **More (returner, explorer, Journey fan) against less (minimalist, non-gamer).** Settle it with
  one rule: **new things live in the world and on the Rest card, never in the HUD or in toasts.**
  A discovery is a chime and a light in flight, named only on the Rest card. Progress shows as
  marks on the existing level cards, not on a new screen or button. That's "there for those who
  look, invisible to those who don't". The minimalist proposed exactly this policy.
- **Locked cards should stay visible (a logged decision, "Level locks") against hiding them (all
  five).** Middle ground: show the open levels plus **only the next** locked one, and fold the rest
  into the journey line ("6 more places on the journey"). The "something to look forward to" stays.
  This revisits a logged decision, so it's your call.
- **A one-finger tap to flap (non-gamer) against accidental flaps when a drag starts.** The pillar
  text says "a tap to flap", but today a one-finger tap does nothing in drag mode
  (`TouchControls.ts:96-110`). It's worth trying, but only with a test that a drag start never
  flaps and that flick tricks still read. Teaching steering (item 1 below) is cheaper and comes first.
- **Reordering the levels as one day (Journey fan) against just respacing them (returner).** The
  Journey fan wants dawn → mist → morning → noon → strange afternoon → golden hour → dusk → night
  (the low point) → sunrise above the clouds. The returner only wants even gaps. Respacing is an
  S-size fix both accept. The reorder is a bigger design call and moves Neon Bay from second to late.
- **The time of day following the real clock (returner)** could make a night player's first 30 s
  dark. If you do it, make it opt-in behind the existing "Auto".

## Recommended top 5

Ranked by how many personas each serves against effort. None breaks a pillar.

| #   | Change                                                                                                                                                                                                                                                                                                                                                                     | Who it serves                                                 | Effort |
| --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- | ------ |
| 1   | **Fix the first-minute hints.** At 3.4 s, if the player hasn't dragged yet, say "Slide your finger to steer". Show the boost hint only after they've steered, and never twice. Save completed hints in Settings so a returning player sees none. Place toasts below the bird, off the opening's focal point.                                                               | Non-gamer, minimalist, Journey fan                            | S      |
| 2   | **A calmer fresh title.** Show the open levels plus the next locked one, with "N more places" in the journey line. Make Aviary and Controls fit on the SE without scrolling.                                                                                                                                                                                               | All five                                                      | S-M    |
| 3   | **Respace the end of the track.** For example Atoll 2900, Ringmoon 3150, Phoenix 3450, plus one more milestone in 2050-3000. Add the Ringmoon row to DESIGN's table. Existing unlocks are kept (`granted`).                                                                                                                                                                | Returner, Journey fan                                         | S      |
| 4   | **Quieter numbers in flight.** Take the score off the in-flight HUD (it stays on pause and Rest). "Lantern reached" without "+points". Only the first lantern gets an "awakens" toast; the beam and bell carry the rest.                                                                                                                                                   | Minimalist, Journey fan                                       | S      |
| 5   | **Discoveries v1.** Add a shared `discovery` event and 3-5 finds per level, none on the opening ribbon (circle the lighthouse, glide the ship's seam, pass under the Sky Gate bridge…). Each find is a pure predicate in the level's Layout, testable in Vitest. In flight: a chime and a light. On the Rest card: its name. On the level card: ●●○○ marks. No new button. | Explorer, returner, Journey fan (minimalist's rule respected) | M-L    |

Items 1-4 are small and could ship together as one "first impressions and calm" pass. Item 5 is
the one that answers "why open it next week", which three personas asked independently.

**Status:** all five are built (see DESIGN's decisions log). Discoveries v1 has three finds per
level, not five, and the Neon Bay and City of Gold finds were placed where the wisps don't fly.

## Also worth doing (smaller)

- **Camera floor under trees.** After a gentle dive over forest the lens ended up inside a tree
  crown and the bird vanished. The chase camera's floor is terrain only (`Game.ts:88`). The bird
  avoids canopy but the camera doesn't. (non-gamer, S-M, hot-path query cost)
- **"New" marks in the Aviary** for an unseen bird, plumage or trail, using the same pattern as
  levels. Today a new bird can go unnoticed. (returner, S)
- **Richer unlock cards**: a swatch and a one-line blurb per plumage or trail, instead of the
  generic "New feathers". (returner, S)
- **A Resume-first pause card.** Move quality, invert and steering into the Controls panel so
  nothing scrolls on the SE. The fullscreen button overlaps the card's corner. Touch targets under
  44 px: time chips 27 px, checkboxes 18 px. Steering labels in plain words ("Drag anywhere" /
  "Buttons on screen"). (minimalist, non-gamer, M)
- **Plain words for the first minute**: "Fly through the golden lights"; hide "Next: Ember trail at
  120" until the first light is earned. (non-gamer, S)
- **Bring the wisps to a passive player.** Hands-off, the non-gamer saw the ribbon stay 34-50 m
  away but off-screen, so the run went dry. The explorer reports that wisps do re-anchor ahead when
  you wander off (`world/Wisps.ts:317-331`). Check which case leaves them beside or behind the bird.
  (non-gamer, S-M)
- **Show the iOS install tip once**, not on every title. (minimalist, S; code reading only)

## Bigger bets for later

- **A far light to fly toward** in each flight, which the wisp planner curves toward. Reaching it
  gives a swell and a held chord, then a soft offer to Rest. Nothing is timed and ignoring it costs
  nothing. It turns "endless" into "pilgrimage". (Journey fan, L)
- **Lanterns as musical chapters.** Each lantern reached adds a layer of the arrangement for the
  rest of the flight, instead of shifting the key. Minute 12 should not sound like minute 1.
  (Journey fan, M)
- **The ship as the thread between the worlds.** It already has nine rows of node pairs on its
  back (`world/ringmoon/geometry.ts:218-226`), and there are nine levels. Completing a level's
  discoveries lights one row. With all nine lit, the seam opens and wisps rise toward the giant's
  rings. This is a wordless story and a real ending. Builds on item 5. (explorer, M)
- **An ending in place of "Journey complete":** a one-time coda when the Phoenix opens, and a
  changed title afterwards. Pairs with the ship idea. (Journey fan, M)
- **After the track**, a rare cosmetic every 1000 ✧, so light keeps meaning something. (returner, S-M)
- **Wordless companions**: two or three birds of your species join you at high flow and peel away
  at a lantern. (Journey fan, M)
- **Lanterns you've reached stay lit** on later flights, a map drawn by your past flights.
  (explorer, M)
- **A curious wisp** that drifts toward an unfound discovery, a hint without words. (explorer, S-M)
- **Time-of-day secrets**: a beacon answers after dark, the aurora brightens at the ceiling.
  (explorer, S each)
- **Bird mastery**: three gentle goals per bird that open a second plumage. (returner, M)

## Logged decisions this would revisit

- "Level locks: locked level cards stay visible" (top 5, item 2).
- "Hints are once per visit" (item 1). It would become once per player.
- "The score stays as it is" (item 4). The score still exists, just off the in-flight HUD.
- The unlock order and Neon Bay's place as the second level, if you take the Journey fan's
  one-day reorder.

## Caveats

- Rendering was SwiftShader at 30-45 fps (iPhone 14 runs at about a third of real time), so
  timings are approximate. Hint timings were measured in game time.
- Audio was judged from the code, not heard.
- The scripted swipes never triggered flick tricks, so accidental tricks weren't tested.
- One Coral Atolls opening shot came out blank pink after 12 s, probably still loading on the
  software GPU. Not confirmed.
- The reviewers' screenshots were in the session's temporary scratch folder and aren't kept in the repo.
