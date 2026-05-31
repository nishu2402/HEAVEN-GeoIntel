#!/bin/bash
# HEAVEN-GeoIntel — remove the global 'geointel' command.
# Reverses install-global.sh: deletes /usr/local/bin/geointel and strips the
# shell-function block from the RC file. Idempotent.
set -e

COMMAND_NAME="geointel"
INSTALL_PATH="/usr/local/bin/$COMMAND_NAME"
MARKER="# HEAVEN-GeoIntel global command"
REMOVED=0

echo ""
echo "  HEAVEN-GeoIntel — Global Command Uninstaller"
echo "──────────────────────────────────────────────────────────────────"
echo ""

# 1) Remove /usr/local/bin binary
if [ -f "$INSTALL_PATH" ]; then
  if [ -w "$INSTALL_PATH" ] || [ -w "/usr/local/bin" ]; then
    rm -f "$INSTALL_PATH"
    echo "[✓] Removed $INSTALL_PATH"
    REMOVED=1
  elif command -v sudo &>/dev/null; then
    echo "[!] $INSTALL_PATH needs sudo to remove — run:"
    echo "    sudo rm -f $INSTALL_PATH"
  else
    echo "[!] Cannot remove $INSTALL_PATH (no write permission)."
  fi
fi

# 2) Strip the function block from every known RC file
for RC in "$HOME/.zshrc" "$HOME/.bashrc" "$HOME/.bash_profile"; do
  [ -f "$RC" ] || continue
  if grep -q "$MARKER" "$RC" 2>/dev/null; then
    # Delete the marker line + the geointel function line that follows it,
    # plus any blank line immediately before the marker. Portable sed (no -i quirks).
    tmp="$(mktemp)"
    awk -v marker="$MARKER" '
      $0 == marker { skip = 2; next }     # drop marker + next line (the function)
      skip > 0     { skip--; next }
      { print }
    ' "$RC" > "$tmp"
    # Collapse trailing blank lines left behind
    awk 'NF{blank=0; print; next} {blank++; if(blank<=1) print}' "$tmp" > "$RC"
    rm -f "$tmp"
    echo "[✓] Removed 'geointel' function from $RC"
    REMOVED=1
  fi
done

echo ""
if [ "$REMOVED" -eq 1 ]; then
  echo "[✓] Uninstalled. Open a new terminal (or re-source your RC) to apply."
else
  echo "[+] Nothing to remove — 'geointel' was not installed."
fi
echo "──────────────────────────────────────────────────────────────────"
echo ""
