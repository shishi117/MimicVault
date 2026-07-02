// background/hlsMediaParse.js — MimicVault
// HLS Media Playlist パーサ parseMediaPlaylist（AES-128 対応）

"use strict";

// ─── HLS Media Playlist パーサ（ステップ9: AES-128 対応） ────────────────────

/**
 * Media Playlist テキストをパースしてセグメント URL リストを返す。
 *
 * 返り値:
 *   { error: "sample_aes" }
 *     — METHOD=SAMPLE-AES を検出（未対応）
 *   { keyInfo: null, mediaSequence: number, segments: string[] }
 *     — 暗号化なし
 *   { keyInfo: { method, uri, iv }, mediaSequence: number, segments: string[] }
 *     — AES-128 暗号化あり
 *
 * keyInfo:
 *   method  — "AES-128"（現在はこれのみ）
 *   uri     — キー取得先 URL（絶対 URL に変換済み）
 *   iv      — EXT-X-KEY:IV 属性の値（null の場合はシーケンス番号から算出）
 *
 * HLS 仕様では EXT-X-KEY はセグメントごとに切り替わり得るが、
 * 実用上は1プレイリスト内で同じキーが使われるケースがほとんど。
 * v0.9.0 では最初に登場した EXT-X-KEY を全セグメントに適用する。
 *
 * @param {string} text    - m3u8 テキスト
 * @param {string} baseURL - 相対 URI 解決に使う元 URL
 *
 * ステップ10 追加フィールド:
 *   ended          — #EXT-X-ENDLIST が存在する場合 true（VOD）、ない場合 false（ライブ）
 *   targetDuration — #EXT-X-TARGETDURATION の値（秒）。省略時は 6
 */
function parseMediaPlaylist(text, baseURL) {
  const lines = text.split(/\r?\n/);

  // ── ライブ / VOD 判定（ステップ10） ────────────────────────────────────────
  const ended = text.includes("#EXT-X-ENDLIST");

  // ── EXT-X-TARGETDURATION（ポーリング間隔の基準）──────────────────────────
  const tdMatch = text.match(/^#EXT-X-TARGETDURATION:(\d+)/m);
  const targetDuration = tdMatch ? parseInt(tdMatch[1], 10) : 6;

  // ── EXT-X-MEDIA-SEQUENCE（メディアシーケンス番号の初期値） ──────────────────
  // IV が指定されていない場合に AES-CBC の IV を算出するために使う
  // デフォルトは 0（仕様上の既定値）
  let mediaSequence = 0;
  const seqLine = lines.find(l => l.startsWith("#EXT-X-MEDIA-SEQUENCE:"));
  if (seqLine) {
    const n = parseInt(seqLine.split(":")[1], 10);
    if (!isNaN(n)) mediaSequence = n;
  }

  // ── EXT-X-KEY の解析 ────────────────────────────────────────────────────────
  let keyInfo = null;
  const keyLine = lines.find(l => l.startsWith("#EXT-X-KEY:"));

  if (keyLine) {
    const attrs = keyLine.slice("#EXT-X-KEY:".length);

    // METHOD=
    const methodMatch = attrs.match(/METHOD=([^,\s]+)/i);
    const method = methodMatch?.[1] ?? "";

    if (method === "SAMPLE-AES") {
      // SAMPLE-AES は DRM 管理が必要なため未対応
      return { error: "sample_aes" };
    }

    if (method === "AES-128") {
      // URI="..." — クォートを除去
      const uriMatch = attrs.match(/URI="([^"]+)"/i);
      const rawUri   = uriMatch?.[1] ?? "";
      let keyUri     = rawUri;
      try { keyUri = new URL(rawUri, baseURL).href; } catch (_) {}

      // IV=0x... — 省略可能。省略時は null にしてシーケンス番号で代替
      const ivMatch = attrs.match(/IV=0x([0-9a-f]+)/i);
      const iv      = ivMatch ? ivMatch[1].padStart(32, "0") : null;

      keyInfo = { method: "AES-128", uri: keyUri, iv };
    }
    // METHOD=NONE または未知の METHOD はキーなしとして扱う
  }

  // ── セグメント URI の抽出 ────────────────────────────────────────────────────
  const segments = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line.startsWith("#EXTINF:")) continue;

    for (let j = i + 1; j < lines.length; j++) {
      const candidate = lines[j].trim();
      if (!candidate || candidate.startsWith("#")) continue;
      try { segments.push(new URL(candidate, baseURL).href); } catch (_) {}
      break;
    }
  }

  return { keyInfo, mediaSequence, segments, ended, targetDuration };
}

