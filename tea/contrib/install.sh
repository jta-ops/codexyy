#!/bin/sh
# cxy installer — the codexyy command line client.
#
#   curl -fsSL https://codexyy.dev/cli | sh
#
# Installs a single static binary. No runtime, no dependencies, no sudo unless
# the install directory needs it. Override the location with CXY_INSTALL_DIR.

set -eu

BASE="${CXY_BASE_URL:-https://codexyy.dev}"
VERSION="1.1.0"
MINISIGN_PUBLIC_KEY="RWQVnPa82pH5g7Woo9e6IHXAs4HUbefJ1ygTf1fi9eH1qwPizeiv5PTi"

# ── pretty output, but only when attached to a terminal ──────────────────────
if [ -t 1 ]; then
    B="$(printf '\033[1m')"; C="$(printf '\033[36m')"
    G="$(printf '\033[32m')"; R="$(printf '\033[31m')"
    D="$(printf '\033[90m')"; N="$(printf '\033[0m')"
else
    B=''; C=''; G=''; R=''; D=''; N=''
fi

say()  { printf '  %s\n' "$*"; }
ok()   { printf '  %s✓%s %s\n' "$G" "$N" "$*"; }
die()  { printf '  %s✗%s %s\n' "$R" "$N" "$*" >&2; exit 1; }

printf '\n  %scodexyy%s %scli%s %s· v%s%s\n\n' "$B" "$N" "$C" "$N" "$D" "$VERSION" "$N"

# ── detect platform ──────────────────────────────────────────────────────────
os="$(uname -s)"
arch="$(uname -m)"

case "$os" in
    Linux)  os=linux  ;;
    Darwin) os=darwin ;;
    *) die "unsupported operating system: $os (Linux and macOS are supported)" ;;
esac

case "$arch" in
    x86_64|amd64)  arch=amd64 ;;
    aarch64|arm64) arch=arm64 ;;
    *) die "unsupported architecture: $arch (amd64 and arm64 are supported)" ;;
esac

say "platform   ${D}${os}-${arch}${N}"

# ── pick an install directory we can actually write to ───────────────────────
if [ -n "${CXY_INSTALL_DIR:-}" ]; then
    dir="$CXY_INSTALL_DIR"
elif [ -w /usr/local/bin ] 2>/dev/null; then
    dir=/usr/local/bin
elif [ -d "$HOME/.local/bin" ]; then
    dir="$HOME/.local/bin"
else
    dir="$HOME/.local/bin"
    mkdir -p "$dir"
fi

say "install to ${D}${dir}/cxy${N}"

# ── download ─────────────────────────────────────────────────────────────────
url="${BASE}/cli-dl/cxy-${os}-${arch}"
tmp="$(mktemp)"
checksum_tmp="$(mktemp)"
manifest_tmp="$(mktemp)"
signature_tmp="$(mktemp)"
trap 'rm -f "$tmp" "$checksum_tmp" "$manifest_tmp" "$signature_tmp"' EXIT INT TERM

say "downloading…"
if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$url" -o "$tmp" || die "download failed: $url"
    curl -fsSL "${url}.sha256" -o "$checksum_tmp" || die "checksum download failed: ${url}.sha256"
elif command -v wget >/dev/null 2>&1; then
    wget -qO "$tmp" "$url" || die "download failed: $url"
    wget -qO "$checksum_tmp" "${url}.sha256" || die "checksum download failed: ${url}.sha256"
else
    die "neither curl nor wget is available"
fi

# A truncated or HTML error page would otherwise install silently.
size=$(wc -c < "$tmp")
[ "$size" -gt 1000000 ] || die "downloaded file is only ${size} bytes — the release may be unavailable"

expected=$(awk 'NR==1 {print $1}' "$checksum_tmp")
case "$expected" in
    *[!0-9a-fA-F]*|'') die "release checksum is invalid" ;;
esac
[ "${#expected}" -eq 64 ] || die "release checksum is invalid"
if command -v sha256sum >/dev/null 2>&1; then
    actual=$(sha256sum "$tmp" | awk '{print $1}')
elif command -v shasum >/dev/null 2>&1; then
    actual=$(shasum -a 256 "$tmp" | awk '{print $1}')
else
    die "sha256sum or shasum is required to verify the release"
fi
[ "$actual" = "$expected" ] || die "release checksum mismatch — nothing was installed"
ok "verified SHA-256"

