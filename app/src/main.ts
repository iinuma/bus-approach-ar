/**
 * バス接近AR — Even G2。公共交通オープンデータチャレンジ2026 向け。
 *
 * 企画は Notion「公共交通オープンデータチャレンジ2026 — 川崎バス接近AR／Even 構想メモ」。
 * 画面構成・送信・入力の扱いは G2 Sky View（~/Developer/G2SkyView）から持ってきた。
 *
 * 流れ: 近くのバス停を選ぶ → 乗り場（系統・行先）を選ぶ → 接近ビュー
 *
 * 接近ビュー（576×288）:
 *   上 576×144  道路モデルの AR（画像 288×144 を左右 2 枚, src/core/approach.ts）
 *   下 576×138  選んでいる便の系統・行先・カウントダウン（テキスト 3 行まで）
 *
 * 操作（接近ビュー）:
 *   スワイプ     視線の角度を回す（既定: 道路側を向いた向きから右 60°）
 *   タップ       次の便を選ぶ
 *   ダブルタップ 終了確認（審査要件）
 *   メニュー     乗り場・停留所を選び直す、向きのリセット、刻み、データについて、終了
 * 一覧の画面では、スワイプで選び、タップで決め、ダブルタップで戻る。
 */

import {
  AppLocationAccuracy,
  CreateStartUpPageContainer,
  EvenAppBridge,
  ImageContainerProperty,
  MenuContainerProperty,
  MenuItemProperty,
  OsEventTypeList,
  RebuildPageContainer,
  StartUpPageCreateResult,
  TextContainerProperty,
  TextContainerUpgrade,
  waitForEvenAppBridge,
  type EvenHubEvent,
} from '@evenrealities/even_hub_sdk';

import { buildApproachScene, DEFAULT_APPROACH_LAYOUT, MODEL_LOOK_RIGHT_DEG, type ApproachScene } from '../../src/core/approach.js';
import { Bitmap } from '../../src/core/bitmap.js';
import { buildBoard, type BoardEntry } from '../../src/core/board.js';
import { formatAge, formatCountdown, formatMeters } from '../../src/core/format.js';
import type { LatLng } from '../../src/core/geodesy.js';
import type { RtSnapshot } from '../../src/core/realtime.js';
import { renderApproach, splitHalves } from '../../src/core/render.js';
import { clock, jstDay } from '../../src/core/service.js';
import type { StopData } from '../../src/core/stopdata.js';
import type { StopIndex, StopIndexEntry } from '../../src/core/stopindex.js';
import { nearbyStops, platformChoices, type PlatformChoice } from '../../src/core/stops.js';
import { fitText, FULL_MAX_LINES, INFO_MAX_LINES } from '../../src/core/textfit.js';
import stopIndex from '../../data/stops/index.json';
import { FrameSender } from './display.js';
import { isClick, isDoubleClick, isScrollDown, isScrollUp } from './events.js';
import { loadSelection, saveSelection, type HostStorage } from './selection.js';
import { measureText, rasterizeText } from './text.js';

/* ---------- 設定 ---------- */

const IMG_L = { id: 1, name: 'road-l', x: 0, y: 0, width: 288, height: 144 };
const IMG_R = { id: 2, name: 'road-r', x: 288, y: 0, width: 288, height: 144 };
const INFO = { id: 3, name: 'info', x: 0, y: 150, width: 576, height: 138 };
const FULL = { id: 3, name: 'info', x: 0, y: 0, width: 576, height: 288 };

const MENU = { platform: 1, stop: 2, reset: 3, step: 4, fov: 5, refresh: 6, about: 7, diag: 8, exit: 9 } as const;

/**
 * 停留所の一覧（川崎市バス・臨港バスの全停留所, scripts/build-all.ts）。同梱するのはこれだけで、
 * 時刻表は選んだ停留所のぶんを中継から取る（全停留所だと数百 MB になり .ehpk に入らない）。
 */
const INDEX = stopIndex as StopIndex;
/** 位置が取れないとき（ブラウザ・シミュレータ）の仮の現在地: 川崎駅東口。 */
const FALLBACK_LOCATION: LatLng = { lat: 35.5305, lng: 139.6985 };
/** バス停の一覧に出す数（近い順）。 */
const NEARBY_LIMIT = 20;

/** ODPT ガイドライン 3.1 の必須表示（開発者の問い合わせ先）。 */
const CONTACT = 'async.sync+kawasakibus@gmail.com';

