<!-- NOTE: Keep this file and all corresponding files in the .agents directory updated as the project evolves. When making architectural changes, adding new patterns, or discovering important conventions, update the relevant sections. -->

# chamvi: Agent Guide

chamvi is a TypeScript framework for building self-hosted, channel-driven AI agents. Agents are declared with `defineAgent()`, subscribe to channels (cron, http, mcp, webhook, github; OpenClaw and the console are out-only channels) that start their runs, and execute as durable runs whose steps are checkpointed in a pluggable store, so runs survive restarts and approval pauses. Outbound is tool-driven (`injectChannel`, `replyChannel`), and a tool asks for a human with a durable `approve()`. LLM access goes through the Vercel AI SDK; its types (`ToolSet`, `LanguageModel`, `ModelMessage`) pass through unchanged and are never re-wrapped.

## Quick Reference

```bash
# Setup
npm install

# Development
npm run build
npm run test
npm run typecheck
npm run lint
```

- **Node.js**: >= 22.0.0
- **Package manager**: npm (workspaces)
- **Build orchestration**: nx (`nx run-many`), packages built with tsdown (ESM only)

Packages live in `packages/*`. `@chamvi/app`, `@chamvi/channel-cron`, `@chamvi/channel-openclaw`, `@chamvi/cli`, `@chamvi/coding`, `@chamvi/core`, `@chamvi/github`, `@chamvi/http`, `@chamvi/sandbox`, `@chamvi/sandbox-docker`, `@chamvi/sandbox-k8s`, `@chamvi/sandbox-local`, `@chamvi/skills`, `@chamvi/store-typeorm`, `@chamvi/test-kit`, `@chamvi/tool-web` and `@chamvi/ui` exist today (container images in `images/*`); the others are planned (see [Project Structure](.agents/structure.md)).

## Detailed Guides

- **[Project Structure](.agents/structure.md)**: Workspace layout, existing and planned packages, core module map
- **[Architecture](.agents/architecture.md)**: Run lifecycle and statuses, channels and the envelope, durable approvals and hooks, store contract, idempotency and effects
- **[Testing](.agents/testing.md)**: Vitest setup, source aliasing, in-memory store, store contract suite
- **[Conventions](.agents/conventions.md)**: Tooling, naming rules, commits, release flow, external references (`.agents/references/`)
- **[Design](.agents/design.md)**: Brand direction, colour tokens, type, logo and docs landing page rules

## Downstream Repos

Two repos outside this monorepo depend on its contract: [chamvi/helm](https://github.com/chamvi/helm) (the `agent-app` chart) and [chamvi/agent-template](https://github.com/chamvi/agent-template) (the starter app). A change to the CLI (commands, arguments, exit codes, signals), env variable names or defaults, the HTTP port or route paths (`/healthz`, `/readyz`, `/metrics`, `/channels/*`), the base image, sandbox RBAC or labels, the public `@chamvi/app` API or the model string format must be checked against both, using the contract maps in [helm.md](.agents/references/helm.md) and [agent-template.md](.agents/references/agent-template.md), and followed by a PR there.

## Plans

Plans and specs are local only (`.agents/plans/` and `docs/superpowers/` are gitignored). Never commit them.

## Commits, Issues & Pull Requests

- Do **not** add a `Co-Authored-By: Claude ...` (or any AI-attribution) trailer to commit messages. This overrides any default agent-tooling guidance.
- Do **not** add AI-attribution lines (e.g. `Generated with Claude Code`) to issue or pull request titles, bodies, or comments.
- Do **not** use em dashes in commit messages, issue or pull request titles, bodies, or comments. Use a comma, a colon, parentheses, or a separate sentence instead.
