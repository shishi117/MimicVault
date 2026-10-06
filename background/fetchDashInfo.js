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
// MSS の .ism/Manifest URL → 実際に MPD を返す DASH URL の解決結果をキャッシュする。
// （meta 先読みとアコーディオン展開で二重解決になるのを避ける）
const _mssDashUrlCache = new Map();

/**
 * MSS(.ism/Manifest) URL を、MPD として解釈できる DASH URL に解決する。
 * 既知の DASH 記法（ismToDashCandidates）を順に fetch し、`<MPD` を含む最初の
 * 候補を返す。どれも該当しなければ null を返す（＝動的パッケージャーではない
 * ので、呼び出し元が静的MSSとして .ism/Manifest を直接パースする）。
 */
async function resolveMssDashUrl(ismUrl, pageURL) {
  if (_mssDashUrlCache.has(ismUrl)) return _mssDashUrlCache.get(ismUrl);

  const candidates = ismToDashCandidates(ismUrl);
  for (const cand of candidates) {
    if (pageURL) pendingReferers.set(cand, pageURL);
    try {
      const res = await fetch(cand);
      pendingReferers.delete(cand);
      if (!res.ok) continue;
      const text = await res.text();
      if (text.includes("<MPD")) {
        _mssDashUrlCache.set(ismUrl, cand);
        return cand;
      }
    } catch (_) {
      pendingReferers.delete(cand);
    }
  }
  _mssDashUrlCache.set(ismUrl, null);
  return null;
}

/** 指定URLをテキストとしてfetchする(Referer設定/後始末込み)共通ヘルパー */
async function fetchTextWithReferer(url, pageURL) {
  if (pageURL) pendingReferers.set(url, pageURL);
  try {
    const res = await fetch(url);
    pendingReferers.delete(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } catch (err) {
    pendingReferers.delete(url);
    throw err;
  }
}

async function fetchDashInfo(url, pageURL) {
  if (isMssUrl(url)) {
    const dashUrl = await resolveMssDashUrl(url, pageURL);
    if (dashUrl === null) {
      // 動的パッケージャーではない(静的MSS) → .ism/Manifest を直接パースする
      const text = await fetchTextWithReferer(url, pageURL);
      return parseIsmManifest(text, url);
    }
    url = dashUrl;
  }

  const text = await fetchTextWithReferer(url, pageURL);
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
