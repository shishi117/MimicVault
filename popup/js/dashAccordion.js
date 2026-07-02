// popup/js/dashAccordion.js — MimicVault
// DASH トラックアコーディオン toggleDashAccordion/buildDashTrackItem

"use strict";

// ─── DASH アコーディオン（ステップ11） ────────────────────────────────────────

/**
 * DASH アイテムのアコーディオン展開・折りたたみをトグルする。
 * 展開済みなら折りたたむ、未展開なら FETCH_DASH_INFO を送信して展開する。
 */
async function toggleDashAccordion(li, item) {
  // すでに展開済みなら折りたたむ
  const existing = li.nextElementSibling;
  if (existing && existing.classList.contains("dash-panel")) {
    existing.remove();
    li.classList.remove("media-item--dash-open");
    return;
  }

  li.classList.add("media-item--dash-open", "media-item--dash-loading");

  let result;
  try {
    result = await browser.runtime.sendMessage({
      type:    "FETCH_DASH_INFO",
      url:     item.url,
      pageURL: item.pageURL ?? "",
    });
  } catch (_) {
    result = { ok: false, error: "send_failed" };
  }

  li.classList.remove("media-item--dash-loading");

  // 総再生時間を保存（DOWNLOAD_DASH_TRACK 送信時に参照）
  if (result?.ok && result.mpdDuration !== undefined) {
    mpdDurationStore.set(item.url, result.mpdDuration);
  }

  if (!result?.ok) {
    const errEl = document.createElement("div");
    errEl.className = "dash-panel dash-panel--error";
    errEl.textContent = dashErrorMessage(result?.error);
    li.insertAdjacentElement("afterend", errEl);
    return;
  }

  // ── パネルを構築 ──────────────────────────────────────────────────────
  const panel = document.createElement("div");
  panel.className = "dash-panel";

  // 映像トラック
  if (result.videoReps.length > 0) {
    const hdr = document.createElement("div");
    hdr.className = "dash-section-header";
    hdr.textContent = `映像トラック (${result.videoReps.length}件)`;
    panel.appendChild(hdr);

    const ul = document.createElement("ul");
    ul.className = "dash-track-list";
    for (const rep of result.videoReps) {
      ul.appendChild(buildDashTrackItem(item, rep, "video"));
    }
    panel.appendChild(ul);
  }

  // 音声トラック
  if (result.audioReps.length > 0) {
    const hdr = document.createElement("div");
    hdr.className = "dash-section-header";
    hdr.textContent = `音声トラック (${result.audioReps.length}件)`;
    panel.appendChild(hdr);

    const ul = document.createElement("ul");
    ul.className = "dash-track-list";
    for (const rep of result.audioReps) {
      ul.appendChild(buildDashTrackItem(item, rep, "audio"));
    }
    panel.appendChild(ul);
  }

  // mux ボタン（映像・音声両方が存在する場合）
  if (result.videoReps.length > 0 && result.audioReps.length > 0) {
    const muxArea = document.createElement("div");
    muxArea.className = "dash-mux-area";

    const muxLabel = document.createElement("span");
    muxLabel.className = "dash-mux-label";
    muxLabel.textContent = "映像+音声を結合して保存:";

    const muxBtn = document.createElement("button");
    muxBtn.className = "dl-btn dash-mux-btn";
    muxBtn.dataset.mpdUrl = item.url;
    const existingMux = dashMuxStates.get(item.url);
    applyDashMuxButtonState(muxBtn, existingMux);

    muxBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      startDashMux(item, result.videoReps[0], result.audioReps[0], muxBtn);
    });

    muxArea.appendChild(muxLabel);
    muxArea.appendChild(muxBtn);
    panel.appendChild(muxArea);
  } else {
    // mux 注記（片方しかない場合）
    const note = document.createElement("div");
    note.className = "dash-mux-note";
    note.textContent = "⚠ 映像・音声は別ファイルで保存されます";
    panel.appendChild(note);
  }

  li.insertAdjacentElement("afterend", panel);
}

/**
 * DASH トラック1行を生成する。
 *
 * 映像トラック: 解像度 | ビットレート | コーデック | DL ボタン
 * 音声トラック: 言語   | ビットレート | コーデック | DL ボタン
 *
 * DL ボタンはステップ12で有効化する。現時点では disabled プレースホルダー。
 *
 * @param {object} item      - 元の MPD アイテム（pageURL など引き継ぎ用）
 * @param {object} rep       - parseMpd の返す Representation オブジェクト
 * @param {"video"|"audio"} trackType
 */
function buildDashTrackItem(item, rep, trackType) {
  const li = document.createElement("li");
  li.className = "dash-track-item";

  // ── 主情報（解像度 or 言語） ──────────────────────────────────────────
  const infoEl = document.createElement("span");
  infoEl.className = "dash-track-info";
  if (trackType === "video") {
    infoEl.textContent = (rep.width && rep.height)
      ? `${rep.width}×${rep.height}`
      : "不明";
  } else {
    infoEl.textContent = rep.lang ? `${rep.lang}` : "音声";
  }

  // ── ビットレート ─────────────────────────────────────────────────────
  const bwEl = document.createElement("span");
  bwEl.className = "dash-track-bandwidth";
  bwEl.textContent = formatBandwidth(rep.bandwidth);

  // ── コーデック（上位識別子のみ、例: avc1 / mp4a） ──────────────────
  const codecEl = document.createElement("span");
  codecEl.className = "dash-track-codec";
  codecEl.textContent = rep.codecs
    ? rep.codecs.split(".")[0]   // "avc1.64001f" → "avc1"
    : "";

  // ── DL ボタン ────────────────────────────────────────────────────────
  const dashKey = `${item.url}::${rep.id}`;
  const dlBtn   = document.createElement("button");
  dlBtn.className         = "dl-btn";
  dlBtn.dataset.dashKey   = dashKey;
  dlBtn.dataset.trackType = trackType;
  // segInfo がない Representation はダウンロード不可
  dlBtn.disabled = !rep.segInfo;
  dlBtn.title    = rep.segInfo ? "ダウンロード" : "セグメント情報なし（ダウンロード不可）";

  // ポップアップを閉じて再度開いたとき、既存の状態を復元する
  applyDashDownloadButtonState(dlBtn, dashDownloadStates.get(dashKey));

  dlBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    if (!rep.segInfo) return;
    startDashTrackDownload(item, rep, trackType, dlBtn);
  });

  li.appendChild(infoEl);
  li.appendChild(bwEl);
  if (codecEl.textContent) li.appendChild(codecEl);
  li.appendChild(dlBtn);

  return li;
}

/** DASH エラーコードを日本語メッセージに変換 */
function dashErrorMessage(error) {
  switch (error) {
    case "parse_failed":        return "MPD の解析に失敗しました";
    case "no_period":           return "Period 要素が見つかりません";
    case "no_representations":  return "ストリームが見つかりません";
    default:                    return `取得失敗: ${error ?? "不明なエラー"}`;
  }
}

