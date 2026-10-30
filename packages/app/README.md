<p align="center">
    <img src="https://raw.githubusercontent.com/chamvi/chamvi/master/.github/assets/logo.svg" alt="@chamvi/app" width="128" height="128" />
</p>

<h1 align="center">@chamvi/app</h1>

<p align="center">
    <b>Boots chamvi agents as an app: config, store, engine, channels and HTTP as orkos modules.</b><br>
    An agent repository is one <code>createApp()</code> default export;<br>
    <code>chamvi start | run-job | migrate</code> (<a href="https://www.npmjs.com/package/@chamvi/cli">@chamvi/cli</a>) runs it.
</p>

<p align="center">
    <a href="https://www.npmjs.com/package/@chamvi/app"><img src="https://img.shields.io/npm/v/@chamvi/app" alt="npm version" /></a>
    <a href="https://github.com/chamvi/chamvi/actions/workflows/ci.yml"><img src="https://github.com/chamvi/chamvi/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
    <a href="https://github.com/chamvi/chamvi/blob/master/packages/app/LICENSE"><img src="https://img.shields.io/npm/l/@chamvi/app" alt="License" /></a>
</p>

---

**Table of Contents**
- [Installation](#installation)
- [Usage](#usage)
- [Approved local skills](#approved-local-skills)
- [Environment](#environment)
- [Modules](#modules)
- [Lifecycle](#lifecycle)
- [Writing a module](#writing-a-module)
- [Models](#models)
- [License](#license)

## Installation

```bash
npm install @chamvi/app @chamvi/cli ai @ai-sdk/anthropic typeorm pg
```

ESM only, Node.js `>=22`. `ai`, `typeorm` and `pg` are peer dependencies; the provider packages (`@ai-sdk/anthropic`, `@ai-sdk/openai`, `@ai-sdk/openai-compatible`, `@ai-sdk/google`, `@ai-sdk/mistral`, `@ai-sdk/xai`) are optional peers: install the ones you use. The optional modules ship with the package they configure (`npm install @chamvi/github` for `@chamvi/github/module`, ...), which peers on `@chamvi/app`.

The main entry re-exports `@chamvi/core` and the common part of `@chamvi/http` (`agentPermission`, `Permission`, the `Authenticator`, `Principal`, `HttpRoute*` and `StaticToken` types), so an agent repository imports one package.

## Usage

`src/index.ts` exports the app as its default export:

```typescript
import {
    consoleChannelModule,
    createApp,
    cron,
    defineAgent,
    http,
} from '@chamvi/app';

const triage = defineAgent({
    name: 'triage',
    // no model: the app's default below
    instructions: 'Triage the reported issue: label it and summarize the next step.',
    channels: [
        // POST /agents/triage/runs, the UI and MCP
        http.on(),
        // every 30 minutes, Berlin time
        cron.on('*/30 * * * *', { timezone: 'Europe/Berlin' }),
    ],
});

// chamvi start | run-job | migrate load this default export
export default createApp({
    // the default model; CHAMVI_MODEL overrides it, ANTHROPIC_API_KEY configures the provider
    model: 'anthropic/claude-sonnet-5-5',
    agents: [triage],
    // tools write to it with ctx.channels.findOneOrFail('console').emit(...)
    modules: [consoleChannelModule()],
});
```

`createApp()` is synchronous and side-effect free: no env read, no I/O. Everything happens in the lifecycle methods, which the CLI calls:

| Method | CLI | Does |
|---|---|---|
| `start({ env?, dev? })` | `chamvi start` | sets every module up, resolves once the HTTP server listens |
| `stop()` | first SIGTERM or SIGINT | memoized; aborts a start still setting up, tears every module down |
| `runJob({ agent, subscription?, env? })` | `chamvi run-job <agent> [subscription]` | fires one cron subscription once and waits for its run (no channel started, no HTTP); `{ runId?, status, exitCode }` |
| `migrate({ env? })` | `chamvi migrate` | migrates the store (`DATABASE_URL` required) and closes it |
| `check({ env?, dev? })` | `chamvi start --check` | the start path up to its start steps (config, store connection, model settings, every module, the agent folders' load and checks), then the teardown; writes nothing to the store, starts nothing, runs nothing (of the lifecycle hooks only `engineCreated` and `drained` run); `{ issues }` (the agent folders' load issues) |

`env` defaults to `process.env`. An app runs one lifecycle (`check` counts as one); a second one rejects with `app_in_use`. `isApp(value)` recognizes an app, also one of another installed copy of the package.

## Approved local skills

Use `createApp({ skills: [common] })` for additive defaults on every code and folder agent. Each `defineAgent({ skills: [...] })` adds scoped extras. The engine appends metadata and provides `load_skill` automatically; user tools named `load_skill` are rejected. This example reuses the `triage` agent from Usage above.

```ts
import { createApp } from '@chamvi/app';
import { gitSkills } from '@chamvi/skills';

const common = gitSkills({
    source: 'https://github.com/tada5hi/skills.git',
    revision: '0123456789abcdef0123456789abcdef01234567', // replace with reviewed commit
    directory: '/tmp/chamvi-skills/common',
    approved: [{
        name: 'ponytail',
        version: '1.0.0',
        hash: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef', // reviewed digest
    }],
});

export default createApp({
    model: 'anthropic/claude-sonnet-5-5',
    agents: [triage],
    skills: [common],
});
```

Replace illustrative pins after independently reviewing all bundle text. `gitSkills` is a pure factory from the skills main entry. Startup prepares globals and code-agent sources before `engineCreated`; folder-agent extras prepare afterward, before channels, HTTP or model work. Verification failures abort startup; failed skill hot reloads retain the old agent, record an agent issue and retry with bounded exponential backoff. Folder edits reset the delay; successful recovery clears the issue. `app.check()` validates static headers without loading providers or installing sources, so remote verification is deferred. Migrate skips preparation.

For already deployed files, `loadSkillBundle(descriptor)` returns a ready snapshot. `hashSkillBundle(directory)` is a separate review aid, never approval. The manual `loadSkillBundles(approved)` catalog remains supported: append its instructions and compose its tools explicitly, checking for a `load_skill` collision. The skill types, catalogs and adapters (`defineSkill`, `defineSkillSource`) also belong to `@chamvi/skills`, with no compatibility app exports. Factories already carry their runtime; no module registration is needed. Core/app accept the generic `SkillInput` contract and have no dependency on skills.

Runtime Git sources require `@chamvi/skills`, Node >=22.20, Git (absent from the base Node 24 image), writable managed directories/tmp, source credentials/network and startup probe time for cloning and verification. Stop joins cleanup and may wait for a noncancelable clone. Prebuilt snapshots need readable runtime assets only.

Snapshots are immutable. Saved load results retain original checkpoint bytes; pending/future loads after a pin upgrade use the current verified snapshot. Global changes do not change folder hashes: finish or cancel unsettled runs before upgrades when mixed-version disclosure is unacceptable. Tracked agent extra-pin edits use existing revision cancellation. Skills grant no tools, script execution, subagents or permissions. See [Approved Skills](https://chamvi.dev/guide/skills) and the [skills API](https://chamvi.dev/reference/skills).

## Environment

Every variable is read once per lifecycle. An empty string counts as unset, integers are digits only (every `*_MS` variable at most `TIMER_MAX_MS`, Node's timer limit), booleans `true`, `false`, `1` or `0`. A malformed value throws `InvalidAgentDefinitionError` naming the variable, never echoing its value.

| Variable | Read by | Value | Default |
|---|---|---|---|
| `PORT` | http | int 1..65535 | `3000` |
| `HOST` | http | string | `0.0.0.0` |
| `CHAMVI_BASE_PATH` | http | empty or `^(?:\/[a-z0-9._~-]+)+$` | `''` (health at `/healthz`, UI at `/ui`) |
| `CHAMVI_PUBLIC_URL` | ui, channels | absolute URL | unset; set it for approval links (`<url><basePath>/ui/approvals?run=<runId>&approval=<approvalId>`) |
| `CHAMVI_LOG_LEVEL` | config | `error`, `warn`, `info`, `debug` | `info` |
| `DATABASE_URL` | store | `postgres://...` | unset: `MemoryStore` (warned outside `--dev`); required for `migrate` and any multi-replica or CronJob deployment |
| `CHAMVI_MIGRATE` | store | bool | `true` (`start` and `run-job` migrate, advisory-locked) |
| `CHAMVI_PURGE_INTERVAL_MS` | store | int, `0` disables | `3600000` (only with `TypeormStore`) |
| `CHAMVI_MAX_CONCURRENT_RUNS` | engine | int >= 1 | `4` |
| `CHAMVI_SCHEDULER` | scheduler | bool | `true`; `false` starts no in-process cron (CronJob mode; `cron.on()` subscriptions still validate) |
| `CHAMVI_READINESS_DELAY_MS` | http shutdown | int | `0` |
| `CHAMVI_DRAIN_TIMEOUT_MS` | http shutdown | int | `30000` (`--dev` 5000) |
| `CHAMVI_CLOSE_TIMEOUT_MS` | http shutdown | int | `5000` |
| `CHAMVI_TOKENS` | static tokens | JSON `[{ "value", "id", "permissions": [] }]`, `value` at least 16 characters and unique | unset (`--dev`: one random `*` token, warned); required when no other authenticator is configured |
| `CHAMVI_MODEL` | engine | `'<provider>/<model id>'` | the config file's `model`, else `createApp({ model })`; required when an agent has no model of its own |
| `CHAMVI_CONFIG_FILE` | engine | path of a JSON file | unset: `./chamvi.json` when it exists |
| `CHAMVI_PROVIDER_<NAME>_TYPE`, `_API_KEY`, `_BASE_URL`, `_HEADER_<HEADER>` | engine | type, secret, http(s) URL, secret | unset; each wins over the config file and code for provider `<name>` (see [Models](#models)) |
| `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`, `MISTRAL_API_KEY`, `XAI_API_KEY` | engine | string | unset; each creates the implicit provider of its type (`ANTHROPIC_BASE_URL`, `OPENAI_BASE_URL` set its base URL) unless a source declares that name |
| `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY` (PEM, literal `\n` allowed), `GITHUB_WEBHOOK_SECRET` (comma-separated for rotation) | `githubModule` | string | required without options |
| `GITHUB_INSTALLATION_ID`, `GITHUB_APP_SLUG`, `GITHUB_API_URL` | `githubModule` | int, slug, https URL | unset |
| `OPENCLAW_BASE_URL`, `OPENCLAW_HOOKS_TOKEN`, `OPENCLAW_CHANNEL`, `OPENCLAW_TO` | `openclawModule` | URL, string, string, string | required without options |
| `OPENCLAW_HOOKS_PATH`, `OPENCLAW_AGENT_ID`, `OPENCLAW_ACCOUNT_ID` | `openclawModule` | string | `/hooks`, unset, unset |
| `AUTHUP_URL`, `AUTHUP_CLIENT_ID`, `AUTHUP_CLIENT_SECRET` | `authupModule` | URL, string, string | required without a `verifier` |
| `CHAMVI_UI_AUTHUP_CLIENT_ID`, `CHAMVI_UI_AUTHUP_REALM_ID` | `uiModule` | string | unset (token login only); the authup login then needs `AUTHUP_URL` |
| `CHAMVI_SANDBOX_PROVIDER` | `sandboxModule` | `local`, `docker`, `kubernetes` | the `provider` option, else `local` |
| `CHAMVI_SANDBOX_NAMESPACE` | `sandboxModule` | string | required for `kubernetes` |
| `CHAMVI_SANDBOX_IMAGE` | `sandboxModule` | image ref | `ghcr.io/chamvi/sandbox-dev:trixie` |
| `CHAMVI_DEPLOYMENT` | `sandboxModule` | label value | the `deployment` option, else `default` |

The built-in modules read the lifecycle's `env` (`start({ env })`). The optional module factories read `options.env ?? process.env` **when they are called**, that is when the entry is imported, never `start({ env })`; a test configures them through their `env` option:

```ts
githubModule({ env: { GITHUB_APP_ID: '1', GITHUB_APP_PRIVATE_KEY: pem, GITHUB_WEBHOOK_SECRET: 'secret' } });
```

## HTTP intake and execution limits

`CHAMVI_MAX_CONCURRENT_RUNS` limits each engine instance (default `4`). Set `concurrencyMaxRuns` on an agent and/or its `channel.on(...)` subscription to add nested ceilings across replicas sharing a store. Positive safe integers cap running runs; `false` or omission adds no ceiling at that level and never bypasses a parent cap. Waiting approvals release numerical capacity but retain concurrency-key exclusion. Excess runs stay durably queued, with no storage bound.

Configure mounted channel HTTP policies separately through `httpModule({ channelRateLimits: { github: { max: 3000, windowMs: 60000 } } })`, or use `github: false` to disable only that channel's request limiter. Omitted channels share the general REST bucket; signatures and body limits remain enforced. `trustProxy` must identify only known ingress sources; ingress configuration does not set it automatically. These are TypeScript options, not new environment variables. A `202` acknowledges stored acceptance, not execution completion. GitHub does not automatically redeliver failed webhook deliveries, so monitor and reconcile them. See [GitHub intake](https://chamvi.dev/deployment/github-app#bursts-and-http-intake) and [concurrency](https://chamvi.dev/guide/concurrency).

## Modules

Modules are orkos `IModule`s on an eldin container. The built-in ones are always there; listing a module with a built-in's name (`ModuleName`) in `modules` replaces it. Two modules of one name, a built-in's included, throw `InvalidAgentDefinitionError`.

| Module | Name | Entry | Does |
|---|---|---|---|
| `configModule()` | `chamvi:config` | `@chamvi/app` | reads the config, registers `CONFIG`, `CLOCK`, `LOGGER` |
| `storeModule({ url?, store?, dataSource? })` | `chamvi:store` | `@chamvi/app` | `TypeormStore` over `DATABASE_URL` (migrated), else `MemoryStore`; the purge timer |
| `staticTokensModule({ tokens? })` | `chamvi:static-tokens` | `@chamvi/app` | the static-token authenticator from `CHAMVI_TOKENS` |
| `engineModule({ owner?, claimTtlMs? })` | `chamvi:engine` | `@chamvi/app` | checks the model strings, builds the `Engine` with every contributed channel (`CHANNELS`) and starts it (which starts the channels) |
| `schedulerModule({ owner?, lockTtlMs? })` | `chamvi:scheduler` | `@chamvi/app` | the `cron` channel (`cronChannel()` of `@chamvi/channel-cron`; in start mode it fires only with `CHAMVI_SCHEDULER`) |
| `httpModule()` | `chamvi:http` | `@chamvi/app` | the `http`, `mcp` and `webhook` channels (webhooks authenticate with the app's authenticators), `createHttpApp()` mounting every contributed channel with an `in` at `/channels/<name>`, the graceful shutdown, listens last |
| `consoleChannelModule({ name?, write? })` | `chamvi:console` (`chamvi:console:<name>` with a name) | `@chamvi/app` | `consoleChannel()` (name `console`, out only) |
| `githubModule()` | `chamvi:github` | `@chamvi/github/module` | the GitHub App and its channel (`github`: signed deliveries at `/channels/github`, comments out); `injectGithubContext(ctx)` and `ctx.channels.findOne('github')` for tools |
| `sandboxModule({ provider?, ... })` | `chamvi:sandbox` | `@chamvi/sandbox/module` | the run-scoped workspace manager (`.manager`, `injectSandboxContext(ctx)`), closed after the engine drained |
| `openclawModule()` | `chamvi:channel:<name>` | `@chamvi/channel-openclaw/module` | `openclawChannel()` (name `openclaw`, out only), `ctx.channels.findOne('openclaw')` |
| `uiModule()` | `chamvi:ui` | `@chamvi/ui/module` | the dashboard at `<basePath>/ui` |
| `authupModule()` | `chamvi:authup` | `@chamvi/app/authup` | the authup authenticator, after static tokens |
| `oidcModule(options)` | `chamvi:oidc` | `@chamvi/app/authup` | the `oidc()` authenticator, after authup (no env form) |

## Lifecycle

`start` sets the modules up in this order and listens last, so `/readyz` turns green only once everything runs:

1. config
2. store (and the migrations)
3. every `onReady` (user modules included): the engine (with every contributed channel) and the HTTP app are built, nothing runs yet (a configuration error starts nothing)
4. `engine.start()`: recovery, then every channel's `start()` (the cron schedule among them)
5. the purge timer
6. `serve()` on `HOST`:`PORT`

`stop()` (also during a start still setting up, which then never listens):

1. `/readyz` answers 503, then `CHAMVI_READINESS_DELAY_MS`
2. the purge timer stops
3. the app's closers (SSE streams, MCP waits)
4. `server.close()`
5. `engine.drain()`: every channel's `stop()` first, then up to `CHAMVI_DRAIN_TIMEOUT_MS` for the runs
6. up to `CHAMVI_CLOSE_TIMEOUT_MS` for the close, then `server.close(true)`
7. the workspace manager closes (with `sandboxModule`)
8. the store's data source is destroyed

`stop()` rejects with `app_stop_failed` when anything failed meanwhile; the CLI then exits 1.

## Writing a module

A module contributes in `setup` and consumes in `onReady`, after every module's `setup` ran:

```ts
import type { IContainer, IModule } from '@chamvi/app';
import { AppToken, ModuleName } from '@chamvi/app';

export function auditModule(): IModule {
    return {
        name: 'audit',
        // onReady resolves ENGINE below, so the engine module comes first
        dependencies: [ModuleName.ENGINE],
        async setup(container: IContainer) {
            container.registerMany(AppToken.HTTP_ROUTES, {
                useValue: {
                    method: 'GET',
                    path: '/audit',
                    handler: async () => ({ status: 200, body: { ok: true } }),
                },
            });
        },
        async onReady(container: IContainer) {
            // migrate builds config and store only: no ENGINE to resolve
            if (container.resolve(AppToken.CONTEXT).mode === 'migrate') {
                return;
            }
            const logger = container.resolve(AppToken.LOGGER);
            container.resolve(AppToken.ENGINE).on('run.updated', ({ run }) => {
                logger.info('run updated', { run: run.id, status: run.status });
            });
        },
    };
}
```

Everything a module needs comes from `@chamvi/app`: `AppToken`, `ModuleName`, `ILifecycleHook`, `AppContext`, the env readers (`envString`, `envUrl`, ...), `approvalUrlOf` and the orkos `IModule` and eldin `IContainer` types.

A module that builds an instance tools need provides it on the engine in `engineCreated`, through a context key of its package; tools read it with `inject(ctx, key)`, so they need no closure over the module:

```ts
import type { IContainer, IModule } from '@chamvi/app';
import { AppToken, defineContextKey, defineTool, inject } from '@chamvi/app';

type Audit = { write(entry: string): void };

const AUDIT = defineContextKey<Audit>('audit');

export function auditLogModule(audit: Audit): IModule {
    return {
        name: 'audit-log',
        async setup(container: IContainer) {
            container.registerMany(AppToken.LIFECYCLE_HOOKS, {
                useValue: { name: 'audit-log', engineCreated: (engine) => engine.provide(AUDIT, audit) },
            });
        },
    };
}

// in an agent: tools: (ctx) => { const audit = inject(ctx, AUDIT); return { ... }; }
```

Injecting in the `tools` factory fails a run before any model call when the module is missing (`context_not_provided`); in `execute` it is a tool error the model sees. A module spec runs the real module lifecycle without a port through `@chamvi/app/testing`. The harness sets up only the modules it is given, so a module whose hook needs the engine lists the built-ins it builds on:

```ts
import { configModule, engineModule, storeModule } from '@chamvi/app';
import { createModuleHarness } from '@chamvi/app/testing';

const harness = await createModuleHarness({
    env: {},
    agents: [agent],
    modules: [configModule(), storeModule(), engineModule(), auditLogModule(audit)],
});
// harness.container, harness.context, harness.reported (what context.report() got)
await harness.stop();
```

- **Tokens** (`AppToken`): `CONTEXT`, `CONFIG`, `LOGGER`, `CLOCK`, `STORE`, `DATA_SOURCE`, `ENGINE`, `SHUTDOWN` and `SERVER` hold one value; `HTTP_ROUTES`, `AUTHENTICATORS` (`{ name, order, authenticator }`, lowest `order` first, `AUTHENTICATOR_ORDER`), `CHANNELS` (every `IChannel` the engine registers; names unique, those with an `in` are mounted at `/channels/<name>`), `LIFECYCLE_HOOKS` and `AGENT_CHECKS` are collections (`registerMany(token, { useValue })` in `setup`, `resolveAll` in `onReady`).
- **Order**: contributions need none, since every consumer builds in `onReady`. A module that resolves `ENGINE` or `SERVER` in `onReady` lists that module in `dependencies`; a dependency the app does not register, a cycle or a version mismatch is an `InvalidAgentDefinitionError` before any module set up.
- **Modes**: `CONTEXT.mode` is `start` (everything), `job` (config, store, engine) or `migrate` (config and store only), so a module resolving `ENGINE` in `onReady` returns early in `migrate`.
- **Hooks** (`LIFECYCLE_HOOKS`, `ILifecycleHook`): `engineCreated(engine)` before `engine.start()`, `started()` after `engine.start()` (channels started), before the server listens, `stopping()` first in the shutdown, before the drain stops the channels, `drained()` after the engine drained, before the store closes.
- **Failures**: orkos never tears down a module whose `setup` threw, so a `setup` that throws closes what it opened first. A module whose `onReady` threw is torn down, so `teardown` tolerates state `onReady` never built.
- **Stopping**: `CONTEXT.signal` aborts once `stop()` is called; `throwIfStopped(context)` before a long step keeps a stopped start from going on. `context.report(error)` logs, and during `stop()` makes it reject.

## Models

An agent's `model` is optional: without one it takes the app's default. A model string `'<provider>/<model id>'` (split at the first `/`, so `router/cc/claude-opus-4-6` is provider `router`) resolves through the providers the app declares, never through the Vercel AI Gateway or the AI SDK's global provider; a `LanguageModel` object is used as is.

```bash
CHAMVI_MODEL=anthropic/claude-sonnet-5-5            # the default model
ANTHROPIC_API_KEY=...                               # the implicit provider "anthropic"
CHAMVI_PROVIDER_ROUTER_TYPE=openai-compatible       # a named provider: 9router, OmniRoute, Ollama, vLLM, LiteLLM, OpenRouter
CHAMVI_PROVIDER_ROUTER_BASE_URL=http://9router:20128/v1
CHAMVI_PROVIDER_ROUTER_API_KEY=...
```

The same settings come from `createApp({ model, providers })` and a `chamvi.json` file (`CHAMVI_CONFIG_FILE`); env wins over the file, the file over code, per provider and field, and `createApp({ models })` (AI SDK provider objects by id) wins over all for its ids. An agent with no model and no default, or a string naming a provider that is not configured, fails `start` and `runJob` with `InvalidAgentDefinitionError` naming the variable to set (the CLI exits 2); a folder agent becomes a load issue instead. `chamvi start --check` (`app.check()`) runs the same checks against the real configuration and store, without starting anything or writing to the store.

See [Pick a Model](https://chamvi.dev/guide/models) for providers, secrets, gateways, the config file and the precedence rules.

## License

Published under [Apache License 2.0](./LICENSE).

Agent `instructions` also accept an ordered readonly array of native system/user/assistant messages. `AgentInstructions`, `SystemModelMessage`, `UserModelMessage`, `AssistantModelMessage` and the native content types are exported by `@chamvi/core` and re-exported by this package. Strings remain compatible. See the [typed instructions example](https://chamvi.dev/guide/agents#instructions) for role-specific content, provider options and transient checkpoint behavior.
