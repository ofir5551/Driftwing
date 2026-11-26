/**
 * Which build this is, from environment variables at build time.
 *
 * The dev channel (VITE_CHANNEL=dev, served at /dev/ on GitHub Pages beside the players' build)
 * opens every level, bird, plumage and trail, lists the personal stages too, saves no journey
 * (so no flock, no light: URL flags such as `?journey=N` and `?flock=N` set them per visit) and
 * keeps its settings under its own keys, so it never touches the players' save on the same site.
 *
 * A personal channel (VITE_PERSONAL=<level id>, at /<level id>/) is one personal stage on its
 * own (a level with `personal` set, e.g. Eden, Tal and Hadar's wedding invitation): that level
 * alone, the default bird, no level or bird picks, no journey or unlocks, nothing saved at all
 * (every visit starts fresh), no service worker. Its finale offers the full game (FULL_GAME_URL).
 * Personal stages are never listed in the players' game.
 */
export const DEV_CHANNEL: boolean = import.meta.env.VITE_CHANNEL === 'dev';

/** The personal stage this build flies, or null (the full game). Checked in levels/index. */
export const PERSONAL_ID: string | null = import.meta.env.VITE_PERSONAL || null;
export const PERSONAL_CHANNEL: boolean = PERSONAL_ID !== null;

/** The players' build, relative to /<level id>/ (the same Pages site). */
export const FULL_GAME_URL = '../';
