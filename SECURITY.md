# Security

Do not open a public issue for a vulnerability or include credentials in a
repository, log, screenshot, or support message. Report security problems to
`security@codexyy.dev` with the affected route/version and a minimal proof.

Codexyy release manifests are signed with Minisign. The pinned public key is
published in `deploy/cxy-release.pub` and at
`https://codexyy.dev/cli-dl/cxy-release.pub`.

Production secrets are loaded from host-encrypted systemd credentials. Local
`.env`, `.dev.vars`, private keys, databases, backups, and runtime logs are
excluded from source control.
