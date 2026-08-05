# Codexyy

Codexyy is a repository-hosted coding platform with a browser playground,
local AI agent, `cxy` CLI, hosted model catalog, and production authentication,
billing, email, backup, monitoring, and release infrastructure.

## Install

```sh
curl -fsSL https://codexyy.dev/cli/ai | sh
```

That installs the checksum-verified `cxy` CLI and local agent. Start isolated
repository work with:

```sh
cxy login
cxy task start <repo> "describe the task" --output json
```

## Source layout

- `frontend/` — React/Vite website and repository playground
- `backend/` — FastAPI application, Git integration, billing, jobs, and ops
- `tea/` — the reduced, Codexyy-specific `cxy` CLI
- `agent/` — legacy/local agent bridge and browser server
- `deploy/` — hardened systemd and Nginx definitions
- `scripts/` — production validation, signing, and staging helpers

## Checks

```sh
./scripts/production-check.sh
```

The frontend has a zero-warning JSX accessibility gate. Release binaries and
offline bundles use SHA-256 manifests signed with the public key in
`deploy/cxy-release.pub`.

Production credentials are never stored in the repository. Services receive
host-encrypted systemd credentials through private runtime mounts.
