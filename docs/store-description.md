# ストア掲載文（Even Hub ポータル → Edit description）

## About（2000 文字以内）

Even Hub の About は**日英 1 フィールド**で、合計 2000 文字まで（Tokyojihatsu の docs/store-description.md）。
英語は対訳ではなく要点を絞った版。ODPT 開発者ガイドライン 3.1 が求める 3 点
（提供元・無保証・問い合わせ先）は**両言語に残す**。文字数は下の「数え方」で確かめる。

⚠️ **審査中は Store listing を編集できない。** 提出前に正しくしておくこと。

```
スマートフォンを取り出さずに、バス停で次のバスまであと何分か、いまバスがどこまで来ているかを確認できます。川崎市バスと川崎鶴見臨港バスの全停留所に対応しています。

■ 使い方
1. 近くのバス停を選ぶ
2. 乗り場を選ぶ（系統と行先が表示されます。「全乗り場」も選べます）
3. 系統・行先・発車時刻と、発車までの残り時間が表示されます

一度選べば記憶し、次回は起動するだけで始まります。バス停・乗り場はメニューから選び直せます。

■ 接近中のバスを道路の上に表示
画面上部に、バス停で道路を向いた向きから右へ60°見たときの道路を模式的に描き、接近中のバスを乗り場までの残り距離に応じて置きます。遠くのバスは奥に小さく、近づくと手前の乗り場へ降りてきます。テンプルのスワイプで向きを回して実際の道路に合わせられ、タップで次の便に切り替わります。実際の方位を示すものではありません。

■ 表示の根拠
「乗り場で待機中」「接近中」はバスの位置情報、「折返し推定」は到着するバスがそのまま折り返すと仮定した推定、「時刻表の予定」は時刻表だけにもとづく表示です。

■ 両社が止まるバス停
川崎駅など、川崎市バスと臨港バスが止まるバス停は1つにまとめ、両社の便を発車順に表示します。乗り場には「臨港 1番」「市バス」のように事業者を添えます。

■ データについて
時刻表とバスの位置情報は公共交通オープンデータセンターの提供です。データの正確性・完全性が保証されたものではありません。時刻表の版と取得日はアプリ内の「データについて」で確認できます。

近くのバス停を出すために位置情報を使います。端末内だけで処理され、外部へ送信されません。

本アプリが表示する情報について、バス事業者への直接のお問い合わせはご遠慮ください。下記までご連絡ください。

---

Bus Approach AR shows the next bus at your stop and where approaching buses are, on your Even G2. It covers every stop of Kawasaki City Bus and Kawasaki Tsurumi Rinko Bus. Pick a nearby stop and a platform; your choice is remembered.

The upper band draws a schematic road as seen 60° to the right of facing the street, with each bus placed by its remaining distance. Swipe the temple to rotate it; tap for the next bus. It does not show true compass directions.

Timetable and bus location data is provided by the Open Data Center for Public Transportation; accuracy and completeness are not guaranteed. Your location is used only to find nearby stops and never leaves the phone. Please do not contact bus operators about this app.

Contact: async.sync+kawasakibus@gmail.com
Privacy policy: https://iinuma.github.io/bus-approach-ar/privacy-policy
```

### 数え方

```bash
awk '/^```$/{f=!f; next} f' docs/store-description.md | sed -n '1,/^Privacy policy/p' | python3 -c "import sys; print(len(sys.stdin.read().rstrip('\n')))"
```

## Tags（5 個まで）

```
バス, 川崎, 時刻表, bus, timetable
```

Even Hub は全世界に公開されるので、日本語と英語を混ぜる（Tokyojihatsu と同じ）。

## Category

ポータルの選択肢から選ぶ。交通・移動系が無ければ Utility / Tools 相当（Tokyojihatsu と同じ）。

## スクリーンショット

`assets/screenshots/01〜05`（2026-10-03 撮影、川崎駅・全乗り場）。詳細は assets/screenshots/README.md。
