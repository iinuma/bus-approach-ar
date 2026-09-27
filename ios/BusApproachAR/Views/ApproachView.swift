// 接近ビュー: カメラ映像の上に、接近中のバスの方向・残り時間を重ねる。
// 画面の外にいるバスは、左右の端に「どちらへ何度」を出す。下に発車案内。

import SwiftUI

struct ApproachView: View {
    @Environment(AppModel.self) private var model
    @State private var holder = ARSessionHolder()
    @State private var focusId: String?
    /// ARKit が使えないとき（シミュレータ）の、手で回す方位。
    @State private var manualHeading: Double = 90
    private let manualFov = 60.0

    var body: some View {
        ZStack(alignment: .bottom) {
            GeometryReader { geo in
                ZStack {
                    if holder.supported {
                        ARCameraView(holder: holder).ignoresSafeArea()
                    } else {
                        simulatorBackdrop(size: geo.size)
                    }
                    TimelineView(.animation(minimumInterval: 1 / 20)) { _ in
                        overlay(size: geo.size)
                    }
                }
            }
            .ignoresSafeArea()
            VStack(spacing: 0) {
                statusBar
                Spacer()
                if !holder.supported { manualControls }
                BoardPanel(focusId: $focusId)
            }
        }
        .navigationTitle(model.entry?.name ?? "")
        .navigationBarTitleDisplayMode(.inline)
        .onAppear { holder.start() }
        .onDisappear { holder.pause() }
    }

    // MARK: - 重ね描き

    private struct Marker: Identifiable {
        let entry: BoardEntry
        let projected: Projected
        let focus: Bool
        var id: String { entry.id }
    }

    private func markers(size: CGSize) -> [Marker] {
        // 同じ車両は 1 回だけ（先の便を優先）。
        var seen = Set<String>()
        let focused = focusId ?? model.board.first(where: { $0.bus != nil })?.id
        return model.board.compactMap { e in
            guard let bus = e.bus, seen.insert(bus.vehicle.vehicle).inserted else { return nil }
            let (distance, azimuth) = Geo.inverse(from: model.observer, to: bus.vehicle.position)
            let projected = holder.supported
                ? Projector.project(azimuthDeg: azimuth, distanceM: distance, holder: holder, size: size)
                : Projector.projectManual(azimuthDeg: azimuth, distanceM: distance, headingDeg: manualHeading, hfovDeg: manualFov, size: size)
            return projected.map { Marker(entry: e, projected: $0, focus: e.id == focused) }
        }
    }

    @ViewBuilder
    private func overlay(size: CGSize) -> some View {
        let all = markers(size: size)
        ZStack {
            ForEach(all) { marker in
                if case .onScreen(let point) = marker.projected.place {
                    BusLabel(entry: marker.entry, focus: marker.focus, nearness: marker.projected.nearness)
                        .position(x: point.x, y: max(80, point.y - 30))
                }
            }
            // 画面の外: 左右の端に縦に並べる
            ForEach([true, false], id: \.self) { left in
                let side = all.filter { if case .offScreen(let l, _) = $0.projected.place { return l == left } else { return false } }
                VStack(alignment: left ? .leading : .trailing, spacing: 6) {
                    ForEach(side.prefix(4)) { marker in
                        if case .offScreen(_, let delta) = marker.projected.place {
                            EdgeArrow(entry: marker.entry, left: left, deltaDeg: delta, focus: marker.focus)
                        }
                    }
                }
                .frame(maxWidth: .infinity, alignment: left ? .leading : .trailing)
                .padding(.horizontal, 8)
                .position(x: size.width / 2, y: size.height * 0.32)
            }
        }
        .allowsHitTesting(false)
    }

    private var statusBar: some View {
        HStack(spacing: 8) {
            Text(model.rtAgeText)
            if let note = holder.trackingNote { Text(note) }
            if !model.usingOwnLocation { Text("バス停の位置で計算") }
            Spacer()
        }
        .font(.caption)
        .padding(.horizontal, 12)
        .padding(.vertical, 6)
        .background(.ultraThinMaterial)
    }

    // MARK: - シミュレータ（ARKit なし）

