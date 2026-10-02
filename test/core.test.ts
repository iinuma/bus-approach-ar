import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { buildApproachScene, depthOf, MODEL_LOOK_RIGHT_DEG } from '../src/core/approach.js';
import { buildBoard } from '../src/core/board.js';
import type { RtSnapshot } from '../src/core/realtime.js';
import { activeServices, clock, jstDay, upcomingDepartures } from '../src/core/service.js';
import type { StopData } from '../src/core/stopdata.js';
import { platformChoices } from '../src/core/stops.js';
import { fitText, INFO_MAX_LINES } from '../src/core/textfit.js';
import { versionText } from '../src/core/format.js';

const data = JSON.parse(readFileSync('data/stops/rinko/5010.json', 'utf8')) as StopData;
const jst = (s: string) => new Date(`${s}+09:00`).getTime();

test('運行日: 平日・土曜・日曜と、祝日の入れ替え（calendar_dates）', () => {
  assert.deepEqual([...activeServices(data, jstDay(jst('2026-09-28T12:00')))], ['O_0003_1']); // 月
  assert.deepEqual([...activeServices(data, jstDay(jst('2026-10-03T12:00')))], ['O_0003_2']); // 土
  assert.deepEqual([...activeServices(data, jstDay(jst('2026-09-27T12:00')))], ['O_0003_3']); // 日
  assert.deepEqual([...activeServices(data, jstDay(jst('2026-10-12T12:00')))], ['O_0003_3']); // スポーツの日（月）
});

test('次の発車: 時刻順で、指定の乗り場だけ', () => {
  const p1 = new Set(data.platforms.filter((p) => p.code === '1').map((p) => p.id));
  const list = upcomingDepartures(data, jst('2026-09-28T07:30'), { platforms: p1 });
  assert.equal(clock(list[0]!.atMs), '07:35');
  assert.ok(list.every((d) => p1.has(d.dep.platform)));
  assert.ok(list.every((d, i) => i === 0 || list[i - 1]!.atMs <= d.atMs));
  assert.equal(list[0]!.dep.route, '大01'); // 全角「大０１」を半角に直してある
});

test('終点で着く便は発車便に数えない', () => {
  assert.ok(data.departures.every((d) => d.headsign !== '大師橋駅前'));
});

test('乗り場の選択肢に系統と行先が出る', () => {
  const labels = platformChoices(data).map((c) => c.label);
  assert.ok(labels.some((l) => l.startsWith('1番 大01 浮島バスターミナル')));
  assert.equal(labels[0], '全乗り場');
});

const P3 = data.platforms.find((p) => p.code === '3')!.id;
const P2 = data.platforms.find((p) => p.code === '2')!.id;

function snapshotAt(nowMs: number, vehicles: RtSnapshot['vehicles']): RtSnapshot {
  return { feedTs: nowMs / 1000, fetchedTs: nowMs / 1000, vehicles, tripUpdates: [] };
}

test('発車便の車両が乗り場で待っていれば「待機」・残り 0m', () => {
  const now = jst('2026-09-27T06:55');
  const dep = upcomingDepartures(data, now, { platforms: new Set([P3]) })[0]!;
  const snap = snapshotAt(now, [
    { trip: dep.dep.trip, vehicle: '0613', lat: 35.53636, lng: 139.73958, bearing: 266, speedMps: 0, ts: now / 1000 - 60, stopId: P3, seq: 1, status: 'STOPPED_AT' },
  ]);
  const [entry] = buildBoard(data, snap, now, { platforms: new Set([P3]) });
  assert.equal(entry!.basis, 'realtime');
  assert.equal(entry!.bus!.waiting, true);
  assert.equal(entry!.bus!.remainingM, 0);
});

test('発車便の車両が次の停留所へ向かっていたら、もう出た便として外す', () => {
  const now = jst('2026-09-27T06:55');
  const dep = upcomingDepartures(data, now, { platforms: new Set([P3]) })[0]!;
  const snap = snapshotAt(now, [
    { trip: dep.dep.trip, vehicle: '0613', lat: 35.537, lng: 139.742, bearing: 60, speedMps: 8, ts: now / 1000, stopId: null, seq: 2, status: 'IN_TRANSIT_TO' },
  ]);
  const board = buildBoard(data, snap, now, { platforms: new Set([P3]) });
  assert.notEqual(board[0]!.scheduled.dep.trip, dep.dep.trip);
});

