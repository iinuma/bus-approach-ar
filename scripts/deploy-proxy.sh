#!/bin/sh
# 中継（Lambda）をデプロイし、URL を .env.production.local に書き込む（G2 Sky View と同じ手順）。
#
# 実行前に必ず `aws sts get-caller-identity` で個人アカウント（473259746493）であることを確かめる。
# ~/.claude/CLAUDE.md の AWS 操作ルール。
set -eu
cd "$(dirname "$0")/.."

ENV_FILE=.env.production.local
KEY=$(sed -n 's/^VITE_RT_PROXY_KEY=//p' "$ENV_FILE")
[ -n "$KEY" ] || { echo "$ENV_FILE に VITE_RT_PROXY_KEY がありません" >&2; exit 1; }

npx cdk deploy KawasakiBusProxyStack -c appKey="$KEY" --require-approval never --outputs-file cdk.out/outputs.json
URL=$(node -e "console.log(require('./cdk.out/outputs.json').KawasakiBusProxyStack.ProxyUrl.replace(/\/$/, ''))")

grep -v '^VITE_RT_PROXY=' "$ENV_FILE" > "$ENV_FILE.tmp"
printf 'VITE_RT_PROXY=%s\n' "$URL" >> "$ENV_FILE.tmp"
mv "$ENV_FILE.tmp" "$ENV_FILE"
echo "中継: $URL（$ENV_FILE に書き込んだ。app/app.json の whitelist にも入れる）"
