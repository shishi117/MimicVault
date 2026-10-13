// background/messageRouter.js — MimicVault
// 拡張機能内メッセージルーター（runtime.onMessage）

"use strict";

// ─── メッセージルーター（v0.1.0 の2つの addListener を統合） ─────────────────

browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
  switch (message.type) {

    // ページに重ねて表示する固定幅パネル（content/sidePanel.js が作る iframe）が
    // 自分の属するタブIDを知るために使う。iframe は content script が注入した
    // ページの子フレームなので、browser.tabs.query({currentWindow:true}) 等の
    // 「現在のウィンドウ／タブ」解決に頼らず、メッセージ送信元（sender.tab）から
    // 直接取得する方が確実。
    case "GET_MY_TAB_ID": {
      sendResponse({ tabId: sender.tab?.id ?? null });
      return true;
    }

    // パネル iframe が HLS ダウンロードの進捗をポーリングで取りに来る
    // （hlsProgressState 参照。background/constants.js のコメント参照）。
    case "GET_HLS_PROGRESS": {
      sendResponse(hlsProgressState.get(message.url) ?? null);
      return true;
    }

    // パネル iframe が直接ファイル（mp4等）の Range 分割DL進捗をポーリングで取りに来る
    // （directDownloadProgressState 参照。GET_HLS_PROGRESS と同じ理由）。
    case "GET_DIRECT_DOWNLOAD_PROGRESS": {
      sendResponse(directDownloadProgressState.get(message.url) ?? null);
      return true;
    }

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
      // 汎用 MSE 断片はグループ収集に回す（MSE は主に fetch/XHR 経由で届く）
      if (isSegmentUrl(url)) { recordSegment(tabId, url, pageURL ?? ""); break; }
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

    // ポップアップ表示用のメタ情報（方式・長さ・結合後サイズ）の先読み取得
    case "GET_MEDIA_META": {
      const { url, mimeHint, pageURL } = message;
      getMediaMeta(url, mimeHint ?? "", pageURL ?? "")
        .then(meta => sendResponse(meta))
        .catch(err => sendResponse({ ok: false, error: err.message }));
      return true;
    }

    // ポップアップの「ダウンロード」ボタンからの要求（通常の progressive 直リンク）。
    // 単発の全量GETではなく、再生時のような Range 分割リクエストで取得する
    // （downloadDirectRanged.js。単発DLは拒否するが部分取得は許容する配信元対策）。
    case "DOWNLOAD_MEDIA": {
      const { url, mimeHint, pageURL, contentLength, tabId } = message;
      const ext = inferExt(url, mimeHint);

      inferTitleStem(url, tabId)
        .then(stem => downloadDirectRanged(url, pageURL ?? "", applyFilenameTemplate(stem, ext), contentLength ?? null))
        .then(result => sendResponse(result))
        .catch(err   => sendResponse({ ok: false, error: err.message }));
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

    // 収集ストリーム（孤立セグメントグループ）のダウンロード要求
    case "DOWNLOAD_SEGMENT_GROUP": {
      downloadSegmentGroup(message)
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

      const results    = [];  // DL結果（互換のためのレスポンス形）
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
            downloadHlsViaCompanion(item.url, item.pageURL || "", allTabId)
              .catch(err => console.warn("[全DL] HLS 変換失敗:", item.url, err.message));
            converting++;
          } else {
            skipped.push({ url: item.url, reason: "companion未接続" });
          }
        } else if (isDash(item)) {
          // 全DL: companion 接続時のみ MPD 解析→既定トラック自動選択→mux
          // （未接続では mux 不可のためスキップ。HLS と同じ挙動）
          // 既知の簡略化: 複数 DASH があると FFmpeg が同時起動する（通常1本なので許容）。
          if (companionPort) {
            autoDashMux(item, allTabId)
              .catch(err => console.warn("[全DL] DASH mux失敗:", item.url, err.message));
            converting++;
          } else {
            skipped.push({ url: item.url, reason: "companion未接続" });
          }
        } else if (item.isSegmentGroup) {
          // 収集ストリーム: 断片を結合して保存（companion 有無に関わらず動作）。
          // 長時間かかるため await しない。
          downloadSegmentGroup({ groupKey: item.groupKey, tabId: allTabId })
            .catch(err => console.warn("[全DL] 収集ストリーム失敗:", item.url, err.message));
          converting++;
        } else if (isTs(item) && hasHls) {
          // m3u8 がある = この .ts はそのストリームのセグメント。HLS 変換でまとめて
          // 取得されるので個別DLしない（一覧でも隠している）。
          continue;
        } else {
          // 通常の progressive 直リンク（mp4等）: Range 分割DLは1本ずつ時間が
          // かかるため全DLには含めない。個別の「↓DL」ボタンから行う。
          skipped.push({ url: item.url, reason: "個別のDLボタンをご利用ください" });
        }
      }

      Promise.all(promises)
        .then(() => sendResponse({ ok: true, results, skipped, converting }))
        .catch(() => sendResponse({ ok: true, results, skipped, converting }));
      return true;
    }

    // ブックマーク一括ダウンロード（タブ検出方式）
    case "DOWNLOAD_BOOKMARKS": {
      downloadBookmarks(message.ids)
        .then(result => sendResponse(result))
        .catch(err   => sendResponse({ ok: false, error: err.message }));
      return true;
    }

    // パネル（iframe）は browser.bookmarks に直接アクセスできないため仲介
    case "GET_BOOKMARK_FOLDERS": {
      getBookmarkFolders()
        .then(folders => sendResponse({ ok: true, folders }))
        .catch(err    => sendResponse({ ok: false, error: err.message }));
      return true;
    }

    case "GET_BOOKMARK_CHILDREN": {
      getBookmarkChildren(message.folderId)
        .then(links => sendResponse({ ok: true, links }))
        .catch(err  => sendResponse({ ok: false, error: err.message }));
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

