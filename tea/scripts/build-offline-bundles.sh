#!/bin/sh
set -eu

version="${1:-1.1.0}"
release_root="${2:-/var/www/codexyy}"
engine_version="${3:-1.0.0}"
cli_root="$release_root/cli-dl"
agent_root="$release_root/agent-dl"
offline_root="$release_root/offline-dl"
installer="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)/contrib/install-offline.sh"
mkdir -p "$offline_root"

for platform in linux-amd64 linux-arm64 darwin-amd64 darwin-arm64; do
    case "$platform" in
        *-amd64) engine_platform="${platform%-amd64}-x64" ;;
        *-arm64) engine_platform="$platform" ;;
    esac
    cli="$cli_root/cxy-$platform"
    engine="$agent_root/engine-$engine_version-$engine_platform.tar.gz"
    [ -f "$cli" ] || { echo "missing $cli" >&2; exit 1; }
    [ -f "$engine" ] || { echo "missing $engine" >&2; exit 1; }
    stage=$(mktemp -d)
    cp "$cli" "$stage/cxy"
    cp "$engine" "$stage/engine.tar.gz"
    cp "$installer" "$stage/install.sh"
    chmod 755 "$stage/cxy" "$stage/install.sh"
    (cd "$stage" && sha256sum cxy engine.tar.gz > SHA256SUMS)
    tar -C "$stage" -czf "$offline_root/codexyy-offline-$version-$platform.tar.gz" .
    rm -rf "$stage"
done
(cd "$offline_root" && sha256sum codexyy-offline-"$version"-*.tar.gz > SHA256SUMS)
printf '%s\n' "$version" > "$offline_root/latest"
