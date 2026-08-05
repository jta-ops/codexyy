# Codexyy: 50-improvement delivery tracker

Status legend: `DONE` is implemented on this server, `PARTIAL` has a working foundation but remaining production work, `TODO` has not been implemented, and `PROVIDER` requires an account/provider action that cannot be completed only from this machine.

## Security, release integrity, and operations

- [ ] 1. `PARTIAL` Rotate all infrastructure/API secrets and move them into protected systemd credentials or a secrets vault.
- [x] 2. `DONE` Publish SHA-256 checksums and verify downloaded binaries inside the installer.
- [x] 3. `DONE` Require password/token authentication whenever `codexyy web --expose all` is used.
- [ ] 4. `PARTIAL` Deterministically test signed checkout, duplicate webhook, renewal, cancellation, and invalid-signature flows locally; provider-owned Stripe test-mode automation remains.
- [x] 5. `DONE` Add a reconciliation job comparing Stripe subscriptions with local user plans.
- [x] 6. `DONE` Add a `/status` view for backend, models, Git, downloads, billing, queues, provider circuits, backups, and storage health.
- [x] 7. `DONE` Add structured error reporting with request IDs and redacted logs.
- [x] 8. `DONE` Add automated encrypted database/Gitea backups and restore drills.
- [ ] 9. `PARTIAL` Run an isolated, hardened local staging backend and database on port 8876; a public staging domain and provider test credentials remain.
- [ ] 10. `PARTIAL` Add frontend, Go, Python, installer, dependency-audit, and auth CI definitions; the non-Git website workspace still needs publishing into its canonical repository.

## Agent experience

- [ ] 11. `TODO` Add a visual repository picker at session start.
- [ ] 12. `TODO` Give every agent task its own branch/worktree.
- [x] 13. `DONE` Require a visible add/edit/delete plan and explicit `--yes` approval before `cxy push`.
- [ ] 14. `PARTIAL` Create automatic pre-edit file checkpoints with `/undo`; repository-wide checkpoint selection remains.
- [x] 15. `DONE` Resume saved agent sessions and preserve browser terminal history.
- [x] 16. `DONE` Show user messages, AI output, tool calls, results, and live task activity in the browser interface.
- [x] 17. `DONE` Publish a canonical plan-aware model catalog with coding, reasoning, speed, tier, price, and context metadata.
- [x] 18. `DONE` Add model/provider fallback and circuit-breaker cooldowns for hosted inference.
- [x] 19. `DONE` Display hosted allowance, token usage, model, estimated cost, and context-window consumption.
- [ ] 20. `PARTIAL` Provide browser file/artifact editing and downloadable offline artifacts; dedicated site/image/Markdown preview panes remain.

## CLI and installation

- [x] 21. `DONE` Add `cxy doctor`.
- [x] 22. `DONE` Add checksum-verified `cxy update` and `--check`.
- [x] 23. `DONE` Add previewable, confirmation-gated `cxy uninstall --all`.
- [x] 24. `DONE` Warn when CLI and agent-engine versions are incompatible.
- [ ] 25. `PROVIDER` Sign release manifests and eventually notarize macOS releases.
- [x] 26. `DONE` Install Bash, Zsh, and Fish completions automatically.
- [x] 27. `DONE` Persist PATH changes idempotently while leaving explicit custom install directories untouched.
- [x] 28. `DONE` Add `cxy install ai --dry-run`.
- [x] 29. `DONE` Produce checksum-verified offline CLI + AI bundles for four platforms.

## Website and onboarding

- [x] 30. `DONE` Use auth-aware navigation while keeping `/` on `/` for signed-in and signed-out visitors.
- [x] 31. `DONE` Add a responsive mobile navigation experience.
- [x] 32. `DONE` Add searchable docs for the CLI, agent, models, and APIs.
- [x] 33. `DONE` Add copyable examples for important `cxy` commands.
- [x] 34. `DONE` Add a safe interactive agent demo before installation.
- [x] 35. `DONE` Add route-level lazy loading.
- [ ] 36. `TODO` Complete keyboard, screen-reader, contrast, and zoom accessibility work.
- [x] 37. `DONE` Add a changelog and checksum-verified downloadable release history.

## Pro and billing

- [x] 38. `DONE` Show live monthly usage and remaining allowance.
- [x] 39. `DONE` Send idempotent, retryable email at 50%, 80%, and 100% of allowance.
- [x] 40. `DONE` Support Pro and Pro Max plan changes with Stripe proration.
- [x] 41. `DONE` Add Manage billing to the dashboard/sidebar.
- [x] 42. `DONE` Add idempotent Stripe webhook and subscription audit trails.
- [x] 43. `DONE` Clearly explain currencies, taxes, renewal, cancellation, and prorated changes.
- [x] 44. `DONE` Add a model/token/workload/plan estimator.

## Security and reliability

- [x] 45. `DONE` Add CSRF/origin enforcement, one-time OAuth state, and POST-only logout.
- [x] 46. `DONE` Rate-limit login, chat, repository writes, execution, relay, and downloads separately.
- [x] 47. `DONE` Add CSP, HSTS, Permissions Policy, secure cookies, and frame/content-type protections.
- [x] 48. `DONE` Add provider circuit breakers and model/provider failover.
- [x] 49. `DONE` Add a durable exponential-backoff queue for email, imports, and repository synchronization with idempotent webhooks.
- [x] 50. `DONE` Add live metrics/status and state-change email alerts for latency, failures, spend, providers, queues, disk, backups, and subscription drift.

## Provider-owned follow-up

- Rotate every credential already exposed in source, shell history, chat, or a unit file after machine-side secret loading is migrated.
- Grant the Cloudflare deployment token only the minimum Worker/KV/D1 permissions needed by CI or keep using the connected Workers Builds integration.
- Enable Microsoft 365 DKIM, review DMARC aggregate reports, and move DMARC from monitoring to enforcement gradually.
- Obtain an Apple Developer signing/notarization identity before shipping a notarized macOS bundle.
