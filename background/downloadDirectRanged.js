// background/downloadDirectRanged.js — MimicVault
// 直接配信された progressive 動画/音声ファイルの分割DL downloadDirectRanged
//
// 単発の大きな GET でまとめて取得する代わりに、実際の <video> 再生時と同様に
// Range ヘッダー付きの複数リクエストに分けて取得し、結合して1ファイルとして保存する。
// （単発の全量DLをブロックするが Range 分割の部分取得は許容する配信元があるため）
//
// 既知の簡略化 / アップグレードパス:
//   固定チャンク数(RANGE_CHUNK_COUNT)に等分するだけの単純な方式。再生速度に
//   寄せた可変チャンクサイズや間隔調整はしていない。チャンク間は順番に待って
//   取得する（並列化すると同時多重接続になり再生らしさが失われるため）。
//
// companion 接続時はディスク退避方式（downloadDirectRangedViaDisk）を使う。
// 各チャンクを取得するたびに browser.downloads.download() で実ファイルとして
// ディスクに保存し、全パート保存後に companion（Node.js の fs ストリーム）側で
// 連結する。メモリ上に全チャンク＋結合用コピーを同時に保持しない（hlsDownload.js
// の「base64 Native Messaging は巨大ファイルで実質ハングした」という既知の
// 教訓と同じ理由で、パートはバイト列ではなくファイルパスで companion に渡す）。
// companion 未接続、またはディスク退避経路が失敗した場合は、従来の
// メモリ結合方式にフォールバックする。

"use strict";

const RANGE_CHUNK_COUNT         = 6;        // 分割数の上限
const RANGE_MIN_BYTES_PER_CHUNK = 1024 * 1024; // 1チャンクの最小サイズ(1MB)。これ未満のファイルは分割しない

/** Range: bytes=0-0 で先頭1byteだけ取得し、Content-Range からファイル全体サイズを得る */
async function probeContentLength(url, pageURL) {
  if (pageURL) pendingReferers.set(url, pageURL);
  let res;
  try {
    res = await fetch(url, { headers: { Range: "bytes=0-0" } });
  } finally {
    pendingReferers.delete(url);
  }
  if (res.status !== 206) return null; // Range 未対応 or 不明（単発取得にフォールバック）
  const m = (res.headers.get("content-range") || "").match(/\/(\d+)$/); // "bytes 0-0/12345678"
  return m ? parseInt(m[1], 10) : null;
}

/** 全体サイズを等分し、[start, end] の配列を返す（end は inclusive） */
function buildChunkRanges(totalBytes) {
  const count = Math.min(
    RANGE_CHUNK_COUNT,
    Math.max(1, Math.floor(totalBytes / RANGE_MIN_BYTES_PER_CHUNK))
  );
  const chunkSize = Math.ceil(totalBytes / count);
  const ranges = [];
  for (let start = 0; start < totalBytes; start += chunkSize) {
    ranges.push([start, Math.min(start + chunkSize, totalBytes) - 1]);
  }
  return ranges;
}

async function fetchRange(url, pageURL, start, end) {
  if (pageURL) pendingReferers.set(url, pageURL);
  let res;
  try {
    res = await fetch(url, { headers: { Range: `bytes=${start}-${end}` } });
  } finally {
    pendingReferers.delete(url);
  }
  if (res.status !== 206 && res.status !== 200) {
    throw new Error(`範囲取得失敗: HTTP ${res.status}`);
  }
  return res.arrayBuffer();
}

/**
 * 直接 URL の progressive 動画/音声を、再生時のような Range 分割リクエストで
 * 取得・結合して保存する。
 *
 * @param {string} url
 * @param {string} pageURL       - Referer として使う元ページ URL
 * @param {string} outputName    - 拡張子込みの保存ファイル名
 * @param {?number} knownTotalBytes - 検出時に既に分かっているファイル全体サイズ
 *   （item.contentLength）。渡されていればこれを使い、Range: bytes=0-0 での
 *   再取得（プローブ）はしない。配信元によってはこのプローブ自体を弾く/無視する
 *   ことがあり、その場合 totalBytes 不明のまま単発の全量GETに落ちて分割できず、
 *   進捗が最後まで動かない（既に表示できているサイズを使い回せば避けられる）。
 * @returns {Promise<{ ok: true, downloadId: number } | { ok: false, error: string }>}
 */
async function downloadDirectRanged(url, pageURL, outputName, knownTotalBytes) {
  try {
    return await downloadDirectRangedInner(url, pageURL, outputName, knownTotalBytes);
  } finally {
    // 進捗問い合わせキャッシュ（directDownloadProgressState）は成功・失敗問わず
    // 後片付けする。残したままだと同じ URL の再DL時に古い進捗が一瞬見える
    // （hlsProgressState と同じ理由。background/hlsDownload.js 参照）。
    directDownloadProgressState.delete(url);
  }
}

/**
 * companion（Node.js）を使ったディスク退避方式。チャンクを取得するたびに
 * browser.downloads.download() で実ファイルとして保存し、全パート完了後に
 * companion へパス一覧だけを渡して fs ストリームで連結させる。
 * パート保存・companion連結のどちらかが失敗したら例外を投げ、呼び出し元
 * （downloadDirectRangedInner）で従来のメモリ結合方式にフォールバックする。
 */
