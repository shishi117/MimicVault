#!/usr/bin/env bash
# MimicVault 拡張機能 — Firefox 永続インストール（enterprise policy）: macOS / Linux
#
# 実行内容:
#   1. web-ext で XPI をビルドし、~/.mimicvault/mimicvault.xpi に配置
#   2. deploy/policies.json の __XPI_PATH__ を実パスへ置換して Firefox の policies ディレクトリへコピー
#      （force_installed で永続追加 + プライベートウィンドウ許可）
#   3. 未署名 XPI を使うため xpinstall.signatures.required=false の手動設定を案内
#
# 前提: ESR / Developer Edition（Release版は未署名を拒否）。node/npm 済み。
#
# 使い方:
#   ./deploy/install-policy.sh [FIREFOX_POLICIES_DIR]
#   例) ./deploy/install-policy.sh /etc/firefox/policies      # システム全体（要 sudo）
#       ./deploy/install-policy.sh ~/firefox-deved/distribution

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
TEMPLATE="$SCRIPT_DIR/policies.json"

echo "=== MimicVault 拡張機能 policy インストーラ ==="

# ── XPI の配置先（安定パス）─────────────────────────────────────────────────
XPI_DIR="$HOME/.mimicvault"
XPI_PATH="$XPI_DIR/mimicvault.xpi"
mkdir -p "$XPI_DIR"

# ── ビルド ──────────────────────────────────────────────────────────────────
echo "[..] web-ext build"
( cd "$REPO_ROOT" && npm run --silent build )
ZIP="$(ls -t "$REPO_ROOT"/web-ext-artifacts/*.zip | head -1)"
if [[ -z "${ZIP:-}" || ! -f "$ZIP" ]]; then
  echo "[ERROR] ビルド成果物 (web-ext-artifacts/*.zip) が見つかりません。"
  exit 1
fi
cp -f "$ZIP" "$XPI_PATH"
echo "[OK] XPI 配置: $XPI_PATH  ($(du -h "$XPI_PATH" | cut -f1))"

# ── policies.json の配置先 ───────────────────────────────────────────────────
if [[ -n "${1:-}" ]]; then
  POLICIES_DIR="$1"
else
  OS="$(uname -s)"
  case "$OS" in
    Linux)  POLICIES_DIR="/etc/firefox/policies" ;;
    Darwin) POLICIES_DIR="/Applications/Firefox Developer Edition.app/Contents/Resources/distribution" ;;
    *) echo "[ERROR] 対応していない OS: $OS（第1引数で policies ディレクトリを指定してください）"; exit 1 ;;
  esac
  echo "[i] policies 配置先を自動選択: $POLICIES_DIR"
  echo "    別の Firefox を使う場合は第1引数でディレクトリを指定してください。"
fi

mkdir -p "$POLICIES_DIR" 2>/dev/null || { echo "[ERROR] $POLICIES_DIR を作成できません（sudo が必要な場合があります）。"; exit 1; }

# ── テンプレート置換して配置 ─────────────────────────────────────────────────
DEST="$POLICIES_DIR/policies.json"
sed "s|__XPI_PATH__|$XPI_PATH|g" "$TEMPLATE" > "$DEST"
echo "[OK] policies.json 配置: $DEST"

echo ""
echo "=== 完了 ==="
echo "配置内容:"
cat "$DEST"
echo ""
echo "▼ 未署名 XPI を有効にする一度きりの手動設定（ESR / Developer Edition のみ）:"
echo "   about:config → xpinstall.signatures.required を false に設定"
echo "その後 Firefox を再起動すると、about:addons に MimicVault が"
echo "「企業ポリシーにより追加」として常駐します。about:policies でも確認できます。"
