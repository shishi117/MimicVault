// content/thumbnail.js — MimicVault
// サムネイル生成と runtime.onMessage 応答 captureThumbnail

"use strict";

// ─── サムネイル生成（ステップ5） ─────────────────────────────────────────────

/**
 * ポップアップから CAPTURE_THUMBNAIL メッセージを受け取り、
 * 隠れ <video> 要素でフレームを取得して dataURL（JPEG）で返す。
 *
 * 成功: { ok: true,  dataURL: "data:image/jpeg;base64,..." }
 * 失敗: { ok: false, reason: "cors" | "load" | "timeout" }
 */
browser.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type !== "CAPTURE_THUMBNAIL") return false;

  captureThumbnail(message.url)
    .then(dataURL => sendResponse({ ok: true,  dataURL }))
    .catch(err   => sendResponse({ ok: false, reason: err.message }));

  return true; // 非同期 sendResponse を使うことを Firefox に宣言
});

/**
 * 隠れ <video> を DOM に追加し、seeked イベントで canvas にフレームを描画する。
 *
 * 手順:
 *   1. crossOrigin = "anonymous" で動画をロード（CORS ヘッダが必要）
 *   2. loadedmetadata イベントで尺を確認し、適切な位置にシーク
 *      - 有限尺: min(2秒, duration の10%) にシーク（OP や黒フレームを避ける）
 *      - 無限尺（ライブ等）: currentTime = 0 のまま待つ
 *   3. seeked イベントで canvas.drawImage → toDataURL("image/jpeg", 0.7)
 *   4. クロスオリジン汚染で SecurityError が出た場合は "cors" エラーとして reject
 *   5. 10秒以内に完了しない場合は "timeout" で reject
 */
async function captureThumbnail(url) {
  return new Promise((resolve, reject) => {
    // ── 隠れ video 要素を生成 ──
    const video = document.createElement("video");
    video.crossOrigin = "anonymous";
    video.muted       = true;
    video.preload     = "metadata";
    // ページのレイアウトに影響しない位置へ
    video.style.cssText =
      "position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;pointer-events:none;";
    document.body.appendChild(video);

    const THUMB_W = 160;
    const THUMB_H = 90;

    let settled = false;

    const cleanup = () => {
      if (video.parentNode) video.parentNode.removeChild(video);
    };

    const done = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      cleanup();
      resolve(value);
    };

    const fail = (reason) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      cleanup();
      reject(new Error(reason));
    };

    // ── タイムアウト（10秒） ──
    const timer = setTimeout(() => fail("timeout"), 10_000);

    // ── seeked: フレームを canvas に描画 ──
    video.addEventListener("seeked", () => {
      try {
        const vw = video.videoWidth  || THUMB_W;
        const vh = video.videoHeight || THUMB_H;

        // 動画のアスペクト比を保ちつつ THUMB_W × THUMB_H に収める（letterbox）
        const scale = Math.min(THUMB_W / vw, THUMB_H / vh);
        const dw = Math.round(vw * scale);
        const dh = Math.round(vh * scale);
        const dx = Math.round((THUMB_W - dw) / 2);
        const dy = Math.round((THUMB_H - dh) / 2);

        const canvas = document.createElement("canvas");
        canvas.width  = THUMB_W;
        canvas.height = THUMB_H;

        const ctx = canvas.getContext("2d");
        // 背景を黒で塗りつぶし（letterbox 部分）
        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, THUMB_W, THUMB_H);
        ctx.drawImage(video, dx, dy, dw, dh);

        // クロスオリジン汚染チェック（ここで SecurityError が出る）
        const dataURL = canvas.toDataURL("image/jpeg", 0.7);
        done(dataURL);
      } catch (e) {
        // CORS 汚染の場合は SecurityError になる
        const reason = (e instanceof DOMException && e.name === "SecurityError")
          ? "cors" : "canvas";
        fail(reason);
      }
    }, { once: true });

    // ── loadedmetadata: シーク位置を決定 ──
    video.addEventListener("loadedmetadata", () => {
      const seekTo = isFinite(video.duration) && video.duration > 0
        ? Math.min(2, video.duration * 0.1)
        : 0;
      video.currentTime = seekTo;
    }, { once: true });

    // ── error: 動画ロード失敗（404・ネットワークエラー等） ──
    video.addEventListener("error", () => {
      fail("load");
    }, { once: true });

    // ── 動画ロード開始 ──
    video.src = url;
  });
}

