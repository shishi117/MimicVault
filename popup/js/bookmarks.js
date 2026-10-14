// popup/js/bookmarks.js — MimicVault
// ブックマーク一括ダウンロードパネル（フォルダ選択＋チェックリスト）

"use strict";

let bookmarkPanelOpen  = false;
let bookmarkTreeLoaded = false;

// ─── パネル開閉（メディアビューと排他） ───────────────────────────────────────
function toggleBookmarkPanel() {
  bookmarkPanelOpen = !bookmarkPanelOpen;
  elBookmarkPanel.classList.toggle("hidden", !bookmarkPanelOpen);
  elBookmarkBtn.classList.toggle("active", bookmarkPanelOpen);

  const mediaEls = [elToolbar, elList, elEmpty, elNoMatch];
  if (bookmarkPanelOpen) {
    mediaEls.forEach(el => el && el.classList.add("hidden"));
    if (!bookmarkTreeLoaded) { bookmarkTreeLoaded = true; loadBookmarkFolders(); }
  } else {
    renderList(); // メディアビューの表示状態を復元
  }
}

// ─── 初期化（init.js から呼ばれる） ───────────────────────────────────────────
function initBookmarkPanel() {
  if (!elBookmarkPanel) return;

  elBookmarkFolder.addEventListener("change", () => loadBookmarkChildren(elBookmarkFolder.value));
  elBookmarkSelAll.addEventListener("change", () => {
    elBookmarkList.querySelectorAll(".bookmark-cb").forEach(cb => { cb.checked = elBookmarkSelAll.checked; });
  });
  elBookmarkDlBtn.addEventListener("click", () => startBookmarkDownload());

  // background からの進捗を該当行に反映
  browser.runtime.onMessage.addListener((msg) => {
    if (msg?.type === "BOOKMARK_DL_PROGRESS") updateBookmarkRow(msg.bookmarkId, msg.state, msg);
  });
}

// ─── フォルダ一覧を <select> に流し込む ───────────────────────────────────────
// このパネルは content script が注入する iframe 内で動くため browser.bookmarks に
// 直接アクセスできない（Firefoxの制限）。background にメッセージで取得を依頼する。
async function loadBookmarkFolders() {
  let res;
  try { res = await browser.runtime.sendMessage({ type: "GET_BOOKMARK_FOLDERS" }); }
  catch (e) { showToast("ブックマーク取得失敗: " + e.message); return; }
  if (!res?.ok) { showToast("ブックマーク取得失敗: " + (res?.error ?? "unknown")); return; }

  const folders = res.folders;
  elBookmarkFolder.innerHTML = "";
  for (const f of folders) {
    const opt = document.createElement("option");
    opt.value = f.id;
    opt.textContent = "　".repeat(f.depth) + f.title; // 全角スペースで階層インデント
    elBookmarkFolder.appendChild(opt);
  }
  if (folders.length) loadBookmarkChildren(folders[0].id);
}

// ─── 選択フォルダ直下のブックマークをチェックリスト表示 ───────────────────────
async function loadBookmarkChildren(folderId) {
  elBookmarkSelAll.checked = false;
  elBookmarkList.innerHTML = "";
  if (!folderId) return;

  let res;
  try { res = await browser.runtime.sendMessage({ type: "GET_BOOKMARK_CHILDREN", folderId }); }
  catch (e) { showToast("取得失敗: " + e.message); return; }
  if (!res?.ok) { showToast("取得失敗: " + (res?.error ?? "unknown")); return; }

  const links = res.links;
  elBookmarkEmpty.classList.toggle("hidden", links.length > 0);

  for (const b of links) {
    const li = document.createElement("li");
    li.className = "bookmark-item";
    li.dataset.id = b.id;

    const cb = document.createElement("input");
    cb.type = "checkbox";
    cb.className = "bookmark-cb";

    const title = document.createElement("span");
    title.className = "bookmark-title";
    title.textContent = b.title || b.url;
    title.title = b.url;

    const size = document.createElement("span");
    size.className = "bookmark-size";

    const status = document.createElement("span");
    status.className = "bookmark-status";

    li.append(cb, title, size, status);
    elBookmarkList.appendChild(li);
  }
}

