#!/bin/sh
# Install cxy and the Codexyy agent from an extracted offline bundle.
set -eu

bundle_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
manifest="$bundle_dir/SHA256SUMS"
[ -f "$manifest" ] || { echo "missing offline SHA256SUMS" >&2; exit 1; }

verify_file() {
    name="$1"
    expected=$(awk -v file="$name" '$2 == file {print $1}' "$manifest")
    [ "${#expected}" -eq 64 ] || { echo "invalid checksum for $name" >&2; exit 1; }
    if command -v sha256sum >/dev/null 2>&1; then
        actual=$(sha256sum "$bundle_dir/$name" | awk '{print $1}')
    elif command -v shasum >/dev/null 2>&1; then
        actual=$(shasum -a 256 "$bundle_dir/$name" | awk '{print $1}')
    else
        echo "sha256sum or shasum is required" >&2; exit 1
    fi
    [ "$actual" = "$expected" ] || { echo "checksum mismatch for $name" >&2; exit 1; }
}

verify_file cxy
verify_file engine.tar.gz
engine_hash=$(awk '$2 == "engine.tar.gz" {print $1}' "$manifest")

if [ -n "${CXY_INSTALL_DIR:-}" ]; then
    install_dir="$CXY_INSTALL_DIR"
elif [ -w /usr/local/bin ] 2>/dev/null; then
    install_dir=/usr/local/bin
else
    install_dir="$HOME/.local/bin"
fi
mkdir -p "$install_dir"
if cp "$bundle_dir/cxy" "$install_dir/cxy" 2>/dev/null; then
    chmod 755 "$install_dir/cxy"
elif command -v sudo >/dev/null 2>&1; then
    sudo install -m 755 "$bundle_dir/cxy" "$install_dir/cxy"
else
    echo "cannot install to $install_dir; set CXY_INSTALL_DIR" >&2; exit 1
fi

"$install_dir/cxy" install ai \
    --engine-archive "$bundle_dir/engine.tar.gz" \
    --engine-sha256 "$engine_hash" \
    --no-login --force

data_home="${XDG_DATA_HOME:-$HOME/.local/share}"
mkdir -p "$data_home/bash-completion/completions" "$data_home/zsh/site-functions" "$data_home/fish/vendor_completions.d"
"$install_dir/cxy" completion bash > "$data_home/bash-completion/completions/cxy" 2>/dev/null || true
"$install_dir/cxy" completion zsh > "$data_home/zsh/site-functions/_cxy" 2>/dev/null || true
"$install_dir/cxy" completion fish > "$data_home/fish/vendor_completions.d/cxy.fish" 2>/dev/null || true

printf '\n  Offline install complete. Connect to the internet once, then run cxy login.\n\n'