/** G2 の表示の画角（仮値。G2 Sky View と同じ 30°）。 */
const AR_FOVS = [30, 45, 20] as const;
const STEPS = [5, 2, 10] as const;
/** 取得間隔。フィードの更新は 20〜60 秒ごと、車両位置は 20〜130 秒前のもの（実測）。 */
const POLL_MS = 20_000;
/** 中継。dev サーバーは自分が中継を兼ねる（/api/stop, /api/rt）。常用ビルドは .env.production.local で渡す。 */
const API_BASE: string = import.meta.env.VITE_RT_PROXY ?? (import.meta.env.DEV ? '/api' : '');
const API_KEY: string = import.meta.env.VITE_RT_PROXY_KEY ?? '';

/* ---------- 状態 ---------- */

let bridge: EvenAppBridge | null = null;
let host: HostStorage | null = null;
let sender: FrameSender;
type Page = 'stops' | 'platforms' | 'main' | 'about' | 'diag';
let page: Page = 'stops';

let location: LatLng | null = null;
/** 選んだ停留所（索引）と、その時刻表（中継から取る。取るまでは null）。 */
let stopEntry: StopIndexEntry | null = null;
let stop: StopData | null = null;
let stopError: string | null = null;
/** 時刻表はその日に走る便だけなので、日付が変わったら取り直す。 */
let stopDay = '';
let choice: PlatformChoice | null = null;
let cursor = 0;

let snapshot: RtSnapshot | null = null;
let rtError: string | null = null;
let lastPollMs = 0;
let polls = 0;

let board: BoardEntry[] = [];
let focusIndex = 0;
let lookRightDeg = MODEL_LOOK_RIGHT_DEG;
let stepIndex = 0;
let fovIndex = 0;

let lastScene: ApproachScene | null = null;
let lastInfo = '';
let renderMs = 0;

/* ---------- データ ---------- */

