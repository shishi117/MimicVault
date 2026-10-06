// background/mp4BoxWriter.js — MimicVault
// ISO BMFF(MP4)ボックス構築ヘルパー box/fullBox/u8/u16be/u32be

"use strict";

// ─── 整数 → バイト列 ──────────────────────────────────────────────────────────

function u8(n) {
  return new Uint8Array([n & 0xFF]);
}

function u16be(n) {
  return new Uint8Array([(n >>> 8) & 0xFF, n & 0xFF]);
}

function u32be(n) {
  return new Uint8Array([
    (n >>> 24) & 0xFF, (n >>> 16) & 0xFF, (n >>> 8) & 0xFF, n & 0xFF,
  ]);
}

/** Uint8Array/ArrayBuffer の配列を1本に連結する */
function concatBytes(parts) {
  const bufs  = parts.map(p => (p instanceof Uint8Array ? p : new Uint8Array(p)));
  const total = bufs.reduce((s, b) => s + b.length, 0);
  const out   = new Uint8Array(total);
  let offset  = 0;
  for (const b of bufs) { out.set(b, offset); offset += b.length; }
  return out;
}

/** 4文字のボックスタイプ文字列 → ASCIIバイト列 */
function fourcc(type) {
  if (type.length !== 4) throw new Error(`fourcc must be 4 chars: ${type}`);
  return new Uint8Array([...type].map(c => c.charCodeAt(0)));
}

// ─── ボックス構築 ─────────────────────────────────────────────────────────────

/**
 * ISO BMFF ボックスを構築する: size(4byte big-endian) + type(4byte ASCII) + payload。
 * payload は Uint8Array/ArrayBuffer/box() の戻り値を可変長で渡せる。
 *
 * @param {string} type  - 4文字のボックスタイプ(例: "ftyp", "moov")
 * @param {...(Uint8Array|ArrayBuffer)} parts - 連結するペイロード
 * @returns {Uint8Array}
 */
function box(type, ...parts) {
  const payload = concatBytes(parts);
  const size    = 8 + payload.length;
  return concatBytes([u32be(size), fourcc(type), payload]);
}

/**
 * version(1byte) + flags(3byte) を先頭に持つ「フルボックス」(ISO/IEC 14496-12 の
 * FullBox)を構築する。mvhd/tkhd/mdhd/hdlr/stsd 系の多くが該当する。
 *
 * @param {string} type
 * @param {number} version
 * @param {number} flags   - 24bit
 * @param {...(Uint8Array|ArrayBuffer)} parts
 * @returns {Uint8Array}
 */
function fullBox(type, version, flags, ...parts) {
  const versionFlags = concatBytes([
    u8(version),
    new Uint8Array([(flags >>> 16) & 0xFF, (flags >>> 8) & 0xFF, flags & 0xFF]),
  ]);
  return box(type, versionFlags, ...parts);
}

if (typeof module !== "undefined") {
  module.exports = { box, fullBox, u8, u16be, u32be, concatBytes, fourcc };
}
