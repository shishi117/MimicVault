// background/bookmarkDownload.js — MimicVault
// ブックマーク一括ダウンロード（タブ検出方式） downloadBookmarks
//
// ブックマークのURLは「動画を再生できるページ」であり直リンクではない。本拡張の検出は
// 受動的（webRequest / DOM 走査）なので、各ブックマークをバックグラウンドタブで開き、
// 自動再生ナッジで再生を促してメディアURLを検出 → 既存のDL経路へ委譲 → 完了したら
// ブックマークを「ダウンロード済み」フォルダへ退避する。
//
// 既知の簡略化: 逐次処理（同時1タブ / 1 FFmpeg）。既存の全DL（DOWNLOAD_MEDIA_ALL）が
//   「通常ストリームは1本」と割り切っているのと同方針。並列化するなら
//   filenameStemOverride を明示引数化する必要がある（filename.js のコメント参照）。

"use strict";

// ─── パラメータ ───────────────────────────────────────────────────────────────
const BOOKMARK_TAB_LOAD_TIMEOUT = 15000;   // ページ読み込み完了待ちの上限
const BOOKMARK_MEDIA_TIMEOUT    = 20000;   // メディア検出待ちの上限
const BOOKMARK_POLL_INTERVAL    = 1000;    // 検出ポーリング間隔
const BOOKMARK_DL_TIMEOUT       = 600000;  // 個別DL完了待ちの上限（10分）
const DOWNLOADED_FOLDER_TITLE   = "ダウンロード済み";
const BOOKMARK_MENU_ROOT        = "menu________"; // Firefox ブックマークメニュー root GUID

// 自動再生ナッジ: 最大面積の <video> を muted で play() ＋クリック試行。
// autoplay を許すサイトで有効。独自プレーヤー/DRM は無反応 → 検出タイムアウト＝退避しない。
const BOOKMARK_NUDGE_CODE = `(() => {
  const vids = [...document.querySelectorAll("video")];
  if (!vids.length) return;
  vids.sort((a, b) => (b.clientWidth * b.clientHeight) - (a.clientWidth * a.clientHeight));
  const v = vids[0];
  try { v.muted = true; const p = v.play(); if (p && p.catch) p.catch(() => {}); } catch (e) {}
  try { v.click(); } catch (e) {}
})();`;

const bmSleep = (ms) => new Promise(r => setTimeout(r, ms));

// ─── ファイル名ステム生成 ─────────────────────────────────────────────────────
/**
 * ブックマークタイトルをファイル名ステムに変換する。
 * 空白 → `_`、ファイル名禁則文字（\ / : * ? " < > |）→ 全角 `＊`。
 * （半角 * は Windows/Firefox のDL時に更に置換され見た目が保証されないため全角採用）
 */
