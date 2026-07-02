// background/liveRecording.js — MimicVault
// HLS ライブ録画セッション startLiveRecording/pollLiveSession

"use strict";

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
