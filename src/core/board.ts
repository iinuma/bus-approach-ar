/**
 * 発車案内（時刻表 + リアルタイム）。
 *
 * 大師橋駅前は始発・終点の停留所で、発車便の車両は「その前にここへ着く便」の車両。
 * 発車便そのものが RT に出るのは、車両が前の便を終えてから（実測: 乗り場で待機中に
 * STOPPED_AT・停車順 1 で現れる）。それより前は、同じ乗り場・同じ系統へ向かっている
 * 到着便の車両を「たぶんこの車両が折り返す」と推定して結びつける。推定は推定と表示する。
 *
 * 時刻の根拠を区別する（Notion の構想メモ「予定・見込み・車両位置から計算した参考値」）:
 *   schedule  時刻表の予定だけ
 *   realtime  発車便そのものが RT に出ている（車両が乗り場にいる／向かっている）
 *   inbound   折り返してくるはずの到着便の位置から推定
 */

import { LocalSphere, type LatLng } from './geodesy.js';
import { indexSnapshot, type RtSnapshot, type RtVehicle } from './realtime.js';
import { activeServices, jstDay, upcomingDepartures, type ScheduledDeparture } from './service.js';
import type { ApproachPath, Arrival, StopData } from './stopdata.js';

export type Basis = 'schedule' | 'realtime' | 'inbound';

export interface BusPosition {
  vehicle: RtVehicle;
  /** 乗り場までの、経路に沿った残り距離（m）。乗り場にいれば 0。 */
  remainingM: number;
  /** 乗り場までに停まる停留所の数（乗り場を含まない）。 */
  stopsAway: number;
  /** 乗り場から見た車両の方位・直線距離。 */
  azimuthDeg: number;
  straightM: number;
  /** 乗り場で停まって待っている。 */
  waiting: boolean;
  /** 到着便の車両（inbound）のとき、その便の到着見込み。 */
  inboundArrivalMs: number | null;
}

export interface BoardEntry {
  scheduled: ScheduledDeparture;
  /** 発車見込み。根拠が schedule なら予定と同じ。 */
  expectedMs: number;
  basis: Basis;
  bus: BusPosition | null;
}

/**
 * これより古い車両位置は使わない。川崎市バスのフィードには 8 時間前の位置が混ざっていた
 * （2026-09-27 実測。通常は 30〜130 秒前）。
 */
export const STALE_VEHICLE_S = 300;

/** 折り返しに最低限かかる時間。到着見込みにこれを足したものより早くは出ない、とみなす。 */
const MIN_LAYOVER_MS = 60_000;

export function buildBoard(
  data: StopData,
  snapshot: RtSnapshot | null,
  nowMs: number,
  options: { platforms?: Set<string>; limit?: number } = {},
): BoardEntry[] {
  const limit = options.limit ?? 6;
  const scheduled = upcomingDepartures(data, nowMs, { platforms: options.platforms, graceMs: 5 * 60_000 });
  const fresh = snapshot ? withoutStale(snapshot, nowMs) : null;
  const rt = fresh ? indexSnapshot(fresh) : null;
  const inbound = fresh ? inboundBuses(data, fresh, nowMs) : [];
  const usedVehicles = new Set<string>();
  const out: BoardEntry[] = [];

  for (const s of scheduled) {
    const vehicle = rt?.vehicleByTrip.get(s.dep.trip) ?? null;
    const update = rt?.updateByTrip.get(s.dep.trip) ?? null;
    if (vehicle) {
      // 発車便の車両が乗り場より先の停留所へ向かっていたら、もう出た。
      if (vehicle.seq !== null && vehicle.seq > s.dep.seq) continue;
      usedVehicles.add(vehicle.vehicle);
      const here = update?.stops.find((st) => st.stopId === s.dep.platform);
      const expectedMs = here?.t ? here.t * 1000 : s.atMs;
      out.push({ scheduled: s, expectedMs: Math.max(expectedMs, s.atMs), basis: 'realtime', bus: positionAtPlatform(data, s.dep.platform, vehicle) });
    } else {
      if (s.atMs < nowMs) continue; // 予定を過ぎて RT にも無い便は出たものとみなす
      // 同じ乗り場に着く車両を優先し、無ければ同じ停留所の別の乗り場（降車場）に着く同じ系統の車両。
      // 川崎市バスの川崎駅は降車場（94_2）と乗り場が分かれている（2026-09-27 データで確認）。
      const free = inbound.filter((b) => !usedVehicles.has(b.bus.vehicle.vehicle) && b.arrival.route === s.dep.route);
      const candidate = free.find((b) => b.arrival.platform === s.dep.platform) ?? free[0];
      if (candidate && candidate.arrivalMs <= s.atMs + 30 * 60_000) {
        usedVehicles.add(candidate.bus.vehicle.vehicle);
        out.push({ scheduled: s, expectedMs: Math.max(s.atMs, candidate.arrivalMs + MIN_LAYOVER_MS), basis: 'inbound', bus: candidate.bus });
      } else {
        out.push({ scheduled: s, expectedMs: s.atMs, basis: 'schedule', bus: null });
      }
    }
    if (out.length >= limit) break;
  }
  return out;
}

