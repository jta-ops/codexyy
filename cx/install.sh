#!/bin/sh
set -e

BOLD='\033[1m'
GREEN='\033[0;32m'
DIM='\033[2m'
RESET='\033[0m'

echo ""
echo "  ${GREEN}${BOLD}cx${RESET}  ${DIM}install${RESET}"
echo ""

CX_DIR="$HOME/.cx"
CX_FILE="$CX_DIR/cx.py"
BIN_DIR="$HOME/.local/bin"

mkdir -p "$CX_DIR"
mkdir -p "$BIN_DIR"

echo "  Downloading cx..."
curl -sL https://codexyy.dev/cx/cx.py -o "$CX_FILE"
chmod +x "$CX_FILE"

echo "  Installing cx command..."
cat > "$BIN_DIR/cx" << 'WRAPPER'
#!/bin/sh
exec python3 "$HOME/.cx/cx.py" "$@"
WRAPPER
chmod +x "$BIN_DIR/cx"

# Install websocket dependency for cx gpt
pip3 install websocket-client -q 2>/dev/null || pip install websocket-client -q 2>/dev/null || true

echo ""
echo "  ${GREEN}${BOLD}cx installed!${RESET}"
echo ""
echo "  ${DIM}Commands:${RESET}"
echo "    ${BOLD}cx run file.cx${RESET}    Run a .cx file"
echo "    ${BOLD}cx repl${RESET}           Interactive REPL"
echo "    ${BOLD}cx gpt${RESET}            Start a GPT relay session"
echo ""
echo "  ${DIM}Make sure $BIN_DIR is in your PATH.${RESET}"
echo ""