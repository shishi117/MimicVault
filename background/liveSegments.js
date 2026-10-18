// background/liveSegments.js — MimicVault
// ライブ録画セグメント処理 processNewSegments/flushChunk/stopLiveRecording

"use strict";

async function processNewSegments(session, parsed) {
  for (let i = 0; i < parsed.segments.length; i++) {
    if (session.state !== "recording") break;

    const segUrl = parsed.segments[i];
    if (session.seenUrls.has(segUrl)) continue; // 取得済みはスキップ
    session.seenUrls.add(segUrl);

    // セグメントの実際のメディアシーケンス番号（AES IV 計算に使う）
    const seqNum = parsed.mediaSequence + i;

    try {
      // Referer 未登録だとセグメントだけ素の fetch になり、anti-leech な
      // 配信元（Referer/Origin チェックのある CDN 等）で 403 になる。
      if (session.pageURL) pendingReferers.set(segUrl, session.pageURL);
      const segRes = await fetch(segUrl);
      pendingReferers.delete(segUrl);
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
 * ライブ録画チャンクの実際の保存ファイル名を生成する（flushChunk が downloads.download
 * に渡す名前と同じロジック）。パネル側の表示（sendLiveProgress/GET_LIVE_SESSIONS）も
 * これを呼んで、表示と実際にダウンロードフォルダへ残るファイル名を一致させる。
 */
function liveChunkFilename(stem, chunkIndex) {
  const chunkNum = String(chunkIndex).padStart(3, "0");
  return applyFilenameTemplate(`${stem}_chunk${chunkNum}`, "ts");
}

/**
 * セッションの現在状態から、パネルに表示すべきファイル名を返す。
 * 録画中は次にフラッシュされる（まだ存在しない）チャンク、停止/終了後は
 * 直前にフラッシュされた最後のチャンクのファイル名を使う。
 */
function liveSessionFilename(session) {
  const chunkIndex = session.state === "recording"
    ? session.chunkIndex + 1
    : Math.max(session.chunkIndex, 1);
  return liveChunkFilename(session.stem, chunkIndex);
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

  const filename = liveChunkFilename(session.stem, session.chunkIndex);

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
    filename:      liveSessionFilename(session),
  }).catch(() => {}); // ポップアップが閉じている場合は無視
}

if (typeof module !== "undefined") {
  module.exports = { liveChunkFilename, liveSessionFilename };
}

