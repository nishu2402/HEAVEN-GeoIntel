#!/bin/bash
# HEAVEN-GeoIntel — one-command startup.
#
# Default = PRODUCTION mode (next build + next start) bound to 0.0.0.0, so the
# app is reachable from other devices on the LAN with NO dev-server cross-origin
# (CSRF) blocking — that block ONLY exists in `next dev`. After the server is up
# the script SELF-TESTS the Local and Network URLs and prints a clear verdict,
# so you know exactly whether the problem is the app (it won't be) or your
# network/router (the usual cause of "localhost works, phone doesn't").
#
# Flags:
#   (none)     production mode (recommended; works on the LAN)
#   --dev      hot-reload dev server (local development only)
#   --doctor   diagnose why the Network URL might not reach your phone, then exit
set -e

GREEN='\033[0;32m'; CYAN='\033[0;36m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; BOLD='\033[1m'; NC='\033[0m'

MODE="prod"
case "${1:-}" in
  --dev)    MODE="dev" ;;
  --doctor) MODE="doctor" ;;
esac

# Repo root = parent of this script's dir (script lives in scripts/).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$PROJECT_DIR"

# ── Detect the LAN IPv4 on the interface that owns the default route ─────────
# Prefer the active default-route interface (handles Wi-Fi en0, en1, USB-eth);
# fall back to en0/en1, then Linux `hostname -I`.
detect_lan_ip() {
  local ifc ip
  ifc="$(route -n get default 2>/dev/null | awk '/interface:/{print $2}')"
  if [ -n "$ifc" ]; then
    ip="$(ipconfig getifaddr "$ifc" 2>/dev/null)"
    [ -n "$ip" ] && { printf '%s' "$ip"; return; }
  fi
  ip="$(ipconfig getifaddr en0 2>/dev/null || ipconfig getifaddr en1 2>/dev/null || hostname -I 2>/dev/null | awk '{print $1}')"
  printf '%s' "$ip"
}

# ── Open the app in the default browser (best-effort, interactive only) ──────
# Fires only when stdout is a real terminal, so it never pops a window under
# CI/automation. Honours NO_OPEN=1 and BROWSER=none as an explicit opt-out.
open_browser() {
  [ -t 1 ] || return 0
  [ -n "$NO_OPEN" ] && return 0
  [ "$BROWSER" = "none" ] && return 0
  if command -v open >/dev/null 2>&1; then
    open "$1" >/dev/null 2>&1 &
  elif command -v xdg-open >/dev/null 2>&1; then
    xdg-open "$1" >/dev/null 2>&1 &
  fi
  return 0
}

