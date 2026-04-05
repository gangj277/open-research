#!/usr/bin/env bash
set -euo pipefail

# ── Open Research CLI Installer ──────────────────────────────────────────────
# curl -fsSL https://raw.githubusercontent.com/gangj277/open-research/main/install.sh | bash

REPO="gangj277/open-research"
PACKAGE="open-research"
BIN_NAME="open-research"
INSTALL_DIR="${OPEN_RESEARCH_INSTALL_DIR:-$HOME/.open-research/bin}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
CYAN='\033[0;36m'
DIM='\033[2m'
BOLD='\033[1m'
RESET='\033[0m'

info()  { echo -e "${CYAN}${BOLD}▪${RESET} $1"; }
ok()    { echo -e "${GREEN}${BOLD}✓${RESET} $1"; }
err()   { echo -e "${RED}${BOLD}✗${RESET} $1" >&2; }
dim()   { echo -e "${DIM}  $1${RESET}"; }

echo ""
echo -e "${BOLD}${CYAN}Open Research${RESET} — installer"
echo ""

# ── Detect platform ──────────────────────────────────────────────────────────

OS="$(uname -s)"
ARCH="$(uname -m)"

case "$OS" in
  Linux*)   PLATFORM="linux" ;;
  Darwin*)  PLATFORM="darwin" ;;
  MINGW*|MSYS*|CYGWIN*) PLATFORM="windows" ;;
  *)        err "Unsupported OS: $OS"; exit 1 ;;
esac

case "$ARCH" in
  x86_64|amd64)  ARCH="x64" ;;
  arm64|aarch64) ARCH="arm64" ;;
  *)             err "Unsupported architecture: $ARCH"; exit 1 ;;
esac

info "Detected ${PLATFORM}-${ARCH}"

# ── Check for Node.js ────────────────────────────────────────────────────────

if command -v node &> /dev/null; then
  NODE_VERSION=$(node -v | sed 's/v//')
  NODE_MAJOR=$(echo "$NODE_VERSION" | cut -d. -f1)
  if [ "$NODE_MAJOR" -ge 20 ]; then
    ok "Node.js v${NODE_VERSION} found"
  else
    err "Node.js v${NODE_VERSION} found but v20+ is required"
    dim "Install via: https://nodejs.org or nvm install 20"
    exit 1
  fi
else
  err "Node.js not found (v20+ required)"
  dim "Install via: https://nodejs.org or nvm install 20"
  dim ""
  dim "Quick install:"
  dim "  macOS:  brew install node"
  dim "  Linux:  curl -fsSL https://fnm.vercel.app/install | bash && fnm install 20"
  exit 1
fi

# ── Install via npm ──────────────────────────────────────────────────────────

if command -v npm &> /dev/null; then
  info "Installing ${PACKAGE} via npm..."
  npm install -g "$PACKAGE" 2>&1 | while IFS= read -r line; do dim "$line"; done

  if command -v "$BIN_NAME" &> /dev/null; then
    INSTALLED_PATH=$(command -v "$BIN_NAME")
    INSTALLED_VERSION=$("$BIN_NAME" --version 2>/dev/null || echo "0.1.0")
    echo ""
    ok "Installed ${BOLD}${PACKAGE}@${INSTALLED_VERSION}${RESET}"
    dim "Location: ${INSTALLED_PATH}"
    echo ""
    echo -e "  Get started:"
    echo ""
    echo -e "    ${CYAN}open-research${RESET}          Launch the TUI"
    echo -e "    ${DIM}/auth${RESET}                  Connect your OpenAI account"
    echo -e "    ${DIM}/init${RESET}                  Initialize a workspace"
    echo -e "    ${DIM}/help${RESET}                  Show all commands"
    echo ""
  else
    err "Installation completed but '${BIN_NAME}' not found in PATH"
    dim "Try: npm list -g ${PACKAGE}"
    dim "Or add npm global bin to PATH: export PATH=\"\$(npm prefix -g)/bin:\$PATH\""
    exit 1
  fi
else
  err "npm not found. Install Node.js first: https://nodejs.org"
  exit 1
fi