async function downloadDirectRangedViaDisk(url, pageURL, outputName, ranges, sendProgress) {
  const partDownloadIds = [];
  const partPaths = [];

  const cleanupParts = () => {
    for (const id of partDownloadIds) browser.downloads.removeFile(id).catch(() => {});
  };

  try {
    sendProgress(0, ranges.length);
    for (let i = 0; i < ranges.length; i++) {
      const [start, end] = ranges[i];
      const buf = await fetchRange(url, pageURL, start, end);

      const blobUrl = URL.createObjectURL(new Blob([buf]));
      let downloadId;
      try {
        downloadId = await browser.downloads.download({
          url: blobUrl,
          filename: `mimicvault_part_${Date.now()}_${i}.part`,
        });
      } finally {
        URL.revokeObjectURL(blobUrl);
      }

      const done = await awaitDownloadComplete(downloadId);
      if (!done.ok) throw new Error(`パート${i}の保存失敗: ${done.error}`);

      const [info] = await browser.downloads.search({ id: downloadId });
      if (!info?.filename) throw new Error(`パート${i}の保存先パス取得失敗`);

      partDownloadIds.push(downloadId);
      partPaths.push(info.filename);
      sendProgress(i + 1, ranges.length);
    }
  } catch (err) {
    cleanupParts();
    throw err;
  }

  const result = await sendToCompanion({ type: "concatParts", inputPaths: partPaths, outputName });
  if (!result.ok) {
    cleanupParts();
    throw new Error(result.error ?? "companion concat failed");
  }

  // 成功時は companion 側（handleConcatParts.js）が連結直後に unlink 済みなので、
  // ここで二重に削除しない。
  return { ok: true, downloadId: null, filePath: result.filePath };
}

async function downloadDirectRangedInner(url, pageURL, outputName, knownTotalBytes) {
  const sendProgress = (cur, tot) => {
    // ブロードキャストが content script 注入のパネル iframe に届かないことが
    // あるため、ポーリング問い合わせ用にも書いておく（constants.js 参照）。
    directDownloadProgressState.set(url, { current: cur, total: tot });
    browser.runtime.sendMessage({
      type: "DIRECT_DOWNLOAD_PROGRESS", url, current: cur, total: tot,
    }).catch(() => {});
  };

  const totalBytes = (knownTotalBytes > 0) ? knownTotalBytes : await probeContentLength(url, pageURL);
  const ranges = totalBytes ? buildChunkRanges(totalBytes) : null;

  // companion 接続時は、分割が必要な（1チャンクより多い）場合のみディスク退避
  // 経路を試す。失敗時は下の従来経路（メモリ結合）にフォールバックする。
  if (companionPort && ranges && ranges.length > 1) {
    try {
      return await downloadDirectRangedViaDisk(url, pageURL, outputName, ranges, sendProgress);
    } catch (err) {
      console.warn("[Companion] 分割DLのディスク結合に失敗、メモリ結合へフォールバック:", err.message);
    }
  }

  const buffers = [];
  try {
    if (!ranges || ranges.length <= 1) {
      // Range 未対応、またはファイルが小さく分割不要 → 単発取得
      sendProgress(0, 1);
      if (pageURL) pendingReferers.set(url, pageURL);
      let res;
      try {
        res = await fetch(url);
      } finally {
        pendingReferers.delete(url);
      }
      if (!res.ok) return { ok: false, error: `取得失敗: HTTP ${res.status}` };
      buffers.push(await res.arrayBuffer());
      sendProgress(1, 1);
    } else {
      // 再生時と同様、1本ずつ順番に Range 取得する（並列化しない）
      sendProgress(0, ranges.length);
      for (let i = 0; i < ranges.length; i++) {
        const [start, end] = ranges[i];
        buffers.push(await fetchRange(url, pageURL, start, end));
        sendProgress(i + 1, ranges.length);
      }
    }
  } catch (err) {
    return { ok: false, error: err.message };
  }

  const totalLen = buffers.reduce((s, b) => s + b.byteLength, 0);
  const combined = new Uint8Array(totalLen);
  let offset = 0;
  for (const b of buffers) { combined.set(new Uint8Array(b), offset); offset += b.byteLength; }

  // 結合漏れ・重複が無いかの自己チェック（非自明なバイト結合のため）
  if (totalBytes && combined.length !== totalBytes) {
    return { ok: false, error: `結合後サイズ不一致: expected ${totalBytes}, got ${combined.length}` };
  }

  const blob    = new Blob([combined], { type: "video/mp4" });
  const blobUrl = URL.createObjectURL(blob);
  let downloadId;
  try {
    downloadId = await browser.downloads.download({ url: blobUrl, filename: outputName });
  } catch (err) {
    URL.revokeObjectURL(blobUrl);
    return { ok: false, error: err.message };
  }

  const revokeTimer = setTimeout(() => URL.revokeObjectURL(blobUrl), 10 * 60 * 1000);
  browser.downloads.onChanged.addListener(function onCh(delta) {
    if (delta.id !== downloadId) return;
    const st = delta.state?.current;
    if (st === "complete" || st === "interrupted") {
      clearTimeout(revokeTimer);
      URL.revokeObjectURL(blobUrl);
      browser.downloads.onChanged.removeListener(onCh);
    }
  });

  return { ok: true, downloadId };
}

if (typeof module !== "undefined") {
  module.exports = { downloadDirectRanged, buildChunkRanges, probeContentLength };
}
