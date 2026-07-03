// popup/js/state.js — MimicVault
// DOM 参照・共有状態・各種ダウンロード状態マップ（最初に読み込む）

"use strict";

// ─── DOM 参照 ─────────────────────────────────────────────────────────────────
const elEmpty    = document.getElementById("state-empty");
const elNoMatch  = document.getElementById("state-no-match");
const elList     = document.getElementById("media-list");
const elBadge    = document.getElementById("badge");
const elCount    = document.getElementById("count-label");
const elToolbar  = document.getElementById("toolbar");
const elClearBtn = document.getElementById("clear-btn");
const elSort     = document.getElementById("sort-select");
const elLiveBanner = document.getElementById("live-banner");
const filterTabs = document.querySelectorAll(".filter-tab");
const elCompanionIndicator = document.getElementById("companion-indicator");
const elSettingsBtn        = document.getElementById("settings-btn");
const elDlAllBtn           = document.getElementById("dl-all-btn");

// ─── 状態 ─────────────────────────────────────────────────────────────────────
let allItems     = [];     // background から取得した全アイテム
let activeFilter = "all";  // "all" | "video" | "audio"
let currentTabId = null;   // サムネイルリクエストで使うタブ ID

// ステップ18: 設定キャッシュ（hlsPreferred を HLS アコーディオン表示に反映するのに使用）
let userSettings = { hlsPreferred: "highest", filenameTemplate: "%title", popupMinDurationSec: 10, popupMinSizeKB: 50 };

/**
 * ポップアップ表示用メタ情報の先読みキャッシュ（v0.19.0）。
 * GET_MEDIA_META の応答を格納し、buildItem が方式・長さ・結合後サイズを表示するのに使う。
 * key: item.url, value: { method, durationSec, sizeBytes, estimated }
 */
const mediaMetaStore = new Map();

// ─── ダウンロード状態管理 ──────────────────────────────────────────────────────
/**
 * key: item.url
 * value: {
 *   downloadId: number,
 *   state: "downloading" | "complete" | "error" | "interrupted",
 *   progress: number,   // 0〜100（bytesReceived / totalBytes）
 * }
 */
const downloadStates = new Map();

/**
 * HLS セグメントダウンロードの状態管理。
 * key: Media Playlist URL
 * value: {
 *   state:   "fetching" | "complete" | "error",
 *   current: number,   // 取得済みセグメント数
 *   total:   number,   // 総セグメント数
 *   error?:  string,
 * }
 */
const hlsDownloadStates = new Map();

/**
 * ダウンロード状態を downloadStates に反映する。
 * ダウンロードIDから URL を逆引きするため downloadIdToUrl も管理する。
 */
const downloadIdToUrl = new Map();  // downloadId → url

/**
 * DASH トラックダウンロードの状態管理（ステップ12）。
 * key: `${mpdUrl}::${repId}`
 * value: { state: "fetching"|"complete"|"error", current, total, error? }
 */
const dashDownloadStates = new Map();

/**
 * DASH mux の状態管理（v0.18.0）。
 * key: mpdUrl, value: { state: "fetching"|"complete"|"error", phase, current, total, error? }
 */
const dashMuxStates = new Map();

/**
 * DASH mux 開始時のメタ情報。
 * key: mpdUrl, value: { item, videoRep, audioRep, detectedAt }
 */
const dashMuxMeta = new Map();

/**
 * MPD URL ごとの総再生時間（秒）。
 * FETCH_DASH_INFO レスポンスを受け取ったときに格納し、
 * DOWNLOAD_DASH_TRACK 送信時に参照する。
 * key: mpdUrl, value: number（秒）
 */
const mpdDurationStore = new Map();

/**
 * ライブ録画セッションの状態管理（ステップ10）。
 * key: Media Playlist URL
 * value: {
 *   state:         "recording" | "stopped" | "ended",
 *   totalSegments: number,
 *   chunkIndex:    number,
 *   stem:          string,
 * }
 */
const liveRecordingStates = new Map();

