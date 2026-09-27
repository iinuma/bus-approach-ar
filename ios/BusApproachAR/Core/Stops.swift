// 停留所と乗り場の選択肢、表示用の書式。TypeScript 版 src/core/stops.ts・format.ts と同じ。

import Foundation

nonisolated struct PlatformChoice: Sendable, Hashable, Identifiable {
    let id: String
    /// 「臨港 1番 川21 水江町」「市バス 川04 市営埠頭(台町)」
    let label: String
    let platforms: Set<String>
}

nonisolated enum Stops {
    static func platformChoices(_ data: StopData) -> [PlatformChoice] {
        // 発車の無い標柱（降車専用）は出さない。事業者 → 乗り場番号（数の順）で並べる。
        let boarding = data.platforms
            .filter { p in data.departures.contains { $0.platform == p.id } }
            .sorted { a, b in
                let oa = a.operatorName ?? "", ob = b.operatorName ?? ""
                if oa != ob { return jsLess(oa, ob) }
                let ca = Int(a.code) ?? 999, cb = Int(b.code) ?? 999
                if ca != cb { return ca < cb }
                return jsLess(a.id, b.id)
            }
        var choices = boarding.map { p -> PlatformChoice in
            // 系統ごとに最頻の行先を出す（同じ行先の数が同じなら先に出てきた方）。
            var order: [String] = []
            var counts: [String: [(String, Int)]] = [:]
            for d in data.departures where d.platform == p.id {
                if counts[d.route] == nil { order.append(d.route); counts[d.route] = [] }
                if let i = counts[d.route]!.firstIndex(where: { $0.0 == d.headsign }) {
                    counts[d.route]![i].1 += 1
                } else {
                    counts[d.route]!.append((d.headsign, 1))
                }
            }
            let parts = order.map { route -> String in
                let list = counts[route]!
                let best = list.enumerated().max { ($0.element.1, -$0.offset) < ($1.element.1, -$1.offset) }!.element.0
                return "\(route) \(best)"
            }
            let prefix = (p.operatorName.map { "\($0) " } ?? "") + (p.code.isEmpty ? "" : "\(p.code)番 ")
            return PlatformChoice(id: p.id, label: prefix + parts.joined(separator: " / "), platforms: [p.id])
        }
        // 全乗り場は先頭に置く。川崎駅は 25 乗り場あり、末尾だとスクロールしないと選べない。
        if choices.count > 1 {
            choices.insert(PlatformChoice(id: "all", label: "全乗り場", platforms: Set(boarding.map(\.id))), at: 0)
        }
        return choices
    }

    /// JavaScript の localeCompare に近い比較（ここで比べるのは ASCII の ID と「臨港」「市バス」だけ）。
    private static func jsLess(_ a: String, _ b: String) -> Bool {
        a.compare(b, options: [], range: nil, locale: Locale(identifier: "ja_JP")) == .orderedAscending
    }

    /// 近い順に limit 件。
    static func nearby(_ stops: [StopIndexEntry], from location: LatLng, limit: Int = 20) -> [(entry: StopIndexEntry, distanceM: Double)] {
        stops.map { ($0, Geo.distance(location, $0.position)) }
            .sorted { $0.1 < $1.1 }
            .prefix(limit)
            .map { (entry: $0.0, distanceM: $0.1) }
    }
}

nonisolated enum Format {
    static func meters(_ m: Double) -> String {
        m < 1000 ? "\(Int((m / 10).rounded()) * 10)m" : String(format: "%.1fkm", m / 1000)
    }

    /// 「あと4分」「まもなく」「発車時刻」。
    static func countdown(_ ms: Double) -> String {
        if ms <= 0 { return "発車時刻" }
        let min = Int(floor(ms / 60_000))
        return min < 1 ? "まもなく" : "あと\(min)分"
    }

    /// 「12秒前」「3分前」。
    static func age(_ seconds: Double) -> String {
        let s = max(0, Int(seconds.rounded()))
        return s < 90 ? "\(s)秒前" : "\(Int((Double(s) / 60).rounded()))分前"
    }
}
