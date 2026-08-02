#!/bin/bash
# HEAVEN-GeoIntel — remove the global 'geointel' command, completely.
# Reverses install-global.sh in every install variant:
#   - /usr/local/bin/geointel binary  (writable OR root-owned via sudo)
#   - the marker + function block in any shell RC file
#   - legacy entries from older installers (different wording / paths)
# Idempotent: safe to run repeatedly.
#
# Flags:
#   --purge-data   ALSO delete .data/ — the case store, audit log, saved API
#                  keys and dataset overlays. Opt-in only, and it asks first.
#   --yes          answer yes to that prompt (for non-interactive use)
#   --help         print usage and exit
set -u

COMMAND_NAME="geointel"
INSTALL_PATH="/usr/local/bin/$COMMAND_NAME"
MARKER="# HEAVEN-GeoIntel global command"
REMOVED=0
PURGE=0
ASSUME_YES=0

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
DATA_DIR="${HV_DATA_DIR:-$PROJECT_DIR/.data}"

usage() {
  cat <<'USAGE'
HEAVEN-GeoIntel — Global Command Uninstaller

  bash scripts/uninstall-global.sh [--purge-data] [--yes]

  (none)          Remove the `geointel` command only. Your cases, audit log and
                  saved API keys are left exactly where they are.
  --purge-data    Also delete the data directory (.data/ by default, or
                  $HV_DATA_DIR): investigation cases, the audit log, API keys
                  saved through the UI, and any dataset overlays. Irreversible.
                  You are asked to confirm unless --yes is given.
  --yes           Don't prompt (use in scripts).
  --help          This message.

Not touched by either mode: .env.local (your API keys on disk), node_modules,
the build output, and the repository itself — delete the project folder when
you want those gone.
USAGE
}

while [ $# -gt 0 ]; do
  case "$1" in
    --purge-data) PURGE=1 ;;
    --yes|-y)     ASSUME_YES=1 ;;
    --help|-h)    usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; echo "" >&2; usage >&2; exit 2 ;;
  esac
  shift
done

echo ""
# Same generated banner as the installer and the launcher (npm run brand →
# scripts/banner.sh), so the last thing you see on the way out is the mark you
# saw on the way in. Optional: uninstalling must work on a clone that never ran
# a build step.
if [ -f "$SCRIPT_DIR/banner.sh" ]; then
  # shellcheck source=/dev/null
  . "$SCRIPT_DIR/banner.sh"
  hv_banner
  echo ""
fi
echo "  HEAVEN-GeoIntel — Global Command Uninstaller"
echo "------------------------------------------------------------------"
echo ""

# ── 1) Remove the /usr/local/bin binary (handle root ownership) ──────────────
if [ -e "$INSTALL_PATH" ]; then
  if rm -f "$INSTALL_PATH" 2>/dev/null && [ ! -e "$INSTALL_PATH" ]; then
    echo "[ok] Removed $INSTALL_PATH"
    REMOVED=1
  elif command -v sudo >/dev/null 2>&1; then
    echo "[!] $INSTALL_PATH is root-owned — removing with sudo (may prompt)..."
    if sudo rm -f "$INSTALL_PATH" 2>/dev/null && [ ! -e "$INSTALL_PATH" ]; then
      echo "[ok] Removed $INSTALL_PATH (sudo)"
      REMOVED=1
    else
      echo "[x] Could not remove $INSTALL_PATH. Run manually: sudo rm -f $INSTALL_PATH"
    fi
  else
    echo "[x] Cannot remove $INSTALL_PATH (no permission, no sudo)."
  fi
fi

# ── 2) Strip the function block from every RC file ───────────────────────────
# Removes EVERY HEAVEN-GeoIntel marker comment, the geointel() function line
# right after a marker, and any standalone geointel() line — covering old,
# new, and duplicate installs. Explicit line-by-line loop (no awk rule-order
# traps). A one-time backup is written before editing.
for RC in "$HOME/.zshrc" "$HOME/.bashrc" "$HOME/.bash_profile" "$HOME/.profile"; do
  [ -f "$RC" ] || continue
  if grep -q "HEAVEN-GeoIntel" "$RC" 2>/dev/null || grep -Eq "^[[:space:]]*geointel\(\)" "$RC" 2>/dev/null; then
    cp "$RC" "$RC.geointel-bak" 2>/dev/null || true
    tmp="$(mktemp)"
    drop_next=0
    # Read raw lines incl. last line without trailing newline (|| [ -n "$line" ]).
    while IFS= read -r line || [ -n "$line" ]; do
      # If previous line was our marker, drop this (the function) line once.
      if [ "$drop_next" = "1" ]; then
        drop_next=0
        case "$line" in
          *geointel\(\)*) continue ;;   # expected function line → drop
        esac
        # not a function line after all → fall through and keep it
      fi
      case "$line" in
        *HEAVEN-GeoIntel*)                      # any of our comment lines → drop
          case "$line" in *"global command"*) drop_next=1 ;; esac
          continue ;;
        geointel\(\)*|*[[:space:]]geointel\(\)*) continue ;;  # standalone fn → drop
      esac
      printf '%s\n' "$line" >> "$tmp"
    done < "$RC"
    # Collapse 2+ consecutive blank lines into one, then write back.
    awk 'NF { blank = 0; print; next } { if (++blank <= 1) print }' "$tmp" > "$RC"
    rm -f "$tmp"
    echo "[ok] Cleaned 'geointel' entries from $RC  (backup: $RC.geointel-bak)"
    REMOVED=1
  fi
