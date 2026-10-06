// background/mssManifestParse.js — MimicVault
// 静的 Smooth Streaming(.ism/Manifest) XML パーサ parseIsmManifest/expandMssFragmentUrls
//
// 動的パッケージャー向けの DASH 変換(ismToDashUrl.js)が失敗した場合に、
// マニフェストXMLを直接解析して DASH 相当の { videoReps, audioReps, ... } を組み立てる。
// DOMParser を使うため parseMpd.js と同様に Node では動作しない(Node単体テスト対象外)。

"use strict";

const { ismBaseUrl } = typeof module !== "undefined" ? require("./ismToDashUrl") : self;

/**
 * .ism/Manifest の XML テキストをパースし、parseMpd() と同じ戻り値契約で返す。
 * { ok, videoReps, audioReps, baseURL, mpdDuration }
 *
 * 各 Representation の segInfo は type:"mss" を持ち、expandSegmentUrls(dashSegments.js)
 * から buildMssInitSegment() / expandMssFragmentUrls() 経由で消費される。
 *
 * @param {string} xmlText
 * @param {string} manifestUrl - 元の .ism/Manifest URL(相対URL解決・DRM判定に使用)
 */
function parseIsmManifest(xmlText, manifestUrl) {
  let doc;
  try {
    doc = new DOMParser().parseFromString(xmlText, "application/xml");
  } catch (_) {
    return { ok: false, error: "parse_failed" };
  }
  if (doc.documentElement.localName === "parsererror") {
    return { ok: false, error: "parse_failed" };
  }

  const root = doc.documentElement;
  if (root.localName !== "SmoothStreamingMedia") {
    return { ok: false, error: "not_ism_manifest" };
  }

  const firstChild  = (el, name) => [...el.children].find(c => c.localName === name) ?? null;
  const allChildren = (el, name) => [...el.children].filter(c => c.localName === name);

  // PlayReady等の保護情報があれば非対応として明示エラー(SAMPLE-AESと同じ扱い)
  if (firstChild(root, "Protection")) {
    return { ok: false, error: "drm_protected" };
  }

  const timescale    = parseInt(root.getAttribute("TimeScale") ?? "", 10) || 10000000;
  const durationUnits = parseInt(root.getAttribute("Duration") ?? "0", 10);
  const mpdDuration  = durationUnits > 0 ? durationUnits / timescale : 0;

  const resolved = ismBaseUrl(manifestUrl);
  const base = resolved ? resolved.base : manifestUrl.replace(/\/[^/]*$/, "");
  const tail = resolved ? resolved.tail : "";

  const videoReps = [];
  const audioReps = [];

  for (const si of allChildren(root, "StreamIndex")) {
    const type = (si.getAttribute("Type") || "").toLowerCase();
    if (type !== "video" && type !== "audio") continue; // text(字幕)等は対象外

    const siTimescale = parseInt(si.getAttribute("TimeScale") ?? "", 10) || timescale;
    const urlPattern  = si.getAttribute("Url") || "";

    // <c t d r> のタイムライン展開(parseMpd.js の SegmentTimeline 解析と同型のロジック)
    const chunks = [];
    let currentTime = 0;
    for (const c of allChildren(si, "c")) {
      const t = c.getAttribute("t");
      const d = parseInt(c.getAttribute("d") ?? "0", 10);
      const r = parseInt(c.getAttribute("r") ?? "0", 10);
      if (t !== null) currentTime = parseInt(t, 10);
      const repeat = r >= 0 ? r : 0;
      for (let i = 0; i <= repeat; i++) {
        chunks.push(currentTime);
        currentTime += d;
      }
    }
    if (chunks.length === 0) continue; // 断片情報が無い StreamIndex は無視

    for (const ql of allChildren(si, "QualityLevel")) {
      const fourCC           = ql.getAttribute("FourCC") || "";
      const codecPrivateData = ql.getAttribute("CodecPrivateData") || "";
      if (!codecPrivateData) continue; // init生成に必須の情報が無ければ対象外

      const bitrate = parseInt(ql.getAttribute("Bitrate") ?? "0", 10);
      const id      = ql.getAttribute("Index") ?? String(bitrate);

      const segInfo = {
        type: "mss",
        fourCC,
        codecPrivateData,
        timescale: siTimescale,
        bitrate,
        urlTemplate: `${base}/${urlPattern}${tail}`,
        chunks,
      };

      if (type === "video") {
        const width  = parseInt(ql.getAttribute("MaxWidth")  ?? si.getAttribute("MaxWidth")  ?? "0", 10);
        const height = parseInt(ql.getAttribute("MaxHeight") ?? si.getAttribute("MaxHeight") ?? "0", 10);
        segInfo.width  = width;
        segInfo.height = height;
        videoReps.push({
          id, bandwidth: bitrate, codecs: fourCC.toLowerCase(),
          mimeType: "video/mp4", width, height, segInfo,
        });
      } else {
        segInfo.channels   = parseInt(ql.getAttribute("Channels")     ?? "2",     10);
        segInfo.sampleRate = parseInt(ql.getAttribute("SamplingRate") ?? "44100", 10);
        audioReps.push({
          id, bandwidth: bitrate, codecs: fourCC.toLowerCase(),
          mimeType: "audio/mp4", lang: "", segInfo,
        });
      }
    }
  }

  videoReps.sort((a, b) => b.bandwidth - a.bandwidth);
  audioReps.sort((a, b) => b.bandwidth - a.bandwidth);

  if (videoReps.length === 0 && audioReps.length === 0) {
    return { ok: false, error: "no_representations" };
  }

  return { ok: true, videoReps, audioReps, baseURL: base, mpdDuration };
}

/**
 * segInfo(type:"mss") から、全チャンクの絶対フラグメントURL列を展開する。
 * dashSegments.js の expandSegmentUrls から呼ばれる。
 */
function expandMssFragmentUrls(segInfo) {
  return segInfo.chunks.map(t =>
    segInfo.urlTemplate
      .replace(/\{bitrate\}/gi, String(segInfo.bitrate))
      .replace(/\{start time\}/gi, String(t))
  );
}

if (typeof module !== "undefined") {
  module.exports = { parseIsmManifest, expandMssFragmentUrls };
}
