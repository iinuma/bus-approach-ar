#!/usr/bin/env node
/**
 * CDK のエントリ。scripts/deploy-proxy.sh から呼ぶ（共有鍵を .env.production.local から渡す）。
 *
 * デプロイ先の AWS アカウントは作業ディレクトリの認証情報で決まる。
 * 実行前に `aws sts get-caller-identity` で個人アカウント（473259746493）であることを確かめる。
 */

import { App } from 'aws-cdk-lib';
import { KawasakiBusProxyStack } from './stack.js';

const app = new App();
const appKey = app.node.tryGetContext('appKey') as string | undefined;
if (!appKey) throw new Error('-c appKey=... が必要です（scripts/deploy-proxy.sh を使う）');

new KawasakiBusProxyStack(app, 'KawasakiBusProxyStack', {
  appKey,
  tokenParameterName: (app.node.tryGetContext('tokenParam') as string | undefined) ?? '/tokyojihatsu/odpt-token',
  env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION ?? 'ap-northeast-1' },
  description: 'バス接近AR: ODPT GTFS-RT 中継（トークン秘匿・素通しにしないため）',
});
