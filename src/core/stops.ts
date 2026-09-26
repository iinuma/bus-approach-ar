/**
 * 停留所と乗り場の選択肢。
 *
 * 大師橋駅前の乗り場 1・2・3・5 は座標がほぼ同じ点（差 10m 以内）なので、
 * 座標では選ばせず、乗り場番号と「系統・行先」で選ばせる。
 */

import { LocalSphere, type LatLng } from './geodesy.js';
import type { StopData } from './stopdata.js';
import type { StopIndexEntry } from './stopindex.js';

export interface PlatformChoice {
  id: string;
  /** 「1番 大01 浮島バスターミナル」 */
  label: string;
  platforms: Set<string>;
}

export function platformChoices(data: StopData): PlatformChoice[] {
  // 発車の無い標柱（降車専用）は、乗る人が選ぶ意味がないので出さない。
  const boarding = data.platforms.filter((p) => data.departures.some((d) => d.platform === p.id));
  const choices: PlatformChoice[] = boarding.map((p) => {
    // 系統ごとに最頻の行先を出す（同じ系統で行先が 1 つとは限らない）。
    const byRoute = new Map<string, Map<string, number>>();
    for (const d of data.departures) {
      if (d.platform !== p.id) continue;
      const counts = byRoute.get(d.route) ?? new Map<string, number>();
      counts.set(d.headsign, (counts.get(d.headsign) ?? 0) + 1);
      byRoute.set(d.route, counts);
    }
    const parts = [...byRoute].map(([route, counts]) => {
      const headsign = [...counts].sort((a, b) => b[1] - a[1])[0]![0];
      return `${route} ${headsign}`;
    });
    // 川崎市バスは platform_code が空（乗り場番号がデータに無い）。そのときは系統・行先だけで示す。
    const prefix = p.code ? `${p.code}番 ` : '';
    return { id: p.id, label: `${prefix}${parts.join(' / ')}`, platforms: new Set([p.id]) };
  });
  if (choices.length > 1) choices.push({ id: 'all', label: '全乗り場', platforms: new Set(boarding.map((p) => p.id)) });
  return choices;
}

export interface NearbyStop {
  entry: StopIndexEntry;
  distanceM: number;
}

/** 近い順に limit 件。 */
export function nearbyStops(stops: StopIndexEntry[], location: LatLng, limit = 20): NearbyStop[] {
  const here = new LocalSphere(location);
  return stops
    .map((entry) => ({ entry, distanceM: here.inverse(entry).distanceM }))
    .sort((a, b) => a.distanceM - b.distanceM)
    .slice(0, limit);
}
