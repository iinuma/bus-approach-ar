// Swift 版のテスト用に、TypeScript 版（../src/core）で入力と正解を作る。
// 出力: ios/BusApproachARTests/Fixtures/*.json（時刻表を含むので git に入れない）
//
// 場面:
//   kawasaki  川崎駅（市バス＋臨港をまとめたもの）。今の実データの RT を 1 回取って固定する
//   daishibashi 大師橋駅前。月曜 07:30、RT なし（時刻表だけ）
// あわせて、日付の判定と距離・方位の計算の正解も出す。
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';

import { buildBoard, type BoardEntry } from '../../src/core/board.js';
import { LocalSphere } from '../../src/core/geodesy.js';
import { mergeSnapshots, mergeStops } from '../../src/core/merge.js';
import type { RtSnapshot } from '../../src/core/realtime.js';
import { activeServices, jstDay, sliceForDay } from '../../src/core/service.js';
import type { StopData } from '../../src/core/stopdata.js';
import { platformChoices } from '../../src/core/stops.js';
import { fetchSnapshot, type FeedName } from '../../proxy/src/odpt-rt.js';

const OUT = 'ios/BusApproachARTests/Fixtures';
mkdirSync(OUT, { recursive: true });
const load = (feed: string, id: string) => JSON.parse(readFileSync(`data/stops/${feed}/${id}.json`, 'utf8')) as StopData;
const token = readFileSync('.env', 'utf8').match(/^ODPT_TOKEN=(.*)$/m)?.[1]?.trim();

function expected(entries: BoardEntry[]) {
  return entries.map((e) => ({
    trip: e.scheduled.dep.trip,
    scheduledMs: e.scheduled.atMs,
    expectedMs: e.expectedMs,
    basis: e.basis,
    vehicle: e.bus?.vehicle.vehicle ?? null,
    remainingM: e.bus?.remainingM ?? null,
    stopsAway: e.bus?.stopsAway ?? null,
    azimuthDeg: e.bus?.azimuthDeg ?? null,
    waiting: e.bus?.waiting ?? null,
  }));
}

function write(name: string, stop: StopData, snapshot: RtSnapshot | null, nowMs: number, platforms?: Set<string>) {
  const board = buildBoard(stop, snapshot, nowMs, { platforms, limit: 20 });
  writeFileSync(
    `${OUT}/${name}.json`,
    JSON.stringify({
      nowMs,
      platforms: platforms ? [...platforms] : null,
      stop,
      snapshot,
      expected: expected(board),
      choices: platformChoices(stop).map((c) => ({ id: c.id, label: c.label, platforms: [...c.platforms].sort() })),
    }),
  );
  const kinds = board.reduce<Record<string, number>>((n, e) => ({ ...n, [e.basis]: (n[e.basis] ?? 0) + 1 }), {});
  console.log(`${name}: ${board.length} 便 ${JSON.stringify(kinds)}`);
}

// 川崎駅（まとめたもの）: 実データの RT を固定して使う
{
  const nowMs = Date.now();
  const members: [FeedName, string][] = [['kawasaki_city', '94'], ['rinko', '10']];
  const parts = members.map(([f, id]) => sliceForDay(load(f, id), nowMs));
  const stop = mergeStops(parts);
  let snapshot: RtSnapshot | null = null;
  if (token) {
    snapshot = mergeSnapshots(await Promise.all(members.map(async ([feed]) => ({ feed, snapshot: await fetchSnapshot(feed, token) }))));
    // その停留所の便だけに絞る（中継と同じ）
    const trips = new Set([...stop.departures.map((d) => d.trip), ...stop.arrivals.map((a) => a.trip)]);
    snapshot = { ...snapshot, vehicles: snapshot.vehicles.filter((v) => trips.has(v.trip)), tripUpdates: snapshot.tripUpdates.filter((u) => trips.has(u.trip)) };
  }
  // RT の時刻に合わせる（テストの時刻を固定する）
  write('kawasaki', stop, snapshot, snapshot ? snapshot.feedTs * 1000 : nowMs);
}

// 大師橋駅前: 月曜 07:30、RT なし、乗り場 1 だけ
{
  const nowMs = new Date('2026-09-28T07:30+09:00').getTime();
  const stop = sliceForDay(load('rinko', '5010'), nowMs);
  write('daishibashi', stop, null, nowMs, new Set(stop.platforms.filter((p) => p.code === '1').map((p) => p.id)));
}

// 日付と運行日
{
  const data = load('rinko', '5010');
  const times = ['2026-09-27T23:59:59+09:00', '2026-09-28T00:00:00+09:00', '2026-10-12T12:00:00+09:00', '2026-12-31T08:00:00+09:00', '2027-01-01T00:30:00+09:00'];
  const days = times.map((t) => {
    const ms = new Date(t).getTime();
    const day = jstDay(ms);
    return { ms, ymd: day.ymd, weekday: day.weekday, midnightMs: day.midnightMs, services: [...activeServices(data, day)].sort() };
  });
  writeFileSync(`${OUT}/days.json`, JSON.stringify({ services: data.services, days }));
}

// 距離と方位
{
  const pairs = [
    [35.5363, 139.74, 35.53703, 139.74734],
    [35.5305, 139.6985, 35.6, 139.5],
    [35.53, 139.7, 35.53, 139.7],
    [35.5, 139.7, 35.4, 139.9],
  ].map(([a, b, c, d]) => {
    const r = new LocalSphere({ lat: a!, lng: b! }).inverse({ lat: c!, lng: d! });
    return { from: [a, b], to: [c, d], distanceM: r.distanceM, azimuthDeg: r.azimuthDeg };
  });
  writeFileSync(`${OUT}/geo.json`, JSON.stringify(pairs));
}
