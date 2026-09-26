/**
 * 停留所の一覧（scripts/build-all.ts が作る data/stops/index.json）。
 *
 * アプリに同梱するのはこれだけ。便（時刻表）は入れず、選んだ停留所の StopData を
 * 中継から取る（全停留所の時刻表は数十 MB になり、.ehpk に入らない）。
 */

import type { StopData } from './stopdata.js';

export interface StopIndexEntry {
  /** 「rinko:5010」。中継に停留所を頼むときの鍵。 */
  key: string;
  feed: string;
  id: string;
  name: string;
  lat: number;
  lng: number;
  /** この停留所から出る系統（「大01」「川04」）。 */
  routes: string[];
}

export interface StopIndex {
  builtAt: string;
  sources: Record<string, StopData['source']>;
  stops: StopIndexEntry[];
}
