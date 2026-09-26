/**
 * 事業者をまたいで「利用者にとって同じバス停」をまとめる判定（scripts/build-all.ts が使う）。
 *
 * 2026-09-27 のデータでの検討:
 *   - 名前の末尾の「前」を外して一致し、150m 以内 → 85 か所。川崎駅（市）と川崎駅前（臨港）も入る。
 *   - 同名でも離れているもの（神明社前 8km、山崎 5km、桜本 700m）は別の場所。
 *   - 同名で 200m 前後（下平間・大島三丁目）は系統が重ならず、別の道路の標柱。まとめない。
 *   - 片方の名前がもう片方の頭に含まれ、60m 以内（観音二丁目 / 観音二丁目川崎大師口, 12m）→ まとめる。
 *   - 名前が全く違う近接（昭和駅前 / レゾナック前, 25m）は道路の反対側かもしれないので、まとめない。
 * 同じ事業者の中ではまとめない（別の親停留所にしてあるのは事業者の判断なので）。
 */

import { LocalSphere } from './geodesy.js';

export const SAME_NAME_MAX_M = 150;
export const PREFIX_NAME_MAX_M = 60;

export interface GroupCandidate {
  key: string;
  feed: string;
  name: string;
  lat: number;
  lng: number;
  /** 代表名を選ぶのに使う（便の多い方の名前にする）。 */
  departures: number;
}

/** 比べるための名前: 全角→半角、空白を除き、末尾の「前」を外す。 */
export function baseName(name: string): string {
  return name.normalize('NFKC').replace(/\s/g, '').replace(/前$/, '');
}

function sameStop(a: GroupCandidate, b: GroupCandidate): boolean {
  if (a.feed === b.feed) return false;
  const distance = new LocalSphere(a).inverse(b).distanceM;
  const x = baseName(a.name);
  const y = baseName(b.name);
  if (x === y) return distance <= SAME_NAME_MAX_M;
  if (x.startsWith(y) || y.startsWith(x)) return distance <= PREFIX_NAME_MAX_M;
  return false;
}

export interface StopGroup {
  members: GroupCandidate[];
  name: string;
  lat: number;
  lng: number;
}

/**
 * まとめた結果。1 つの停留所は、他の事業者ごとに最も近い 1 つとだけ組む
 * （同じ事業者の停留所を 2 つ飲み込まないように）。
 */
export function groupStops(stops: GroupCandidate[]): StopGroup[] {
  const partnerOf = new Map<string, GroupCandidate[]>();
  const taken = new Set<string>();
  // 近い組から順に確定させる。
  const pairs: { a: GroupCandidate; b: GroupCandidate; d: number }[] = [];
  const byBase = new Map<string, GroupCandidate[]>();
  for (const s of stops) {
    const list = byBase.get(baseName(s.name)) ?? [];
    list.push(s);
    byBase.set(baseName(s.name), list);
  }
  for (let i = 0; i < stops.length; i += 1) {
    for (let j = i + 1; j < stops.length; j += 1) {
      const a = stops[i]!;
      const b = stops[j]!;
      if (a.feed === b.feed) continue;
      // 名前の頭が合わないものは距離を測るまでもない（871 × 871 の総当たりを軽くする）。
      const x = baseName(a.name);
      const y = baseName(b.name);
      if (!(x.startsWith(y) || y.startsWith(x))) continue;
      if (sameStop(a, b)) pairs.push({ a, b, d: new LocalSphere(a).inverse(b).distanceM });
    }
  }
  pairs.sort((p, q) => p.d - q.d);
  for (const { a, b } of pairs) {
    const pa = partnerOf.get(a.key) ?? [];
    const pb = partnerOf.get(b.key) ?? [];
    if (pa.some((p) => p.feed === b.feed) || pb.some((p) => p.feed === a.feed)) continue;
    pa.push(b);
    pb.push(a);
    partnerOf.set(a.key, pa);
    partnerOf.set(b.key, pb);
  }

  const groups: StopGroup[] = [];
  for (const s of stops) {
    if (taken.has(s.key)) continue;
    const members = [s, ...(partnerOf.get(s.key) ?? [])].filter((m) => !taken.has(m.key));
    members.forEach((m) => taken.add(m.key));
    members.sort((p, q) => p.key.localeCompare(q.key));
    const main = [...members].sort((p, q) => q.departures - p.departures)[0]!;
    groups.push({
      members,
      name: main.name,
      lat: members.reduce((n, m) => n + m.lat, 0) / members.length,
      lng: members.reduce((n, m) => n + m.lng, 0) / members.length,
    });
  }
  return groups;
}
