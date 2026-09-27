// TypeScript 版（../src/core）と同じ入力から同じ発車案内が出るかを確かめる。
// 入力と正解は scripts/golden.sh が TypeScript 版で作る（Fixtures/, git に入れない）。

import Foundation
import Testing
@testable import BusApproachAR

private struct Scenario: Decodable {
    struct Expected: Decodable {
        let trip: String
        let scheduledMs: Double
        let expectedMs: Double
        let basis: String
        let vehicle: String?
        let remainingM: Double?
        let stopsAway: Int?
        let azimuthDeg: Double?
        let waiting: Bool?
    }
    struct Choice: Decodable {
        let id: String
        let label: String
        let platforms: [String]
    }
    let nowMs: Double
    let platforms: [String]?
    let stop: StopData
    let snapshot: RtSnapshot?
    let expected: [Expected]
    let choices: [Choice]
}

private func fixture<T: Decodable>(_ name: String, as: T.Type = T.self) throws -> T {
    let bundle = Bundle(for: BundleToken.self)
    let url = try #require(bundle.url(forResource: name, withExtension: "json", subdirectory: "Fixtures")
        ?? bundle.url(forResource: name, withExtension: "json"), "Fixtures/\(name).json が無い（ios/scripts/golden.sh）")
    return try JSONDecoder().decode(T.self, from: Data(contentsOf: url))
}

private final class BundleToken {}

struct GoldenTests {
    @Test(arguments: ["kawasaki", "daishibashi"])
    func boardMatchesTypeScript(_ name: String) throws {
        let s = try fixture(name, as: Scenario.self)
        let board = Board.build(s.stop, snapshot: s.snapshot, nowMs: s.nowMs, platforms: s.platforms.map(Set.init), limit: 20)
        #expect(board.count == s.expected.count)
        for (got, want) in zip(board, s.expected) {
            #expect(got.scheduled.dep.trip == want.trip)
            #expect(got.scheduled.atMs == want.scheduledMs)
            #expect(got.expectedMs == want.expectedMs, "\(want.trip)")
            #expect(got.basis.rawValue == want.basis, "\(want.trip)")
            #expect(got.bus?.vehicle.vehicle == want.vehicle, "\(want.trip)")
            #expect(got.bus?.stopsAway == want.stopsAway, "\(want.trip)")
            #expect(got.bus?.waiting == want.waiting, "\(want.trip)")
            if let a = got.bus?.remainingM, let b = want.remainingM { #expect(abs(a - b) < 0.01, "\(want.trip) \(a) vs \(b)") }
            if let a = got.bus?.azimuthDeg, let b = want.azimuthDeg { #expect(abs(a - b) < 1e-6, "\(want.trip)") }
        }
    }

    @Test(arguments: ["kawasaki", "daishibashi"])
    func platformChoicesMatchTypeScript(_ name: String) throws {
        let s = try fixture(name, as: Scenario.self)
        let got = Stops.platformChoices(s.stop)
        #expect(got.map(\.id) == s.choices.map(\.id))
        #expect(got.map(\.label) == s.choices.map(\.label))
        #expect(got.map { $0.platforms.sorted() } == s.choices.map(\.platforms))
    }

    @Test func daysMatchTypeScript() throws {
        struct Days: Decodable {
            struct Day: Decodable { let ms: Double; let ymd: String; let weekday: Int; let midnightMs: Double; let services: [String] }
            let services: [String: ServiceRule]
            let days: [Day]
        }
        let d = try fixture("days", as: Days.self)
        let data = StopData(feed: "rinko", source: StopSource(agency: "", feedVersion: "", fetchedDate: ""),
                            stop: StopInfo(id: "", name: "", lat: 0, lng: 0), platforms: [], services: d.services,
                            departures: [], arrivals: [], paths: [])
        for want in d.days {
            let got = Service.jstDay(want.ms)
            #expect(got.ymd == want.ymd)
            #expect(got.weekday == want.weekday)
            #expect(got.midnightMs == want.midnightMs)
            #expect(Service.activeServices(data, on: got).sorted() == want.services, "\(want.ymd)")
        }
    }

    @Test func geoMatchesTypeScript() throws {
        struct Pair: Decodable { let from: [Double]; let to: [Double]; let distanceM: Double; let azimuthDeg: Double }
        for p in try fixture("geo", as: [Pair].self) {
            let r = Geo.inverse(from: LatLng(lat: p.from[0], lng: p.from[1]), to: LatLng(lat: p.to[0], lng: p.to[1]))
            #expect(abs(r.distanceM - p.distanceM) < 1e-6)
            if p.distanceM > 0 { #expect(abs(r.azimuthDeg - p.azimuthDeg) < 1e-9) }
        }
    }

    @Test func clockAndFormat() {
        let ms = 1_790_000_000_000.0 // 2026-09-21T23:13:20+09:00（TypeScript 版の clock も 23:13）
        #expect(Service.clock(ms) == "23:13")
        #expect(Format.meters(523) == "520m")
        #expect(Format.meters(1234) == "1.2km")
        #expect(Format.countdown(30_000) == "まもなく")
        #expect(Format.countdown(4 * 60_000 + 5_000) == "あと4分")
    }
}
