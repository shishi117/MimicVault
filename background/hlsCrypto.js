// background/hlsCrypto.js — MimicVault
// AES-128 復号ユーティリティ fetchAesKey/decryptSegment/hexToBytes

"use strict";

// ─── AES-128 復号ユーティリティ（ステップ9） ─────────────────────────────────

/**
 * KEY URI から 16 バイトの AES-128 生キーを fetch し、
 * SubtleCrypto が扱える CryptoKey オブジェクトに変換して返す。
 *
 * Referer は pendingReferers 経由で onBeforeSendHeaders が注入する
 * （セグメント・プレイリストと同じ仕組み）。
 *
 * @param {string} keyUri  - EXT-X-KEY の URI（絶対 URL）
 * @param {string} pageURL - Referer として使う元ページ URL
 * @returns {Promise<CryptoKey>}
 */
async function fetchAesKey(keyUri, pageURL) {
  if (pageURL) pendingReferers.set(keyUri, pageURL);

  let keyBytes;
  try {
    const res = await fetch(keyUri);
    pendingReferers.delete(keyUri);
    if (!res.ok) throw new Error(`キー取得失敗: HTTP ${res.status}`);
    keyBytes = await res.arrayBuffer(); // 仕様上 16 バイト固定
  } catch (err) {
    pendingReferers.delete(keyUri);
    throw err;
  }

  // SubtleCrypto に渡せる CryptoKey に変換
  return crypto.subtle.importKey(
    "raw",
    keyBytes,
    { name: "AES-CBC" },
    false,          // extractable: false（キーをエクスポートさせない）
    ["decrypt"]
  );
}

/**
 * AES-128-CBC でセグメントバイト列を復号して返す。
 *
 * IV の決定ルール（HLS RFC 8216 §4.3.2.4）:
 *   1. EXT-X-KEY に IV 属性がある → その値を使う（16 バイト固定）
 *   2. IV 属性がない → mediaSequence + segmentIndex を 128 ビット整数として使う
 *      例: seqBase=5, segIndex=2 → IV = 0x00000000000000000000000000000007
 *
 * @param {ArrayBuffer} encryptedBuf  - 暗号化された TS セグメントデータ
 * @param {CryptoKey}   cryptoKey     - fetchAesKey() で得た CryptoKey
 * @param {string|null} ivHex         - EXT-X-KEY の IV（16 進 32 桁）または null
 * @param {number}      seqBase       - #EXT-X-MEDIA-SEQUENCE の値
 * @param {number}      segIndex      - このセグメントのプレイリスト内インデックス（0 始まり）
 * @returns {Promise<ArrayBuffer>} - 復号後のバイト列
 */
async function decryptSegment(encryptedBuf, cryptoKey, ivHex, seqBase, segIndex) {
  // IV を 16 バイト Uint8Array に変換
  let ivBytes;
  if (ivHex) {
    // EXT-X-KEY の IV 属性を使う
    ivBytes = hexToBytes(ivHex.padStart(32, "0"));
  } else {
    // シーケンス番号ベース: (seqBase + segIndex) を 128 ビット big-endian で表現
    ivBytes = new Uint8Array(16);
    const seqNum = seqBase + segIndex;
    // 64 ビット整数の安全範囲内なので DataView で書き込める
    const view = new DataView(ivBytes.buffer);
    view.setUint32(12, seqNum >>> 0, false); // 下位 32 ビット
    // 上位ビットは 0 のまま（実用上 seqNum < 2^32）
  }

  return crypto.subtle.decrypt(
    { name: "AES-CBC", iv: ivBytes },
    cryptoKey,
    encryptedBuf
  );
}

/** 16 進文字列 → Uint8Array */
function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

/**
 * HLS Media Playlist URL を受け取り、全セグメントを結合して DL する。
 *
 * フロー:
 *   1. Media Playlist を fetch してパース
 *   2. SAMPLE-AES → エラー返却。AES-128 → キーを fetch して CryptoKey 化
 *   3. 並列 fetch（最大 4 並列）でセグメントを取得
 *      AES-128 の場合は取得後に即 decryptSegment() で復号
 *      → 取得・復号完了のたびに popup へ HLS_DOWNLOAD_PROGRESS を送信
 *   4. ArrayBuffer を順序保持で結合し Blob を生成
 *   5. blobURL で browser.downloads.download を呼ぶ
 *
 * @param {string} mediaPlaylistUrl - Media Playlist（または単一 m3u8）の URL
 * @param {string} pageURL          - Referer として使う元ページ URL
 * @returns {Promise<{ ok: boolean, downloadId?: number, error?: string }>}
 */
