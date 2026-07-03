// background/messageRouter.js — MimicVault
// 拡張機能内メッセージルーター（runtime.onMessage）

"use strict";

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

    // ポップアップ表示用のメタ情報（方式・長さ・結合後サイズ）の先読み取得
    case "GET_MEDIA_META": {
      const { url, mimeHint, pageURL } = message;
      getMediaMeta(url, mimeHint ?? "", pageURL ?? "")
        .then(meta => sendResponse(meta))
        .catch(err => sendResponse({ ok: false, error: err.message }));
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
          // 全DL: companion 接続時のみ MPD 解析→既定トラック自動選択→mux
          // （未接続では mux 不可のためスキップ。HLS と同じ挙動）
          // 既知の簡略化: 複数 DASH があると FFmpeg が同時起動する（通常1本なので許容）。
          if (companionPort) {
            autoDashMux(item)
              .catch(err => console.warn("[全DL] DASH mux失敗:", item.url, err.message));
            converting++;
          } else {
            skipped.push({ url: item.url, reason: "companion未接続" });
          }
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

