// 距離と方位。TypeScript 版 src/core/geodesy.ts の LocalSphere と同じ計算
// （観測点で楕円体と長さの比を合わせた球。数 km の範囲では WGS84 とほぼ一致する）。

import Foundation

nonisolated struct LatLng: Sendable, Hashable {
    let lat: Double
    let lng: Double
}

nonisolated enum Geo {
    private static let a = 6_378_137.0
    private static let f = 1 / 298.257223563
    private static let e2 = f * (2 - f)

    static func rad(_ deg: Double) -> Double { deg * .pi / 180 }
    static func deg(_ rad: Double) -> Double { rad * 180 / .pi }

    /// 方位を [0, 360) に収める。
    static func normalize(_ deg: Double) -> Double {
        let wrapped = deg.truncatingRemainder(dividingBy: 360)
        return wrapped < 0 ? wrapped + 360 : wrapped
    }

    /// 方位の差を [-180, 180) に収める。
    static func wrapDelta(_ deg: Double) -> Double {
        normalize(deg + 180) - 180
    }

    /// from から見た to の地表距離（m）と真北基準の方位（度）。
    static func inverse(from: LatLng, to: LatLng) -> (distanceM: Double, azimuthDeg: Double) {
        let s = sin(rad(from.lat))
        let w = 1 - e2 * s * s
        let n = a / w.squareRoot()
        let m = a * (1 - e2) / (w * w.squareRoot())
        let lat0 = rad(from.lat)
        let lng0 = rad(from.lng)
        let lat2 = lat0 + (rad(to.lat) - lat0) * (m / n)
        let dLng = rad(to.lng) - lng0
        let dLat = lat2 - lat0
        let h = pow(sin(dLat / 2), 2) + cos(lat0) * cos(lat2) * pow(sin(dLng / 2), 2)
        let angle = 2 * asin(min(1, h.squareRoot()))
        let y = sin(dLng) * cos(lat2)
        let x = cos(lat0) * sin(lat2) - sin(lat0) * cos(lat2) * cos(dLng)
        return (angle * n, normalize(deg(atan2(y, x))))
    }

    static func distance(_ a: LatLng, _ b: LatLng) -> Double { inverse(from: a, to: b).distanceM }
}

nonisolated extension RtVehicle {
    var position: LatLng { LatLng(lat: lat, lng: lng) }
}

nonisolated extension PathStop {
    var position: LatLng { LatLng(lat: lat, lng: lng) }
}

nonisolated extension Platform {
    var position: LatLng { LatLng(lat: lat, lng: lng) }
}

nonisolated extension StopIndexEntry {
    var position: LatLng { LatLng(lat: lat, lng: lng) }
}
