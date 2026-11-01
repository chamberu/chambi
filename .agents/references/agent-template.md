# Reference: chamvi/agent-template

- **Project:** [chamvi/agent-template](https://github.com/chamvi/agent-template), the GitHub template repository behind "Use this template": one chamvi app (`src/index.ts` = `export default createApp({...})`), its image and its Flux deployment with the `agent-app` chart ([helm.md](helm.md)). Reference image `ghcr.io/chamvi/agent-template` (public), tags `main-<sha7>-<commit unix ts>` on `main` and `<semver>` from `v*` tags.
- **Why referenced:** it is the first code a new user copies, so it must track the current public API and the CLI. A monorepo change to the public API, the CLI, env names, the model string format or published versions must be checked here.
- **Verified against:** commit `2635c76` (2026-10-25), `@chamvi/app`, `@chamvi/cli`, `@chamvi/ui` `^0.2.1`.
- **How to maintain:** when a monorepo change touches a row below, update the template (a PR to chamvi/agent-template, then refresh its lockfile against the released packages) and correct the row here.

## Untrusted-content compatibility check (2026-10-30)

Read-only check at `3da2172220b91f8f5859b8f7ca8009abe5bf96a2`: package dependencies, app/modules/example agent, environment/deployment examples and relevant tests. Core trust/extraction exports are additive; GitHub proposals remain opt-in. The word-count example enables neither proposals nor outbound channels, so no immediate template compatibility change is required. Release adoption still needs the usual dependency/lockfile refresh. Upgrade guidance must require stopping all old ingress, workers and approval pollers across every replica and scheduled job, waiting for process exit, then migrating/backfilling, then starting only new binaries. Do not mix old/new runtimes on the store: old pollers can disclose new gates' private argument-bearing bodies to source channels and old workers can create untainted runs after the one-time backfill. Draining executions alone is insufficient. Manual migration (`CHAMVI_MIGRATE=false` plus `chamvi migrate`) or automatic migration is safe only with that stopped-old-runtime sequence. Legacy unfinished runs become tainted and may pause on outbound approvals. Shell execution is excluded.

## Model-settings follow-up (2026-10-28, unreleased)

Checked the `feat/model-settings` worktree against base `272f04f`. App, CLI and UI dependencies now target published `^0.3.1`. `src/index.ts` supplies the app-wide model; `src/agents/example.ts` omits its own model so `CHAMVI_MODEL` can override the default. `test/unit/example.spec.ts` verifies inheritance and runs a scheduled job against an alternate fake provider selected through the environment. CI builds and runs `chamvi start --check` with placeholder credentials, without serving HTTP or calling a model. Deployment examples retain the existing published chart range and generic env/Secret mechanism rather than depending on unreleased chart values.

## Channel concurrency compatibility check (2026-10-28)

Scoped read-only check at commit `272f04f449f9162003d264ba1974f932959305aa`: `src/index.ts`, `src/modules.ts`, `src/agents/example.ts`. This does not replace the broader verification above. `createApp({ agents: [example], modules })` and existing `defineAgent`, `http` and `cron` imports remain compatible. Agent/subscription `concurrencyMaxRuns` fields are additive; existing behavior is unchanged. The modules example has no `httpModule()` configuration example yet. Direct TypeScript engine configuration now uses `concurrencyMaxRuns` (a breaking option rename), while `CHAMVI_MAX_CONCURRENT_RUNS` remains unchanged; the checked template does not configure that engine option.

Documentation follow-up in chamvi/agent-template: show `httpModule({ channelRateLimits, trustProxy })` with operator-supplied trusted proxy CIDRs for webhook bursts, and distinguish nested shared-store execution caps from the engine-local `CHAMVI_MAX_CONCURRENT_RUNS`. No mandatory source migration, new env variable or dependency change is required. No downstream edits, tests or publication performed in this check; a downstream documentation PR remains outstanding.

## Contract map (monorepo -> template)

| Monorepo source | Template file | What the template relies on (and the test that pins it) |
|---|---|---|
| `@chamvi/app` re-exports (`defineAgent`, `defineTool`, `http`, `cron`, `createApp`, `AppOptions`, `consoleChannelModule`) | `src/agents/example.ts`, `src/index.ts`, `src/modules.ts` | Everything comes from `@chamvi/app` and the feature packages' `/module` subpaths; no `@chamvi/core` or `orkos` import (`example.spec.ts`, `app.spec.ts`, `entry.spec.ts`). |
| Model strings `<provider>/<model>`, the model registry (`packages/app/src/models/`) | `src/agents/example.ts` `EXAMPLE_MODEL`, `test/utils/model.ts` | Tests pass a fake provider keyed by `EXAMPLE_MODEL` as `models`; needs the v4 default provider (0.2.1, chamvi#41) (`model.spec.ts`, `app.spec.ts`). |
| CLI `dev`, `build`, `start` (and `start --check`, the read-only pre-flight; `doctor` is gone, the template never used it), `run-job` (exit 1 when its folder agent's revision conflicts), exit codes, signals (`packages/cli/src/`) | `package.json` scripts, `Dockerfile` `CMD`, `test/unit/cli.spec.ts`, `build.spec.ts` | `chamvi build` writes `dist/index.mjs`; the image runs `node node_modules/@chamvi/cli/dist/cli.mjs start`; SIGTERM exits 0. |
| `tsdown` as optional peer of `@chamvi/cli` | `Dockerfile` | npm marks the toolchain devOptional, so the runtime stage deletes it and every extraneous package after `npm prune --omit=dev` (`scripts/image-smoke.sh` fails on leftovers). |
| Env names and defaults (`readConfig`, feature modules' env readers) | `.env.example`, `deploy/flux/secret.example.yaml`, `src/modules.ts` comments | Every variable in `.env.example` must exist in the app (`env-example.spec.ts`); no `RESUME_SECRET`. |
| `@chamvi/http` routes (`/readyz`, `/ui/`, `POST /agents/:name/runs`, `/channels/github`) | `README.md`, `scripts/image-smoke.sh` | The README's curl flow and the docker smoke. |
| `ghcr.io/chamvi/node:24` | `Dockerfile` (pinned by digest, Dependabot `docker`) | uid 1000, workdir `/app`, tini entrypoint; read-only root with `/tmp` tmpfs. |
| Chart `agent-app` values (chamvi/helm) | `deploy/flux/release.yaml`, `deploy/kind/values.yaml`, `deploy/flux/chart.yaml` (`>=0.1.0 <0.2.0`) | Only chart value keys (`deploy.spec.ts` `CHART_VALUE_PATHS`); CI renders the published chart with both value files. |

## Repo notes

- CI (`.github/workflows/ci.yml`): test, typecheck, lint on Node 22 and 24; actionlint and shellcheck; docker smoke; kubeconform on `deploy/flux` (Flux v2.9.6 CRDs) and a `helm template` of the published chart; image push through `tada5hi/craneship@v4` with tags from `scripts/image-tags.sh` (pushes to `main` and `v*` tags only).
- `package-lock.json` must resolve only to `https://registry.npmjs.org/` (`lockfile.spec.ts`).
- Template files carry no copyright header (starter code the user owns); no release-please, commitlint or husky.

## Bash-first migration (2026-10-28)

Reviewed local template commit 0374e2b. `.env.example:49-50` advertises CHAMVI_GIT_CREDENTIAL_MODE and dedicated Git tools. Since 0.4 (`fix/release-0.4-audit`) `@chamvi/sandbox/module` refuses a set `CHAMVI_GIT_CREDENTIAL_MODE` (and a `credentialMode` option) with `InvalidAgentDefinitionError`, so an app started from a `.env` that sets it fails startup: the template must drop those lines in a PR released with 0.4 (required downstream action, not yet opened). Keep token and author configuration. No source/test consumer found. Downstream follow-up is separate from the monorepo PR.

## Approved local skills compatibility check (2026-10-28, unreleased)

Scoped check against refreshed downstream base `a720d7a6caae5ad7ea8ab84ad92bf8478386d6e4` and monorepo implementation `556173d9` (`packages/app/src/skills/{bundle,module,tools,types}.ts`). The additive `hashSkillBundle`/`loadSkillBundles` API uses explicit reviewed local passive bundles; no CLI, env, routes, chart values, RBAC or existing agent API requires migration. This does not replace the broader historical verification above.

The current starter adopts this only after a release exports both helpers. Bundles need an explicit final-image `COPY` at their configured absolute paths, readable by uid 1000; the existing Dockerfile copies JS/dependencies only. Documentation follow-up `a43c6da631ff40203a7ee02454f7fd8c454aafcf` updates `README.md` and `.agents/deployment.md`. Both explain reviewing and updating bytes/pins together and restart mismatch behavior.

Verification recorded in the isolated downstream handoff: `npm ci`, lint fix, build, test (13 files/51 tests), typecheck and lint passed; the embedded README fixture stayed unchanged. No provider calls or publication. After independent audit, the documentation follow-up is open as [chamvi/agent-template#8](https://github.com/chamvi/agent-template/pull/8); it is not a released contract.

## First-class skills deployment requirements (2026-10-29, unreleased)

The filesystem helpers move from app to optional `@chamvi/skills`; `gitSkills` is exported from its main entry, with no `/module` entry or app dependency. `createApp({ skills })` forwards defaults to every code/folder agent and prepares globals/code sources before `engineCreated`, then folder extras before channels/HTTP/model execution. `start --check` skips skill providers, installation and remote content verification. Manual prebuilt catalogs remain supported.

Startup Git sources change the optional deployment path: install `@chamvi/skills` and Git in the runtime image (the base Node 24 image has no Git), use Node >=24.3.0, provide writable corpus/tmp mounts under uid 1000, source network access/credentials, and startup-probe time for clone/verification latency. Stop joins a noncancelable clone before cleanup, so size termination grace accordingly. A read-only root can use an explicit directory on the writable `/tmp` volume. Deployment and CronJob configurations must agree. Prebuilt local snapshots remain compatible with readable assets only. This remains an unreleased optional integration, not a newly published downstream contract.

Delivery check against monorepo `ffec9bdc` and starter follow-up `03de2648faf87a60316a41c03dd5f1aab23eab8c`
(local continuation of [PR 8](https://github.com/chamvi/agent-template/pull/8)): reviewed `README.md`,
`.agents/deployment.md`, `Dockerfile`, `package.json`, `scripts/image-smoke.sh`, and the existing Flux/kind values.
Docs now show main-entry imports and runtime installation, App globals/agent extras, the shared Node >=24.3.0 floor,
Git installation after the pinned runtime FROM with final uid 1000, writable `/tmp` corpora, source/auth app egress,
startup budget (existing probe values), static preflight, cleanup ownership and reviewed upgrades. Default source,
dependency lockfile, Dockerfile, manifests and embedded agent example stay unchanged because adoption is opt-in.
`npm run lint:fix`, build, test (13 files/51 tests), typecheck and lint passed against the existing installed lockfile
(no reinstall was needed). Logs: `/tmp/chamvi-first-class-template-{lint-fix,build,test,typecheck,lint}.log`.
Tests include the real CLI/app/HTTP and deployment documentation contracts with fake models. No live cluster,
Docker image build/smoke, push or publication was performed; remote skills are not enabled in the default smoke fixture.

PR94 review follow-up: README and deployment guidance use the requested `hash` skill descriptor property (SHA-256 remains the algorithm), in downstream commit `72ec9a8`. README/deployment checks passed 12 tests; runtime dependencies and image digest fields remain unchanged.

## Skill runtime ownership check (2026-10-30, unreleased)

Checked monorepo `de1f72e8`: all skill domain types (`Skill`, `SkillIdentity`, `SkillMetadata`, `ISkillSource`,
`SkillCatalog`, `LoadedSkill`), `createSkillCatalog()`, validation, catalogs, `load_skill` and per-engine source
caches/fingerprints now belong to `@chamvi/skills`. Core retains only the generic `SkillInput` preparation/contribution
contract and lifecycle coordination; core/app have no skills dependency. Built-in factories remain direct inputs,
with no module registration. Custom raw values/loaders use `defineSkill`/`defineSkillSource` from skills; custom
loaders own retrieval and verification against reviewed pins. The skills main entry remains app-free.

Downstream documentation commit `8ba3f4eecd80c01865e424a51ad7f611a8e26b53` updates only ownership/import guidance. README/deployment checks passed 12 tests across two files.
Existing dependencies, images, manifests, CLI/env/routes, probe settings, RBAC and fixtures require no changes.
No push, image build, live cluster or publication was performed in this scoped check.

## Structured instructions compatibility check (2026-10-30, unreleased)

Core `src/message/types.ts` now exports native SDK message/content types; `src/agent/types.ts` adds
`AgentInstruction` and string-or-readonly-array `AgentInstructions`. App's existing core barrel re-exports them.
`src/engine/execute/module.ts` maps only leading system blocks to SDK instructions, retaining later configured
blocks in order as a transient prefix outside checkpoints and pending replay. Skills runtime metadata is a separate
system block; manual `SkillCatalog.instructions` remains text. Existing string agents remain compatible.

Downstream commit `858f89bef52f6d369015f6a2b00ac2cb2fcbd2a2` updates only README and agent conventions.
the eight README contract tests passed. Existing sources, fixtures, dependencies, CLI/env, routes,
images, values, manifests, probes and RBAC need no changes. No push or publication was performed.

## Capability repositories compatibility check (2026-10-29)

Checked current GitHub HEAD `a720d7a6caae5ad7ea8ab84ad92bf8478386d6e4` from a read-only source archive. Reviewed `src/index.ts`, `src/modules.ts`, `src/agents/example.ts`, app/example/entry/env tests and the README. Its `createApp({ model, agents, modules, models? })` use remains valid. No consumer supplies custom repositories or conversation options, uses the removed store classes/aggregate interface, or reads the removed engine property/container tokens. Tests reading `config.store.url` and `config.store.migrate` use the unchanged environment configuration shape.

The monorepo now exposes `IStore`, `createMemoryStore()`, `createDatabaseStore()`, `Engine.store`, `storeModule({ store })` and `AppToken.STORE`; conversation storage is `store.conversations`, with authorization/limits kept in conversation policy. No downstream source migration is required for the usages above. CLI, env, route, image, model-format and chart contracts are unchanged. No downstream repository was modified, tested, or published for this check.


## Repository API and database package naming check (2026-10-29)

Rechecked the GitHub HEAD at that time against the source archive above: unchanged. The renamed persistence API (`IRunRepository`, `IStore`, `findOne`/`find` and their `OrFail` counterparts) and `@chamvi/store-db` package have no direct consumer in this downstream repository. Database environment settings and `config.store` remain unchanged; the app still supplies its backend by default. No downstream source migration is required for this refactor. This was a read-only source check, not a downstream build or test run.

## Store aggregate compatibility recheck (2026-10-30)

Fresh HEAD is `3da2172220b91f8f5859b8f7ca8009abe5bf96a2`. Read its downloaded source archive without modifying it: `src/index.ts`, `src/modules.ts`, `src/agents/example.ts`, and `test/unit/{app,env-example,entry,example}.spec.ts`, plus an archive-wide search for storage API consumers. There is no direct consumer of `IStore`, `Engine.store`, `AppToken.STORE`, `storeModule()` or the store factories. The template uses `createApp()` with the default backend; the `config.store.url` and `config.store.migrate` assertions remain unaffected. No downstream source edit or PR is needed for this change; no template tests were rerun.

## Node 24 minimum compatibility check (2026-10-30, unreleased)

Read-only GitHub `gh api` inspection at `3da2172220b91f8f5859b8f7ca8009abe5bf96a2`: `package.json`, `.nvmrc`, `.github/workflows/ci.yml`, `Dockerfile`, `scripts/image-smoke.sh`, README, AGENTS and `.agents/conventions.md`. Chamvi now requires Node >=24.3.0 across runtime and tooling, including CLI and skills; the earlier Node 22 compatibility descriptions above are historical downstream state, not current Chamvi support.

- The template still declares Node `>=22.18.0`, documents that floor, and tests `[22, 24]` in CI. Those contracts are incompatible with the new Chamvi floor and must change to `>=24.3.0`, with CI exercising minimum 24.3.0 and latest 24. Update the lockfile root engine metadata with npm and all associated runtime/CI guidance.
- `.nvmrc` already selects 24. The build stage uses rolling `node:24-trixie-slim`. Correction from the follow-up clone at the same source commit: the Dockerfile pins runtime `ghcr.io/chamvi/node:24@sha256:07e17a3b18e0d22bb5ab36b23ad7dd473b97b27b64580e1997e01484c94300b4`, not the digest recorded in the initial read-only note. Direct execution of that unchanged digest and the built image both report Node v24.22.1 on this host. No digest update was needed; the tini/uid 1000/read-only-root contract remains unchanged.
- Downstream follow-up opened: [chamvi/agent-template#11](https://github.com/chamvi/agent-template/pull/11), commit `8b2ae5d`, updates engines, CI, README/agent guidance and npm-generated lockfile metadata. Only the root engine changed in the lockfile; dependency resolutions and published `@chamvi/{app,cli,ui}` `^0.3.1` ranges are unchanged. `npm ci`, lint, typecheck, build and all 51 tests passed on Node 24.22.0 and exact minimum 24.3.0; Dockerized actionlint and `git diff --check` passed. Docker build and `scripts/image-smoke.sh` passed on retry after an initial timeout (read-only root, readiness/UI 200, graceful stop exit 0). `start --check` passed with the workflow's placeholder configuration; an unconfigured attempt correctly rejected the missing provider. No real provider call was made. GitHub CI also passed both Node jobs, workflow/script lint, Docker smoke and Flux validation; image push is intentionally skipped for PRs and CodeRabbit review was still running at handoff. The PR is open, not merged; this validates published packages, not unreleased Chamvi changes.
