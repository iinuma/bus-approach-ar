// GTFS-JP から 1 停留所ぶんのデータを切り出して data/stops/<id>.json に書く。
// 使い方: npx tsx scripts/build-stop.ts <feed> <parent_stop_id> [<name>]
//   例:   npx tsx scripts/build-stop.ts rinko 5010 daishibashi
// 事前に data/raw/<feed>/ へ GTFS を展開しておく（README の手順）。
import { readFileSync, writeFileSync, mkdirSync, statSync } from "node:fs";
import type { ApproachPath, Arrival, Departure, StopData } from "../src/core/stopdata.js";

/** 到着便について保持する、手前の停留所の数。車両をこの折れ線に載せて残り距離を出す。 */
const PATH_STOPS = 12;

const [feed, parentId, outName] = process.argv.slice(2);
if (!feed || !parentId) {
  console.error("usage: build-stop.ts <feed> <parent_stop_id> [<name>]");
  process.exit(1);
}
const dir = `data/raw/${feed}`;

/** 引用符付きのフィールドにも対応する最小の CSV 読み。 */
function readCsv(file: string): Record<string, string>[] {
  const text = readFileSync(`${dir}/${file}`, "utf8").replace(/^﻿/, "");
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i += 1; }
      else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i += 1;
      row.push(field); field = "";
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
    } else field += c;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  const [head, ...body] = rows;
  return body.map((r) => Object.fromEntries(head!.map((h, i) => [h, r[i] ?? ""])));
}

/** 全角英数・全角空白を半角に（「大０１」→「大01」、「ＥＮＥＯＳ」→「ENEOS」）。 */
const norm = (s: string) => s.normalize("NFKC").trim();
const secs = (hms: string) => {
  const [h, m, s] = hms.split(":").map(Number);
  return h! * 3600 + m! * 60 + (s ?? 0);
};

const stops = new Map(readCsv("stops.txt").map((s) => [s.stop_id!, s]));
const parent = stops.get(parentId);
if (!parent) throw new Error(`stop ${parentId} not found in ${feed}`);
const platformIds = new Set([...stops.values()].filter((s) => s.parent_station === parentId).map((s) => s.stop_id!));
if (platformIds.size === 0) platformIds.add(parentId);

const routes = new Map(readCsv("routes.txt").map((r) => [r.route_id!, r]));
const trips = new Map(readCsv("trips.txt").map((t) => [t.trip_id!, t]));

// stop_times は大きいので、関係する便だけ残す。まず停留所に触れる便を集め、その便の全行を持つ。
const allTimes = readCsv("stop_times.txt");
const touching = new Set(allTimes.filter((r) => platformIds.has(r.stop_id!)).map((r) => r.trip_id!));
const byTrip = new Map<string, Record<string, string>[]>();
for (const r of allTimes) {
  if (!touching.has(r.trip_id!)) continue;
  const list = byTrip.get(r.trip_id!) ?? [];
  list.push(r);
  byTrip.set(r.trip_id!, list);
}

const departures: Departure[] = [];
const arrivals: Arrival[] = [];
const paths: ApproachPath[] = [];
const pathIndex = new Map<string, number>();
const usedServices = new Set<string>();

for (const [tripId, list] of byTrip) {
  list.sort((a, b) => Number(a.stop_sequence) - Number(b.stop_sequence));
  const trip = trips.get(tripId)!;
  const route = routes.get(trip.route_id!)!;
  const routeName = norm(route.route_short_name || route.route_long_name!);
  usedServices.add(trip.service_id!);
  list.forEach((r, i) => {
    if (!platformIds.has(r.stop_id!)) return;
    const isLast = i === list.length - 1;
    // 乗車扱い（pickup_type=1 は乗れない）。終点は発車便に数えない。
    if (!isLast && r.pickup_type !== "1") {
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
      const key = before.map((b) => b.stop_id).join(">");
      let index = pathIndex.get(key);
      if (index === undefined) {
        index = paths.length;
        pathIndex.set(key, index);
        paths.push({
          stops: before.map((b) => {
            const s = stops.get(b.stop_id!)!;
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

const services: StopData["services"] = {};
for (const c of readCsv("calendar.txt")) {
  if (!usedServices.has(c.service_id!)) continue;
  services[c.service_id!] = {
    days: ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"].map((d) => c[d] === "1"),
    start: c.start_date!,
    end: c.end_date!,
    added: [],
    removed: [],
  };
}
for (const d of readCsv("calendar_dates.txt")) {
  const rule = services[d.service_id!];
  if (!rule) continue;
  (d.exception_type === "1" ? rule.added : rule.removed).push(d.date!);
}

const feedInfo = readCsv("feed_info.txt")[0]!;
const data: StopData = {
  source: {
    agency: norm(feedInfo.feed_publisher_name!),
    feedVersion: feedInfo.feed_version!,
    fetchedDate: statSync(`data/raw/${feed}.zip`).mtime.toISOString().slice(0, 10),
  },
  stop: { id: parentId, name: norm(parent.stop_name!), lat: Number(parent.stop_lat), lng: Number(parent.stop_lon) },
  platforms: [...platformIds].sort().map((id) => {
    const s = stops.get(id)!;
    return { id, code: s.platform_code || "", lat: Number(s.stop_lat), lng: Number(s.stop_lon) };
  }),
  services,
  departures,
  arrivals,
  paths,
};

mkdirSync("data/stops", { recursive: true });
const out = `data/stops/${outName ?? parentId}.json`;
writeFileSync(out, JSON.stringify(data));
console.log(
  `${out}: ${data.stop.name} 乗り場${data.platforms.length} 発${departures.length} 着${arrivals.length} 経路${paths.length} ` +
    `(${Math.round(statSync(out).size / 1024)}KB)`,
);
