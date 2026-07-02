// background/fetchDashInfo.js — MimicVault
// DASH MPD 取得 fetchDashInfo

"use strict";

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
