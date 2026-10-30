# Conventions

## Tooling

| Tool | Purpose |
|------|---------|
| ESLint 10 (`@tada5hi/eslint-config`) | Linting (`npm run lint`, `npm run lint:fix`) |
| TypeScript 6 (`@tada5hi/tsconfig`) | Typecheck (`npm run typecheck`) |
| tsdown | Build each entry (`index`, `testing`) to `dist/<entry>.mjs` + `.d.mts` |
| nx | Runs `build`, `test`, `typecheck` across packages |
| commitlint + husky | Conventional Commits enforcement (`.husky/commit-msg`) |
| release-please | One linked version for every package, one release and changelog (`linked-versions`) |
| Dependabot | Daily npm + GitHub Actions updates, grouped by prod/dev and major/minor+patch |
| EditorConfig | Whitespace rules shared with the editor |
| unplugin-swc | Compiles the store-db entities' legacy decorators in tsdown and Vitest; the root `tsconfig.build.json` sets `experimentalDecorators: true` |

The `@tada5hi/*` config packages are the source of truth for lint, TS and commit rules; the local config files are thin wrappers. Prefer changing the shared package over adding a local override, unless the deviation is chamvi-specific.

## Code Style

- ESM only (`"type": "module"`), Node >= 24.3.0 (the minimum required by `@tada5hi/eslint-config` 3.2).
- Configured agent/contributed instructions use core `AgentInstructions`; preserve native SDK role-specific content and provider options. Only the leading system run goes into SDK `instructions`; later configured blocks stay transient and ordered. Manual skills catalog instructions remain strings.
- `@chamvi/ui`'s app ships to Vite's default browser target (Safari 16.4, Firefox 114), which esbuild does not polyfill: no ES2025 iterator helpers (`map.entries().toArray()`; use `Array.from`), enforced by a `no-restricted-syntax` rule in `eslint.config.js`. Its scoped Unicorn override also retains `instanceof Error` instead of requiring the newer `Error.isError` API. The `Uint8Array` base64/hex preference rules are disabled globally because Node 24 does not implement those APIs; keep the existing Buffer encodings.
- 4-space indent (also JSON and YAML), LF, UTF-8, final newline, trailing whitespace trimmed except in Markdown (see `.editorconfig`).
- Single quotes, semicolons, and braces around every control-flow body, including single statements (enforced by ESLint).
- Package scope `@chamvi/*`, Apache-2.0 license (`LICENSE` plus `NOTICE` in the root and every package), all packages public.

## File Organization

- **Every file under `src/` and `test/` starts with the copyright header** (config files such as `tsdown.config.ts` and `test/vitest.config.ts` do not; neither does `test/fixtures/readme-example.ts`, which the README embeds verbatim):

  ```ts
  /*
   * Copyright (c) <year>.
   * Author Peter Placzek (tada5hi)
   * For the full copyright and license information,
   * view the LICENSE file that was distributed with this source code.
   */
  ```
- **A module is a folder, not a file.** A concept gets `src/<concept>/` with, as needed:
  - `module.ts`: the implementation (the class or the main functions). A folder with several implementations names them after what they do (`effect/define.ts`, `effect/wrap.ts`), and a sub-concept with its own content gets a subfolder (`engine/queue/`, `engine/execute/`).
  - `types.ts`: every exported type. No exported type lives in an implementation file.
  - `asserts.ts`: functions the implementation uses. When helpers grow, it becomes a `helpers/` folder with one file per helper and its own `index.ts`.
  - `constants.ts`: every exported constant (`agent/constants.ts`, `effect/constants.ts`, `errors/constants.ts`).
  - `index.ts`: the barrel. It re-exports **files of its own folder only**, alphabetically: `export *` when the whole file is public, named exports when the folder keeps part of it internal (`effect/index.ts` exports `EFFECT` but not `EFFECT_HOOKS`; helpers are never exported).
