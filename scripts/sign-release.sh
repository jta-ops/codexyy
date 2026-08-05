#!/bin/sh
set -eu

manifest=${1:-/var/www/codexyy/cli-dl/SHA256SUMS}
signature=${2:-${manifest}.minisig}
public_key=${3:-/var/www/codexyy/cli-dl/cxy-release.pub}
credential_dir=${CREDENTIALS_DIRECTORY:-}

[ -n "$credential_dir" ] || { echo "systemd credential directory is required" >&2; exit 2; }
secret_key="$credential_dir/release-signing.key"
[ -r "$secret_key" ] || { echo "release signing credential is unavailable" >&2; exit 2; }
[ -r "$manifest" ] || { echo "release manifest is unavailable" >&2; exit 2; }
[ -r "$public_key" ] || { echo "release public key is unavailable" >&2; exit 2; }

temporary="${signature}.new"
trap 'rm -f "$temporary"' EXIT INT TERM
minisign -S -W -s "$secret_key" -m "$manifest" -x "$temporary" \
  -c "Codexyy release manifest" -t "codexyy.dev verified release"
minisign -V -q -p "$public_key" -m "$manifest" -x "$temporary"
chmod 644 "$temporary"
mv "$temporary" "$signature"
trap - EXIT INT TERM
printf '%s\n' "signed and verified $manifest"
