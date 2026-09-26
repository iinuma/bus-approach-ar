/**
 * GTFS-JP を読んで、停留所（親停留所）ごとの StopData を作る。
 *
 * 1 停留所ずつ stop_times 全体を読み直すと、川崎市バス（95 万行）× 477 停留所で終わらないので、
 * フィードを 1 回だけ読み、便ごと・標柱ごとの索引を作ってから切り出す。
 */

import { readFileSync, statSync } from 'node:fs';
import type { ApproachPath, Arrival, Departure, StopData } from '../../src/core/stopdata.js';

/** 到着便について保持する、手前の停留所の数。車両をこの折れ線に載せて残り距離を出す。 */
const PATH_STOPS = 12;

type Row = Record<string, string>;

/** 引用符付きのフィールドにも対応する最小の CSV 読み。 */
export function readCsv(path: string): Row[] {
  const text = readFileSync(path, 'utf8').replace(/^﻿/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i += 1;
      row.push(field);
      field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  const [head, ...body] = rows;
  return body.map((r) => Object.fromEntries(head!.map((h, i) => [h, r[i] ?? ''])));
}

/** 全角英数・全角空白を半角に（「大０１」→「大01」、「ＥＮＥＯＳ」→「ENEOS」）。 */
export const norm = (s: string) => s.normalize('NFKC').trim();
const secs = (hms: string) => {
  const [h, m, s] = hms.split(':').map(Number);
  return h! * 3600 + m! * 60 + (s ?? 0);
};

export interface Feed {
  name: string;
  stops: Map<string, Row>;
  /** 親停留所 → 標柱。親を持たない標柱は自分自身を親とみなす。 */
  platformsOf: Map<string, string[]>;
  routes: Map<string, Row>;
  trips: Map<string, Row>;
  /** 便 → 停車（停車順に並べてある）。 */
  timesByTrip: Map<string, Row[]>;
  /** 標柱 → そこに停まる便。 */
  tripsByStop: Map<string, Set<string>>;
  calendar: Row[];
  calendarDates: Row[];
  source: StopData['source'];
}

export function loadFeed(name: string, dir = `data/raw/${name}`): Feed {
  const stops = new Map(readCsv(`${dir}/stops.txt`).map((s) => [s.stop_id!, s]));
  const platformsOf = new Map<string, string[]>();
  for (const s of stops.values()) {
    if (s.location_type === '1') continue;
    const parent = s.parent_station || s.stop_id!;
    const list = platformsOf.get(parent) ?? [];
    list.push(s.stop_id!);
    platformsOf.set(parent, list);
  }
  const timesByTrip = new Map<string, Row[]>();
  const tripsByStop = new Map<string, Set<string>>();
  for (const r of readCsv(`${dir}/stop_times.txt`)) {
    const list = timesByTrip.get(r.trip_id!) ?? [];
    list.push(r);
    timesByTrip.set(r.trip_id!, list);
    const set = tripsByStop.get(r.stop_id!) ?? new Set<string>();
    set.add(r.trip_id!);
    tripsByStop.set(r.stop_id!, set);
  }
  for (const list of timesByTrip.values()) list.sort((a, b) => Number(a.stop_sequence) - Number(b.stop_sequence));
  const feedInfo = readCsv(`${dir}/feed_info.txt`)[0]!;
  return {
    name,
    stops,
    platformsOf,
    routes: new Map(readCsv(`${dir}/routes.txt`).map((r) => [r.route_id!, r])),
    trips: new Map(readCsv(`${dir}/trips.txt`).map((t) => [t.trip_id!, t])),
    timesByTrip,
    tripsByStop,
    calendar: readCsv(`${dir}/calendar.txt`),
    calendarDates: readCsv(`${dir}/calendar_dates.txt`),
    source: {
      agency: norm(feedInfo.feed_publisher_name!),
      feedVersion: feedInfo.feed_version!,
      fetchedDate: statSync(`${dir}.zip`).mtime.toISOString().slice(0, 10),
    },
  };
}

export function buildStop(feed: Feed, parentId: string): StopData {
  const parent = feed.stops.get(parentId);
  if (!parent) throw new Error(`stop ${parentId} not found in ${feed.name}`);
  const platformIds = new Set(feed.platformsOf.get(parentId) ?? [parentId]);

  const touching = new Set<string>();
  for (const id of platformIds) for (const trip of feed.tripsByStop.get(id) ?? []) touching.add(trip);

  const departures: Departure[] = [];
  const arrivals: Arrival[] = [];
  const paths: ApproachPath[] = [];
  const pathIndex = new Map<string, number>();
  const usedServices = new Set<string>();

  for (const tripId of touching) {
    const list = feed.timesByTrip.get(tripId)!;
    const trip = feed.trips.get(tripId)!;
    const route = feed.routes.get(trip.route_id!)!;
    const routeName = norm(route.route_short_name || route.route_long_name!);
    usedServices.add(trip.service_id!);
    list.forEach((r, i) => {
      if (!platformIds.has(r.stop_id!)) return;
      const isLast = i === list.length - 1;
      // 乗車扱い（pickup_type=1 は乗れない）。終点は発車便に数えない。
      if (!isLast && r.pickup_type !== '1') {
        departures.push({
          t: secs(r.departure_time!),
          trip: tripId,
          route: routeName,
          headsign: norm(r.stop_headsign || trip.trip_headsign!),
          platform: r.stop_id!,
          service: trip.service_id!,
          seq: Number(r.stop_sequence),
        });
      }
      if (i > 0) {
        const before = list.slice(Math.max(0, i - PATH_STOPS), i + 1);
        const key = before.map((b) => b.stop_id).join('>');
        let index = pathIndex.get(key);
        if (index === undefined) {
          index = paths.length;
          pathIndex.set(key, index);
          paths.push({
            stops: before.map((b) => {
              const s = feed.stops.get(b.stop_id!)!;
              return { id: b.stop_id!, name: norm(s.stop_name!), lat: Number(s.stop_lat), lng: Number(s.stop_lon), seq: Number(b.stop_sequence) };
            }),
          });
        }
        arrivals.push({
          t: secs(r.arrival_time!),
          trip: tripId,
          route: routeName,
          platform: r.stop_id!,
          service: trip.service_id!,
          seq: Number(r.stop_sequence),
          path: index,
        });
      }
    });
  }
  departures.sort((a, b) => a.t - b.t);
  arrivals.sort((a, b) => a.t - b.t);

  const services: StopData['services'] = {};
  for (const c of feed.calendar) {
    if (!usedServices.has(c.service_id!)) continue;
    services[c.service_id!] = {
      days: ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'].map((d) => c[d] === '1'),
      start: c.start_date!,
      end: c.end_date!,
      added: [],
      removed: [],
    };
  }
  for (const d of feed.calendarDates) {
    const rule = services[d.service_id!];
    if (!rule) continue;
    (d.exception_type === '1' ? rule.added : rule.removed).push(d.date!);
  }

  return {
    feed: feed.name,
    source: feed.source,
    stop: { id: parentId, name: norm(parent.stop_name!), lat: Number(parent.stop_lat), lng: Number(parent.stop_lon) },
    platforms: [...platformIds].sort().map((id) => {
      const s = feed.stops.get(id)!;
      return { id, code: s.platform_code || '', lat: Number(s.stop_lat), lng: Number(s.stop_lon) };
    }),
    services,
    departures,
    arrivals,
    paths,
  };
}
