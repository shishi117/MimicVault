/**
 * background.js  (v0.18.0 — ステップ19)
 *
 * ステップ18で追加:
 *   - 設定システム（browser.storage.local の "ms_settings"）
 *     SETTINGS_DEFAULTS / settingsCache / loadSettings() / storage.onChanged
 *   - ドメインフィルタ: isDomainFiltered() + matchDomainPattern()
 *     ワイルドカード対応（*.example.com / example.*）
 *   - ダウンロードファイル名プレフィックス: applyFilenamePrefix()
 *   - 検出ロジックへの設定反映:
 *     ・handleNetworkResponse : minSizeKB + blacklist/whitelist
 *     ・MEDIA_FOUND / MEDIA_FOUND_BLOB : blacklist/whitelist
 *   - ダウンロードファイル名生成にプレフィックス適用（直接DL / HLS / DASH / live）
 *   - connectCompanion() が companionEnabled 設定でゲート
 *     設定変更時に companion を自動切断/再接続
 */

"use strict";

// ─── 定数 ────────────────────────────────────────────────────────────────────

/** メディアと判断する Content-Type */
const MEDIA_MIME_RE = /^(video|audio)\//i;

/** HLS / DASH マニフェスト系の Content-Type */
const MANIFEST_MIME_RE = /^application\/(x-mpegurl|vnd\.apple\.mpegurl|dash\+xml)/i;

/** URL 拡張子ベースの判定（MIME が不正確なサーバー対策） */
const MEDIA_URL_RE = /\.(mp4|webm|mkv|mov|m4v|ogg|ogv|ts|m2ts|m3u8|mpd|m4s|m4a|mp3|aac|flac|opus|wav)(\?|#|$)/i;

/** 誤検知を防ぐための除外 MIME */
const EXCLUDE_MIME_RE = /^(image|text|font|application\/(javascript|json|xml$))/i;

/** Content-Length が取れる場合の最小サイズ（1 KB）*/
const MIN_CONTENT_LENGTH = 1024;

// ─── 設定（ステップ18） ───────────────────────────────────────────────────────
/**
 * 設定は options ページから browser.storage.local に保存される。
 * background からは同期的に参照できるようキャッシュを保持し、
 * storage.onChanged で更新する。
 *
 * スキーマは options/options.js の DEFAULTS と一致させる。
 */

const SETTINGS_STORAGE_KEY = "ms_settings";

const SETTINGS_DEFAULTS = Object.freeze({
  minSizeKB:        1,
  blacklist:        [],
  whitelist:        [],
  hlsPreferred:     "highest",
  filenameTemplate: "%title",
  companionEnabled: true,
});

/** メモリ上のキャッシュ。初期化完了までデフォルトを返す */
let settingsCache = { ...SETTINGS_DEFAULTS };

/** 起動時ロード */
async function loadSettings() {
  try {
    const stored = await browser.storage.local.get(SETTINGS_STORAGE_KEY);
    const saved  = stored[SETTINGS_STORAGE_KEY] ?? {};
    settingsCache = { ...SETTINGS_DEFAULTS, ...saved };
  } catch (err) {
    console.warn("[ms] failed to load settings:", err);
    settingsCache = { ...SETTINGS_DEFAULTS };
  }
}

function getSettings() { return settingsCache; }

// options ページからの変更を反映
browser.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes[SETTINGS_STORAGE_KEY]) return;
  const prevEnabled = settingsCache.companionEnabled;
  const newVal = changes[SETTINGS_STORAGE_KEY].newValue ?? {};
  settingsCache = { ...SETTINGS_DEFAULTS, ...newVal };

  // companion 機能 ON/OFF が切り替わった場合の処理
  const newEnabled = settingsCache.companionEnabled !== false;
  if (prevEnabled !== newEnabled && typeof companionPort !== "undefined") {
    if (!newEnabled && companionPort) {
      // 無効化 → 切断
      try { companionPort.disconnect(); } catch (_) {}
      companionPort = null;
      companionStatus = "disabled";
      broadcastCompanionStatus();
    } else if (newEnabled && !companionPort) {
      // 有効化 → 再接続を試みる
      connectCompanion();
    }
  }
});

// 背景スクリプト起動時に即座にロード開始（非永続背景のため fire-and-forget）
loadSettings();

// ─── ワイルドカード ドメイン照合 ──────────────────────────────────────────────
/**
 * `*` を含むドメインパターンをホスト名に照合する。
 *
 * 対応:
 *   - `example.com`       → 完全一致のみ
 *   - `*.example.com`     → foo.example.com / bar.baz.example.com にマッチ
 *                            （example.com 自身にはマッチしない）
 *   - `example.*`         → example.com / example.co.jp にマッチ
 *   - `*.foo.*`           → a.foo.com, b.foo.jp 等にマッチ
 *
 * 比較は小文字で行う。パターンが空なら false を返す。
 *
 * @param {string} hostname - 照合対象のホスト名
 * @param {string} pattern  - 照合パターン
 */
function matchDomainPattern(hostname, pattern) {
  if (!hostname || !pattern) return false;
  const h = hostname.toLowerCase();
  const p = pattern.trim().toLowerCase();
  if (!p) return false;
  if (!p.includes("*")) return h === p;

  // `*` → 正規表現の `[^.]+` （ドット以外の1文字以上）に変換
  // それ以外の特殊文字をエスケープ
  const re = "^" + p.split("*").map(escapeRegex).join("[^.]+") + "$";
  try {
    return new RegExp(re).test(h);
  } catch (_) {
    return false;
  }
}

function escapeRegex(s) {
  return s.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
}

/** URL からホスト名を取り出す（失敗時は空文字列） */
function hostnameOf(url) {
  try { return new URL(url).hostname.toLowerCase(); }
  catch (_) { return ""; }
}

/**
 * 設定に基づいてこの URL を検出対象から除外すべきか判定する。
 *
 * ロジック:
 *   1. ホワイトリストが空でない場合: ホワイトリストにマッチしない URL はすべて除外
 *   2. ブラックリストにマッチする URL は除外
 *   3. それ以外は通過
 */
function isDomainFiltered(url) {
  const host = hostnameOf(url);
  if (!host) return false;  // URL パース失敗時は通過（過剰な除外を避ける）

  const { blacklist, whitelist } = settingsCache;

  if (Array.isArray(whitelist) && whitelist.length > 0) {
    const matched = whitelist.some(pat => matchDomainPattern(host, pat));
    if (!matched) return true;
  }

  if (Array.isArray(blacklist) && blacklist.length > 0) {
    if (blacklist.some(pat => matchDomainPattern(host, pat))) return true;
  }

  return false;
}

// ─── ファイル名テンプレート展開（v0.18.0） ────────────────────────────────────
/**
 * 設定の filenameTemplate を展開してファイル名を生成する。
 *
 * 対応変数:
 *   %title — URL パスの末尾ステム（拡張子なし）。inferStem() で取得。
 *
 * テンプレート自体に含まれる OS 非対応文字は `_` に置換する。
 * ディレクトリセパレータ `/` は保持する。
 *
 * @param {string} stem - URL から抽出したステム文字列（拡張子なし）
 * @param {string} ext  - 付与する拡張子（"mp4" 等。ドットなし）
 */
