# Roadmap

chamvi is built milestone by milestone, each defined by one real agent that has to work end to end. The framework foundations below are implemented on `master`; the milestone sections separate those foundations from agents and integrations still to build. Merged work may not yet be in the latest published release. There are no delivery dates.

Last checked against the codebase and GitHub on **2026-10-30**.

## Implemented foundations

| Package | Contents |
|---|---|
| `@chamvi/core` | `defineAgent()` with channel subscriptions, tool hooks and structured instructions; `IChannel`, `consoleChannel()`, durable runs, checkpoints, budgets, effect tools, agent state, approvals with choices, same-agent run handoff, opt-in conversation recall and notes, scoped skills, shared agent/subscription execution caps, composable repositories and `createMemoryStore()` |
| `@chamvi/test-kit` | Repository, conversation and workspace contract suites, `ControllableClock`, `createGitFixture`, `createFakeGithub`, mock models and skill runtime fixtures |
| `@chamvi/channel-cron` | The cron channel `cronChannel()` and `cron.on()` (one locked hubwire component per subscription, overlap policies, timezones), `runJob()` for one-shot jobs |
| `@chamvi/store-db` | `createDatabaseStore()` on Postgres, `migrateStore`, `purgeExpired`. See [database store](/repositories/database) |
| `@chamvi/http` | REST control API, server-sent events, `http`, `mcp` and `webhook` channels, the `/channels/<name>` mount, `/healthz`, `/readyz`, `/metrics`, MCP, static-token, authup and OIDC authentication, configurable channel HTTP limits and graceful shutdown. See [HTTP API & MCP](/guide/http) |
| `@chamvi/github` | GitHub App auth, per-repository installation resolution, signed and deduplicated channel deliveries, `github.on()` subscriptions, issue, pull-request, checks and release tools, and effect writes with marker reconciliation. See [GitHub App](/deployment/github-app) |
| `@chamvi/sandbox` | Sandbox contracts, path, repository and limit rules, run-scoped recoverable workspaces, bash-first credentials and bounded, path-scoped repository instructions. See [Workspaces & Coding](/guide/workspaces) |
| `@chamvi/sandbox-local`, `@chamvi/sandbox-docker`, `@chamvi/sandbox-k8s` | Workspace providers: a temporary directory (development), a container per workspace, a pod per workspace (root inside, strict at the edge, a hardened mode, a shared package cache); the `ghcr.io/chamvi/sandbox-dev` image with mise for any toolchain |
| `@chamvi/channel-openclaw` | The OpenClaw channel: messages and approval requests into an OpenClaw chat through its hooks endpoint, with an `Idempotency-Key`. See [OpenClaw](/deployment/openclaw) |
| `@chamvi/coding` | Coding tools (`read_file`, `write_file`, `edit_file`, `grep`, `list_files`, `bash`, `git_diff`) over a run's workspaces and the `ICodingBackend` contract |
| `@chamvi/tool-web` | `web_fetch` behind an address check, through a hapic client with the proxy from the environment. See [Web research tools](/guide/tools#web-research-tools) |
| `@chamvi/ui` | Vue 3 dashboard served by `uiRoutes()`: an agents overview, runs started from the agent page, runs with live steps, an approvals inbox, agent state, schedules |
| `@chamvi/app`, `@chamvi/cli` | `createApp()` with orkos modules, folder agents and dependency preparation, named model providers and app-wide defaults, `createTestApp()`, `start --check`, visible reload failures, and the `chamvi` commands `dev`, `build`, `start`, `run-job`, `migrate`. See [Apps & Modules](/guide/app), [Agent Folders](/guide/agent-folders) and [CLI](/reference/cli) |
| `@chamvi/skills` | Verified, digest-pinned local bundles and Git sources, startup installation, agent-scoped metadata catalogs and the `load_skill` tool. See [Approved Skills](/guide/skills) |

The [base image](/deployment/docker), [Helm chart](https://github.com/chamvi/helm) and [agent template](https://github.com/chamvi/agent-template) also exist. The chart and template support default models and named providers. Their existence does not by itself complete the end-to-end agent milestones.

## Recently completed

- **Sandbox defaults and bash-first credentials:** safer workspace defaults, credential redaction, removal of dedicated credential-mode Git tools, and a pinned GitHub CLI in the development sandbox image ([#60](https://github.com/chamvi/chamvi/pull/60), [#87](https://github.com/chamvi/chamvi/pull/87)).
- **Maintainer foundations:** GitHub pull-request tools, approvals with choices and same-agent run handoff ([#64](https://github.com/chamvi/chamvi/pull/64), [#65](https://github.com/chamvi/chamvi/pull/65), [#66](https://github.com/chamvi/chamvi/pull/66)). Cross-agent delegation remains planned.
- **Operational controls:** startup validation, visible agent reload failures, shared agent/subscription execution caps and configurable channel HTTP limits ([#61](https://github.com/chamvi/chamvi/pull/61), [#93](https://github.com/chamvi/chamvi/pull/93)).
- **Repository context and reusable skills:** scoped repository instructions and verified skill preparation/loading ([#95](https://github.com/chamvi/chamvi/pull/95), [#94](https://github.com/chamvi/chamvi/pull/94)).
- **Conversation memory:** opt-in, authorized recent-history recall and explicit notes, durable turn ownership and composable persistence repositories ([#96](https://github.com/chamvi/chamvi/pull/96)). This does not include a native chat transport or the broader context-management plan.

## Milestones

### M1: issue triage end to end <Badge type="warning" text="In progress" />

On every new issue in the owner's repositories, a triage agent labels it, checks for duplicates, tries to reproduce the bug against the latest release in a sandbox and posts a first reply asking for missing details. A periodic sweep catches issues missed while the agent was down.

The store, cron, HTTP/MCP authentication, GitHub integration, sandboxes, coding tools, OpenClaw, UI, CLI and deployment foundations are implemented. The triage agent itself, its end-to-end deployment acceptance and the own-tools coding backend remain open. M1 is not complete just because its infrastructure exists.

### M2: mail digest <Badge type="warning" text="Planned" />

Every morning, and on request through OpenClaw, the owner gets a short digest: what matters today, what still needs action, what is waiting on others. Open loops are tracked in typed state collections across days. The mail (IMAP) channel and digest agent remain planned. Opt-in conversation recall and notes are already implemented, but do not yet deliver this mail workflow or the original threaded-run design.

### M3: dependency upgrade <Badge type="warning" text="Planned" />

When Renovate opens a pull request, an agent reads the changelog of the bumped package, fixes breaking changes in a sandbox, runs the tests and pushes commits. It pings the owner only when it is stuck. M3 adds long coding runs, a Claude Code coding backend and stuck detection.

## Planned packages

| Package | Status | Purpose |
|---|---|---|
| Coding backend on the own tools | Planned (M1) | An `ICodingBackend` that runs the coding tools in a nested tool loop |
| `@chamvi/coding-claude-code` | Planned (M3) | A coding backend that runs Claude Code inside the sandbox |
| `@chamvi/mail` | Planned (M2) | IMAP channel and tools |
| `@chamvi/chat` | Planned; older PR [#32](https://github.com/chamvi/chamvi/pull/32) remains open | Native Chat SDK channels and WhatsApp transport; conversation memory is implemented separately |

## Remaining framework work

- **Coding and operations:** own-tools coding backend, visual-regression repair on dependency PRs, provider fallback on quota/rate limits and execution-local artifact hydration caching.
- **Agent composition:** delegation between different agents, remote agents over A2A, UI overrides and agent uploads. Same-agent handoff is already implemented.
- **Context and safety:** compaction, prompt-cache controls, deferred tools, central approval policies, automatic permission classification and untrusted-content isolation. Conversation memory, scoped instructions and skills are foundations, not completion of these plans.
- **Observability:** OpenTelemetry tracing and replay-based evals.
- **Follow-ups to merged work:** race-free confinement for repository instruction reads ([#92](https://github.com/chamvi/chamvi/issues/92)), replacing the temporary skills SDK fork ([#97](https://github.com/chamvi/chamvi/issues/97)), and tool-accessible conversation reset/deletion ([#98](https://github.com/chamvi/chamvi/issues/98)).

See [open issues](https://github.com/chamvi/chamvi/issues) for current tracking. An open issue may lag a merged implementation; code and merged PRs distinguish delivered scope from remaining follow-ups.

Two changes happened upstream first: a lock hook, timezone support and the scheduled time per tick shipped in [hubwire](https://github.com/tada5hi/hubwire) 0.2.2 (for the cron channel), and a fetch-native token verification in [authup](https://github.com/authup/authup) 1.0.0-beta.70 (for the HTTP API).

## Stability

chamvi is pre-1.0 and owner-first. Until M3, minor versions may break the API and the store schema.
