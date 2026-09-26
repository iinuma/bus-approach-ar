/*
 * G2PeakView（app/src/text.ts, 2026-09-26 時点）から複製。
 */

/**
 * 文字のラスタライズ（canvas）。
 *
 * G2 のテキストコンテナは位置を毎フレーム動かせないので、山名は画像の中に
 * 焼き込む。WebView の canvas は日本語フォントを持っている（iOS はヒラギノ）。
 * 太字にしてから 2 値化するのは、細い線が 1 画素で途切れて読めなくなるため。
 */

import type { Glyphs, TextRasterizer } from '../../src/core/render.js';

const FONT = (size: number): string => `bold ${size}px "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Noto Sans JP", sans-serif`;

const canvas = document.createElement('canvas');
const context = canvas.getContext('2d', { willReadFrequently: true })!;
const cache = new Map<string, Glyphs>();

export function measureText(text: string, size = 16): number {
  context.font = FONT(size);
  return context.measureText(text).width;
}

export const rasterizeText: TextRasterizer = (text, size) => {
  const key = `${size}:${text}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const width = Math.max(1, Math.ceil(measureText(text, size)));
  const height = Math.ceil(size * 1.1);
  canvas.width = width;
  canvas.height = height;
  context.font = FONT(size);
  context.fillStyle = '#000';
  context.fillRect(0, 0, width, height);
  context.fillStyle = '#fff';
  context.textBaseline = 'top';
  context.fillText(text, 0, 0);

  const rgba = context.getImageData(0, 0, width, height).data;
  const alpha = new Uint8Array(width * height);
  for (let i = 0; i < alpha.length; i += 1) alpha[i] = rgba[i * 4]!;
  const glyphs = { alpha, width, height };
  if (cache.size > 500) cache.clear();
  cache.set(key, glyphs);
  return glyphs;
};
