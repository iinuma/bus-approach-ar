/**
 * ODPT の GTFS-Realtime を取ってきて RtSnapshot（JSON）にする。
 * dev サーバー（app/vite.config.ts）と CLI から使う。公開時は Lambda に載せる。
 */

import GtfsRealtimeBindings from 'gtfs-realtime-bindings';
import type { RtSnapshot, RtVehicle, VehicleStatus } from '../../src/core/realtime.js';

const { transit_realtime } = GtfsRealtimeBindings;

export const FEEDS = {
  rinko: 'odpt_KawasakiTsurumiRinkoBus_allrinko',
  kawasaki_city: 'odpt_TransportationBureau_CityOfKawasaki_AllLines',
} as const;
export type FeedName = keyof typeof FEEDS;

const STATUS: Record<number, VehicleStatus> = { 0: 'INCOMING_AT', 1: 'STOPPED_AT', 2: 'IN_TRANSIT_TO' };

export function decodeSnapshot(buf: Uint8Array, fetchedTs = Math.floor(Date.now() / 1000)): RtSnapshot {
  const feed = transit_realtime.FeedMessage.decode(buf);
  const vehicles: RtVehicle[] = [];
  const tripUpdates: RtSnapshot['tripUpdates'] = [];
  for (const e of feed.entity) {
    const v = e.vehicle;
    if (v?.trip?.tripId && v.position) {
      vehicles.push({
        trip: v.trip.tripId,
        vehicle: v.vehicle?.id ?? e.id,
        lat: v.position.latitude,
        lng: v.position.longitude,
        bearing: v.position.bearing ?? null,
        speedMps: v.position.speed ?? null,
        ts: Number(v.timestamp ?? feed.header.timestamp),
        stopId: v.stopId ?? null,
        seq: v.currentStopSequence ?? null,
        status: v.currentStatus != null ? (STATUS[v.currentStatus] ?? null) : null,
      });
    }
    const u = e.tripUpdate;
    if (u?.trip?.tripId) {
      tripUpdates.push({
        trip: u.trip.tripId,
        vehicle: u.vehicle?.id ?? null,
        ts: Number(u.timestamp ?? feed.header.timestamp),
        stops: (u.stopTimeUpdate ?? []).map((s) => ({
          stopId: s.stopId ?? '',
          seq: s.stopSequence ?? 0,
          t: Number(s.arrival?.time ?? s.departure?.time ?? 0),
          delay: s.arrival?.delay ?? s.departure?.delay ?? null,
        })),
      });
    }
  }
  return { feedTs: Number(feed.header.timestamp), fetchedTs, vehicles, tripUpdates };
}

/**
 * 3 つの URL は同じ統合フィードを返す（2026-09-27 実測）ので trip_update だけ取る。
 * 分かれて返すようになったら、ここで vehicle も取ってまとめる。
 */
export async function fetchSnapshot(feed: FeedName, token: string): Promise<RtSnapshot> {
  const url = `https://api.odpt.org/api/v4/gtfs/realtime/${FEEDS[feed]}_trip_update?acl:consumerKey=${token}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`ODPT HTTP ${res.status}`);
  return decodeSnapshot(new Uint8Array(await res.arrayBuffer()));
}
