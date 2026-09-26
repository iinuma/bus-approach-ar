import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';

import type { RtSnapshot } from '../src/core/realtime.js';
import type { StopData } from '../src/core/stopdata.js';
import { APP_KEY_HEADER, createRtProxy, parseStopKey } from '../proxy/src/rt-proxy.js';

const data = JSON.parse(readFileSync('data/stops/rinko/5010.json', 'utf8')) as StopData;
const MONDAY = new Date('2026-09-28T08:00+09:00').getTime();
// 月曜に走る便と、日曜にしか走らない便
const weekdayTrip = data.departures.find((d) => d.service === 'O_0003_1')!.trip;
const sundayTrip = data.departures.find((d) => d.service === 'O_0003_3')!.trip;

const vehicle = (trip: string, id: string) => ({ trip, vehicle: id, lat: 0, lng: 0, bearing: null, speedMps: null, ts: 1, stopId: null, seq: 1, status: null });
const snapshot: RtSnapshot = {
  feedTs: 1,
  fetchedTs: 1,
  vehicles: [vehicle(weekdayTrip, 'A'), vehicle(sundayTrip, 'S'), vehicle('other-route', 'B')],
  tripUpdates: [{ trip: 'other-route', vehicle: 'B', ts: 1, stops: [] }],
};

function proxy(overrides: Partial<Parameters<typeof createRtProxy>[0]> = {}) {
  let calls = 0;
  const handle = createRtProxy({
    fetchSnapshot: async () => {
      calls += 1;
      return snapshot;
    },
    loadStop: async (feed, id) => (feed === 'rinko' && id === '5010' ? data : null),
    appKey: 'k',
    now: () => MONDAY,
    ...overrides,
  });
  return { handle, calls: () => calls };
}

const req = (path: string, query: Record<string, string>, headers: Record<string, string> = { [APP_KEY_HEADER]: 'k' }, sourceIp = '1.2.3.4') => ({
  method: 'GET',
  path,
  query,
  headers,
  sourceIp,
});

test('停留所の鍵の形', () => {
  assert.deepEqual(parseStopKey('rinko:5010'), { feed: 'rinko', id: '5010' });
  assert.deepEqual(parseStopKey('kawasaki_city:94'), { feed: 'kawasaki_city', id: '94' });
  assert.equal(parseStopKey('nope:1'), null);
  assert.equal(parseStopKey('rinko:../x'), null);
});

test('共有鍵が無いと 403', async () => {
  const { handle } = proxy();
  assert.equal((await handle(req('/stop', { key: 'rinko:5010' }, {}))).status, 403);
});

test('/stop はその日に走る便だけ返し、gzip を受け付けるなら圧縮する', async () => {
  const { handle } = proxy();
  const plain = await handle(req('/stop', { key: 'rinko:5010' }));
  assert.equal(plain.status, 200);
  const body = JSON.parse(plain.body) as StopData;
  assert.ok(body.departures.some((d) => d.trip === weekdayTrip));
  assert.ok(!body.departures.some((d) => d.trip === sundayTrip), '月曜に日曜ダイヤは要らない');
  assert.ok(body.departures.length < data.departures.length);

  const zipped = await handle(req('/stop', { key: 'rinko:5010' }, { [APP_KEY_HEADER]: 'k', 'accept-encoding': 'gzip, br' }));
  assert.equal(zipped.headers['content-encoding'], 'gzip');
  assert.equal(zipped.base64, true);
  assert.deepEqual(JSON.parse(gunzipSync(Buffer.from(zipped.body, 'base64')).toString()), body);

  assert.equal((await handle(req('/stop', { key: 'rinko:9999' }))).status, 404);
  assert.equal((await handle(req('/stop', { key: 'bad' }))).status, 400);
});

test('/rt はその停留所・その日の便だけ返す', async () => {
  const { handle } = proxy();
  const res = await handle(req('/rt', { key: 'rinko:5010' }));
  const body = JSON.parse(res.body) as RtSnapshot;
  assert.deepEqual(body.vehicles.map((v) => v.vehicle), ['A']);
  assert.equal(body.tripUpdates.length, 0);
  assert.equal(res.headers['access-control-allow-origin'], '*');
});

test('0.1.0 との互換: /?feed=rinko は大師橋駅前の便を返す', async () => {
  const { handle } = proxy();
  const res = await handle(req('/', { feed: 'rinko' }));
  assert.equal(res.status, 200);
  const body = JSON.parse(res.body) as RtSnapshot;
  assert.deepEqual(body.vehicles.map((v) => v.vehicle).sort(), ['A', 'S']);
  assert.equal((await handle(req('/', { feed: 'kawasaki_city' }))).status, 404);
});

test('RT は 15 秒キャッシュする', async () => {
  let t = MONDAY;
  const { handle, calls } = proxy({ now: () => t });
  await handle(req('/rt', { key: 'rinko:5010' }));
  t += 10_000;
  await handle(req('/rt', { key: 'rinko:5010' }));
  assert.equal(calls(), 1);
  t += 6_000;
  await handle(req('/rt', { key: 'rinko:5010' }));
  assert.equal(calls(), 2);
});

test('IP ごとに毎分の上限', async () => {
  const { handle } = proxy({ rateLimitPerMinute: 2 });
  assert.equal((await handle(req('/rt', { key: 'rinko:5010' }))).status, 200);
  assert.equal((await handle(req('/rt', { key: 'rinko:5010' }))).status, 200);
  assert.equal((await handle(req('/rt', { key: 'rinko:5010' }))).status, 429);
  assert.equal((await handle(req('/rt', { key: 'rinko:5010' }, undefined, '5.6.7.8'))).status, 200);
});
