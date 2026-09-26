/**
 * 1 停留所ぶんの静的データ（scripts/build-stop.ts が GTFS-JP から生成する）。
 *
 * アプリに GTFS 全体（stop_times だけで 12MB）は持ち込めないので、選んだ停留所に
 * 関係する便だけを切り出す。時刻は運行日の 0 時からの秒（24 時超えあり）。
 */

export interface StopData {
  /** GTFS-RT のフィード名（proxy/src/odpt-rt.ts の FEEDS のキー）。 */
  feed: string;
  source: { agency: string; feedVersion: string; fetchedDate: string };
  stop: { id: string; name: string; lat: number; lng: number };
  platforms: Platform[];
  services: Record<string, ServiceRule>;
  /** この停留所を出る便。時刻順。 */
  departures: Departure[];
  /** この停留所に着く便（終点で着く便・途中で通る便の両方）。時刻順。 */
  arrivals: Arrival[];
  /** 到着便が通ってくる停留所の並び。arrivals[].path の添字で引く。 */
  paths: ApproachPath[];
}

export interface Platform {
  id: string;
  /** 乗り場番号（GTFS の platform_code）。 */
  code: string;
  lat: number;
  lng: number;
}

export interface ServiceRule {
  /** 月〜日の 7 要素。 */
  days: boolean[];
  start: string;
  end: string;
  added: string[];
  removed: string[];
}

export interface Departure {
  t: number;
  trip: string;
  route: string;
  headsign: string;
  platform: string;
  service: string;
  /** この停留所での停車順（stop_sequence）。始発なら 1。 */
  seq: number;
}

export interface Arrival {
  t: number;
  trip: string;
  route: string;
  platform: string;
  service: string;
  /** この停留所での停車順（stop_sequence）。 */
  seq: number;
  path: number;
}

/**
 * 到着までに通る停留所。最後がこの停留所の乗り場。
 * shapes.txt が無い（臨港バスはヘッダーだけ）ので、道路形状は停留所を結んだ折れ線で近似する。
 */
export interface ApproachPath {
  stops: { id: string; name: string; lat: number; lng: number; seq: number }[];
}
