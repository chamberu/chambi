# Vercel Skills SDK reference

Source baseline: [vercel-labs/skills](https://github.com/vercel-labs/skills/tree/92a9a34ac3bf88e695e468b90c7bf32f163d32c8) at `92a9a34ac3bf88e695e468b90c7bf32f163d32c8` (package `skills`, version `1.7.4`). Temporary headless fork: [tada5hi/skills-cli](https://github.com/tada5hi/skills-cli), branch `feat/chamvi-sdk`, inspected SDK root API at `af32844c74710860c12a7fceb2cbdeb10018627e`. Pin the owning optional package to this full commit after review. The fork ships generated `dist` for Git installs with scripts disabled; maintainers regenerate it with `sdk:build`, avoiding npm Git dependency build/prepare lifecycle behavior. Chamvi generated `dist` stays untracked.

The fork exposes existing implementations through `src/index.ts`, built as root `dist/index.mjs` plus `dist/index.d.mts`. Import from `skills`, never `skills/api` or the CLI entry. The root exports six runtime functions:

| Upstream source and function | Chamvi owner and use |
|---|---|
| `src/source-parser.ts`: `parseSource` | Optional `@chamvi/skills` source preparation, parse operator-provided sources. |
| `src/git.ts`: `cloneRepo` | Optional `@chamvi/skills` preparation, clone the requested source revision and verify the exact commit. |
| `src/git.ts`: `cleanupTempDir` | Optional `@chamvi/skills` preparation, clean temporary checkouts on success and failure. |
| `src/skills.ts`: `discoverSkills` | Optional `@chamvi/skills` preparation, discover source bundles. |
| `src/skills.ts`: `filterSkills` | Optional `@chamvi/skills` preparation, select explicit role names, with Chamvi checking missing/duplicate selections. |
| `src/installer.ts`: `installSkillForAgent` | Optional `@chamvi/skills` preparation, copy into caller-supplied staging using explicit `cwd`, `global: false`, `mode: 'copy'`; inspect every result. |

The optional package owns the dependency and source/install adapter. Its public options/results must be Chamvi-owned shapes, with no upstream SDK type aliases or re-exports. Application consumers configure sources, independent reviewed pins and role selection through Chamvi; they do not import the SDK or configure fork/backend details. No SDK dependency or Node engine change belongs in `@chamvi/app`. The fork requires Node >=22.20; existing runtime packages retain their current floor.

Upstream installation excludes some files and can dereference in-bundle symlinks. It is not runtime approval or a substitute for Chamvi validation. Preparation must preserve the reviewed selected bytes, verify independent source/bundle pins before replacing assets and clean staging on failure. Never approve a newly computed digest during application startup. Importing or loading skills must not invoke the CLI, change process cwd, prompt or execute skill scripts.

Runtime ownership remains `packages/app/src/skills/`: `bundle.ts` (`hashSkillBundle`, `readSkillBundle`) verifies complete local inventories and exact framed byte hashes; `helpers.ts` validates strict root metadata; `module.ts` (`loadSkillBundles`) creates immutable catalogs; `tools.ts` discloses only requested snapshots through ordinary tools. Supporting `.yaml`/`.yml` files are opaque UTF-8 references, including `agents/openai.yaml`. Only surrounding description whitespace is trimmed before nonblank/length/control checks. Body/reference bytes and hash framing are unchanged.

Compatibility was verified against the unchanged selected `tada5hi/skills` profile at `233532ce04af00916c026f97a3f6097ee7f189df`: common `ponytail`, `codebase-design`; maintainer `generate-commit-message`, `investigate-pr-comments`, `create-pull-request`, `release-please-version-bump`. This does not establish compatibility for unselected scripts, SVG/CSS, hidden templates or binary assets.

Migration is tracked in [chamvi/chamvi#97](https://github.com/chamvi/chamvi/issues/97), with [upstream PR #1430](https://github.com/vercel-labs/skills/pull/1430) and [issue #2455](https://github.com/vercel-labs/skills/issues/2455). Replace the internal backend with an official release when suitable, rerun the unchanged public consumer fixture and remove the temporary fork pin. Consumers should need only a normal Chamvi version update. Task 2 supplies runtime compatibility and this ownership map; optional-package implementation and consumer integration remain later tasks, with no application source changes here.
