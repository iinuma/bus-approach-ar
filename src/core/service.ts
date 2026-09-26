/**
 * 運行日と時刻。
 *
 * 祝日・年末年始の入れ替えは calendar_dates.txt に入っている（臨港バスは祝日ごとに
 * 平日ダイヤを外して日曜ダイヤを足している）ので、祝日の計算はしない。
 * 時刻はすべて日本時間。GTFS の時刻は「運行日の 0 時からの秒」で、24 時を超える。
 */

import type { Departure, ServiceRule, StopData } from './stopdata.js';

const JST_OFFSET_MS = 9 * 3600 * 1000;
const DAY_MS = 24 * 3600 * 1000;

export interface JstDay {
  /** YYYYMMDD */
  ymd: string;
  /** 月曜 = 0 … 日曜 = 6（calendar.txt の列順に合わせる）。 */
  weekday: number;
  /** この日の 0 時（日本時間）の epoch ms。 */
  midnightMs: number;
}

export function jstDay(epochMs: number): JstDay {
  const shifted = new Date(epochMs + JST_OFFSET_MS);
  const y = shifted.getUTCFullYear();
  const m = shifted.getUTCMonth() + 1;
  const d = shifted.getUTCDate();
  return {
    ymd: `${y}${String(m).padStart(2, '0')}${String(d).padStart(2, '0')}`,
    weekday: (shifted.getUTCDay() + 6) % 7,
    midnightMs: Date.UTC(y, m - 1, d) - JST_OFFSET_MS,
  };
}

export function runsOn(rule: ServiceRule, day: JstDay): boolean {
  if (rule.removed.includes(day.ymd)) return false;
  if (rule.added.includes(day.ymd)) return true;
  return day.ymd >= rule.start && day.ymd <= rule.end && rule.days[day.weekday] === true;
}

export function activeServices(data: StopData, day: JstDay): Set<string> {
  return new Set(Object.entries(data.services).filter(([, rule]) => runsOn(rule, day)).map(([id]) => id));
}

export interface ScheduledDeparture {
  dep: Departure;
  /** 予定発車時刻（epoch ms）。 */
  atMs: number;
}

/**
 * nowMs 以降の予定の発車便を時刻順に返す。前日の運行日の 24 時超えの便も含める。
 * `graceMs` だけ過去の便も残す（時刻を過ぎても、まだ停まっていることがあるため）。
 */
export function upcomingDepartures(
  data: StopData,
  nowMs: number,
  options: { platforms?: Set<string>; horizonMs?: number; graceMs?: number } = {},
): ScheduledDeparture[] {
  const horizon = options.horizonMs ?? 3 * 3600 * 1000;
  const grace = options.graceMs ?? 0;
  const today = jstDay(nowMs);
  const days = [jstDay(today.midnightMs - DAY_MS), today, jstDay(today.midnightMs + DAY_MS)];
  const out: ScheduledDeparture[] = [];
  for (const day of days) {
    const services = activeServices(data, day);
    for (const dep of data.departures) {
      if (!services.has(dep.service)) continue;
      if (options.platforms && !options.platforms.has(dep.platform)) continue;
      const atMs = day.midnightMs + dep.t * 1000;
      if (atMs >= nowMs - grace && atMs <= nowMs + horizon) out.push({ dep, atMs });
    }
  }
  return out.sort((a, b) => a.atMs - b.atMs);
}

/** 「06:56」。24 時超えも日本時間の時計の表記にする。 */
export function clock(epochMs: number): string {
  const d = new Date(epochMs + JST_OFFSET_MS);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`;
}
