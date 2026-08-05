#!/bin/sh
set -eu

root=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
go_bin="${GO_BIN:-$(command -v go 2>/dev/null || true)}"
[ -n "$go_bin" ] || go_bin=/usr/local/go/bin/go
[ -x "$go_bin" ] || { echo "Go toolchain not found" >&2; exit 1; }

python3 -m py_compile \
  "$root/backend/main.py" \
  "$root/backend/backup_codexyy.py" \
  "$root/backend/reconcile_subscriptions.py" \
  "$root/backend/monitor_codexyy.py"

(cd "$root/backend" && python3 -m unittest -v test_credential_env.py test_stripe_provider.py)

(cd "$root/backend" && python3 test_stripe_lifecycle.py)
(cd "$root/backend" && python3 test_operation_queue.py)

(cd "$root/frontend" && npm run check)
(cd "$root/tea" && "$go_bin" test ./...)
(cd /home/ubuntu/codexyy-auth && npm test && npm run check)

sh -n "$root/tea/contrib/install.sh"
sh -n "$root/tea/contrib/install-ai.sh"
sh -n "$root/tea/contrib/install-offline.sh"
sh -n "$root/tea/scripts/build-offline-bundles.sh"
sh -n "$root/scripts/sign-release.sh"
sh -n "$root/scripts/enable-staging.sh"

if command -v minisign >/dev/null 2>&1 && [ -f /var/www/codexyy/cli-dl/SHA256SUMS.minisig ]; then
  minisign -V -q -p "$root/deploy/cxy-release.pub" -m /var/www/codexyy/cli-dl/SHA256SUMS -x /var/www/codexyy/cli-dl/SHA256SUMS.minisig
fi

if command -v nginx >/dev/null 2>&1; then
  if [ "$(id -u)" -eq 0 ]; then nginx -t; else sudo -n nginx -t; fi
fi

for source in "$root"/agent/src/*.js "$root"/agent/bin/*.js; do
  node --check "$source"
done

python3 - <<'PY'
import sqlite3
for path in ('/home/ubuntu/codexyy/data.db','/home/ubuntu/gitea/data/gitea.db'):
    with sqlite3.connect(f'file:{path}?mode=ro', uri=True) as db:
        result=db.execute('PRAGMA quick_check').fetchone()
    if not result or result[0] != 'ok':
        raise SystemExit(f'integrity check failed: {path}')
print('DATABASE_QUICK_CHECK ok')
PY

curl -fsS https://codexyy.dev/healthz >/dev/null
curl -fsS https://codexyy.dev/api/status >/dev/null
printf '%s\n' 'PRODUCTION_CHECK ok'
