#!/bin/bash
# HEAVEN-GeoIntel — one-command startup.
# Checks Node, installs deps, seeds .env.local, picks a free port, starts dev.
set -e

GREEN='\033[0;32m'; CYAN='\033[0;36m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'

echo ""
echo -e "${GREEN}╔══════════════════════════════════════════════════════════╗${NC}"
echo -e "${GREEN}║       HEAVEN-GeoIntel — Unified OSINT Platform            ║${NC}"
echo -e "${GREEN}╚══════════════════════════════════════════════════════════╝${NC}"
echo ""

# Resolve repo root = parent of this script's dir (script lives in scripts/).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_DIR"

# Node version check (Next.js 16 needs Node 20.9+)
if ! command -v node &>/dev/null; then
  echo -e "${RED}[✗] Node.js not found. Install Node 20.9+ from https://nodejs.org${NC}"
  exit 1
fi
NODE_MAJOR=$(node -v | sed 's/v\([0-9]*\).*/\1/')
if [ "$NODE_MAJOR" -lt 20 ]; then
  echo -e "${RED}[✗] Node $(node -v) too old. Need Node 20.9+.${NC}"
  exit 1
fi
echo -e "${GREEN}[✓]${NC} Node $(node -v)"

# Install deps if missing
if [ ! -d "node_modules/next" ]; then
  echo -e "${YELLOW}[~] Installing dependencies (first run)...${NC}"
  npm install
else
  echo -e "${GREEN}[✓]${NC} Dependencies present"
fi

# Seed .env.local from template if missing
if [ ! -f ".env.local" ] && [ -f ".env.example" ]; then
  cp .env.example .env.local
  echo -e "${GREEN}[✓]${NC} Created .env.local from template (all keys optional)"
fi

# Pick a free port starting at 3000
PORT=3000
while lsof -i ":$PORT" &>/dev/null; do
  echo -e "${YELLOW}[~] Port $PORT busy, trying $((PORT+1))...${NC}"
  PORT=$((PORT+1))
done
echo -e "${GREEN}[✓]${NC} Port $PORT available"

echo ""
echo -e "${CYAN}Starting dev server at http://localhost:$PORT${NC}"
echo ""

# Start Next.js dev (call binary directly — robust against broken .bin symlinks)
exec node node_modules/next/dist/bin/next dev -p "$PORT"
