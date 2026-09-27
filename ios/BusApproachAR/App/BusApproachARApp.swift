// バス接近AR（iOS）。公共交通オープンデータチャレンジ2026 向け。
//
// 川崎市バス・臨港バスの近くのバス停を選ぶと、カメラ越しに接近中のバスの方向と
// 発車までの残り時間を重ねて出す。データは G2 版と同じ中継（Lambda）から取る。

import SwiftUI

@main
struct BusApproachARApp: App {
    @State private var model = AppModel()

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(model)
        }
    }
}

struct RootView: View {
    @Environment(AppModel.self) private var model
    @State private var path = NavigationPath()
    @State private var resumed = false

    var body: some View {
        NavigationStack(path: $path) {
            StopListView()
                .navigationDestination(for: String.self) { _ in ApproachView() }
        }
        .task { await model.trackLocation() }
        .task {
            // 前回のバス停・乗り場があれば、接近ビューから始める。
            guard !resumed else { return }
            resumed = true
            if await model.resume() { path.append("approach") }
        }
        .task {
            while !Task.isCancelled {
                await model.tick()
                try? await Task.sleep(for: .seconds(1))
            }
        }
    }
}
