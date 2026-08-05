#!/bin/sh
set -eu

config=/home/ubuntu/codexyy/deploy/codexyy-staging.nginx.conf
target=/etc/nginx/sites-enabled/codexyy-staging.conf
cert=/etc/letsencrypt/live/staging.codexyy.dev/fullchain.pem
key=/etc/letsencrypt/live/staging.codexyy.dev/privkey.pem

curl -fsS http://127.0.0.1:8876/healthz >/dev/null || { echo "local staging backend is unhealthy" >&2; exit 2; }
getent ahosts staging.codexyy.dev >/dev/null || { echo "DNS for staging.codexyy.dev is not configured" >&2; exit 2; }
[ -r "$cert" ] && [ -r "$key" ] || { echo "TLS certificate for staging.codexyy.dev is not configured" >&2; exit 2; }

if [ "${1:-}" != "--yes" ]; then
    printf '%s\n' "staging prerequisites passed; rerun with --yes to install the nginx site"
    exit 0
fi
sudo install -m 644 "$config" "$target"
sudo nginx -t
sudo systemctl reload nginx
curl -fsS https://staging.codexyy.dev/healthz >/dev/null
printf '%s\n' "public staging enabled and healthy"
