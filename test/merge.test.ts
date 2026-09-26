import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { buildBoard } from '../src/core/board.js';
import { baseName, groupStops, type GroupCandidate } from '../src/core/grouping.js';
import { mergeSnapshots, mergeStops } from '../src/core/merge.js';
import type { RtSnapshot } from '../src/core/realtime.js';
import { sliceForDay, upcomingDepartures } from '../src/core/service.js';
import type { StopData } from '../src/core/stopdata.js';
import type { StopIndex } from '../src/core/stopindex.js';
import { platformChoices } from '../src/core/stops.js';
import { createRtProxy } from '../proxy/src/rt-proxy.js';

const load = (key: string) => JSON.parse(readFileSync(`data/stops/${key.replace(':', '/')}.json`, 'utf8')) as StopData;
const MONDAY = new Date('2026-09-28T08:00+09:00').getTime();
const city = sliceForDay(load('kawasaki_city:94'), MONDAY); // 川崎駅（市バス）
const rinko = sliceForDay(load('rinko:10'), MONDAY); // 川崎駅前（臨港）

const c = (key: string, feed: string, name: string, lat: number, lng: number): GroupCandidate => ({ key, feed, name, lat, lng, departures: 1 });

test('まとめる判定: 末尾の「前」違い・近い・他社だけ', () => {
  assert.equal(baseName('川崎駅前'), '川崎駅');
  assert.equal(baseName('ＥＮＥＯＳ 前'), 'ENEOS');
  const groups = groupStops([
    c('kawasaki_city:94', 'kawasaki_city', '川崎駅', 35.5306, 139.6986),
    c('rinko:10', 'rinko', '川崎駅前', 35.5303, 139.6984), // 40m
    c('kawasaki_city:1', 'kawasaki_city', '山崎', 35.5, 139.6),
    c('rinko:2', 'rinko', '山崎', 35.545, 139.6), // 同名だが 5km
    c('kawasaki_city:3', 'kawasaki_city', '昭和駅前', 35.52, 139.72),
    c('rinko:4', 'rinko', 'レゾナック前', 35.5202, 139.72), // 近いが名前が違う
    c('kawasaki_city:5', 'kawasaki_city', '観音二丁目川崎大師口', 35.5296, 139.7291),
    c('rinko:6', 'rinko', '観音二丁目', 35.5297, 139.7291), // 頭が一致・11m
  ]);
  const keys = groups.map((g) => g.members.map((m) => m.key).join('+')).sort();
  assert.ok(keys.includes('kawasaki_city:94+rinko:10'));
  assert.ok(keys.includes('kawasaki_city:5+rinko:6'));
  assert.ok(keys.includes('kawasaki_city:1') && keys.includes('rinko:2'));
  assert.ok(keys.includes('kawasaki_city:3') && keys.includes('rinko:4'));
});

test('同じ事業者の停留所どうしはまとめない。他社とは 1 つとだけ組む', () => {
  const groups = groupStops([
    c('rinko:1', 'rinko', '銀柳街入口', 35.53, 139.7),
    c('rinko:2', 'rinko', '銀柳街入口', 35.5301, 139.7),
    c('kawasaki_city:3', 'kawasaki_city', '銀柳街入口', 35.53005, 139.7),
  ]);
  assert.equal(groups.length, 2);
  assert.ok(groups.every((g) => new Set(g.members.map((m) => m.feed)).size === g.members.length));
});

test('索引: 川崎駅は市バスと臨港の 1 つのバス停になっている', () => {
  const index = JSON.parse(readFileSync('data/stops/index.json', 'utf8')) as StopIndex;
  const kawasaki = index.stops.find((s) => s.key === 'kawasaki_city:94+rinko:10');
  assert.ok(kawasaki);
  assert.deepEqual(kawasaki.operators, ['市バス', '臨港']);
  assert.ok(!index.stops.some((s) => s.key === 'rinko:10'), '単独の川崎駅前は残らない');
});

