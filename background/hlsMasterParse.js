// background/hlsMasterParse.js — MimicVault
// HLS Master Playlist パーサ fetchHlsVariants/parseMasterPlaylist

"use strict";

// ─── HLS Master Playlist パーサ（ステップ7） ─────────────────────────────────

/**
 * m3u8 URL を fetch してパースし、バリアント一覧を返す。
 *
 * 成功: { ok: true,  variants: [{ url, bandwidth, resolution, codecs }] }
 * 失敗: { ok: false, error: string }
 *
 * fetch 時に Referer を付けるため pendingReferers を流用する。
 */
async function fetchHlsVariants(url, pageURL) {
  // Referer を付けて fetch（onBeforeSendHeaders が注入する）
  if (pageURL) pendingReferers.set(url, pageURL);

  let text;
  try {
    const res = await fetch(url);
    pendingReferers.delete(url); // fetch 完了後にクリーンアップ
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    text = await res.text();
  } catch (err) {
    pendingReferers.delete(url);
    throw err;
  }

  // Master Playlist かどうかを確認
  // Media Playlist（セグメント一覧）には #EXTINF が含まれ、
  // #EXT-X-STREAM-INF は含まれない
  if (!isMasterPlaylist(text)) {
    return { ok: false, error: "not_master" };
  }

  const variants = parseMasterPlaylist(text, url);
  return { ok: true, variants };
}

/**
 * テキストが HLS Master Playlist かどうかを判定する。
 * Master Playlist には #EXT-X-STREAM-INF が含まれる。
 * Media Playlist には #EXTINF が含まれるが #EXT-X-STREAM-INF は含まれない。
 */
function isMasterPlaylist(text) {
  return text.includes("#EXT-X-STREAM-INF");
}

/**
 * Master Playlist をパースしてバリアント一覧を返す。
 *
 * HLS の Master Playlist 構造:
 *   #EXT-X-STREAM-INF:BANDWIDTH=4500000,RESOLUTION=1920x1080,CODECS="avc1.64001f,mp4a.40.2"
 *   https://example.com/1080p/index.m3u8
 *
 * - #EXT-X-STREAM-INF の次の行が必ずバリアントの URI になる
 * - URI は相対パスの場合があるので baseURL で絶対 URL に変換する
 * - BANDWIDTH 降順（高画質順）にソートして返す
 *
 * @param {string} text    - m3u8 テキスト
 * @param {string} baseURL - 相対 URI 解決に使う元 URL
 * @returns {{ url, bandwidth, resolution }[]}
 */
function parseMasterPlaylist(text, baseURL) {
  const variants = [];
  const lines = text.split(/\r?\n/);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line.startsWith("#EXT-X-STREAM-INF:")) continue;

    const attrs = line.slice("#EXT-X-STREAM-INF:".length);

    // BANDWIDTH=数値
    const bwMatch  = attrs.match(/BANDWIDTH=(\d+)/i);
    // RESOLUTION=WxH
    const resMatch = attrs.match(/RESOLUTION=(\d+x\d+)/i);

    const bandwidth  = bwMatch  ? parseInt(bwMatch[1],  10) : 0;
    const resolution = resMatch ? resMatch[1] : null;

    // 次の非空行が URI
    let uriLine = "";
    for (let j = i + 1; j < lines.length; j++) {
      const candidate = lines[j].trim();
      if (candidate && !candidate.startsWith("#")) {
        uriLine = candidate;
        break;
      }
    }
    if (!uriLine) continue;

    // 相対 URI を絶対 URL に変換
    let variantUrl;
    try {
      variantUrl = new URL(uriLine, baseURL).href;
    } catch (_) {
      continue; // パース失敗はスキップ
    }

    variants.push({ url: variantUrl, bandwidth, resolution });
  }

  // BANDWIDTH 降順（高画質順）にソート
  variants.sort((a, b) => b.bandwidth - a.bandwidth);
  return variants;
}

