# 審査用スクリーンショット

シミュレータの automation API で撮影（Tokyojihatsu・G2 Sky View と同じ手順）。

```bash
npm run app:dev
npx evenhub-simulator "http://localhost:5179/" --automation-port 9898
curl -X POST -H 'Content-Type: application/json' -d '{"action":"click"}' http://127.0.0.1:9898/api/input
curl -o shot.png http://127.0.0.1:9898/api/screenshot/glasses
```

RGBA のまま保存する（明るさはアルファに出る）。見るときは黒に合成する:

```bash
magick 03-approach.png -background black -alpha remove -alpha off view.png
```

**アプリの文言を変えたら、その画面を撮り直す**（ストアの画像が実装と食い違うため）。

| ファイル | 画面 | 撮影 |
| --- | --- | --- |
| 01-stops.png | バス停を選ぶ（川崎駅の近く。両社まとめ「市バス・臨港」） | 2026-10-03 |
| 02-platforms.png | 乗り場を選ぶ（全乗り場が先頭、事業者つき） | 2026-10-03 |
| 03-approach.png | 接近ビュー（川崎駅・全乗り場、土曜 08:14 の実データ） | 2026-10-03 |
| 04-menu.png | コンテキストメニュー | 2026-10-03 |
| 05-about.png | データについて（ODPT の必須表示、両社の時刻表の版） | 2026-10-03 |

シミュレータには位置情報が無いので、URL で現在地を渡す。前回の選択から再開させないときは `fresh=1`:

```bash
npx evenhub-simulator "http://localhost:5179/?lat=35.5306&lng=139.6986&fresh=1" --automation-port 9898
```
