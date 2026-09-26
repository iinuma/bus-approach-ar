/**
 * 複数の事業者の停留所を 1 つのバス停としてまとめる。
 *
 * 川崎駅東口は臨港バス「川崎駅前」と川崎市バス「川崎駅」で名前が違う（同じバスターミナル）。
 * 利用者にとっては 1 つのバス停なので、両社の便を 1 つの発車案内に混ぜる。
 *
 * 便・運行・乗り場・車両の ID は事業者ごとの採番なので、社をまたぐと重なりうる。
 * まとめるときは `<feed>/` を前に付けて名前空間を分ける（1 社だけのときは付けない。
 * 0.1.0 のベータや既存のテストがそのまま通るように）。
 */

import type { RtSnapshot } from './realtime.js';
import type { StopData } from './stopdata.js';

/** 事業者の短い名前（乗り場の表示に添える）。 */
export const OPERATOR_SHORT: Record<string, string> = {
  kawasaki_city: '市バス',
  rinko: '臨港',
};

export const operatorOf = (feed: string): string => OPERATOR_SHORT[feed] ?? feed;

/** 統合した停留所の鍵（`kawasaki_city:94+rinko:10`）をメンバーに分ける。 */
export function splitGroupKey(key: string): string[] {
  return key.split('+').filter(Boolean);
}

const ns = (feed: string, id: string) => `${feed}/${id}`;

export function mergeStops(parts: StopData[], name?: string): StopData {
  if (parts.length === 1) return parts[0]!;
  const first = parts[0]!;
  const merged: StopData = {
    feed: parts.map((p) => p.feed).join('+'),
    source: {
      agency: parts.map((p) => p.source.agency).join('・'),
      feedVersion: parts.map((p) => p.source.feedVersion.slice(0, 8)).join('/'),
      fetchedDate: parts.map((p) => p.source.fetchedDate).sort()[0]!,
    },
    stop: { ...first.stop, id: parts.map((p) => `${p.feed}:${p.stop.id}`).join('+'), name: name ?? first.stop.name },
    platforms: [],
    services: {},
    departures: [],
    arrivals: [],
    paths: [],
  };
  for (const part of parts) {
    const f = part.feed;
    merged.platforms.push(...part.platforms.map((p) => ({ ...p, id: ns(f, p.id), operator: operatorOf(f) })));
    for (const [id, rule] of Object.entries(part.services)) merged.services[ns(f, id)] = rule;
    const offset = merged.paths.length;
    merged.paths.push(...part.paths.map((path) => ({ stops: path.stops.map((s) => ({ ...s, id: ns(f, s.id) })) })));
    merged.departures.push(...part.departures.map((d) => ({ ...d, trip: ns(f, d.trip), platform: ns(f, d.platform), service: ns(f, d.service) })));
    merged.arrivals.push(
      ...part.arrivals.map((a) => ({ ...a, trip: ns(f, a.trip), platform: ns(f, a.platform), service: ns(f, a.service), path: a.path + offset })),
    );
  }
  merged.departures.sort((a, b) => a.t - b.t);
  merged.arrivals.sort((a, b) => a.t - b.t);
  return merged;
}

/** 各社のリアルタイムを 1 つにする。ID には mergeStops と同じ名前空間を付ける。 */
export function mergeSnapshots(parts: { feed: string; snapshot: RtSnapshot }[]): RtSnapshot {
  if (parts.length === 1) return parts[0]!.snapshot;
  const nsOrNull = (feed: string, id: string | null) => (id === null ? null : ns(feed, id));
  return {
    // いちばん古いフィードの時刻を出す（「更新○秒前」を楽観的に見せない）。
    feedTs: Math.min(...parts.map((p) => p.snapshot.feedTs)),
    fetchedTs: Math.min(...parts.map((p) => p.snapshot.fetchedTs)),
    vehicles: parts.flatMap(({ feed, snapshot }) =>
      snapshot.vehicles.map((v) => ({ ...v, trip: ns(feed, v.trip), vehicle: ns(feed, v.vehicle), stopId: nsOrNull(feed, v.stopId) })),
    ),
    tripUpdates: parts.flatMap(({ feed, snapshot }) =>
      snapshot.tripUpdates.map((u) => ({
        ...u,
        trip: ns(feed, u.trip),
        vehicle: nsOrNull(feed, u.vehicle),
        stops: u.stops.map((s) => ({ ...s, stopId: ns(feed, s.stopId) })),
      })),
    ),
  };
}