function applyFilenameTemplate(stem, ext) {
  const tmpl = settingsCache.filenameTemplate;
  const template = (tmpl && typeof tmpl === "string") ? tmpl : "%title";

  // %title を stem に展開
  const safeStem = sanitizeFilename(stem || "media");
  let name = template.replace(/%title/g, safeStem);

  // テンプレート残余のサニタイズ（/ は許容）
  name = name.replace(/[\\:*?"<>|]/g, "_").replace(/^[\s.]+|[\s.]+$/g, "").trim() || "media";

  return ext ? `${name}.${ext}` : name;
}

/** ファイル名として使えない文字を除去する */
function sanitizeFilename(s) {
  return s.replace(/[/\\:*?"<>|]/g, "_").replace(/^[\s.]+|[\s.]+$/g, "").trim() || "media";
}

// 後方互換エイリアス（旧 applyFilenamePrefix の呼び出しは下記で置き換え済み）

// ─── タブ別メディアストア ─────────────────────────────────────────────────────

const tabMediaStore = {};

function getStore(tabId) {
  if (!tabMediaStore[tabId]) tabMediaStore[tabId] = new Map();
  return tabMediaStore[tabId];
}

function addToStore(tabId, item) {
  const store = getStore(tabId);
  if (store.has(item.url)) return false;
  store.set(item.url, item);
  updateBadge(tabId, store.size);
  return true;
}

// ─── Referer 注入用ペンディングマップ ────────────────────────────────────────
/**
 * ダウンロード開始直前に登録し、onBeforeSendHeaders で注入後に削除する。
 * key:   ダウンロード対象 URL
 * value: 注入する Referer 値（元ページの URL）
 *
 * 注意: URL が全く同じファイルを同時にダウンロードするケースは稀だが、
 *       その場合も最後に登録された Referer が使われる（許容範囲）。
 */
const pendingReferers = new Map();

// ─── バッジ制御 ───────────────────────────────────────────────────────────────

function updateBadge(tabId, count) {
  const text = count > 0 ? String(count) : "";
  browser.browserAction.setBadgeText({ text, tabId });
  browser.browserAction.setBadgeBackgroundColor({ color: "#5f4dbc", tabId });
}

// ─── メッセージルーター（v0.1.0 の2つの addListener を統合） ─────────────────

browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {

    case "MEDIA_FOUND": {
      const tabId = sender.tab?.id;
      if (!tabId) break;
      for (const item of message.items) {
        // ステップ18: ドメインブラック/ホワイトリストで除外
        if (isDomainFiltered(item.url)) continue;
        addToStore(tabId, { ...item, source: "dom" });
      }
      break;
    }

    // ステップ13: fetch / XHR monkey-patch 経由で content-early.js から届く通知
    case "MEDIA_FOUND_BLOB": {
      const tabId = sender.tab?.id;
      if (!tabId) break;
      const { url, mimeHint, pageURL } = message;
      if (!url) break;
      // blob: / data: URL は background からアクセス不可なので除外
      if (url.startsWith("blob:") || url.startsWith("data:")) break;
      // ステップ18: ドメインブラック/ホワイトリストで除外
      if (isDomainFiltered(url)) break;
      addToStore(tabId, {
        url,
        source:        "blob",
        tag:           resolveTag(mimeHint ?? ""),
        mimeHint:      mimeHint ?? "",
        contentLength: null,   // fetch/XHR では Content-Length が不明な場合が多い
        pageTitle:     "",     // document_start のため title 取得不可
        pageURL:       pageURL ?? "",
        detectedAt:    Date.now(),
      });
      break;
    }

    case "GET_MEDIA_LIST": {
      const store = getStore(message.tabId);
      sendResponse({ items: [...store.values()] });
      return true;
    }

    // ポップアップの「ダウンロード」ボタンからの要求
    case "DOWNLOAD_MEDIA": {
      const { url, mimeHint, pageURL } = message;
      const stem = inferStem(url);
      const ext  = inferExt(url, mimeHint);
      const filename = applyFilenameTemplate(stem, ext);

      // Referer として使う pageURL をペンディングマップに登録
      // onBeforeSendHeaders がリクエストを捕まえたら注入して削除する
      if (pageURL) pendingReferers.set(url, pageURL);

      browser.downloads.download({ url, filename })
        .then(downloadId => sendResponse({ ok: true, downloadId }))
        .catch(err => {
          pendingReferers.delete(url); // 失敗時はマップをクリーンアップ
          sendResponse({ ok: false, error: err.message });
        });
      return true;
    }

    // バリアントの ↓DL ボタンからの HLS セグメントダウンロード要求
    case "DOWNLOAD_HLS_SEGMENTS": {
      const { url, pageURL, tabId } = message;
      downloadHlsSegments(url, pageURL, tabId)
        .then(result => sendResponse(result))
        .catch(err   => sendResponse({ ok: false, error: err.message }));
      return true;
    }

    // .mpd アイテムをクリックしたときの DASH 情報取得リクエスト（ステップ11）
    case "FETCH_DASH_INFO": {
      const { url, pageURL } = message;
      fetchDashInfo(url, pageURL)
        .then(result => sendResponse(result))
        .catch(err   => sendResponse({ ok: false, error: err.message }));
      return true;
    }

    // DASH トラックのセグメントダウンロード要求（ステップ12）
    case "DOWNLOAD_DASH_TRACK": {
      downloadDashTrack(message)
        .then(result => sendResponse(result))
        .catch(err   => sendResponse({ ok: false, error: err.message }));
      return true;
    }

    // DASH 映像+音声をまとめて DL して companion で mux する
    case "DOWNLOAD_DASH_MUX": {
      downloadDashAndMux(message)
        .then(result => sendResponse(result))
        .catch(err   => sendResponse({ ok: false, error: err.message }));
      return true;
    }

    // m3u8 アイテムをクリックしたときのバリアント取得リクエスト
    case "FETCH_HLS_VARIANTS": {
      const { url, pageURL } = message;
      fetchHlsVariants(url, pageURL)
        .then(result => sendResponse(result))
        .catch(err   => sendResponse({ ok: false, error: err.message }));
      return true;
    }

    // content.js から届いたサムネイル dataURL をストアに保存
    case "SET_THUMBNAIL": {
      const { tabId, url, dataURL } = message;
      const store = getStore(tabId);
      const item  = store.get(url);
      if (item) {
        item.thumbnail = dataURL;
        store.set(url, item);
      }
      sendResponse({ ok: true });
      return true;
    }

    // 全件一括ダウンロード（コンパニオンボタン）
    case "DOWNLOAD_MEDIA_ALL": {
      const { tabId: allTabId } = message;
      const store = getStore(allTabId);
      const items = [...store.values()];

      // 分類（URL / mimeHint ベース。popup 側と同じ判定基準）
      const isHls  = it => /\.m3u8(\?|#|$)/i.test(it.url) || (it.mimeHint || "").includes("mpegurl");
      const isDash = it => /\.mpd(\?|#|$)/i.test(it.url)  || (it.mimeHint || "").includes("dash+xml");
      const isTs   = it => /\.ts(\?|#|$)/i.test(it.url)   || (it.mimeHint || "").includes("mp2t");
      const hasHls = items.some(isHls);

      const results    = [];  // 直接DL結果
      const skipped    = [];  // スキップ通知用 { url, reason }
      let   converting = 0;   // companion 変換に回した件数

      const promises = [];
      for (const item of items) {
        if (isHls(item)) {
          // HLS: companion 接続時のみ変換に回す（未接続はスキップ＋通知）
          if (companionPort) {
            // 長時間かかるため await しない。companion が Downloads に直接書き出す。
            // 進捗/失敗は HLS_DOWNLOAD_PROGRESS 経路で表面化する。
            // 既知の簡略化: 複数 HLS があると FFmpeg が同時起動する（通常1本なので許容）。
            downloadHlsViaCompanion(item.url, item.pageURL || "")
              .catch(err => console.warn("[全DL] HLS 変換失敗:", item.url, err.message));
            converting++;
          } else {
            skipped.push({ url: item.url, reason: "companion未接続" });
          }
        } else if (isDash(item)) {
          // DASH は映像/音声トラック選択が必要なため全DL対象外（個別に変換）
          skipped.push({ url: item.url, reason: "DASH（個別に変換）" });
        } else if (isTs(item) && hasHls) {
          // m3u8 がある = この .ts はそのストリームのセグメント。HLS 変換でまとめて
          // 取得されるので個別DLしない（一覧でも隠している）。
          continue;
        } else {
          // 通常ファイル（mp4 等）と、m3u8 の無い単独 .ts は従来通り直接DL
          const filename = applyFilenameTemplate(inferStem(item.url), inferExt(item.url, item.mimeHint));
          if (item.pageURL) pendingReferers.set(item.url, item.pageURL);
          promises.push(
            browser.downloads.download({ url: item.url, filename })
              .then(dlId => results.push({ url: item.url, ok: true, downloadId: dlId }))
              .catch(err => {
                pendingReferers.delete(item.url);
                results.push({ url: item.url, ok: false, error: err.message });
              })
          );
        }
      }

      Promise.all(promises)
        .then(() => sendResponse({ ok: true, results, skipped, converting }))
        .catch(() => sendResponse({ ok: true, results, skipped, converting }));
      return true;
    }

    // ポップアップの「クリア」ボタンからの要求
    case "CLEAR_MEDIA_LIST": {
      delete tabMediaStore[message.tabId];
      updateBadge(message.tabId, 0);
      sendResponse({ ok: true });
      return true;
    }

    // ─── ステップ10: ライブ録画 ───────────────────────────────────────────

    // ポップアップの「■ 停止」ボタンからの要求
    case "STOP_LIVE_RECORDING": {
      stopLiveRecording(message.url)
        .then(result => sendResponse(result))
        .catch(err   => sendResponse({ ok: false, error: err.message }));
      return true;
    }

    // ポップアップ再表示時に進行中セッション一覧を返す
    case "GET_LIVE_SESSIONS": {
      const sessions = [...liveRecordingSessions.values()].map(s => ({
        url:           s.url,
        state:         s.state,
        totalSegments: s.totalSegments,
        chunkIndex:    s.chunkIndex,
        stem:          s.stem,
      }));
      sendResponse({ sessions });
      return true;
    }

    default:
      break;
  }
});

// ─── webRequest — Referer 注入（ステップ6） ──────────────────────────────────
/**
 * browser.downloads.download() はカスタムリクエストヘッダを指定する API を持たない。
 * そのため onBeforeSendHeaders（blocking）でリクエストを横取りし、
 * pendingReferers に登録されている URL なら Referer を書き換えて返す。
 *
 * extraInfoSpec に "blocking" と "requestHeaders" が必要。
 * これが MV2 を選んだ理由のひとつ（MV3 では blocking が使えない）。
 */
browser.webRequest.onBeforeSendHeaders.addListener(
  (details) => {
    const referer = pendingReferers.get(details.url);
    if (!referer) return {}; // 対象外のリクエストはそのまま通す

    // 注入は1回だけでよいので即削除
    pendingReferers.delete(details.url);

    const headers = details.requestHeaders ?? [];

    // 既存の Referer ヘッダがあれば上書き、なければ追加
    const idx = headers.findIndex(h => h.name.toLowerCase() === "referer");
    if (idx >= 0) {
      headers[idx].value = referer;
    } else {
      headers.push({ name: "Referer", value: referer });
    }

    return { requestHeaders: headers };
  },
  { urls: ["<all_urls>"] },
  ["blocking", "requestHeaders"]
);

// ─── webRequest — ネットワーク傍受（ステップ2 のメイン追加） ─────────────────

/**
 * onResponseStarted を使う理由:
 *   onBeforeRequest の時点では Content-Type ヘッダがまだ存在しない。
 *   ヘッダが揃ったこのタイミングで MIME + URL の両方を検査する。
 *
 * 監視するリソースタイプ:
 *   "media"          — <video src> / <audio src> 等のメディア要素
 *   "xmlhttprequest" — XHR 経由フェッチ（HLS セグメントなど）
 *   "object"         — <object> / <embed> 系
 *   "other"          — fetch() API 経由など
 */
browser.webRequest.onResponseStarted.addListener(
  handleNetworkResponse,
  {
    urls: ["<all_urls>"],
    types: ["media", "xmlhttprequest", "object", "other"],
  },
  ["responseHeaders"]
);

function handleNetworkResponse(details) {
  // tabId === -1 は拡張機能自身のバックグラウンドリクエスト（除外）
  if (details.tabId === -1) return;

  const { url, tabId, responseHeaders = [] } = details;

  // ステップ18: ドメインブラック/ホワイトリストで除外
  if (isDomainFiltered(url)) return;

  const contentType   = getHeader(responseHeaders, "content-type") ?? "";
  const contentLength = Number(getHeader(responseHeaders, "content-length") ?? -1);

  // 除外: 明らかに非メディアな MIME
  if (EXCLUDE_MIME_RE.test(contentType)) return;

  // 除外: サイズが取れていて最小値未満
  // ステップ18: 設定の minSizeKB を優先（0 の場合は無制限 = 下限なし）
  const minBytes = Math.max(0, (settingsCache.minSizeKB ?? 0) * 1024);
  if (contentLength > 0 && minBytes > 0 && contentLength < minBytes) return;
  // 従来のハード下限は minSizeKB が 0 の場合にのみ適用（保険）
  if (minBytes === 0 && contentLength > 0 && contentLength < MIN_CONTENT_LENGTH) return;

  const isMimeMedia    = MEDIA_MIME_RE.test(contentType);
  const isMimeManifest = MANIFEST_MIME_RE.test(contentType);
  const isUrlMedia     = MEDIA_URL_RE.test(url);

  if (!isMimeMedia && !isMimeManifest && !isUrlMedia) return;

  // "video/mp4; codecs=avc1.64001f" → "video/mp4" に正規化
  const mimeHint = (isMimeMedia || isMimeManifest)
    ? contentType.split(";")[0].trim()
    : inferMimeFromUrl(url);

  addToStore(tabId, {
    url,
    source:        "network",
    tag:           resolveTag(mimeHint),
    mimeHint,
    contentLength: contentLength > 0 ? contentLength : null,  // null = 不明
    pageTitle:     "",
    pageURL:       details.documentUrl ?? "",
    detectedAt:    Date.now(),
  });
}

// ─── ヘルパー ─────────────────────────────────────────────────────────────────

function getHeader(headers, name) {
  const lower = name.toLowerCase();
  return headers.find(h => h.name.toLowerCase() === lower)?.value ?? null;
}

function inferMimeFromUrl(url) {
  const ext = (url.match(/\.([a-z0-9]+)(\?|#|$)/i) ?? [])[1]?.toLowerCase();
  const table = {
    mp4: "video/mp4",   webm: "video/webm",  mkv: "video/x-matroska",
    mov: "video/quicktime", m4v: "video/mp4", ogg: "video/ogg",
    ogv: "video/ogg",   ts: "video/mp2t",    m2ts: "video/mp2t",
    m4s: "video/iso.segment", m3u8: "application/x-mpegURL",
    mpd: "application/dash+xml", mp3: "audio/mpeg",
    aac: "audio/aac",   flac: "audio/flac",  opus: "audio/opus",
    m4a: "audio/mp4",   wav: "audio/wav",
  };
  return table[ext] ?? "video/*";
}

function resolveTag(mime) {
  return /^audio\//i.test(mime) ? "audio" : "video";
}

// ─── HLS Master Playlist パーサ（ステップ7） ─────────────────────────────────

/**
 * m3u8 URL を fetch してパースし、バリアント一覧を返す。
 *
 * 成功: { ok: true,  variants: [{ url, bandwidth, resolution, codecs }] }
 * 失敗: { ok: false, error: string }
 *
 * fetch 時に Referer を付けるため pendingReferers を流用する。
 */
async function fetchHlsVariants(url, pageURL) {
  // Referer を付けて fetch（onBeforeSendHeaders が注入する）
  if (pageURL) pendingReferers.set(url, pageURL);

  let text;
  try {
    const res = await fetch(url);
    pendingReferers.delete(url); // fetch 完了後にクリーンアップ
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    text = await res.text();
  } catch (err) {
    pendingReferers.delete(url);
    throw err;
  }

  // Master Playlist かどうかを確認
  // Media Playlist（セグメント一覧）には #EXTINF が含まれ、
  // #EXT-X-STREAM-INF は含まれない
  if (!isMasterPlaylist(text)) {
    return { ok: false, error: "not_master" };
  }

  const variants = parseMasterPlaylist(text, url);
  return { ok: true, variants };
}

/**
 * テキストが HLS Master Playlist かどうかを判定する。
 * Master Playlist には #EXT-X-STREAM-INF が含まれる。
 * Media Playlist には #EXTINF が含まれるが #EXT-X-STREAM-INF は含まれない。
 */
function isMasterPlaylist(text) {
  return text.includes("#EXT-X-STREAM-INF");
}

/**
 * Master Playlist をパースしてバリアント一覧を返す。
 *
 * HLS の Master Playlist 構造:
 *   #EXT-X-STREAM-INF:BANDWIDTH=4500000,RESOLUTION=1920x1080,CODECS="avc1.64001f,mp4a.40.2"
 *   https://example.com/1080p/index.m3u8
 *
 * - #EXT-X-STREAM-INF の次の行が必ずバリアントの URI になる
 * - URI は相対パスの場合があるので baseURL で絶対 URL に変換する
 * - BANDWIDTH 降順（高画質順）にソートして返す
 *
 * @param {string} text    - m3u8 テキスト
 * @param {string} baseURL - 相対 URI 解決に使う元 URL
 * @returns {{ url, bandwidth, resolution }[]}
 */
function parseMasterPlaylist(text, baseURL) {
  const variants = [];
  const lines = text.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line.startsWith("#EXT-X-STREAM-INF:")) continue;

    const attrs = line.slice("#EXT-X-STREAM-INF:".length);

    // BANDWIDTH=数値
    const bwMatch  = attrs.match(/BANDWIDTH=(\d+)/i);
    // RESOLUTION=WxH
    const resMatch = attrs.match(/RESOLUTION=(\d+x\d+)/i);

    const bandwidth  = bwMatch  ? parseInt(bwMatch[1],  10) : 0;
    const resolution = resMatch ? resMatch[1] : null;

    // 次の非空行が URI
    let uriLine = "";
    for (let j = i + 1; j < lines.length; j++) {
      const candidate = lines[j].trim();
      if (candidate && !candidate.startsWith("#")) {
        uriLine = candidate;
        break;
      }
    }
    if (!uriLine) continue;

    // 相対 URI を絶対 URL に変換
    let variantUrl;
    try {
      variantUrl = new URL(uriLine, baseURL).href;
    } catch (_) {
      continue; // パース失敗はスキップ
    }

    variants.push({ url: variantUrl, bandwidth, resolution });
  }

  // BANDWIDTH 降順（高画質順）にソート
  variants.sort((a, b) => b.bandwidth - a.bandwidth);
  return variants;
}

// ─── ダウンロード ヘルパー ────────────────────────────────────────────────────

/**
 * URL からファイル名ステム（拡張子なし）を取り出す。
 * %title テンプレート展開の基礎値として使用する。
 */
function inferStem(url) {
  try {
    const pathname = new URL(url).pathname;
    const raw = pathname.split("/").filter(Boolean).pop() ?? "";
    const name = raw.split("?")[0] || "media";
    return name.replace(/\.[a-z0-9]{2,5}$/i, "") || "media";
  } catch (_) { return "media"; }
}

/**
 * URL と MIME から拡張子文字列（ドットなし）を返す。
 */
function inferExt(url, mimeHint) {
  // URL に既知の拡張子があればそれを使う
  const m = url.match(/\.([a-z0-9]{2,5})(\?|#|$)/i);
  if (m) return m[1].toLowerCase();
  // なければ MIME から補完
  return mimeToExt(mimeHint ?? "");
}

/** MIME タイプ → 拡張子のマッピング */
function mimeToExt(mime) {
  const m = mime.split(";")[0].trim().toLowerCase();
  return {
    "video/mp4":               "mp4",
    "video/webm":              "webm",
    "video/x-matroska":        "mkv",
    "video/quicktime":         "mov",
    "video/ogg":               "ogv",
    "video/mp2t":              "ts",
    "video/iso.segment":       "m4s",
    "audio/mpeg":              "mp3",
    "audio/aac":               "aac",
    "audio/flac":              "flac",
    "audio/opus":              "opus",
    "audio/mp4":               "m4a",
    "audio/wav":               "wav",
    "audio/ogg":               "ogg",
    "application/x-mpegurl":   "m3u8",
    "application/vnd.apple.mpegurl": "m3u8",
    "application/dash+xml":    "mpd",
  }[m] ?? "";
}

// ─── HLS Media Playlist パーサ（ステップ9: AES-128 対応） ────────────────────

/**
 * Media Playlist テキストをパースしてセグメント URL リストを返す。
 *
 * 返り値:
 *   { error: "sample_aes" }
 *     — METHOD=SAMPLE-AES を検出（未対応）
 *   { keyInfo: null, mediaSequence: number, segments: string[] }
 *     — 暗号化なし
 *   { keyInfo: { method, uri, iv }, mediaSequence: number, segments: string[] }
 *     — AES-128 暗号化あり
 *
 * keyInfo:
 *   method  — "AES-128"（現在はこれのみ）
 *   uri     — キー取得先 URL（絶対 URL に変換済み）
 *   iv      — EXT-X-KEY:IV 属性の値（null の場合はシーケンス番号から算出）
 *
 * HLS 仕様では EXT-X-KEY はセグメントごとに切り替わり得るが、
 * 実用上は1プレイリスト内で同じキーが使われるケースがほとんど。
 * v0.9.0 では最初に登場した EXT-X-KEY を全セグメントに適用する。
 *
 * @param {string} text    - m3u8 テキスト
 * @param {string} baseURL - 相対 URI 解決に使う元 URL
 *
 * ステップ10 追加フィールド:
 *   ended          — #EXT-X-ENDLIST が存在する場合 true（VOD）、ない場合 false（ライブ）
 *   targetDuration — #EXT-X-TARGETDURATION の値（秒）。省略時は 6
 */
function parseMediaPlaylist(text, baseURL) {
  const lines = text.split(/\r?\n/);

  // ── ライブ / VOD 判定（ステップ10） ────────────────────────────────────────
  const ended = text.includes("#EXT-X-ENDLIST");

  // ── EXT-X-TARGETDURATION（ポーリング間隔の基準）──────────────────────────
  const tdMatch = text.match(/^#EXT-X-TARGETDURATION:(\d+)/m);
  const targetDuration = tdMatch ? parseInt(tdMatch[1], 10) : 6;

  // ── EXT-X-MEDIA-SEQUENCE（メディアシーケンス番号の初期値） ──────────────────
  // IV が指定されていない場合に AES-CBC の IV を算出するために使う
  // デフォルトは 0（仕様上の既定値）
  let mediaSequence = 0;
  const seqLine = lines.find(l => l.startsWith("#EXT-X-MEDIA-SEQUENCE:"));
  if (seqLine) {
    const n = parseInt(seqLine.split(":")[1], 10);
    if (!isNaN(n)) mediaSequence = n;
  }

  // ── EXT-X-KEY の解析 ────────────────────────────────────────────────────────
  let keyInfo = null;
  const keyLine = lines.find(l => l.startsWith("#EXT-X-KEY:"));

  if (keyLine) {
    const attrs = keyLine.slice("#EXT-X-KEY:".length);

    // METHOD=
    const methodMatch = attrs.match(/METHOD=([^,\s]+)/i);
    const method = methodMatch?.[1] ?? "";

    if (method === "SAMPLE-AES") {
      // SAMPLE-AES は DRM 管理が必要なため未対応
      return { error: "sample_aes" };
    }

    if (method === "AES-128") {
      // URI="..." — クォートを除去
      const uriMatch = attrs.match(/URI="([^"]+)"/i);
      const rawUri   = uriMatch?.[1] ?? "";
      let keyUri     = rawUri;
      try { keyUri = new URL(rawUri, baseURL).href; } catch (_) {}

      // IV=0x... — 省略可能。省略時は null にしてシーケンス番号で代替
      const ivMatch = attrs.match(/IV=0x([0-9a-f]+)/i);
      const iv      = ivMatch ? ivMatch[1].padStart(32, "0") : null;

      keyInfo = { method: "AES-128", uri: keyUri, iv };
    }
    // METHOD=NONE または未知の METHOD はキーなしとして扱う
  }

  // ── セグメント URI の抽出 ────────────────────────────────────────────────────
  const segments = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line.startsWith("#EXTINF:")) continue;

    for (let j = i + 1; j < lines.length; j++) {
      const candidate = lines[j].trim();
      if (!candidate || candidate.startsWith("#")) continue;
      try { segments.push(new URL(candidate, baseURL).href); } catch (_) {}
      break;
    }
  }

  return { keyInfo, mediaSequence, segments, ended, targetDuration };
}

// ─── AES-128 復号ユーティリティ（ステップ9） ─────────────────────────────────

/**
 * KEY URI から 16 バイトの AES-128 生キーを fetch し、
 * SubtleCrypto が扱える CryptoKey オブジェクトに変換して返す。
 *
 * Referer は pendingReferers 経由で onBeforeSendHeaders が注入する
 * （セグメント・プレイリストと同じ仕組み）。
 *
 * @param {string} keyUri  - EXT-X-KEY の URI（絶対 URL）
 * @param {string} pageURL - Referer として使う元ページ URL
 * @returns {Promise<CryptoKey>}
 */
async function fetchAesKey(keyUri, pageURL) {
  if (pageURL) pendingReferers.set(keyUri, pageURL);

  let keyBytes;
  try {
    const res = await fetch(keyUri);
    pendingReferers.delete(keyUri);
    if (!res.ok) throw new Error(`キー取得失敗: HTTP ${res.status}`);
    keyBytes = await res.arrayBuffer(); // 仕様上 16 バイト固定
  } catch (err) {
    pendingReferers.delete(keyUri);
    throw err;
  }

  // SubtleCrypto に渡せる CryptoKey に変換
  return crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "AES-CBC" },
    false,          // extractable: false（キーをエクスポートさせない）
    ["decrypt"]
  );
}

/**
 * AES-128-CBC でセグメントバイト列を復号して返す。
 *
 * IV の決定ルール（HLS RFC 8216 §4.3.2.4）:
 *   1. EXT-X-KEY に IV 属性がある → その値を使う（16 バイト固定）
 *   2. IV 属性がない → mediaSequence + segmentIndex を 128 ビット整数として使う
 *      例: seqBase=5, segIndex=2 → IV = 0x00000000000000000000000000000007
 *
 * @param {ArrayBuffer} encryptedBuf  - 暗号化された TS セグメントデータ
 * @param {CryptoKey}   cryptoKey     - fetchAesKey() で得た CryptoKey
 * @param {string|null} ivHex         - EXT-X-KEY の IV（16 進 32 桁）または null
 * @param {number}      seqBase       - #EXT-X-MEDIA-SEQUENCE の値
 * @param {number}      segIndex      - このセグメントのプレイリスト内インデックス（0 始まり）
 * @returns {Promise<ArrayBuffer>} - 復号後のバイト列
 */
async function decryptSegment(encryptedBuf, cryptoKey, ivHex, seqBase, segIndex) {
  // IV を 16 バイト Uint8Array に変換
  let ivBytes;
  if (ivHex) {
    // EXT-X-KEY の IV 属性を使う
    ivBytes = hexToBytes(ivHex.padStart(32, "0"));
  } else {
    // シーケンス番号ベース: (seqBase + segIndex) を 128 ビット big-endian で表現
    ivBytes = new Uint8Array(16);
    const seqNum = seqBase + segIndex;
    // 64 ビット整数の安全範囲内なので DataView で書き込める
    const view = new DataView(ivBytes.buffer);
    view.setUint32(12, seqNum >>> 0, false); // 下位 32 ビット
    // 上位ビットは 0 のまま（実用上 seqNum < 2^32）
  }

  return crypto.subtle.decrypt(
    { name: "AES-CBC", iv: ivBytes },
    cryptoKey,
    encryptedBuf
  );
}

/** 16 進文字列 → Uint8Array */
function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/**
 * HLS Media Playlist URL を受け取り、全セグメントを結合して DL する。
 *
 * フロー:
 *   1. Media Playlist を fetch してパース
 *   2. SAMPLE-AES → エラー返却。AES-128 → キーを fetch して CryptoKey 化
 *   3. 並列 fetch（最大 4 並列）でセグメントを取得
 *      AES-128 の場合は取得後に即 decryptSegment() で復号
 *      → 取得・復号完了のたびに popup へ HLS_DOWNLOAD_PROGRESS を送信
 *   4. ArrayBuffer を順序保持で結合し Blob を生成
 *   5. blobURL で browser.downloads.download を呼ぶ
 *
 * @param {string} mediaPlaylistUrl - Media Playlist（または単一 m3u8）の URL
 * @param {string} pageURL          - Referer として使う元ページ URL
 * @returns {Promise<{ ok: boolean, downloadId?: number, error?: string }>}
 */
async function downloadHlsSegments(mediaPlaylistUrl, pageURL, tabId) {
  // ── companion 接続時は master/media 問わず FFmpeg に丸投げ ──────────────────
  // FFmpeg はプレイリスト URL を直接受け取り、master なら画質を自動選択し、
  // セグメント取得・復号・結合・MP4 変換までを一括で行う。よって以降の
  // fetch / master 判定 / パースは不要。失敗時のみ下の非 companion フローへ落ちる。
  if (companionPort) {
    try {
      return await downloadHlsViaCompanion(mediaPlaylistUrl, pageURL);
    } catch (err) {
      console.warn("[Companion] HLS 変換失敗、フォールバックへ:", err.message);
    }
  }

  // ── 1. Media Playlist fetch ──────────────────────────────────────────────
  if (pageURL) pendingReferers.set(mediaPlaylistUrl, pageURL);

  let text;
  try {
    const res = await fetch(mediaPlaylistUrl);
    pendingReferers.delete(mediaPlaylistUrl);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    text = await res.text();
  } catch (err) {
    pendingReferers.delete(mediaPlaylistUrl);
    throw err;
  }

  // Master Playlist が渡された場合はエラー（バリアント選択が必要）
  if (isMasterPlaylist(text)) {
    return { ok: false, error: "master_playlist" };
  }

  // ── 2. パース & 暗号化キー取得 ───────────────────────────────────────────
  const parsed = parseMediaPlaylist(text, mediaPlaylistUrl);

  // SAMPLE-AES は未対応
  if (parsed.error === "sample_aes") {
    return { ok: false, error: "sample_aes" };
  }

  if (parsed.segments.length === 0) {
    return { ok: false, error: "no_segments" };
  }

  // ── ステップ10: ライブストリーム検出 ─────────────────────────────────────
  // companion なし or 失敗時のみライブ録画モードに移行する。
  // #EXT-X-ENDLIST がない = ライブ配信 → チャンク分割保存
  if (!parsed.ended) {
    return startLiveRecording(mediaPlaylistUrl, pageURL, parsed, tabId);
  }

  // ── VOD: 既存のセグメント一括ダウンロードフロー（blob / .ts）─────────────────
  let cryptoKey = null;
  if (parsed.keyInfo?.method === "AES-128") {
    try {
      cryptoKey = await fetchAesKey(parsed.keyInfo.uri, pageURL);
    } catch (err) {
      return { ok: false, error: `キー取得失敗: ${err.message}` };
    }
  }

  // ── 3. 並列セグメント fetch（＋必要なら復号） ─────────────────────────────
  const total = parsed.segments.length;

  // popup への進捗通知（popup が閉じていてもエラーにしない）
  const sendProgress = (current, t) => {
    browser.runtime.sendMessage({
      type:    "HLS_DOWNLOAD_PROGRESS",
      url:     mediaPlaylistUrl,
      current,
      total:   t,
    }).catch(() => {});
  };

  // 最初に 0/total を通知して UI をリセット
  sendProgress(0, total);

  // 暗号化あり・なしで worker の処理を分岐する
  const { keyInfo, mediaSequence, segments } = parsed;

  const buffers  = new Array(segments.length);
  let completed  = 0;
  let nextIdx    = 0;

  async function worker() {
    while (nextIdx < segments.length) {
      const idx = nextIdx++;
      const res = await fetch(segments[idx]);
      if (!res.ok) throw new Error(`セグメント ${idx} の取得失敗: HTTP ${res.status}`);
      const raw = await res.arrayBuffer();

      if (cryptoKey) {
        // AES-128-CBC 復号
        // IV は EXT-X-KEY の IV 属性 or (mediaSequence + idx) から算出
        buffers[idx] = await decryptSegment(
          raw, cryptoKey, keyInfo.iv, mediaSequence, idx
        );
      } else {
        buffers[idx] = raw;
      }

      completed++;
      sendProgress(completed, segments.length);
    }
  }

  try {
    const workerCount = Math.min(4, segments.length);
    await Promise.all(Array.from({ length: workerCount }, worker));
  } catch (err) {
    return { ok: false, error: err.message };
  }

  // ── 4. ArrayBuffer 結合 → Blob ────────────────────────────────────────────
  const totalBytes = buffers.reduce((sum, b) => sum + b.byteLength, 0);
  const combined   = new Uint8Array(totalBytes);
  let offset = 0;
  for (const buf of buffers) {
    combined.set(new Uint8Array(buf), offset);
    offset += buf.byteLength;
  }

  const blob    = new Blob([combined], { type: "video/mp2t" });
  const blobUrl = URL.createObjectURL(blob);

  // ── 5. ダウンロード開始 ───────────────────────────────────────────────────
  // HLS セグメント結合物は必ず MPEG-TS コンテナなので拡張子を .ts に強制する。
  // playlist URL が video.mp4?format=m3u8 のような形でも誤った .mp4 にならない。
  const hlsStem = inferStem(mediaPlaylistUrl);
  const filename = applyFilenameTemplate(hlsStem, "ts");

  let downloadId;
  try {
    downloadId = await browser.downloads.download({ url: blobUrl, filename });
  } catch (err) {
    URL.revokeObjectURL(blobUrl);
    return { ok: false, error: err.message };
  }

  // Blob URL はダウンロード完了後に解放（onChanged で revoke）
  // 安全のため最大 10 分のタイムアウトも設ける
  const revokeTimer = setTimeout(() => URL.revokeObjectURL(blobUrl), 10 * 60 * 1000);

  browser.downloads.onChanged.addListener(function onDlChanged(delta) {
    if (delta.id !== downloadId) return;
    const state = delta.state?.current;
    if (state === "complete" || state === "interrupted") {
      clearTimeout(revokeTimer);
      URL.revokeObjectURL(blobUrl);
      browser.downloads.onChanged.removeListener(onDlChanged);
    }
  });

  return { ok: true, downloadId };
}

// ─── HLS ライブ録画（ステップ10） ────────────────────────────────────────────

/**
 * 一度のフラッシュに蓄積するセグメント数。
 * 30 セグメント × 最大 6 秒 = 最大 3 分分をまとめて1ファイルにする。
 * ユーザーは stream_001.ts, stream_002.ts, ... として受け取る。
 */
const LIVE_CHUNK_SIZE = 30;

/**
 * ライブ録画セッションストア
 * key  : Media Playlist URL
 * value: LiveSession オブジェクト
 * {
 *   state         : "recording" | "stopping" | "stopped"
 *   url           : string
 *   pageURL       : string
 *   keyInfo       : null | { method, uri, iv }
 *   cryptoKey     : null | CryptoKey
 *   seenUrls      : Set<string>   — 取得済みセグメント URL
 *   buffer        : ArrayBuffer[] — 現チャンクの未フラッシュセグメント
 *   chunkIndex    : number        — フラッシュ済みチャンク数
 *   totalSegments : number        — 取得済み総セグメント数
 *   pollTimer     : number | null — setTimeout ハンドル
 *   targetDuration: number        — ポーリング間隔（秒）
 *   stem          : string        — ファイル名ステム
 * }
 */
const liveRecordingSessions = new Map();

/**
 * ライブ録画を開始する。
 *
 * 1. AES-128 キーを取得（失敗したらエラー返却）
 * 2. セッションを初期化して liveRecordingSessions に登録
 * 3. 初期セグメントを非同期処理（ブロックせず即返す）
 * 4. { ok: true, live: true } を返す
 *
 * @param {string} url          - Media Playlist URL
 * @param {string} pageURL      - Referer として使う元ページ URL
 * @param {object} initialParsed - parseMediaPlaylist の返り値
 */
async function startLiveRecording(url, pageURL, initialParsed, tabId) {
  // 二重起動防止
  if (liveRecordingSessions.has(url)) {
    return { ok: true, live: true }; // 既存セッションあり → OK として返す
  }

  // ── AES-128 キーを先に取得（失敗はここで検知）────────────────────────────
  let cryptoKey = null;
  if (initialParsed.keyInfo?.method === "AES-128") {
    try {
      cryptoKey = await fetchAesKey(initialParsed.keyInfo.uri, pageURL);
    } catch (err) {
      return { ok: false, error: `キー取得失敗: ${err.message}` };
    }
  }

  // ── ファイル名ステムを URL から推定 ────────────────────────────────────────
  let stem = "stream";
  try {
    const pathname = new URL(url).pathname;
    const raw = pathname.split("/").filter(Boolean).pop() ?? "";
    const s = raw.replace(/\.[^.]+$/, "") || "stream";
    stem = s.replace(/[/\\:*?"<>|]/g, "_");
  } catch (_) {}

  // ── セッション初期化 ────────────────────────────────────────────────────────
  const session = {
    state:          "recording",
    url,
    pageURL,
    tabId,          // タブ閉鎖時にこのセッションを停止するために保持
    keyInfo:        initialParsed.keyInfo,
    cryptoKey,
    seenUrls:       new Set(),
    buffer:         [],
    chunkIndex:     0,
    totalSegments:  0,
    pollTimer:      null,
    targetDuration: initialParsed.targetDuration ?? 6,
    stem,
  };
  liveRecordingSessions.set(url, session);

  // 初回プログレスを送信（ポップアップに「録画中」状態を表示）
  sendLiveProgress(session);

  // 初期セグメントをバックグラウンドで処理し、完了後にポーリング開始
  processNewSegments(session, initialParsed).then(() => {
    schedulePoll(url);
  }).catch(err => {
    console.error("[LiveRec] initial segment error:", err.message);
    schedulePoll(url); // エラーでもポーリングは続ける
  });

  return { ok: true, live: true };
}

/**
 * 次のポーリングを targetDuration 秒後にスケジュールする。
 */
function schedulePoll(url) {
  const session = liveRecordingSessions.get(url);
  if (!session || session.state !== "recording") return;
  session.pollTimer = setTimeout(() => pollLiveSession(url), session.targetDuration * 1000);
}

/**
 * プレイリストを再取得して新セグメントを処理する。
 * 処理完了後、EXT-X-ENDLIST がなければ次のポーリングをスケジュール。
 */
async function pollLiveSession(url) {
  const session = liveRecordingSessions.get(url);
  if (!session || session.state !== "recording") return;

  try {
    // プレイリストを Referer 付きで fetch
    if (session.pageURL) pendingReferers.set(url, session.pageURL);
    const res = await fetch(url);
    pendingReferers.delete(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();

    const parsed = parseMediaPlaylist(text, url);

    if (parsed.error) {
      // 想定外のエラー（SAMPLE-AES 等）→ 録画を停止
      session.state = "stopped";
      liveRecordingSessions.delete(url);
      sendLiveProgress({ ...session, state: "stopped" });
      return;
    }

    // EXT-X-TARGETDURATION を更新（サーバー側で変わるケースに対応）
    if (parsed.targetDuration) session.targetDuration = parsed.targetDuration;

    // 新セグメントを処理
    await processNewSegments(session, parsed);

    // EXT-X-ENDLIST 検出 → ストリーム終了
    if (parsed.ended) {
      await flushChunk(session);
      session.state = "stopped";
      liveRecordingSessions.delete(url);
      sendLiveProgress({ ...session, state: "ended" });
      return;
    }
  } catch (err) {
    // ポーリングエラーは記録して次のポーリングへ（接続一時断等は自動回復）
    console.error("[LiveRec] poll error:", err.message);
  }

  schedulePoll(url);
}

/**
 * パース済みプレイリストの未取得セグメントをフェッチ・復号・バッファに追加する。
 * LIVE_CHUNK_SIZE に達したら自動でチャンクをフラッシュする。
 *
 * @param {object} session - ライブ録画セッション
 * @param {object} parsed  - parseMediaPlaylist の返り値
 */
async function processNewSegments(session, parsed) {
  for (let i = 0; i < parsed.segments.length; i++) {
    if (session.state !== "recording") break;

    const segUrl = parsed.segments[i];
    if (session.seenUrls.has(segUrl)) continue; // 取得済みはスキップ
    session.seenUrls.add(segUrl);

    // セグメントの実際のメディアシーケンス番号（AES IV 計算に使う）
    const seqNum = parsed.mediaSequence + i;

    try {
      const segRes = await fetch(segUrl);
      if (!segRes.ok) throw new Error(`HTTP ${segRes.status}`);
      let buf = await segRes.arrayBuffer();

      // AES-128-CBC 復号（必要な場合）
      // seqNum を seqBase に、0 を segIndex に渡すことで IV = seqNum になる
      if (session.cryptoKey) {
        buf = await decryptSegment(
          buf, session.cryptoKey, session.keyInfo.iv, seqNum, 0
        );
      }

      session.buffer.push(buf);
      session.totalSegments++;

      // チャンクサイズに達したらフラッシュ
      if (session.buffer.length >= LIVE_CHUNK_SIZE) {
        await flushChunk(session);
      }

      sendLiveProgress(session);
    } catch (err) {
      console.error(`[LiveRec] segment ${i} (seq=${seqNum}) error:`, err.message);
      // 1セグメントの失敗は記録だけして続行
    }
  }
}

/**
 * バッファ内のセグメントを結合して Blob にし、チャンクファイルとしてダウンロードする。
 * バッファは空にして次のチャンクの蓄積を開始する。
 *
 * ファイル名例: stream_chunk001.ts, stream_chunk002.ts, ...
 *
 * @param {object} session - ライブ録画セッション
 */
async function flushChunk(session) {
  if (session.buffer.length === 0) return;

  session.chunkIndex++;

  // buffer を空にして取り出す（splice でメモリ解放）
  const buffers = session.buffer.splice(0);

  const totalBytes = buffers.reduce((s, b) => s + b.byteLength, 0);
  const combined   = new Uint8Array(totalBytes);
  let offset = 0;
  for (const b of buffers) {
    combined.set(new Uint8Array(b), offset);
    offset += b.byteLength;
  }

  const blob    = new Blob([combined], { type: "video/mp2t" });
  const blobUrl = URL.createObjectURL(blob);

  const chunkNum = String(session.chunkIndex).padStart(3, "0");
  const filename = applyFilenameTemplate(`${session.stem}_chunk${chunkNum}`, "ts");

  try {
    const dlId = await browser.downloads.download({ url: blobUrl, filename });

    // ダウンロード完了後に Blob URL を解放
    const revokeTimer = setTimeout(() => URL.revokeObjectURL(blobUrl), 10 * 60 * 1000);
    browser.downloads.onChanged.addListener(function onDone(delta) {
      if (delta.id !== dlId) return;
      const s = delta.state?.current;
      if (s === "complete" || s === "interrupted") {
        clearTimeout(revokeTimer);
        URL.revokeObjectURL(blobUrl);
        browser.downloads.onChanged.removeListener(onDone);
      }
    });
  } catch (err) {
    URL.revokeObjectURL(blobUrl);
    console.error("[LiveRec] chunk download error:", err.message);
  }

  sendLiveProgress(session);
}

/**
 * ライブ録画を停止する。
 * ポーリングタイマーをクリアし、バッファに残ったセグメントを最終チャンクとしてフラッシュする。
 *
 * @param {string} url - Media Playlist URL
 */
async function stopLiveRecording(url) {
  const session = liveRecordingSessions.get(url);
  if (!session) return { ok: false, error: "not_found" };

  // ポーリングを止める
  session.state = "stopping";
  if (session.pollTimer !== null) {
    clearTimeout(session.pollTimer);
    session.pollTimer = null;
  }

  // 残りセグメントを最終チャンクとして書き出す
  await flushChunk(session);

  session.state = "stopped";
  liveRecordingSessions.delete(url);
  sendLiveProgress({ ...session, state: "stopped" });

  return { ok: true };
}

/**
 * ポップアップへライブ録画の進捗を通知する。
 * ポップアップが閉じている場合は catch で無視する。
 *
 * @param {object} session - ライブ録画セッション（またはコピー）
 */
function sendLiveProgress(session) {
  browser.runtime.sendMessage({
    type:          "LIVE_RECORDING_PROGRESS",
    url:           session.url,
    state:         session.state,
    totalSegments: session.totalSegments,
    chunkIndex:    session.chunkIndex,
    stem:          session.stem,
  }).catch(() => {}); // ポップアップが閉じている場合は無視
}

// ─── DASH MPD パーサ（ステップ11） ───────────────────────────────────────────

/**
 * MPD URL を fetch してパースし、映像・音声トラック情報を返す。
 *
 * 成功: {
 *   ok: true,
 *   videoReps: [{ id, bandwidth, width, height, codecs, mimeType, segInfo }],
 *   audioReps: [{ id, bandwidth, lang, codecs, mimeType, segInfo }],
 *   baseURL: string,
 * }
 * 失敗: { ok: false, error: string }
 *
 * segInfo の型:
 *   { type: "template", initialization, media, duration, timescale, startNumber, baseURL }
 *   { type: "list",     initialization, segments: string[], baseURL }
 *   null — セグメント情報なし（ダウンロード不可）
 */
async function fetchDashInfo(url, pageURL) {
  if (pageURL) pendingReferers.set(url, pageURL);

  let text;
  try {
    const res = await fetch(url);
    pendingReferers.delete(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    text = await res.text();
  } catch (err) {
    pendingReferers.delete(url);
    throw err;
  }

  return parseMpd(text, url);
}

/**
 * MPD XML テキストをパースして映像・音声トラック情報を返す。
 *
 * 対応フォーマット:
 *   - SegmentTemplate（$Number$ / $Time$ テンプレート）
 *   - SegmentList（URL リスト形式）
 *
 * SegmentTemplate の優先順位:
 *   Representation 直下 > AdaptationSet 直下
 *
 * BaseURL の解決順序:
 *   MPD ルート > Period > AdaptationSet > Representation
 *
 * @param {string} xmlText - MPD XML テキスト
 * @param {string} mpdUrl  - MPD の元 URL（相対 URI 解決に使用）
 */
function parseMpd(xmlText, mpdUrl) {
  let doc;
  try {
    doc = new DOMParser().parseFromString(xmlText, "application/xml");
  } catch (_) {
    return { ok: false, error: "parse_failed" };
  }

  // パースエラー検出（Firefox は <parsererror> 要素として表現する）
  if (doc.documentElement.localName === "parsererror") {
    return { ok: false, error: "parse_failed" };
  }

  // ── ヘルパー: 直接の子要素を名前で取得 ─────────────────────────────────
  //
  // DOMParser が返す XML Document は名前空間付きなので querySelector が
  // 想定通りに動かない実装がある。localName で比較することで安全に処理する。
  //
  const firstChild  = (el, name) =>
    [...el.children].find(c => c.localName === name) ?? null;
  const allChildren = (el, name) =>
    [...el.children].filter(c => c.localName === name);

  // ── BaseURL の解決 ─────────────────────────────────────────────────────
  function resolveBase(el, fallback) {
    const buEl = firstChild(el, "BaseURL");
    if (!buEl) return fallback;
    try { return new URL(buEl.textContent.trim(), fallback).href; } catch (_) { return fallback; }
  }

  // MPD ルートレベルの BaseURL
  let rootBase = resolveBase(doc.documentElement, mpdUrl);

  // ── Period ─────────────────────────────────────────────────────────────
  const period = firstChild(doc.documentElement, "Period");
  if (!period) return { ok: false, error: "no_period" };

  const periodBase = resolveBase(period, rootBase);

  // ── SegmentTemplate パース ─────────────────────────────────────────────
  function parseSegTemplate(el, baseURL) {
    if (!el) return null;

    // SegmentTimeline（$Time$ テンプレート用の時刻・長さリスト）
    const tlEl = firstChild(el, "SegmentTimeline");
    let timeline = null;
    if (tlEl) {
      const entries = [];
      let currentTime = 0;
      for (const s of allChildren(tlEl, "S")) {
        const t = s.getAttribute("t");
        const d = parseInt(s.getAttribute("d") ?? "0", 10);
        const r = parseInt(s.getAttribute("r") ?? "0", 10);
        if (t !== null) currentTime = parseInt(t, 10);
        // r >= 0: そのセグメントを r+1 回分生成
        // r < 0:  仕様上は末尾まで繰り返しだが実用上稀なため 0 扱い
        const repeat = r >= 0 ? r : 0;
        for (let i = 0; i <= repeat; i++) {
          entries.push({ t: currentTime, d });
          currentTime += d;
        }
      }
      if (entries.length > 0) timeline = entries;
    }

    return {
      type:           "template",
      initialization: el.getAttribute("initialization") ?? "",
      media:          el.getAttribute("media")          ?? "",
      duration:       parseInt(el.getAttribute("duration")    ?? "0",  10),
      timescale:      parseInt(el.getAttribute("timescale")   ?? "1",  10),
      startNumber:    parseInt(el.getAttribute("startNumber") ?? "1",  10),
      baseURL,
      timeline,   // null | { t, d }[] — $Time$ テンプレート展開用
    };
  }

  // ── SegmentList パース ─────────────────────────────────────────────────
  function parseSegList(el, baseURL) {
    if (!el) return null;
    const initEl = firstChild(el, "Initialization");
    return {
      type:           "list",
      initialization: initEl ? (initEl.getAttribute("sourceURL") ?? "") : "",
      segments:       allChildren(el, "SegmentURL")
                        .map(s => s.getAttribute("media") ?? "")
                        .filter(Boolean),
      baseURL,
    };
  }

  // ── AdaptationSet / Representation を走査 ─────────────────────────────
  const videoReps = [];
  const audioReps = [];

  // ── 総再生時間（$Number$ テンプレートの総セグメント数算出に使用）──────────────
  // MPD 要素の mediaPresentationDuration → Period の duration の順で参照する
  const mpdAttrDur    = doc.documentElement.getAttribute("mediaPresentationDuration") ?? "";
  const periodAttrDur = period.getAttribute("duration") ?? "";
  const mpdDuration   = parseIsoDuration(mpdAttrDur) || parseIsoDuration(periodAttrDur);

  for (const as of allChildren(period, "AdaptationSet")) {
    const asMime    = as.getAttribute("mimeType") ?? as.getAttribute("contentType") ?? "";
    const lang      = as.getAttribute("lang")     ?? "";
    const asCodecs  = as.getAttribute("codecs")   ?? "";
    const asBase    = resolveBase(as, periodBase);

    // AdaptationSet レベルの SegmentTemplate / SegmentList
    const asSegTemplate = firstChild(as, "SegmentTemplate");
    const asSegList     = firstChild(as, "SegmentList");

    for (const rep of allChildren(as, "Representation")) {
      const id        = rep.getAttribute("id")        ?? "";
      const bandwidth = parseInt(rep.getAttribute("bandwidth") ?? "0", 10);
      const width     = parseInt(rep.getAttribute("width")     ?? "0", 10);
      const height    = parseInt(rep.getAttribute("height")    ?? "0", 10);
      const codecs    = rep.getAttribute("codecs")    ?? asCodecs;
      const repMime   = rep.getAttribute("mimeType")  ?? asMime;
      const repBase   = resolveBase(rep, asBase);

      // Representation レベルが優先。なければ AdaptationSet レベルを使う
      const repSegTemplate = firstChild(rep, "SegmentTemplate");
      const repSegList     = firstChild(rep, "SegmentList");

      let segInfo = null;
      if (repSegTemplate || asSegTemplate) {
        segInfo = parseSegTemplate(repSegTemplate ?? asSegTemplate, repBase);
      } else if (repSegList || asSegList) {
        segInfo = parseSegList(repSegList ?? asSegList, repBase);
      }

      const repInfo = { id, bandwidth, codecs, mimeType: repMime, segInfo };

      const isVideo = /^video/i.test(repMime) || /^video/i.test(asMime);
      const isAudio = /^audio/i.test(repMime) || /^audio/i.test(asMime);

      if (isVideo) {
        videoReps.push({ ...repInfo, width, height });
      } else if (isAudio) {
        audioReps.push({ ...repInfo, lang });
      }
      // mimeType が不明なものは無視（取得できるセグメントが判断できないため）
    }
  }

  // 帯域幅の降順（高品質順）でソート
  videoReps.sort((a, b) => b.bandwidth - a.bandwidth);
  audioReps.sort((a, b) => b.bandwidth - a.bandwidth);

  if (videoReps.length === 0 && audioReps.length === 0) {
    return { ok: false, error: "no_representations" };
  }

  return { ok: true, videoReps, audioReps, baseURL: periodBase, mpdDuration };
}

// ─── DASH VOD セグメントダウンロード（ステップ12） ────────────────────────────

/**
 * ISO 8601 duration 文字列（"PT1H30M0S" 等）を秒数に変換する。
 * MPD の mediaPresentationDuration / Period.duration の解析に使用。
 *
 * @param {string} str - ISO 8601 duration 文字列
 * @returns {number}   - 秒数（パース失敗は 0）
 */
function parseIsoDuration(str) {
  if (!str) return 0;
  const m = str.match(
    /P(?:\d+Y)?(?:\d+M)?(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:([\d.]+)S)?/
  );
  if (!m) return 0;
  return (parseFloat(m[1] || 0) * 86400)
       + (parseFloat(m[2] || 0) * 3600)
       + (parseFloat(m[3] || 0) * 60)
       + (parseFloat(m[4] || 0));
}

/**
 * DASH SegmentTemplate の media / initialization テンプレートを展開して
 * 絶対 URL を返す。
 *
 * 対応変数:
 *   $RepresentationID$ — rep の id 属性
 *   $Number$           — セグメント番号（startNumber 起点）
 *   $Number%05d$       — 0 埋めセグメント番号
 *   $Time$             — SegmentTimeline の t 値
 *   $Bandwidth$        — rep の bandwidth 属性
 *   $$                 — リテラルの "$"
 *
 * @param {string} template - テンプレート文字列
 * @param {object} vars     - 変数マップ
 * @param {string} baseURL  - 相対 URL 解決用
 * @returns {string}
 */
function resolveTemplateUrl(template, vars, baseURL) {
  // $$ を一時プレースホルダーに退避
  let result = template.replace(/\$\$/g, "\x00");

  for (const [key, value] of Object.entries(vars)) {
    // $key$ または $key%0Nd$（幅指定付き）
    result = result.replace(
      new RegExp(`\\$${key}(%0(\\d+)d)?\\$`, "g"),
      (_, _fmtSpec, widthStr) => {
        const num = typeof value === "number" ? value : parseInt(value, 10);
        return widthStr
          ? String(num).padStart(parseInt(widthStr, 10), "0")
          : String(value);
      }
    );
  }

  result = result.replace(/\x00/g, "$");

  try { return new URL(result, baseURL).href; } catch (_) { return result; }
}

/**
 * segInfo を基に init セグメント URL と media セグメント URL の配列を生成する。
 *
 * 対応フォーマット:
 *   SegmentTemplate + $Number$     : mpdDuration から総セグメント数を算出
 *   SegmentTemplate + $Time$       : SegmentTimeline の各 t 値を使用
 *   SegmentList                    : segInfo.segments を URL に変換
 *
 * @param {object} segInfo     - parseMpd の返す segInfo
 * @param {string} repId       - $RepresentationID$ 展開用
 * @param {number} bandwidth   - $Bandwidth$ 展開用
 * @param {number} mpdDuration - 総再生時間（秒）。$Number$ テンプレートの総数計算に使用
 * @returns {{ initUrl: string|null, segUrls: string[] }}
 */
function expandSegmentUrls(segInfo, repId, bandwidth, mpdDuration) {
  if (!segInfo) return { initUrl: null, segUrls: [] };

  const {
    type, initialization, media,
    duration, timescale, startNumber,
    baseURL, timeline,
  } = segInfo;

  const baseVars = { RepresentationID: repId, Bandwidth: bandwidth };

  // ── SegmentList ────────────────────────────────────────────────────────
  if (type === "list") {
    return {
      initUrl: initialization
        ? resolveTemplateUrl(initialization, baseVars, baseURL)
        : null,
      segUrls: (segInfo.segments ?? []).map(s =>
        resolveTemplateUrl(s, baseVars, baseURL)
      ),
    };
  }

  // ── SegmentTemplate ────────────────────────────────────────────────────
  const initUrl = initialization
    ? resolveTemplateUrl(initialization, baseVars, baseURL)
    : null;

  // $Time$ テンプレート（SegmentTimeline が存在する場合）
  if (media.includes("$Time$") && timeline?.length > 0) {
    return {
      initUrl,
      segUrls: timeline.map(({ t }) =>
        resolveTemplateUrl(media, { ...baseVars, Time: t }, baseURL)
      ),
    };
  }

  // $Number$ テンプレート（mpdDuration が既知の場合）
  if (media.includes("$Number$") && duration > 0 && timescale > 0 && mpdDuration > 0) {
    const totalSegs = Math.ceil(mpdDuration * timescale / duration);
    const segUrls   = [];
    for (let i = 0; i < totalSegs; i++) {
      segUrls.push(
        resolveTemplateUrl(media, { ...baseVars, Number: startNumber + i }, baseURL)
      );
    }
    return { initUrl, segUrls };
  }

  // duration / mpdDuration が不明 → セグメントなし
  return { initUrl, segUrls: [] };
}

/**
 * DASH Representation の全セグメントをダウンロードして結合し、ファイルとして保存する。
 *
 * 処理フロー:
 *   1. segInfo から init + media セグメント URL を展開
 *   2. init セグメントを fetch（moov ボックスを含む MP4 ヘッダー）
 *   3. media セグメント（.m4s）を並列 fetch（最大 4 並列）
 *      完了するたびに DASH_DOWNLOAD_PROGRESS を popup へ通知
 *   4. [init, seg1, seg2, ...] を順序保持で結合し Blob 化
 *   5. browser.downloads.download で保存
 *      映像トラック → .mp4 / 音声トラック → .m4a
 *
 * ⚠ 映像と音声は別ファイルに保存される。
 *   mux（統合）は Step 17（FFmpeg companion）で実装予定。
 *
 * @param {object} params
 * @param {object} params.rep          - Representation（id, bandwidth, segInfo を含む）
 * @param {string} params.mpdUrl       - MPD の元 URL（進捗通知キー・ファイル名生成に使用）
 * @param {number} params.mpdDuration  - MPD 総再生時間（秒）
 * @param {"video"|"audio"} params.trackType
 * @param {string} params.pageURL      - Referer 用の元ページ URL
 */
async function downloadDashTrack({ rep, mpdUrl, mpdDuration, trackType, pageURL }) {
  const { id, bandwidth, segInfo } = rep;

  // ── セグメント URL を展開 ──────────────────────────────────────────────
  const { initUrl, segUrls } = expandSegmentUrls(segInfo, id, bandwidth, mpdDuration);

  if (segUrls.length === 0) {
    return { ok: false, error: "no_segments" };
  }

  const total = segUrls.length;
  let completed = 0;

  const sendProgress = (current, t) => {
    browser.runtime.sendMessage({
      type:    "DASH_DOWNLOAD_PROGRESS",
      mpdUrl,
      repId:   id,
      current,
      total:   t,
    }).catch(() => {});
  };

  sendProgress(0, total);

  // ── init セグメントを先頭に fetch（fMP4 の moov ボックス）────────────
  let initBuf = null;
  if (initUrl) {
    if (pageURL) pendingReferers.set(initUrl, pageURL);
    try {
      const res = await fetch(initUrl);
      pendingReferers.delete(initUrl);
      if (!res.ok) throw new Error(`init fetch HTTP ${res.status}`);
      initBuf = await res.arrayBuffer();
    } catch (err) {
      pendingReferers.delete(initUrl);
      return { ok: false, error: `init: ${err.message}` };
    }
  }

  // ── media セグメントを並列 fetch（最大 4 並列）────────────────────────
  const mediaBufs = new Array(segUrls.length);
  let nextIdx = 0;

  async function worker() {
    while (nextIdx < segUrls.length) {
      const idx    = nextIdx++;
      const segUrl = segUrls[idx];
      if (pageURL) pendingReferers.set(segUrl, pageURL);
      const res = await fetch(segUrl);
      pendingReferers.delete(segUrl);
      if (!res.ok) throw new Error(`seg ${idx} HTTP ${res.status}`);
      mediaBufs[idx] = await res.arrayBuffer();
      completed++;
      sendProgress(completed, total);
    }
  }

  try {
    const workerCount = Math.min(4, segUrls.length);
    await Promise.all(Array.from({ length: workerCount }, worker));
  } catch (err) {
    return { ok: false, error: err.message };
  }

  // ── [init] + media セグメントを結合 ──────────────────────────────────
  const allBufs    = initBuf ? [initBuf, ...mediaBufs] : [...mediaBufs];
  const totalBytes = allBufs.reduce((s, b) => s + (b?.byteLength ?? 0), 0);
  const combined   = new Uint8Array(totalBytes);
  let offset = 0;
  for (const buf of allBufs) {
    if (buf) {
      combined.set(new Uint8Array(buf), offset);
      offset += buf.byteLength;
    }
  }

  // ── Blob 化してダウンロード ────────────────────────────────────────────
  const blobMime = trackType === "audio" ? "audio/mp4" : "video/mp4";
  const blob     = new Blob([combined], { type: blobMime });
  const blobUrl  = URL.createObjectURL(blob);

  // ファイル名: <mpdステム>_<trackType>_<repId>.<ext>
  // 例: stream_video_1.mp4 / stream_audio_10.m4a
  const ext = trackType === "audio" ? "m4a" : "mp4";
  let stem  = "dash";
  try {
    const pathname = new URL(mpdUrl).pathname;
    const raw = pathname.split("/").filter(Boolean).pop() ?? "";
    stem = (raw.replace(/\.[^.]+$/, "") || "dash").replace(/[/\\:*?"<>|]/g, "_");
  } catch (_) {}
  const filename = applyFilenameTemplate(`${stem}_${trackType}_${id}`, ext);

  let downloadId;
  try {
    downloadId = await browser.downloads.download({ url: blobUrl, filename });
  } catch (err) {
    URL.revokeObjectURL(blobUrl);
    return { ok: false, error: err.message };
  }

  // Blob URL をダウンロード完了後に解放
  const revokeTimer = setTimeout(() => URL.revokeObjectURL(blobUrl), 10 * 60 * 1000);
  browser.downloads.onChanged.addListener(function onDone(delta) {
    if (delta.id !== downloadId) return;
    const state = delta.state?.current;
    if (state === "complete" || state === "interrupted") {
      clearTimeout(revokeTimer);
      URL.revokeObjectURL(blobUrl);
      browser.downloads.onChanged.removeListener(onDone);
    }
  });

  return { ok: true, downloadId };
}

// ─── DASH 映像+音声 自動 mux（v0.18.0） ──────────────────────────────────────
/**
 * DASH の映像・音声トラックを両方ダウンロードし、companion の mux コマンドで
 * 1つの MP4 ファイルに結合する。
 *
 * companion 未接続の場合は従来の別ファイル DL にフォールバックし、
 * popup に DASH_MUX_FALLBACK を通知する。
 *
 * メッセージ形式（popup → background）:
 *   {
 *     type:        "DOWNLOAD_DASH_MUX",
 *     videoRep:    Representation,   // 映像トラック
 *     audioRep:    Representation,   // 音声トラック
 *     mpdUrl:      string,
 *     mpdDuration: number,
 *     pageURL:     string,
 *   }
 *
 * 返り値:
 *   { ok: true,  muxed: true,  filePath }   — mux 成功
 *   { ok: true,  muxed: false }             — フォールバック（別ファイルDL）
 *   { ok: false, error }                    — 失敗
 */
async function downloadDashAndMux({ videoRep, audioRep, mpdUrl, mpdDuration, pageURL }) {
  // companion 未接続 → 別ファイルフォールバック
  if (!companionPort) {
    browser.runtime.sendMessage({ type: "DASH_MUX_FALLBACK" }).catch(() => {});
    const vRes = await downloadDashTrack({ rep: videoRep, mpdUrl, mpdDuration, trackType: "video", pageURL });
    const aRes = await downloadDashTrack({ rep: audioRep, mpdUrl, mpdDuration, trackType: "audio", pageURL });
    return { ok: true, muxed: false, videoResult: vRes, audioResult: aRes };
  }

  // ── 映像・音声セグメントを blob として取得（DL せずバッファに保持）──────
  async function fetchTrackToBlob(rep, trackType) {
    const { id, bandwidth, segInfo } = rep;
    const { initUrl, segUrls } = expandSegmentUrls(segInfo, id, bandwidth, mpdDuration);
    if (segUrls.length === 0) throw new Error(`no_segments (${trackType})`);

    const allBufs = [];

    if (initUrl) {
      if (pageURL) pendingReferers.set(initUrl, pageURL);
      const res = await fetch(initUrl);
      pendingReferers.delete(initUrl);
      if (!res.ok) throw new Error(`init HTTP ${res.status}`);
      allBufs.push(await res.arrayBuffer());
    }

    let nextIdx = 0;
    const mediaBufs = new Array(segUrls.length);
    let completed = 0;

    const sendProg = (cur) => {
      browser.runtime.sendMessage({
        type: "DASH_MUX_PROGRESS", mpdUrl,
        phase: trackType, current: cur, total: segUrls.length,
      }).catch(() => {});
    };
    sendProg(0);

    async function worker() {
      while (nextIdx < segUrls.length) {
        const idx = nextIdx++;
        const segUrl = segUrls[idx];
        if (pageURL) pendingReferers.set(segUrl, pageURL);
        const res = await fetch(segUrl);
        pendingReferers.delete(segUrl);
        if (!res.ok) throw new Error(`seg ${idx} HTTP ${res.status}`);
        mediaBufs[idx] = await res.arrayBuffer();
        sendProg(++completed);
      }
    }
    const wc = Math.min(4, segUrls.length);
    await Promise.all(Array.from({ length: wc }, worker));

    allBufs.push(...mediaBufs);
    const totalBytes = allBufs.reduce((s, b) => s + (b?.byteLength ?? 0), 0);
    const combined   = new Uint8Array(totalBytes);
    let offset = 0;
    for (const buf of allBufs) {
      if (buf) { combined.set(new Uint8Array(buf), offset); offset += buf.byteLength; }
    }
    const mime = trackType === "audio" ? "audio/mp4" : "video/mp4";
    return new Blob([combined], { type: mime });
  }

  let videoBlob, audioBlob;
  try {
    [videoBlob, audioBlob] = await Promise.all([
      fetchTrackToBlob(videoRep, "video"),
      fetchTrackToBlob(audioRep, "audio"),
    ]);
  } catch (err) {
    return { ok: false, error: err.message };
  }

  // ── companion に blob を base64 で渡して mux ────────────────────────────
  async function blobToBase64(blob) {
    const ab  = await blob.arrayBuffer();
    const ua  = new Uint8Array(ab);
    let bin   = "";
    for (let i = 0; i < ua.length; i++) bin += String.fromCharCode(ua[i]);
    return btoa(bin);
  }

  const [videoB64, audioB64] = await Promise.all([
    blobToBase64(videoBlob),
    blobToBase64(audioBlob),
  ]);

  const stem       = inferStem(mpdUrl);
  const outputName = applyFilenameTemplate(stem, "mp4");

  let result;
  try {
    result = await sendToCompanion(
      { type: "mux", videoB64, audioB64, outputName },
      (prog) => {
        browser.runtime.sendMessage({
          type: "DASH_MUX_PROGRESS", mpdUrl,
          phase: "muxing", current: prog.percent ?? 0, total: 100,
        }).catch(() => {});
      }
    );
  } catch (err) {
    return { ok: false, error: err.message };
  }

  if (!result.ok) return { ok: false, error: result.error ?? "mux failed" };
  return { ok: true, muxed: true, filePath: result.filePath };
}

// ─── Native Messaging Companion（ステップ15/16） ──────────────────────────────
/**
 * companion app（Node.js + FFmpeg）との通信レイヤー。
 *
 * 設計方針:
 *   - companion が未インストールでも拡張機能の基本機能は動く（グレースフルフォールバック）
 *   - companion 接続中は HLS ダウンロードが FFmpeg 経由の MP4 変換パスを通る
 *   - companion が切断・失敗した場合は従来の blob ダウンロード（.ts）に自動フォールバック
 *
 * companion との通信は browser.runtime.connectNative() のポートで行う。
 * 複数リクエストを同一ポートで処理するため requestId でルーティングする。
 *
 *   拡張機能 → companion: { type, requestId, ...params }
 *   companion → 拡張機能: { requestId, type: "progress", ... }  (変換中、複数回)
 *                          { requestId, ok: true, ...result }    (完了)
 *                          { requestId, ok: false, error }       (失敗)
 */

/** companion app の Native Messaging ホスト名（native-manifest.json の "name" と一致） */
const COMPANION_HOST = "media_snatcher";

/** 現在のポート（null = 未接続） */
let companionPort   = null;

/** 現在の接続状態 */
let companionStatus = "disconnected"; // "disconnected" | "connected" | "error"

/**
 * 進行中リクエストのマップ。
 * key: requestId (number)
 * value: { resolve, reject, onProgress? }
 */
const companionPendingRequests = new Map();

/** 次に発行する requestId */
let companionNextRequestId = 1;

/**
 * companion app に接続する。
 * すでに接続済みの場合は何もしない。
 * インストールされていない場合はグレースフルに失敗（ステータスを "error" に設定）。
 */
function connectCompanion() {
  if (companionPort) return; // 既に接続済み

  // ステップ18: 設定で companion 機能が無効化されていれば接続しない
  if (settingsCache.companionEnabled === false) {
    companionStatus = "disabled";
    broadcastCompanionStatus();
    return;
  }

  try {
    companionPort = browser.runtime.connectNative(COMPANION_HOST);
    companionStatus = "connected";
    broadcastCompanionStatus();

    companionPort.onMessage.addListener((msg) => {
      const req = companionPendingRequests.get(msg.requestId);
      if (!req) return; // 対応するリクエストがなければ無視

      if (msg.type === "progress") {
        // 変換中の進捗通知
        req.onProgress?.(msg);
      } else if (msg.ok === true) {
        // 完了（成功）
        companionPendingRequests.delete(msg.requestId);
        req.resolve(msg);
      } else if (msg.ok === false) {
        // 完了（失敗）
        companionPendingRequests.delete(msg.requestId);
        req.reject(new Error(msg.error ?? "companion error"));
      }
    });

    companionPort.onDisconnect.addListener(() => {
      // companion が切断（アプリ終了 / インストール未了 / エラー）
      companionPort   = null;
      companionStatus = browser.runtime.lastError ? "error" : "disconnected";
      // 進行中のすべてのリクエストをエラーにする
      for (const req of companionPendingRequests.values()) {
        req.reject(new Error("companion disconnected"));
      }
      companionPendingRequests.clear();
      broadcastCompanionStatus();
    });

  } catch (err) {
    companionPort   = null;
    companionStatus = "error";
    broadcastCompanionStatus();
  }
}

/**
 * companion にコマンドを送信してレスポンスを返す Promise。
 *
 * @param {object} command     - 送信するコマンド（type + params）
 * @param {function} onProgress - 進捗通知コールバック（省略可）
 * @returns {Promise<object>}
 */
function sendToCompanion(command, onProgress) {
  return new Promise((resolve, reject) => {
    if (!companionPort) {
      reject(new Error("companion not connected"));
      return;
    }
    const requestId = companionNextRequestId++;
    companionPendingRequests.set(requestId, { resolve, reject, onProgress });
    try {
      companionPort.postMessage({ ...command, requestId });
    } catch (err) {
      companionPendingRequests.delete(requestId);
      reject(err);
    }
  });
}

/**
 * companion の接続状態変化をポップアップに通知する。
 * ポップアップが閉じている場合は無視する。
 */
function broadcastCompanionStatus() {
  browser.runtime.sendMessage({
    type:   "COMPANION_STATUS",
    status: companionStatus,
  }).catch(() => {});
}

// 起動時に companion への接続を試みる（未インストールでも失敗するだけ）
connectCompanion();

// ─── メッセージルーターへの companion 関連ハンドラ追加 ─────────────────────────
// （下記は既存の addListener の switch 文に追加するのではなく、
//    別の addListener として定義する）
browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  switch (message.type) {
    case "GET_COMPANION_STATUS":
      sendResponse({ status: companionStatus });
      return true;

    case "CONNECT_COMPANION":
      // ポップアップの「再接続」ボタンなどから手動で呼び出す用
      if (!companionPort) {
        companionStatus = "disconnected"; // エラー状態をリセット
        connectCompanion();
      }
      sendResponse({ status: companionStatus });
      return true;

    default:
      break;
  }
});

// ─── HLS → MP4 companion 変換パス（ステップ16） ──────────────────────────────

/**
 * companion app 経由で HLS を FFmpeg によって MP4 に変換してダウンロードする。
 * companion が失敗した場合は例外を投げる（呼び出し元でフォールバックを処理する）。
 *
 * フロー:
 *   1. companion に { type: "convert", playlistUrl, referer, outputName } を送信
 *   2. companion が FFmpeg を実行し、進捗を { type: "progress", percent } で通知
 *   3. companion が変換完了後に { ok: true, filePath } を返す
 *   4. 返された filePath をブラウザのダウンロードシステムに渡す
 *      → ダウンロードフォルダへの保存は companion が直接行うため
 *        downloadId は null になる場合がある（ポップアップでは "保存済み" 表示）
 *
 * @param {string} mediaPlaylistUrl - HLS Media Playlist URL
 * @param {string} pageURL          - Referer 用の元ページ URL
 * @returns {Promise<{ ok: true, downloadId: null, filePath: string } | { ok: false, error: string }>}
 */
async function downloadHlsViaCompanion(mediaPlaylistUrl, pageURL) {
  // ファイル名（.mp4 拡張子）を決める
  const outputName = applyFilenameTemplate(inferStem(mediaPlaylistUrl), "mp4");

  // companion に変換を依頼し、進捗を popup に中継する
  const result = await sendToCompanion(
    {
      type:        "convert",
      playlistUrl: mediaPlaylistUrl,
      referer:     pageURL || "",
      outputName,
    },
    (progressMsg) => {
      // companion からの進捗通知を popup に転送
      browser.runtime.sendMessage({
        type:       "HLS_DOWNLOAD_PROGRESS",
        url:        mediaPlaylistUrl,
        current:    progressMsg.percent ?? 0,
        total:      100,
        converting: true,  // FFmpeg 変換フェーズのフラグ
      }).catch(() => {});
    }
  );

  if (!result.ok) {
    throw new Error(result.error ?? "companion conversion failed");
  }

  // 変換完了 — filePath はユーザーの Downloads フォルダ内のパス
  // popup に 100% 完了を通知
  browser.runtime.sendMessage({
    type:       "HLS_DOWNLOAD_PROGRESS",
    url:        mediaPlaylistUrl,
    current:    100,
    total:      100,
    converting: true,
  }).catch(() => {});

  return { ok: true, downloadId: null, filePath: result.filePath };
}

// ─── タブイベント ─────────────────────────────────────────────────────────────

browser.tabs.onRemoved.addListener((tabId) => {
  delete tabMediaStore[tabId];
  // このタブに紐づくライブ録画セッションを停止（放置するとポーリングとDLが継続する）。
  // stopLiveRecording が残バッファを最終チャンクとしてフラッシュするのでデータは失われない。
  const urls = [...liveRecordingSessions.values()]
    .filter(s => s.tabId === tabId)
    .map(s => s.url);
  for (const url of urls) stopLiveRecording(url).catch(() => {});
});

browser.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === "loading") {
    delete tabMediaStore[tabId];
    updateBadge(tabId, 0);
  }
});
