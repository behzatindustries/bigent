#!/usr/bin/env sh
set -eu

REPO_URL="${BIGENT_REPO_URL:-https://github.com/behzatindustries/bigent.git}"
INSTALL_DIR="${BIGENT_INSTALL_DIR:-$HOME/.local/share/bigent}"
BIN_DIR="${BIGENT_BIN_DIR:-$HOME/.local/bin}"
BIN_PATH="$BIN_DIR/bigent"
CONFIG_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/bigent"
ENV_FILE="$CONFIG_DIR/bigent.env"
SYSTEMD_USER_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
SERVICE_FILE="$SYSTEMD_USER_DIR/bigent-telegram.service"

need() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

need git
need npm
need node

NODE_MAJOR="$(node -e 'console.log(Number(process.versions.node.split(".")[0]))')"
if [ "$NODE_MAJOR" -lt 22 ]; then
  echo "BIgent requires Node.js 22 or newer. Current: $(node --version)" >&2
  exit 1
fi

mkdir -p "$BIN_DIR"

if [ -d "$INSTALL_DIR/.git" ]; then
  echo "Updating BIgent in $INSTALL_DIR"
  git -C "$INSTALL_DIR" fetch --prune origin
  git -C "$INSTALL_DIR" checkout main
  git -C "$INSTALL_DIR" pull --ff-only origin main
else
  echo "Installing BIgent into $INSTALL_DIR"
  rm -rf "$INSTALL_DIR"
  git clone "$REPO_URL" "$INSTALL_DIR"
fi

cd "$INSTALL_DIR"
npm ci
npm run build

ln -sf "$INSTALL_DIR/dist/cli.js" "$BIN_PATH"
chmod +x "$INSTALL_DIR/dist/cli.js"

prompt() {
  label="$1"
  default="$2"
  if [ -r /dev/tty ]; then
    if [ "$default" ]; then
      printf "%s [%s]: " "$label" "$default" >/dev/tty
    else
      printf "%s: " "$label" >/dev/tty
    fi
    IFS= read -r answer </dev/tty || answer=""
  else
    answer=""
  fi
  if [ "$answer" ]; then
    printf "%s" "$answer"
  else
    printf "%s" "$default"
  fi
}

prompt_secret() {
  label="$1"
  if [ -r /dev/tty ]; then
    printf "%s: " "$label" >/dev/tty
    old_tty="$(stty -g </dev/tty 2>/dev/null || true)"
    stty -echo </dev/tty 2>/dev/null || true
    IFS= read -r answer </dev/tty || answer=""
    if [ "$old_tty" ]; then stty "$old_tty" </dev/tty 2>/dev/null || true; fi
    printf "\n" >/dev/tty
    printf "%s" "$answer"
  else
    printf ""
  fi
}

env_quote() {
  printf "%s" "$1" | sed "s/'/'\\\\''/g"
}

write_env() {
  mkdir -p "$CONFIG_DIR"
  {
    printf "TELEGRAM_BOT_TOKEN='%s'\n" "$(env_quote "$TELEGRAM_BOT_TOKEN_VALUE")"
    printf "BIGENT_TELEGRAM_ALLOWLIST='%s'\n" "$(env_quote "$BIGENT_TELEGRAM_ALLOWLIST_VALUE")"
    printf "BIGENT_CWD='%s'\n" "$(env_quote "$BIGENT_CWD_VALUE")"
    printf "BIGENT_HOME='%s'\n" "$(env_quote "$BIGENT_HOME_VALUE")"
    printf "BIGENT_PI_PROVIDER='%s'\n" "$(env_quote "$BIGENT_PI_PROVIDER_VALUE")"
    printf "BIGENT_PI_MODEL='%s'\n" "$(env_quote "$BIGENT_PI_MODEL_VALUE")"
    printf "BIGENT_PI_API_KEY='%s'\n" "$(env_quote "$BIGENT_PI_API_KEY_VALUE")"
    printf "BIGENT_PI_THINKING='%s'\n" "$(env_quote "$BIGENT_PI_THINKING_VALUE")"
  } >"$ENV_FILE"
  chmod 600 "$ENV_FILE"
}

install_service() {
  mkdir -p "$SYSTEMD_USER_DIR"
  cat >"$SERVICE_FILE" <<EOF
[Unit]
Description=BIgent Telegram Agent
After=network-online.target

[Service]
Type=simple
EnvironmentFile=$ENV_FILE
ExecStart=$BIN_PATH telegram
Restart=on-failure
RestartSec=5
WorkingDirectory=%h

[Install]
WantedBy=default.target
EOF

  if command -v systemctl >/dev/null 2>&1; then
    systemctl --user daemon-reload || true
    systemctl --user enable --now bigent-telegram.service || true
  fi
}

echo ""
echo "BIgent setup"
if [ ! -r /dev/tty ]; then
  echo "No TTY detected, skipping interactive Telegram/model setup."
  echo "Run manually later: $BIN_PATH help"
else
  TELEGRAM_BOT_TOKEN_VALUE="$(prompt_secret "Telegram bot token (leave blank to skip)")"
  BIGENT_TELEGRAM_ALLOWLIST_VALUE="$(prompt "Allowed Telegram user/chat ID, comma-separated for more (use @userinfobot if needed)" "")"
  while [ ! "$BIGENT_TELEGRAM_ALLOWLIST_VALUE" ]; do
    echo "Allowlist is required so BIgent only talks to approved Telegram IDs." >/dev/tty
    BIGENT_TELEGRAM_ALLOWLIST_VALUE="$(prompt "Allowed Telegram user/chat ID" "")"
  done
  BIGENT_CWD_VALUE="$(prompt "BIgent working directory" "$HOME")"
  BIGENT_HOME_VALUE="$(prompt "BIgent state directory" "$HOME/.bigent")"
  BIGENT_PI_PROVIDER_VALUE="$(prompt "Pi provider" "anthropic")"
  BIGENT_PI_MODEL_VALUE="$(prompt "Pi model" "claude-sonnet-4-5")"
  BIGENT_PI_API_KEY_VALUE="$(prompt_secret "Pi provider API key (leave blank to use existing Pi/env auth)")"
  BIGENT_PI_THINKING_VALUE="$(prompt "Pi thinking level" "medium")"
  write_env
  echo "Wrote config: $ENV_FILE"

  SERVICE_DEFAULT="yes"
  if [ ! "$TELEGRAM_BOT_TOKEN_VALUE" ]; then
    SERVICE_DEFAULT="no"
  fi
  SERVICE_ANSWER="$(prompt "Install and start user systemd Telegram service? yes/no" "$SERVICE_DEFAULT")"
  case "$SERVICE_ANSWER" in
    y|Y|yes|YES|Yes)
      install_service
      echo "User service installed: bigent-telegram.service"
      ;;
    *)
      echo "Skipped systemd service."
      ;;
  esac
fi

echo "BIgent installed: $BIN_PATH"
echo "Run: bigent help"
echo "Update BIgent and Pi later with: bigent update"
