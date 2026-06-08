#!/usr/bin/env sh
set -eu

REPO_URL="${BIGENT_REPO_URL:-https://github.com/behzatindustries/bigent.git}"
INSTALL_DIR="${BIGENT_INSTALL_DIR:-$HOME/.local/share/bigent}"
BIN_DIR="${BIGENT_BIN_DIR:-$HOME/.local/bin}"
BIN_PATH="$BIN_DIR/bigent"

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

echo "BIgent installed: $BIN_PATH"
echo "Run: bigent help"
