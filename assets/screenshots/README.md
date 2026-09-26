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
| 01-stops.png | バス停を選ぶ | 2026-09-27 |
| 02-platforms.png | 乗り場を選ぶ | 2026-09-27 |
| 03-approach.png | 接近ビュー（全乗り場, 日曜 07:3x の実データ） | 2026-09-27 |
| 04-menu.png | コンテキストメニュー | 2026-09-27 |
| 05-about.png | データについて（ODPT の必須表示） | 2026-09-27 |