- **One class per file.** `max-classes-per-file` is `1` in `@tada5hi/eslint-config`; never disable it in source. Sibling classes share a folder: `src/errors/base.ts` holds `ChamviError`, and every other error has its own file named after its concept, kebab-case and without an `-error` suffix (`lease-lost.ts` holds `LeaseLostError`). Error codes live in `ErrorCode` (`errors/constants.ts`), never as string literals in the constructors.
- **No cross-module re-export files.** A file that just pulls symbols out of other modules is not allowed; the code moves into the folder (or package) it belongs to. One exception: `@chamvi/app` exposes `@chamvi/core` and named cron/HTTP symbols from its root barrel, by owner decision, so an agent repository imports one package; it also exposes the orkos `IModule` and eldin `IContainer` types from `module/index.ts`. The root facade uses narrow inline `no-reexport-shims` exceptions for these external package exports, preserving core's wildcard surface; directory re-export declarations elsewhere stay within their subtree.
- **The package entry composes folder barrels.** `src/index.ts` is `export * from './<folder>/index.ts'` per folder. Inside a package, import the file you need (`../errors/index.ts`, `../state/types.ts`), not `src/index.ts`.
- **Feature package modules.** An app module lives in its feature package's `src/module/`, published as the `/module` subpath (`@chamvi/github/module`, ...): the only folder importing `@chamvi/app`, which is an optional peer (`peerDependenciesMeta`) plus a devDependency, and stays external in `dist/module.mjs` (one `AppToken` set per process). The main entry and every chunk it loads stay app-free. A shared instance reaches tools through a context pair in the main entry (`provide<Name>Context(engine, value)`, `inject<Name>Context(ctx)`, core-only, in `src/context/`); the `ContextKey` stays internal, and the module provides in its `engineCreated` hook. `@chamvi/app` itself keeps only `/authup` (http cannot depend on app) and `/testing`.
- **Dependency graph.** The `@chamvi/*` edges of `dependencies`, `devDependencies`, `optionalDependencies` and `peerDependencies` (optional or not) must stay acyclic: nx builds its project graph from them, and release-please's node-workspace plugin (with `updatePeerDependencies`) throws on a cycle, which aborts the release run for every package. An `nx.implicitDependencies` exclusion only hides an edge from nx, so it is no fix. Break a cycle in the package.json files instead (a structural type in place of a type import, as `@chamvi/test-kit` does for `IWorkspace`; a variable-specifier import of a package that is in no dependency field, as `@chamvi/sandbox/module` does for its providers). `packages/app/test/unit/graph.spec.ts` checks the graph release-please builds.
- **Test helpers are a package.** Helpers other packages test with (`ControllableClock`, `describeRepositoryContract`) live in `@chamvi/test-kit`, which depends on `@chamvi/core`; core never depends on the kit (that would be an nx cycle), so core's own tests use the private copy in `test/utils/clock.ts`.

## Naming

- **`interface` is for behavior contracts and always carries the `I` prefix**: `IRunRepository`, `IClock`, `IChannel`, `IAgentState`, `IStore`. A class implements it (`MemoryRunRepository implements IRunRepository`), or a factory returns it.
- **Data shapes are `type` aliases without a prefix**: `Run`, `Step`, `TriggerEnvelope`, `EngineOptions`, `ApprovalAnswer`.
- Files are kebab-case.
- `IStore` is the plain aggregate interface passed as `store` to `Engine` and `storeModule` (registered as `AppToken.STORE`); it has no facade methods. Persistence capabilities are repositories (`IRunRepository`, `MemoryRunRepository`); the database backend remains a store. Use concise role-local methods (`insert`, `save`, `findOne`, `find`), preserving domain operations such as `claim` and `beginTurn`. Query `OrFail` variants reject missing records or empty selected pages, never present falsy values.

## Helpers and Dependencies

- Object checks use `isObject` from `smob`, never `typeof x === 'object' && x !== null` (note that `isObject` is false for arrays).
- Standard Schema validation goes through validup (`buildIssuesForStandardSchemaIssues` from `@validup/standard-schema`); errors carry ebec `issues`, never a custom issue field.
- Packages that answer HTTP (`@chamvi/http`) throw `@ebec/http` errors (`BadRequestError`, `ForbiddenError`, ...) and define no error classes of their own; core errors pass through and the error handler maps them by `code`.
- Option misconfiguration in any package's factory (`createHttpApp`, `createScheduler`, `staticTokens`, ...) throws core `InvalidAgentDefinitionError`: it covers app definitions, not only agents.
- validup has no built-in validators: build them with `defineValidator`, fail with `createValidupError` (an ebec issue code, never a bare `Error`) and reuse them (`packages/http/src/request/validators.ts`), never pull in zod for request validation (zod stays a dev dependency for specs).
- Persistence code uses TypeORM repositories and their query builders (`insert().orIgnore()`, `orUpdate()` with an overwrite condition, `update().where().returning()`, find options). Raw SQL only where the ORM cannot express a statement, with a one-line comment saying why.
- Entity links use TypeORM relationship decorators (`@ManyToOne` or `@OneToOne`) with `@JoinColumn`. Map scalar IDs to the same join columns when store code needs direct ID access; generate the database constraints from those relationships.

## Workflow

- Before implementation, trace the complete input-to-output flow and inspect an existing analogous module. Reuse its patterns and installed library mechanisms; introduce a new seam only for concrete callers that need it.
- For persistence changes, map every stored identifier to its parent or document the lifecycle reason it can precede/outlive that parent. Generate migrations from entity metadata and verify both database integrity and normal ORM relationship loading.
- Keep domain validation, identity and selection rules in one implementation shared by store adapters. Adapter code owns queries and transactions.
- Review the whole feature, including callers and configuration, after local fixes. Report design/convention findings separately from test results; passing checks alone do not establish completion.

