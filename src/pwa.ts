import { DEV_CHANNEL, PERSONAL_CHANNEL } from './core/channel';

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

/** Chrome/Edge/Samsung's install offer (not in the DOM typings: it is Chromium-only). */
interface InstallPromptEvent extends Event {
  prompt(): Promise<void>;
  readonly userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

let installEvent: InstallPromptEvent | null = null;
const installListeners: (() => void)[] = [];
const notifyInstall = () => {
  for (const cb of installListeners) cb();
};

// Caught from the first moment (it can fire before the title is built) and held, so the launch
// card can offer a real Install button instead of steps through the browser's menu.
addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault(); // no mini-infobar: the launch card makes the offer
  installEvent = e as InstallPromptEvent;
  notifyInstall();
});
addEventListener('appinstalled', () => {
  installEvent = null;
  notifyInstall();
});

/** The browser will show its own install dialog on `promptInstall`. */
export function canPromptInstall(): boolean {
  return installEvent !== null;
}

/** Calls `cb` when the offer arrives or is used up (installed). */
export function onInstallChange(cb: () => void): void {
  installListeners.push(cb);
}

/** Shows the browser's install dialog (from a tap). Resolves true if the player installed. The
 *  event works once, so the offer is gone afterwards either way. */
export async function promptInstall(): Promise<boolean> {
  const e = installEvent;
  if (!e) return false;
  installEvent = null;
  try {
    await e.prompt();
    return (await e.userChoice).outcome === 'accepted';
  } catch {
    return false;
  } finally {
    notifyInstall();
  }
}

export function registerServiceWorker(): void {
  // The dev and personal channels are always fetched fresh (the players' worker leaves them alone).
  if (!import.meta.env.PROD || DEV_CHANNEL || PERSONAL_CHANNEL || !('serviceWorker' in navigator))
    return;
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
