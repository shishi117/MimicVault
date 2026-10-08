// background/mssInitSegment.js — MimicVault
// 静的 Smooth Streaming 用 fMP4 init セグメント生成 buildMssInitSegment
//
// 既知の簡略化 / アップグレードパス:
//   対応コーデックは映像 H264/AVC1、音声 AAC系(AACL/AACH等)のみ。
//   他の FourCC(HEVC, VC-1, WMA 等)は例外を投げ、呼び出し元で
//   「未対応コーデック」エラーとして表面化させる。

"use strict";

// 拡張機能の background スクリプトは各ファイルが同一グローバルスコープを共有する
// （classic script の <script> 連結と同じ扱い）。mp4BoxWriter.js の box/fullBox/...
// は strict mode の関数宣言のため非コンフィギュラブルなグローバルプロパティになり、
// トップレベルで同名の const 分割代入をすると「redeclaration of non-configurable
// global property」で background 全体の読み込みが止まる。IIFE で囲んで関数スコープ
// に閉じ込めることでこれを避ける。
(function () {
  // Node(テスト)実行時は require、拡張機能内では classic script のグローバルを使う
  // （mp4BoxWriter.js は背景スクリプトとして先に読み込まれ、関数がグローバルに生える）
  const { box, fullBox, u8, u16be, u32be, fourcc } =
    typeof module !== "undefined" ? require("./mp4BoxWriter") : self;

// ─── hex文字列 → バイト列 ─────────────────────────────────────────────────────
// hlsCrypto.js にも同種のヘルパーがあるが、Node テストから単体で require できるよう
// あえて重複させている（4行程度の小関数のため、無関係ファイルを改修するより安全）。
function hexToBytes(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

// ─── Annex-B NAL 分割(H264 CodecPrivateData 解析用) ──────────────────────────

/** 0x000001 / 0x00000001 スタートコードで区切られた NAL ユニット列を返す */
function splitAnnexBNals(bytes) {
  const starts = [];
  for (let i = 0; i + 2 < bytes.length; i++) {
    if (bytes[i] === 0 && bytes[i + 1] === 0 && bytes[i + 2] === 1) {
      starts.push(i + 3);
    }
  }
  return starts.map((s, idx) => {
    let end = idx + 1 < starts.length ? starts[idx + 1] - 3 : bytes.length;
    // 次のスタートコードが4byte版(00 00 00 01)の場合に備え、末尾の0パディングを除く
    // (RBSPの最終byteはstop_bitを含むため実データが0x00で終わることはない)
    while (end > s && bytes[end - 1] === 0) end--;
    return bytes.slice(s, end);
  });
}

/**
 * MSS の CodecPrivateData(H264, hex文字列)から SPS/PPS を取り出す。
 * @returns {{ sps: Uint8Array, pps: Uint8Array }}
 */
function parseAvcCodecPrivateData(hex) {
  const nals = splitAnnexBNals(hexToBytes(hex));
  const sps = nals.find(n => (n[0] & 0x1F) === 7);
  const pps = nals.find(n => (n[0] & 0x1F) === 8);
  if (!sps || !pps) throw new Error("avc_codec_private_data_missing_sps_pps");
  return { sps, pps };
}

// ─── avcC(AVCDecoderConfigurationRecord) ─────────────────────────────────────

function buildAvcC(sps, pps) {
  return box(
    "avcC",
    u8(1),                       // configurationVersion
    u8(sps[1]), u8(sps[2]), u8(sps[3]), // AVCProfileIndication / compatibility / Level
    u8(0xFC | 3),                 // reserved(6)=111111 + lengthSizeMinusOne=3(4byte長)
    u8(0xE0 | 1),                 // reserved(3)=111 + numOfSequenceParameterSets=1
    u16be(sps.length), sps,
    u8(1),                        // numOfPictureParameterSets
    u16be(pps.length), pps
  );
}

/** VisualSampleEntry('avc1') を構築する */
function buildAvc1SampleEntry(width, height, avcCBox) {
  const compressorname = new Uint8Array(32); // 先頭1byte=長さ0(空文字列) + 残り0埋め
  return box(
    "avc1",
    new Uint8Array(6),      // SampleEntry.reserved
    u16be(1),                // data_reference_index
    u16be(0), u16be(0),      // pre_defined, reserved
    new Uint8Array(12),      // pre_defined[3]
    u16be(width), u16be(height),
    u32be(0x00480000), u32be(0x00480000), // horiz/vertresolution(72dpi)
    u32be(0),                // reserved
    u16be(1),                // frame_count
    compressorname,
    u16be(0x0018),           // depth
    u16be(0xFFFF),           // pre_defined = -1
    avcCBox
  );
}

// ─── esds(AAC用 ES_Descriptor) ────────────────────────────────────────────────
//
// MPEG-4 の記述子は本来可変長サイズ(continuation bit付き base128)だが、
// AudioSpecificConfig は数バイトと小さいため、本実装はサイズ<128の単純な
// 1byteサイズ記述のみに対応する(十分なマージンがあるため実運用上問題ない)。

function descr(tag, ...parts) {
  const payload = parts.reduce((acc, p) => {
    const bytes = p instanceof Uint8Array ? p : new Uint8Array(p);
    const out = new Uint8Array(acc.length + bytes.length);
    out.set(acc); out.set(bytes, acc.length);
    return out;
  }, new Uint8Array(0));
  if (payload.length >= 128) throw new Error("descriptor_too_large");
  const out = new Uint8Array(2 + payload.length);
  out[0] = tag;
  out[1] = payload.length;
  out.set(payload, 2);
  return out;
}

function buildEsds(audioSpecificConfig) {
  const decoderSpecificInfo = descr(0x05, audioSpecificConfig);
  const decoderConfig = descr(
    0x04,
    u8(0x40),                 // objectTypeIndication = AAC
    u8((5 << 2) | 1),         // streamType=5(audio) upStream=0 reserved=1
    new Uint8Array(3),        // bufferSizeDB
    u32be(0),                 // maxBitrate
    u32be(0),                 // avgBitrate
    decoderSpecificInfo
  );
  const slConfig = descr(0x06, u8(0x02));
  const esDescriptor = descr(
    0x03,
    u16be(0),                 // ES_ID
    u8(0),                    // flags
    decoderConfig,
    slConfig
  );
  return fullBox("esds", 0, 0, esDescriptor);
}

/** AudioSampleEntry('mp4a') を構築する */
function buildMp4aSampleEntry(channels, sampleRate, esdsBox) {
  return box(
    "mp4a",
    new Uint8Array(6),       // SampleEntry.reserved
    u16be(1),                 // data_reference_index
    new Uint8Array(8),        // AudioSampleEntry.reserved[2]
    u16be(channels),
    u16be(16),                 // samplesize
    u16be(0), u16be(0),        // pre_defined, reserved
    u32be((sampleRate & 0xFFFF) << 16), // samplerate (16.16) 上位16bitのみ使用
    esdsBox
  );
}

// ─── 空のサンプルテーブル(断片の実データは moof/mdat 側が持つ) ─────────────────

function buildEmptySampleTables() {
  return [
    fullBox("stts", 0, 0, u32be(0)),
    fullBox("stsc", 0, 0, u32be(0)),
    fullBox("stsz", 0, 0, u32be(0), u32be(0)),
    fullBox("stco", 0, 0, u32be(0)),
  ];
}

// ─── trak(映像/音声共通の組み立て) ───────────────────────────────────────────

function buildTrak(kind, sampleEntryBox, timescale, width, height) {
  const isVideo = kind === "video";

  const tkhd = fullBox(
    "tkhd", 0, 0x7, // flags: enabled | in_movie | in_preview
    u32be(0), u32be(0),       // creation_time, modification_time
    u32be(1),                  // track_ID
    u32be(0),                  // reserved
    u32be(0),                  // duration(不明=0。実長はfragment側のtfdtで決まる)
    u32be(0), u32be(0),        // reserved[2]
    u16be(0),                  // layer
    u16be(0),                  // alternate_group
    u16be(isVideo ? 0 : 0x0100), // volume
    u16be(0),                  // reserved
    u32be(0x00010000), u32be(0), u32be(0),
    u32be(0), u32be(0x00010000), u32be(0),
    u32be(0), u32be(0), u32be(0x40000000), // unity matrix
    u32be(isVideo ? width << 16 : 0),
    u32be(isVideo ? height << 16 : 0)
  );

  const mdhd = fullBox(
    "mdhd", 0, 0,
    u32be(0), u32be(0),       // creation_time, modification_time
    u32be(timescale),
    u32be(0),                  // duration(不明=0)
    u16be(0x55C4),             // language = "und"
    u16be(0)
  );

  const hdlrName = isVideo ? "VideoHandler\0" : "SoundHandler\0";
  const hdlr = fullBox(
    "hdlr", 0, 0,
    u32be(0),                                   // pre_defined
    fourcc(isVideo ? "vide" : "soun"),
    new Uint8Array(12),                          // reserved[3]
    new Uint8Array([...hdlrName].map(c => c.charCodeAt(0)))
  );

  const mediaHeaderBox = isVideo
    ? fullBox("vmhd", 0, 1, u16be(0), u16be(0), u16be(0), u16be(0)) // graphicsmode/opcolor
    : fullBox("smhd", 0, 0, u16be(0), u16be(0));                     // balance

  const dinf = box(
    "dinf",
    fullBox("dref", 0, 0, u32be(1), fullBox("url ", 0, 1))
  );

  const stbl = box("stbl", fullBox("stsd", 0, 0, u32be(1), sampleEntryBox), ...buildEmptySampleTables());

  const minf = box("minf", mediaHeaderBox, dinf, stbl);
  const mdia = box("mdia", mdhd, hdlr, minf);

  return box("trak", tkhd, mdia);
}

// ─── トップレベル: ftyp + moov ────────────────────────────────────────────────

/**
 * 静的 Smooth Streaming の CodecPrivateData から、companion への mux/remux に
 * そのまま渡せる fMP4 init セグメント(ftyp+moov、mvex/trex 付き)を構築する。
 *
 * @param {object} track
 * @param {"video"|"audio"} [track.kind] - 省略時は fourCC から推定する
 * @param {string} track.fourCC          - "H264"|"AVC1"(映像) / "AAC*"(音声)
 * @param {string} track.codecPrivateData - マニフェストの CodecPrivateData(hex文字列)
 * @param {number} [track.width]
 * @param {number} [track.height]
 * @param {number} [track.channels]
 * @param {number} [track.sampleRate]
 * @param {number} [track.timescale] - 省略時 10,000,000(MSS既定の100ns単位)
 * @returns {ArrayBuffer}
 */
function buildMssInitSegment(track) {
  const fourCC    = (track.fourCC || "").toUpperCase();
  const isVideo   = /^(H264|AVC1)$/.test(fourCC);
  const isAudio   = /^AAC/.test(fourCC);
  const kind      = track.kind || (isVideo ? "video" : isAudio ? "audio" : null);
  const timescale = track.timescale || 10000000;

  if (kind !== "video" && kind !== "audio") {
    throw new Error(`mss_unsupported_fourcc: ${track.fourCC}`);
  }

  let sampleEntryBox;
  if (kind === "video") {
    const { sps, pps } = parseAvcCodecPrivateData(track.codecPrivateData);
    sampleEntryBox = buildAvc1SampleEntry(track.width, track.height, buildAvcC(sps, pps));
  } else {
    const asc = hexToBytes(track.codecPrivateData);
    sampleEntryBox = buildMp4aSampleEntry(track.channels || 2, track.sampleRate || 44100, buildEsds(asc));
  }

  const trak = buildTrak(kind, sampleEntryBox, timescale, track.width || 0, track.height || 0);

  const mvhd = fullBox(
    "mvhd", 0, 0,
    u32be(0), u32be(0),         // creation_time, modification_time
    u32be(timescale),
    u32be(0),                    // duration(不明=0)
    u32be(0x00010000),           // rate = 1.0
    u16be(0x0100),                // volume = 1.0
    u16be(0),                     // reserved
    u32be(0), u32be(0),            // reserved[2]
    u32be(0x00010000), u32be(0), u32be(0),
    u32be(0), u32be(0x00010000), u32be(0),
    u32be(0), u32be(0), u32be(0x40000000), // unity matrix
    u32be(0), u32be(0), u32be(0), u32be(0), u32be(0), u32be(0), // pre_defined[6]
    u32be(2)                       // next_track_ID
  );

  const trex = fullBox(
    "trex", 0, 0,
    u32be(1),  // track_ID
    u32be(1),  // default_sample_description_index
    u32be(0),  // default_sample_duration
    u32be(0),  // default_sample_size
    u32be(0)   // default_sample_flags
  );
  const mvex = box("mvex", trex);

  const moov = box("moov", mvhd, trak, mvex);

  const ftyp = box(
    "ftyp",
    fourcc("isom"),
    u32be(0x200),
    ...["isom", "iso2", "avc1", "mp41"].map(fourcc)
  );

  const result = new Uint8Array(ftyp.length + moov.length);
  result.set(ftyp, 0);
  result.set(moov, ftyp.length);

  assertTopLevelBoxSizes(result); // 非自明な2進構築の自己チェック

  return result.buffer;
}

/** 組み立てたバッファの先頭から size+type を辿り、宣言サイズの合計が全長と一致するか検証する */
function assertTopLevelBoxSizes(buf) {
  let offset = 0;
  while (offset < buf.length) {
    if (offset + 8 > buf.length) throw new Error("mss_init_segment_truncated_box_header");
    const size = (buf[offset] << 24) | (buf[offset + 1] << 16) | (buf[offset + 2] << 8) | buf[offset + 3];
    if (size <= 0 || offset + size > buf.length) {
      throw new Error(`mss_init_segment_box_size_mismatch at offset ${offset}: size=${size}`);
    }
    offset += size;
  }
  if (offset !== buf.length) throw new Error("mss_init_segment_trailing_bytes");
}

  if (typeof module !== "undefined") {
    module.exports = {
      buildMssInitSegment, buildAvcC, buildEsds,
      parseAvcCodecPrivateData, splitAnnexBNals, hexToBytes,
    };
  } else {
    // dashSegments.js から直接グローバル参照される
    self.buildMssInitSegment = buildMssInitSegment;
  }
})();
