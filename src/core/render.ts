/**
 * 接近ビュー（approach.ts）を G2 向けのビットマップに描く。
 *
 * 透過ディスプレイなので**光る＝描いたもの、黒＝現実が透ける**。面は塗らない
 * （G2 Sky View の render.ts と同じ方針）。
 *   選んでいる便のバス・ラベル   bright
 *   他のバス・道路の縁           mid
 *   地平線・距離の目盛り         dim
 */

import type { ApproachLayout, ApproachScene } from './approach.js';
import { DEFAULT_APPROACH_LAYOUT } from './approach.js';
import { Bitmap, LEVEL, MAX_IMAGE_HEIGHT, MAX_IMAGE_WIDTH } from './bitmap.js';

export interface Glyphs {
  /** 1 画素 1 バイト（0〜255）の濃淡。 */
  alpha: Uint8Array;
  width: number;
  height: number;
}

export type TextRasterizer = (text: string, sizePx: number) => Glyphs;

/** 濃淡を 2 値にして打つ。中間調は屋外で飛ぶので、にじませない。 */
export function blitText(bitmap: Bitmap, glyphs: Glyphs, x: number, y: number, level: number, threshold = 110): void {
  for (let gy = 0; gy < glyphs.height; gy += 1) {
    for (let gx = 0; gx < glyphs.width; gx += 1) {
      if ((glyphs.alpha[gy * glyphs.width + gx] ?? 0) >= threshold) bitmap.set(x + gx, y + gy, level);
    }
  }
}

/** バスの輪郭。scale 0（遠い）〜 1（手前）で大きさを変える。底辺の中央が (x, y)。 */
function drawBus(bitmap: Bitmap, x: number, y: number, scale: number, level: number): void {
  const k = 0.4 + 0.6 * scale * scale;
  const w = Math.max(6, Math.round(34 * k));
  const h = Math.max(4, Math.round(14 * k));
  const left = Math.round(x - w / 2);
  const top = Math.round(y - h - 2);
  bitmap.rect(left, top, w, h, level);
  if (h >= 8) {
    // 窓の帯
    const wy = top + Math.round(h * 0.35);
    bitmap.line(left + 2, wy, left + w - 3, wy, level);
  }
  // 車輪
  const r = Math.max(1, Math.round(2 * k));
  bitmap.disc(left + Math.round(w * 0.22), top + h, r, level);
  bitmap.disc(left + Math.round(w * 0.78), top + h, r, level);
}

export function renderApproach(scene: ApproachScene, rasterize: TextRasterizer | null, layout: ApproachLayout = DEFAULT_APPROACH_LAYOUT): Bitmap {
  const bitmap = new Bitmap(layout.width, layout.height);

  // 地平線（点線）
  for (let x = 0; x < layout.width; x += 4) bitmap.set(x, layout.horizonY, LEVEL.dim);

  // 道路の縁
  for (const [a, b] of scene.edges) bitmap.line(a.x, a.y, b.x, b.y, LEVEL.mid);

  // 消失点の印（右 60° の目印。スワイプで実際の道路に合わせる）
  const vp = scene.vanishing;
  bitmap.line(vp.x, vp.y - 6, vp.x, vp.y - 2, LEVEL.mid);

  // 距離の目盛り
  for (const tick of scene.ticks) {
    bitmap.line(tick.x - 3, tick.y, tick.x + 1, tick.y, LEVEL.dim);
    if (rasterize) {
      const glyphs = rasterize(tick.label, 11);
      blitText(bitmap, glyphs, tick.x + 4, Math.round(tick.y - glyphs.height / 2), LEVEL.dim);
    }
  }

  // 乗り場の印（道路の手前の端）
  if (scene.platformMark) {
    const { x, y } = scene.platformMark;
    bitmap.line(x - 14, y + 1, x + 14, y + 1, LEVEL.dim);
    if (rasterize) {
      const glyphs = rasterize('乗り場', 11);
      blitText(bitmap, glyphs, Math.round(x - glyphs.width / 2), y + 3, LEVEL.dim);
    }
  }

  // バス（奥から描く）
  const ordered = [...scene.buses].sort((a, b) => a.scale - b.scale);
  for (const bus of ordered) {
    const level = bus.focus ? LEVEL.bright : LEVEL.mid;
    drawBus(bitmap, bus.x, bus.y, bus.scale, level);
    const label = bus.label;
    if (!label) continue;
    label.lines.forEach((line, i) => {
      const y = label.y + i * layout.lineHeight;
      if (rasterize) {
        const glyphs = rasterize(line, layout.fontSize);
        blitText(bitmap, glyphs, label.x + Math.round((label.width - glyphs.width) / 2), y, level);
      } else {
        bitmap.rect(label.x, y, label.width, layout.lineHeight - 1, level);
      }
    });
  }

  // 消失点が画面外なら、端に矢印と角度（どちらへ回せば道路が戻るか）
  if (scene.offscreen) {
    const { side, deltaDeg } = scene.offscreen;
    const ax = side === 'left' ? 6 : layout.width - 7;
    const ay = layout.horizonY;
    for (let i = 0; i < 6; i += 1) {
      if (side === 'left') bitmap.line(ax + i, ay - i, ax + i, ay + i, LEVEL.bright);
      else bitmap.line(ax - i, ay - i, ax - i, ay + i, LEVEL.bright);
    }
    if (rasterize) {
      const glyphs = rasterize(`道路 ${Math.round(deltaDeg)}°`, layout.fontSize);
      blitText(bitmap, glyphs, side === 'left' ? ax + 10 : ax - 10 - glyphs.width, ay - Math.round(glyphs.height / 2), LEVEL.bright);
    }
  }

  return bitmap;
}

/** 576 幅を 288 幅 2 枚に分ける（SDK の画像コンテナは 1 枚 288×144 まで）。 */
export function splitHalves(bitmap: Bitmap): [Bitmap, Bitmap] {
  if (bitmap.width !== MAX_IMAGE_WIDTH * 2 || bitmap.height > MAX_IMAGE_HEIGHT) {
    throw new Error(`expected ${MAX_IMAGE_WIDTH * 2}x<=${MAX_IMAGE_HEIGHT}, got ${bitmap.width}x${bitmap.height}`);
  }
  const halves: [Bitmap, Bitmap] = [new Bitmap(MAX_IMAGE_WIDTH, bitmap.height), new Bitmap(MAX_IMAGE_WIDTH, bitmap.height)];
  for (let y = 0; y < bitmap.height; y += 1) {
    for (let x = 0; x < bitmap.width; x += 1) {
      const level = bitmap.get(x, y);
      if (level) halves[x < MAX_IMAGE_WIDTH ? 0 : 1].set(x % MAX_IMAGE_WIDTH, y, level);
    }
  }
  return halves;
}
