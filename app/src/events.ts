/*
 * G2PeakView（app/src/events.ts, 2026-09-26 時点）から複製。
 */

/**
 * 入力イベントの判定（Tokyojihatsu app/src/events.ts と同じ理屈）。
 *
 * SDK は CLICK_EVENT（値 0）を undefined に正規化することがあるので、
 * undefined もタップとして扱う。ダブルタップは sysEvent で届く（実測）。
 */

import { OsEventTypeList } from '@evenrealities/even_hub_sdk';

export const isClick = (t: OsEventTypeList | undefined): boolean => t === OsEventTypeList.CLICK_EVENT || t === undefined;
export const isDoubleClick = (t: OsEventTypeList | undefined): boolean => t === OsEventTypeList.DOUBLE_CLICK_EVENT;
export const isScrollUp = (t: OsEventTypeList | undefined): boolean => t === OsEventTypeList.SCROLL_TOP_EVENT;
export const isScrollDown = (t: OsEventTypeList | undefined): boolean => t === OsEventTypeList.SCROLL_BOTTOM_EVENT;
