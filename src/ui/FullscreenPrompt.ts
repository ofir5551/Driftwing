import {
  fullscreenSupport,
  isFullscreen,
  isStandalone,
  onFullscreenChange,
  platform,
  toggleFullscreen,
  type Platform,
} from './Fullscreen';
import { canPromptInstall, onInstallChange, promptInstall } from '../pwa';
import { loadFsPromptOff, saveFsPromptOff } from '../core/Settings';
import { PERSONAL_CHANNEL } from '../core/channel';

/** iOS's Share glyph (a box with an arrow out of it), so the step points at what to look for. */
const SHARE_ICON =
  '<svg class="fsp-glyph" viewBox="0 0 24 24" aria-label="Share"><path d="M12 15V3M8 7l4-4 4 4M7 10H5v11h14V10h-2"/></svg>';

/** The steps to put Driftwing on the home screen, per platform (the browser's own words in bold).
 *  The desktop lines are alternatives, one per browser, so they are bulleted, not numbered. */
const STEPS: Record<Platform, string[]> = {
  ios: [
    `Tap <b>Share</b> ${SHARE_ICON}: in Safari it is in the bottom bar (or under <b>⋯</b>), in Chrome at the top.`,
    'Scroll down and tap <b>Add to Home Screen</b>.',
    'Tap <b>Add</b>, then open Driftwing from your Home Screen.',
  ],
  android: [
    'Open the browser menu: <b>⋮</b> at the top right in Chrome.',
    'Tap <b>Install app</b> or <b>Add to Home screen</b>.',
    'Open Driftwing from your home screen.',
  ],
  desktop: [
    'Chrome or Edge: click the install icon at the right of the address bar.',
    'Safari on a Mac: <b>File</b>, then <b>Add to Dock</b>.',
  ],
};

/**
 * The card over the title on launch while the browser's bars are showing: a "Go fullscreen"
 * button where the Fullscreen API exists, and how to install the app (the only way to fullscreen
 * on an iPhone; elsewhere it also means fullscreen on every launch). "Not now" closes it for this
 * launch, "Don't show again" for good. The title's own fullscreen pill stays either way.
 */
export class FullscreenPrompt {
  private readonly el: HTMLDivElement;

  /** Whether this launch should ask at all. `?fsprompt` always shows it (for checking the card);
   *  automated browsers (screenshot scripts) and `?autopilot` never see it. */
  static wanted(params: URLSearchParams): boolean {
    if (params.has('fsprompt')) return true;
    if (params.has('autopilot') || navigator.webdriver) return false;
    // A personal stage's link (no service worker, so nothing to install) only offers the
    // Fullscreen API: on an iPhone, which has none, there is nothing to ask.
    if (PERSONAL_CHANNEL && fullscreenSupport() !== 'api') return false;
    return !isStandalone() && !isFullscreen() && !loadFsPromptOff();
  }

  constructor(ui: HTMLElement) {
    const plat = platform();
    const api = fullscreenSupport() === 'api';
    const lead = api
      ? 'Driftwing is made to fill the whole screen, with the browser out of the way.'
      : "Driftwing is made to fill the whole screen. iPhone browsers can't hide their bars for a web page, but installed on your Home Screen it opens fullscreen.";
    this.el = document.createElement('div');
    this.el.className = 'menu fs-prompt';
    this.el.setAttribute('role', 'dialog');
    this.el.setAttribute('aria-modal', 'true');
    this.el.setAttribute('aria-labelledby', 'fsp-title');
    this.el.innerHTML = `<div class="card">
        <h2 id="fsp-title">Best experienced fullscreen</h2>
        <p class="fsp-lead">${lead}</p>
        ${api ? '<button class="btn primary fsp-go">Go fullscreen</button>' : ''}
        <div class="fsp-install">
          <h3>${api ? 'Or install it as an app' : 'Install it as an app'}</h3>
          <p class="fsp-why">It opens fullscreen every time, and plays offline.</p>
          <button class="btn fsp-install-btn" hidden>Install Driftwing</button>
          <ol class="fsp-steps${plat === 'desktop' ? ' fsp-alts' : ''}">${STEPS[plat].map((s) => `<li>${s}</li>`).join('')}</ol>
          <p class="fsp-done" hidden>Open it from your ${plat === 'desktop' ? 'apps' : 'home screen'}.</p>
        </div>
        <div class="fsp-foot">
          <button class="btn ghost fsp-later">Not now</button>
          <button class="fsp-never">Don't show again</button>
        </div>
      </div>`;
    ui.appendChild(this.el);

    const q = <T extends HTMLElement>(sel: string) => this.el.querySelector<T>(sel)!;
    const installBtn = q<HTMLButtonElement>('.fsp-install-btn');
    const steps = q<HTMLElement>('.fsp-steps');
    let installed = false;
    // The browser's own install dialog, where it offers one, replaces the menu steps.
    const syncInstall = () => {
      // `appinstalled` lands after the dialog: the offer is gone then, but the steps must not return.
      if (installed) return;
      const native = canPromptInstall();
      installBtn.hidden = !native;
      steps.hidden = native;
    };
    syncInstall();
    onInstallChange(syncInstall);
    installBtn.addEventListener('click', () => {
      void promptInstall().then((ok) => {
        if (!ok) return;
        installed = true;
        installBtn.hidden = true;
        steps.hidden = true;
        q<HTMLElement>('.fsp-why').hidden = true;
        q<HTMLElement>('.fsp-install h3').textContent = 'Installed';
        q<HTMLElement>('.fsp-done').hidden = false;
        q<HTMLElement>('.fsp-later').textContent = 'Keep playing here';
        q<HTMLElement>('.fsp-never').hidden = true;
        // Installed: this browser needn't ask again.
        saveFsPromptOff();
      });
    });

    this.el
      .querySelector<HTMLButtonElement>('.fsp-go')
      ?.addEventListener('click', () => void toggleFullscreen());
    // However fullscreen comes (this button, the title's pill or corner, F11), the card is done.
    onFullscreenChange((on) => on && this.close());
    q('.fsp-later').addEventListener('click', () => this.close());
    q('.fsp-never').addEventListener('click', () => {
      saveFsPromptOff();
      this.close();
    });
    this.el.addEventListener('keydown', (e) => e.key === 'Escape' && this.close());
    // Taps on the card must not reach the game (flap/steer) underneath.
    this.el.addEventListener('pointerdown', (e) => e.stopPropagation());
    // Shown a frame later, so the fade-in runs.
    requestAnimationFrame(() => this.el.classList.add('show'));
  }

  close(): void {
    this.el.classList.remove('show');
  }
}
