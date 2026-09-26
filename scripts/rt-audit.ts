// GTFS-RT の中身と静的 GTFS との照合を確かめる監査スクリプト。
// 使い方: npx tsx scripts/rt-audit.ts [rinko|kawasaki_city] [--save]
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import GtfsRealtimeBindings from "gtfs-realtime-bindings";

const { transit_realtime } = GtfsRealtimeBindings;

const FEEDS = {
  rinko: "odpt_KawasakiTsurumiRinkoBus_allrinko",
  kawasaki_city: "odpt_TransportationBureau_CityOfKawasaki_AllLines",
} as const;

const token = readFileSync(".env", "utf8").match(/^ODPT_TOKEN=(.*)$/m)?.[1]?.trim();
if (!token) throw new Error("ODPT_TOKEN が .env にない");

const name = (process.argv[2] ?? "rinko") as keyof typeof FEEDS;
const save = process.argv.includes("--save");

async function fetchFeed(kind: "vehicle" | "trip_update" | "alert") {
  const url = `https://api.odpt.org/api/v4/gtfs/realtime/${FEEDS[name]}_${kind}?acl:consumerKey=${token}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${kind}: HTTP ${res.status}`);
  const buf = new Uint8Array(await res.arrayBuffer());
  if (save) {
    mkdirSync(`data/raw/rt/${name}`, { recursive: true });
    writeFileSync(`data/raw/rt/${name}/${kind}-${Date.now()}.pb`, buf);
  }
  return transit_realtime.FeedMessage.decode(buf);
}

function csv(path: string): Record<string, string>[] {
  const [head, ...rows] = readFileSync(path, "utf8").replace(/^﻿/, "").trim().split(/\r?\n/);
  const cols = (head ?? "").split(",");
  return rows.map((r) => Object.fromEntries(r.split(",").map((v, i) => [cols[i], v])));
}

const tripIds = new Set(csv(`data/raw/${name}/trips.txt`).map((t) => t.trip_id));
const now = Date.now() / 1000;

for (const kind of ["vehicle", "trip_update", "alert"] as const) {
  const feed = await fetchFeed(kind);
  const ts = Number(feed.header.timestamp);
  console.log(`\n== ${kind}: ${feed.entity.length} entities, header ${new Date(ts * 1000).toISOString()} (${Math.round(now - ts)}s 前)`);
  let matched = 0;
  const ages: number[] = [];
  for (const e of feed.entity) {
    const trip = e.vehicle?.trip ?? e.tripUpdate?.trip;
    if (trip?.tripId && tripIds.has(trip.tripId)) matched++;
    const t = Number(e.vehicle?.timestamp ?? e.tripUpdate?.timestamp ?? 0);
    if (t) ages.push(now - t);
  }
  if (kind !== "alert") {
    console.log(`trip_id 照合: ${matched}/${feed.entity.length}`);
    if (ages.length) {
      ages.sort((a, b) => a - b);
      console.log(`車両ごとの鮮度(秒): min ${Math.round(ages[0]!)} / 中央 ${Math.round(ages[ages.length >> 1]!)} / max ${Math.round(ages.at(-1)!)}`);
    }
  }
  console.log(JSON.stringify(feed.entity.slice(0, 2).map((e) => transit_realtime.FeedEntity.toObject(e as InstanceType<typeof transit_realtime.FeedEntity>)), null, 1).slice(0, 1500));
}