# A Minisign signature authenticates the global manifest when Minisign is
# already available. SHA-256 remains mandatory on minimal installations.
if command -v minisign >/dev/null 2>&1; then
    if command -v curl >/dev/null 2>&1; then
        curl -fsSL "${BASE}/cli-dl/SHA256SUMS" -o "$manifest_tmp" || die "signed manifest download failed"
        curl -fsSL "${BASE}/cli-dl/SHA256SUMS.minisig" -o "$signature_tmp" || die "manifest signature download failed"
    else
        wget -qO "$manifest_tmp" "${BASE}/cli-dl/SHA256SUMS" || die "signed manifest download failed"
        wget -qO "$signature_tmp" "${BASE}/cli-dl/SHA256SUMS.minisig" || die "manifest signature download failed"
    fi
    minisign -V -q -P "$MINISIGN_PUBLIC_KEY" -m "$manifest_tmp" -x "$signature_tmp" \
        || die "release manifest signature is invalid"
    manifest_expected=$(awk -v file="cxy-${os}-${arch}" '$2 == file {print $1}' "$manifest_tmp")
    [ "$manifest_expected" = "$expected" ] || die "binary checksum is absent from the signed manifest"
    ok "verified Minisign release signature"
else
    say "${D}Minisign signature is published; install minisign for authenticity verification.${N}"
fi

chmod +x "$tmp"

# ── install, escalating only if we must ──────────────────────────────────────
if mkdir -p "$dir" 2>/dev/null && mv "$tmp" "$dir/cxy" 2>/dev/null; then
    :
elif command -v sudo >/dev/null 2>&1; then
    say "${D}elevating with sudo to write ${dir}${N}"
    sudo mkdir -p "$dir" && sudo mv "$tmp" "$dir/cxy" && sudo chmod +x "$dir/cxy" \
        || die "could not install to $dir"
else
    die "cannot write to $dir — set CXY_INSTALL_DIR to somewhere you own"
fi
rm -f "$checksum_tmp" "$manifest_tmp" "$signature_tmp"
trap - EXIT INT TERM

ok "installed $("$dir/cxy" --version 2>/dev/null | head -1 | sed 's/\x1b\[[0-9;]*m//g' || echo cxy)"

# Install completions without editing shell profiles. Fish discovers its
# standard user directory automatically; Bash/Zsh users can add the normal
# XDG completion directories if their distribution does not already do so.
data_home="${XDG_DATA_HOME:-$HOME/.local/share}"
mkdir -p "$data_home/bash-completion/completions" "$data_home/zsh/site-functions" "$data_home/fish/vendor_completions.d"
"$dir/cxy" completion bash > "$data_home/bash-completion/completions/cxy" 2>/dev/null || true
"$dir/cxy" completion zsh > "$data_home/zsh/site-functions/_cxy" 2>/dev/null || true
"$dir/cxy" completion fish > "$data_home/fish/vendor_completions.d/cxy.fish" 2>/dev/null || true
ok "installed Bash, Zsh, and Fish completions"

# ── PATH advice ──────────────────────────────────────────────────────────────
case ":${PATH}:" in
    *":${dir}:"*) ;;
    *)
        if [ -n "${CXY_INSTALL_DIR:-}" ]; then
            printf '\n  %s%s is not on your PATH.%s Add this to your shell profile:\n\n' "$B" "$dir" "$N"
            printf '    export PATH="%s:$PATH"\n' "$dir"
        else
            shell_name=$(basename "${SHELL:-sh}")
            marker="# codexyy PATH (managed by the cxy installer)"
            case "$shell_name" in
                zsh)  profile="$HOME/.zprofile"; path_line="export PATH=\"$dir:\$PATH\"" ;;
                fish) profile="$HOME/.config/fish/config.fish"; path_line="fish_add_path --path \"$dir\"" ;;
                bash)
                    if [ -f "$HOME/.bash_profile" ]; then profile="$HOME/.bash_profile"; else profile="$HOME/.profile"; fi
                    path_line="export PATH=\"$dir:\$PATH\"" ;;
                *)    profile="$HOME/.profile"; path_line="export PATH=\"$dir:\$PATH\"" ;;
            esac
            if mkdir -p "$(dirname "$profile")" 2>/dev/null && touch "$profile" 2>/dev/null; then
                if ! grep -Fq "$marker" "$profile" 2>/dev/null; then
                    printf '\n%s\n%s\n' "$marker" "$path_line" >> "$profile"
                fi
                ok "persisted PATH in $profile (available in your next shell)"
            else
                printf '\n  %s%s is not on your PATH.%s Add this to your shell profile:\n\n' "$B" "$dir" "$N"
                printf '    export PATH="%s:$PATH"\n' "$dir"
            fi
        fi
        ;;
esac

printf '\n  Get started:\n\n'
printf '    %scxy login%s              sign in with your codexyy account\n' "$C" "$N"
printf '    %scxy repos ls%s           list your repositories\n' "$C" "$N"
printf '    %scxy task start <repo> <task>%s  isolated branch + workspace\n' "$C" "$N"
printf '    %scxy --help%s             everything else\n\n' "$C" "$N"
