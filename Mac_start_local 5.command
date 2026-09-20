#!/bin/bash
# MTG Commander - macOS local launcher
# Starts Vite bound ONLY to localhost, avoiding LAN exposure and bypassing
# the project's MongoDB-dependent npm predev hook.

set -e
cd "$(dirname "$0")"

echo "========================================"
echo "       MTG Commander - macOS Start"
echo "========================================"
echo

if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: Node.js is not installed or is not available in PATH."
  echo "Install a compatible Node.js version, then run this launcher again."
  read -r -p "Press Return to close..."
  exit 1
fi

if ! command -v npm >/dev/null 2>&1; then
  echo "ERROR: npm is not installed or is not available in PATH."
  read -r -p "Press Return to close..."
  exit 1
fi

echo "Node: $(node -v)"
echo "npm:  $(npm -v)"
echo

# Install dependencies if this is a fresh clone.
if [ ! -d node_modules ]; then
  echo "Installing dependencies..."
  if [ -f package-lock.json ]; then
    if ! npm ci; then
      echo
      echo "package-lock.json is not synchronized; repairing with npm install..."
      npm install
    fi
  else
    npm install
  fi
  echo
fi

echo "Starting MTG Commander locally..."
echo "MongoDB startup/synchronization is intentionally skipped."
echo "The server will listen only on 127.0.0.1 (this Mac)."
echo
echo "Open: http://127.0.0.1:5173/"
echo "Keep this Terminal window open while playing."
echo

# Invoke Vite directly so npm's predev MongoDB hook does not run.
# --host 127.0.0.1 prevents exposure on the LAN.
./node_modules/.bin/vite --host 127.0.0.1 --port 5173

STATUS=$?
if [ "$STATUS" -ne 0 ]; then
  echo
  echo "MTG Commander exited with status $STATUS."
  read -r -p "Press Return to close..."
fi
exit "$STATUS"
