/**
 * Installs and updates the service worker (src/sw.ts): offline play, and what lets browsers
 * offer "Install". Production builds only; the dev server always serves fresh files.
 *
 * Updates: a new build installs in the background and waits. `updateReady` turns true once it
 * is ready; `applyUpdate` swaps it in and reloads. main.ts only does that at calm moments (back
 * on the title, or while the app is out of sight), never mid-flight.
 */

/** An installed app is usually resumed rather than relaunched, and browsers only look for a new
 *  service worker on navigation, so it also checks on each return, at most this often. */
const UPDATE_CHECK_MS = 60 * 60 * 1000;

let waiting: ServiceWorker | null = null;

export function registerServiceWorker(): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  addEventListener('load', () => {
    navigator.serviceWorker
      .register('./sw.js')
      .then((reg) => {
        const track = (w: ServiceWorker | null): void => {
          if (!w) return;
          // With no controller this is the first install, not an update.
          const check = () => {
            if (w.state === 'installed' && navigator.serviceWorker.controller) waiting = w;
          };
          check();
          w.addEventListener('statechange', check);
        };
        track(reg.waiting);
        track(reg.installing);
        reg.addEventListener('updatefound', () => track(reg.installing));

        let lastCheck = Date.now();
        document.addEventListener('visibilitychange', () => {
          if (document.hidden || Date.now() - lastCheck < UPDATE_CHECK_MS) return;
          lastCheck = Date.now();
          reg.update().catch(() => undefined); // offline: try again next time
        });
      })
      .catch(() => undefined); // no offline play (e.g. private mode); the game still runs
  });
}

/** A newer build is downloaded and waiting for `applyUpdate`. */
export function updateReady(): boolean {
  return waiting !== null;
}

/** Activates the waiting build and reloads into it. Save first. */
export function applyUpdate(): void {
  const w = waiting;
  if (!w) return;
  waiting = null;
  navigator.serviceWorker.addEventListener('controllerchange', () => location.reload(), {
    once: true,
  });
  w.postMessage('skip-waiting');
}