done

# ── 3) Optional: delete the runtime data directory ───────────────────────────
# Strictly opt-in. Removing the command a user typed is reversible; removing the
# cases they built an investigation out of is not, so this never happens as a
# side effect of uninstalling — it has to be asked for, and then confirmed.
if [ "$PURGE" -eq 1 ]; then
  echo ""
  if [ ! -d "$DATA_DIR" ]; then
    echo "[+] No data directory at $DATA_DIR — nothing to purge."
  else
    CASES="?"; [ -f "$DATA_DIR/cases.json" ] && CASES="$(grep -o '"id"' "$DATA_DIR/cases.json" 2>/dev/null | wc -l | tr -d ' ')"
    echo "[!] About to permanently delete: $DATA_DIR"
    echo "    Contents: $(ls -A "$DATA_DIR" 2>/dev/null | tr '\n' ' ')"
    echo "    That includes ${CASES} investigation case(s), the audit log, any API"
    echo "    keys saved through the UI, and any dataset overlays."
    ANSWER="n"
    if [ "$ASSUME_YES" -eq 1 ]; then
      ANSWER="y"
    elif [ -t 0 ]; then
      printf "    Type 'yes' to delete, anything else to keep it: "
      read -r REPLY_RAW
      # Strip a trailing CR (some terminals/ptys send one) and surrounding
      # space, then require the whole word — this deletes case files.
      REPLY_CLEAN="$(printf '%s' "$REPLY_RAW" | tr -d '\r' | tr '[:upper:]' '[:lower:]' | xargs 2>/dev/null || true)"
      [ "$REPLY_CLEAN" = "yes" ] && ANSWER="y"
    else
      # Non-interactive with no --yes: refuse rather than guess.
      echo "    Not a terminal and --yes not given — keeping the data."
    fi
    if [ "$ANSWER" = "y" ]; then
      if rm -rf "$DATA_DIR" 2>/dev/null && [ ! -d "$DATA_DIR" ]; then
        echo "[ok] Deleted $DATA_DIR"
        REMOVED=1
      else
        echo "[x] Could not delete $DATA_DIR. Remove it manually."
      fi
    else
      echo "[+] Data kept at $DATA_DIR"
    fi
  fi
fi

# ── 4) Verify nothing remains ────────────────────────────────────────────────
LEFT=0
[ -e "$INSTALL_PATH" ] && LEFT=1
for RC in "$HOME/.zshrc" "$HOME/.bashrc" "$HOME/.bash_profile" "$HOME/.profile"; do
  [ -f "$RC" ] || continue
  grep -q "HEAVEN-GeoIntel\|^[[:space:]]*geointel()" "$RC" 2>/dev/null && LEFT=1
done

echo ""
if [ "$LEFT" -eq 1 ]; then
  echo "[!] Some entries could not be removed automatically (see messages above)."
elif [ "$REMOVED" -eq 1 ]; then
  echo "[ok] Fully uninstalled. Open a new terminal (or re-source your RC) to apply."
else
  echo "[+] Nothing to remove — 'geointel' was not installed."
fi

# Say what is deliberately still on disk, so "uninstalled" isn't ambiguous.
echo ""
echo "  Still on disk (delete the project folder to remove them):"
[ "$PURGE" -eq 1 ] && [ ! -d "$DATA_DIR" ] || echo "    $DATA_DIR       cases · audit log · saved API keys  (--purge-data)"
[ -f "$PROJECT_DIR/.env.local" ] && echo "    $PROJECT_DIR/.env.local   your API keys"
echo "    $PROJECT_DIR             the repository, node_modules and build output"
echo "------------------------------------------------------------------"
echo ""