function bookmarkFilenameStem(title) {
  return (title || "")
    .replace(/^[\s.]+|[\s.]+$/g, "") // 先に前後の空白・ドットを除去（前後が _ 埋めにならないように）
    .replace(/ /g, "_")              // 内部の空白 → _
    .replace(/[/\\:*?"<>|]/g, "＊")  // 禁則文字 → 全角＊
    || "media";
}

// ─── 「ダウンロード済み」フォルダの確保 ───────────────────────────────────────
let downloadedFolderId = null;

async function ensureDownloadedFolder() {
  // キャッシュがユーザー削除で無効化されている可能性を確認
  if (downloadedFolderId) {
    try { await browser.bookmarks.get(downloadedFolderId); return downloadedFolderId; }
    catch (_) { downloadedFolderId = null; }
  }
  const children = await browser.bookmarks.getChildren(BOOKMARK_MENU_ROOT);
  const existing = children.find(c => !c.url && c.title === DOWNLOADED_FOLDER_TITLE);
  if (existing) { downloadedFolderId = existing.id; return downloadedFolderId; }
  const created = await browser.bookmarks.create({
    parentId: BOOKMARK_MENU_ROOT,
    title:    DOWNLOADED_FOLDER_TITLE,
  });
  downloadedFolderId = created.id;
  return downloadedFolderId;
}

// ─── 検出候補から1件選ぶ ──────────────────────────────────────────────────────
// ヒューリスティック: ストリーミング（m3u8/mpd）優先 → video → 先頭。
// 既知の簡略化: 動画ページの本編は通常ストリーミング。広告等の直リンクmp4を避けるため
//   ストリーミングを最優先する。誤選択の可能性は許容（1件のみ処理）。
function pickMediaItem(items) {
  if (!items.length) return null;
  const streaming = items.find(it =>
    /\.m3u8(\?|#|$)/i.test(it.url) || /\.mpd(\?|#|$)/i.test(it.url) ||
    (it.mimeHint || "").includes("mpegurl") || (it.mimeHint || "").includes("dash+xml"));
  if (streaming) return streaming;
  const video = items.find(it => it.tag === "video" || /^video\//.test(it.mimeHint || ""));
  return video || items[0];
}

// ─── タブ読み込み完了待ち ─────────────────────────────────────────────────────
function waitTabComplete(tabId, timeoutMs) {
  return new Promise((resolve) => {
    function listener(id, changeInfo) {
      if (id === tabId && changeInfo.status === "complete") { cleanup(); resolve(); }
    }
    function cleanup() { browser.tabs.onUpdated.removeListener(listener); clearTimeout(timer); }
    const timer = setTimeout(() => { cleanup(); resolve(); }, timeoutMs);
    browser.tabs.onUpdated.addListener(listener);
    // 登録前に既に complete になっている場合の取りこぼし防止
    browser.tabs.get(tabId).then(t => { if (t.status === "complete") { cleanup(); resolve(); } }).catch(() => {});
  });
}

function nudgePlay(tabId) {
  return browser.tabs.executeScript(tabId, { code: BOOKMARK_NUDGE_CODE }).catch(() => {});
}

// ─── メディア検出待ち（ポーリング＋再ナッジ） ─────────────────────────────────
async function waitForMedia(tabId, timeoutMs) {
  const start = Date.now();
  let reNudged = false;
  await nudgePlay(tabId);
  while (Date.now() - start < timeoutMs) {
    const store = getStore(tabId);
    if (store.size > 0) return pickMediaItem([...store.values()]);
    await bmSleep(BOOKMARK_POLL_INTERVAL);
    // 中盤で1回だけ再ナッジ（動的プレーヤーが後から video を挿入するケース対策）
    if (!reNudged && Date.now() - start > timeoutMs / 2) { reNudged = true; await nudgePlay(tabId); }
  }
  const store = getStore(tabId);
  return store.size > 0 ? pickMediaItem([...store.values()]) : null;
}

// ─── DL完了待ち（直接DL / HLS-VOD blob 用） ───────────────────────────────────
function awaitDownloadComplete(downloadId) {
  return new Promise((resolve) => {
    function onChanged(delta) {
      if (delta.id !== downloadId) return;
      const st = delta.state?.current;
      if (st === "complete")         { cleanup(); resolve({ ok: true }); }
      else if (st === "interrupted") { cleanup(); resolve({ ok: false, error: delta.error?.current || "interrupted" }); }
    }
    function cleanup() { browser.downloads.onChanged.removeListener(onChanged); clearTimeout(timer); }
    const timer = setTimeout(() => { cleanup(); resolve({ ok: false, error: "timeout" }); }, BOOKMARK_DL_TIMEOUT);
    browser.downloads.onChanged.addListener(onChanged);
  });
}

// DL経路の戻り値を「完了」まで正規化する。
// downloadId があれば onChanged 完了を待ち、無ければ（companion 完了）解決＝完了。
async function gateDownloadResult(r) {
  if (!r || !r.ok) return { ok: false, error: r?.error || "download_failed" };
  if (r.downloadId) return await awaitDownloadComplete(r.downloadId);
  return { ok: true };
}

// ─── 検出メディアを既存DL経路へ委譲 ───────────────────────────────────────────
async function downloadDetected(item) {
  const url      = item.url;
  const pageURL  = item.pageURL || "";
  const mimeHint = item.mimeHint || "";
  const isHls  = /\.m3u8(\?|#|$)/i.test(url) || mimeHint.includes("mpegurl");
  const isDash = /\.mpd(\?|#|$)/i.test(url)  || mimeHint.includes("dash+xml");

  if (isHls || isDash) {
    // ストリーミングは companion（FFmpeg）必須。未接続なら退避しない（全DLと同方針）。
    if (!companionPort) return { ok: false, error: "companion未接続" };
    const r = isHls
      ? await downloadHlsSegments(url, pageURL, null)
      : await autoDashMux({ url, pageURL });
    return await gateDownloadResult(r);
  }

  // 直接ファイル
  const filename = applyFilenameTemplate(inferStem(url), inferExt(url, mimeHint));
  if (pageURL) pendingReferers.set(url, pageURL);
  let downloadId;
  try {
    downloadId = await browser.downloads.download({ url, filename });
  } catch (e) {
    pendingReferers.delete(url);
    return { ok: false, error: e.message };
  }
  return await awaitDownloadComplete(downloadId);
}

// ─── 1件処理: 開く→再生→検出→DL→退避→閉じる ────────────────────────────────
async function processOneBookmark(node) {
  const bookmarkId = node.id;
  const emit = (state, extra) =>
    browser.runtime.sendMessage({ type: "BOOKMARK_DL_PROGRESS", bookmarkId, state, ...extra }).catch(() => {});

  let tab;
  try {
    emit("detecting");
    tab = await browser.tabs.create({ url: node.url, active: false });
    await waitTabComplete(tab.id, BOOKMARK_TAB_LOAD_TIMEOUT);

    const item = await waitForMedia(tab.id, BOOKMARK_MEDIA_TIMEOUT);
    if (!item) { emit("failed", { reason: "no_media" }); return { bookmarkId, ok: false, reason: "no_media" }; }

    emit("downloading");
    setFilenameStemOverride(bookmarkFilenameStem(node.title));
    let dlResult;
    try {
      dlResult = await downloadDetected(item);
    } finally {
      setFilenameStemOverride(null);
    }
    if (!dlResult.ok) { emit("failed", { reason: dlResult.error }); return { bookmarkId, ok: false, error: dlResult.error }; }

    // 成功したものだけ退避（移動自体の失敗はDL済みなので致命的でない）
    try {
      const parentId = await ensureDownloadedFolder();
      await browser.bookmarks.move(bookmarkId, { parentId });
    } catch (e) {
      console.warn("[bookmarkDL] 退避失敗:", e.message);
    }
    emit("done");
    return { bookmarkId, ok: true };
  } catch (err) {
    emit("failed", { reason: err.message });
    return { bookmarkId, ok: false, error: err.message };
  } finally {
    if (tab) browser.tabs.remove(tab.id).catch(() => {});
  }
}

// ─── フォルダ一覧 / 子ブックマーク取得 ─────────────────────────────────────────
// パネルは content script が注入する iframe 内で動くため browser.bookmarks に
// 直接アクセスできない（Firefoxの制限）。background（真のトップレベル拡張機能
// コンテキスト）が代行し、メッセージ経由で結果を返す。
async function getBookmarkFolders() {
  const tree = await browser.bookmarks.getTree();
  const folders = [];
  (function walk(nodes, depth) {
    for (const n of nodes) {
      if (n.url) continue;                       // リンクはフォルダではない
      const hasTitle = !!n.title;                // ルート直下の匿名コンテナはタイトル空
      if (hasTitle) folders.push({ id: n.id, title: n.title, depth });
      if (n.children) walk(n.children, hasTitle ? depth + 1 : depth);
    }
  })(tree, 0);
  return folders;
}

async function getBookmarkChildren(folderId) {
  const children = await browser.bookmarks.getChildren(folderId);
  return children.filter(c => c.url).map(c => ({ id: c.id, title: c.title, url: c.url }));
}

// ─── エントリ: 選択ブックマークを逐次処理 ─────────────────────────────────────
async function downloadBookmarks(ids) {
  const results = [];
  for (const id of ids || []) {
    let node;
    try { [node] = await browser.bookmarks.get(id); } catch (_) { continue; }
    if (!node || !node.url) continue; // フォルダ等は対象外
    results.push(await processOneBookmark(node));
  }
  return { ok: true, results };
}

// 自己チェック（CLAUDE.md: 非自明ロジックに実行可能チェックを1つ残す）
(function selfCheck() {
  const got  = bookmarkFilenameStem("a b:c?d");
  const want = "a_b＊c＊d";
  if (got !== want) console.error("[bookmarkDL] selfCheck 失敗:", JSON.stringify(got), "≠", JSON.stringify(want));
})();
