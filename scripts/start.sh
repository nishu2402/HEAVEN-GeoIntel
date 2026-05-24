#!/bin/bash
set -e

echo ""
echo "  ██████╗ ██╗  ██╗ ██████╗ ███╗   ██╗███████╗ ██████╗ ███████╗██╗███╗   ██╗████████╗"
echo "  ██╔══██╗██║  ██║██╔═══██╗████╗  ██║██╔════╝██╔═══██╗██╔════╝██║████╗  ██║╚══██╔══╝"
echo "  ██████╔╝███████║██║   ██║██╔██╗ ██║█████╗  ██║   ██║███████╗██║██╔██╗ ██║   ██║   "
echo "  ██╔═══╝ ██╔══██║██║   ██║██║╚██╗██║██╔══╝  ██║   ██║╚════██║██║██║╚██╗██║   ██║   "
echo "  ██║     ██║  ██║╚██████╔╝██║ ╚████║███████╗╚██████╔╝███████║██║██║ ╚████║   ██║   "
echo "  ╚═╝     ╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═══╝╚══════╝ ╚═════╝ ╚══════╝╚═╝╚═╝  ╚═══╝   ╚═╝   "
echo ""
echo "  HEAVEN-GeoIntel // Phone OSINT Platform v2.0"
echo "  Defensive metadata intelligence — no tracking, no geolocation"
echo ""
echo "──────────────────────────────────────────────────────────────────"

# Check Node.js
if ! command -v node &>/dev/null; then
  echo "[ERROR] Node.js is not installed."
  echo "        Download from: https://nodejs.org (v18 or higher)"
  exit 1
fi

NODE_VER=$(node -e "process.stdout.write(process.version.replace('v','').split('.')[0])")
if [ "$NODE_VER" -lt 18 ]; then
  echo "[ERROR] Node.js v18+ required. You have: $(node --version)"
  echo "        Download from: https://nodejs.org"
  exit 1
fi

# Check npm
if ! command -v npm &>/dev/null; then
  echo "[ERROR] npm is not installed. Install Node.js from https://nodejs.org"
  exit 1
fi

echo "[+] Node.js $(node --version) detected"
echo "[+] npm $(npm --version) detected"
echo ""

# Install dependencies if node_modules is missing or package.json changed
if [ ! -d "node_modules" ] || [ "package.json" -nt "node_modules/.package-lock.json" ]; then
  echo "[+] Installing dependencies..."
  npm install --silent
  echo "[+] Dependencies installed"
else
  echo "[+] Dependencies already installed — skipping npm install"
fi

echo ""

# Copy .env.example to .env.local if .env.local does not exist
if [ ! -f ".env.local" ]; then
  cp .env.example .env.local
  echo "[+] Created .env.local from .env.example"
  echo "    (Optional: add API keys to .env.local for carrier/fraud enrichment)"
else
  echo "[+] .env.local already exists"
fi

# Auto-install global 'geointel' command if not already installed
if ! command -v geointel &>/dev/null && [ ! -f "/usr/local/bin/geointel" ]; then
  PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  SHELL_RC=""
  if [ -f "$HOME/.zshrc" ]; then SHELL_RC="$HOME/.zshrc"; elif [ -f "$HOME/.bashrc" ]; then SHELL_RC="$HOME/.bashrc"; fi
  MARKER="# HEAVEN-GeoIntel global command"

  if [ -w "/usr/local/bin" ]; then
    printf '#!/bin/bash\ncd "%s" && bash scripts/start.sh "$@"\n' "$PROJECT_DIR" > /usr/local/bin/geointel
    chmod +x /usr/local/bin/geointel
    echo "[✓] Global command installed: type 'geointel' anywhere to start"
  elif [ -n "$SHELL_RC" ] && ! grep -q "$MARKER" "$SHELL_RC" 2>/dev/null; then
    printf '\n%s\ngeointel() { cd "%s" && bash scripts/start.sh "$@"; }\n' "$MARKER" "$PROJECT_DIR" >> "$SHELL_RC"
    echo "[✓] Added 'geointel' to $SHELL_RC — run: source $SHELL_RC"
  fi
fi

# Port detection — find first available port starting at 3000
PORT=3000
while lsof -i TCP:"$PORT" &>/dev/null 2>&1; do
  PORT=$((PORT + 1))
done

echo ""
echo "──────────────────────────────────────────────────────────────────"
echo "[✓] Ready — starting development server on port $PORT..."
echo ""
echo "  Open your browser at:  http://localhost:$PORT"
echo ""
echo "  The app works immediately without any API keys."
echo "  Press Ctrl+C to stop."
echo "──────────────────────────────────────────────────────────────────"
echo ""

PORT=$PORT node node_modules/next/dist/bin/next dev
