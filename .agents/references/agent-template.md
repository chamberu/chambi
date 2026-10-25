# Reference: chamvi/agent-template

- **Project:** [chamvi/agent-template](https://github.com/chamvi/agent-template), the GitHub template repository behind "Use this template": one chamvi app (`src/index.ts` = `export default createApp({...})`), its image and its Flux deployment with the `agent-app` chart ([helm.md](helm.md)). Reference image `ghcr.io/chamvi/agent-template` (public), tags `main-<sha7>-<commit unix ts>` on `main` and `<semver>` from `v*` tags.
- **Why referenced:** it is the first code a new user copies, so it must track the current public API and the CLI. A monorepo change to the public API, the CLI, env names, the model string format or published versions must be checked here.
- **Verified against:** commit `2635c76` (2026-10-25), `@chamvi/app`, `@chamvi/cli`, `@chamvi/ui` `^0.2.1`.
- **How to maintain:** when a monorepo change touches a row below, update the template (a PR to chamvi/agent-template, then refresh its lockfile against the released packages) and correct the row here.

## Contract map (monorepo -> template)

| Monorepo source | Template file | What the template relies on (and the test that pins it) |
|---|---|---|
| `@chamvi/app` re-exports (`defineAgent`, `defineTool`, `http`, `cron`, `createApp`, `AppOptions`, `consoleChannelModule`) | `src/agents/example.ts`, `src/index.ts`, `src/modules.ts` | Everything comes from `@chamvi/app` and the feature packages' `/module` subpaths; no `@chamvi/core` or `orkos` import (`example.spec.ts`, `app.spec.ts`, `entry.spec.ts`). |
| Model strings `<provider>/<model>`, the model registry (`packages/app/src/models/`) | `src/agents/example.ts` `EXAMPLE_MODEL`, `test/utils/model.ts` | Tests pass a fake provider keyed by `EXAMPLE_MODEL` as `models`; needs the v4 default provider (0.2.1, chamvi#41) (`model.spec.ts`, `app.spec.ts`). |
| CLI `dev`, `build`, `start`, `run-job`, exit codes, signals (`packages/cli/src/`) | `package.json` scripts, `Dockerfile` `CMD`, `test/unit/cli.spec.ts`, `build.spec.ts` | `chamvi build` writes `dist/index.mjs`; the image runs `node node_modules/@chamvi/cli/dist/cli.mjs start`; SIGTERM exits 0. |
| `tsdown` as optional peer of `@chamvi/cli` | `Dockerfile` | npm marks the toolchain devOptional, so the runtime stage deletes it and every extraneous package after `npm prune --omit=dev` (`scripts/image-smoke.sh` fails on leftovers). |
| Env names and defaults (`readConfig`, feature modules' env readers) | `.env.example`, `deploy/flux/secret.example.yaml`, `src/modules.ts` comments | Every variable in `.env.example` must exist in the app (`env-example.spec.ts`); no `RESUME_SECRET`. |
| `@chamvi/http` routes (`/readyz`, `/ui/`, `POST /agents/:name/runs`, `/channels/github`) | `README.md`, `scripts/image-smoke.sh` | The README's curl flow and the docker smoke. |
| `ghcr.io/chamvi/node:24` | `Dockerfile` (pinned by digest, Dependabot `docker`) | uid 1000, workdir `/app`, tini entrypoint; read-only root with `/tmp` tmpfs. |
| Chart `agent-app` values (chamvi/helm) | `deploy/flux/release.yaml`, `deploy/kind/values.yaml`, `deploy/flux/chart.yaml` (`>=0.1.0 <0.2.0`) | Only chart value keys (`deploy.spec.ts` `CHART_VALUE_PATHS`); CI renders the published chart with both value files. |

## Repo notes

- CI (`.github/workflows/ci.yml`): test, typecheck, lint on Node 22 and 24; actionlint and shellcheck; docker smoke; kubeconform on `deploy/flux` (Flux v2.9.6 CRDs) and a `helm template` of the published chart; image push through `tada5hi/craneship@v4` with tags from `scripts/image-tags.sh` (pushes to `main` and `v*` tags only).
- `package-lock.json` must resolve only to `https://registry.npmjs.org/` (`lockfile.spec.ts`).
- Template files carry no copyright header (starter code the user owns); no release-please, commitlint or husky.
