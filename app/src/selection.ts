/**
 * 選んだ停留所・乗り場と視線の角度の記憶（Tokyojihatsu app/src/selection.ts と同じ理屈）。
 *
 * 保存先は WebView の localStorage とホスト側の両方。ロック復帰で WebView が
 * 作り直される可能性があるため。新しい方を採る。
 */

export interface StoredSelection {
  version: 1;
  stopId: string;
  choiceId: string;
  lookRightDeg: number;
  savedAt: number;
}

export interface HostStorage {
  get(key: string): Promise<string>;
  set(key: string, value: string): Promise<boolean>;
}

const KEY = 'odpt2026-bus.selection.v1';

function parse(raw: string | null | undefined): StoredSelection | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<StoredSelection> | null;
    if (!parsed || parsed.version !== 1) return null;
    if (typeof parsed.stopId !== 'string' || typeof parsed.choiceId !== 'string') return null;
    if (typeof parsed.lookRightDeg !== 'number') return null;
    return parsed as StoredSelection;
  } catch {
    return null;
  }
}

export async function loadSelection(host: HostStorage | null): Promise<StoredSelection | null> {
  let web: StoredSelection | null = null;
  try {
    web = parse(localStorage.getItem(KEY));
  } catch {
    web = null;
  }
  let hostSaved: StoredSelection | null = null;
  if (host) {
    try {
      hostSaved = parse(await host.get(KEY));
    } catch {
      hostSaved = null;
    }
  }
  if (web && hostSaved) return web.savedAt >= hostSaved.savedAt ? web : hostSaved;
  return web ?? hostSaved;
}

export async function saveSelection(selection: Omit<StoredSelection, 'version' | 'savedAt'>, host: HostStorage | null): Promise<void> {
  const raw = JSON.stringify({ ...selection, version: 1, savedAt: Date.now() } satisfies StoredSelection);
  try {
    localStorage.setItem(KEY, raw);
  } catch {
    // 書けなくても動作は続ける
  }
  if (host) {
    try {
      await host.set(KEY, raw);
    } catch {
      // 同上
    }
  }
}
