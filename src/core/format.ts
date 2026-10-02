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

/**
 * 時刻表の版。1 社なら「20260716」、両社をまとめたバス停（feedVersion が「20260701/20260716」）
 * なら「7/1・7/16」。8 文字で切ると片方の事業者の版しか出ない（2026-10-03 のスクリーンショットで発見）。
 */
export function versionText(feedVersion: string): string {
  const versions = feedVersion.split('/').map((v) => v.slice(0, 8));
  if (versions.length === 1) return versions[0]!;
  return versions.map((v) => `${Number(v.slice(4, 6))}/${Number(v.slice(6, 8))}`).join('・');
}
