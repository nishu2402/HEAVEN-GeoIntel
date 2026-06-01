#!/bin/bash
# HEAVEN-GeoIntel — remove the global 'geointel' command, completely.
# Reverses install-global.sh in every install variant:
#   - /usr/local/bin/geointel binary  (writable OR root-owned via sudo)
#   - the marker + function block in any shell RC file
#   - legacy entries from older installers (different wording / paths)
# Idempotent: safe to run repeatedly.
set -u

COMMAND_NAME="geointel"
INSTALL_PATH="/usr/local/bin/$COMMAND_NAME"
MARKER="# HEAVEN-GeoIntel global command"
REMOVED=0

echo ""
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

# ── 3) Verify nothing remains ────────────────────────────────────────────────
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
echo "------------------------------------------------------------------"
echo ""
