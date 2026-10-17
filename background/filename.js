// background/filename.js — MimicVault
// ファイル名テンプレート展開 applyFilenameTemplate/sanitizeFilename

"use strict";

// ─── ファイル名テンプレート展開（v0.18.0） ────────────────────────────────────
/**
 * 設定の filenameTemplate を展開してファイル名を生成する。
 *
 * 対応変数:
 *   %title — URL パスの末尾ステム（拡張子なし）。inferStem() で取得。
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

  const safeStem = sanitizeFilename(stem ?? "media");
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

if (typeof module !== "undefined") {
  module.exports = { applyFilenameTemplate, sanitizeFilename };
}

// 自己チェック（CLAUDE.md: 非自明ロジックに実行可能チェックを1つ残す）。
// applyFilenameTemplate は呼び出しごとに渡された stem だけを使うこと
// （= モジュール内に状態を持たない）を確認する。かつてはモジュールスコープの
// 上書き変数を使っていたため、並行DL時に無関係な呼び出し同士が影響し合う
// バグがあった（background/bookmarkDownload.js 参照）。
(function selfCheck() {
  if (typeof settingsCache === "undefined") globalThis.settingsCache = { filenameTemplate: "%title" };
  const a = applyFilenameTemplate("bookmark_stem", "mp4");
  const b = applyFilenameTemplate("other_stem", "mp4");
  if (a !== "bookmark_stem.mp4" || b !== "other_stem.mp4") {
    console.error("[filename] selfCheck 失敗: 呼び出し間で stem が混線した", { a, b });
  }
})();

