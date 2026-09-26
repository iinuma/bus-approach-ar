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

/**
 * その日に走る便だけに切り出す（中継が停留所データを配るときに使う）。
 *
 * 当日の運行は全部、前日の運行は 24 時を超える便（0 時台の終バス）だけ、翌日の運行は
 * 早朝の便だけを残す。日付が変わったらアプリが取り直す（app/src/main.ts）。
 * 全曜日ぶんだと大きい停留所で 2MB を超えるが、1 日ぶんなら数分の 1 になる。
 */
export function sliceForDay(data: StopData, epochMs: number): StopData {
  const today = jstDay(epochMs);
  const todayIds = activeServices(data, today);
  const yesterdayIds = activeServices(data, jstDay(today.midnightMs - DAY_MS));
  const tomorrowIds = activeServices(data, jstDay(today.midnightMs + DAY_MS));
  const keep = (service: string, t: number) =>
    todayIds.has(service) || (yesterdayIds.has(service) && t >= 24 * 3600) || (tomorrowIds.has(service) && t < EARLY_MORNING_S);
  const departures = data.departures.filter((d) => keep(d.service, d.t));
  const arrivals = data.arrivals.filter((a) => keep(a.service, a.t));
  const used = new Set([...departures.map((d) => d.service), ...arrivals.map((a) => a.service)]);
  return {
    ...data,
    services: Object.fromEntries(Object.entries(data.services).filter(([id]) => used.has(id))),
    departures,
    arrivals,
  };
}

/** 翌日の運行から残す範囲。発車案内は 3 時間先まで見るので、23 時台に翌朝の始発が要る。 */
const EARLY_MORNING_S = 6 * 3600;
