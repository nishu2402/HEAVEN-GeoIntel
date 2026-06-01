#!/bin/bash
# HEAVEN-GeoIntel — one-command startup.
# Default = PRODUCTION mode (next build + next start) bound to 0.0.0.0, so the
# app is fully reachable from other devices on the LAN with NO dev-server
# cross-origin (CSRF) blocking — that block only exists in `next dev`.
# Pass --dev to run the hot-reload dev server instead (local development).
set -e

GREEN='\033[0;32m'; CYAN='\033[0;36m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'

MODE="prod"
[ "${1:-}" = "--dev" ] && MODE="dev"

echo ""
echo -e "${GREEN}==============================================================${NC}"
echo -e "${GREEN}       HEAVEN-GeoIntel - Unified OSINT Platform  v1.3${NC}"
echo -e "${GREEN}==============================================================${NC}"
echo ""

# Repo root = parent of this script's dir (script lives in scripts/).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_DIR"

# Node version check (Next.js 16 needs Node 20.9+)
if ! command -v node >/dev/null 2>&1; then
  echo -e "${RED}[x] Node.js not found. Install Node 20.9+ from https://nodejs.org${NC}"
  exit 1
fi
NODE_MAJOR=$(node -v | sed 's/v\([0-9]*\).*/\1/')
if [ "$NODE_MAJOR" -lt 20 ]; then
  echo -e "${RED}[x] Node $(node -v) too old. Need Node 20.9+.${NC}"
  exit 1
fi
echo -e "${GREEN}[ok]${NC} Node $(node -v)"

# Install deps if missing
if [ ! -d "node_modules/next" ]; then
  echo -e "${YELLOW}[~] Installing dependencies (first run)...${NC}"
  npm install
else
  echo -e "${GREEN}[ok]${NC} Dependencies present"
fi

# Seed .env.local from template if missing
if [ ! -f ".env.local" ] && [ -f ".env.example" ]; then
  cp .env.example .env.local
  echo -e "${GREEN}[ok]${NC} Created .env.local from template (all keys optional)"
fi

# Pick a free port starting at 3000
PORT=3000
while lsof -i ":$PORT" >/dev/null 2>&1; do
  echo -e "${YELLOW}[~] Port $PORT busy, trying $((PORT+1))...${NC}"
  PORT=$((PORT+1))
done
echo -e "${GREEN}[ok]${NC} Port $PORT available"

# Detect LAN IP for the Network URL (best-effort, macOS + Linux).
LAN_IP="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || hostname -I 2>/dev/null | awk '{print $1}')"

if [ "$MODE" = "dev" ]; then
  echo ""
  echo -e "${YELLOW}[dev] Hot-reload mode — best for local development.${NC}"
  echo -e "${CYAN}  Local:    http://localhost:$PORT${NC}"
  echo -e "${YELLOW}  Note: open via http://localhost (not 0.0.0.0). For LAN access${NC}"
  echo -e "${YELLOW}        use production mode: bash scripts/start.sh${NC}"
  echo ""
  exec node node_modules/next/dist/bin/next dev -H 0.0.0.0 -p "$PORT"
fi

# ── Production mode (default) ────────────────────────────────────────────────
# Build if there is no prior build (or package.json changed since last build).
NEED_BUILD=0
if [ ! -f ".next/BUILD_ID" ]; then
  NEED_BUILD=1
elif [ "package.json" -nt ".next/BUILD_ID" ]; then
  NEED_BUILD=1
fi
if [ "$NEED_BUILD" -eq 1 ]; then
  echo -e "${YELLOW}[~] Building production bundle (first run / sources changed)...${NC}"
  node node_modules/next/dist/bin/next build
else
  echo -e "${GREEN}[ok]${NC} Production build present"
fi

echo ""
echo -e "${GREEN}  Reachable from this machine AND other devices on your network:${NC}"
echo -e "${CYAN}  Local:    http://localhost:$PORT${NC}"
[ -n "$LAN_IP" ] && echo -e "${CYAN}  Network:  http://$LAN_IP:$PORT${NC}  (open THIS on your phone)"
echo ""
echo -e "${YELLOW}  Tip: hot-reload dev mode -> bash scripts/start.sh --dev${NC}"
echo ""

# next start binds all interfaces by default; -H 0.0.0.0 is explicit. No dev
# CSRF block here, so the Network URL works from any device.
exec node node_modules/next/dist/bin/next start -H 0.0.0.0 -p "$PORT"
