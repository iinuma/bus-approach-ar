// 発車案内（時刻表 + リアルタイム）。TypeScript 版 src/core/board.ts と同じ。
//
// 時刻の根拠を区別する:
//   schedule  時刻表の予定だけ
//   realtime  発車便そのものが RT に出ている（車両が乗り場にいる／向かっている）
//   inbound   折り返してくるはずの到着便の位置から推定

import Foundation

nonisolated enum Basis: String, Sendable, Codable {
    case schedule, realtime, inbound
}

nonisolated struct BusPosition: Sendable, Hashable {
    let vehicle: RtVehicle
    /// 乗り場までの、経路に沿った残り距離（m）。乗り場にいれば 0。
    let remainingM: Double
    /// 乗り場までに停まる停留所の数（乗り場を含まない）。
    let stopsAway: Int
    /// 乗り場から見た車両の方位・直線距離。
    let azimuthDeg: Double
    let straightM: Double
    /// 乗り場（または降車場）で停まっている。
    let waiting: Bool
    var inboundArrivalMs: Double?
}

nonisolated struct BoardEntry: Sendable, Hashable, Identifiable {
    let scheduled: ScheduledDeparture
    /// 発車見込み。根拠が schedule なら予定と同じ。
    let expectedMs: Double
    let basis: Basis
    let bus: BusPosition?

    var id: String { "\(scheduled.dep.trip)@\(scheduled.atMs)" }
}

