# @chamvi/cli

The `chamvi` bin: argv, entry loading, signals and exit codes for an app built with [`@chamvi/app`](/reference/app). Each command only calls the app's lifecycle methods; see [Apps & Modules](/guide/app).

```bash
npm install @chamvi/app @chamvi/cli ai
npm install --save-dev tsdown   # only for chamvi build
```

Node.js `>=24.3.0` (type stripping, so `dev` and a `.ts` entry run without a build step). `@chamvi/app` is a required peer dependency (one copy), `tsdown` an optional one, imported by `build` only.

`package.json` scripts of an agent repository:

```json
{
    "type": "module",
    "scripts": {
        "dev": "chamvi dev",
        "build": "chamvi build",
        "start": "chamvi start"
    }
}
```

## Commands

`chamvi <command> [args] [flags]`, plus `--help` and `--version`. Every command takes `--entry <path>`.

| Command | Arguments and flags | Does | Exit |
|---|---|---|---|
| `dev` | `--entry` | Spawns `node --watch [--env-file-if-exists=.env] <cli.mjs> start --dev --entry <source entry>` (the env flag only when `.env` exists at start: on Linux `node --watch` fails on a missing env file), forwards SIGINT and SIGTERM | the child's code |
| `build` | `--entry`, `--out-dir <dir>` (default `dist`) | Bundles the entry with tsdown (missing: exit 2, "install tsdown as a devDependency"); the out dir is emptied first, so one that is the project folder or above it, holds the entry, or holds anything but `.mjs` and `.mjs.map` files exits 2 | 0, 1 build error, 2 usage |
| `start` | `--entry`, `--check`, `--dev` (hidden) | `app.start()`, then waits for a signal. `--check`: `app.check()` instead, the start path up to the start, writing nothing to the store and serving nothing; prints `chamvi: start check passed`, or each agent folder issue on its own stderr line ([Check before you deploy](/guide/models#check-before-you-deploy)) | 0 clean stop (or a clean check), 1 start failure, forced exit or a check's store failure (unreachable, pending migrations), 2 usage, configuration or (check) an agent folder issue |
| `run-job` | `<agent>`, `[subscriptionId]`, `--entry` | `app.runJob({ agent, subscription })`, prints `<agent>: <status> (run <id>)` (also after a signal); `subscriptionId` defaults to the agent's only cron subscription | 0 completed, waiting, skipped, queued behind an approval or interrupted by a signal; 1 failed or cancelled (also when a signal came meanwhile), an error or a failed stop; 2 usage |
| `migrate` | `--entry` | `app.migrate()` | 0, 1, 2 (`DATABASE_URL` unset is 2) |

**Entry:** `--entry <path>` (a bare `--entry` or `--no-entry` exits 2), else the command's default. The source commands (`dev`, `build`, `start --dev`) read `package.json` `"chamvi": { "entry": "<path>" }`, then fall back to `src/index.ts`. The built commands (`start`, `run-job`, `migrate`) never read that field and default to `dist/index.mjs`, so an image built from a repository that sets it still starts; a missing one beside a `src/index.ts` exits 2 with "run `chamvi build` or pass `--entry src/index.ts`". With none of them (no `--entry`, no `chamvi.entry`, no default file), `dev`, `start`, `run-job` and `migrate` run the default app, `createApp({})` configured by env alone, with its agents from `./agents` (or `CHAMVI_AGENTS_DIR`), and say so on stderr; `build` exits 2 (nothing to build). The entry is loaded with `import()`; a default export that is not an app exits 2 with `<entry> must export default createApp({...})`.

**`start --dev`** (what `dev` runs): the source entry, `<cwd>/.env` (only the keys the env lacks, through `node:util` `parseEnv`; loaded before the entry is imported, so the optional module factories see them), in-memory repositories from `createMemoryStore()` unless `DATABASE_URL` is set and, without any authenticator, one random `*` token with id `dev`, logged once with a warning; `CHAMVI_DRAIN_TIMEOUT_MS` defaults to 5000 and `CHAMVI_FORCE_EXIT_MS` to 15000.

## Exit codes

```ts
const EXIT_CODE: { OK: 0; FAILURE: 1; USAGE: 2 };
const CLI_USAGE_ERROR_CODE: 'cli_usage';
```

| Code | When |
|---|---|
| `0` | Success: a clean stop, a built bundle, a migrated store, a job as listed above, a `start --check` without issues |
| `1` | Runtime failure: a start, check, build or migrate error (a check's store unreachable or not migrated), a failed or cancelled job, a forced exit after `CHAMVI_FORCE_EXIT_MS` or a second signal |
| `2` | Usage or configuration: an unknown command or flag, an entry that is missing or no chamvi app, missing or invalid env (named, its value never echoed), model settings with an issue, an agent with no model and no default or a model string whose provider is not configured or whose package is missing, a `start --check` that found an agent folder issue, a module graph error (a dependency the app does not register, a cycle), any `InvalidAgentDefinitionError` before anything started (the engine starts only once every module checked its configuration) |

The CLI sets `process.exitCode` and lets Node exit; `process.exit()` only ends a forced exit. An unknown command or a missing argument prints the usage, every other exit-2 error its message, an exit-1 error its stack.

## Signals

`start` and `run-job`:

- The first SIGTERM or SIGINT calls `app.stop()` (for `run-job`: aborts the job's wait through `runJob({ signal })`, which then drains), then exits 0, or 1 when the stop reported an error.
- A second signal exits 1 at once. A signal within 1 s of the first counts as the same one, since `npm run dev` and `npm start` deliver one Ctrl-C twice (npm forwards SIGINT to the script while the terminal signals the whole group).
- `CHAMVI_FORCE_EXIT_MS` (90 s) after the first signal, a stop still running exits 1.

`migrate` installs no handlers: Node's default ends it.

On Kubernetes keep `preStop + CHAMVI_FORCE_EXIT_MS < terminationGracePeriodSeconds`. With a 5 s `preStop` sleep and a grace period of 120 s, the worst case is 5 + 0 (readiness delay) + 30 (drain) + 5 (close) + 30 (workspaces) = 70 s, the forced exit comes at 5 + 90 = 95 s and SIGKILL at 120 s.

## dev and process groups

A terminal's Ctrl-C sends SIGINT to the whole foreground process group, and the `node --watch` supervisor forwards the signal it receives to its child. Without care the app would get two signals and the second-signal rule would exit 1 without draining. So `dev` spawns the supervisor `detached`, in a process group of its own: the terminal's SIGINT reaches only the CLI, which forwards that one signal. SIGHUP (the terminal closed) and the CLI's own exit stop the child with SIGTERM, and the child's stdin is a pipe only the CLI writes: when the CLI dies without its exit hook (SIGKILL, the OOM killer), the pipe closes and the app ends the whole group, so it never outlives the CLI. The exit code is the child's, 0 when it ended by a forwarded signal.

`node --watch` restarts on a change of the entry, anything it imports, and `.env` (Node watches the env file it loaded), so `dev` passes no `--watch-path`.

## build output

`chamvi build` calls tsdown with:

```ts
{
    config: false,
    entry: { index: '<entry>' },
    format: 'esm',
    platform: 'node',
    target: 'node24',
    outDir: '<out-dir>',
    fixedExtension: true,
    sourcemap: true,
    dts: false,
    clean: true,
}
```

The result is `<out-dir>/index.mjs` plus its source map. Every `dependencies` and `peerDependencies` package stays external and the app's own modules are inlined; `@chamvi/*`, `typeorm`, `pg`, `dockerode` and `@kubernetes/client-node` are never bundled (`@chamvi/ui` finds its `dist/app` through `import.meta.url`). An image runs `dist/index.mjs` with the production `node_modules`: `CMD ["node", "node_modules/@chamvi/cli/dist/cli.mjs", "start"]`.

## Programmatic use

```ts
function runCli(argv: string[], context?: Partial<CliContext>): Promise<void>;
```

The bin is `await runCli(process.argv.slice(2), processContext(...))`. Every process touch point is injectable, which is how the CLI's own tests run commands in-process:

<<< ../../../cli/src/run/types.ts{ts}

```ts
type ProcessEvent = 'SIGTERM' | 'SIGINT' | 'SIGHUP' | 'exit';

/** Where signals arrive: `process`, or a fake in tests. */
interface ISignalTarget {
    on(event: ProcessEvent, fn: () => void): void;
    off(event: ProcessEvent, fn: () => void): void;
}
```
