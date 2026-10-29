# Reference: chamvi/agent-template

- **Project:** [chamvi/agent-template](https://github.com/chamvi/agent-template), the GitHub template repository behind "Use this template": one chamvi app (`src/index.ts` = `export default createApp({...})`), its image and its Flux deployment with the `agent-app` chart ([helm.md](helm.md)). Reference image `ghcr.io/chamvi/agent-template` (public), tags `main-<sha7>-<commit unix ts>` on `main` and `<semver>` from `v*` tags.
- **Why referenced:** it is the first code a new user copies, so it must track the current public API and the CLI. A monorepo change to the public API, the CLI, env names, the model string format or published versions must be checked here.
- **Verified against:** commit `2635c76` (2026-10-25), `@chamvi/app`, `@chamvi/cli`, `@chamvi/ui` `^0.2.1`.
- **How to maintain:** when a monorepo change touches a row below, update the template (a PR to chamvi/agent-template, then refresh its lockfile against the released packages) and correct the row here.

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

Reviewed local template commit 0374e2b. `.env.example:49-50` advertises CHAMVI_GIT_CREDENTIAL_MODE and dedicated Git tools; remove those lines when consuming #59. Keep token and author configuration. No source/test consumer found. Downstream follow-up is separate from the monorepo PR.

## Approved local skills compatibility check (2026-10-28, unreleased)

Scoped check against refreshed downstream base `a720d7a6caae5ad7ea8ab84ad92bf8478386d6e4` and monorepo implementation `556173d9` (`packages/app/src/skills/{bundle,module,tools,types}.ts`). The additive `hashSkillBundle`/`loadSkillBundles` API uses explicit reviewed local passive bundles; no CLI, env, routes, chart values, RBAC or existing agent API requires migration. This does not replace the broader historical verification above.

The current starter adopts this only after a release exports both helpers. Bundles need an explicit final-image `COPY` at their configured absolute paths, readable by uid 1000; the existing Dockerfile copies JS/dependencies only. Documentation follow-up `a43c6da631ff40203a7ee02454f7fd8c454aafcf` updates `README.md` and `.agents/deployment.md`. Both explain reviewing and updating bytes/pins together and restart mismatch behavior.

Verification recorded in the isolated downstream handoff: `npm ci`, lint fix, build, test (13 files/51 tests), typecheck and lint passed; the embedded README fixture stayed unchanged. No provider calls or publication. After independent audit, the documentation follow-up is open as [chamvi/agent-template#8](https://github.com/chamvi/agent-template/pull/8); it is not a released contract.

## First-class skills deployment requirements (2026-10-29, unreleased)

The filesystem helpers move from app to optional `@chamvi/skills`; `gitSkills` is exported from its main entry, with no `/module` entry or app dependency. `createApp({ skills })` forwards defaults to every code/folder agent and prepares globals/code sources before `engineCreated`, then folder extras before channels/HTTP/model execution. `start --check` skips skill providers, installation and remote content verification. Manual prebuilt catalogs remain supported.

Startup Git sources change the optional deployment path: install `@chamvi/skills` and Git in the runtime image (the base Node 24 image has no Git), use Node >=22.20, provide writable corpus/tmp mounts under uid 1000, source network access/credentials, and startup-probe time for clone/verification latency. Stop joins a noncancelable clone before cleanup, so size termination grace accordingly. A read-only root can use an explicit directory on the writable `/tmp` volume. Deployment and CronJob configurations must agree. Prebuilt local snapshots remain compatible with readable assets only. This remains an unreleased optional integration, not a newly published downstream contract.

Delivery check against monorepo `ffec9bdc` and starter follow-up `03de2648faf87a60316a41c03dd5f1aab23eab8c`
(local continuation of [PR 8](https://github.com/chamvi/agent-template/pull/8)): reviewed `README.md`,
`.agents/deployment.md`, `Dockerfile`, `package.json`, `scripts/image-smoke.sh`, and the existing Flux/kind values.
Docs now show main-entry imports and runtime installation, App globals/agent extras, the optional Node >=22.20 floor,
Git installation after the pinned runtime FROM with final uid 1000, writable `/tmp` corpora, source/auth app egress,
startup budget (existing probe values), static preflight, cleanup ownership and reviewed upgrades. Default source,
dependency lockfile, Dockerfile, manifests and embedded agent example stay unchanged because adoption is opt-in.
`npm run lint:fix`, build, test (13 files/51 tests), typecheck and lint passed against the existing installed lockfile
(no reinstall was needed). Logs: `/tmp/chamvi-first-class-template-{lint-fix,build,test,typecheck,lint}.log`.
Tests include the real CLI/app/HTTP and deployment documentation contracts with fake models. No live cluster,
Docker image build/smoke, push or publication was performed; remote skills are not enabled in the default smoke fixture.

PR94 review follow-up: README and deployment guidance use the requested `hash` skill descriptor property (SHA-256 remains the algorithm), in downstream commit `72ec9a8`. README/deployment checks passed 12 tests; runtime dependencies and image digest fields remain unchanged.
