import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import type { RtSnapshot } from '../src/core/realtime.js';
import type { StopData } from '../src/core/stopdata.js';
import { APP_KEY_HEADER, createRtProxy } from '../proxy/src/rt-proxy.js';

const data = JSON.parse(readFileSync('data/stops/daishibashi.json', 'utf8')) as StopData;
const mine = data.departures[0]!.trip;

const snapshot: RtSnapshot = {
  feedTs: 1,
  fetchedTs: 1,
  vehicles: [
    { trip: mine, vehicle: 'A', lat: 0, lng: 0, bearing: null, speedMps: null, ts: 1, stopId: null, seq: 1, status: null },
    { trip: 'other-route', vehicle: 'B', lat: 0, lng: 0, bearing: null, speedMps: null, ts: 1, stopId: null, seq: 1, status: null },
  ],
  tripUpdates: [{ trip: 'other-route', vehicle: 'B', ts: 1, stops: [] }],
};

function proxy(overrides: Partial<Parameters<typeof createRtProxy>[0]> = {}) {
  let calls = 0;
  const handle = createRtProxy({
    fetchSnapshot: async () => {
      calls += 1;
      return snapshot;
    },
    stops: [data],
    appKey: 'k',
    ...overrides,
  });
  return { handle, calls: () => calls };
}

const get = (headers: Record<string, string> = { [APP_KEY_HEADER]: 'k' }, feed = 'rinko', sourceIp = '1.2.3.4') => ({
  method: 'GET',
  path: '/',
  query: { feed },
  headers,
  sourceIp,
});

test('共有鍵が無いと 403', async () => {
  const { handle } = proxy();
  assert.equal((await handle(get({}))).status, 403);
});

test('収録している停留所に関係する便だけ返す', async () => {
  const { handle } = proxy();
  const res = await handle(get());
  assert.equal(res.status, 200);
  const body = JSON.parse(res.body) as RtSnapshot;
  assert.deepEqual(body.vehicles.map((v) => v.vehicle), ['A']);
  assert.equal(body.tripUpdates.length, 0);
  assert.equal(res.headers['access-control-allow-origin'], '*');
});

test('知らないフィードは 404、15 秒以内は上流を叩かない', async () => {
  let t = 0;
  const { handle, calls } = proxy({ now: () => t });
  assert.equal((await handle(get(undefined, 'nope'))).status, 404);
  await handle(get());
  t = 10_000;
  await handle(get());
  assert.equal(calls(), 1);
  t = 16_000;
  await handle(get());
  assert.equal(calls(), 2);
});

test('IP ごとに毎分の上限', async () => {
  const { handle } = proxy({ rateLimitPerMinute: 2, now: () => 0 });
  assert.equal((await handle(get())).status, 200);
  assert.equal((await handle(get())).status, 200);
  assert.equal((await handle(get())).status, 429);
  assert.equal((await handle(get(undefined, 'rinko', '5.6.7.8'))).status, 200);
});
