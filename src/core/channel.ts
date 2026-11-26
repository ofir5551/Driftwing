/**
 * Which build this is, from VITE_CHANNEL at build time.
 *
 * The dev channel (`dev`, served at /dev/ on GitHub Pages beside the players' build) opens every
 * level, bird, plumage and trail, saves no journey (so no flock, no light: URL flags such as
 * `?journey=N` and `?flock=N` set them per visit) and keeps its settings under its own keys, so
 * it never touches the players' save on the same site.
 *
 * The Eden channel (`eden`, at /eden/) is Tal and Hadar's wedding invitation: Eden alone, the
 * default bird, no level or bird picks, no journey or unlocks, nothing saved at all (every visit
 * starts fresh), no service worker. Reaching the venue offers the full game (FULL_GAME_URL).
 */
export const DEV_CHANNEL: boolean = import.meta.env.VITE_CHANNEL === 'dev';
export const EDEN_CHANNEL: boolean = import.meta.env.VITE_CHANNEL === 'eden';

/** The players' build, relative to /eden/ (the same Pages site). */
export const FULL_GAME_URL = '../';
