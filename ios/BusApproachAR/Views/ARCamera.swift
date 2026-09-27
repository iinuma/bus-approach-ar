// カメラ映像と、バスの方向を画面に投影する計算。
//
// ARKit の worldAlignment = .gravityAndHeading を使う。世界座標は +x が東、+y が上、+z が南
// （-z が北）に揃うので、「方位 az・距離 d の地点」は (d·sin az, -目の高さ, -d·cos az) に置ける。
// ARKit が端末の傾き・向きを追うので、振ってもラベルが安定する。ただし北の合わせ込みは
// コンパスが基準なので、街中では 10〜20° ずれうる（鉄骨の建物・車両の近くではさらに）。
//
// 距離は画面上の大きさ・高さにだけ効かせ、遠いバスは 400m に置く（方向だけが正しければよい）。
// G2 版は頭の向きが取れないので「右 60°」の道路モデルにしたが、iPhone は実際の方位に出せる。

import ARKit
import RealityKit
import SwiftUI

/// ARView を SwiftUI から触るための入れ物。投影はここから行う。
final class ARSessionHolder {
    let view: ARView
    let supported = ARWorldTrackingConfiguration.isSupported

    init() {
        view = ARView(frame: .zero, cameraMode: .ar, automaticallyConfigureSession: false)
        view.renderOptions.insert(.disableMotionBlur)
    }

    func start() {
        guard supported else { return }
        let config = ARWorldTrackingConfiguration()
        config.worldAlignment = .gravityAndHeading
        view.session.run(config, options: [.resetTracking, .removeExistingAnchors])
    }

    func pause() {
        guard supported else { return }
        view.session.pause()
    }

    /// 端末（カメラ）の位置と、画面中央の方位（真北基準, 度）・仰角。
    var camera: (position: SIMD3<Float>, headingDeg: Double, pitchDeg: Double)? {
        guard supported, let frame = view.session.currentFrame, frame.camera.trackingState != .notAvailable else { return nil }
        let t = view.cameraTransform.matrix
        let forward = -SIMD3<Float>(t.columns.2.x, t.columns.2.y, t.columns.2.z)
        let heading = Geo.normalize(Geo.deg(Double(atan2(forward.x, -forward.z))))
        let pitch = Geo.deg(Double(asin(max(-1, min(1, forward.y)))))
        return (SIMD3(t.columns.3.x, t.columns.3.y, t.columns.3.z), heading, pitch)
    }

    var trackingNote: String? {
        guard supported, let frame = view.session.currentFrame else { return nil }
        switch frame.camera.trackingState {
        case .normal: return nil
        case .notAvailable: return "カメラ準備中"
        case .limited(let reason):
            switch reason {
            case .initializing, .relocalizing: return "向きを合わせています"
            case .excessiveMotion: return "ゆっくり動かしてください"
            case .insufficientFeatures: return "周りが暗い・単調です"
            @unknown default: return "追跡が不安定"
            }
        }
    }
}

struct ARCameraView: UIViewRepresentable {
    let holder: ARSessionHolder

    func makeUIView(context: Context) -> ARView { holder.view }
    func updateUIView(_ uiView: ARView, context: Context) {}
}

/// 画面上の位置。
struct Projected {
    enum Place {
        case onScreen(CGPoint)
        /// 画面の外。左右どちらへ何度回せば入るか。
        case offScreen(left: Bool, deltaDeg: Double)
    }
    let place: Place
    /// 0（遠い）〜 1（近い）。ラベルの大きさに使う。
    let nearness: Double
}

enum Projector {
    /// 目の高さ（m）。近いバスほど地平線より下に見える。
    static let eyeHeightM: Float = 1.4
    static let maxPlacementM = 400.0
    static let minPlacementM = 8.0

    static func nearness(_ distanceM: Double) -> Double {
        let d = min(max(distanceM, 20), 3000)
        return 1 - log(d / 20) / log(3000 / 20)
    }

    /// ARKit で投影する。
    static func project(azimuthDeg: Double, distanceM: Double, holder: ARSessionHolder, size: CGSize) -> Projected? {
        guard let camera = holder.camera else { return nil }
        let d = Float(min(max(distanceM, minPlacementM), maxPlacementM))
        let az = Float(Geo.rad(azimuthDeg))
        let world = camera.position + SIMD3<Float>(d * sin(az), -eyeHeightM, -d * cos(az))
        let delta = Geo.wrapDelta(azimuthDeg - camera.headingDeg)
        let near = nearness(distanceM)
        // 背中側（±90° 超）は投影すると反対側に出るので、先に画面外として扱う。
        if abs(delta) < 80, let point = holder.view.project(world),
           point.x >= 0, point.x <= size.width, point.y >= 0, point.y <= size.height {
            return Projected(place: .onScreen(point), nearness: near)
        }
        return Projected(place: .offScreen(left: delta < 0, deltaDeg: abs(delta)), nearness: near)
    }

    /// ARKit が使えないとき（シミュレータ）の投影。方位は手で回し、端末は水平に構えているとみなす。
    static func projectManual(azimuthDeg: Double, distanceM: Double, headingDeg: Double, hfovDeg: Double, size: CGSize) -> Projected {
        let delta = Geo.wrapDelta(azimuthDeg - headingDeg)
        let near = nearness(distanceM)
        let f = (size.width / 2) / tan(Geo.rad(hfovDeg / 2))
        guard abs(delta) < hfovDeg / 2 else { return Projected(place: .offScreen(left: delta < 0, deltaDeg: abs(delta)), nearness: near) }
        let d = min(max(distanceM, minPlacementM), maxPlacementM)
        let x = size.width / 2 + tan(Geo.rad(delta)) * f
        let y = size.height / 2 + (Double(eyeHeightM) / d) * f
        return Projected(place: .onScreen(CGPoint(x: x, y: y)), nearness: near)
    }
}
