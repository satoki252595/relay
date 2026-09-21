#!/bin/bash
# Relay サーバー かんたんセットアップ (macOS / Linux)
# 使い方:
#   curl -fsSL https://raw.githubusercontent.com/satoki252595/relay/main/ops/install.sh | bash
#   ./ops/install.sh [--dir ~/relay-server] [--port 8787] [--no-service] [--uninstall]
set -euo pipefail

DIR="$HOME/relay-server"
PORT="8787"
SERVICE=1
UNINSTALL=0
while [ $# -gt 0 ]; do
  case "$1" in
    --dir) DIR="$2"; shift 2 ;;
    --port) PORT="$2"; shift 2 ;;
    --no-service) SERVICE=0; shift ;;
    --uninstall) UNINSTALL=1; shift ;;
    *) echo "unknown flag: $1" >&2; exit 1 ;;
  esac
done

OS="$(uname -s)"
step() { echo "==> $1"; }
die() { echo "!! $1" >&2; exit 1; }

node_ok() {
  command -v node >/dev/null 2>&1 && [ "$(node -p 'process.versions.node.split(".")[0]')" -ge 20 ]
}

if [ "$UNINSTALL" = 1 ]; then
  step "サービス停止・削除"
  if [ "$OS" = "Darwin" ]; then
    launchctl bootout "gui/$(id -u)/dev.relay.server" 2>/dev/null || true
    rm -f "$HOME/Library/LaunchAgents/dev.relay.server.plist"
  else
    systemctl --user disable --now relay-server.service 2>/dev/null || true
    rm -f "$HOME/.config/systemd/user/relay-server.service"
  fi
  echo "done (フォルダ $DIR は残しています。不要なら削除してください)"
  exit 0
fi

[ "$OS" = "Darwin" ] || [ "$OS" = "Linux" ] || die "macOS / Linux 専用です (Windows は ops/install.ps1)"

# 1. node
if ! node_ok; then
  step "Node.js 20+ を導入します"
  if [ "$OS" = "Darwin" ] && command -v brew >/dev/null 2>&1; then
    brew install node
  elif [ "$OS" = "Linux" ] && command -v apt-get >/dev/null 2>&1; then
    sudo apt-get update && sudo apt-get install -y nodejs npm
  else
    die "Node.js 20+ を入れて再実行してください (https://nodejs.org/)"
  fi
  node_ok || die "node の導入に失敗しました"
fi
command -v git >/dev/null 2>&1 || die "git を入れて再実行してください"
command -v gh >/dev/null 2>&1 || echo "memo: GitHub 連携を使う場合は gh も導入してください"

# 2. ソース取得
if [ -f "$DIR/server/index.js" ]; then
  step "既存ディレクトリを使用: $DIR"
elif [ -f "./server/index.js" ] && [ -f "./package.json" ]; then
  DIR="$(pwd)"
  step "このリポジトリを使用: $DIR"
else
  step "clone: $DIR"
  git clone https://github.com/satoki252595/relay.git "$DIR"
fi
cd "$DIR"
[ -f package.json ] || die "$DIR は Relay リポジトリではありません"

# 3. 依存導入 (サーバー実行分のみ)
step "npm install"
npm install --omit=dev --no-audit --no-fund

# 4. ポート設定
if [ "$PORT" != "8787" ]; then
  grep -q '^PORT=' .env 2>/dev/null || echo "PORT=$PORT" >> .env
fi

# 5. 常駐化
start_now() { :; }
if [ "$SERVICE" = 1 ]; then
  if [ "$OS" = "Darwin" ]; then
    PLIST="$HOME/Library/LaunchAgents/dev.relay.server.plist"
    step "launchd 登録"
    mkdir -p "$(dirname "$PLIST")"
    cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>dev.relay.server</string>
  <key>ProgramArguments</key><array>
    <string>$(command -v node)</string><string>$DIR/server/index.js</string>
  </array>
  <key>WorkingDirectory</key><string>$DIR</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>$DIR/server.log</string>
  <key>StandardErrorPath</key><string>$DIR/server.log</string>
</dict></plist>
EOF
    launchctl bootout "gui/$(id -u)/dev.relay.server" 2>/dev/null || true
    launchctl bootstrap "gui/$(id -u)" "$PLIST"
  else
    UNIT="$HOME/.config/systemd/user/relay-server.service"
    step "systemd ユーザーサービス登録"
    mkdir -p "$(dirname "$UNIT")"
    cat > "$UNIT" <<EOF
[Unit]
Description=Relay server
After=network-online.target
Wants=network-online.target
[Service]
Type=simple
WorkingDirectory=$DIR
ExecStart=$(command -v node) $DIR/server/index.js
Restart=on-failure
RestartSec=5
Environment=PORT=$PORT
[Install]
WantedBy=default.target
EOF
    systemctl --user daemon-reload
    systemctl --user enable --now relay-server.service
  fi
  sleep 3
else
  step "サービス登録なし。このまま起動します (Ctrl-C で停止)"
  node server/index.js &
  SRV_PID=$!
  trap 'kill $SRV_PID 2>/dev/null' EXIT
  sleep 3
fi

# 6. 接続情報
TOKEN="$(cat "$DIR/data/.token" 2>/dev/null | tr -d ' \n')" || true
[ -n "$TOKEN" ] || die "トークンを読めません。server.log を確認してください"
LAN_IP=""
if [ "$OS" = "Darwin" ]; then
  LAN_IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || true)"
else
  LAN_IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
fi
URL="http://${LAN_IP:-127.0.0.1}:$PORT"
echo ""
echo "======== 接続情報 ========"
echo "URL:    $URL"
echo "token:  $TOKEN"
if command -v qrencode >/dev/null 2>&1; then
  echo "--- QR (JSON: url + token) ---"
  printf '{"url":"%s","token":"%s"}' "$URL" "$TOKEN" | qrencode -t ANSIUTF8
fi
echo "=========================="
echo "iPhone アプリに URL と token を入力してください。"
echo "外出先からは Tailscale 等の閉域経由を推奨します。"
