// 中継（/stop, /rt）と停留所の索引の JSON の形。TypeScript 版の
// src/core/stopdata.ts・realtime.ts・stopindex.ts と同じ。
//
// 時刻は TypeScript 版に合わせて epoch ミリ秒の Double で持つ（テストで数値を突き合わせるため）。

import Foundation

nonisolated struct StopSource: Codable, Sendable, Hashable {
    let agency: String
    let feedVersion: String
    let fetchedDate: String
}

nonisolated struct StopInfo: Codable, Sendable, Hashable {
    let id: String
    let name: String
    let lat: Double
    let lng: Double
}

nonisolated struct Platform: Codable, Sendable, Hashable {
    let id: String
    /// 乗り場番号（GTFS の platform_code）。川崎市バスは空。
    let code: String
    let lat: Double
    let lng: Double
    /// 事業者をまとめたバス停のとき、この乗り場の事業者（「臨港」「市バス」）。
    let operatorName: String?

    enum CodingKeys: String, CodingKey {
        case id, code, lat, lng
        case operatorName = "operator"
    }
}

nonisolated struct ServiceRule: Codable, Sendable, Hashable {
    /// 月〜日の 7 要素。
    let days: [Bool]
    let start: String
    let end: String
    let added: [String]
    let removed: [String]
}

nonisolated struct Departure: Codable, Sendable, Hashable {
    /// 運行日の 0 時からの秒（24 時超えあり）。
    let t: Int
    let trip: String
    let route: String
    let headsign: String
    let platform: String
    let service: String
    let seq: Int
}

nonisolated struct Arrival: Codable, Sendable, Hashable {
    let t: Int
    let trip: String
    let route: String
    let platform: String
    let service: String
    let seq: Int
    let path: Int
}

nonisolated struct PathStop: Codable, Sendable, Hashable {
    let id: String
    let name: String
    let lat: Double
    let lng: Double
    let seq: Int
}

nonisolated struct ApproachPath: Codable, Sendable, Hashable {
    let stops: [PathStop]
}

nonisolated struct StopData: Codable, Sendable {
    let feed: String
    let source: StopSource
    let stop: StopInfo
    let platforms: [Platform]
    let services: [String: ServiceRule]
    let departures: [Departure]
    let arrivals: [Arrival]
    let paths: [ApproachPath]
}

nonisolated struct RtVehicle: Codable, Sendable, Hashable {
    let trip: String
    let vehicle: String
    let lat: Double
    let lng: Double
    let bearing: Double?
    let speedMps: Double?
    /// 位置の時刻（epoch 秒）。
    let ts: Double
    let stopId: String?
    let seq: Int?
    /// INCOMING_AT / STOPPED_AT / IN_TRANSIT_TO
    let status: String?
}

nonisolated struct RtStopTime: Codable, Sendable, Hashable {
    let stopId: String
    let seq: Int
    /// 到着（無ければ発車）の見込み（epoch 秒）。
    let t: Double
    let delay: Int?
}

nonisolated struct RtTripUpdate: Codable, Sendable, Hashable {
    let trip: String
    let vehicle: String?
    let ts: Double
    let stops: [RtStopTime]
}

nonisolated struct RtSnapshot: Codable, Sendable {
    let feedTs: Double
    let fetchedTs: Double
    let vehicles: [RtVehicle]
    let tripUpdates: [RtTripUpdate]
}

nonisolated struct StopIndexEntry: Codable, Sendable, Hashable, Identifiable {
    /// 「rinko:5010」。事業者をまとめたバス停は + でつなぐ（「kawasaki_city:94+rinko:10」）。
    let key: String
    let name: String
    let lat: Double
    let lng: Double
    let operators: [String]
    let routes: [String]

    var id: String { key }
}

nonisolated struct StopIndex: Codable, Sendable {
    let builtAt: String
    let sources: [String: StopSource]
    let stops: [StopIndexEntry]
}
