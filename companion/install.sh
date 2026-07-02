#!/usr/bin/env bash
# Media Snatcher companion app — macOS / Linux インストールスクリプト
#
# 実行手順:
#   cd companion/
#   chmod +x install.sh media-snatcher
#   ./install.sh
#
# 実行内容:
#   1. このスクリプトのディレクトリを companion のルートとして扱う
#   2. media-snatcher ラッパーを実行可能に設定
#   3. Native Messaging ホストマニフェストを Firefox の所定位置に配置する
#      - macOS: ~/Library/Application Support/Mozilla/NativeMessagingHosts/
#      - Linux:  ~/.mozilla/native-messaging-hosts/

set -euo pipefail

# ── companion のルートディレクトリ（このスクリプトの場所）────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WRAPPER="$SCRIPT_DIR/media-snatcher"
MANIFEST_TEMPLATE="$SCRIPT_DIR/native-manifest.json"

echo "=== Media Snatcher companion app インストーラ ==="
echo "companion ディレクトリ: $SCRIPT_DIR"

# ── Node.js の確認 ────────────────────────────────────────────────────────────
if ! command -v node &>/dev/null; then
  echo "[ERROR] Node.js が見つかりません。https://nodejs.org/ からインストールしてください。"
  exit 1
fi
NODE_VER=$(node --version)
echo "[OK] Node.js: $NODE_VER"

# ── FFmpeg の確認（警告のみ、インストールは妨げない）──────────────────────────
if ! command -v ffmpeg &>/dev/null; then
  echo "[WARN] ffmpeg が見つかりません。HLS→MP4 変換を使うには ffmpeg が必要です。"
  echo "       https://ffmpeg.org/download.html からインストールしてください。"
else
  FFMPEG_VER=$(ffmpeg -version 2>&1 | head -1 | grep -oP 'ffmpeg version \K[^\s]+')
  echo "[OK] ffmpeg: $FFMPEG_VER"
fi

# ── ラッパースクリプトを実行可能に設定 ───────────────────────────────────────
chmod +x "$WRAPPER"
echo "[OK] ラッパーを実行可能に設定: $WRAPPER"

# ── マニフェスト出力先の決定 ─────────────────────────────────────────────────
OS="$(uname -s)"
if [[ "$OS" == "Darwin" ]]; then
  NM_HOSTS_DIR="$HOME/Library/Application Support/Mozilla/NativeMessagingHosts"
elif [[ "$OS" == "Linux" ]]; then
  NM_HOSTS_DIR="$HOME/.mozilla/native-messaging-hosts"
else
  echo "[ERROR] 対応していない OS です: $OS"
  exit 1
fi

mkdir -p "$NM_HOSTS_DIR"
MANIFEST_DEST="$NM_HOSTS_DIR/media_snatcher.json"

# ── テンプレートから実際のパスを埋め込んでマニフェストを生成 ─────────────────
sed "s|__COMPANION_PATH__|$WRAPPER|g" "$MANIFEST_TEMPLATE" > "$MANIFEST_DEST"
echo "[OK] マニフェストを配置: $MANIFEST_DEST"

# ── 確認 ──────────────────────────────────────────────────────────────────────
echo ""
echo "=== インストール完了 ==="
echo "マニフェスト内容:"
cat "$MANIFEST_DEST"
echo ""
echo "Firefox を再起動後、拡張機能のポップアップ右上に companion 接続インジケータが表示されます。"
