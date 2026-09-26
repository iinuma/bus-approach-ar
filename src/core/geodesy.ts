/*
 * G2PeakView（~/Developer/G2PeakView/src/core/geodesy.ts, 2026-09-26 時点）から複製。
 * 元のリポジトリは変更していない。
 */

/**
 * 測地計算。山の方位・距離・見かけの仰角を出す。
 *
 * 角度の単位は**関数名と引数名で明示する**（Deg / Rad）。内部の三角関数は
 * ラジアンで行い、外に出す値は度に揃える。単位を取り違えると北が 57 倍ずれる。
 *
 * 地球の形は 2 通り使い分ける。
 *
 * - **観測点に合わせた球**: 山稜の走査用。1 方位あたり数千点を打つので軽さが要る。
 *   地理緯度をそのまま球の緯度にすると、楕円体の南北と東西の曲率半径の比
 *   （日本付近で約 0.45%）のぶん斜めの方位が狂う（高尾山→富士山で 0.11°）。
 *   そこで緯度差を M/N 倍に縮めてから半径 N の球に載せる。観測点のまわりで
 *   楕円体と長さの比が一致するので、150km 先まで WGS84 の ECEF→ENU と
 *   方位・仰角とも 0.02° 以内で合う（test/geodesy.test.ts）。
 * - **WGS84 楕円体の ECEF→ENU**: 上の近似が正しいかを確かめる基準。
 *
 * 高さはどちらも**標高（ジオイド高を含まない）をそのまま楕円体高として扱う**。
 * 観測点も山も DEM／山頂データの標高で揃えているので、ジオイド高（日本で
 * 30〜40m）はほぼ打ち消し合う。GPS の楕円体高を DEM の標高から直接引く、
 * ということだけはしない（Observer.altitudeDatum を見よ）。
 *
 * 大気差（光の屈折）は既定で補正しない（refraction = 0）。晴れた日の遠望は
 * 実際にはやや持ち上がって見える。0.13 前後が標準的な係数。
 */

export interface LatLng {
  lat: number;
  lng: number;
}

const WGS84_A = 6378137;
const WGS84_F = 1 / 298.257223563;
const WGS84_E2 = WGS84_F * (2 - WGS84_F);

export const toRad = (deg: number): number => (deg * Math.PI) / 180;
export const toDeg = (rad: number): number => (rad * 180) / Math.PI;

/** 方位を [0, 360) に収める。 */
export function normalizeDeg(deg: number): number {
  const wrapped = deg % 360;
  return wrapped < 0 ? wrapped + 360 : wrapped;
}

/** 方位の差を [-180, 180) に収める。北をまたいでも最短側の差になる。 */
export function wrapDeltaDeg(deg: number): number {
  return normalizeDeg(deg + 180) - 180;
}

/** 緯度 lat での子午線曲率半径 M と卯酉線曲率半径 N（メートル）。 */
export function radiiOfCurvature(latDeg: number): { m: number; n: number } {
  const s = Math.sin(toRad(latDeg));
  const w = 1 - WGS84_E2 * s * s;
  return { n: WGS84_A / Math.sqrt(w), m: (WGS84_A * (1 - WGS84_E2)) / (w * Math.sqrt(w)) };
}

/**
 * 観測点に張り付いた球。
 *
 * 地理緯度 φ を球の緯度 φ' = φ0 + (φ − φ0)·M/N に写し、半径 N の球として扱う。
 * 観測点での南北・東西の長さの比が楕円体と一致する。経線の収束（遠方の東西で
 * 方位が曲がる効果）は球の幾何がそのまま受け持つ。
 *
 * 1 回の山稜計算の中では同じ球を使い回す。球を途中で取り替えると、
 * 距離と方位の整合が崩れる。
 */
export class LocalSphere {
  readonly origin: LatLng;
  readonly radiusM: number;
  private readonly lat0: number;
  private readonly lng0: number;
  private readonly sinLat0: number;
  private readonly cosLat0: number;
  /** M/N。緯度差をこの比で縮める。 */
  private readonly latScale: number;

  constructor(origin: LatLng) {
    this.origin = origin;
    const { m, n } = radiiOfCurvature(origin.lat);
    this.radiusM = n;
    this.latScale = m / n;
    this.lat0 = toRad(origin.lat);
    this.lng0 = toRad(origin.lng);
    this.sinLat0 = Math.sin(this.lat0);
    this.cosLat0 = Math.cos(this.lat0);
  }

  /** 観測点から見た地表距離（m）と真北基準の方位（度, [0,360)）。 */
  inverse(to: LatLng): { distanceM: number; azimuthDeg: number } {
    const lat2 = this.lat0 + (toRad(to.lat) - this.lat0) * this.latScale;
    const dLng = toRad(to.lng) - this.lng0;
    const sinLat2 = Math.sin(lat2);
    const cosLat2 = Math.cos(lat2);

    const dLat = lat2 - this.lat0;
    const h =
      Math.sin(dLat / 2) ** 2 + this.cosLat0 * cosLat2 * Math.sin(dLng / 2) ** 2;
    const angle = 2 * Math.asin(Math.min(1, Math.sqrt(h)));

    const y = Math.sin(dLng) * cosLat2;
    const x = this.cosLat0 * sinLat2 - this.sinLat0 * cosLat2 * Math.cos(dLng);
    return {
      distanceM: angle * this.radiusM,
      azimuthDeg: normalizeDeg(toDeg(Math.atan2(y, x))),
    };
  }

