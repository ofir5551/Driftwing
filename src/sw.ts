/*
 * Driftwing's service worker: what makes the game installable and playable offline.
 *
 * Each build precaches every file it ships into its own cache. Pages are network first, so a
 * player who is online always opens the newest build; the cache is the offline fallback. Hashed
 * assets are cache first (their names change whenever their content does).
 *
 * A newer build installs in the background and then waits, keeping the old cache, so a game that
 * is already running never loses files mid-flight. `src/pwa.ts` swaps it in at a calm moment.
 *
 * Built by the `serviceWorker` plugin in vite.config.ts, which fills in the two placeholders.
 * This file is a classic script (no imports or exports): service workers from module scripts
 * are not supported everywhere yet.
 */

// Declarations in this script are global to the TS program, hence the `sw` prefixes.
// The few service worker types used here (the DOM lib does not include them).
interface SwExtendableEvent extends Event {
  waitUntil(p: Promise<unknown>): void;
}
interface SwFetchEvent extends SwExtendableEvent {
  readonly request: Request;
  respondWith(r: Promise<Response>): void;
}
interface SwScope {
  skipWaiting(): Promise<void>;
  readonly clients: { claim(): Promise<void> };
  addEventListener(type: 'install' | 'activate', cb: (e: SwExtendableEvent) => void): void;
  addEventListener(type: 'fetch', cb: (e: SwFetchEvent) => void): void;
  addEventListener(type: 'message', cb: (e: MessageEvent) => void): void;
}

const swScope = self as unknown as SwScope;
const SW_CACHE = 'driftwing-__DW_VERSION__';
/** This build's files, relative to the worker (so it works under /Driftwing/ on GitHub Pages). */
const SW_FILES = '__DW_FILES__'.split(',');
/** On a weak signal, give the network this long before opening the cached build instead. */
const SW_PAGE_TIMEOUT_MS = 4000;

swScope.addEventListener('install', (e) => {
  // `cache: 'reload'` skips the HTTP cache, so the precache never mixes in a stale copy.
  e.waitUntil(
    caches
      .open(SW_CACHE)
      .then((c) => c.addAll(SW_FILES.map((f) => new Request(f, { cache: 'reload' })))),
  );
});

swScope.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k.startsWith('driftwing-') && k !== SW_CACHE)
            .map((k) => caches.delete(k)),
        ),
      )
      .then(() => swScope.clients.claim()),
  );
});

// Sent by the page when it is ready to reload into the new build.
swScope.addEventListener('message', (e) => {
  if (e.data === 'skip-waiting') void swScope.skipWaiting();
});

swScope.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(req.mode === 'navigate' ? swPage(req) : swAsset(req));
});

async function swPage(req: Request): Promise<Response> {
  const cached = () => caches.match('index.html').then((r) => r ?? Response.error());
  // `no-cache` revalidates with the server, so a fresh deploy shows up on the next launch
  // instead of after the HTTP cache expires.
  const network = fetch(req.url, { cache: 'no-cache', credentials: 'same-origin' });
  network.catch(() => undefined); // a late failure after the timeout is not an error
  const timeout = new Promise<'timeout'>((r) => setTimeout(() => r('timeout'), SW_PAGE_TIMEOUT_MS));
  try {
    const res = await Promise.race([network, timeout]);
    if (res === 'timeout' || !res.ok) return await cached();
    return res;
  } catch {
    return cached(); // offline
  }
}

async function swAsset(req: Request): Promise<Response> {
  // `ignoreVary`: the page asks for its script and stylesheet in CORS mode (an Origin header the
  // precache requests lacked), and a `Vary` on that would miss. Every file name is unique anyway.
  const hit = await caches.match(req, { ignoreSearch: true, ignoreVary: true });
  if (hit) return hit;
  const res = await fetch(req);
  // A file this build did not precache (rare): keep it for next time offline.
  if (res.ok) {
    const copy = res.clone();
    void caches.open(SW_CACHE).then((c) => c.put(req, copy));
  }
  return res;
}