nonisolated enum Board {
    /// これより古い車両位置は使わない（川崎市バスのフィードに 8 時間前の位置が混ざっていた）。
    static let staleVehicleS = 300.0
    /// 折り返しに最低限かかる時間。
    static let minLayoverMs = 60_000.0

    static func build(_ data: StopData, snapshot: RtSnapshot?, nowMs: Double, platforms: Set<String>? = nil, limit: Int = 6) -> [BoardEntry] {
        let scheduled = Service.upcomingDepartures(data, nowMs: nowMs, platforms: platforms, graceMs: 5 * 60_000)
        let fresh = snapshot.map { withoutStale($0, nowMs: nowMs) }
        let vehicleByTrip = Dictionary(fresh?.vehicles.map { ($0.trip, $0) } ?? [], uniquingKeysWith: { _, last in last })
        let updateByTrip = Dictionary(fresh?.tripUpdates.map { ($0.trip, $0) } ?? [], uniquingKeysWith: { _, last in last })
        let inbound = fresh.map { inboundBuses(data, snapshot: $0, nowMs: nowMs) } ?? []
        var used = Set<String>()
        var out: [BoardEntry] = []

        for s in scheduled {
            if let vehicle = vehicleByTrip[s.dep.trip] {
                // 発車便の車両が乗り場より先の停留所へ向かっていたら、もう出た。
                if let seq = vehicle.seq, seq > s.dep.seq { continue }
                used.insert(vehicle.vehicle)
                let here = updateByTrip[s.dep.trip]?.stops.first { $0.stopId == s.dep.platform }
                let expected = (here.map { $0.t > 0 ? $0.t * 1000 : s.atMs }) ?? s.atMs
                out.append(BoardEntry(scheduled: s, expectedMs: max(expected, s.atMs), basis: .realtime,
                                      bus: positionAtPlatform(data, platformId: s.dep.platform, vehicle: vehicle)))
            } else {
                if s.atMs < nowMs { continue } // 予定を過ぎて RT にも無い便は出たものとみなす
                // 同じ乗り場に着く車両を優先し、無ければ同じ停留所の別の乗り場（降車場）に着く同じ系統の車両。
                let free = inbound.filter { !used.contains($0.bus.vehicle.vehicle) && $0.arrival.route == s.dep.route }
                if let candidate = free.first(where: { $0.arrival.platform == s.dep.platform }) ?? free.first,
                   candidate.arrivalMs <= s.atMs + 30 * 60_000 {
                    used.insert(candidate.bus.vehicle.vehicle)
                    out.append(BoardEntry(scheduled: s, expectedMs: max(s.atMs, candidate.arrivalMs + minLayoverMs), basis: .inbound, bus: candidate.bus))
                } else {
                    out.append(BoardEntry(scheduled: s, expectedMs: s.atMs, basis: .schedule, bus: nil))
                }
            }
            if out.count >= limit { break }
        }
        return out
    }

    static func withoutStale(_ snapshot: RtSnapshot, nowMs: Double) -> RtSnapshot {
        let limit = nowMs / 1000 - staleVehicleS
        return RtSnapshot(feedTs: snapshot.feedTs, fetchedTs: snapshot.fetchedTs,
                          vehicles: snapshot.vehicles.filter { $0.ts >= limit }, tripUpdates: snapshot.tripUpdates)
    }

    struct InboundBus: Sendable {
        let arrival: Arrival
        let arrivalMs: Double
        let bus: BusPosition
    }

    /// この停留所へ向かっている到着便の車両。到着見込みの早い順。
    static func inboundBuses(_ data: StopData, snapshot: RtSnapshot, nowMs: Double) -> [InboundBus] {
        let updateByTrip = Dictionary(snapshot.tripUpdates.map { ($0.trip, $0) }, uniquingKeysWith: { _, last in last })
        let today = Service.jstDay(nowMs)
        let yesterday = Service.jstDay(today.midnightMs - Service.dayMs)
        let services = [(today, Service.activeServices(data, on: today)), (yesterday, Service.activeServices(data, on: yesterday))]
        // 循環系統は同じ停留所を 2 回通る。便ごとに到着を並べておき、車両より先にある次の到着を使う。
        let arrivalsByTrip = Dictionary(grouping: data.arrivals, by: \.trip)
        var out: [(InboundBus, Int)] = []
        for (index, vehicle) in snapshot.vehicles.enumerated() {
            let ahead = (arrivalsByTrip[vehicle.trip] ?? []).filter { vehicle.seq == nil || $0.seq >= vehicle.seq! }
            guard let arrival = ahead.min(by: { $0.seq < $1.seq }) else { continue }
            guard let day = services.first(where: { $0.1.contains(arrival.service) })?.0 else { continue }
            var bus = positionOnPath(data.paths[arrival.path], arrival: arrival, vehicle: vehicle)
            let update = updateByTrip[vehicle.trip]
            let here = update?.stops.first { $0.stopId == arrival.platform }
            let scheduledMs = day.midnightMs + Double(arrival.t) * 1000
            // 終点の到着予測は遅れが 0 に戻っていることが多いので、途中の遅れを足した値と大きい方をとる。
            let lastDelay = update?.stops.first { $0.delay != nil }?.delay ?? 0
            let predicted = here.map { $0.t > 0 ? $0.t * 1000 : scheduledMs } ?? scheduledMs
            let arrivalMs = max(predicted, scheduledMs + Double(lastDelay) * 1000)
            bus.inboundArrivalMs = arrivalMs
            out.append((InboundBus(arrival: arrival, arrivalMs: arrivalMs, bus: bus), index))
        }
        // TypeScript の sort は安定。同じ見込みなら入った順。
        return out.sorted { ($0.0.arrivalMs, $0.1) < ($1.0.arrivalMs, $1.1) }.map(\.0)
    }

    /// 発車便の車両。乗り場にいれば 0m、まだ来ていなければ直線距離で代用する。
    static func positionAtPlatform(_ data: StopData, platformId: String, vehicle: RtVehicle) -> BusPosition {
        let origin = data.platforms.first { $0.id == platformId }?.position ?? LatLng(lat: data.stop.lat, lng: data.stop.lng)
        let (distance, azimuth) = Geo.inverse(from: origin, to: vehicle.position)
        let waiting = vehicle.stopId == platformId && vehicle.status == "STOPPED_AT"
        return BusPosition(vehicle: vehicle, remainingM: waiting ? 0 : distance, stopsAway: 0, azimuthDeg: azimuth,
                           straightM: distance, waiting: waiting, inboundArrivalMs: nil)
    }

    /// 到着便の車両を、手前の停留所を結んだ折れ線に載せて残り距離を出す。
    static func positionOnPath(_ path: ApproachPath, arrival: Arrival, vehicle: RtVehicle) -> BusPosition {
        let stops = path.stops
        let end = stops[stops.count - 1]
        let (straight, azimuth) = Geo.inverse(from: end.position, to: vehicle.position)
        let nextIndex = vehicle.seq.flatMap { seq in stops.firstIndex { $0.seq == seq } }
        var remaining: Double
        var stopsAway: Int
        if let nextIndex {
            remaining = Geo.distance(stops[nextIndex].position, vehicle.position)
            for i in nextIndex..<(stops.count - 1) { remaining += Geo.distance(stops[i].position, stops[i + 1].position) }
            stopsAway = stops.count - 1 - nextIndex
        } else {
            // 折れ線より手前にいる。先頭までの直線 + 折れ線全体で近似する。
            remaining = Geo.distance(stops[0].position, vehicle.position)
            for i in 0..<(stops.count - 1) { remaining += Geo.distance(stops[i].position, stops[i + 1].position) }
            stopsAway = arrival.seq - (vehicle.seq ?? arrival.seq)
        }
        let waiting = vehicle.stopId == arrival.platform && vehicle.status == "STOPPED_AT"
        return BusPosition(vehicle: vehicle, remainingM: waiting ? 0 : remaining, stopsAway: max(0, stopsAway), azimuthDeg: azimuth,
                           straightM: straight, waiting: waiting, inboundArrivalMs: nil)
    }
}
