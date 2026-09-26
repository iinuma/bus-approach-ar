// 全停留所の StopData と索引を作る。
// 使い方: npx tsx scripts/build-all.ts [feed...]   （既定: kawasaki_city rinko）
//
// 出力:
//   data/stops/<feed>/<parent_stop_id>.json  停留所ごと（中継が S3 から配る）
//   data/stops/index.json                    停留所の一覧（アプリに同梱する）
//
// 時刻表そのものなので公開リポジトリには入れない（.gitignore、README の「公開リポジトリに入れないもの」）。
import { mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { groupStops, type GroupCandidate } from '../src/core/grouping.js';
import { operatorOf } from '../src/core/merge.js';
import type { StopIndex } from '../src/core/stopindex.js';
import { buildStop, loadFeed, norm } from './lib/gtfs.js';

const feeds = process.argv.slice(2).length ? process.argv.slice(2) : ['kawasaki_city', 'rinko'];
const index: StopIndex = { builtAt: new Date().toISOString(), sources: {}, stops: [] };
const sizes: { key: string; name: string; kb: number }[] = [];
const candidates: (GroupCandidate & { routes: string[] })[] = [];

for (const name of feeds) {
  const started = performance.now();
  const feed = loadFeed(name);
  index.sources[name] = feed.source;
  rmSync(`data/stops/${name}`, { recursive: true, force: true });
  mkdirSync(`data/stops/${name}`, { recursive: true });
  let count = 0;
  let skipped = 0;
  for (const parentId of feed.platformsOf.keys()) {
    const data = buildStop(feed, parentId);
    if (data.departures.length === 0 && data.arrivals.length === 0) {
      skipped += 1;
      continue;
    }
    const path = `data/stops/${name}/${parentId}.json`;
    writeFileSync(path, JSON.stringify(data));
    const kb = statSync(path).size / 1024;
    sizes.push({ key: `${name}:${parentId}`, name: data.stop.name, kb });
    // 索引には選ぶのに要るものだけ（名前・座標・系統）。便は入れない。
    candidates.push({
      key: `${name}:${parentId}`,
      feed: name,
      name: norm(data.stop.name),
      lat: data.stop.lat,
      lng: data.stop.lng,
      departures: data.departures.length,
      routes: [...new Set(data.departures.map((d) => d.route))].sort(),
    });
    count += 1;
  }
  console.log(`${name}: ${count} 停留所（便なし ${skipped} を除外） ${Math.round(performance.now() - started)}ms`);
}

// 事業者をまたいで同じバス停をまとめる（src/core/grouping.ts）。
const routesOf = new Map(candidates.map((c) => [c.key, c.routes]));
const groups = groupStops(candidates);
for (const g of groups) {
  index.stops.push({
    key: g.members.map((m) => m.key).join('+'),
    name: g.name,
    lat: Number(g.lat.toFixed(6)),
    lng: Number(g.lng.toFixed(6)),
    operators: g.members.map((m) => operatorOf(m.feed)),
    routes: [...new Set(g.members.flatMap((m) => routesOf.get(m.key) ?? []))].sort(),
  });
}
const merged = groups.filter((g) => g.members.length > 1);
console.log(`まとめたバス停 ${merged.length}（${candidates.length} 停留所 → ${groups.length} バス停）`);
console.log('  例:', merged.filter((g) => new Set(g.members.map((m) => m.name)).size > 1).map((g) => g.members.map((m) => m.name).join('＝')).join(', '));
writeFileSync('data/stops/index.json', JSON.stringify(index));
sizes.sort((a, b) => b.kb - a.kb);
const total = sizes.reduce((n, s) => n + s.kb, 0);
const median = sizes[sizes.length >> 1]!.kb;
console.log(`合計 ${(total / 1024).toFixed(1)}MB / ${sizes.length} 停留所  中央値 ${median.toFixed(0)}KB`);
console.log('大きい順:', sizes.slice(0, 6).map((s) => `${s.name}(${s.key}) ${Math.round(s.kb)}KB`).join(', '));
console.log(`index.json ${Math.round(statSync('data/stops/index.json').size / 1024)}KB`);
