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
    if (msg?.type === "BOOKMARK_DL_PROGRESS") updateBookmarkRow(msg.bookmarkId, msg.state, msg.reason);
  });
}

// ─── フォルダ一覧を <select> に流し込む ───────────────────────────────────────
async function loadBookmarkFolders() {
  let tree;
  try { tree = await browser.bookmarks.getTree(); }
  catch (e) { showToast("ブックマーク取得失敗: " + e.message); return; }

  const folders = [];
  (function walk(nodes, depth) {
    for (const n of nodes) {
      if (n.url) continue;                       // リンクはフォルダではない
      const hasTitle = !!n.title;                // ルート直下の匿名コンテナはタイトル空
      if (hasTitle) folders.push({ id: n.id, title: n.title, depth });
      if (n.children) walk(n.children, hasTitle ? depth + 1 : depth);
    }
  })(tree, 0);

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

  let children;
  try { children = await browser.bookmarks.getChildren(folderId); }
  catch (e) { showToast("取得失敗: " + e.message); return; }

  const links = children.filter(c => c.url);
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

    const status = document.createElement("span");
    status.className = "bookmark-status";

    li.append(cb, title, status);
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

  try {
    // 逐次処理のため応答は全件完了後（ポップアップを閉じても background は継続する）
    const res     = await browser.runtime.sendMessage({ type: "DOWNLOAD_BOOKMARKS", ids });
    const results = res?.results ?? [];
    const ok      = results.filter(r => r.ok).length;
    showToast(`${ok}/${ids.length} 件 完了`);
  } catch (e) {
    showToast("一括DL失敗: " + e.message);
  }

  elBookmarkDlBtn.disabled = false;
  elBookmarkDlBtn.textContent = "選択をDL";
}

// ─── 行の状態表示を更新 ───────────────────────────────────────────────────────
function updateBookmarkRow(id, state, reason) {
  const li = elBookmarkList.querySelector(`.bookmark-item[data-id="${id}"]`);
  if (!li) return;
  const status = li.querySelector(".bookmark-status");
  const label = {
    queued:      "…",
    detecting:   "検出中",
    downloading: "DL中",
    done:        "✓",
    failed:      "✗",
  }[state] ?? state;
  status.textContent = label;
  status.classList.toggle("done",   state === "done");
  status.classList.toggle("failed", state === "failed");
  if (state === "failed" && reason) li.title = "失敗: " + reason;
}
