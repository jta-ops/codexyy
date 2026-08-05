#!/bin/sh
# Combined codexyy installer: cxy CLI + local AI agent.
#
#   curl -fsSL https://codexyy.dev/cli/ai | sh

set -eu

BASE="${CXY_BASE_URL:-https://codexyy.dev}"
tmp="$(mktemp)"
trap 'rm -f "$tmp"' EXIT INT TERM

printf '\n  codexyy cli + ai\n\n'

if command -v curl >/dev/null 2>&1; then
    curl -fsSL "${BASE}/cli" -o "$tmp"
elif command -v wget >/dev/null 2>&1; then
    wget -qO "$tmp" "${BASE}/cli"
else
    printf '  error: neither curl nor wget is available\n' >&2
    exit 1
fi

/bin/sh "$tmp"

if [ -n "${CXY_INSTALL_DIR:-}" ]; then
    cxy_bin="${CXY_INSTALL_DIR}/cxy"
elif command -v cxy >/dev/null 2>&1; then
    cxy_bin="$(command -v cxy)"
elif [ -x /usr/local/bin/cxy ]; then
    cxy_bin=/usr/local/bin/cxy
else
    cxy_bin="${HOME}/.local/bin/cxy"
fi

if [ ! -x "$cxy_bin" ]; then
    printf '  error: cxy was installed but could not be found at %s\n' "$cxy_bin" >&2
    exit 1
fi

printf '\n  installing the local AI agent...\n\n'
"$cxy_bin" install ai

printf '  ready — run codexyy for the terminal or codexyy web for the browser\n\n'
