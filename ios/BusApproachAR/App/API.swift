// 中継（G2 版と同じ Lambda）との通信。
//
//   GET /stop?key=...  停留所の時刻表（その日に走る便だけ）
//   GET /rt?key=...    その停留所に関係する便の車両位置・予測
//
// 鍵（X-Bus-Key）は .ehpk と同じく秘密ではない目印。gzip は URLSession が自動で解く。

import Foundation

nonisolated struct API: Sendable {
    let base: String
    let key: String

    static let shared = API(
        base: (Bundle.main.object(forInfoDictionaryKey: "API_BASE") as? String ?? "").trimmingCharacters(in: .whitespaces),
        key: Bundle.main.object(forInfoDictionaryKey: "API_KEY") as? String ?? ""
    )

    var isConfigured: Bool { base.hasPrefix("http") }

    enum Failure: LocalizedError {
        case notConfigured
        case http(Int)

        var errorDescription: String? {
            switch self {
            case .notConfigured: "中継が未設定です"
            case .http(let status): "HTTP \(status)"
            }
        }
    }

    func stop(_ stopKey: String) async throws -> StopData {
        try await get("/stop", stopKey: stopKey)
    }

    func realtime(_ stopKey: String) async throws -> RtSnapshot {
        try await get("/rt", stopKey: stopKey)
    }

    private func get<T: Decodable>(_ path: String, stopKey: String) async throws -> T {
        guard isConfigured else { throw Failure.notConfigured }
        // URLComponents は + を符号化しないので自分で符号化する（まとめたバス停の鍵に + が入る）。
        let allowed = CharacterSet.alphanumerics.union(CharacterSet(charactersIn: "-._~"))
        let encoded = stopKey.addingPercentEncoding(withAllowedCharacters: allowed) ?? stopKey
        var request = URLRequest(url: URL(string: "\(base)\(path)?key=\(encoded)")!)
        request.setValue(key, forHTTPHeaderField: "X-Bus-Key")
        request.timeoutInterval = 15
        let (data, response) = try await URLSession.shared.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard status == 200 else { throw Failure.http(status) }
        return try JSONDecoder().decode(T.self, from: data)
    }
}
