/**
 * G2 のテキストコンテナに収める。
 *
 * **溢れると firmware がコンテナをスクロール可能にし、テンプルのスワイプが
 * スクロールに使われて、アプリにスワイプが届かなくなる**（2026-09-26 実機。
 * 観察点で向きを回せなくなった）。なので行数も 1 行の幅も、必ず手前で切る。
 *
 * 幅の目安（Tokyojihatsu の実測）: 576px で半角 約 41 桁（半角 1 文字 ≒ 14px）、
 * 全角は 2 桁。フォントは等幅ではないので余裕を見て 38 桁にする。
 * 行数: 高さ 138px のコンテナに 4 行なら溢れなかった（G2PeakView 実機）が、
 * この作品では 3 行までにする（G2 Sky View の実機で 4 行だと上の帯が窮屈なうえ、
 * 作り次第で縦スクロールが入りスワイプを取られた。ユーザー指定 2026-09-27）。
 */

export const INFO_MAX_LINES = 3;
export const FULL_MAX_LINES = 8;
export const MAX_COLUMNS = 38;

/**
 * 見た目の幅（半角 = 1, 全角 = 2）。
 * 矢印・記号（→ ↑ ▶ ◇ ▽ など）も全角として数える。フォントによって幅が
 * 全角になるので、少なく見積もると溢れる。
 */
export function visualWidth(text: string): number {
  let width = 0;
  for (const char of text) width += isWide(char) ? 2 : 1;
  return width;
}

function isWide(char: string): boolean {
  const code = char.codePointAt(0) ?? 0;
  return (
    (code >= 0x1100 && code <= 0x115f) ||
    (code >= 0x2190 && code <= 0x2bff) || // 矢印・記号・罫線・図形
    (code >= 0x2e80 && code <= 0xa4cf) ||
    (code >= 0xac00 && code <= 0xd7a3) ||
    (code >= 0xf900 && code <= 0xfaff) ||
    (code >= 0xfe30 && code <= 0xfe6f) ||
    (code >= 0xff00 && code <= 0xff60) ||
    (code >= 0xffe0 && code <= 0xffe6)
  );
}

/** 幅を超えたら切って末尾に … を付ける。 */
export function truncateToWidth(text: string, columns = MAX_COLUMNS): string {
  if (visualWidth(text) <= columns) return text;
  let width = 0;
  let out = '';
  for (const char of text) {
    const w = isWide(char) ? 2 : 1;
    if (width + w > columns - 2) break; // … のぶん（全角扱い）を残す
    out += char;
    width += w;
  }
  return `${out}…`;
}

/** 行数と幅の両方を収める。空行は詰めない（意図した余白なので）。 */
export function fitText(text: string, maxLines = INFO_MAX_LINES, columns = MAX_COLUMNS): string {
  return text
    .split('\n')
    .slice(0, maxLines)
    .map((line) => truncateToWidth(line, columns))
    .join('\n');
}
