#!/bin/sh
# 停留所データ（scripts/build-all.ts の出力）を中継の S3 に置き直す。
# ダイヤ改正・GTFS の更新はこれで反映される（アプリの出し直しは要らない）。
#
# 実行前に必ず `aws sts get-caller-identity` で個人アカウント（473259746493）であることを確かめる。
set -eu
cd "$(dirname "$0")/.."

BUCKET=$(node -e "console.log(require('./cdk.out/outputs.json').KawasakiBusProxyStack.StopsBucket)")
[ -n "$BUCKET" ] || { echo "cdk.out/outputs.json に StopsBucket がありません（先に npm run proxy:deploy）" >&2; exit 1; }

for feed in kawasaki_city rinko; do
  aws s3 sync "data/stops/$feed/" "s3://$BUCKET/stops/$feed/" --delete --content-type application/json --only-show-errors
done
echo "s3://$BUCKET/stops/ に置いた: $(find data/stops/kawasaki_city data/stops/rinko -name '*.json' | wc -l | tr -d ' ') 停留所"