test('到着便の車両を折り返しの発車便に結びつけ、残り距離を経路に沿って出す', () => {
  const now = jst('2026-09-27T06:52');
  // 07:02 に 2 番に着く大02（実データの便）。江川一丁目の手前を走っている。
  const arrival = data.arrivals.find((a) => a.trip === '0003_3_300000671')!;
  const path = data.paths[arrival.path]!;
  const next = path.stops[path.stops.length - 2]!; // 江川一丁目
  const snap = snapshotAt(now, [
    { trip: arrival.trip, vehicle: '0508', lat: 35.53703, lng: 139.74734, bearing: 264, speedMps: 5, ts: now / 1000, stopId: next.id, seq: next.seq, status: 'IN_TRANSIT_TO' },
  ]);
  const [entry] = buildBoard(data, snap, now, { platforms: new Set([P2]) });
  assert.equal(entry!.basis, 'inbound');
  assert.equal(entry!.bus!.vehicle.vehicle, '0508');
  assert.equal(entry!.bus!.stopsAway, 1);
  // 直線距離より経路に沿った残り距離の方が長い
  assert.ok(entry!.bus!.remainingM >= entry!.bus!.straightM);
  assert.ok(entry!.bus!.remainingM > 300 && entry!.bus!.remainingM < 1500, `${entry!.bus!.remainingM}`);
});

test('道路モデル: 近いほど手前（左下）、消失点は右 60° で画面中央', () => {
  assert.ok(depthOf(50) > depthOf(500));
  assert.equal(depthOf(10), 1);
  assert.equal(depthOf(99_999), 0);

  const now = jst('2026-09-27T06:52');
  const arrival = data.arrivals.find((a) => a.trip === '0003_3_300000671')!;
  const path = data.paths[arrival.path]!;
  const next = path.stops[path.stops.length - 2]!;
  const snap = snapshotAt(now, [
    { trip: arrival.trip, vehicle: '0508', lat: 35.53703, lng: 139.74734, bearing: 264, speedMps: 5, ts: now / 1000, stopId: next.id, seq: next.seq, status: 'IN_TRANSIT_TO' },
  ]);
  const entries = buildBoard(data, snap, now, { platforms: new Set([P2]) });
  const scene = buildApproachScene({
    entries,
    focusIndex: 0,
    view: { lookRightDeg: MODEL_LOOK_RIGHT_DEG, hfovDeg: 30 },
    labelLines: (e) => [e.scheduled.dep.route],
    measure: (t) => t.length * 14,
  });
  assert.equal(scene.vanishing.x, 288);
  assert.equal(scene.offscreen, null);
  const bus = scene.buses[0]!;
  assert.ok(bus.x < 288 && bus.y > scene.vanishing.y, 'バスは消失点より左下');
  assert.ok(bus.label, 'ラベルが置ける');

  // 右へ 30° 回すと、道路（消失点）は画面の左端より外へ出る
  const turned = buildApproachScene({ entries, focusIndex: 0, view: { lookRightDeg: 80, hfovDeg: 30 }, labelLines: () => ['x'], measure: () => 10 });
  assert.equal(turned.offscreen?.side, 'left');
});

test('文字欄は 3 行まで', () => {
  assert.equal(INFO_MAX_LINES, 3);
  assert.equal(fitText('1\n2\n3\n4').split('\n').length, 3);
});

test('時刻表の版: 1 社はそのまま、まとめたバス停は両社の月日', () => {
  assert.equal(versionText('20260716_20261231'), '20260716');
  assert.equal(versionText('20260701/20260716'), '7/1・7/16');
});

test('「データについて」の必須表示（問い合わせ先）が切れない', async () => {
  const { visualWidth, MAX_COLUMNS } = await import('../src/core/textfit.js');
  const lines = ['データについて（タップで戻る）', '公共交通オープンデータセンター提供', data.source.agency,
    `時刻表 ${versionText('20260701/20260716')}版 取得${data.source.fetchedDate}`,
    'データの正確性・完全性は保証されません', '道路は右60°に置いた模式図です', '問い合わせ:', 'async.sync+kawasakibus@gmail.com'];
  assert.ok(lines.length <= 8);
  for (const line of lines) assert.ok(visualWidth(line) <= MAX_COLUMNS, line);
});