test('まとめた時刻表: 両社の便が時刻順に混ざり、ID は事業者で分かれる', () => {
  const merged = mergeStops([city, rinko], '川崎駅前');
  assert.equal(merged.departures.length, city.departures.length + rinko.departures.length);
  assert.ok(merged.departures.every((d, i) => i === 0 || merged.departures[i - 1]!.t <= d.t));
  assert.ok(merged.departures.every((d) => /^(kawasaki_city|rinko)\//.test(d.trip) && d.platform.includes('/') && d.service in merged.services));
  assert.ok(merged.arrivals.every((a) => merged.paths[a.path]!.stops.at(-1)!.id === a.platform), '経路の終点が乗り場');
  const operators = new Set(upcomingDepartures(merged, MONDAY).map((d) => d.dep.platform.split('/')[0]));
  assert.deepEqual([...operators].sort(), ['kawasaki_city', 'rinko']);

  const labels = platformChoices(merged).map((p) => p.label);
  assert.ok(labels.some((l) => l.startsWith('臨港 1番')), labels.join(','));
  assert.ok(labels.some((l) => l.startsWith('市バス 川04')), labels.join(','));
});

test('まとめたリアルタイム: 車両は自社の便と結びつく', () => {
  const merged = mergeStops([city, rinko]);
  const cityDep = city.departures.find((d) => d.t >= 8 * 3600)!;
  const rinkoDep = rinko.departures.find((d) => d.t >= 8 * 3600)!;
  const v = (trip: string, id: string, stopId: string) => ({
    trip, vehicle: id, lat: 35.5305, lng: 139.6985, bearing: null, speedMps: null, ts: MONDAY / 1000, stopId, seq: 1, status: 'STOPPED_AT' as const,
  });
  const snap = (vehicles: RtSnapshot['vehicles']): RtSnapshot => ({ feedTs: MONDAY / 1000, fetchedTs: MONDAY / 1000, vehicles, tripUpdates: [] });
  // 同じ車両番号 "1" が両社にあっても取り違えない
  const rt = mergeSnapshots([
    { feed: 'kawasaki_city', snapshot: snap([v(cityDep.trip, '1', cityDep.platform)]) },
    { feed: 'rinko', snapshot: snap([v(rinkoDep.trip, '1', rinkoDep.platform)]) },
  ]);
  const board = buildBoard(merged, rt, MONDAY + (Math.min(cityDep.t, rinkoDep.t) - 8 * 3600 - 60) * 1000, { limit: 50 });
  const realtime = board.filter((e) => e.basis === 'realtime');
  assert.deepEqual(realtime.map((e) => e.bus!.vehicle.vehicle).sort(), ['kawasaki_city/1', 'rinko/1']);
  assert.ok(realtime.every((e) => e.bus!.waiting));
});

test('中継: まとめた鍵で両社のぶんを返す', async () => {
  const handle = createRtProxy({
    fetchSnapshot: async () => ({ feedTs: 1, fetchedTs: 1, vehicles: [], tripUpdates: [] }),
    loadStop: async (feed, id) => load(`${feed}:${id}`),
    now: () => MONDAY,
  });
  const res = await handle({ method: 'GET', path: '/stop', query: { key: 'kawasaki_city:94+rinko:10' }, headers: {} });
  const body = JSON.parse(res.body) as StopData;
  assert.equal(body.platforms.length, city.platforms.length + rinko.platforms.length);
  const bad = await handle({ method: 'GET', path: '/stop', query: { key: 'rinko:10+nope:1' }, headers: {} });
  assert.equal(bad.status, 400);
  const tooMany = await handle({ method: 'GET', path: '/stop', query: { key: 'rinko:1+rinko:2+rinko:3+rinko:4+rinko:5' }, headers: {} });
  assert.equal(tooMany.status, 400);
});

test('経路の終点の停車順が、到着の停車順と一致する（経路の使い回しで番号がずれない）', () => {
  for (const key of ['rinko:10', 'kawasaki_city:94', 'rinko:5010']) {
    const d = load(key);
    for (const a of d.arrivals) assert.equal(d.paths[a.path]!.stops.at(-1)!.seq, a.seq, `${key} ${a.trip}`);
  }
});

test('循環系統: 同じ停留所を 2 回通る便は、車両より先の到着で結ぶ', async () => {
  const { inboundBuses } = await import('../src/core/board.js');
  const d = load('rinko:20'); // さいか屋前（769 便が 2 回通る）
  const counts = new Map<string, number>();
  for (const a of d.arrivals) counts.set(a.trip, (counts.get(a.trip) ?? 0) + 1);
  const monday = sliceForDay(d, MONDAY);
  const loopTrip = [...counts].find(([trip, n]) => n >= 2 && monday.arrivals.some((a) => a.trip === trip))?.[0];
  assert.ok(loopTrip, 'さいか屋前には 2 回通る便がある');
  const [first, second] = d.arrivals.filter((a) => a.trip === loopTrip).sort((a, b) => a.seq - b.seq);
  const stop = d.paths[second!.path]!.stops.at(-2)!; // 2 回目の到着の 1 つ手前
  const ts = MONDAY / 1000;
  const snap: RtSnapshot = {
    feedTs: ts, fetchedTs: ts, tripUpdates: [],
    vehicles: [{ trip: loopTrip!, vehicle: 'L', lat: stop.lat, lng: stop.lng, bearing: null, speedMps: null, ts, stopId: stop.id, seq: stop.seq, status: 'IN_TRANSIT_TO' }],
  };
  const found = inboundBuses(d, snap, MONDAY).find((b) => b.bus.vehicle.vehicle === 'L');
  assert.ok(found, '月曜に走る便なので見つかる');
  assert.equal(found.arrival.seq, second!.seq, '1 回目ではなく 2 回目の到着');
  assert.ok(found.arrival.seq > first!.seq);
  assert.equal(found.bus.stopsAway, 1);

  // 1 回目の到着の手前にいるなら 1 回目（便ごとに最後の到着だけを持つ実装だと 2 回目を選んでしまう）
  const before = d.paths[first!.path]!.stops.at(-2)!;
  const early: RtSnapshot = { ...snap, vehicles: [{ ...snap.vehicles[0]!, lat: before.lat, lng: before.lng, stopId: before.id, seq: before.seq }] };
  const atFirst = inboundBuses(d, early, MONDAY).find((b) => b.bus.vehicle.vehicle === 'L');
  assert.equal(atFirst?.arrival.seq, first!.seq);
});
