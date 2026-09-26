/**
 * 接近ビュー（道路モデル）の表示リスト。描かずに座標だけ返す（Node のテストで確かめられる）。
 *
 * 想定する姿勢: 乗り場で道路側を向いた向きを 0° として、右へ 60° 向いている。
 * その視線の先に、まっすぐな道路が奥へ延びていると仮定する（消失点 = 右 60°・地平線上）。
 * バスは「経路に沿った乗り場までの残り距離」で道路上に置く。遠いほど消失点に近く小さく、
 * 近づくと左下（乗り場の側）へ降りてくる。
 *
 * **実際の方位ではない模式図。** 大師橋駅前は駅前ロータリーで、実際のバスは殿町方面
 * （東北東）→ 南東の入口 → ロータリー内の順に来る（2026-09-27 OSM で確認）。
 * 実方位に描くと、視野に入るのはロータリー内の最後の数十 m だけになるので、
 * 残り距離を奥行きに写す道路モデルにした（ユーザー判断 2026-09-27）。
 *
 * テンプルのスワイプで視線の角度（lookRightDeg）を回す。消失点は右 60° に固定なので、
 * 回すと道路が左右に動く。画角はそのまま G2 の表示の画角として扱う（仮値 30°）。
 */

import type { BoardEntry } from './board.js';

export const MODEL_LOOK_RIGHT_DEG = 60;

export interface ApproachLayout {
  width: number;
  height: number;
  horizonY: number;
  /** 手前（残り nearM）の道路中心が、消失点からどれだけ左下にあるか（px）。 */
  nearDx: number;
  nearDy: number;
  /** 手前での道路の半幅（px）。 */
  nearHalfWidth: number;
  /** 奥行きに写す距離の範囲。 */
  nearM: number;
  farM: number;
  fontSize: number;
  lineHeight: number;
}

export const DEFAULT_APPROACH_LAYOUT: ApproachLayout = {
  width: 576,
  height: 144,
  horizonY: 38,
  nearDx: -330,
  nearDy: 112,
  nearHalfWidth: 90,
  nearM: 20,
  farM: 4000,
  fontSize: 14,
  lineHeight: 15,
};

export interface ApproachView {
  lookRightDeg: number;
  hfovDeg: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface BusMarker {
  entry: BoardEntry;
  x: number;
  y: number;
  /** 0（消失点）〜 1（手前）。印の大きさに使う。 */
  scale: number;
  focus: boolean;
  /** farM より遠いので消失点に貼り付けた。 */
  beyond: boolean;
  label: { lines: string[]; x: number; y: number; width: number } | null;
}

export interface ApproachScene {
  vanishing: Point;
  /** 道路の左右の縁（消失点から手前へ）。 */
  edges: [Point, Point][];
  /** 距離の目盛り（道路の右の縁）。 */
  ticks: { x: number; y: number; label: string }[];
  buses: BusMarker[];
  /** 乗り場の印の位置（道路の手前の、画面内で描ける端）。描けなければ null。 */
  platformMark: Point | null;
  /** 消失点が画面外のとき、どちらへ何度回せば戻るか。 */
  offscreen: { side: 'left' | 'right'; deltaDeg: number } | null;
}

/** 残り距離を 0（奥）〜 1（手前）に。対数で写して、数 km 先と数十 m 先を同じ帯に収める。 */
export function depthOf(remainingM: number, layout: ApproachLayout = DEFAULT_APPROACH_LAYOUT): number {
  const d = Math.max(layout.nearM, Math.min(layout.farM, remainingM));
  return 1 - Math.log(d / layout.nearM) / Math.log(layout.farM / layout.nearM);
}

/** 奥行き u の道路中心の画面座標。手前ほど速く広がる（u の 2 乗）ので遠近感が出る。 */
export function roadPoint(vp: Point, u: number, lateral = 0, layout: ApproachLayout = DEFAULT_APPROACH_LAYOUT): Point {
  const k = u * u;
  return {
    x: vp.x + layout.nearDx * k + lateral * layout.nearHalfWidth * k,
    y: vp.y + layout.nearDy * k,
  };
}

export function vanishingPoint(view: ApproachView, layout: ApproachLayout = DEFAULT_APPROACH_LAYOUT): Point {
  const pxPerDeg = layout.width / view.hfovDeg;
  return { x: layout.width / 2 + (MODEL_LOOK_RIGHT_DEG - view.lookRightDeg) * pxPerDeg, y: layout.horizonY };
}

const TICKS_M = [50, 200, 500, 1000, 2000] as const;

function tickLabel(m: number): string {
  return m >= 1000 ? `${m / 1000}km` : `${m}m`;
}

export interface BuildApproachInput {
  entries: BoardEntry[];
  focusIndex: number;
  view: ApproachView;
  labelLines: (entry: BoardEntry, focus: boolean) => string[];
  measure: (text: string) => number;
  layout?: ApproachLayout;
}

export function buildApproachScene(input: BuildApproachInput): ApproachScene {
  const layout = input.layout ?? DEFAULT_APPROACH_LAYOUT;
  const vp = vanishingPoint(input.view, layout);
  const near = 1.08; // 画面の下端より少し手前まで引く
  const edges: [Point, Point][] = [
    [roadPoint(vp, 0, -1, layout), roadPoint(vp, near, -1, layout)],
    [roadPoint(vp, 0, 1, layout), roadPoint(vp, near, 1, layout)],
  ];
  // 目盛りは手前から置き、前の目盛りと縦に 11px 以上離れたものだけ残す（奥は詰まって読めない）。
  const ticks: ApproachScene['ticks'] = [];
  for (const m of TICKS_M) {
    const p = roadPoint(vp, depthOf(m, layout), 1, layout);
    const tick = { x: p.x + 3, y: p.y, label: tickLabel(m) };
    if (tick.x < 0 || tick.x >= layout.width || tick.y < layout.horizonY + 8) continue;
    if (ticks.some((t) => Math.abs(t.y - tick.y) < 11)) continue;
    ticks.push(tick);
  }

  // 車両の位置が分かっている便だけ道路に置く。同じ車両は 1 回だけ（先の便を優先）。
  const seen = new Set<string>();
  const withBus = input.entries
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => {
      if (!entry.bus || seen.has(entry.bus.vehicle.vehicle)) return false;
      seen.add(entry.bus.vehicle.vehicle);
      return true;
    });
  // 選んでいる便を先にラベル付けする。
  withBus.sort((a, b) => Number(b.index === input.focusIndex) - Number(a.index === input.focusIndex));

