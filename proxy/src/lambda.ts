/**
 * Lambda Function URL の入口。デプロイは proxy/infra/（CDK）。
 *
 * ODPT のトークンは SSM の SecureString から実行時に読む（テンプレートに値を残さない）。
 * パラメータは Tokyojihatsu が置いたもの（/tokyojihatsu/odpt-token）を共用する。
 * 共有鍵は .ehpk に入る値なので秘密ではなく、環境変数で渡す（G2 Sky View と同じ）。
 */

import { GetParameterCommand, SSMClient } from '@aws-sdk/client-ssm';
import daishibashi from '../../data/stops/daishibashi.json';
import type { StopData } from '../../src/core/stopdata.js';
import { fetchSnapshot } from './odpt-rt.js';
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

const handle = createRtProxy({
  fetchSnapshot: async (feed) => fetchSnapshot(feed, await resolveToken()),
  stops: [daishibashi as StopData],
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
  return { statusCode: response.status, headers: response.headers, body: response.body };
}
