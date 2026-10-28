# Reference: chamvi/agent-template

- **Project:** [chamvi/agent-template](https://github.com/chamvi/agent-template), the GitHub template repository behind "Use this template": one chamvi app (`src/index.ts` = `export default createApp({...})`), its image and its Flux deployment with the `agent-app` chart ([helm.md](helm.md)). Reference image `ghcr.io/chamvi/agent-template` (public), tags `main-<sha7>-<commit unix ts>` on `main` and `<semver>` from `v*` tags.
- **Why referenced:** it is the first code a new user copies, so it must track the current public API and the CLI. A monorepo change to the public API, the CLI, env names, the model string format or published versions must be checked here.
- **Verified against:** commit `2635c76` (2026-10-25), `@chamvi/app`, `@chamvi/cli`, `@chamvi/ui` `^0.2.1`.
- **How to maintain:** when a monorepo change touches a row below, update the template (a PR to chamvi/agent-template, then refresh its lockfile against the released packages) and correct the row here.

## Model-settings follow-up (2026-10-28, unreleased)

Checked the `feat/model-settings` worktree against base `272f04f`. App, CLI and UI dependencies now target published `^0.3.1`. `src/index.ts` supplies the app-wide model; `src/agents/example.ts` omits its own model so `CHAMVI_MODEL` can override the default. `test/unit/example.spec.ts` verifies inheritance and runs a scheduled job against an alternate fake provider selected through the environment. CI builds and runs `chamvi start --check` with placeholder credentials, without serving HTTP or calling a model. Deployment examples retain the existing published chart range and generic env/Secret mechanism rather than depending on unreleased chart values.

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
