import { Config } from './Config';

/**
 * Anonymous play stats, sent to PostHog (EU cloud) so we can see how long flights last, how many
 * players come back and where on the journey they stop. Deliberately small, instead of PostHog's
 * own library: no autocapture, no session recording, no cookies, nothing but the events we name.
 *
 * The only thing kept on the device is a random id (no account, no personal data), so a player
 * who comes back on another day counts as the same player. Events wait in storage while offline
 * and are sent in batches; the last ones go with the page (`sendBeacon`).
 *
 * Pure: storage, the network, the clock and the id source are injected, so Vitest runs it in
 * Node. `browserAnalytics` wires the real ones. main.ts decides when it runs at all (never on
 * the dev channel, a personal stage, the autopilot, automated browsers or test URL flags).
 */

/** The PostHog project's key: public by design, it can only send events. */
export const POSTHOG_KEY = 'phc_kgckSGpc7pLE3SSiwZX3CDJGu24C2x53ZxahBnQE3dhS';
export const POSTHOG_BATCH_URL = 'https://eu.i.posthog.com/batch/';

export type Props = Record<string, string | number | boolean | null>;

export interface QueuedEvent {
  event: string;
  properties: Props;
  /** When it happened (ISO): a batch sent later, after being offline, keeps the real time. */
  timestamp: string;
}

export interface Store {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}

export interface Transport {
  /** Posts a body; true once the server has taken it. */
  send(body: string): Promise<boolean>;
  /** Hands a body to the browser to send as the page goes; true if it was queued. */
  beacon(body: string): boolean;
}

export interface AnalyticsDeps {
  store: Store;
  transport: Transport;
  now: () => number;
  uuid: () => string;
  /** Properties every event carries, read when it is tracked (version, light, device). */
  base: () => Props;
}

/** Who this device is to the stats: a random id, the first visit and the flights started. */
interface Identity {
  id: string;
  first: number;
  flights: number;
}

const ID_KEY = 'driftwing:analytics';
const QUEUE_KEY = 'driftwing:analytics-queue';
/** A flight still under way as the page went out of sight (see `holdFlight`). */
const FLIGHT_KEY = 'driftwing:analytics-flight';
const DAY = 86_400_000;

export class Analytics {
  readonly identity: Identity;
  private queue: QueuedEvent[];
  /** The batch a send has out, if any: the page going meanwhile must not beacon it again. */
  private inflight: ReadonlySet<QueuedEvent> | null = null;

  constructor(private readonly deps: AnalyticsDeps) {
    this.identity = this.loadIdentity();
    this.queue = this.loadQueue();
    // A flight whose end never got out (the page was closed, or the phone dropped it in the
    // background): it counts as closed, at the moment it was last seen.
    const held = this.read<QueuedEvent>(FLIGHT_KEY);
    if (held && typeof held.event === 'string') this.push(held);
    deps.store.remove(FLIGHT_KEY);
  }

  get pending(): number {
    return this.queue.length;
  }

  /** Counts a new flight and returns its number (1 for a player's first). */
  newFlight(): number {
    this.identity.flights++;
    this.write(ID_KEY, this.identity);
    return this.identity.flights;
  }

  track(event: string, props: Props = {}): void {
    this.push(this.make(event, props));
    if (this.queue.length >= Config.analytics.batch) void this.flush();
  }

  /**
   * Keeps a flight's end (`flight_end`, how 'closed') in storage while the page is out of sight,
   * to be sent on the next visit if the page never comes back; null drops it (the player came
   * back, or the flight ended properly).
   */
  holdFlight(props: Props | null): void {
    if (props) this.write(FLIGHT_KEY, this.make('flight_end', props));
    else this.deps.store.remove(FLIGHT_KEY);
  }

  /** Sends one batch over the network; failures keep it for the next try. */
  async flush(): Promise<void> {
    if (this.inflight || this.queue.length === 0) return;
    const batch = this.queue.slice(0, Config.analytics.batch);
    const out = new Set(batch);
    this.inflight = out;
    // Offline or blocked (a rejected send): the events wait for the next try.
    const ok = await this.deps.transport.send(this.body(batch)).catch(() => false);
    this.inflight = null;
    if (ok) this.drop(out);
  }

