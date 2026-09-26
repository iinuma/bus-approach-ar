/**
 * ODPT の中継（Lambda と dev サーバーで共通の中身）。
 *
 *   GET /stop?key=rinko:5010   停留所の時刻表（その日に走る便だけ, gzip）
 *   GET /rt?key=rinko:5010     その停留所に関係する便の車両位置・予測
 *   GET /?feed=rinko           0.1.0（大師橋駅前だけのベータ）との互換。大師橋駅前の便だけ返す
 *
 * 役目は Tokyojihatsu の中継と同じ:
 *   1. **トークンの秘匿。** .ehpk は展開できるのでトークンを同梱できない。
 *   2. **素通しにしない。** ODPT のライセンス第 8 条 4(1) は「第三者が再利用可能な状態での
 *      公開・再配布・公衆送信」を禁じている。共有鍵の無いリクエストは 403、IP ごとに
 *      毎分の上限を設け、返すのは**頼まれた停留所に関係する分だけ**にする。
 *   3. **データ更新義務**（ガイドライン 2.2.2）。時刻表をアプリに同梱せず中継が配るので、
 *      ダイヤ改正はデータを置き直すだけで反映でき、アプリを出し直さなくてよい。
 *
 * .ehpk から共有鍵は取り出せるので完全な防御ではない。「誰でも叩ける API として
 * 公開しない」ところまでを目指す（Tokyojihatsu と同じ割り切り）。
 */

import { gzipSync } from 'node:zlib';

import type { RtSnapshot } from '../../src/core/realtime.js';
import { sliceForDay } from '../../src/core/service.js';
import type { StopData } from '../../src/core/stopdata.js';
import { FEEDS, type FeedName } from './odpt-rt.js';

export const APP_KEY_HEADER = 'x-bus-key';

/** フィードの更新は 20〜60 秒ごと（実測）。それより短く持つ。 */
const RT_CACHE_MS = 15_000;
/** 0.1.0 のベータが見ている停留所。 */
const LEGACY_STOP = 'rinko:5010';
const KEY_PATTERN = /^([a-z_]+):([A-Za-z0-9_-]{1,32})$/;

export interface RtProxyRequest {
  method: string;
  path: string;
  query: Record<string, string | undefined>;
  headers: Record<string, string | undefined>;
  sourceIp?: string;
}

export interface RtProxyResponse {
  status: number;
  headers: Record<string, string>;
  /** base64 が true なら base64 の文字列（gzip した本文）。 */
  body: string;
  base64?: boolean;
}

export interface RtProxyOptions {
  fetchSnapshot: (feed: FeedName) => Promise<RtSnapshot>;
  /** 停留所の StopData（全曜日ぶん）。無ければ null。 */
  loadStop: (feed: FeedName, id: string) => Promise<StopData | null>;
  /** 空なら鍵を確かめない（dev サーバー）。 */
  appKey?: string;
  rateLimitPerMinute?: number;
  now?: () => number;
}

/**
 * CORS は**ここだけ**が返す。Function URL 側でも設定すると
 * Access-Control-Allow-Origin が 2 つになり、WebView の fetch が落ちる（Tokyojihatsu の実機）。
 */
const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-headers': `content-type, ${APP_KEY_HEADER}`,
  'access-control-allow-methods': 'GET, OPTIONS',
};

export function parseStopKey(key: string | undefined): { feed: FeedName; id: string } | null {
  const m = key ? KEY_PATTERN.exec(key) : null;
  if (!m || !(m[1]! in FEEDS)) return null;
  return { feed: m[1] as FeedName, id: m[2]! };
}

export function createRtProxy(options: RtProxyOptions) {
  const now = options.now ?? Date.now;
  const limit = options.rateLimitPerMinute ?? 60;
  const snapshots = new Map<FeedName, { at: number; snapshot: RtSnapshot }>();
  const hits = new Map<string, { minute: number; count: number }>();

  const reply = (status: number, body: string, extra: Record<string, string> = {}): RtProxyResponse => ({
    status,
    headers: { ...CORS, 'content-type': status === 200 ? 'application/json' : 'text/plain; charset=utf-8', 'cache-control': 'no-store', ...extra },
    body,
  });

  const json = (value: unknown, request: RtProxyRequest): RtProxyResponse => {
    const text = JSON.stringify(value);
    if (!(request.headers['accept-encoding'] ?? '').includes('gzip') || text.length < 2048) return reply(200, text);
    return { ...reply(200, gzipSync(text).toString('base64'), { 'content-encoding': 'gzip' }), base64: true };
  };

  async function snapshotOf(feed: FeedName): Promise<RtSnapshot> {
    const hit = snapshots.get(feed);
    if (hit && now() - hit.at < RT_CACHE_MS) return hit.snapshot;
    const snapshot = await options.fetchSnapshot(feed);
    snapshots.set(feed, { at: now(), snapshot });
    return snapshot;
  }

  /** 停留所に関係する便の車両・予測だけにする。 */
  function filterFor(snapshot: RtSnapshot, stop: StopData): RtSnapshot {
    const trips = new Set([...stop.departures.map((d) => d.trip), ...stop.arrivals.map((a) => a.trip)]);
    return {
      ...snapshot,
      vehicles: snapshot.vehicles.filter((v) => trips.has(v.trip)),
      tripUpdates: snapshot.tripUpdates.filter((u) => trips.has(u.trip)),
    };
  }

  return async function handle(request: RtProxyRequest): Promise<RtProxyResponse> {
    if (request.method === 'OPTIONS') return reply(204, '');
    if (request.method !== 'GET') return reply(405, 'method not allowed');
    if (options.appKey && request.headers[APP_KEY_HEADER] !== options.appKey) return reply(403, 'forbidden');

    if (limit > 0 && request.sourceIp) {
      const minute = Math.floor(now() / 60_000);
      const hit = hits.get(request.sourceIp);
      const count = hit && hit.minute === minute ? hit.count + 1 : 1;
      hits.set(request.sourceIp, { minute, count });
      if (hits.size > 1000) hits.clear();
      if (count > limit) return reply(429, 'too many requests', { 'retry-after': '60' });
    }

    const route = request.path.replace(/\/+$/, '');
    try {
      if (route === '/stop' || route === '/rt') {
        const key = parseStopKey(request.query.key);
        if (!key) return reply(400, 'bad key');
        const full = await options.loadStop(key.feed, key.id);
        if (!full) return reply(404, 'unknown stop');
        const stop = sliceForDay(full, now());
        if (route === '/stop') return json(stop, request);
        return json(filterFor(await snapshotOf(key.feed), stop), request);
      }

      // 0.1.0 との互換: /?feed=rinko
      if (route === '' && request.query.feed !== undefined) {
        const legacy = parseStopKey(LEGACY_STOP)!;
        if (request.query.feed !== legacy.feed) return reply(404, 'unknown feed');
        const stop = await options.loadStop(legacy.feed, legacy.id);
        if (!stop) return reply(404, 'unknown stop');
        return reply(200, JSON.stringify(filterFor(await snapshotOf(legacy.feed), stop)));
      }
    } catch (error) {
      console.error('upstream failed', error);
      return reply(502, 'upstream error');
    }
    return reply(404, 'not found');
  };
}
