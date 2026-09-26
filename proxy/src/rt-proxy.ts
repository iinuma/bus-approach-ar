/**
 * ODPT GTFS-RT の中継（Lambda と dev サーバーで共通の中身）。
 *
 * 役目は Tokyojihatsu の中継と同じ 2 つ:
 *   1. **トークンの秘匿。** .ehpk は展開できるのでトークンを同梱できない。
 *   2. **素通しにしない。** ODPT のライセンス第 8 条 4(1) は「第三者が再利用可能な状態での
 *      公開・再配布・公衆送信」を禁じている。共有鍵の無いリクエストは 403、IP ごとに
 *      毎分の上限を設け、返すのは**収録している停留所に関係する便だけ**にする。
 *
 * .ehpk から共有鍵は取り出せるので完全な防御ではない。「誰でも叩ける API として
 * 公開しない」ところまでを目指す（Tokyojihatsu と同じ割り切り）。
 */

import type { RtSnapshot } from '../../src/core/realtime.js';
import type { StopData } from '../../src/core/stopdata.js';
import { FEEDS, type FeedName } from './odpt-rt.js';

export const APP_KEY_HEADER = 'x-bus-key';

/** フィードの更新は 20〜60 秒ごと（実測）。それより短く持つ。 */
const CACHE_MS = 15_000;

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
  body: string;
}

export interface RtProxyOptions {
  fetchSnapshot: (feed: FeedName) => Promise<RtSnapshot>;
  /** 収録している停留所。ここに出てくる便だけを返す。 */
  stops: StopData[];
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

export function createRtProxy(options: RtProxyOptions) {
  const now = options.now ?? Date.now;
  const limit = options.rateLimitPerMinute ?? 60;
  const trips = new Set(options.stops.flatMap((s) => [...s.departures.map((d) => d.trip), ...s.arrivals.map((a) => a.trip)]));
  const cache = new Map<FeedName, { at: number; body: string }>();
  const hits = new Map<string, { minute: number; count: number }>();

  const reply = (status: number, body: string, extra: Record<string, string> = {}): RtProxyResponse => ({
    status,
    headers: { ...CORS, 'content-type': status === 200 ? 'application/json' : 'text/plain; charset=utf-8', ...extra },
    body,
  });

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

    const feed = request.query.feed as FeedName | undefined;
    if (!feed || !(feed in FEEDS)) return reply(404, 'unknown feed');

    const hit = cache.get(feed);
    if (hit && now() - hit.at < CACHE_MS) return reply(200, hit.body, { 'cache-control': 'no-store' });

    try {
      const snapshot = await options.fetchSnapshot(feed);
      const filtered: RtSnapshot = {
        ...snapshot,
        vehicles: snapshot.vehicles.filter((v) => trips.has(v.trip)),
        tripUpdates: snapshot.tripUpdates.filter((u) => trips.has(u.trip)),
      };
      const body = JSON.stringify(filtered);
      cache.set(feed, { at: now(), body });
      return reply(200, body, { 'cache-control': 'no-store' });
    } catch (error) {
      console.error('odpt fetch failed', error);
      return reply(502, 'upstream error');
    }
  };
}
