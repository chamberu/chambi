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

## Approved local skills compatibility check (2026-10-28, unreleased)

Scoped check against refreshed downstream base `482f7de3759e43d61a7faedeb00547e9b3fc5202` and monorepo implementation `556173d9` (`packages/app/src/skills/{bundle,module,tools,types}.ts`). The additive `hashSkillBundle`/`loadSkillBundles` API uses explicit reviewed local passive bundles; no CLI, env, routes, chart values, RBAC or existing agent API requires migration. This does not replace the broader historical verification above.

The shared Deployment/CronJob image, uid 1000 and read-only root remain compatible when bundles are included in the image at pinned absolute paths. The chart adds no mounts, installation, discovery or permissions. Documentation follow-up `68b84271ee2a3559e4abefa223c28a576037ab72` updates `charts/agent-app/README.md.gotmpl` and generated `README.md`, `.agents/references/chamvi.md`. Both explain reviewing and updating bytes/pins together and restart mismatch behavior.

Verification recorded in the isolated downstream handoff: `make generate`, `make test` and post-commit `make drift` passed. Helm checks: 15 suites/82 tests, Python 40 passed/2 existing fixture-gated skips (no `AGENT_APP_CI_IMAGE`), five render configurations and 59-path values coverage. No provider calls or publication. After independent audit, the documentation follow-up is open as [chamvi/helm#10](https://github.com/chamvi/helm/pull/10); it is not a released contract.

## First-class skills deployment requirements (2026-10-29, unreleased)

The filesystem helpers move from app to optional `@chamvi/skills`; `gitSkills` is exported from its main entry, with no `/module` entry or app dependency. `createApp({ skills })` forwards defaults to every code/folder agent and prepares globals/code sources before `engineCreated`, then folder extras before channels/HTTP/model execution. `start --check` skips skill providers, installation and remote content verification. Manual prebuilt catalogs remain supported.

Startup Git sources change the optional deployment path: install `@chamvi/skills` and Git in the runtime image (the base Node 24 image has no Git), use Node >=24.3.0, provide writable corpus/tmp mounts under uid 1000, source network access/credentials, and startup-probe time for clone/verification latency. Stop joins a noncancelable clone before cleanup, so size termination grace accordingly. A read-only root can use an explicit directory on the writable `/tmp` volume. Deployment and CronJob configurations must agree. Prebuilt local snapshots remain compatible with readable assets only. This remains an unreleased optional integration, not a newly published downstream contract.

Delivery check against monorepo `ffec9bdc` and Helm follow-up `2354ffb54977c1c2224092981c1a477310b573de`
(local continuation of [PR 10](https://github.com/chamvi/helm/pull/10)): reviewed
`charts/agent-app/templates/{_helpers.tpl,deployment.yaml,cronjob.yaml,sandbox-networkpolicy.yaml}`,
`values.yaml` probe fields, README source/generated docs and `.agents/references/chamvi.md`.
The docs now show main-entry `gitSkills`, globals/extras, explicit runtime Git installation while restoring uid 1000,
distinct `/tmp/chamvi-skills/{common,maintainer}` corpora, source/auth app egress, existing startup probe timing
(example 150 failures at 2 seconds), read-only preflight and clone-settlement shutdown. No template/schema/value
changes were needed. `make generate`, `make test` and post-commit `make drift` passed: 15 Helm suites/82 tests,
42 Python cases (40 passed, 2 existing `AGENT_APP_CI_IMAGE`-gated skips), five renders and 59 referenced values paths.
Logs: `/tmp/chamvi-first-class-helm-{test,drift}.log`. Generation emitted only the existing amd64-on-arm64 image
warning. No live cluster, published-app fixture image, push or publication was performed.

PR94 review follow-up: chart docs use the requested `hash` skill descriptor property (SHA-256 remains the algorithm), in downstream commit `4f2dba2`. Source/generated README agree; contract checks passed 40 cases with 2 existing image-gated skips. Image digest fields remain unchanged.

## Skill runtime ownership check (2026-10-30, unreleased)

Checked monorepo `de1f72e8`: all skill domain types (`Skill`, `SkillIdentity`, `SkillMetadata`, `ISkillSource`,
`SkillCatalog`, `LoadedSkill`), `createSkillCatalog()`, validation, catalogs, `load_skill` and per-engine source
caches/fingerprints now belong to `@chamvi/skills`. Core retains only the generic `SkillInput` preparation/contribution
contract and lifecycle coordination; core/app have no skills dependency. Built-in factories remain direct inputs,
with no module registration. Custom raw values/loaders use `defineSkill`/`defineSkillSource` from skills; custom
loaders own retrieval and verification against reviewed pins. The skills main entry remains app-free.

Downstream documentation commit `7247aa5873d39b5a8bc372bff0016a6f3bbabf6f` updates only ownership/import guidance. `caffeinate -is make docs` and the six `test_docs.py` documentation contract tests passed.
Existing dependencies, images, manifests, CLI/env/routes, probe settings, RBAC and fixtures require no changes.
No push, image build, live cluster or publication was performed in this scoped check.

## Structured instructions compatibility check (2026-10-30, unreleased)

Core `src/message/types.ts` now exports native SDK message/content types; `src/agent/types.ts` adds
`AgentInstruction` and string-or-readonly-array `AgentInstructions`. App's existing core barrel re-exports them.
`src/engine/execute/module.ts` maps only leading system blocks to SDK instructions, retaining later configured
blocks in order as a transient prefix outside checkpoints and pending replay. Skills runtime metadata is a separate
system block; manual `SkillCatalog.instructions` remains text. Existing string agents remain compatible.

Downstream commit `fc6bf888cc411ad544e86fc00dfd6587796a0394` updates only charts/agent-app/README.md.gotmpl and generated README.
`caffeinate -is make docs` plus all six `test_docs.py` documentation contract checks passed. Existing sources, fixtures, dependencies, CLI/env, routes,
images, values, manifests, probes and RBAC need no changes. No push or publication was performed.

## Capability repositories compatibility check (2026-10-29)

Checked current GitHub HEAD `482f7de3759e43d61a7faedeb00547e9b3fc5202` from a read-only source archive. Reviewed `ci/app/dist/index.mjs`, chart Deployment/CronJob/helpers, values and chart notes. The fixture imports `createApp`, `defineAgent`, `http` and `cron`; the chart uses env and CLI contracts. No executable consumer uses the removed store classes, aggregate interface, engine property, store module option or container token. Three prose/comment occurrences of the previous memory-store class name remain in CI values and NOTES; they do not affect rendering or runtime behavior.

The monorepo now exposes `IStore`, `createMemoryStore()`, `createDatabaseStore()`, `Engine.store`, `storeModule({ store })` and `AppToken.STORE`; conversation storage is `store.conversations`, with authorization/limits kept in conversation policy. No downstream source migration is required for the usages above. CLI, env, route, image, model-format and chart contracts are unchanged. No downstream repository was modified, tested, or published for this check.


## Repository API and database package naming check (2026-10-29)

Rechecked the GitHub HEAD at that time against the source archive above: unchanged. The renamed persistence API (`IRunRepository`, `IStore`, `findOne`/`find` and their `OrFail` counterparts) and `@chamvi/store-db` package have no direct consumer in this downstream repository. Database environment settings and `config.store` remain unchanged; the app still supplies its backend by default. No downstream source migration is required for this refactor. This was a read-only source check, not a downstream build or test run.

## Store aggregate compatibility recheck (2026-10-30)

Fresh HEAD verification still reports `482f7de3759e43d61a7faedeb00547e9b3fc5202`, unchanged from the read-only archive check above. The chart has no direct consumer of `IStore`, `Engine.store`, `AppToken.STORE`, `storeModule()` or the store factories. The singular `store` aggregate leaves CLI, env, routes, image and chart contracts unchanged. No downstream source edit or PR is needed for this change; no chart tests were rerun.

## Node 24 minimum compatibility check (2026-10-30, unreleased)

Read-only GitHub `gh api` inspection at `482f7de3759e43d61a7faedeb00547e9b3fc5202` (chart 0.1.2): `.github/workflows/{lint-test,release}.yaml`, `ci/app/{package.json,Dockerfile}`, `charts/agent-app/{Chart.yaml,values.yaml}` and Deployment/CronJob templates. Chamvi now requires Node >=24.3.0 for all runtime and tooling packages; Node 22 is no longer supported.

- The chart has no Node engine or Node CI matrix. Its CI uses Helm/Python/Docker and builds the fixture on `node:24-trixie-slim`, then runs it on `ghcr.io/chamvi/node:24`. These rolling Node 24 image contracts already align with the new major; no CLI command, env, probe, port or Kubernetes API change is required.
- The fixture has no `engines` declaration and still consumes published `@chamvi/app`/`@chamvi/cli` `^0.3.0`. The chart accepts arbitrary application images and cannot enforce their Node patch version. Operators must rebuild custom images with Node >=24.3.0 before upgrading Chamvi.
- Downstream follow-up opened: [chamvi/helm#11](https://github.com/chamvi/helm/pull/11), commit `33ae3cf`, documents >=24.3.0 and declares it on the fixture. No fixture lockfile was added: its Dockerfile intentionally uses `npm install`, with no existing lockfile contract. `make test` (82 Helm unit tests plus contract/render/coverage checks), `make drift ct-lint`, `make shellcheck actionlint`, and `git diff --check` passed. `make fixture` passed on retry after an initial build timeout, rebuilding the Docker image and passing all 42 Python tests including the cron-job execution contract. The resolved runtime image (`sha256:9cab68945f564db07761bbc2868953241aa3625fc5508e4519846e4e4471c2b8`) and built fixture both report Node v24.22.1. No chart version, dependency range or image reference changed. GitHub CI also passed lint, Artifact Hub lint, fixture and Kubernetes install jobs; CodeRabbit review was still running at handoff. The PR is open, not merged; validation uses currently published packages, not the unreleased Chamvi changes.
