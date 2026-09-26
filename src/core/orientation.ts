/*
 * G2PeakView（~/Developer/G2PeakView/src/core/orientation.ts, 2026-09-26 時点）から複製。
 * 元のリポジトリは変更していない。
 */

/**
 * 頭の向き。
 *
 * 分かっていること（SDK 0.0.15 / 0.0.16 の型定義（両者に差分なし）と Tokyojihatsu の実測, 2026-09-21）:
 * - IMU_DATA_REPORT の imuData は x / y / z の 3 値だけ。
 * - 静止時 |v| ≈ 0.97 なので単位は G。**加速度計（重力）であって方位ではない。**
 * - x が頭の前後傾き。pitch = asin(x)、見上げると +。
 *
 * 重力だけでは水平方向の回転（yaw）は原理的に分からない。首を左右に振っても
 * 重力ベクトルは変わらないため。なので:
 *   yaw（heading）: テンプルのスワイプで手動。値の出どころは 'manual'。
 *   pitch        : IMU の x から。
 *   roll         : y/z の意味が実測で確定していないので**使わない**（推測で当てない）。
 *
 * メーカーは G2 に地磁気センサーがあると説明しているが、SDK から取る手段は
 * 0.0.16 の時点で見当たらない。取れるようになったら northReference を
 * 'magnetic' にして heading をそこから入れる。
 */

import { normalizeDeg } from './geodesy.js';

export interface HeadPose {
  yawDeg: number | null;
  pitchDeg: number | null;
  rollDeg: number | null;
  northReference: 'true' | 'magnetic' | 'relative' | 'unknown';
  /** yaw がどこから来たか。manual = スワイプで合わせた値。 */
  yawSource: 'manual' | 'sensor';
  calibrated: boolean;
  timestampMs: number;
}

/** 重力ベクトルの x から頭の上下角（度）。水平が 0、見上げると +。 */
export function pitchFromGravityX(x: number): number {
  const clamped = Math.max(-1, Math.min(1, x));
  return (Math.asin(clamped) * 180) / Math.PI;
}

/**
 * IMU の値を平滑化して pitch にする。
 *
 * 表示の更新は画像転送が律速なので、細かい揺れのたびに送り直さない。
 * 変化が minChangeDeg を超えたときだけ「変わった」と返す。
 */
export class PitchTracker {
  private smoothed: number | null = null;
  private reported: number | null = null;
  private lastAt = 0;
  readonly alpha: number;
  readonly minChangeDeg: number;

  constructor(options: { alpha?: number; minChangeDeg?: number } = {}) {
    this.alpha = options.alpha ?? 0.35;
    this.minChangeDeg = options.minChangeDeg ?? 0.4;
  }

  /** 戻り値: 表示を更新すべきか。 */
  update(gravityX: number, nowMs: number): boolean {
    const pitch = pitchFromGravityX(gravityX);
    this.smoothed = this.smoothed === null ? pitch : this.smoothed + (pitch - this.smoothed) * this.alpha;
    this.lastAt = nowMs;
    if (this.reported === null || Math.abs(this.smoothed - this.reported) >= this.minChangeDeg) {
      this.reported = this.smoothed;
      return true;
    }
    return false;
  }

  get pitchDeg(): number | null {
    return this.reported;
  }

  /** 最後に値が届いてからの経過。止まったら「追従中」のふりをしない。 */
  ageMs(nowMs: number): number {
    return this.lastAt === 0 ? Number.POSITIVE_INFINITY : nowMs - this.lastAt;
  }
}

/** スワイプで合わせる方位。 */
export class ManualHeading {
  private heading: number;
  private step: number;
  calibrated = false;

  constructor(initialDeg = 0, stepDeg = 5) {
    this.heading = normalizeDeg(initialDeg);
    this.step = stepDeg;
  }

  get headingDeg(): number {
    return this.heading;
  }

  get stepDeg(): number {
    return this.step;
  }

  set stepDeg(value: number) {
    this.step = value;
  }

  turn(direction: 1 | -1): void {
    this.heading = normalizeDeg(this.heading + direction * this.step);
  }

  /** 指定した方位にぴったり合わせる（「今見ているのはこの山」で校正する）。 */
  alignTo(azimuthDeg: number): void {
    this.heading = normalizeDeg(azimuthDeg);
    this.calibrated = true;
  }
}
