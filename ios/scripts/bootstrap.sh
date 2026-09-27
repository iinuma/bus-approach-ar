#!/bin/sh
# iOS プロジェクトの準備: Secrets.xcconfig を作り、テストの正解を作り、xcodeproj を生成する。
set -eu
cd "$(dirname "$0")/.."
ROOT=..

URL=$(sed -n 's/^VITE_RT_PROXY=//p' "$ROOT/.env.production.local")
KEY=$(sed -n 's/^VITE_RT_PROXY_KEY=//p' "$ROOT/.env.production.local")
[ -n "$URL" ] && [ -n "$KEY" ] || { echo "$ROOT/.env.production.local に VITE_RT_PROXY / VITE_RT_PROXY_KEY がありません" >&2; exit 1; }
# xcconfig では // 以降がコメントになるので、URL の // を $() で割る。
ESCAPED=$(printf '%s' "$URL" | sed 's#//#/$()/#')
printf 'API_BASE = %s\nAPI_KEY = %s\n' "$ESCAPED" "$KEY" > Config/Secrets.xcconfig

[ -f "$ROOT/data/stops/index.json" ] || { echo "先に npm run build:all（../data/stops/index.json）" >&2; exit 1; }
./scripts/golden.sh
xcodegen generate --quiet
echo "BusApproachAR.xcodeproj を生成した"
