/** 表示用の短い書式。G2 の文字欄は 1 行 38 桁しかないので詰める。 */

export function formatMeters(m: number): string {
  if (m < 1000) return `${Math.round(m / 10) * 10}m`;
  return `${(m / 1000).toFixed(1)}km`;
}

/** 「あと4分」「まもなく」「発車時刻」。 */
export function formatCountdown(ms: number): string {
  if (ms <= 0) return '発車時刻';
  const min = Math.floor(ms / 60_000);
  if (min < 1) return 'まもなく';
  return `あと${min}分`;
}

/** 「12秒前」「3分前」。 */
export function formatAge(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  return s < 90 ? `${s}秒前` : `${Math.round(s / 60)}分前`;
}
