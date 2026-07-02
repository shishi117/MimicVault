// background/dashSegments.js — MimicVault
// DASH セグメントURL 展開 parseIsoDuration/resolveTemplateUrl/expandSegmentUrls

"use strict";

// ─── DASH VOD セグメントダウンロード（ステップ12） ────────────────────────────

/**
 * ISO 8601 duration 文字列（"PT1H30M0S" 等）を秒数に変換する。
 * MPD の mediaPresentationDuration / Period.duration の解析に使用。
 *
 * @param {string} str - ISO 8601 duration 文字列
 * @returns {number}   - 秒数（パース失敗は 0）
 */
function parseIsoDuration(str) {
  if (!str) return 0;
  const m = str.match(
    /P(?:\d+Y)?(?:\d+M)?(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?(?:([\d.]+)S)?/
  );
  if (!m) return 0;
  return (parseFloat(m[1] || 0) * 86400)
       + (parseFloat(m[2] || 0) * 3600)
       + (parseFloat(m[3] || 0) * 60)
       + (parseFloat(m[4] || 0));
}

/**
 * DASH SegmentTemplate の media / initialization テンプレートを展開して
 * 絶対 URL を返す。
 *
 * 対応変数:
 *   $RepresentationID$ — rep の id 属性
 *   $Number$           — セグメント番号（startNumber 起点）
 *   $Number%05d$       — 0 埋めセグメント番号
 *   $Time$             — SegmentTimeline の t 値
 *   $Bandwidth$        — rep の bandwidth 属性
 *   $$                 — リテラルの "$"
 *
 * @param {string} template - テンプレート文字列
 * @param {object} vars     - 変数マップ
 * @param {string} baseURL  - 相対 URL 解決用
 * @returns {string}
 */
function resolveTemplateUrl(template, vars, baseURL) {
  // $$ を一時プレースホルダーに退避
  let result = template.replace(/\$\$/g, "\x00");

  for (const [key, value] of Object.entries(vars)) {
    // $key$ または $key%0Nd$（幅指定付き）
    result = result.replace(
      new RegExp(`\\$${key}(%0(\\d+)d)?\\$`, "g"),
      (_, _fmtSpec, widthStr) => {
        const num = typeof value === "number" ? value : parseInt(value, 10);
        return widthStr
          ? String(num).padStart(parseInt(widthStr, 10), "0")
          : String(value);
      }
    );
  }

  result = result.replace(/\x00/g, "$");

  try { return new URL(result, baseURL).href; } catch (_) { return result; }
}

/**
 * segInfo を基に init セグメント URL と media セグメント URL の配列を生成する。
 *
 * 対応フォーマット:
 *   SegmentTemplate + $Number$     : mpdDuration から総セグメント数を算出
 *   SegmentTemplate + $Time$       : SegmentTimeline の各 t 値を使用
 *   SegmentList                    : segInfo.segments を URL に変換
 *
 * @param {object} segInfo     - parseMpd の返す segInfo
 * @param {string} repId       - $RepresentationID$ 展開用
 * @param {number} bandwidth   - $Bandwidth$ 展開用
 * @param {number} mpdDuration - 総再生時間（秒）。$Number$ テンプレートの総数計算に使用
 * @returns {{ initUrl: string|null, segUrls: string[] }}
 */
function expandSegmentUrls(segInfo, repId, bandwidth, mpdDuration) {
  if (!segInfo) return { initUrl: null, segUrls: [] };

  const {
    type, initialization, media,
    duration, timescale, startNumber,
    baseURL, timeline,
  } = segInfo;

  const baseVars = { RepresentationID: repId, Bandwidth: bandwidth };

  // ── SegmentList ────────────────────────────────────────────────────────
  if (type === "list") {
    return {
      initUrl: initialization
        ? resolveTemplateUrl(initialization, baseVars, baseURL)
        : null,
      segUrls: (segInfo.segments ?? []).map(s =>
        resolveTemplateUrl(s, baseVars, baseURL)
      ),
    };
  }

  // ── SegmentTemplate ────────────────────────────────────────────────────
  const initUrl = initialization
    ? resolveTemplateUrl(initialization, baseVars, baseURL)
    : null;

  // $Time$ テンプレート（SegmentTimeline が存在する場合）
  if (media.includes("$Time$") && timeline?.length > 0) {
    return {
      initUrl,
      segUrls: timeline.map(({ t }) =>
        resolveTemplateUrl(media, { ...baseVars, Time: t }, baseURL)
      ),
    };
  }

  // $Number$ テンプレート（mpdDuration が既知の場合）
  if (media.includes("$Number$") && duration > 0 && timescale > 0 && mpdDuration > 0) {
    const totalSegs = Math.ceil(mpdDuration * timescale / duration);
    const segUrls   = [];
    for (let i = 0; i < totalSegs; i++) {
      segUrls.push(
        resolveTemplateUrl(media, { ...baseVars, Number: startNumber + i }, baseURL)
      );
    }
    return { initUrl, segUrls };
  }

  // duration / mpdDuration が不明 → セグメントなし
  return { initUrl, segUrls: [] };
}

/**
 * DASH Representation の全セグメントをダウンロードして結合し、ファイルとして保存する。
 *
 * 処理フロー:
 *   1. segInfo から init + media セグメント URL を展開
 *   2. init セグメントを fetch（moov ボックスを含む MP4 ヘッダー）
 *   3. media セグメント（.m4s）を並列 fetch（最大 4 並列）
 *      完了するたびに DASH_DOWNLOAD_PROGRESS を popup へ通知
 *   4. [init, seg1, seg2, ...] を順序保持で結合し Blob 化
 *   5. browser.downloads.download で保存
 *      映像トラック → .mp4 / 音声トラック → .m4a
 *
 * ⚠ 映像と音声は別ファイルに保存される。
 *   mux（統合）は Step 17（FFmpeg companion）で実装予定。
 *
 * @param {object} params
 * @param {object} params.rep          - Representation（id, bandwidth, segInfo を含む）
 * @param {string} params.mpdUrl       - MPD の元 URL（進捗通知キー・ファイル名生成に使用）
 * @param {number} params.mpdDuration  - MPD 総再生時間（秒）
 * @param {"video"|"audio"} params.trackType
 * @param {string} params.pageURL      - Referer 用の元ページ URL
 */