  /** The page is going: hands one batch to the browser, which sends it after we are gone. */
  flushNow(): void {
    const out = this.inflight;
    const batch = (out ? this.queue.filter((e) => !out.has(e)) : this.queue).slice(
      0,
      Config.analytics.batch,
    );
    if (batch.length === 0 || !this.deps.transport.beacon(this.body(batch))) return;
    this.drop(new Set(batch));
  }

  /** Forgets sent events, by identity: the queue may have been trimmed while they were out. */
  private drop(sent: ReadonlySet<QueuedEvent>): void {
    this.queue = this.queue.filter((e) => !sent.has(e));
    this.saveQueue();
  }

  private make(event: string, props: Props): QueuedEvent {
    const now = this.deps.now();
    return {
      event,
      properties: {
        ...this.deps.base(),
        ...props,
        distinct_id: this.identity.id,
        // Anonymous events: no person profiles (cheaper, and there is nobody to profile).
        $process_person_profile: false,
        // Where a player is isn't ours to know.
        $geoip_disable: true,
        $lib: 'driftwing',
        days: Math.floor((now - this.identity.first) / DAY),
        flights: this.identity.flights,
      },
      timestamp: new Date(now).toISOString(),
    };
  }

  private push(e: QueuedEvent): void {
    this.queue.push(e);
    // Long offline: the oldest go first, so storage never grows without end.
    const over = this.queue.length - Config.analytics.queueMax;
    if (over > 0) this.queue.splice(0, over);
    this.saveQueue();
  }

  private body(batch: readonly QueuedEvent[]): string {
    // `sent_at` lets PostHog correct a device clock that is off.
    return JSON.stringify({
      api_key: POSTHOG_KEY,
      sent_at: new Date(this.deps.now()).toISOString(),
      batch,
    });
  }

  private loadIdentity(): Identity {
    const saved = this.read<Partial<Identity>>(ID_KEY);
    if (
      saved &&
      typeof saved.id === 'string' &&
      typeof saved.first === 'number' &&
      typeof saved.flights === 'number'
    )
      return { id: saved.id, first: saved.first, flights: saved.flights };
    const fresh = { id: this.deps.uuid(), first: this.deps.now(), flights: 0 };
    this.write(ID_KEY, fresh);
    return fresh;
  }

  private loadQueue(): QueuedEvent[] {
    const saved = this.read<unknown>(QUEUE_KEY);
    return Array.isArray(saved)
      ? saved.filter((e): e is QueuedEvent => !!e && typeof e.event === 'string')
      : [];
  }

  private saveQueue(): void {
    if (this.queue.length === 0) this.deps.store.remove(QUEUE_KEY);
    else this.write(QUEUE_KEY, this.queue);
  }

  private read<T>(key: string): T | null {
    try {
      const raw = this.deps.store.get(key);
      return raw === null ? null : (JSON.parse(raw) as T);
    } catch {
      return null;
    }
  }

  private write(key: string, value: unknown): void {
    this.deps.store.set(key, JSON.stringify(value));
  }
}

/** localStorage, quietly doing nothing where it throws (private mode, storage disabled). */
const browserStore: Store = {
  get: (k) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k, v) => {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* full or disabled: the stats just aren't kept */
    }
  },
  remove: (k) => {
    try {
      localStorage.removeItem(k);
    } catch {
      /* disabled */
    }
  },
};

// The body goes as text/plain (PostHog reads it as JSON either way): a "simple" request needs
// no CORS preflight, so it also works for keepalive fetches and beacons.
const browserTransport: Transport = {
  send: (body) =>
    fetch(POSTHOG_BATCH_URL, { method: 'POST', body, keepalive: body.length < 60_000 }).then(
      (r) => r.ok,
    ),
  beacon: (body) =>
    typeof navigator.sendBeacon === 'function' &&
    navigator.sendBeacon(POSTHOG_BATCH_URL, new Blob([body], { type: 'text/plain' })),
};

function uuid(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const b = crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** The client in a browser: sends on a timer, when the connection returns, and as the page goes
 *  (the caller calls `flushNow` on pagehide and when the page is hidden). */
export function browserAnalytics(base: () => Props): Analytics {
  const a = new Analytics({
    store: browserStore,
    transport: browserTransport,
    now: () => Date.now(),
    uuid,
    base,
  });
  setInterval(() => {
    if (navigator.onLine !== false) void a.flush();
  }, Config.analytics.flushEvery * 1000);
  addEventListener('online', () => void a.flush());
  return a;
}
