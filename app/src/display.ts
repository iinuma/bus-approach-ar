/*
 * G2PeakView（app/src/display.ts, 2026-09-26 時点）から複製。
 */

/**
 * G2 への画像送信。
 *
 * - **最新フレーム優先。** 送信中に次の絵ができたら、それまでの待ちは捨てて
 *   最新だけを次に送る。スワイプを連打しても古い絵が列を作らない。
 * - **同じ絵は送らない。** 左右それぞれ前回と比べ、変わった方だけ送る。
 *   首振りで山稜が片側だけ動くことは少ないが、上下追従で止まっているときに効く。
 * - 1 枚あたりの送信時間を記録する。スワイプ追従できるかはこの数字で決まる
 *   （Tokyojihatsu の mapprobe でも未測定）。
 */

import { EvenAppBridge, ImageRawDataUpdate, ImageRawDataUpdateResult } from '@evenrealities/even_hub_sdk';
import type { Bitmap } from '../../src/core/bitmap.js';

export interface ImageSlot {
  id: number;
  name: string;
}

export type ImageFormat = 'gray4' | 'gray8';

export class FrameSender {
  format: ImageFormat = 'gray4';
  readonly sendMs: number[] = [];
  lastResult = '';
  lastBytes = 0;
  sent = 0;
  skipped = 0;
  dropped = 0;

  private pending: Bitmap[] | null = null;
  private busy = false;
  private readonly last: (string | null)[];

  constructor(
    private readonly bridge: EvenAppBridge | null,
    private readonly slots: ImageSlot[],
  ) {
    this.last = slots.map(() => null);
  }

  /** 前回と同じでも必ず送り直す（ページを作り直したあと等）。 */
  invalidate(): void {
    this.last.fill(null);
  }

  submit(frames: Bitmap[]): void {
    if (this.pending) this.dropped += 1;
    this.pending = frames;
    if (!this.busy) void this.drain();
  }

  private async drain(): Promise<void> {
    this.busy = true;
    try {
      while (this.pending) {
        const frames = this.pending;
        this.pending = null;
        for (let i = 0; i < this.slots.length; i += 1) {
          const bitmap = frames[i];
          if (!bitmap) continue;
          const data = bitmap.toNumberArray(this.format === 'gray4');
          const signature = `${this.format}:${fingerprint(data)}`;
          if (signature === this.last[i]) {
            this.skipped += 1;
            continue;
          }
          await this.send(this.slots[i]!, data);
          this.last[i] = signature;
          // 送信中に新しい絵が来たら、残りの半分は古いので送らない。
          if (this.pending) break;
        }
      }
    } finally {
      this.busy = false;
    }
  }

  private async send(slot: ImageSlot, data: number[]): Promise<void> {
    this.lastBytes = data.length;
    if (!this.bridge) return;
    const started = performance.now();
    try {
      const outcome = await this.bridge.updateImageRawData(
        new ImageRawDataUpdate({ containerID: slot.id, containerName: slot.name, imageData: data }),
      );
      this.lastResult = ImageRawDataUpdateResult.isSuccess(outcome) ? 'ok' : String(outcome);
    } catch (error) {
      this.lastResult = `throw ${String(error).slice(0, 40)}`;
    }
    this.sendMs.push(performance.now() - started);
    if (this.sendMs.length > 20) this.sendMs.shift();
    this.sent += 1;
  }

  /** 送信時間の min/median/max（ms）。 */
  stats(): string {
    if (this.sendMs.length === 0) return '-';
    const sorted = [...this.sendMs].sort((a, b) => a - b);
    const pick = (q: number) => Math.round(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))]!);
    return `${pick(0)}/${pick(0.5)}/${pick(1)}`;
  }
}

/** 同一判定用の軽いハッシュ（FNV-1a）。 */
function fingerprint(data: number[]): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < data.length; i += 1) {
    h ^= data[i]!;
    h = Math.imul(h, 0x01000193);
  }
  return `${data.length}:${(h >>> 0).toString(16)}`;
}
