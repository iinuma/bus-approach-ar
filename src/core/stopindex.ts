/**
 * 停留所の一覧（scripts/build-all.ts が作る data/stops/index.json）。
 *
 * アプリに同梱するのはこれだけ。便（時刻表）は入れず、選んだ停留所の StopData を
 * 中継から取る（全停留所の時刻表は数十 MB になり、.ehpk に入らない）。
 */

import type { StopData } from './stopdata.js';

export interface StopIndexEntry {
  /**
   * 中継に停留所を頼むときの鍵。1 社なら「rinko:5010」、複数の事業者をまとめた停留所は
   * メンバーを + でつなぐ（「kawasaki_city:94+rinko:10」, merge.ts）。
   */
  key: string;
  name: string;
  lat: number;
  lng: number;
  /** 事業者の短い名前（「市バス」「臨港」）。 */
  operators: string[];
  /** この停留所から出る系統（「大01」「川04」）。 */
  routes: string[];
}

export interface StopIndex {
  builtAt: string;
  sources: Record<string, StopData['source']>;
  stops: StopIndexEntry[];
}