# ════════════════════════════════════════════════════════════════════════════
#  --doctor : explain why a phone might not reach the Network URL
# ════════════════════════════════════════════════════════════════════════════
if [ "$MODE" = "doctor" ]; then
  echo ""
  echo -e "${GREEN}==============================================================${NC}"
  echo -e "${GREEN}       HEAVEN-GeoIntel - Network Doctor${NC}"
  echo -e "${GREEN}==============================================================${NC}"
  echo ""

  # 1) Node
  if command -v node >/dev/null 2>&1; then
    echo -e "  ${GREEN}[ok]${NC} Node $(node -v)"
  else
    echo -e "  ${RED}[x]${NC} Node.js not found — install Node 20.9+ from https://nodejs.org"
  fi

  # 2) Active interface + LAN IP
  IFC="$(route -n get default 2>/dev/null | awk '/interface:/{print $2}')"
  GW="$(route -n get default 2>/dev/null | awk '/gateway:/{print $2}')"
  LAN_IP="$(detect_lan_ip)"
  if [ -n "$LAN_IP" ]; then
    echo -e "  ${GREEN}[ok]${NC} LAN IP: ${BOLD}$LAN_IP${NC}  (interface ${IFC:-?}, gateway ${GW:-?})"
  else
    echo -e "  ${RED}[x]${NC} No LAN IPv4 found — are you connected to Wi-Fi/Ethernet?"
  fi

  # 3) Active VPN tunnel (can hijack the route so the phone can't reach you)
  if ifconfig 2>/dev/null | grep -A3 '^utun' | grep -q 'inet '; then
    echo -e "  ${YELLOW}[!]${NC} A VPN tunnel (utun) is active — VPNs often block LAN device-to-device traffic."
    echo -e "       Try disconnecting the VPN while you test the phone."
  else
    echo -e "  ${GREEN}[ok]${NC} No active VPN tunnel."
  fi

  # 4) macOS Application Firewall
  if [ -x /usr/libexec/ApplicationFirewall/socketfilterfw ]; then
    FW_STATE="$(/usr/libexec/ApplicationFirewall/socketfilterfw --getglobalstate 2>/dev/null)"
    FW_STEALTH="$(/usr/libexec/ApplicationFirewall/socketfilterfw --getstealthmode 2>/dev/null)"
    NODE_BIN="$(readlink -f "$(command -v node)" 2>/dev/null || command -v node)"
    if echo "$FW_STATE" | grep -qi "enabled"; then
      echo -e "  ${YELLOW}[!]${NC} macOS firewall is ON."
      if /usr/libexec/ApplicationFirewall/socketfilterfw --listapps 2>/dev/null | grep -qF "$NODE_BIN"; then
        echo -e "       ${GREEN}node is allowed to accept incoming connections — good.${NC}"
        echo -e "       ${YELLOW}NOTE:${NC} the allow-rule is tied to THIS exact path:"
        echo -e "         $NODE_BIN"
        echo -e "       If you upgrade Node, re-allow it (the path changes):"
        echo -e "         ${CYAN}sudo /usr/libexec/ApplicationFirewall/socketfilterfw --add \"\$(readlink -f \$(command -v node))\" --unblockapp \"\$(readlink -f \$(command -v node))\"${NC}"
      else
        echo -e "       ${RED}node is NOT in the firewall allow-list — incoming LAN connections are blocked.${NC}"
        echo -e "       Allow it (one time):"
        echo -e "         ${CYAN}sudo /usr/libexec/ApplicationFirewall/socketfilterfw --add \"$NODE_BIN\" --unblockapp \"$NODE_BIN\"${NC}"
      fi
      echo "$FW_STEALTH" | grep -qi "on" && \
        echo -e "       ${YELLOW}Stealth mode is ON${NC} (drops probes/ping). TCP to an allowed app still works."
    else
      echo -e "  ${GREEN}[ok]${NC} macOS firewall is OFF — not blocking anything."
    fi
  fi

  echo ""
  echo -e "  ${BOLD}If localhost works but your PHONE can't load the Network URL,${NC}"
  echo -e "  ${BOLD}the server is fine — the block is your network. Check, in order:${NC}"
  echo -e "   1. Phone and Mac on the ${BOLD}same Wi-Fi${NC} (not cellular, not a separate"
  echo -e "      \"Guest\" SSID). Guest networks isolate devices by design."
  echo -e "   2. Router \"${BOLD}AP isolation${NC}\" / \"client isolation\" / \"AP+\" must be OFF."
  echo -e "      (Common on mesh systems and ISP routers. Toggle it in router settings.)"
  echo -e "   3. Type the IP ${BOLD}exactly${NC}: ${CYAN}http://$LAN_IP:<port>${NC} — never ${RED}0.0.0.0${NC}"
  echo -e "      (0.0.0.0 means \"all interfaces\" to the server; it is NOT an address a"
  echo -e "       phone can open.)"
  echo -e "   4. Quick proof from the phone's browser: open ${CYAN}http://$LAN_IP:<port>${NC}"
  echo -e "      while the server runs. Still nothing? It's 1 or 2 above."
  echo ""
  echo -e "${GREEN}==============================================================${NC}"
  echo ""
  exit 0
fi

# ── Banner ───────────────────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}==============================================================${NC}"
echo -e "${GREEN}       HEAVEN-GeoIntel - Unified OSINT Platform  v1.3${NC}"
echo -e "${GREEN}==============================================================${NC}"
echo ""

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

LAN_IP="$(detect_lan_ip)"

# ════════════════════════════════════════════════════════════════════════════
#  DEV mode (hot reload, local only)
# ════════════════════════════════════════════════════════════════════════════
if [ "$MODE" = "dev" ]; then
  echo ""
  echo -e "${YELLOW}[dev] Hot-reload mode — LOCAL ONLY (not reachable from other devices).${NC}"
  echo -e "${CYAN}  Local:    http://localhost:$PORT${NC}"
  echo -e "${YELLOW}  For phone/LAN access use production mode: bash scripts/start.sh${NC}"
  echo ""
  # Auto-open the browser once the server answers. exec (below) replaces this
  # shell, so poll from a detached subshell that outlives it.
  if [ -t 1 ] && [ -z "$NO_OPEN" ] && [ "$BROWSER" != "none" ]; then
    ( for _ in $(seq 1 60); do
        curl -s -o /dev/null --max-time 2 "http://localhost:$PORT/" 2>/dev/null \
          && { open_browser "http://localhost:$PORT"; break; }
        sleep 0.5
      done ) &
  fi
  # Bind to loopback only: the dev server's cross-origin block makes LAN access
  # fail anyway, and binding here keeps the banner clean (it never prints the
  # confusing 0.0.0.0 "Network" line).
  exec node node_modules/next/dist/bin/next dev -H 127.0.0.1 -p "$PORT"
fi

