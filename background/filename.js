// background/filename.js — MimicVault
// ファイル名テンプレート展開 applyFilenameTemplate/sanitizeFilename

"use strict";

// ブックマーク一括DL用の一時的なステム上書き（background/bookmarkDownload.js が使用）。
// セットされている間、applyFilenameTemplate は渡された stem の代わりにこの値を %title に使う。
// 既知の上限: モジュールスコープの単一変数のため「逐次処理・単独運用」が前提。
//   ブックマーク一括DL実行中に手動DLを併用すると手動DL側のファイル名も影響を受ける。
//   アップグレードパス = 各ダウンロード関数へ明示引数として stem を通す。
let filenameStemOverride = null;
function setFilenameStemOverride(stem) { filenameStemOverride = stem || null; }

// ─── ファイル名テンプレート展開（v0.18.0） ────────────────────────────────────
/**
 * 設定の filenameTemplate を展開してファイル名を生成する。
 *
 * 対応変数:
 *   %title — URL パスの末尾ステム（拡張子なし）。inferStem() で取得。
 *            filenameStemOverride がセットされている場合はそちらを優先する。
 *
 * テンプレート自体に含まれる OS 非対応文字は `_` に置換する。
 * ディレクトリセパレータ `/` は保持する。
 *
 * @param {string} stem - URL から抽出したステム文字列（拡張子なし）
 * @param {string} ext  - 付与する拡張子（"mp4" 等。ドットなし）
 */
function applyFilenameTemplate(stem, ext) {
  const tmpl = settingsCache.filenameTemplate;
  const template = (tmpl && typeof tmpl === "string") ? tmpl : "%title";

  // %title を stem に展開（上書きがあれば優先）
  const safeStem = sanitizeFilename(filenameStemOverride ?? stem ?? "media");
  let name = template.replace(/%title/g, safeStem);

  // テンプレート残余のサニタイズ（/ は許容）
  name = name.replace(/[\\:*?"<>|]/g, "_").replace(/^[\s.]+|[\s.]+$/g, "").trim() || "media";

  return ext ? `${name}.${ext}` : name;
}

/** ファイル名として使えない文字を除去する */
function sanitizeFilename(s) {
  return s.replace(/[/\\:*?"<>|]/g, "_").replace(/^[\s.]+|[\s.]+$/g, "").trim() || "media";
}

// 後方互換エイリアス（旧 applyFilenamePrefix の呼び出しは下記で置き換え済み）

