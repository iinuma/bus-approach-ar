# バス接近AR（iOS）

G2 版と同じ中継（Lambda の `/stop`・`/rt`）を使う iOS 版。近くのバス停・乗り場を選ぶと、
カメラ越しに接近中のバスの**実際の方向**と発車までの残り時間を重ねて出す。

G2 は頭の向きが取れないので「右 60°」の道路モデルにしたが、iPhone はコンパスで方位が取れるので
実方位に出す。画面の外にいるバスは左右の端に「右114° 380m」のように出す（大師橋駅前のような
ロータリーでは、実方位で視野に入るのは最後の数十 m だけなので、端の表示が主になる）。

## 構成

```
BusApproachAR/
├─ Core/     ロジック。TypeScript 版（../src/core）を移したもの
│  ├─ Models.swift   中継の JSON の形
│  ├─ Geo.swift      距離・方位（LocalSphere と同じ計算）
│  ├─ Service.swift  運行日・次の発車（calendar_dates の入れ替え込み）
│  ├─ Board.swift    発車案内（RT・折り返し推定・経路に沿った残り距離）
│  └─ Stops.swift    乗り場の選択肢・近いバス停・書式
├─ App/      状態（AppModel）と中継との通信（API）
└─ Views/    画面（選ぶ画面、接近ビュー、ARKit の投影）
BusApproachARTests/
└─ GoldenTests.swift  TypeScript 版と同じ入力で同じ答えになるかを確かめる
```

- **AR**: RealityKit の ARView を `worldAlignment = .gravityAndHeading` で動かす（+x 東・+y 上・-z 北）。
  バスは「方位・距離の地点」を投影して置く。距離は 8〜400m に丸め、目の高さ 1.4m 下に置く。
  北はコンパスで合わせるので、街中では 10〜20° ずれうる。
- **シミュレータ**: ARKit が動かないので、方位をスライダーで回す代わりの投影にする（画角 60°）。
- **方位の基準**: バス停から 300m 以内にいれば現在地、そうでなければバス停の座標。

## 準備

```bash
cd ..                   # リポジトリの根
npm run build:all       # data/stops/index.json（アプリに同梱する停留所の索引）
cd ios
./scripts/bootstrap.sh  # Secrets.xcconfig・テストの正解・BusApproachAR.xcodeproj を作る
open BusApproachAR.xcodeproj
```

- `Config/Secrets.xcconfig`（git に入れない）に中継の URL と共有鍵が入る。元は `../.env.production.local`。
- `BusApproachAR.xcodeproj` は XcodeGen で `project.yml` から作る（git に入れない）。
- テストの入力と正解（`BusApproachARTests/Fixtures/`）は時刻表を含むので git に入れない。
  `scripts/golden.sh` が TypeScript 版で作る（川崎駅は実行時点の実 RT を固定して使う）。

```bash
xcodebuild -project BusApproachAR.xcodeproj -scheme BusApproachAR \
  -destination 'platform=iOS Simulator,name=iPhone 17 Pro Max' test
```

## 確かめたこと（2026-09-27）

- TypeScript 版と同じ入力で、発車案内（便・根拠・見込み・車両・残り距離・停留所数）、乗り場の選択肢、
  運行日、距離・方位がすべて一致（川崎駅は実 RT 20 便: realtime 7 / inbound 12 / schedule 1）。
- シミュレータ: バス停一覧（両社まとめ）→ 乗り場（事業者つき、全乗り場が先頭）→ 接近ビュー
  （両社の便、乗り場で待機中、画面外の矢印）→ 前回の選択から再開。
- 実機向けのコンパイルは通る。**カメラ・コンパスでの見え方は実機で未確認。**

## 未確認・次にやること

- [ ] 実機で、ラベルが実際のバスの方向に出るか（コンパスのずれ）
- [ ] 折り返し推定の下限: 今は「発車の 30 分後までに着く車両」なら何時間前に着く車両でも結ぶ
      （22:30 発に 19:37 時点で 5km 先の車両を結んでいた）。TypeScript 版と同時に直す
- [ ] バスの位置を補間して動かす（位置は 50〜110 秒前のもの）