  // 手前（乗り場）は画面の左下の外に出る。乗り場にいる・ごく近いバスが見えなくならないよう、
  // 画面の左端から 24px 内側までに留める（その位置に「乗り場」の印を出す）。
  const lane = 0.2; // 左側通行なので、こちらへ来る車線は中心より右寄り
  const uMax = Math.min(1, Math.sqrt(Math.max(0, (vp.x - 24) / -(layout.nearDx + lane * layout.nearHalfWidth))));
  const platformMark = uMax > 0.3 ? roadPoint(vp, uMax, lane, layout) : null;
  // 乗り場の印より手前（下）の目盛りは、印に重なるので出さない。
  if (platformMark) {
    for (let i = ticks.length - 1; i >= 0; i -= 1) if (ticks[i]!.y > platformMark.y - 12) ticks.splice(i, 1);
  }

  const placed: { x: number; y: number; width: number; height: number }[] = [];
  const buses: BusMarker[] = [];
  for (const { entry, index } of withBus) {
    const remaining = entry.bus!.remainingM;
    const beyond = remaining > layout.farM;
    const u = Math.min(depthOf(remaining, layout), uMax > 0.3 ? uMax : 1);
    const p = roadPoint(vp, u, lane, layout);
    if (p.x < 0 || p.x >= layout.width) continue; // 画面外のバスはラベルも出さない（端の矢印で道路の向きを示す）
    const focus = index === input.focusIndex;
    const lines = input.labelLines(entry, focus);
    const width = Math.ceil(Math.max(...lines.map((l) => input.measure(l))));
    const height = lines.length * layout.lineHeight;
    const busTop = p.y - 4 - 10 * (0.4 + 0.6 * u * u);
    let label: BusMarker['label'] = null;
    for (const y of [busTop - 3 - height, busTop - 3 - height - layout.lineHeight, busTop - 3 - height - 2 * layout.lineHeight]) {
      const x = Math.max(0, Math.min(layout.width - width, Math.round(p.x - width / 2)));
      const box = { x, y: Math.round(y), width, height };
      if (box.y < 0) break;
      if (placed.some((q) => box.x < q.x + q.width + 4 && q.x < box.x + box.width + 4 && box.y < q.y + q.height && q.y < box.y + box.height)) continue;
      placed.push(box);
      label = { lines, x: box.x, y: box.y, width };
      break;
    }
    buses.push({ entry, x: p.x, y: p.y, scale: u, focus, beyond, label });
  }

  let offscreen: ApproachScene['offscreen'] = null;
  const delta = input.view.lookRightDeg - MODEL_LOOK_RIGHT_DEG;
  if (vp.x < 0 || vp.x >= layout.width) offscreen = { side: vp.x < 0 ? 'left' : 'right', deltaDeg: Math.abs(delta) };

  return { vanishing: vp, edges, ticks, buses, offscreen, platformMark };
}
