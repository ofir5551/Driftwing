/**
 * The personal stages' ids: each is built on its own at /<id>/ (`.github/workflows/pages.yml`
 * loops over the same list) and the players' service worker leaves those paths alone (sw.ts
 * imports this, so it stays free of the levels themselves). A test checks it against the
 * levels with `personal` set. Never import it from the game: a module both bundles share would
 * be split into a chunk sw.js imports, and the worker must stay a classic script.
 */
export const PERSONAL_IDS: readonly string[] = ['eden'];