// ─── 選択ブックマークを一括DL要求 ─────────────────────────────────────────────
async function startBookmarkDownload() {
  const ids = [...elBookmarkList.querySelectorAll(".bookmark-item")]
    .filter(li => li.querySelector(".bookmark-cb").checked)
    .map(li => li.dataset.id);

  if (!ids.length) { showToast("ブックマークを選択してください"); return; }

  elBookmarkDlBtn.disabled = true;
  elBookmarkDlBtn.textContent = "…";
  ids.forEach(id => updateBookmarkRow(id, "queued"));
  startBookmarkPolling(ids);

  try {
    // 逐次処理のため応答は全件完了後（ポップアップを閉じても background は継続する）
    const res     = await browser.runtime.sendMessage({ type: "DOWNLOAD_BOOKMARKS", ids });
    const results = res?.results ?? [];
    const ok      = results.filter(r => r.ok).length;
    showToast(`${ok}/${ids.length} 件 完了`);
  } catch (e) {
    showToast("一括DL失敗: " + e.message);
  } finally {
    await stopBookmarkPolling(ids);
  }

  elBookmarkDlBtn.disabled = false;
  elBookmarkDlBtn.textContent = "選択をDL";
}

// ─── 進捗ポーリング（queued→detecting→downloading→done/failed を一括監視） ─────
// BOOKMARK_DL_PROGRESS のブロードキャストは、ページに重ねるパネル（content script
// 注入の iframe）には届かないことがある（届かない環境では「着手前」から一切
// 進まなくなる）。ブロードキャストに頼らず、DL開始と同時に全件分を能動的に
// ポーリングすることで、ブロードキャストの有無に関わらず状態を反映する。
const bookmarkPollingIds = new Set();
let   bookmarkPollTimer  = null;

async function pollBookmarksOnce(ids) {
  const results = await Promise.all(ids.map(async id => {
    try { return [id, await browser.runtime.sendMessage({ type: "GET_BOOKMARK_PROGRESS", bookmarkId: id })]; }
    catch (_) { return [id, null]; }
  }));
  for (const [id, p] of results) {
    if (!p) continue;
    updateBookmarkRow(id, p.state, p);
    if (p.state === "done" || p.state === "failed") bookmarkPollingIds.delete(id);
  }
}

function startBookmarkPolling(ids) {
  ids.forEach(id => bookmarkPollingIds.add(id));
  if (bookmarkPollTimer) return;
  bookmarkPollTimer = setInterval(async () => {
    await pollBookmarksOnce([...bookmarkPollingIds]);
    if (!bookmarkPollingIds.size) { clearInterval(bookmarkPollTimer); bookmarkPollTimer = null; }
  }, 700);
}

// DOWNLOAD_BOOKMARKS が応答を返した時点で background 側は全件すでに最終状態
// （done/failed）になっているはずなので、タイマーを止める前に一度だけ
// 最新状態を取りに行ってから反映する（最後のポーリングtickを待たずに
// 「DL中」のまま表示が止まってしまうのを防ぐ）。
async function stopBookmarkPolling(ids) {
  await pollBookmarksOnce(ids);
  if (!bookmarkPollingIds.size && bookmarkPollTimer) { clearInterval(bookmarkPollTimer); bookmarkPollTimer = null; }
}

// ─── 行の状態表示を更新 ───────────────────────────────────────────────────────
// extra: { percent?, bytesReceived?, totalBytes?, reason? }（BOOKMARK_DL_PROGRESS /
// GET_BOOKMARK_PROGRESS の中身をそのまま渡せる形）
function formatBytes(n) {
  if (!(n > 0)) return "";
  if (n < 1024 * 1024) return Math.round(n / 1024) + "KB";
  return (n / (1024 * 1024)).toFixed(1) + "MB";
}

function updateBookmarkRow(id, state, extra = {}) {
  const li = elBookmarkList.querySelector(`.bookmark-item[data-id="${id}"]`);
  if (!li) return;
  const status = li.querySelector(".bookmark-status");
  const size   = li.querySelector(".bookmark-size");

  const label = {
    queued:      "着手前",
    detecting:   "検出中",
    downloading: extra.percent != null ? `${extra.percent}%` : "DL中",
    done:        "完了",
    failed:      "✗",
  }[state] ?? state;
  status.textContent = label;
  status.classList.toggle("done",   state === "done");
  status.classList.toggle("failed", state === "failed");
  if (state === "failed" && extra.reason) li.title = "失敗: " + extra.reason;

  if (extra.bytesReceived != null) {
    const recv = formatBytes(extra.bytesReceived);
    const tot  = formatBytes(extra.totalBytes);
    size.textContent = tot ? `${recv} / ${tot}` : recv;
  }
}
