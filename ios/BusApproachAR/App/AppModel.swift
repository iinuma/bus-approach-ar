// アプリの状態: 現在地、選んだバス停・乗り場、時刻表、リアルタイム、発車案内。

import CoreLocation
import Foundation
import Observation

@Observable
final class AppModel {
    /// 停留所の索引（川崎市バス・臨港バスの全停留所）。時刻表は選んだバス停のぶんを中継から取る。
    let index: StopIndex
    let api = API.shared

    // 現在地
    private(set) var location: LatLng?
    private(set) var locationAccuracyM: Double?
    /// 位置が取れないとき（シミュレータ等）の仮の現在地: 川崎駅東口。
    static let fallbackLocation = LatLng(lat: 35.5305, lng: 139.6985)

    // 選択
    private(set) var entry: StopIndexEntry?
    private(set) var stop: StopData?
    private(set) var stopError: String?
    private(set) var stopDay = ""
    var choice: PlatformChoice?

    // リアルタイム
    private(set) var snapshot: RtSnapshot?
    private(set) var rtError: String?
    private var lastPoll = Date.distantPast
    /// 取得間隔。フィードの更新は 20〜60 秒ごと、車両位置は 30〜130 秒前のもの（実測）。
    static let pollInterval: TimeInterval = 20

    /// 画面の時計（1 秒ごとに進める）。発車案内はこれを基準に作り直す。
    private(set) var now = Date()

    init() {
        let url = Bundle.main.url(forResource: "index", withExtension: "json")!
        index = try! JSONDecoder().decode(StopIndex.self, from: Data(contentsOf: url))
    }

    var nowMs: Double { now.timeIntervalSince1970 * 1000 }

    var board: [BoardEntry] {
        guard let stop, let choice else { return [] }
        return Board.build(stop, snapshot: snapshot, nowMs: nowMs, platforms: choice.platforms, limit: 8)
    }

    var choices: [PlatformChoice] { stop.map(Stops.platformChoices) ?? [] }

    func nearby(limit: Int = 30) -> [(entry: StopIndexEntry, distanceM: Double)] {
        Stops.nearby(index.stops, from: location ?? Self.fallbackLocation, limit: limit)
    }

    func search(_ text: String) -> [StopIndexEntry] {
        let query = text.trimmingCharacters(in: .whitespaces)
        guard !query.isEmpty else { return [] }
        let here = location ?? Self.fallbackLocation
        return index.stops.filter { $0.name.localizedStandardContains(query) }
            .sorted { Geo.distance(here, $0.position) < Geo.distance(here, $1.position) }
    }

    /// 方位の基準にする地点。乗り場の近く（300m 以内）にいれば現在地、そうでなければバス停。
    var observer: LatLng {
        let stopPosition = stop.map { LatLng(lat: $0.stop.lat, lng: $0.stop.lng) } ?? entry?.position ?? Self.fallbackLocation
        if let location, Geo.distance(location, stopPosition) < 300 { return location }
        return stopPosition
    }

    var usingOwnLocation: Bool {
        guard let location, let entry else { return false }
        return Geo.distance(location, entry.position) < 300
    }

    // MARK: - 操作

    func select(_ entry: StopIndexEntry) async {
        self.entry = entry
        stop = nil
        snapshot = nil
        choice = nil
        await loadStop()
    }

    func choose(_ choice: PlatformChoice) async {
        self.choice = choice
        saveSelection()
        await poll(force: true)
    }

    private func loadStop() async {
        guard let entry else { return }
        stopError = nil
        do {
            let data = try await api.stop(entry.key)
            guard self.entry?.key == entry.key else { return } // 取っている間に別のバス停が選ばれた
            stop = data
            stopDay = Service.jstDay(nowMs).ymd
        } catch {
            stopError = "時刻表の取得に失敗: \(error.localizedDescription)"
        }
    }

    func poll(force: Bool = false) async {
        guard let entry, force || Date().timeIntervalSince(lastPoll) >= Self.pollInterval else { return }
        lastPoll = Date()
        do {
            snapshot = try await api.realtime(entry.key)
            rtError = nil
        } catch {
            rtError = "RT取得失敗"
        }
    }

    /// 1 秒ごとに呼ぶ。日付が変わったら時刻表を取り直し、間隔が来たら RT を取る。
    func tick() async {
        now = Date()
        if stop != nil, Service.jstDay(nowMs).ymd != stopDay { await loadStop() }
        if choice != nil { await poll() }
    }

    // MARK: - 現在地

    func trackLocation() async {
        let session = CLServiceSession(authorization: .whenInUse)
        defer { withExtendedLifetime(session) {} }
        do {
            for try await update in CLLocationUpdate.liveUpdates() {
                if let loc = update.location {
                    location = LatLng(lat: loc.coordinate.latitude, lng: loc.coordinate.longitude)
                    locationAccuracyM = loc.horizontalAccuracy
                }
            }
        } catch {
            // 位置が取れなくても、仮の現在地（川崎駅）で動く
        }
    }

    // MARK: - 前回の選択

    private func saveSelection() {
        guard let entry, let choice else { return }
        UserDefaults.standard.set(entry.key, forKey: "stopKey")
        UserDefaults.standard.set(choice.id, forKey: "choiceId")
    }

    /// 前回のバス停・乗り場で再開する。
    func resume() async -> Bool {
        guard let key = UserDefaults.standard.string(forKey: "stopKey"),
              let choiceId = UserDefaults.standard.string(forKey: "choiceId"),
              let saved = index.stops.first(where: { $0.key == key }) else { return false }
        await select(saved)
        guard let found = choices.first(where: { $0.id == choiceId }) else { return false }
        await choose(found)
        return true
    }

    // MARK: - 表示用

    func platformName(_ platformId: String) -> String {
        guard let p = stop?.platforms.first(where: { $0.id == platformId }) else { return "" }
        let text = (p.operatorName ?? "") + (p.code.isEmpty ? "" : "\(p.code)番")
        return text.isEmpty ? "乗り場" : text
    }

    /// バスの位置の説明。根拠（待機・RT・推定・時刻表のみ）が分かるようにする。
    func busText(_ e: BoardEntry) -> String {
        guard let bus = e.bus else { return "車両未確認・時刻表の予定" }
        if bus.waiting { return e.basis == .inbound ? "到着済み・折返し推定" : "乗り場で待機中" }
        let where_ = bus.stopsAway > 0 ? "\(Format.meters(bus.remainingM))・\(bus.stopsAway)停前" : "乗り場まで\(Format.meters(bus.remainingM))"
        return e.basis == .inbound ? "\(where_)・折返し推定" : "\(where_)・接近中"
    }

    func countdownText(_ e: BoardEntry) -> String {
        let late = Int(((e.expectedMs - e.scheduled.atMs) / 60_000).rounded())
        return Format.countdown(e.expectedMs - nowMs) + (late > 0 ? "（+\(late)分）" : "")
    }

    var rtAgeText: String {
        if let rtError { return rtError }
        guard let snapshot else { return api.isConfigured ? "RT取得中" : "中継が未設定" }
        return "更新\(Format.age(now.timeIntervalSince1970 - snapshot.feedTs))"
    }
}
