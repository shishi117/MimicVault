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

  // %title を stem に展開
  const safeStem = sanitizeFilename(stem || "media");
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

