# simple-git

Direct runtime dependency `^4.0.2` in `@chamvi/skills` and `@chamvi/test-kit`, inspected at 4.0.2 with its pinned `@simple-git/argv-parser` 2.0.1. The skills SDK bundles its own private copy; Chamvi does not import that copy or expose upstream types.

| Source | Chamvi owner and behavior |
|--------|---------------------------|
| `src/git.js` (`raw`), `src/lib/tasks/task.ts` (`straightThroughStringTask`) | `packages/skills/src/prepare/module.ts` and `packages/test-kit/src/git-fixture/module.ts` use `raw()` with `trimmed: false` to preserve operation arguments and stdout bytes, including final newlines/NULs. |
| `src/lib/plugins/completion-detection.plugin.ts` | Both await process close (`onClose: true`, `onExit: false`) so pipes finish before returning. |
| `src/lib/plugins/timeout-plugin.ts` | Metadata preserves the previous absolute 30000ms deadline with `block: 30000`, `stdOut: false`, `stdErr: false`; default output-driven resets would change it. Fixture calls have no timeout. |
| `src/lib/runners/git-executor-chain.ts`, `src/lib/plugins/abort-plugin.ts` | A private `outputHandler` counts Buffer bytes independently per stdout/stderr and aborts above 1048576 bytes, the previous `execFile` default. Each command creates its own client and abort signal, including fixture calls after rejection. |
| `src/git.js`, `src/lib/plugins/block-unsafe-operations-plugin.ts` | The fixture's `.env(env)` replaces inherited environment. Its explicit `GIT_CONFIG_GLOBAL=/dev/null` and `GIT_CONFIG_COUNT=2` require `allowUnsafeConfigPaths` and `allowUnsafeConfigEnvCount`. The fixture alone explicitly enables the documented unsafe flags to preserve its previously trusted raw-argument contract, including shell aliases and custom hooks. Metadata retains the library defaults. |

The adapter still independently verifies exact cloned HEAD and rejects every tracked source symlink before SDK discovery. Public options/results, fixture identity/config, cleanup and process cwd remain unchanged. Sandbox Git uses `workspace.exec` and does not use this host-local client.

The 4.x metadata client sets `baseDir` to the SDK clone and supplies only the operation arguments to `raw()`. Parser 2.0.1 now guards `-C`; using the client directory preserves the effective Git directory and all `--verify`/`-r`/`-z`/`HEAD` flags without disabling production guards. The process tests record the actual cwd and HEAD and confirm the clone is cleaned afterward.

`src/lib/plugins/allow-environment.plugin.ts` is new in 4.x: the fixture permits only `Object.keys(env)` from its existing replacement environment, and `allowAbbreviatedOptions` retains trusted raw Git option abbreviations. Its explicit unsafe list also includes the 2.0.1 categories for command binaries, exec, includes, submodules and URL rewrites. Production metadata uses the library defaults for environment and unsafe-operation guards. The fixture regression runs a benign included config file and a `status --porc` abbreviation through real Git.

The direct dependency was upgraded after the audit identified [trailer-command guard bypass](https://github.com/advisories/GHSA-x6jw-m9v5-85vh) (patched in simple-git 4.0.1) and [VISUAL environment guard bypass](https://github.com/advisories/GHSA-v5rq-49vh-5v5c) (patched in argv-parser 2.0.1). The SDK's private bundle is unchanged; Chamvi's direct client resolution is 4.0.2/2.0.1.
