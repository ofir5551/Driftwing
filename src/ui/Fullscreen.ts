/** How (or whether) this device can go fullscreen:
 *  - 'api':  Fullscreen API works (desktop, Android, iPad).
 *  - 'ios':  iPhone Safari has no page fullscreen; only a home-screen web app launches without browser chrome.
 *  - 'none': nothing sensible to offer. */
export type FullscreenSupport = 'api' | 'ios' | 'none';

/** Safari before 16.4 only has the webkit-prefixed API. */
interface FsDocument extends Document {
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
  webkitFullscreenEnabled?: boolean;
}
interface FsElement extends HTMLElement {
  webkitRequestFullscreen?: () => Promise<void> | void;
}

const doc = document as FsDocument;

/** Launched from the home screen / installed: already chrome-free, nothing to offer. */
export function isStandalone(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean };
  return (
    nav.standalone === true ||
    matchMedia('(display-mode: standalone)').matches ||
    matchMedia('(display-mode: fullscreen)').matches
  );
}

export function fullscreenSupport(): FullscreenSupport {
  if (isStandalone()) return 'none';
  if (doc.fullscreenEnabled || doc.webkitFullscreenEnabled) return 'api';
  // iPhone (and iPod) Safari; iPadOS reports a Mac platform but does have the API, handled above.
  if (/iPhone|iPod/.test(navigator.userAgent)) return 'ios';
  return 'none';
}

export function isFullscreen(): boolean {
  return !!(doc.fullscreenElement ?? doc.webkitFullscreenElement);
}

/** Must be called from a user gesture. Failures (denied, unsupported) are swallowed: it is a nicety. */
export async function toggleFullscreen(): Promise<void> {
  try {
    if (isFullscreen()) {
      await (doc.exitFullscreen?.() ?? doc.webkitExitFullscreen?.());
    } else {
      const el = document.documentElement as FsElement;
      await (el.requestFullscreen?.({ navigationUI: 'hide' }) ?? el.webkitRequestFullscreen?.());
    }
  } catch {
    /* not allowed right now */
  }
}

/** Calls `cb` whenever fullscreen is entered or left (including via Esc). */
export function onFullscreenChange(cb: (on: boolean) => void): void {
  const fire = () => cb(isFullscreen());
  document.addEventListener('fullscreenchange', fire);
  document.addEventListener('webkitfullscreenchange', fire);
}
