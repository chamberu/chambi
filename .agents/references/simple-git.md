# simple-git

Direct runtime dependency `^3.36.0` in `@chamvi/skills` and `@chamvi/test-kit`, inspected at 3.36.0. The skills SDK bundles its own private copy; Chamvi does not import that copy or expose upstream types.

| Source | Chamvi owner and behavior |
|--------|---------------------------|
| `src/git.js` (`raw`), `src/lib/tasks/task.ts` (`straightThroughStringTask`) | `packages/skills/src/prepare/module.ts` and `packages/test-kit/src/git-fixture/module.ts` use `raw()` with `trimmed: false` to preserve existing Git arguments and stdout bytes, including final newlines/NULs. |
| `src/lib/plugins/completion-detection.plugin.ts` | Both await process close (`onClose: true`, `onExit: false`) so pipes finish before returning. |
| `src/lib/plugins/timout-plugin.ts` | Metadata preserves the previous absolute 30000ms deadline with `block: 30000`, `stdOut: false`, `stdErr: false`; default output-driven resets would change it. Fixture calls have no timeout. |
| `src/lib/runners/git-executor-chain.ts`, `src/lib/plugins/abort-plugin.ts` | A private `outputHandler` counts Buffer bytes independently per stdout/stderr and aborts above 1048576 bytes, the previous `execFile` default. Each command creates its own client and abort signal, including fixture calls after rejection. |
| `src/git.js`, `src/lib/plugins/block-unsafe-operations-plugin.ts` | The fixture's `.env(env)` replaces inherited environment. Its explicit `GIT_CONFIG_GLOBAL=/dev/null` and `GIT_CONFIG_COUNT=2` require `allowUnsafeConfigPaths` and `allowUnsafeConfigEnvCount`. The fixture alone explicitly enables the documented unsafe flags to preserve its previously trusted raw-argument contract, including shell aliases and custom hooks. Metadata retains the library defaults. |

The adapter still independently verifies exact cloned HEAD and rejects every tracked source symlink before SDK discovery. Public options/results, fixture identity/config, cleanup and process cwd remain unchanged. Sandbox Git uses `workspace.exec` and does not use this host-local client.
