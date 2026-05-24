#!/bin/bash
set -e

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMMAND_NAME="geointel"
INSTALL_PATH="/usr/local/bin/$COMMAND_NAME"
SHELL_RC=""

# Detect shell config file
if [ -f "$HOME/.zshrc" ]; then
  SHELL_RC="$HOME/.zshrc"
elif [ -f "$HOME/.bashrc" ]; then
  SHELL_RC="$HOME/.bashrc"
elif [ -f "$HOME/.bash_profile" ]; then
  SHELL_RC="$HOME/.bash_profile"
fi

echo ""
echo "  HEAVEN-GeoIntel — Global Command Installer"
echo "──────────────────────────────────────────────────────────────────"
echo ""
echo "  This will install the 'geointel' command globally."
echo "  Project path: $PROJECT_DIR"
echo ""

# Try /usr/local/bin first (no sudo needed if writable)
if [ -w "/usr/local/bin" ]; then
  cat > "$INSTALL_PATH" <<SCRIPT
#!/bin/bash
cd "$PROJECT_DIR" && bash scripts/start.sh "\$@"
SCRIPT
  chmod +x "$INSTALL_PATH"
  echo "[✓] Installed: $INSTALL_PATH"
  echo "    You can now type 'geointel' anywhere to start the app."
elif command -v sudo &>/dev/null; then
  echo "[!] /usr/local/bin requires sudo — prompting..."
  sudo bash -c "cat > '$INSTALL_PATH' <<'SCRIPT'
#!/bin/bash
cd \"$PROJECT_DIR\" && bash scripts/start.sh \"\$@\"
SCRIPT"
  sudo chmod +x "$INSTALL_PATH"
  echo "[✓] Installed: $INSTALL_PATH"
  echo "    You can now type 'geointel' anywhere to start the app."
else
  # Fallback: add shell function to RC file
  if [ -n "$SHELL_RC" ]; then
    MARKER="# HEAVEN-GeoIntel global command"
    if ! grep -q "$MARKER" "$SHELL_RC" 2>/dev/null; then
      cat >> "$SHELL_RC" <<FUNC

$MARKER
geointel() {
  cd "$PROJECT_DIR" && bash scripts/start.sh "\$@"
}
FUNC
      echo "[✓] Added 'geointel' function to $SHELL_RC"
      echo "    Run: source $SHELL_RC   (or open a new terminal)"
    else
      echo "[+] 'geointel' already registered in $SHELL_RC"
    fi
  else
    echo "[!] Could not auto-install. Add this to your shell config manually:"
    echo ""
    echo "    geointel() {"
    echo "      cd \"$PROJECT_DIR\" && bash scripts/start.sh"
    echo "    }"
  fi
fi

echo ""
echo "──────────────────────────────────────────────────────────────────"
echo ""
