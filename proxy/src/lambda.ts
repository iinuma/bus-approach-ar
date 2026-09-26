/**
 * Lambda Function URL の入口。デプロイは proxy/infra/（CDK）。
 *
 * - ODPT のトークンは SSM の SecureString から実行時に読む（テンプレートに値を残さない）。
 *   パラメータは Tokyojihatsu が置いたもの（/tokyojihatsu/odpt-token）を共用する。
 * - 停留所データ（scripts/build-all.ts の出力）は非公開の S3 に置き、ここから読む。
 *   `npm run stops:upload` で置き直せば、アプリを出し直さずにダイヤ改正を反映できる。
 * - 共有鍵は .ehpk に入る値なので秘密ではなく、環境変数で渡す（G2 Sky View と同じ）。
 */

import { GetObjectCommand, NoSuchKey, S3Client } from '@aws-sdk/client-s3';
import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';
import type { StopData } from '../../src/core/stopdata.js';
import { fetchSnapshot, type FeedName } from './odpt-rt.js';
import { createRtProxy } from './rt-proxy.js';

let token: string | null = null;

async function resolveToken(): Promise<string> {
  if (token) return token;
  const name = process.env.ODPT_TOKEN_PARAM;
  if (!name) throw new Error('ODPT_TOKEN_PARAM is not set');
  const result = await new SSMClient({}).send(new GetParameterCommand({ Name: name, WithDecryption: true }));
  token = result.Parameter?.Value ?? '';
  if (!token) throw new Error(`SSM ${name} is empty`);
  return token;
}

/** 停留所データのキャッシュ。置き直しが 1 時間以内に効くよう、期限付きで持つ。 */
const STOP_TTL_MS = 3600_000;
const STOP_CACHE_MAX = 60;
const stopCache = new Map<string, { at: number; data: StopData | null }>();
const s3 = new S3Client({});

async function loadStop(feed: FeedName, id: string): Promise<StopData | null> {
  const key = `stops/${feed}/${id}.json`;
  const hit = stopCache.get(key);
  if (hit && Date.now() - hit.at < STOP_TTL_MS) return hit.data;
  let data: StopData | null = null;
  try {
    const object = await s3.send(new GetObjectCommand({ Bucket: process.env.STOPS_BUCKET!, Key: key }));
    data = JSON.parse(await object.Body!.transformToString()) as StopData;
  } catch (error) {
    if (!(error instanceof NoSuchKey)) throw error;
  }
  if (stopCache.size >= STOP_CACHE_MAX) stopCache.delete(stopCache.keys().next().value!);
  stopCache.set(key, { at: Date.now(), data });
  return data;
}

const handle = createRtProxy({
  fetchSnapshot: async (feed) => fetchSnapshot(feed, await resolveToken()),
  loadStop,
  appKey: process.env.APP_KEY || undefined,
});

interface FunctionUrlEvent {
  rawPath?: string;
  queryStringParameters?: Record<string, string | undefined>;
  headers?: Record<string, string | undefined>;
  requestContext?: { http?: { method?: string; sourceIp?: string } };
}

export async function handler(event: FunctionUrlEvent) {
  const headers: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(event.headers ?? {})) headers[k.toLowerCase()] = v;
  const response = await handle({
    method: event.requestContext?.http?.method ?? 'GET',
    path: event.rawPath ?? '/',
    query: event.queryStringParameters ?? {},
    headers,
    sourceIp: event.requestContext?.http?.sourceIp,
  });
  return { statusCode: response.status, headers: response.headers, body: response.body, isBase64Encoded: response.base64 === true };
}
