// 発車案内を実データで確かめる CLI。
// 使い方: npx tsx scripts/board-cli.ts [--stop rinko:5010] [--platform 1] [--at 2026-09-28T07:00] [--offline]
// 先に npm run build:all で data/stops/ を作っておく。
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';
import { buildBoard } from '../src/core/board.js';
import { formatMeters } from '../src/core/format.js';
import { clock } from '../src/core/service.js';
import type { StopData } from '../src/core/stopdata.js';
import { fetchSnapshot, type FeedName } from '../proxy/src/odpt-rt.js';

const { values } = parseArgs({
  options: {
    stop: { type: 'string', default: 'rinko:5010' },
    platform: { type: 'string' },
    at: { type: 'string' },
    offline: { type: 'boolean', default: false },
  },
});

const [feedName, stopId] = values.stop.split(':') as [FeedName, string];
const data = JSON.parse(readFileSync(`data/stops/${feedName}/${stopId}.json`, 'utf8')) as StopData;
const nowMs = values.at ? new Date(`${values.at}+09:00`).getTime() : Date.now();
const token = readFileSync('.env', 'utf8').match(/^ODPT_TOKEN=(.*)$/m)?.[1]?.trim();
const snapshot = values.offline || values.at || !token ? null : await fetchSnapshot(feedName, token);
const platforms = values.platform ? new Set(data.platforms.filter((p) => p.code === values.platform).map((p) => p.id)) : undefined;

const nowS = nowMs / 1000;
console.log(`${data.stop.name}  ${clock(nowMs)}  ${snapshot ? `RT ${Math.round(nowS - snapshot.feedTs)}秒前 車両${snapshot.vehicles.length}` : 'RTなし（時刻表のみ）'}`);
const codeOf = new Map(data.platforms.map((p) => [p.id, p.code]));
for (const e of buildBoard(data, snapshot, nowMs, { platforms, limit: 10 })) {
  const d = e.scheduled.dep;
  const min = Math.max(0, Math.round((e.expectedMs - nowMs) / 60_000));
  const late = Math.round((e.expectedMs - e.scheduled.atMs) / 60_000);
  const bus = e.bus
    ? e.bus.waiting
      ? `${e.basis === 'inbound' ? '到着済み 折返し推定' : '乗り場で待機'} 車両${e.bus.vehicle.vehicle}`
      : `${e.basis === 'inbound' ? '折返し推定 ' : ''}車両${e.bus.vehicle.vehicle} 残${formatMeters(e.bus.remainingM)} ${e.bus.stopsAway}停前 ` +
        `方位${Math.round(e.bus.azimuthDeg)}° 位置${Math.round(nowS - e.bus.vehicle.ts)}秒前`
    : '';
  console.log(
    `${codeOf.get(d.platform)}番 ${clock(e.scheduled.atMs)} ${d.route.padEnd(5)} ${d.headsign.padEnd(14, '　')} あと${String(min).padStart(2)}分` +
      `${late > 0 ? ` (+${late})` : ''} [${e.basis}] ${bus}`,
  );
}