- After changes run `npm run build && npm run test && npm run typecheck && npm run lint`. Run `npm run lint:fix` before hand-fixing formatting.
- Never edit `dist/` (generated, git-ignored). Never hand-edit `.release-please-manifest.json` or package versions; release-please owns them.
- Keep runtime `dependencies` minimal (the house libraries `@ebec/core`, `smob`, `validup` are fine); tooling belongs in `devDependencies`, and the AI SDK (`ai`) stays a peer dependency.
- Host-local Git metadata in skills preparation and the test-kit fixture uses bounded `execFile`: raw stdout, rejection on nonzero exits or signals, and the default independent 1 MiB stdout/stderr limits with SIGTERM termination. Metadata has an absolute 30 second timeout; fixture commands retain their isolated environment and have no timeout. Sandbox Git stays on `workspace.exec`; the SDK owns cloning. See [simple-git.md](references/simple-git.md) for the evaluated library's incompatible failure/termination behavior.
- New package: add `packages/<name>` (copy `packages/test-kit` layout), a path alias in the root `tsconfig.json`, aliases in its `test/vitest.config.ts` for itself and every workspace package it imports, an entry in `release-please-config.json` (`packages` and the `linked-versions` components) and in `.release-please-manifest.json` at the current version.
- Errors extend `ChamviError` (`@ebec/core` `BaseError`) and live in `src/errors/`, one file each (see File Organization); never throw a bare `Error` from library code.
- A new public export goes through its folder's `index.ts` (reached from `src/index.ts`) and must be added to the package's `test/unit/exports.spec.ts`.

## Planning and Delivery

- Plans and specs stay local (gitignored): the design spec and research notes in `docs/superpowers/specs/`, plans in `.agents/plans/` with `000-roadmap.md` as the living index (open work only, next free plan number at the top). A finished plan is deleted; its outcome moves into `.agents/architecture.md` or `.agents/design.md`.
- Before building, turn the next plan into TDD tasks (superpowers `writing-plans`), then execute subagent-driven in a git worktree under `/opt/projects/chamvi/worktrees/<name>`; keep `master` checked out in the main clone.
- For larger work, orchestrate with workflows: Opus implementers, Fable reviewers, a per-task review and fix loop, and an adversarial whole-branch review with one fix wave before merge.
- Every change lands through a pull request with a Conventional Commit title and an evidence-based body (what changed, what was run). The repo squash-merges with the PR title as the commit message and deletes merged branches.
- Ask before pushing to `master`, publishing to npm or merging release PRs. Settle visual choices (brand, layouts) with rendered previews before implementing.
- Keep status updates short; lead with the result and the decisions taken on the owner's behalf.

## Commits

Conventional Commits: `<type>(scope): <description>`, e.g. `feat(core): add run engine`. No AI-attribution trailers. release-please derives versions and changelogs from them.

- Pre-1.0 (`bump-minor-pre-major` and `bump-patch-for-minor-pre-major`): `fix:` and `feat:` bump the patch, a breaking change (`!` or `BREAKING CHANGE:`) bumps the minor.
- `build:`, `chore:`, `ci:`, `docs:`, `style:`, `refactor:`, `test:` do not release.
- Dependency bumps match Dependabot: `fix(deps): ...` for production, `build(deps-dev): ...` for dev dependencies.

## CI/CD

- `ci.yml`: on push and PR to `master`, install, lint, build, typecheck, test on Node 24.3.0 (the minimum) and latest 24.
- `release.yml`: release-please on `master` opens one release PR for every package (`linked-versions`, the root package `chamvi-root` as component `root`, one tag `v<version>` without a component, `node-workspace` plugin); when merged, build and publish via `tada5hi/monoship@v2` with npm provenance.
- Both reuse the composite actions in `.github/actions/{install,build}`; change Node setup or caching there.

## References

External project references live in `.agents/references/`: one Markdown file per external project this codebase cross-references, building a cumulative mapping so later work finds the corresponding code without searching again. When you look up source code or docs in a referenced project, update its file with:

- The source file path / function name (or doc anchor) in the external project
- The corresponding file path / function name in chamvi
- Any behavioral differences between the implementations (pin claims to a version or commit)

Current references:

- [helm.md](references/helm.md): chamvi/helm, the `agent-app` chart; contract map from the CLI, env, routes, image and sandbox to the chart's templates (see [Downstream Repos](../AGENTS.md#downstream-repos)).
- [agent-template.md](references/agent-template.md): chamvi/agent-template, the starter app; contract map from the public API, CLI, env and chart values to the template's files and tests.
- [simple-git.md](references/simple-git.md): host-local process bounds and the evaluated library behavior that requires retaining `execFile`.
- Skill domain imports (`Skill`, `SkillIdentity`, `SkillMetadata`, `ISkillSource`, `SkillCatalog`, `LoadedSkill`, `createSkillCatalog`) belong to `@chamvi/skills`. Core/app expose only the generic `SkillInput` preparation/contribution seam and never import skills, including in tests. Use `defineSkill`/`defineSkillSource` for custom raw inputs; built-in factories already carry their runtime, without app registration.
- [vercel-skills.md](references/vercel-skills.md): Vercel Skills source/install SDK, temporary fork root API and optional `@chamvi/skills` ownership, migration tracked in issue 97.
- [eve.md](references/eve.md): Vercel's eve agent framework (and `@vercel/agent-runs`), the closest competitor; concept map for durability, approvals, channels, sandboxes, coding tools, tracing, evals and compaction.