  /**
   * 方位 azimuth に沿って地表距離 distance 進んだ点。
   *
   * 走査では同じ方位で何千回も呼ぶので、方位の sin/cos は呼び出し側で
   * 前計算して渡せるようにしてある（{@link rayFrom}）。
   */
  destination(azimuthDeg: number, distanceM: number): LatLng {
    return this.rayFrom(azimuthDeg).at(distanceM);
  }

  rayFrom(azimuthDeg: number): { at(distanceM: number): LatLng } {
    const az = toRad(azimuthDeg);
    const sinAz = Math.sin(az);
    const cosAz = Math.cos(az);
    const { sinLat0, cosLat0, lat0, lng0, radiusM, latScale } = this;
    return {
      at(distanceM: number): LatLng {
        const d = distanceM / radiusM;
        const sinD = Math.sin(d);
        const cosD = Math.cos(d);
        const sinLat = sinLat0 * cosD + cosLat0 * sinD * cosAz;
        const sphereLat = Math.asin(sinLat);
        const lng = lng0 + Math.atan2(sinAz * sinD * cosLat0, cosD - sinLat0 * sinLat);
        return { lat: toDeg(lat0 + (sphereLat - lat0) / latScale), lng: toDeg(lng) };
      },
    };
  }

  /**
   * 高さ h0 の観測点から、地表距離 distance・高さ h の点を見上げる角（度）。
   *
   * 球の上での厳密式。平面近似 atan2(Δh, d) との差が地球曲率の効果で、
   * 100km 先ではおよそ 0.45° 低く見える。
   *
   * refraction は大気差の係数 k。実効半径 R/(1-k) の球として扱う。
   */
  elevationAngleDeg(
    observerHeightM: number,
    distanceM: number,
    targetHeightM: number,
    refraction = 0,
  ): number {
    return toDeg(elevationAngleRad(this.radiusM / (1 - refraction), observerHeightM, distanceM, targetHeightM));
  }
}

/** {@link LocalSphere.elevationAngleDeg} の中身。走査の内側ループから直接呼ぶ。 */
export function elevationAngleRad(
  radiusM: number,
  observerHeightM: number,
  distanceM: number,
  targetHeightM: number,
): number {
  const theta = distanceM / radiusM;
  const r = radiusM + targetHeightM;
  const up = r * Math.cos(theta) - (radiusM + observerHeightM);
  const horizontal = r * Math.sin(theta);
  return Math.atan2(up, horizontal);
}

/* ---------- WGS84 楕円体（検証用の基準） ---------- */

export interface Ecef {
  x: number;
  y: number;
  z: number;
}

export function toEcef(point: LatLng, heightM: number): Ecef {
  const lat = toRad(point.lat);
  const lng = toRad(point.lng);
  const sinLat = Math.sin(lat);
  const n = WGS84_A / Math.sqrt(1 - WGS84_E2 * sinLat * sinLat);
  return {
    x: (n + heightM) * Math.cos(lat) * Math.cos(lng),
    y: (n + heightM) * Math.cos(lat) * Math.sin(lng),
    z: (n * (1 - WGS84_E2) + heightM) * sinLat,
  };
}

/** 観測点の ENU（東・北・上）座標系で見た目標の方位・仰角。 */
export function lookAngleWgs84(
  observer: LatLng,
  observerHeightM: number,
  target: LatLng,
  targetHeightM: number,
): { azimuthDeg: number; elevationDeg: number; rangeM: number } {
  const o = toEcef(observer, observerHeightM);
  const t = toEcef(target, targetHeightM);
  const dx = t.x - o.x;
  const dy = t.y - o.y;
  const dz = t.z - o.z;

  const lat = toRad(observer.lat);
  const lng = toRad(observer.lng);
  const sinLat = Math.sin(lat);
  const cosLat = Math.cos(lat);
  const sinLng = Math.sin(lng);
  const cosLng = Math.cos(lng);

  const east = -sinLng * dx + cosLng * dy;
  const north = -sinLat * cosLng * dx - sinLat * sinLng * dy + cosLat * dz;
  const up = cosLat * cosLng * dx + cosLat * sinLng * dy + sinLat * dz;

  return {
    azimuthDeg: normalizeDeg(toDeg(Math.atan2(east, north))),
    elevationDeg: toDeg(Math.atan2(up, Math.hypot(east, north))),
    rangeM: Math.hypot(east, north, up),
  };
}

/** 8 方位の略号。G2 の狭い画面向け。 */
export function cardinal8(azimuthDeg: number): string {
  const names = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return names[Math.round(normalizeDeg(azimuthDeg) / 45) % 8]!;
}

/** 「820m」「12.4km」「98km」。 */
export function formatDistance(meters: number): string {
  if (meters < 1000) return `${Math.round(meters / 10) * 10}m`;
  if (meters < 20_000) return `${(meters / 1000).toFixed(1)}km`;
  return `${Math.round(meters / 1000)}km`;
}
