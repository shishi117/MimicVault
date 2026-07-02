// background/domainFilter.js — MimicVault
// ワイルドカード ドメイン照合 isDomainFiltered ほか

"use strict";

// ─── ワイルドカード ドメイン照合 ──────────────────────────────────────────────
/**
 * `*` を含むドメインパターンをホスト名に照合する。
 *
 * 対応:
 *   - `example.com`       → 完全一致のみ
 *   - `*.example.com`     → foo.example.com / bar.baz.example.com にマッチ
 *                            （example.com 自身にはマッチしない）
 *   - `example.*`         → example.com / example.co.jp にマッチ
 *   - `*.foo.*`           → a.foo.com, b.foo.jp 等にマッチ
 *
 * 比較は小文字で行う。パターンが空なら false を返す。
 *
 * @param {string} hostname - 照合対象のホスト名
 * @param {string} pattern  - 照合パターン
 */
function matchDomainPattern(hostname, pattern) {
  if (!hostname || !pattern) return false;
  const h = hostname.toLowerCase();
  const p = pattern.trim().toLowerCase();
  if (!p) return false;
  if (!p.includes("*")) return h === p;

  // `*` → 正規表現の `[^.]+` （ドット以外の1文字以上）に変換
  // それ以外の特殊文字をエスケープ
  const re = "^" + p.split("*").map(escapeRegex).join("[^.]+") + "$";
  try {
    return new RegExp(re).test(h);
  } catch (_) {
    return false;
  }
}

function escapeRegex(s) {
  return s.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
}

/** URL からホスト名を取り出す（失敗時は空文字列） */
function hostnameOf(url) {
  try { return new URL(url).hostname.toLowerCase(); }
  catch (_) { return ""; }
}

/**
 * 設定に基づいてこの URL を検出対象から除外すべきか判定する。
 *
 * ロジック:
 *   1. ホワイトリストが空でない場合: ホワイトリストにマッチしない URL はすべて除外
 *   2. ブラックリストにマッチする URL は除外
 *   3. それ以外は通過
 */
function isDomainFiltered(url) {
  const host = hostnameOf(url);
  if (!host) return false;  // URL パース失敗時は通過（過剰な除外を避ける）

  const { blacklist, whitelist } = settingsCache;

  if (Array.isArray(whitelist) && whitelist.length > 0) {
    const matched = whitelist.some(pat => matchDomainPattern(host, pat));
    if (!matched) return true;
  }

  if (Array.isArray(blacklist) && blacklist.length > 0) {
    if (blacklist.some(pat => matchDomainPattern(host, pat))) return true;
  }

  return false;
}

