// GTFS-JP から 1 停留所ぶんのデータを切り出して data/stops/<name>.json に書く。
// 使い方: npx tsx scripts/build-stop.ts <feed> <parent_stop_id> [<name>]
//   例:   npx tsx scripts/build-stop.ts rinko 5010 daishibashi
// 全停留所をまとめて作るのは scripts/build-all.ts。
import { mkdirSync, statSync, writeFileSync } from 'node:fs';
import { buildStop, loadFeed } from './lib/gtfs.js';

const [feed, parentId, outName] = process.argv.slice(2);
if (!feed || !parentId) {
  console.error('usage: build-stop.ts <feed> <parent_stop_id> [<name>]');
  process.exit(1);
}

const data = buildStop(loadFeed(feed), parentId);
mkdirSync('data/stops', { recursive: true });
const out = `data/stops/${outName ?? parentId}.json`;
writeFileSync(out, JSON.stringify(data));
console.log(
  `${out}: ${data.stop.name} 乗り場${data.platforms.length} 発${data.departures.length} 着${data.arrivals.length} 経路${data.paths.length} ` +
    `(${Math.round(statSync(out).size / 1024)}KB)`,
);
