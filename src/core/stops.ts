/**
 * 停留所と乗り場の選択肢。
 *
 * 大師橋駅前の乗り場 1・2・3・5 は座標がほぼ同じ点（差 10m 以内）なので、
 * 座標では選ばせず、乗り場番号と「系統・行先」で選ばせる。
 */

import { LocalSphere, type LatLng } from './geodesy.js';
import type { StopData } from './stopdata.js';

export interface PlatformChoice {
  id: string;
  /** 「1番 大01 浮島バスターミナル」 */
  label: string;
  platforms: Set<string>;
}

export function platformChoices(data: StopData): PlatformChoice[] {
  const choices: PlatformChoice[] = data.platforms.map((p) => {
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
    return { id: p.id, label: `${p.code}番 ${parts.join(' / ') || '発車なし'}`, platforms: new Set([p.id]) };
  });
  choices.push({ id: 'all', label: '全乗り場', platforms: new Set(data.platforms.map((p) => p.id)) });
  return choices;
}

export interface NearbyStop {
  data: StopData;
  distanceM: number;
}

/** 近い順。現在地が無ければ入っている順。 */
export function nearbyStops(stops: StopData[], location: LatLng | null): NearbyStop[] {
  if (!location) return stops.map((data) => ({ data, distanceM: Number.NaN }));
  const here = new LocalSphere(location);
  return stops
    .map((data) => ({ data, distanceM: here.inverse(data.stop).distanceM }))
    .sort((a, b) => a.distanceM - b.distanceM);
}
