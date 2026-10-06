// background/mssInitSegment.test.js — MimicVault
// buildMssInitSegment の自己チェック。実行: node background/mssInitSegment.test.js

"use strict";

const assert = require("assert");
const {
  buildMssInitSegment, parseAvcCodecPrivateData, hexToBytes,
} = require("./mssInitSegment");

// Annex-B: 00000001 + SPS(NAL type7) + 00000001 + PPS(NAL type8)
// SPS/PPS の内容自体は本テストの検証範囲外(ボックス構造の健全性を確認する)。
const CPD_H264 = "000000016742001e123456780000000168ce3c80";
// 44.1kHz/stereo/AAC-LC の標準的な AudioSpecificConfig
const ASC_AAC = "1210";

function readU32(buf, offset) {
  return (buf[offset] << 24) | (buf[offset + 1] << 16) | (buf[offset + 2] << 8) | buf[offset + 3];
}
function fourCCAt(buf, offset) {
  return String.fromCharCode(buf[offset], buf[offset + 1], buf[offset + 2], buf[offset + 3]);
}
function containsFourCC(buf, tag) {
  const bytes = [...tag].map(c => c.charCodeAt(0));
  for (let i = 0; i + 4 <= buf.length; i++) {
    if (bytes.every((b, j) => buf[i + j] === b)) return true;
  }
  return false;
}

// ── parseAvcCodecPrivateData ──────────────────────────────────────────────
{
  const { sps, pps } = parseAvcCodecPrivateData(CPD_H264);
  assert.strictEqual(sps.length, 8, "SPS length");
  assert.strictEqual(sps[0] & 0x1F, 7, "SPS NAL type");
  assert.strictEqual(pps.length, 4, "PPS length");
  assert.strictEqual(pps[0] & 0x1F, 8, "PPS NAL type");
}

// ── buildMssInitSegment(video/H264) ───────────────────────────────────────
{
  const buf = new Uint8Array(buildMssInitSegment({
    fourCC: "H264", codecPrivateData: CPD_H264, width: 1280, height: 720,
  }));

  assert.strictEqual(fourCCAt(buf, 4), "ftyp", "先頭boxはftyp");
  const ftypSize = readU32(buf, 0);
  assert.strictEqual(fourCCAt(buf, ftypSize + 4), "moov", "2番目のboxはmoov");
  const moovSize = readU32(buf, ftypSize);
  assert.strictEqual(ftypSize + moovSize, buf.length, "ftyp+moovの合計長がバッファ長と一致");
  assert.ok(containsFourCC(buf, "avc1"), "avc1 サンプルエントリを含む");
  assert.ok(containsFourCC(buf, "avcC"), "avcC ボックスを含む");
  assert.ok(containsFourCC(buf, "trex"), "mvex/trex を含む(fragmented前提)");
}

// ── buildMssInitSegment(audio/AAC) ────────────────────────────────────────
{
  const buf = new Uint8Array(buildMssInitSegment({
    fourCC: "AACL", codecPrivateData: ASC_AAC, channels: 2, sampleRate: 44100,
  }));

  assert.strictEqual(fourCCAt(buf, 4), "ftyp", "先頭boxはftyp");
  const ftypSize = readU32(buf, 0);
  const moovSize = readU32(buf, ftypSize);
  assert.strictEqual(ftypSize + moovSize, buf.length, "ftyp+moovの合計長がバッファ長と一致");
  assert.ok(containsFourCC(buf, "mp4a"), "mp4a サンプルエントリを含む");
  assert.ok(containsFourCC(buf, "esds"), "esds ボックスを含む");

  // esds に AudioSpecificConfig(1210)がそのまま埋め込まれていること
  const asc = hexToBytes(ASC_AAC);
  let found = false;
  for (let i = 0; i + asc.length <= buf.length; i++) {
    if (asc.every((b, j) => buf[i + j] === b)) { found = true; break; }
  }
  assert.ok(found, "AudioSpecificConfig がesds内に含まれる");
}

// ── 異常系 ─────────────────────────────────────────────────────────────────
assert.throws(
  () => buildMssInitSegment({ fourCC: "HEVC", codecPrivateData: "00" }),
  /mss_unsupported_fourcc/,
  "未対応FourCCはエラー"
);
assert.throws(
  () => buildMssInitSegment({ fourCC: "H264", codecPrivateData: "00000001", width: 1, height: 1 }),
  /avc_codec_private_data_missing_sps_pps/,
  "SPS/PPSが無いH264は解析エラー"
);

console.log("mssInitSegment.test.js: OK");
