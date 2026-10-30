# Roadmap

chamvi is built milestone by milestone, each defined by one real agent that has to work end to end. Everything on this page except the shipped packages is **planned**: designed, not built. There are no dates.

## Shipped

| Package | Contents |
|---|---|
| `@chamvi/core` | `defineAgent()` with channel subscriptions and tool hooks, the `IChannel` contract (`ToolContext.channels`, `consoleChannel()`), `Engine` (dispatch, scheduling, checkpoints, budgets, durable `approve()`, cancel, drain, recovery), effect tools, agent state, the `IStore` contract, `createMemoryStore()` |
| `@chamvi/test-kit` | `describeRepositoryContract`, `describeWorkspaceContract`, `ControllableClock`, `createGitFixture`, `createFakeGithub` |
| `@chamvi/channel-cron` | The cron channel `cronChannel()` and `cron.on()` (one locked hubwire component per subscription, overlap policies, timezones), `runJob()` for one-shot jobs |
| `@chamvi/store-db` | `createDatabaseStore()` on Postgres, `migrateStore`, `purgeExpired`. See [TypeORM store](/repositories/typeorm) |
| `@chamvi/http` | REST control API, server-sent events, the `http`, `mcp` and `webhook` channels and the `/channels/<name>` mount, `/healthz`, `/readyz`, `/metrics`, the MCP endpoint, static-token, authup and OIDC authentication, graceful shutdown. See [HTTP API & MCP](/guide/http) |
| `@chamvi/github` | GitHub App auth with an installation-token cache, the GitHub channel (signed deliveries in, deduplicated by delivery id; issue comments out, deduplicated by a hidden marker), `github.on()` subscriptions, read tools and effect write tools with marker reconciliation. See [GitHub App](/deployment/github-app) |
| `@chamvi/sandbox` | Sandbox contracts, path, repository and limit rules, the run-scoped workspace manager with `create_workspace` and `dispose_workspace`, workspaces a run finds again after a restart or on another replica. See [Workspaces & Coding](/guide/workspaces) |
| `@chamvi/sandbox-local`, `@chamvi/sandbox-docker`, `@chamvi/sandbox-k8s` | Workspace providers: a temporary directory (development), a container per workspace, a pod per workspace (root inside, strict at the edge, a hardened mode, a shared package cache); the `ghcr.io/chamvi/sandbox-dev` image with mise for any toolchain |
| `@chamvi/channel-openclaw` | The OpenClaw channel: messages and approval requests into an OpenClaw chat through its hooks endpoint, with an `Idempotency-Key`. See [OpenClaw](/deployment/openclaw) |
| `@chamvi/coding` | Coding tools (`read_file`, `write_file`, `edit_file`, `grep`, `list_files`, `bash`, `git_diff`) over a run's workspaces and the `ICodingBackend` contract |
| `@chamvi/tool-web` | `web_fetch` behind an address check, through a hapic client with the proxy from the environment. See [Web research tools](/guide/tools#web-research-tools) |
| `@chamvi/ui` | Vue 3 dashboard served by `uiRoutes()`: an agents overview, runs started from the agent page, runs with live steps, an approvals inbox, agent state, schedules |
| `@chamvi/app`, `@chamvi/cli` | `createApp()` with orkos modules booted from env (store, engine, channels, HTTP, GitHub, sandbox, OpenClaw, UI, authup) and the `chamvi` bin with `dev`, `build`, `start`, `run-job` and `migrate`. See [Apps & Modules](/guide/app) |

## Milestones

### M1: issue triage end to end <Badge type="warning" text="Planned" />

On every new issue in the owner's repositories, a triage agent labels it, checks for duplicates, tries to reproduce the bug against the latest release in a sandbox and posts a first reply asking for missing details. A periodic sweep catches issues missed while the agent was down.

M1 is done only when everything it needs ships: the TypeORM store, the cron channel, the HTTP and MCP API with authentication, the GitHub channel and tools, sandboxes with coding tools, the OpenClaw channel, the UI, the CLI, the base image, the Helm chart (with the sandbox RBAC and an egress NetworkPolicy), the template repository, and the triage agent itself, deployed with Flux.

### M2: mail digest <Badge type="warning" text="Planned" />

Every morning, and on request through OpenClaw, the owner gets a short digest: what matters today, what still needs action, what is waiting on others. Open loops are tracked in typed state collections across days. M2 adds a mail (IMAP) channel and **threaded runs**: a new run continues the conversation of an earlier one at the same channel address.

### M3: dependency upgrade <Badge type="warning" text="Planned" />

When Renovate opens a pull request, an agent reads the changelog of the bumped package, fixes breaking changes in a sandbox, runs the tests and pushes commits. It pings the owner only when it is stuck. M3 adds long coding runs, a Claude Code coding backend and stuck detection.

## Planned packages

| Package | Status | Purpose |
|---|---|---|
| Coding backend on the own tools | Planned (M1) | An `ICodingBackend` that runs the coding tools in a nested tool loop |
| `@chamvi/coding-claude-code` | Planned (M3) | A coding backend that runs Claude Code inside the sandbox |
| Deploy kit | Planned (M1) | A base image, a Helm chart and a template repository around `@chamvi/app` and `@chamvi/cli`. See [Deployment](/deployment/) |
| `@chamvi/mail` | Planned (M2) | IMAP channel and tools |
| Chat channel | Planned | A chat channel (#32) on the channel contract |

Two changes happened upstream first: a lock hook, timezone support and the scheduled time per tick shipped in [hubwire](https://github.com/tada5hi/hubwire) 0.2.2 (for the cron channel), and a fetch-native token verification in [authup](https://github.com/authup/authup) 1.0.0-beta.70 (for the HTTP API).

## Stability

chamvi is pre-1.0 and owner-first. Until M3, minor versions may break the API and the store schema.
