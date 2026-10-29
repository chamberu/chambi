# Reference: chamvi/helm (chart `agent-app`)

- **Project:** [chamvi/helm](https://github.com/chamvi/helm), the Helm chart that deploys one chamvi app (an image built from `createApp()`) on Kubernetes. Chart `charts/agent-app`, published to `oci://ghcr.io/chamvi/helm/agent-app` (public) and the `gh-pages` index.
- **Why referenced:** the chart hard-codes parts of the monorepo contract (CLI commands, env names, port, probe paths, image entrypoint, sandbox RBAC and labels). A monorepo change to any of them must be checked here, or deployments break silently.
- **Verified against:** `agent-app` 0.1.1 (`root-0.1.1`, commit `312eba4`, 2026-10-25), with `@chamvi/*` 0.2.1.
- **How to maintain:** when a monorepo change touches a row below, update the chart in the same breath (a PR to chamvi/helm) and correct the row here; pin the chart version.

## Model-settings follow-up (2026-10-28, unreleased)

Checked the `feat/model-settings` worktree against chart base `79850ef` (0.1.2) and chamvi 0.3.1. `values.yaml` adds `model` and named `providers`; `templates/_helpers.tpl` maps them to `CHAMVI_MODEL` and `CHAMVI_PROVIDER_<NAME>_*` on both Deployment and CronJobs. API keys and credential headers use Secret references only. `templates/_model-validations.tpl` checks settings without echoing rejected values; generated env names cannot collide with generic `env`. The readiness hook receives no model settings or credentials. Coverage lives in `tests/models_test.yaml` and `scripts/tests/test_models.py`. This is a proposed downstream change, not a published chart contract.

## Channel concurrency compatibility check (2026-10-28)

Scoped read-only check at commit `79850ef48f264eb2d6dcd879b18ff016838520c3`: `charts/agent-app/values.yaml`, `templates/deployment.yaml` and README HTTP/Secrets sections. This does not replace the broader verification above. Env pass-through remains compatible: `CHAMVI_MAX_CONCURRENT_RUNS` is local to each engine. Agent/subscription caps (`packages/core/src/engine/queue/admission.ts`) coordinate through the shared store; `httpModule({ channelRateLimits, trustProxy })` is code configuration, not a chart value or a new env variable. No template/schema migration is required. The TypeScript engine option is `concurrencyMaxRuns`; the chart continues to pass `CHAMVI_MAX_CONCURRENT_RUNS` unchanged.

Documentation follow-up in chamvi/helm: explain known-source app `trustProxy` (Ingress annotations do not set it), separate channel request buckets or `github: false`, shared-store execution ceilings and unbounded queued backlog. No downstream edits, tests or publication performed in this check; a downstream documentation PR remains outstanding.

## Contract map (monorepo -> chart)

| Monorepo source | Chart file | What the chart relies on |
|---|---|---|
| `@chamvi/cli` commands (`packages/cli/src/commands/`) | `templates/deployment.yaml`, `templates/cronjob.yaml` | Value `command` (default `[node, node_modules/@chamvi/cli/dist/cli.mjs]`) renders into `args`, never `command:`, so the image's tini entrypoint stays PID 1; Deployment `args` = `command + [start]`, CronJob `args` = `command + [run-job, <agent>] (+ [<subscription>])`. |
| `run-job <agent> [subscription]`, cron subscription id `cron:<expression>` (`@chamvi/channel-cron`) | `templates/cronjob.yaml`, `values.yaml` `cronJobs[]` (`name`, `schedule`, `agent`, `subscription?`, `timeZone?`, `suspend?`) | One argv element per argument (no shell); `concurrencyPolicy: Forbid`, `backoffLimit: 0`, `restartPolicy: Never` (a Job retry would mint a new `<subscription>@<now>` idempotency key). |
| `run-job` revision rule (`packages/app/src/modules/agents/`, since `feat/app-start-check`) | `templates/cronjob.yaml` | A job never reloads a folder agent: no marker, or a different one without unsettled runs, is written; a different marker while the agent has unsettled runs fails the job's own agent with exit 1 (`invalid_run_state`). A CronJob of a folder agent therefore fails between a folder change and the Deployment applying it, and a CronJob-only install with unsettled runs never applies one. No template change; document it in the chart README (follow-up). |
| `chamvi start --check` (`packages/cli/src/commands/start.ts`; `chamvi doctor` is gone) | none (optional: a pre-install hook or CI step) | Read-only check of the start path: exit 0 clean, 2 configuration or agent folder issues, 1 store failure (unreachable, pending migrations with `CHAMVI_MIGRATE=false`; with the default a start migrates, so they pass). Needs the same env as the Deployment. The chart never used `doctor`. |
| `CHAMVI_SCHEDULER` (`packages/app/src/config/`) | `templates/_helpers.tpl` `agent-app.env` | Set to `false` on every pod whenever `cronJobs` is non-empty (start mode registers a cron channel that validates but never fires). |
| App config env (`readConfig`, `packages/app/src/config/`) | `templates/_helpers.tpl` `agent-app.env`, `templates/validations.yaml` | The chart owns `PORT` (`3000`), `CHAMVI_BASE_PATH` (from `basePath`), `CHAMVI_SCHEDULER`, `CHAMVI_SANDBOX_NAMESPACE` and a derived `CHAMVI_PUBLIC_URL` (origin only, from the Ingress, unless `env.CHAMVI_PUBLIC_URL` is set); `env` may not name an owned variable; `env.HOST` only empty, `0.0.0.0` or `::`; numbers render without exponent notation (`agent-app.scalar`, the app's `envInteger` is `^\d+$`). |
| `CHAMVI_FORCE_EXIT_MS` (CLI, default 90 000) | `templates/validations.yaml` | Render-time guard `preStopSleepSeconds * 1000 + CHAMVI_FORCE_EXIT_MS < terminationGracePeriodSeconds * 1000` (defaults 5 s + 90 s < 120 s). |
| `@chamvi/http` routes under `basePath`: `/healthz`, `/readyz`, `/metrics` | `templates/deployment.yaml` probes, `templates/servicemonitor.yaml`, `templates/tests/test-readyz.yaml`, `templates/ingress.yaml` | Startup and liveness on `<basePath>/healthz`, readiness on `<basePath>/readyz`, ServiceMonitor on `<basePath>/metrics`; `basePath` guard `^(?:\/[a-z0-9._~-]+)+$` mirrors the app's `CHAMVI_BASE_PATH` rule. |
| `approvalUrlOf()` (`packages/app/src/config/asserts.ts`) | `templates/_helpers.tpl` (derived public URL) | The chart passes an origin only; the app appends `basePath` itself. |
| `ghcr.io/chamvi/node:24` (`images/node`: tini entrypoint, uid 1000, workdir `/app`) | `templates/_helpers.tpl` `podCommon`/`containerCommon` | Pod Security `restricted`, uid/gid 1000, read-only root, `/tmp` emptyDir. |
| `@chamvi/sandbox-k8s` client calls, `SANDBOX_LABELS` (`packages/sandbox/src/provider/constants.ts`) | `templates/sandbox-rbac.yaml`, `templates/sandbox-networkpolicy.yaml`, `templates/sandbox-ciliumnetworkpolicy.yaml` | Role in `sandbox.namespace`: `pods` create/get/list/delete, `pods/exec` get/create; egress policies select `app.kubernetes.io/managed-by: chamvi` + `app.kubernetes.io/component: sandbox`; the app pod never carries the sandbox label. The chart does not set `CHAMVI_SANDBOX_PROVIDER` (the app picks `kubernetes`). |
| Static tokens (`CHAMVI_TOKENS`), provider keys, `DATABASE_URL` | `values.yaml` `secrets` (envFrom) | Secrets only through `secrets`; `env` is for non-secret values. Without an authenticator the app exits 2. |

## Repo notes

- CI (`.github/workflows/lint-test.yaml`): helm lint, yamllint, helm-unittest, a Python contract suite (`scripts/tests/`), values coverage, helm-docs/helm-schema drift, ct lint, ArtifactHub lint, a fixture app (`ci/app`, published `@chamvi/*` on `ghcr.io/chamvi/node:24`) and `ct install` on kind with Calico (kindnet's NetworkPolicy fails open on GitHub runners) plus `scripts/kind-smoke.sh` (CronJob run, egress policy enforcement).
- Release: release-please (`simple` root linked to the `helm` chart), `tada5hi/hevi@v2` publishes the GitHub release, the `gh-pages` index and the OCI artifact on every master push (idempotent).
- Its own map back to this repo: `.agents/references/chamvi.md` in chamvi/helm.

## Bash-first review (2026-10-28)

Reviewed local helm commit a8bf3b3: charts use generic env/envFrom and do not reference credential modes or dedicated Git tools. #59/#72 require no chart template change.

## Capability stores compatibility check (2026-10-29)

Checked current GitHub HEAD `482f7de3759e43d61a7faedeb00547e9b3fc5202` from a read-only source archive. Reviewed `ci/app/dist/index.mjs`, chart Deployment/CronJob/helpers, values and chart notes. The fixture imports `createApp`, `defineAgent`, `http` and `cron`; the chart uses env and CLI contracts. No executable consumer uses the removed store classes, aggregate interface, engine property, store module option or container token. Three prose/comment occurrences of the previous memory-store class name remain in CI values and NOTES; they do not affect rendering or runtime behavior.

The monorepo now exposes `Stores`, `createMemoryStores()`, `createTypeormStores()`, `Engine.stores`, `storeModule({ stores })` and `AppToken.STORES`; conversation storage is `stores.conversations`, with authorization/limits kept in conversation policy. No downstream source migration is required for the usages above. CLI, env, route, image, model-format and chart contracts are unchanged. No downstream repository was modified, tested, or published for this check.
