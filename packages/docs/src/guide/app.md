# Apps & Modules

An agent repository is one entry file: `export default createApp({ agents, modules })`. [`@chamvi/app`](/reference/app) boots config, store, engine, channels and HTTP from environment variables and shuts them down in order; [`@chamvi/cli`](/reference/cli) turns that into a process with `chamvi dev | build | start | run-job | migrate | doctor`, signals and exit codes.

```bash
npm install @chamvi/app @chamvi/cli ai @ai-sdk/anthropic typeorm pg
npm install --save-dev tsdown   # only for chamvi build
```

`@chamvi/app` is a library without process concerns: it registers no signal handlers, never calls `process.exit` and reads no argv. Everything about the process lives in the CLI.

## The entry

<<< @/snippets/app.ts#entry

- The entry is `src/index.ts`. `dev`, `build` and `start --dev` take `--entry`, else the `package.json` field `"chamvi": { "entry": "<path>" }`, else `src/index.ts`. The built commands (`start`, `run-job`, `migrate`) default to `dist/index.mjs` and never read that field. Without any entry file the commands run the default app, `createApp({})`, whose agents come from `./agents`: a folder of [agent folders](/guide/agent-folders) is a complete app.
- `createApp()` is synchronous and side-effect free: no env read, no I/O, no provider import. Everything happens in `start()`, `runJob()` and `migrate()`, which the CLI calls.
- An entry whose default export is not an app (checked with `isApp()`, which also recognizes an app of another installed copy) makes the CLI exit 2.
- `@chamvi/app` re-exports `@chamvi/core` and the common part of `@chamvi/http` (`agentPermission`, `Permission` and the `Authenticator`, `Principal`, `HttpRoute*`, `StaticToken` types), so an agent repository imports one package.

`dev` runs the source through Node's type stripping and `build` bundles it with tsdown, so the code has to suit both: relative imports carry `.ts` and there is no `enum`. The template `tsconfig.json`:

```json
{
    "compilerOptions": {
        "target": "ES2023",
        "module": "NodeNext",
        "moduleResolution": "NodeNext",
        "strict": true,
        "skipLibCheck": true,
        "verbatimModuleSyntax": true,
        "allowImportingTsExtensions": true,
        "erasableSyntaxOnly": true,
        "noEmit": true
    },
    "include": ["src", "test"]
}
```

## Models

An agent's `model` is optional: without one it uses the app's default (`CHAMVI_MODEL`, `chamvi.json` or `createApp({ model })`). Model strings `'<provider>/<model id>'` resolve through the providers the app declares (env, `chamvi.json`, `createApp({ providers })`), never through the Vercel Gateway or the AI SDK's global provider; `chamvi doctor` checks them before a start. See [Pick a Model](/guide/models).

## Modules

