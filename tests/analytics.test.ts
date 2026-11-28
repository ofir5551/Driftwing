import { describe, expect, it } from 'vitest';
import { Config } from '../src/core/Config';
import {
  Analytics,
  POSTHOG_KEY,
  type AnalyticsDeps,
  type QueuedEvent,
  type Store,
} from '../src/core/Analytics';

function memoryStore(): Store & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    get: (k) => data.get(k) ?? null,
    set: (k, v) => void data.set(k, v),
    remove: (k) => void data.delete(k),
  };
}

interface Sent {
  api_key: string;
  batch: QueuedEvent[];
}

/** A fake network: records bodies; `online` decides whether sends succeed. */
function rig(store = memoryStore(), start = Date.UTC(2026, 10, 28)) {
  const net = {
    online: true,
    hold: false,
    beaconOk: true,
    sent: [] as Sent[],
    beacons: [] as Sent[],
  };
  let release: (() => void) | null = null;
  const clock = { t: start };
  const deps: AnalyticsDeps = {
    store,
    transport: {
      send: (body) =>
        new Promise((resolve) => {
          const finish = () => {
            if (net.online) net.sent.push(JSON.parse(body) as Sent);
            resolve(net.online);
          };
          if (net.hold) release = finish;
          else finish();
        }),
      beacon: (body) => {
        if (net.beaconOk) net.beacons.push(JSON.parse(body) as Sent);
        return net.beaconOk;
      },
    },
    now: () => clock.t,
    uuid: () => 'device-1',
    base: () => ({ version: '9.9.9' }),
  };
  return {
    a: new Analytics(deps),
    deps,
    store,
    clock,
    net,
    release: () => release?.(),
  };
}

describe('Analytics', () => {
  it('sends anonymous events with the base properties, the id and the real time', async () => {
    const { a, net } = rig();
    a.track('app_open', { returning: false });
    await a.flush();
    expect(net.sent).toHaveLength(1);
    const [e] = net.sent[0].batch;
    expect(net.sent[0].api_key).toBe(POSTHOG_KEY);
    expect(e.event).toBe('app_open');
    expect(e.timestamp).toBe('2026-11-28T00:00:00.000Z');
    expect(e.properties).toMatchObject({
      version: '9.9.9',
      returning: false,
      distinct_id: 'device-1',
      $process_person_profile: false,
      $geoip_disable: true,
      days: 0,
      flights: 0,
    });
    expect(a.pending).toBe(0);
  });

  it('keeps the same id across visits and counts flights and days', () => {
    const store = memoryStore();
    const first = rig(store);
    first.a.newFlight();
    first.a.newFlight();
    const later = rig(store, Date.UTC(2026, 10, 30, 12));
    later.deps.uuid = () => 'another';
    expect(later.a.identity.id).toBe('device-1');
    expect(later.a.newFlight()).toBe(3);
    later.a.track('flight_start');
    const q = JSON.parse(store.data.get('driftwing:analytics-queue')!) as QueuedEvent[];
    expect(q[0].properties).toMatchObject({ flights: 3, days: 2 });
  });

  it('keeps events while offline, across a reload, and sends them once back', async () => {
    const store = memoryStore();
    const one = rig(store);
    one.net.online = false;
    one.a.track('flight_start');
    await one.a.flush();
    expect(one.a.pending).toBe(1);
    const two = rig(store);
    expect(two.a.pending).toBe(1);
    await two.a.flush();
    expect(two.net.sent[0].batch.map((e) => e.event)).toEqual(['flight_start']);
    expect(two.a.pending).toBe(0);
    expect(store.data.has('driftwing:analytics-queue')).toBe(false);
  });

  it('drops the oldest past the cap and sends in batches', async () => {
    const { a, net } = rig();
    net.online = false;
    for (let i = 0; i < Config.analytics.queueMax + 5; i++) a.track(`e${i}`);
    expect(a.pending).toBe(Config.analytics.queueMax);
    await new Promise((r) => setTimeout(r, 0)); // the automatic send (offline) settles
    net.online = true;
    await a.flush();
    expect(net.sent[0].batch).toHaveLength(Config.analytics.batch);
    expect(net.sent[0].batch[0].event).toBe('e5');
  });

  it('never beacons the batch a send still has out', async () => {
    const { a, net, release } = rig();
    a.track('one');
    net.hold = true;
    const sending = a.flush();
    a.track('two');
    a.flushNow();
    expect(net.beacons[0].batch.map((e) => e.event)).toEqual(['two']);
    release();
    await sending;
    expect(net.sent[0].batch.map((e) => e.event)).toEqual(['one']);
    expect(a.pending).toBe(0);
  });

  it('sends a flight held as the page hid on the next visit, unless it was dropped', () => {
    const store = memoryStore();
    const one = rig(store);
    one.a.holdFlight({ how: 'closed', seconds: 120 });
    const two = rig(store);
    expect(two.a.pending).toBe(1);
    two.a.flushNow();
    expect(two.net.beacons[0].batch[0]).toMatchObject({
      event: 'flight_end',
      properties: { how: 'closed', seconds: 120 },
    });
    const three = rig(store);
    expect(three.a.pending).toBe(0);
    three.a.holdFlight({ how: 'closed' });
    three.a.holdFlight(null); // the player came back
    expect(rig(store).a.pending).toBe(0);
  });

  it('shrugs off a broken save', () => {
    const store = memoryStore();
    store.data.set('driftwing:analytics', '{not json');
    store.data.set('driftwing:analytics-queue', '[1, null, {"event": "ok"}]');
    const { a } = rig(store);
    expect(a.identity.id).toBe('device-1');
    expect(a.pending).toBe(1);
  });
});
