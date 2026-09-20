#!/bin/bash
# MTG Commander - macOS Full Bootstrap
# Run this file from the root of the cloned MTG_Commander repository.
set -euo pipefail

cd "$(dirname "$0")"

echo "=============================================="
echo " MTG Commander - macOS Full Setup"
echo "=============================================="
echo "This installs/checks Homebrew, Node 22, MongoDB 8.0,"
echo "project dependencies, starts MongoDB, and verifies setup."
echo

if [[ "$(uname -s)" != "Darwin" ]]; then
  echo "ERROR: This installer is for macOS."
  exit 1
fi

# Xcode Command Line Tools are required by Homebrew.
if ! xcode-select -p >/dev/null 2>&1; then
  echo "Apple Command Line Tools are required."
  echo "macOS will now open Apple's installer."
  xcode-select --install || true
  echo
  echo "After the Command Line Tools installation finishes,"
  echo "run this setup file again."
  exit 0
fi

# Homebrew
if ! command -v brew >/dev/null 2>&1; then
  echo "Installing Homebrew..."
  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

  if [[ -x /opt/homebrew/bin/brew ]]; then
    eval "$(/opt/homebrew/bin/brew shellenv)"
    grep -q 'brew shellenv' "$HOME/.zprofile" 2>/dev/null || \
      echo 'eval "$(/opt/homebrew/bin/brew shellenv)"' >> "$HOME/.zprofile"
  elif [[ -x /usr/local/bin/brew ]]; then
    eval "$(/usr/local/bin/brew shellenv)"
  fi
fi

if ! command -v brew >/dev/null 2>&1; then
  echo "ERROR: Homebrew was installed but is not available in this shell."
  echo "Close Terminal, reopen it, and run this setup again."
  exit 1
fi

echo "Homebrew: $(brew --version | head -1)"

# Node: project currently declares Node >=22.16 <23.
if ! command -v node >/dev/null 2>&1 || [[ "$(node -p 'process.versions.node.split(`.`)[0]')" != "22" ]]; then
  echo "Installing Node.js 22..."
  brew install node@22
fi

NODE22_PREFIX="$(brew --prefix node@22)"
export PATH="$NODE22_PREFIX/bin:$PATH"
hash -r

# Persist Node 22 preference for future shells.
if ! grep -q 'node@22/bin' "$HOME/.zprofile" 2>/dev/null; then
  echo "export PATH=\"$NODE22_PREFIX/bin:\$PATH\"" >> "$HOME/.zprofile"
fi

echo "Node: $(node -v)"
echo "npm:  $(npm -v)"

# MongoDB Community 8.0
echo "Checking MongoDB..."
brew tap mongodb/brew >/dev/null

if ! brew list --versions mongodb-community@8.0 >/dev/null 2>&1; then
  echo "Installing MongoDB Community 8.0..."
  brew install mongodb-community@8.0
fi

echo "Starting MongoDB..."
brew services start mongodb-community@8.0 >/dev/null || true

# Wait for localhost:27017.
echo "Waiting for MongoDB on 127.0.0.1:27017..."
node - <<'NODE'
const net = require('net');
const deadline = Date.now() + 30000;
function probe() {
  const s = net.createConnection({host:'127.0.0.1', port:27017});
  s.once('connect', () => { s.destroy(); process.exit(0); });
  s.once('error', () => {
    s.destroy();
    if (Date.now() >= deadline) process.exit(1);
    setTimeout(probe, 500);
  });
}
probe();
NODE

echo "MongoDB is reachable."

# Project dependencies
if [[ ! -f package.json ]]; then
  echo "ERROR: package.json was not found."
  echo "Put this file in the MTG_Commander repository root and run it there."
  exit 1
fi

echo "Installing project dependencies..."
if [[ -f package-lock.json ]]; then
  npm ci || {
    echo "npm ci failed; falling back to npm install to repair dependency metadata."
    npm install
  }
else
  npm install
fi

echo
echo "Running architecture check..."
npm run check:architecture

echo
echo "=============================================="
echo " SETUP COMPLETE"
echo "=============================================="
echo "Node:    $(node -v)"
echo "npm:     $(npm -v)"
echo "MongoDB: reachable at 127.0.0.1:27017"
echo
echo "Start the full game with:"
echo "  npm run dev"
echo