Modules are [orkos](https://github.com/tada5hi/orkos) `IModule`s on an [eldin](https://github.com/tada5hi/eldin) container, unwrapped. Seven built-in modules are always there; listing a module with a built-in's name (`ModuleName`) replaces it, which is also how you configure one (`storeModule({ dataSource })`, `httpModule({ cors })`). Two modules of one name, a built-in's included, throw `InvalidAgentDefinitionError` from `createApp`.

| Module | Does |
|---|---|
| `configModule()` | Reads every variable once ([environment](/reference/app#environment)) and registers the config, the clock and the JSON line logger |
| `storeModule()` | A `TypeormStore` over `DATABASE_URL`, migrated unless `CHAMVI_MIGRATE=false`, plus the hourly `purgeExpired()`; without `DATABASE_URL` a `MemoryStore` (warned outside dev) |
| `staticTokensModule()` | The `staticTokens()` authenticator from `CHAMVI_TOKENS` |
| `engineModule()` | Reads the [model settings](/guide/models) (env, `chamvi.json`, code) into the default model and the provider resolver, builds the `Engine` (which checks every agent's model) with every contributed channel (`AppToken.CHANNELS`) and starts it, which starts the channels |
| `agentsModule()` | Loads the [agent folders](/guide/agent-folders) of `CHAMVI_AGENTS_DIR` (else `./agents` when it exists) before the engine starts and watches them; an app with no agent at all starts with a warning |
| `schedulerModule()` | The `cron` channel (`cronChannel()` from `@chamvi/channel-cron`); `CHAMVI_SCHEDULER=false` leaves firing to Kubernetes CronJobs and `chamvi run-job` (`cron.on()` subscriptions still validate) |
| `httpModule()` | The `http`, `mcp` and `webhook` channels, `createHttpApp()` with every contributed route and authenticator, mounting every contributed channel with an `in` at `/channels/<name>`, the graceful shutdown, `serve()` on `HOST`:`PORT` |

The optional modules ship with the package they configure, on its `/module` subpath (`@chamvi/app` is an optional peer there, and the package's main entry never imports it), so install the feature package of each one you use. Each factory reads its variables **when it is called**, that is when the entry is imported, and exposes its instance at once (`.app`, `.manager`). Each module also **provides its instance on the engine** before it starts, so a tools factory injects it per execution with the package's `inject*Context(ctx)` (see [Context](/guide/tools#context-shared-instances-for-tools)); a channel a module contributes is reached with `ctx.channels.findOne(name)`:

<<< @/snippets/app-modules.ts#modules

| Factory | Entry | Contributes | Context |
|---|---|---|---|
| `githubModule()` | `@chamvi/github/module` | `.app` (`IGithubApp`), the `github` channel: signed deliveries at `/channels/github`, comments out | `injectGithubContext(ctx)`, `ctx.channels.findOne('github')` |
| `sandboxModule()` | `@chamvi/sandbox/module` | `.manager` (`IWorkspaceManager`), attached on start, closed after the engine drained | `injectSandboxContext(ctx)` |
| `openclawModule()` | `@chamvi/channel-openclaw/module` | the `openclawChannel()` named `openclaw` (out only) | `ctx.channels.findOne('openclaw')` |
| `uiModule()` | `@chamvi/ui/module` | the [dashboard](/guide/ui) at `<basePath>/ui` | |
| `authupModule()`, `oidcModule(options)` | `@chamvi/app/authup` | the `authup()` and `oidc()` authenticators, after the static tokens | |
| `consoleChannelModule({ name?, write? })` | `@chamvi/app` | the `consoleChannel()` named `console` (out only) | `ctx.channels.findOne('console')` |

Channel names are unique per app, so `openclawModule()` beside `openclawModule({ name: 'ops' })` contributes two channels (`ctx.channels.findOne('ops')`); two channels of one name fail the setup with `InvalidAgentDefinitionError`. `@chamvi/app/authup` stays in the app package, since `@chamvi/http` cannot depend on `@chamvi/app`.

With `CHAMVI_PUBLIC_URL` set, the GitHub and OpenClaw modules link approvals to the dashboard: `<CHAMVI_PUBLIC_URL><basePath>/ui/approvals?run=<runId>&approval=<approvalId>`, without a token. A factory missing a required variable throws `InvalidAgentDefinitionError` naming it; no message ever echoes a value.

## Setup contributes, onReady consumes

orkos sets every module up in dependency order, then calls every `onReady`. chamvi splits the work along that line:

- In **`setup`**, a module registers what it contributes on the container's collection tokens: `AppToken.HTTP_ROUTES`, `CHANNELS`, `AUTHENTICATORS` (with an `order`, lowest first), `LIFECYCLE_HOOKS` and `AGENT_CHECKS` (an `(agent) => void` that throws `InvalidAgentDefinitionError` for a folder agent the module could not serve, run before the agent is registered).
- In **`onReady`**, the consumers build: the engine module collects the channels, the http module the routes, the authenticators and the channels it mounts.

So a contribution never depends on module order. A module that resolves `ENGINE` or `SERVER` in its own `onReady` lists that module in `dependencies`. Nothing starts in `onReady`: the engine and the http module register start steps, which the app runs (the engine with its channels, then the `started` hooks and listening) only once every module's `onReady` ran, user modules included. So a configuration error any of them finds starts nothing: no queued run of the shared store executes on a replica that then exits 2.

## Start and stop

`app.start()` resolves once the server listens, so `/readyz` turns green only after everything runs:

1. config
2. store (and the migrations, advisory-locked, so every replica may run them)
3. every `onReady`: the engine is built with every contributed channel, the [agent folders](/guide/agent-folders) are loaded into it, the HTTP app is built, nothing runs yet
4. `engine.start()`: recovery, then every channel's `start()` (the cron schedule among them)
5. the purge timer and the agents dir watcher
6. `serve()` on `HOST`:`PORT`, listening last

`app.stop()` is memoized and also stops a start still setting up (which then never listens):

1. `/readyz` answers 503, then `CHAMVI_READINESS_DELAY_MS` (0)
2. the `stopping` hooks: the purge timer and the agents dir watcher stop
3. the app's closers (SSE streams, MCP waits)
4. `server.close()`
5. `engine.drain()`: every channel's `stop()` first, then up to `CHAMVI_DRAIN_TIMEOUT_MS` (30 s) for the runs
6. up to `CHAMVI_CLOSE_TIMEOUT_MS` (5 s) for the close, then `server.close(true)`
7. the workspace manager closes (with `sandboxModule`, up to 30 s)
8. the store's data source is destroyed

orkos swallows teardown errors; chamvi does not: every teardown error is logged, and `stop()` then rejects with `app_stop_failed` (the CLI exits 1). An app runs one lifecycle: a second `start()`, `runJob()` or `migrate()` rejects with `app_in_use`.

`runJob({ agent, subscription? })` builds config, store and engine (with the folder agents, loaded once), starts no channel and no HTTP, fires the cron subscription once through [`runJob()`](/guide/scheduler) and tears down. `migrate()` only migrates the store; it fails without `DATABASE_URL`.

## Writing a module

The module contract comes from the main entry of `@chamvi/app`: `AppToken`, `ModuleName`, `AppContext`, `ILifecycleHook`, the env readers and the orkos `IModule` and eldin `IContainer` types, so a module needs no direct orkos or eldin import. A module that shares an instance with tools provides it in the `engineCreated` hook and exports an `inject*` function next to it, keeping its key internal:

<<< @/snippets/app-module.ts#module

- **Hooks** (`LIFECYCLE_HOOKS`): `engineCreated(engine)` before `engine.start()` (the place for `engine.provide()`; a throwing hook, such as a second value for one key, is logged through `context.report()` and the app still starts), `started()` after `engine.start()` (channels started), before the server listens, `stopping()` first in the shutdown, before the drain stops the channels, `drained()` after the engine drained and before the store closes.
- **Failures:** orkos never tears down a module whose `setup` threw, so such a `setup` closes what it opened before rethrowing. A module whose `onReady` threw is torn down, so `teardown` tolerates state that `onReady` never built.
- **Stopping:** `AppToken.CONTEXT` holds the lifecycle's `signal`, aborted once `stop()` is called; `throwIfStopped(context)` before a long step keeps a stopped start from going on. `context.report(error)` logs an error and, during `stop()`, makes it reject.
- **Modes:** `AppToken.CONTEXT` holds the `mode`: `start` builds everything, `job` (`runJob`) config, store and engine, `migrate` only config and store. A module that resolves `ENGINE` in `onReady` returns early in `migrate` mode, as the sample does, or `chamvi migrate` fails.
- **Testing:** `createModuleHarness({ modules, env?, agents?, clock? })` from `@chamvi/app/testing` runs the real module lifecycle (setup, `onReady`, the start steps) of the modules you list, built-ins included, without `start()` and a port: `harness.container` resolves what a module contributed, `harness.reported` holds every `context.report()` call, `harness.stop()` tears down. The feature packages test their own modules with it.
- **Dependencies:** `dependencies` name modules the app registers (`{ name, optional: true }` for one it may lack). A missing one, a cycle or a version mismatch throws `InvalidAgentDefinitionError` from `start`, `runJob` and `migrate` before any module set up (the CLI exits 2).

## Testing an app

`start({ env })` takes the environment instead of `process.env` for the built-in modules, and `models` replaces a provider, so an app runs in a test without keys or network:

<<< @/snippets/app-testing.ts#testing

The optional module factories read `options.env ?? process.env` when they are called, never `start({ env })`: configure them in a test through their own `env` option, for example `githubModule({ env: { GITHUB_APP_ID: '1', ... } })`.

## Read next

- [Pick a Model](/guide/models): the default model, providers, gateways and `chamvi doctor`
- [`@chamvi/app` reference](/reference/app): every factory, option, token and variable
- [`@chamvi/cli` reference](/reference/cli): commands, exit codes, signals and `dev`
- [Deployment](/deployment/): the image, chart and template built on the CLI
