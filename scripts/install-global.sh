#!/bin/bash
# HEAVEN-GeoIntel — register the global 'geointel' command.
# Preference order: shell-function in RC file (no sudo) → /usr/local/bin if writable.
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"   # repo root = parent of scripts/
COMMAND_NAME="geointel"
INSTALL_PATH="/usr/local/bin/$COMMAND_NAME"
MARKER="# HEAVEN-GeoIntel global command"

# Detect shell RC file
SHELL_RC=""
if [ -n "$ZSH_VERSION" ] || [ -f "$HOME/.zshrc" ]; then SHELL_RC="$HOME/.zshrc"
elif [ -f "$HOME/.bashrc" ]; then SHELL_RC="$HOME/.bashrc"
elif [ -f "$HOME/.bash_profile" ]; then SHELL_RC="$HOME/.bash_profile"
fi

echo ""
# The generated brand banner (npm run brand → scripts/banner.sh). Optional by
# design: installing the command must work on a clone that has never run a
# build step.
if [ -f "$SCRIPT_DIR/banner.sh" ]; then
  # shellcheck source=/dev/null
  . "$SCRIPT_DIR/banner.sh"
  hv_banner
  echo ""
fi
echo "  HEAVEN-GeoIntel: Global Command Installer"
echo "──────────────────────────────────────────────────────────────────"
echo "  Project: $PROJECT_DIR"
echo ""

# 1) /usr/local/bin if writable without sudo (cleanest — works in every shell)
if [ -w "/usr/local/bin" ]; then
  cat > "$INSTALL_PATH" <<SCRIPT
#!/bin/bash
cd "$PROJECT_DIR" && bash scripts/start.sh "\$@"
SCRIPT
  chmod +x "$INSTALL_PATH"
  echo "[✓] Installed: $INSTALL_PATH"
  echo "    Type 'geointel' anywhere to start the app."

# 2) Shell-function in RC file (no sudo, no terminal prompt)
elif [ -n "$SHELL_RC" ]; then
  if grep -q "$MARKER" "$SHELL_RC" 2>/dev/null; then
    echo "[+] 'geointel' already registered in $SHELL_RC"
  else
    cat >> "$SHELL_RC" <<FUNC

$MARKER
geointel() { cd "$PROJECT_DIR" && bash scripts/start.sh "\$@"; }
FUNC
    echo "[✓] Added 'geointel' function to $SHELL_RC"
    echo "    Run: source $SHELL_RC   (or open a new terminal)"
  fi

# 3) Manual fallback
else
  echo "[!] Could not auto-install. Add this to your shell config manually:"
  echo ""
  echo "    geointel() { cd \"$PROJECT_DIR\" && bash scripts/start.sh; }"
  echo ""
  echo "    Or, with sudo, for a system-wide command:"
  echo "    sudo tee $INSTALL_PATH >/dev/null <<'EOS'"
  echo "    #!/bin/bash"
  echo "    cd \"$PROJECT_DIR\" && bash scripts/start.sh \"\$@\""
  echo "    EOS"
  echo "    sudo chmod +x $INSTALL_PATH"
fi

echo ""
echo "──────────────────────────────────────────────────────────────────"
echo ""
