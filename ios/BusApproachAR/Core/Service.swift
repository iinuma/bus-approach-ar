// 運行日と時刻。TypeScript 版 src/core/service.ts と同じ。
//
// 祝日・年末年始の入れ替えは calendar_dates に入っている（中継が配る services）ので、
// 祝日の計算はしない。時刻はすべて日本時間。GTFS の時刻は運行日の 0 時からの秒で、24 時を超える。

import Foundation

nonisolated struct JstDay: Sendable, Hashable {
    /// YYYYMMDD
    let ymd: String
    /// 月曜 = 0 … 日曜 = 6
    let weekday: Int
    /// この日の 0 時（日本時間）の epoch ms。
    let midnightMs: Double
}

nonisolated struct ScheduledDeparture: Sendable, Hashable {
    let dep: Departure
    /// 予定発車時刻（epoch ms）。
    let atMs: Double
}

nonisolated enum Service {
    static let jstOffsetMs = 9.0 * 3600 * 1000
    static let dayMs = 24.0 * 3600 * 1000

    static func jstDay(_ epochMs: Double) -> JstDay {
        let days = Int(floor((epochMs + jstOffsetMs) / dayMs))
        let (y, m, d) = civil(fromDays: days)
        // 1970-01-01 は木曜。月曜 = 0 にする。
        let weekday = ((days % 7) + 7 + 3) % 7
        return JstDay(
            ymd: String(format: "%04d%02d%02d", y, m, d),
            weekday: weekday,
            midnightMs: Double(days) * dayMs - jstOffsetMs
        )
    }

    /// 1970-01-01 からの日数 → 年月日（Howard Hinnant の days_from_civil の逆）。
    private static func civil(fromDays z0: Int) -> (Int, Int, Int) {
        let z = z0 + 719_468
        let era = (z >= 0 ? z : z - 146_096) / 146_097
        let doe = z - era * 146_097
        let yoe = (doe - doe / 1460 + doe / 36524 - doe / 146_096) / 365
        let doy = doe - (365 * yoe + yoe / 4 - yoe / 100)
        let mp = (5 * doy + 2) / 153
        let d = doy - (153 * mp + 2) / 5 + 1
        let m = mp < 10 ? mp + 3 : mp - 9
        return (yoe + era * 400 + (m <= 2 ? 1 : 0), m, d)
    }

    static func runs(_ rule: ServiceRule, on day: JstDay) -> Bool {
        if rule.removed.contains(day.ymd) { return false }
        if rule.added.contains(day.ymd) { return true }
        return day.ymd >= rule.start && day.ymd <= rule.end && rule.days[day.weekday]
    }

    static func activeServices(_ data: StopData, on day: JstDay) -> Set<String> {
        Set(data.services.filter { runs($0.value, on: day) }.map(\.key))
    }

    /// nowMs 以降の予定の発車便を時刻順に返す。前日の運行日の 24 時超えの便も含める。
    static func upcomingDepartures(
        _ data: StopData, nowMs: Double, platforms: Set<String>? = nil,
        horizonMs: Double = 3 * 3600 * 1000, graceMs: Double = 0
    ) -> [ScheduledDeparture] {
        let today = jstDay(nowMs)
        let days = [jstDay(today.midnightMs - dayMs), today, jstDay(today.midnightMs + dayMs)]
        var out: [ScheduledDeparture] = []
        for day in days {
            let services = activeServices(data, on: day)
            for dep in data.departures {
                guard services.contains(dep.service) else { continue }
                if let platforms, !platforms.contains(dep.platform) { continue }
                let atMs = day.midnightMs + Double(dep.t) * 1000
                if atMs >= nowMs - graceMs && atMs <= nowMs + horizonMs {
                    out.append(ScheduledDeparture(dep: dep, atMs: atMs))
                }
            }
        }
        // TypeScript の sort は安定なので、同時刻は入った順のまま（テストで順番まで突き合わせる）。
        return out.enumerated().sorted { ($0.element.atMs, $0.offset) < ($1.element.atMs, $1.offset) }.map(\.element)
    }

    /// 「06:56」。24 時超えも日本時間の時計の表記にする。
    static func clock(_ epochMs: Double) -> String {
        let secondsOfDay = Int(floor((epochMs + jstOffsetMs) / 1000)) % 86_400
        let s = secondsOfDay < 0 ? secondsOfDay + 86_400 : secondsOfDay
        return String(format: "%02d:%02d", s / 3600, (s / 60) % 60)
    }
}