    private func simulatorBackdrop(size: CGSize) -> some View {
        ZStack {
            LinearGradient(colors: [.black, Color(white: 0.15)], startPoint: .top, endPoint: .bottom)
            Rectangle().fill(.white.opacity(0.3)).frame(height: 1).position(x: size.width / 2, y: size.height / 2)
            Text("カメラなし（シミュレータ）— 方位 \(Int(manualHeading))°")
                .font(.caption).foregroundStyle(.white.opacity(0.6))
                .position(x: size.width / 2, y: size.height / 2 - 14)
        }
    }

    private var manualControls: some View {
        HStack {
            Text("向き")
            Slider(value: $manualHeading, in: 0...359, step: 1)
            Text("\(Int(manualHeading))°").monospacedDigit().frame(width: 44, alignment: .trailing)
        }
        .font(.caption)
        .padding(.horizontal, 12)
        .padding(.vertical, 6)
        .background(.ultraThinMaterial)
    }
}

/// 画面の中のバスのラベル。
private struct BusLabel: View {
    @Environment(AppModel.self) private var model
    let entry: BoardEntry
    let focus: Bool
    let nearness: Double

    var body: some View {
        VStack(spacing: 2) {
            Text("\(entry.scheduled.dep.route) \(Format.countdown(entry.expectedMs - model.nowMs))")
                .font(.system(size: focus ? 20 : 15, weight: .bold))
            if focus, let bus = entry.bus {
                Text(bus.waiting ? "乗り場" : bus.stopsAway > 0 ? "\(Format.meters(bus.remainingM))・\(bus.stopsAway)停前" : Format.meters(bus.remainingM))
                    .font(.caption)
            }
            Image(systemName: "arrowtriangle.down.fill").font(.system(size: 10))
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 4)
        .background(focus ? Color.yellow.opacity(0.9) : Color.black.opacity(0.55), in: .rect(cornerRadius: 8))
        .foregroundStyle(focus ? .black : .white)
        .scaleEffect(0.8 + 0.4 * nearness)
    }
}

/// 画面の外のバス: 端に矢印と「左 40°」。
private struct EdgeArrow: View {
    @Environment(AppModel.self) private var model
    let entry: BoardEntry
    let left: Bool
    let deltaDeg: Double
    let focus: Bool

    var body: some View {
        HStack(spacing: 4) {
            if left { Image(systemName: "chevron.left") }
            VStack(alignment: left ? .leading : .trailing, spacing: 0) {
                Text("\(entry.scheduled.dep.route) \(Format.countdown(entry.expectedMs - model.nowMs))").bold()
                Text("\(left ? "左" : "右")\(Int(deltaDeg))° " + (entry.bus.map { $0.waiting ? "乗り場" : Format.meters($0.remainingM) } ?? ""))
                    .font(.caption2)
            }
            if !left { Image(systemName: "chevron.right") }
        }
        .font(.footnote)
        .padding(.horizontal, 8)
        .padding(.vertical, 4)
        .background(focus ? Color.yellow.opacity(0.9) : Color.black.opacity(0.55), in: .rect(cornerRadius: 8))
        .foregroundStyle(focus ? .black : .white)
    }
}

/// 下の発車案内。タップした便を強調する。
private struct BoardPanel: View {
    @Environment(AppModel.self) private var model
    @Binding var focusId: String?

    var body: some View {
        let board = model.board
        let multiple = (model.choice?.platforms.count ?? 0) > 1
        VStack(alignment: .leading, spacing: 0) {
            if board.isEmpty {
                Text("3時間以内の発車はありません（\(model.choice?.label ?? "")）").font(.callout).padding()
            }
            ForEach(board.prefix(5)) { e in
                let focused = e.id == (focusId ?? board.first(where: { $0.bus != nil })?.id)
                Button {
                    focusId = e.id
                } label: {
                    VStack(alignment: .leading, spacing: 2) {
                        HStack(alignment: .firstTextBaseline) {
                            if multiple { Text(model.platformName(e.scheduled.dep.platform)).font(.caption).foregroundStyle(.secondary) }
                            Text(e.scheduled.dep.route).bold()
                            Text(e.scheduled.dep.headsign).lineLimit(1)
                            Spacer()
                            Text(Service.clock(e.scheduled.atMs)).monospacedDigit().foregroundStyle(.secondary)
                        }
                        HStack {
                            Text(model.countdownText(e)).bold().monospacedDigit()
                            Text(model.busText(e)).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                        }
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 6)
                    .background(focused ? Color.yellow.opacity(0.25) : .clear)
                }
                .buttonStyle(.plain)
                Divider()
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(.regularMaterial)
    }
}
