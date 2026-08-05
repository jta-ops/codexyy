#!/bin/sh
set -e

# Colors
G='\033[1;32m'   # green
C='\033[1;36m'   # cyan
Y='\033[1;33m'   # yellow
R='\033[1;31m'   # red
D='\033[2m'      # dim
B='\033[1m'      # bold
X='\033[0m'      # reset

clear_line='\r\033[K'

echo ""
echo "  ${C}▸ codexyy${X} installer"
echo "  ${D}────────────────────────────${X}"
echo ""

# Check Python 3
printf "  ${D}checking python...${X}"
if ! command -v python3 > /dev/null 2>&1; then
  echo "${clear_line}  ${R}✗${X} python3 not found"
  echo ""
  echo "  Install Python 3.8+ from ${B}https://python.org${X} then re-run."
  echo ""
  exit 1
fi

PY_VER=$(python3 -c 'import sys; print(sys.version_info.major * 10 + sys.version_info.minor)')
PY_LABEL=$(python3 --version 2>&1 | cut -d' ' -f2)

if [ "$PY_VER" -lt 38 ]; then
  echo "${clear_line}  ${R}✗${X} python $PY_LABEL is too old (need 3.8+)"
  echo ""
  exit 1
fi

echo "${clear_line}  ${G}✓${X} python $PY_LABEL"

# Install websockets
printf "  ${D}installing dependencies...${X}"
python3 -m pip install websockets --quiet --break-system-packages 2>/dev/null || \
  python3 -m pip install websockets --quiet 2>/dev/null || true
echo "${clear_line}  ${G}✓${X} websockets"

# Install CLI
INSTALL_DIR="$HOME/.local/bin"
mkdir -p "$INSTALL_DIR"

printf "  ${D}downloading codexyy...${X}"
curl -fsSL https://codexyy.dev/codexyy.py -o "$INSTALL_DIR/codexyy"
chmod +x "$INSTALL_DIR/codexyy"
echo "${clear_line}  ${G}✓${X} codexyy installed"

# PATH
SHELL_RC=""
case "$SHELL" in
  */zsh)  SHELL_RC="$HOME/.zshrc" ;;
  */bash) SHELL_RC="$HOME/.bashrc" ;;
  *)      SHELL_RC="$HOME/.profile" ;;
esac

if ! echo ":$PATH:" | grep -q ":$INSTALL_DIR:"; then
  printf '\nexport PATH="%s:$PATH"\n' "$INSTALL_DIR" >> "$SHELL_RC"
  echo "  ${G}✓${X} added to PATH ${D}($SHELL_RC)${X}"
  export PATH="$INSTALL_DIR:$PATH"
fi

echo ""
echo "  ${D}────────────────────────────${X}"
echo "  ${G}${B}ready.${X} run this in any project:"
echo ""
echo "    ${C}codexyy${X}              ${D}# full coding mode${X}"
echo "    ${C}codexyy --chat${X}       ${D}# chatbot only${X}"
echo ""
