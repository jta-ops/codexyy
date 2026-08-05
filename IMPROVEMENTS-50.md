# Codexyy: 50-improvement delivery tracker

Status legend: `DONE` is implemented on this server, `PARTIAL` has a working foundation but remaining machine-side work, `TODO` has not been implemented, and `PROVIDER` means all available machine-side work is complete but the final step requires an external account/provider action.

## Security, release integrity, and operations

- [ ] 1. `PROVIDER` Move service secrets into host-encrypted, root-only systemd credentials and retire plaintext copies; provider-side rotation of previously exposed credentials remains.
- [x] 2. `DONE` Publish SHA-256 checksums and verify downloaded binaries inside the installer.
- [x] 3. `DONE` Require password/token authentication whenever `codexyy web --expose all` is used.
- [ ] 4. `PROVIDER` Deterministically test signed checkout, duplicate webhook, renewal, cancellation, and invalid-signature flows locally, and provide a live-provider test lifecycle that hard-refuses live keys; a Stripe test secret is required to execute the provider leg.
- [x] 5. `DONE` Add a reconciliation job comparing Stripe subscriptions with local user plans.
- [x] 6. `DONE` Add a `/status` view for backend, models, Git, downloads, billing, queues, provider circuits, backups, and storage health.
- [x] 7. `DONE` Add structured error reporting with request IDs and redacted logs.
- [x] 8. `DONE` Add automated encrypted database/Gitea backups and restore drills.
- [ ] 9. `PROVIDER` Run an isolated, hardened local staging backend/database on port 8876 and provide a prerequisite-gated public Nginx/TLS deployment; DNS, a TLS certificate, and provider test credentials remain.
- [x] 10. `DONE` Add frontend accessibility/build/audit, Go, Python, installer, and auth CI definitions and publish the secret-free website workspace to its canonical GitHub repository.

## Agent experience

- [x] 11. `DONE` Add an authenticated visual repository/task picker at `/agent/start` with a copyable isolated launch command.
- [x] 12. `DONE` Give every agent task a unique remote branch and isolated local workspace through `cxy task start`.
- [x] 13. `DONE` Require a visible add/edit/delete plan and explicit `--yes` approval before `cxy push`.
- [x] 14. `DONE` Create checksummed repository-wide checkpoints with listing, restore previews, explicit approval, secret exclusion, and exact post-checkpoint cleanup.
- [x] 15. `DONE` Resume saved agent sessions and preserve browser terminal history.
- [x] 16. `DONE` Show user messages, AI output, tool calls, results, and live task activity in the browser interface.
- [x] 17. `DONE` Publish a canonical plan-aware model catalog with coding, reasoning, speed, tier, price, and context metadata.
- [x] 18. `DONE` Add model/provider fallback and circuit-breaker cooldowns for hosted inference.
- [x] 19. `DONE` Display hosted allowance, token usage, model, estimated cost, and context-window consumption.
- [x] 20. `DONE` Provide browser file/artifact editing, downloadable offline artifacts, and a local-only Markdown, sandboxed site/HTML, and image preview studio.

## CLI and installation

- [x] 21. `DONE` Add `cxy doctor`.
- [x] 22. `DONE` Add checksum-verified `cxy update` and `--check`.
- [x] 23. `DONE` Add previewable, confirmation-gated `cxy uninstall --all`.
- [x] 24. `DONE` Warn when CLI and agent-engine versions are incompatible.
- [ ] 25. `PROVIDER` Sign online and offline release manifests with a host-encrypted Minisign key and pinned public key; Apple signing/notarization still requires an Apple Developer identity.
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
- [x] 36. `DONE` Enforce a zero-warning JSX accessibility gate and complete keyboard activation, labels, dialog semantics, route focus, skip navigation, screen-reader announcements, contrast modes, reduced motion, and responsive zoom behavior.
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
- Add a Stripe test-mode secret to CI to execute the provider lifecycle already implemented in `backend/stripe_provider_test.py`.
- Point `staging.codexyy.dev` at this server and issue its TLS certificate before running `scripts/enable-staging.sh --yes`.