async function poll(force = false): Promise<void> {
  if (!API_BASE || !stopEntry) return;
  if (!force && Date.now() - lastPollMs < POLL_MS) return;
  lastPollMs = Date.now();
  polls += 1;
  try {
    const response = await api(`/rt?key=${encodeURIComponent(stopEntry.key)}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    snapshot = (await response.json()) as RtSnapshot;
    rtError = null;
  } catch (error) {
    rtError = `RT取得失敗 ${String(error).slice(0, 20)}`;
  }
}

function api(path: string): Promise<Response> {
  return fetch(`${API_BASE}${path}`, API_KEY ? { headers: { 'X-Bus-Key': API_KEY } } : undefined);
}

/** 停留所の時刻表を中継から取る（その日に走る便だけ）。 */
async function loadStop(entry: StopIndexEntry): Promise<void> {
  if (!API_BASE) {
    stopError = '中継が未設定です';
    return;
  }
  stopError = null;
  try {
    const response = await api(`/stop?key=${encodeURIComponent(entry.key)}`);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const data = (await response.json()) as StopData;
    if (stopEntry?.key !== entry.key) return; // 取っている間に別の停留所が選ばれた
    stop = data;
    stopDay = jstDay(Date.now()).ymd;
  } catch (error) {
    stopError = `時刻表の取得に失敗 ${String(error).slice(0, 20)}`;
  }
}

function refreshBoard(): void {
  if (!stop || !choice) return;
  const focusedTrip = board[focusIndex]?.scheduled.dep.trip;
  board = buildBoard(stop, snapshot, Date.now(), { platforms: choice.platforms, limit: 6 });
  // 選んでいた便が残っていれば選んだまま、出てしまったら先頭へ。
  const kept = board.findIndex((e) => e.scheduled.dep.trip === focusedTrip);
  focusIndex = kept >= 0 ? kept : 0;
}

/* ---------- 文字 ---------- */

/** バスの位置の説明。根拠（待機・RT・推定・時刻表のみ）が分かるようにする。 */
function busText(e: BoardEntry): string {
  if (!e.bus) return '車両未確認 時刻表の予定';
  // inbound で止まっているのは、着く便の終点（降車場のこともある）。まだ乗り場にはいない。
  if (e.bus.waiting) return e.basis === 'inbound' ? '到着済み 折返し推定' : '乗り場で待機中';
  const where = e.bus.stopsAway > 0 ? `${formatMeters(e.bus.remainingM)}・${e.bus.stopsAway}停前` : `乗り場まで${formatMeters(e.bus.remainingM)}`;
  return e.basis === 'inbound' ? `${where} 推定` : `${where} 接近中`;
}

function countdownText(e: BoardEntry, nowMs: number): string {
  const late = Math.round((e.expectedMs - e.scheduled.atMs) / 60_000);
  return `${formatCountdown(e.expectedMs - nowMs)}${late > 0 ? `(+${late}分)` : ''}`;
}

/** 帯の中のラベル。選んでいる便は系統と残り時間、他は系統だけ。 */
function labelLines(e: BoardEntry, focus: boolean): string[] {
  const route = e.scheduled.dep.route;
  if (!focus) return [e.bus?.waiting ? `${route} ${e.basis === 'inbound' ? '到着' : '待機'}` : route];
  return [`${route} ${formatCountdown(e.expectedMs - Date.now())}`];
}

/**
 * 接近ビューの文字欄。**3 行・1 行 38 桁まで**（textfit.ts）。溢れると firmware が
 * スクロールを入れ、スワイプを取られて向きを回せなくなる（G2 Sky View の実機）。
 *
 *   1  ▶大01 浮島バスターミナル 07:15発
 *   2  あと12分(+3分) 1.2km・3停前 推定
 *   3  1/6 次07:25大02 更新12秒前 右60°
 */
function mainText(): string {
  const nowMs = Date.now();
  const age = snapshot ? `更新${formatAge(nowMs / 1000 - snapshot.feedTs)}` : API_BASE ? 'RT取得中' : 'RTなし';
  const status = rtError ?? age;
  const look = `右${Math.round(lookRightDeg)}°`;
  const e = board[focusIndex];
  if (!stop || !choice) return [stopEntry?.name ?? '', stopError ?? '時刻表を取得中…'].join('\n');
  if (!e) return [`${stop.stop.name} ${choice.label}`, '3時間以内の発車はありません', `${status} ${look}`].join('\n');
  const d = e.scheduled.dep;
  const next = board[focusIndex + 1];
  // 複数の乗り場を見ているときは、どの乗り場から出るかを先頭に出す（川崎駅は 25 乗り場）。
  const where = choice.platforms.size > 1 ? `${platformName(d.platform)} ` : '';
  return [
    `▶${where}${d.route} ${d.headsign} ${clock(e.scheduled.atMs)}発`,
    `${countdownText(e, nowMs)} ${busText(e)}`,
    `${focusIndex + 1}/${board.length}${next ? ` 次${clock(next.scheduled.atMs)}${next.scheduled.dep.route}` : ''} ${status} ${look}`,
  ].join('\n');
}

/** 「臨港1番」「市バス」「3番」。 */
function platformName(platformId: string): string {
  const p = stop?.platforms.find((x) => x.id === platformId);
  if (!p) return '';
  return `${p.operator ?? ''}${p.code ? `${p.code}番` : ''}` || '乗り場';
}

function listText(title: string, items: string[]): string {
  // 8 行に収める。カーソルが見えるよう、7 項目ずつの窓で出す。
  const start = Math.max(0, Math.min(cursor - 3, items.length - 7));
  const shown = items.slice(start, start + 7).map((item, i) => `${start + i === cursor ? '▶' : '  '}${item}`);
  return [title, ...shown].join('\n');
}

function nearby() {
  return nearbyStops(INDEX.stops, location ?? FALLBACK_LOCATION, NEARBY_LIMIT);
}

function stopItems(): string[] {
  return nearby().map(({ entry, distanceM }) => `${entry.name} ${formatMeters(distanceM)} ${entry.operators.join('・')} ${entry.routes.slice(0, 2).join(' ')}`);
}

function aboutText(): string {
  const source = stop?.source ?? Object.values(INDEX.sources)[0]!;
  return [
    'データについて（タップで戻る）',
    '公共交通オープンデータセンター提供',
    source.agency,
    `時刻表 ${source.feedVersion.slice(0, 8)}版 取得${source.fetchedDate}`,
    'データの正確性・完全性は保証されません',
    '道路は右60°に置いた模式図です',
    '問い合わせ:',
    CONTACT,
  ].join('\n');
}

function diagText(): string {
  return [
    'DIAG  2tap:戻る',
    `API ${API_BASE || '-'} 回${polls} ${rtError ?? stopError ?? 'ok'}`,
    `停留所 ${stopEntry?.key ?? '-'} 時刻表${stop ? `${stop.departures.length}便 ${stopDay}` : '-'}`,
    snapshot ? `feed ${formatAge(Date.now() / 1000 - snapshot.feedTs)} 車両${snapshot.vehicles.length} 便${snapshot.tripUpdates.length}` : 'feed -',
    `位置 ${location ? `${location.lat.toFixed(4)},${location.lng.toFixed(4)}` : '-'}`,
    `送信 ${sender.stats()}ms 済${sender.sent} 同${sender.skipped} 捨${sender.dropped} 描${Math.round(renderMs)}ms`,
    `画角${AR_FOVS[fovIndex]}° 刻み${STEPS[stepIndex]}° 右${lookRightDeg}°`,
  ].join('\n');
}

function infoText(): string {
  switch (page) {
    case 'stops':
      return listText(`バス停を選ぶ${location ? '' : '（仮:川崎駅）'}`, stopItems());
    case 'platforms':
      if (!stop) return [stopEntry?.name ?? '', stopError ?? '時刻表を取得中…', '', 'ダブルタップで戻る'].join('\n');
      return listText(`${stop.stop.name} 乗り場を選ぶ`, platformChoices(stop).map((c) => c.label));
    case 'about':
      return aboutText();
    case 'diag':
      return diagText();
    case 'main':
      return mainText();
  }
}

/* ---------- 描画 ---------- */

async function render(): Promise<void> {
  if (page !== 'main') {
    drawPreview(null);
    await paintInfo();
    return;
  }
  const started = performance.now();
  refreshBoard();
  lastScene = buildApproachScene({
    entries: board,
    focusIndex,
    view: { lookRightDeg, hfovDeg: AR_FOVS[fovIndex]! },
    labelLines,
    measure: (text) => measureText(text, DEFAULT_APPROACH_LAYOUT.fontSize),
  });
  const band = renderApproach(lastScene, rasterizeText);
  renderMs = performance.now() - started;
  drawPreview(band);
  // 文字を先に出す。画像は左右 2 枚で約 0.8 秒かかる（G2PeakView の実測）。
  await paintInfo();
  sender.submit(splitHalves(band));
}

async function paintInfo(): Promise<void> {
  const content = fitText(infoText(), page === 'main' ? INFO_MAX_LINES : FULL_MAX_LINES);
  const dom = document.getElementById('screen');
  if (dom) dom.textContent = content;
  if (!bridge || content === lastInfo) return;
  lastInfo = content;
  try {
    const slot = page === 'main' ? INFO : FULL;
    await bridge.textContainerUpgrade(new TextContainerUpgrade({ containerID: slot.id, containerName: slot.name, content }));
  } catch (error) {
    console.warn('textContainerUpgrade failed', error);
  }
}

/** ブラウザ確認用。G2 に送るのと同じビットマップを緑で出す。 */
function drawPreview(band: Bitmap | null): void {
  const canvas = document.getElementById('preview');
  if (!(canvas instanceof HTMLCanvasElement)) return;
  const context = canvas.getContext('2d');
  if (!context) return;
  const image = context.createImageData(576, 288);
  if (band) {
    for (let y = 0; y < band.height; y += 1) {
      for (let x = 0; x < band.width; x += 1) {
        const level = band.get(x, y);
        const i = (y * 576 + x) * 4;
        image.data[i] = level * 2;
        image.data[i + 1] = level * 17;
        image.data[i + 2] = level * 6;
      }
    }
  }
  for (let i = 3; i < image.data.length; i += 4) image.data[i] = 255;
  context.putImageData(image, 0, 0);
  context.strokeStyle = '#131';
  const slot = page === 'main' ? INFO : FULL;
  context.strokeRect(slot.x + 0.5, slot.y + 0.5, slot.width - 1, slot.height - 1);
}

/* ---------- ページ ---------- */

function menu(): MenuContainerProperty {
  const items = [
    new MenuItemProperty({ itemID: MENU.platform, itemName: '乗り場を選び直す' }),
    new MenuItemProperty({ itemID: MENU.stop, itemName: 'バス停を選び直す' }),
    new MenuItemProperty({ itemID: MENU.reset, itemName: '向きを右60°に戻す' }),
    new MenuItemProperty({ itemID: MENU.step, itemName: '回転の刻み 5°/2°/10°' }),
    new MenuItemProperty({ itemID: MENU.fov, itemName: '画角 30°/45°/20°' }),
    new MenuItemProperty({ itemID: MENU.refresh, itemName: '今すぐ更新' }),
    new MenuItemProperty({ itemID: MENU.about, itemName: 'データについて' }),
  ];
  if (import.meta.env.DEV) items.push(new MenuItemProperty({ itemID: MENU.diag, itemName: '診断画面' }));
  items.push(new MenuItemProperty({ itemID: MENU.exit, itemName: '終了' }));
  return new MenuContainerProperty({ menuItems: items });
}

function textContainer(slot: typeof INFO, content: string) {
  return new TextContainerProperty({
    xPosition: slot.x,
    yPosition: slot.y,
    width: slot.width,
    height: slot.height,
    paddingLength: 4,
    borderWidth: 0,
    containerID: slot.id,
    containerName: slot.name,
    content,
    isEventCapture: 1,
  });
}

function containersFor(next: Page) {
  if (next !== 'main') {
    return { containerTotalNum: 1, textObject: [textContainer(FULL, fitText(infoText(), FULL_MAX_LINES))], menuObject: menu() };
  }
  return {
    containerTotalNum: 3,
    textObject: [textContainer(INFO, fitText(infoText(), INFO_MAX_LINES))],
    imageObject: [IMG_L, IMG_R].map(
      (slot) =>
        new ImageContainerProperty({
          xPosition: slot.x,
          yPosition: slot.y,
          width: slot.width,
          height: slot.height,
          containerID: slot.id,
          containerName: slot.name,
        }),
    ),
    menuObject: menu(),
  };
}

async function switchPage(next: Page): Promise<void> {
  const layoutChanged = (page === 'main') !== (next === 'main');
  page = next;
  lastInfo = '';
  if (bridge && layoutChanged) {
    try {
      await bridge.rebuildPageContainer(new RebuildPageContainer(containersFor(next)));
    } catch (error) {
      console.warn('rebuild failed', error);
    }
  }
  sender.invalidate();
  await render();
}

async function openMain(): Promise<void> {
  if (!stopEntry || !choice) return;
  void saveSelection({ stopId: stopEntry.key, choiceId: choice.id, lookRightDeg }, host);
  await poll(true);
  await switchPage('main');
}

/* ---------- 入力 ---------- */

async function handleMenu(id: number): Promise<void> {
  switch (id) {
    case MENU.platform:
      cursor = 0;
      await switchPage(stopEntry ? 'platforms' : 'stops');
      return;
    case MENU.stop:
      cursor = 0;
      await switchPage('stops');
      return;
    case MENU.reset:
      lookRightDeg = MODEL_LOOK_RIGHT_DEG;
      break;
    case MENU.step:
      stepIndex = (stepIndex + 1) % STEPS.length;
      break;
    case MENU.fov:
      fovIndex = (fovIndex + 1) % AR_FOVS.length;
      break;
    case MENU.refresh:
      await poll(true);
      break;
    case MENU.about:
      await switchPage(page === 'about' ? 'main' : 'about');
      return;
    case MENU.diag:
      await switchPage(page === 'diag' ? 'main' : 'diag');
      return;
    case MENU.exit:
      await bridge?.shutDownPageContainer(1);
      return;
  }
  await render();
}

/** SCROLL_BOTTOM を「次へ／右回り」にする（G2PeakView・G2 Sky View で実機で自然だった向き）。 */
async function onSwipe(direction: 1 | -1): Promise<void> {
  if (page === 'main') {
    lookRightDeg += direction * STEPS[stepIndex]!;
    if (stopEntry && choice) void saveSelection({ stopId: stopEntry.key, choiceId: choice.id, lookRightDeg }, host);
  } else if (page === 'stops' || page === 'platforms') {
    const count = page === 'stops' ? nearby().length : stop ? platformChoices(stop).length : 0;
    if (count > 0) cursor = (cursor + direction + count) % count;
  } else {
    return;
  }
  await render();
}

async function onTap(): Promise<void> {
  switch (page) {
    case 'stops': {
      stopEntry = nearby()[cursor]?.entry ?? null;
      stop = null;
      snapshot = null;
      cursor = 0;
      await switchPage('platforms');
      if (stopEntry) {
        await loadStop(stopEntry);
        await render();
      }
      return;
    }
    case 'platforms': {
      choice = stop ? (platformChoices(stop)[cursor] ?? null) : null;
      focusIndex = 0;
      await openMain();
      return;
    }
    case 'main':
      if (board.length > 0) focusIndex = (focusIndex + 1) % board.length;
      await render();
      return;
    case 'about':
    case 'diag':
      await switchPage('main');
      return;
  }
}

async function onDoubleTap(): Promise<void> {
  switch (page) {
    case 'platforms':
      cursor = 0;
      await switchPage('stops');
      return;
    case 'about':
    case 'diag':
      await switchPage(stopEntry && stop && choice ? 'main' : 'stops');
      return;
    default:
      // ルート画面のダブルタップは終了確認を出す（出さないと審査で落ちる。G2 Sky View と同じ）。
      await bridge?.shutDownPageContainer(1);
  }
}

async function handleEvent(event: EvenHubEvent): Promise<void> {
  const sys = event.sysEvent;
  if (sys?.eventType === OsEventTypeList.IMU_DATA_REPORT) return;
  const menuClick = event.menuItemClickEvent;
  if (menuClick?.itemID !== undefined) {
    await handleMenu(menuClick.itemID);
    return;
  }
  if (isDoubleClick(sys?.eventType) || isDoubleClick(event.textEvent?.eventType)) {
    await onDoubleTap();
    return;
  }
  // タップ・スワイプは textEvent と sysEvent のどちらでも来うる（G2PeakView の実測）。
  const source = event.textEvent ?? sys;
  if (!source) return;
  if (isScrollDown(source.eventType)) await onSwipe(1);
  else if (isScrollUp(source.eventType)) await onSwipe(-1);
  else if (isClick(source.eventType)) await onTap();
}

function wireBrowserControls(): void {
  document.querySelectorAll<HTMLButtonElement>('button[data-key]').forEach((button) => {
    button.addEventListener('click', () => {
      switch (button.dataset.key) {
        case 'prev': void onSwipe(-1); break;
        case 'next': void onSwipe(1); break;
        case 'tap': void onTap(); break;
        case 'dtap': void onDoubleTap(); break;
        case 'stop': void handleMenu(MENU.stop); break;
        case 'platform': void handleMenu(MENU.platform); break;
        case 'reset': void handleMenu(MENU.reset); break;
        case 'about': void handleMenu(MENU.about); break;
        case 'diag': void handleMenu(MENU.diag); break;
      }
    });
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') void onSwipe(-1);
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') void onSwipe(1);
    if (e.key === ' ') void onTap();
    if (e.key === 'Backspace') void onDoubleTap();
  });
}

/* ---------- 起動 ---------- */

/** 前回と同じ停留所・乗り場なら、選び直さずに接近ビューから始める。 */
async function resume(): Promise<boolean> {
  const saved = await loadSelection(host);
  if (!saved) return false;
  // 0.1.0 は停留所 ID だけ（大師橋駅前の '5010'）を保存していた。事業者をまとめる前の
  // 単独の鍵（'rinko:10'）なら、それを含むまとめたバス停で再開する。
  const key = saved.stopId.includes(':') ? saved.stopId : `rinko:${saved.stopId}`;
  const entry = INDEX.stops.find((s) => s.key === key) ?? INDEX.stops.find((s) => s.key.split('+').includes(key));
  if (!entry) return false;
  stopEntry = entry;
  lookRightDeg = saved.lookRightDeg;
  await loadStop(entry);
  choice = stop ? (platformChoices(stop).find((c) => c.id === saved.choiceId) ?? null) : null;
  return choice !== null;
}

async function main(): Promise<void> {
  wireBrowserControls();
  bridge = await waitForEvenAppBridge().catch(() => null);
  sender = new FrameSender(bridge, [IMG_L, IMG_R]);
  if (bridge) {
    host = { get: (key) => bridge!.getLocalStorage(key), set: (key, value) => bridge!.setLocalStorage(key, value) };
  }

  const resumed = await resume();
  if (resumed) {
    page = 'main';
    await poll(true);
  }
  if (bridge) {
    const result = await bridge.createStartUpPageContainer(new CreateStartUpPageContainer(containersFor(page)));
    if (result !== StartUpPageCreateResult.success) console.warn('page create', StartUpPageCreateResult[result] ?? result);
    bridge.onEvenHubEvent((event) => void handleEvent(event));
    try {
      const fix = await bridge.getAppLocation({ accuracy: AppLocationAccuracy.High, timeoutMs: 10_000 });
      if (fix) location = { lat: fix.latitude, lng: fix.longitude };
    } catch (error) {
      console.warn('location failed', error);
    }
  }
  await render();

  // カウントダウンは分単位なので 5 秒ごとに描き直せば足りる。画像は変わったときだけ送られる。
  setInterval(() => {
    void (async () => {
      // 時刻表はその日に走る便だけなので、日付が変わったら取り直す。
      if (stopEntry && stop && jstDay(Date.now()).ymd !== stopDay) await loadStop(stopEntry);
      if (page === 'main') await poll();
      await render();
    })();
  }, 5000);
}

void main();
