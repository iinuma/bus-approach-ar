/**
 * GTFS-Realtime を、アプリで使う分だけの JSON にした形。
 *
 * protobuf の復号は中継（proxy/src/odpt-rt.ts）でやる。アプリに protobuf を持ち込まないのと、
 * ODPT のアクセストークンを .ehpk に入れないため（Tokyojihatsu と同じ理由）。
 *
 * 実測（2026-09-27, 臨港バス）:
 *   - vehicle / trip_update / alert の 3 つの URL は同じ統合フィードを返す（車両 75 + 便 75）。
 *   - 車両位置は取得時点で 20〜130 秒前のもの。中央値 50 秒前後。
 *   - 始発の便は発車前から現れる。車両が乗り場で待っている間は STOPPED_AT・停車順 1。
 *   - 終点（大師橋駅前）での到着予測は遅れが 0 に戻っていることが多い。当てにしない。
 */

export type VehicleStatus = 'INCOMING_AT' | 'STOPPED_AT' | 'IN_TRANSIT_TO';

export interface RtVehicle {
  trip: string;
  vehicle: string;
  lat: number;
  lng: number;
  bearing: number | null;
  speedMps: number | null;
  /** 位置の時刻（epoch 秒）。 */
  ts: number;
  stopId: string | null;
  /** 向かっている（または停まっている）停留所の停車順。 */
  seq: number | null;
  status: VehicleStatus | null;
}

export interface RtStopTime {
  stopId: string;
  seq: number;
  /** 到着（無ければ発車）の見込み時刻（epoch 秒）。 */
  t: number;
  delay: number | null;
}

export interface RtTripUpdate {
  trip: string;
  vehicle: string | null;
  ts: number;
  stops: RtStopTime[];
}

export interface RtSnapshot {
  /** フィードのヘッダーの時刻（epoch 秒）。 */
  feedTs: number;
  /** 中継が取得した時刻（epoch 秒）。 */
  fetchedTs: number;
  vehicles: RtVehicle[];
  tripUpdates: RtTripUpdate[];
}

/** 便 ID で引けるようにする。 */
export function indexSnapshot(snapshot: RtSnapshot) {
  return {
    vehicleByTrip: new Map(snapshot.vehicles.map((v) => [v.trip, v])),
    updateByTrip: new Map(snapshot.tripUpdates.map((u) => [u.trip, u])),
  };
}
