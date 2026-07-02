// background/parseMpd.js — MimicVault
// DASH MPD パーサ parseMpd

"use strict";

function parseMpd(xmlText, mpdUrl) {
  let doc;
  try {
    doc = new DOMParser().parseFromString(xmlText, "application/xml");
  } catch (_) {
    return { ok: false, error: "parse_failed" };
  }

  // パースエラー検出（Firefox は <parsererror> 要素として表現する）
  if (doc.documentElement.localName === "parsererror") {
    return { ok: false, error: "parse_failed" };
  }

  // ── ヘルパー: 直接の子要素を名前で取得 ─────────────────────────────────
  //
  // DOMParser が返す XML Document は名前空間付きなので querySelector が
  // 想定通りに動かない実装がある。localName で比較することで安全に処理する。
  //
  const firstChild  = (el, name) =>
    [...el.children].find(c => c.localName === name) ?? null;
  const allChildren = (el, name) =>
    [...el.children].filter(c => c.localName === name);

  // ── BaseURL の解決 ─────────────────────────────────────────────────────
  function resolveBase(el, fallback) {
    const buEl = firstChild(el, "BaseURL");
    if (!buEl) return fallback;
    try { return new URL(buEl.textContent.trim(), fallback).href; } catch (_) { return fallback; }
  }

  // MPD ルートレベルの BaseURL
  let rootBase = resolveBase(doc.documentElement, mpdUrl);

  // ── Period ─────────────────────────────────────────────────────────────
  const period = firstChild(doc.documentElement, "Period");
  if (!period) return { ok: false, error: "no_period" };

  const periodBase = resolveBase(period, rootBase);

  // ── SegmentTemplate パース ─────────────────────────────────────────────
  function parseSegTemplate(el, baseURL) {
    if (!el) return null;

    // SegmentTimeline（$Time$ テンプレート用の時刻・長さリスト）
    const tlEl = firstChild(el, "SegmentTimeline");
    let timeline = null;
    if (tlEl) {
      const entries = [];
      let currentTime = 0;
      for (const s of allChildren(tlEl, "S")) {
        const t = s.getAttribute("t");
        const d = parseInt(s.getAttribute("d") ?? "0", 10);
        const r = parseInt(s.getAttribute("r") ?? "0", 10);
        if (t !== null) currentTime = parseInt(t, 10);
        // r >= 0: そのセグメントを r+1 回分生成
        // r < 0:  仕様上は末尾まで繰り返しだが実用上稀なため 0 扱い
        const repeat = r >= 0 ? r : 0;
        for (let i = 0; i <= repeat; i++) {
          entries.push({ t: currentTime, d });
          currentTime += d;
        }
      }
      if (entries.length > 0) timeline = entries;
    }

    return {
      type:           "template",
      initialization: el.getAttribute("initialization") ?? "",
      media:          el.getAttribute("media")          ?? "",
      duration:       parseInt(el.getAttribute("duration")    ?? "0",  10),
      timescale:      parseInt(el.getAttribute("timescale")   ?? "1",  10),
      startNumber:    parseInt(el.getAttribute("startNumber") ?? "1",  10),
      baseURL,
      timeline,   // null | { t, d }[] — $Time$ テンプレート展開用
    };
  }

  // ── SegmentList パース ─────────────────────────────────────────────────
  function parseSegList(el, baseURL) {
    if (!el) return null;
    const initEl = firstChild(el, "Initialization");
    return {
      type:           "list",
      initialization: initEl ? (initEl.getAttribute("sourceURL") ?? "") : "",
      segments:       allChildren(el, "SegmentURL")
                        .map(s => s.getAttribute("media") ?? "")
                        .filter(Boolean),
      baseURL,
    };
  }

  // ── AdaptationSet / Representation を走査 ─────────────────────────────
  const videoReps = [];
  const audioReps = [];

  // ── 総再生時間（$Number$ テンプレートの総セグメント数算出に使用）──────────────
  // MPD 要素の mediaPresentationDuration → Period の duration の順で参照する
  const mpdAttrDur    = doc.documentElement.getAttribute("mediaPresentationDuration") ?? "";
  const periodAttrDur = period.getAttribute("duration") ?? "";
  const mpdDuration   = parseIsoDuration(mpdAttrDur) || parseIsoDuration(periodAttrDur);

  for (const as of allChildren(period, "AdaptationSet")) {
    const asMime    = as.getAttribute("mimeType") ?? as.getAttribute("contentType") ?? "";
    const lang      = as.getAttribute("lang")     ?? "";
    const asCodecs  = as.getAttribute("codecs")   ?? "";
    const asBase    = resolveBase(as, periodBase);

    // AdaptationSet レベルの SegmentTemplate / SegmentList
    const asSegTemplate = firstChild(as, "SegmentTemplate");
    const asSegList     = firstChild(as, "SegmentList");

    for (const rep of allChildren(as, "Representation")) {
      const id        = rep.getAttribute("id")        ?? "";
      const bandwidth = parseInt(rep.getAttribute("bandwidth") ?? "0", 10);
      const width     = parseInt(rep.getAttribute("width")     ?? "0", 10);
      const height    = parseInt(rep.getAttribute("height")    ?? "0", 10);
      const codecs    = rep.getAttribute("codecs")    ?? asCodecs;
      const repMime   = rep.getAttribute("mimeType")  ?? asMime;
      const repBase   = resolveBase(rep, asBase);

      // Representation レベルが優先。なければ AdaptationSet レベルを使う
      const repSegTemplate = firstChild(rep, "SegmentTemplate");
      const repSegList     = firstChild(rep, "SegmentList");

      let segInfo = null;
      if (repSegTemplate || asSegTemplate) {
        segInfo = parseSegTemplate(repSegTemplate ?? asSegTemplate, repBase);
      } else if (repSegList || asSegList) {
        segInfo = parseSegList(repSegList ?? asSegList, repBase);
      }

      const repInfo = { id, bandwidth, codecs, mimeType: repMime, segInfo };

      const isVideo = /^video/i.test(repMime) || /^video/i.test(asMime);
      const isAudio = /^audio/i.test(repMime) || /^audio/i.test(asMime);

      if (isVideo) {
        videoReps.push({ ...repInfo, width, height });
      } else if (isAudio) {
        audioReps.push({ ...repInfo, lang });
      }
      // mimeType が不明なものは無視（取得できるセグメントが判断できないため）
    }
  }

  // 帯域幅の降順（高品質順）でソート
  videoReps.sort((a, b) => b.bandwidth - a.bandwidth);
  audioReps.sort((a, b) => b.bandwidth - a.bandwidth);

  if (videoReps.length === 0 && audioReps.length === 0) {
    return { ok: false, error: "no_representations" };
  }

  return { ok: true, videoReps, audioReps, baseURL: periodBase, mpdDuration };
}

