// バス停と乗り場を選ぶ画面。

import SwiftUI

struct StopListView: View {
    @Environment(AppModel.self) private var model
    @State private var query = ""

    var body: some View {
        List {
            if model.location == nil {
                Text("現在地が取れないので、川崎駅の近くを出しています")
                    .font(.caption).foregroundStyle(.secondary)
            }
            if query.isEmpty {
                ForEach(model.nearby(), id: \.entry.key) { item in
                    row(item.entry, distance: item.distanceM)
                }
            } else {
                ForEach(model.search(query).prefix(50)) { entry in
                    row(entry, distance: Geo.distance(model.location ?? AppModel.fallbackLocation, entry.position))
                }
            }
        }
        .searchable(text: $query, prompt: "バス停名")
        .navigationTitle("バス停を選ぶ")
        .navigationDestination(for: StopIndexEntry.self) { entry in
            PlatformListView(entry: entry)
        }
    }

    private func row(_ entry: StopIndexEntry, distance: Double) -> some View {
        NavigationLink(value: entry) {
            VStack(alignment: .leading, spacing: 2) {
                HStack {
                    Text(entry.name).font(.headline)
                    Spacer()
                    Text(Format.meters(distance)).font(.caption).foregroundStyle(.secondary)
                }
                Text("\(entry.operators.joined(separator: "・"))  \(entry.routes.prefix(5).joined(separator: " "))")
                    .font(.caption).foregroundStyle(.secondary).lineLimit(1)
            }
        }
    }
}

struct PlatformListView: View {
    @Environment(AppModel.self) private var model
    let entry: StopIndexEntry
    @State private var chosen: PlatformChoice?

    var body: some View {
        List {
            if let error = model.stopError, model.entry?.key == entry.key {
                Text(error).foregroundStyle(.red)
            } else if model.stop == nil || model.entry?.key != entry.key {
                HStack { ProgressView(); Text("時刻表を取得中…") }
            } else if model.choices.isEmpty {
                // 曜日によって便の無いバス停がある（砂子一丁目は日曜に 0 本）。
                Text("今日はこのバス停から出る便がありません").foregroundStyle(.secondary)
            } else {
                ForEach(model.choices) { choice in
                    Button(choice.label) {
                        Task {
                            await model.choose(choice)
                            chosen = choice
                        }
                    }
                }
            }
        }
        .navigationTitle(entry.name)
        .task(id: entry.key) {
            if model.entry?.key != entry.key || model.stop == nil { await model.select(entry) }
        }
        .navigationDestination(item: $chosen) { _ in
            ApproachView()
        }
    }
}