# ════════════════════════════════════════════════════════════════════════════
#  PRODUCTION mode (default) — builds once, then serves on all interfaces
# ════════════════════════════════════════════════════════════════════════════
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

URL_LOCAL="http://localhost:$PORT"
URL_NET="http://$LAN_IP:$PORT"

# Start the server in the background so we can self-test it, then hand control
# back to it. trap forwards Ctrl-C so the server stops cleanly.
echo ""
echo -e "${YELLOW}[~] Starting server...${NC}"
# Bind to all interfaces (0.0.0.0) so BOTH localhost AND the LAN IP work. Next's
# own banner prints "Network: http://0.0.0.0:<port>" — which is not an address a
# phone can open and just causes confusion — so we pipe the server's output
# through awk and rewrite every literal "0.0.0.0" to the real LAN IP. fflush()
# keeps the log live and is portable (BSD sed has no -u). Process substitution
# means $! is still the node PID, so kill/wait below work unchanged.
REWRITE_IP="${LAN_IP:-localhost}"
node node_modules/next/dist/bin/next start -H 0.0.0.0 -p "$PORT" \
  > >(awk -v ip="$REWRITE_IP" '{ gsub(/0\.0\.0\.0/, ip); print; fflush() }') 2>&1 &
SRV_PID=$!
trap 'echo ""; echo "Stopping..."; kill "$SRV_PID" 2>/dev/null; exit 0' INT TERM

# Wait until it actually answers on localhost (up to ~30s).
UP=0
for _ in $(seq 1 60); do
  if curl -s -o /dev/null --max-time 2 "$URL_LOCAL/" 2>/dev/null; then UP=1; break; fi
  kill -0 "$SRV_PID" 2>/dev/null || break   # server died
  sleep 0.5
done

if [ "$UP" != "1" ]; then
  echo -e "${RED}[x] Server did not come up. See output above.${NC}"
  kill "$SRV_PID" 2>/dev/null || true
  exit 1
fi

# ── Self-test: Local + Network reachability ──────────────────────────────────
LOCAL_CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 4 "$URL_LOCAL/" 2>/dev/null || echo 000)"
NET_CODE="000"
[ -n "$LAN_IP" ] && NET_CODE="$(curl -s -o /dev/null -w '%{http_code}' --max-time 4 "$URL_NET/" 2>/dev/null || echo 000)"

echo ""
echo -e "${GREEN}==============================================================${NC}"
echo -e "${GREEN}  ${BOLD}HEAVEN-GeoIntel is running.${NC}"
echo -e "${GREEN}==============================================================${NC}"
if [ "$LOCAL_CODE" = "200" ]; then
  echo -e "  ${GREEN}[ok]${NC} On this Mac:  ${CYAN}${BOLD}$URL_LOCAL${NC}"
else
  echo -e "  ${RED}[x]${NC} On this Mac:  $URL_LOCAL  (HTTP $LOCAL_CODE)"
fi
if [ -z "$LAN_IP" ]; then
  echo -e "  ${YELLOW}[!]${NC} No LAN IP detected — connect to Wi-Fi/Ethernet for phone access."
elif [ "$NET_CODE" = "200" ]; then
  echo -e "  ${GREEN}[ok]${NC} From phone:   ${CYAN}${BOLD}$URL_NET${NC}   ${BOLD}<-- open THIS on your phone${NC}"
  echo -e "       (server verified reachable on the LAN IP)"
else
  echo -e "  ${RED}[x]${NC} From phone:   $URL_NET  (HTTP $NET_CODE)"
fi

# Pop the app open on this Mac (interactive launches only; see open_browser).
[ "$LOCAL_CODE" = "200" ] && open_browser "$URL_LOCAL"

# Optional QR of the Network URL (only if qrencode is installed — no hard dep).
if [ -n "$LAN_IP" ] && command -v qrencode >/dev/null 2>&1; then
  echo ""
  echo -e "  Scan with your phone camera:"
  qrencode -t ANSIUTF8 -m 2 "$URL_NET" 2>/dev/null | sed 's/^/  /'
fi

echo ""
echo -e "  ${BOLD}Phone still can't load it?${NC} The Mac is serving fine (verified above)."
echo -e "  The block is your network. Run:  ${CYAN}bash scripts/start.sh --doctor${NC}"
echo -e "  Most common causes: phone on a different Wi-Fi/Guest network, or the"
echo -e "  router's \"AP isolation\" is ON. (Open the ${CYAN}$URL_NET${NC} URL above.)"
echo ""
echo -e "  ${YELLOW}Hot-reload dev mode (local only): bash scripts/start.sh --dev${NC}"
echo -e "  Press Ctrl-C to stop."
echo ""

# Hand the terminal to the server (its logs stream here until Ctrl-C).
wait "$SRV_PID"