/** 古い車両位置を捨てる。 */
export function withoutStale(snapshot: RtSnapshot, nowMs: number): RtSnapshot {
  const limit = nowMs / 1000 - STALE_VEHICLE_S;
  return { ...snapshot, vehicles: snapshot.vehicles.filter((v) => v.ts >= limit) };
}

interface InboundBus {
  arrival: Arrival;
  arrivalMs: number;
  bus: BusPosition;
}

/** この停留所へ向かっている到着便の車両。到着見込みの早い順。 */
export function inboundBuses(data: StopData, snapshot: RtSnapshot, nowMs: number): InboundBus[] {
  const { updateByTrip } = indexSnapshot(snapshot);
  const today = jstDay(nowMs);
  const yesterday = jstDay(today.midnightMs - 86_400_000);
  const services = [
    { day: today, ids: activeServices(data, today) },
    { day: yesterday, ids: activeServices(data, yesterday) },
  ];
  const arrivalsByTrip = new Map(data.arrivals.map((a) => [a.trip, a]));
  const out: InboundBus[] = [];
  for (const vehicle of snapshot.vehicles) {
    const arrival = arrivalsByTrip.get(vehicle.trip);
    if (!arrival) continue;
    const day = services.find((s) => s.ids.has(arrival.service))?.day;
    if (!day) continue;
    if (vehicle.seq !== null && vehicle.seq > arrival.seq) continue; // もう通り過ぎた
    const bus = positionOnPath(data.paths[arrival.path]!, arrival, vehicle);
    const here = updateByTrip.get(vehicle.trip)?.stops.find((st) => st.stopId === arrival.platform);
    const scheduledMs = day.midnightMs + arrival.t * 1000;
    // 終点の到着予測は遅れが 0 に戻っていることが多いので、途中の遅れを足した値と大きい方をとる。
    const lastDelay = updateByTrip.get(vehicle.trip)?.stops.find((st) => st.delay !== null)?.delay ?? 0;
    const arrivalMs = Math.max(here?.t ? here.t * 1000 : scheduledMs, scheduledMs + lastDelay * 1000);
    bus.inboundArrivalMs = arrivalMs;
    out.push({ arrival, arrivalMs, bus });
  }
  return out.sort((a, b) => a.arrivalMs - b.arrivalMs);
}

function platformOf(data: StopData, platformId: string): LatLng {
  const p = data.platforms.find((x) => x.id === platformId);
  return p ? { lat: p.lat, lng: p.lng } : data.stop;
}

/** 発車便の車両。乗り場にいれば 0m、まだ来ていなければ直線距離で代用する。 */
function positionAtPlatform(data: StopData, platformId: string, vehicle: RtVehicle): BusPosition {
  const { distanceM, azimuthDeg } = new LocalSphere(platformOf(data, platformId)).inverse(vehicle);
  const waiting = vehicle.stopId === platformId && vehicle.status === 'STOPPED_AT';
  return { vehicle, remainingM: waiting ? 0 : distanceM, stopsAway: 0, azimuthDeg, straightM: distanceM, waiting, inboundArrivalMs: null };
}

/**
 * 到着便の車両を、手前の停留所を結んだ折れ線に載せて残り距離を出す。
 * 車両が向かっている停留所（seq）までは直線、そこから先は折れ線の長さを足す。
 */
export function positionOnPath(path: ApproachPath, arrival: Arrival, vehicle: RtVehicle): BusPosition {
  const end = path.stops[path.stops.length - 1]!;
  const { distanceM: straightM, azimuthDeg } = new LocalSphere(end).inverse(vehicle);
  const nextIndex = vehicle.seq === null ? -1 : path.stops.findIndex((s) => s.seq === vehicle.seq);
  let remainingM: number;
  let stopsAway: number;
  if (nextIndex >= 0) {
    const next = path.stops[nextIndex]!;
    remainingM = new LocalSphere(next).inverse(vehicle).distanceM;
    for (let i = nextIndex; i < path.stops.length - 1; i += 1) {
      remainingM += new LocalSphere(path.stops[i]!).inverse(path.stops[i + 1]!).distanceM;
    }
    stopsAway = path.stops.length - 1 - nextIndex;
  } else {
    // 折れ線より手前にいる。先頭までの直線 + 折れ線全体で近似する。
    const first = path.stops[0]!;
    remainingM = new LocalSphere(first).inverse(vehicle).distanceM;
    for (let i = 0; i < path.stops.length - 1; i += 1) {
      remainingM += new LocalSphere(path.stops[i]!).inverse(path.stops[i + 1]!).distanceM;
    }
    stopsAway = arrival.seq - (vehicle.seq ?? arrival.seq);
  }
  const waiting = vehicle.stopId === arrival.platform && vehicle.status === 'STOPPED_AT';
  return { vehicle, remainingM: waiting ? 0 : remainingM, stopsAway: Math.max(0, stopsAway), azimuthDeg, straightM, waiting, inboundArrivalMs: null };
}
