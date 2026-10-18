// background/mediaMeta.js — MimicVault
// ポップアップ表示用のメタ情報取得 getMediaMeta（方式・長さ・結合後サイズ）

"use strict";

// ─── メディアメタ情報（v0.19.0: ポップアップUI改善） ──────────────────────────

/**
 * DASH / HLS のマニフェストを取得・解析し、ポップアップ表示用のメタ情報を返す。
 *
 * 返り値（成功）: { ok:true, method, durationSec:number|null, sizeBytes:number|null, estimated:true }
 *   method     — "DASH/mux" | "DASH" | "HLS"
 *   durationSec— 結合後（マニフェスト全体）の総再生時間（秒）。不明なら null
 *   sizeBytes  — 結合後サイズの推定値。不明なら null
 * 失敗: { ok:false, error }
 *
 * 既知の簡略化: sizeBytes は bandwidth × durationSec / 8 の推定値。実測は各セグメントの
 * Content-Length を合算する必要があり、そこまではしない（推定には "~" を付けて表示）。
 *
 * @param {string} url       - .mpd / .m3u8 の URL
 * @param {string} mimeHint  - MIME ヒント（判定補助）
 * @param {string} pageURL   - Referer 用の元ページ URL
 */
async function getMediaMeta(url, mimeHint, pageURL) {
  const isHls  = isHlsUrl(url, mimeHint);
  const isDash = isDashUrl(url, mimeHint);

  const estSize = (bw, dur) => (bw > 0 && dur > 0 ? Math.round(bw * dur / 8) : null);

  // ── DASH ──────────────────────────────────────────────────────────────────
  if (isDash) {
    const info = await fetchDashInfo(url, pageURL);       // { ok, videoReps, audioReps, mpdDuration }
    if (!info?.ok) return { ok: false, error: info?.error ?? "dash_failed" };

    const v = info.videoReps?.[0];
    const a = info.audioReps?.[0];
    const durationSec = info.mpdDuration || null;
    const bw = (v?.bandwidth || 0) + (a?.bandwidth || 0);
    const method = (v && a) ? "DASH/mux" : "DASH";
    return { ok: true, method, durationSec, sizeBytes: estSize(bw, durationSec), estimated: true };
  }

  // ── HLS ───────────────────────────────────────────────────────────────────
  if (isHls) {
    const r = await fetchHlsVariants(url, pageURL);       // master: { ok, variants } / media: { ok:false, error:"not_master" }

    let playlistUrl = url;   // 解析対象の Media Playlist URL
    let bw = 0;
    if (r?.ok) {
      const variant = r.variants?.[0];                    // 帯域最大（fetchHlsVariants が降順ソート済み）
      if (!variant) return { ok: false, error: "no_variants" };
      playlistUrl = variant.url;
      bw = variant.bandwidth || 0;
    } else if (r?.error !== "not_master") {
      return { ok: false, error: r?.error ?? "hls_failed" };
    }
    // r.error === "not_master" のときは url 自体が Media Playlist。bw 不明のまま続行。

    // Media Playlist を取得して EXTINF 合計を得る
    if (pageURL) pendingReferers.set(playlistUrl, pageURL);
    let text;
    try {
      const res = await fetch(playlistUrl);
      pendingReferers.delete(playlistUrl);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      text = await res.text();
    } catch (err) {
      pendingReferers.delete(playlistUrl);
      return { ok: false, error: err.message };
    }

    const parsed = parseMediaPlaylist(text, playlistUrl);
    const durationSec = parsed?.totalDuration || null;
    return { ok: true, method: "HLS", durationSec, sizeBytes: estSize(bw, durationSec), estimated: true };
  }

  return { ok: false, error: "not_stream" };
}
