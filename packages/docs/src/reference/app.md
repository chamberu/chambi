# @chamvi/app

Boots chamvi agents as an app. The public API of `packages/app/src/index.ts` and its subpath entries; see [Apps & Modules](/guide/app) for the concepts.

```bash
npm install @chamvi/app ai typeorm pg
```

`ai`, `typeorm` and `pg` are peer dependencies. The provider packages (`@ai-sdk/anthropic`, `@ai-sdk/openai`, `@ai-sdk/openai-compatible`, `@ai-sdk/google`, `@ai-sdk/mistral`, `@ai-sdk/xai`) and the `@authup/*` packages behind `@chamvi/app/authup` are optional peers. The other optional modules ship with their feature packages (`@chamvi/github/module`, ...), so `@chamvi/app` depends on none of them. The main entry re-exports `@chamvi/core` and `agentPermission`, `Permission` and the `Authenticator`, `Principal`, `HttpRoute`, `HttpRouteContext`, `HttpRouteRequest`, `HttpRouteResult` and `StaticToken` types of `@chamvi/http`.

| Entry | Exports | Needs |
|---|---|---|
| `@chamvi/app` | `createApp`, `isApp`, the built-in modules, the module contract (tokens, `ModuleName`, `AppContext`, `ILifecycleHook`, the `IModule` and `IContainer` types), env readers, `approvalUrlOf`, `readConfig`, `createLogger`, `BUILTIN_PROVIDERS`, the model and check types (`ProviderConfig`, `SecretValue`, `AppCheckOptions`, `AppCheckResult`, ...) | |
| `@chamvi/app/authup` | `authupModule`, `oidcModule` | `@authup/server-adapter-kit`, `@authup/core-http-kit` |
| `@chamvi/app/testing` | `buildModuleHarness`, `createModuleHarness` | |

## createApp

```ts
function createApp(options: AppOptions): IApp;
function isApp(value: unknown): value is IApp;

const APP_BRAND: unique symbol; // Symbol.for('chamvi.app')
```

Synchronous and side-effect free. `agents` may be omitted or empty: the agents can come from an [agents folder](/guide/agent-folders), and an app with no agent at all still starts (a warning); `app.agents` holds only the code agents, the live set is `engine.listAgents()`. Throws `InvalidAgentDefinitionError` for options that are no object or whose `agents` is no array, a module list entry that is no `IModule` and for two modules of one name (a built-in's name included: list one module to replace a built-in). `isApp` checks the brand, so an app of another installed copy matches.

<<< ../../../app/src/app/types.ts{ts}

| Method | Builds | Rejects with |
|---|---|---|
| `start` | config, store (migrated unless `CHAMVI_MIGRATE=false`), engine with every contributed channel (the cron channel fires unless `CHAMVI_SCHEDULER=false`), http; starts the engine (and so its channels) once every module built, resolves once listening | the setup error (a module graph error as `InvalidAgentDefinitionError`); `app_stopped` when `stop()` interrupted the setup (the setup's own error is logged); `app_in_use` for a second lifecycle or after `stop()` |
| `stop` | the shutdown sequence (see [Start and stop](/guide/app#start-and-stop)); memoized, waits for a setup in flight | `app_stop_failed` when a teardown failed (each failure is logged) |
| `runJob` | config, store (migrated), engine (not started: `@chamvi/channel-cron` `runJob` starts it without channels, ticks and drains it); no http | the job's error; `app_in_use` |
| `migrate` | config, store (`migrateStore`), store teardown | `InvalidAgentDefinitionError` without `DATABASE_URL`; `app_in_use` |
| `check` | the `start` path up to its start steps (`context.check`, mode `start`): config, store (connected, never migrated: pending migrations reject with `store_not_migrated` unless `CHAMVI_MIGRATE` is on), the model settings, every module's setup and onReady, the agent folders loaded and checked (`engine.checkAgent()`, never `putAgent`), then the teardown. No engine or channel start, no server, no run, no store write (no migration, revision marker, cancel or lock). Resolves `{ issues }`, the agent folders' load issues | the setup error (`invalid_agent_definition` for a configuration error), the store's (`store_not_migrated`, a connection error); `app_in_use`: it is the app's one lifecycle |

`runJob` resolves `exitCode: 0` for a `completed`, `waiting`, `skipped`, queued-behind-an-approval or signal-interrupted run, `1` for `failed` or `cancelled`.

## Errors

`ChamviError` codes in `APP_ERROR_CODE`:

| Code | When |
|---|---|
| `app_stopped` | The lifecycle's abort reason once `stop()` was called; a start stopped while setting up rejects with it |
| `app_in_use` | A second `start`, `runJob` or `migrate` on the same app |
| `app_stop_failed` | `stop()` (or a job's teardown) after one or more teardown errors, each logged |

Configuration errors (a malformed or missing variable, a model string naming a provider that is not configured, an agent with no model and no default, a duplicate module name) are core `InvalidAgentDefinitionError`s; they name the variable and never echo its value.

## Environment

Read by `readConfig(env, { mode, dev })` once per lifecycle; the optional module factories read their own variables when they are called. Empty string is unset, integers are `/^\d+$/` (every `*_MS` variable at most `TIMER_MAX_MS`, 2147483647, since a larger Node timer fires after 1 ms), booleans `true`, `false`, `1` or `0`.

| Variable | Module | Type | Default | Required when |
|---|---|---|---|---|
| `PORT` | http | int 1..65535 | `3000` | never |
| `HOST` | http | string | `0.0.0.0` | never |
| `CHAMVI_BASE_PATH` | http | empty or `^(?:\/[a-z0-9._~-]+)+$` | `''` (health at `/healthz`, UI at `/ui`) | never |
| `CHAMVI_PUBLIC_URL` | http, ui, channels | absolute URL | unset | an approval link is wanted |
| `CHAMVI_LOG_LEVEL` | config | `error`, `warn`, `info`, `debug` | `info` | never |
| `DATABASE_URL` | store | `postgres://...` | unset: `createMemoryStore()` (warned outside dev) | `migrate`; any multi-replica or CronJob deployment |
| `CHAMVI_MIGRATE` | store | bool | `true` | never |
| `CHAMVI_PURGE_INTERVAL_MS` | store | int, `0` disables | `3600000` (for purgeable capability repositories, on `engine.clock`) | never |
| `CHAMVI_MAX_CONCURRENT_RUNS` | engine | int >= 1 | `4` | never |
| `CHAMVI_SCHEDULER` | scheduler | bool | `true`; `false` starts no in-process cron (CronJob mode; `cron.on()` subscriptions still validate) | never |
| `CHAMVI_AGENTS_DIR` | agents | path of a directory, relative to the working directory | unset: `./agents` when it is a directory, else no [agent folders](/guide/agent-folders) | |
| `CHAMVI_AGENTS_POLL_MS` | agents | int 1..`TIMER_MAX_MS` | `5000` (`DEFAULT_AGENTS_POLL_MS`) | never |
| `CHAMVI_READINESS_DELAY_MS` | http shutdown | int | `0` | never |
| `CHAMVI_DRAIN_TIMEOUT_MS` | http shutdown | int | `30000` (dev 5000) | never |
| `CHAMVI_CLOSE_TIMEOUT_MS` | http shutdown | int | `5000` | never |
| `CHAMVI_FORCE_EXIT_MS` | cli | int | `90000` (dev 15000) | never |
| `CHAMVI_TOKENS` | static tokens | JSON `[{ "value", "id", "permissions": [] }]`, `value` at least 16 characters and unique | unset (dev: one random `*` token, warned) | no other authenticator is configured, outside dev |
| `AUTHUP_URL`, `AUTHUP_CLIENT_ID`, `AUTHUP_CLIENT_SECRET` | `authupModule` | URL, string, string | unset | `authupModule()` without options |
| `CHAMVI_UI_AUTHUP_CLIENT_ID`, `CHAMVI_UI_AUTHUP_REALM_ID` | `uiModule` | string | unset (token login only) | the dashboard signs in through authup (URL from `AUTHUP_URL`) |
| `CHAMVI_MODEL` | engine | `'<provider>/<model id>'` | the config file's `model`, else `createApp({ model })` | an agent has no model of its own |
| `CHAMVI_CONFIG_FILE` | engine | path of a JSON file, relative to the working directory | unset: `./chamvi.json` when it exists | never |
| `CHAMVI_PROVIDER_<NAME>_TYPE`, `_API_KEY`, `_BASE_URL`, `_HEADER_<HEADER>` | engine | type, secret, absolute http(s) URL, secret | unset; each field wins over the config file and code for provider `<name>` (upper snake case: `TEAM_A` is `team-a`) | `_TYPE` when no other source declares `<name>`; `_API_KEY` for every type but `openai-compatible` ([providers](/guide/models#providers)) |
| `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `GOOGLE_GENERATIVE_AI_API_KEY`, `MISTRAL_API_KEY`, `XAI_API_KEY` | engine | string | unset | a model string names that implicit provider and nothing declares it; `ANTHROPIC_BASE_URL`, `OPENAI_BASE_URL` set its base URL ([implicit providers](/guide/models#implicit-providers)) |
| `GITHUB_APP_ID`, `GITHUB_APP_PRIVATE_KEY` (PEM, literal `\n` allowed), `GITHUB_WEBHOOK_SECRET` (comma-separated for rotation) | `githubModule` | string | none | `githubModule()` without options |
| `GITHUB_INSTALLATION_ID`, `GITHUB_APP_SLUG`, `GITHUB_API_URL` | `githubModule` | int, slug, https URL | unset | never |
| `OPENCLAW_BASE_URL`, `OPENCLAW_HOOKS_TOKEN`, `OPENCLAW_CHANNEL`, `OPENCLAW_TO` | `openclawModule` | URL, string, string, string | none | `openclawModule()` without options |
| `OPENCLAW_HOOKS_PATH`, `OPENCLAW_AGENT_ID`, `OPENCLAW_ACCOUNT_ID` | `openclawModule` | string | `/hooks`, unset, unset | never |
| `CHAMVI_SANDBOX_PROVIDER` | `sandboxModule` | `local`, `docker`, `kubernetes` | the `provider` option, else `local` | never |
| `CHAMVI_SANDBOX_NAMESPACE` | `sandboxModule` | string | none | provider `kubernetes` |
| `CHAMVI_SANDBOX_IMAGE` | `sandboxModule` | image ref | `ghcr.io/chamvi/sandbox-dev:trixie` | never |
| `CHAMVI_SANDBOX_IMAGES` | `sandboxModule` | comma list of image refs | none (also a list without an entry): `create_workspace` offers no `image` | never |
| `CHAMVI_DEPLOYMENT` | `sandboxModule` | label value (at most 63 letters, digits, `-`, `_`, `.`) | the `deployment` option, else `default` | several apps share one Docker host or namespace (one value per app); only with a value are the workspaces of runs the store does not hold collected |

```ts
function readConfig(env: Env, options: ReadConfigOptions): AppConfig;
function approvalUrlOf(config: AppConfig): ((ref: ApprovalRef) => string) | undefined; // needs CHAMVI_PUBLIC_URL
```

The env readers modules build on, each throwing `InvalidAgentDefinitionError` that names the variable:

```ts
function envString(env: Env, name: string, options?: EnvStringOptions): string | undefined;
function envInteger(env: Env, name: string, options?: EnvIntegerOptions): number | undefined;
function envBoolean(env: Env, name: string, options?: EnvReadOptions<boolean>): boolean | undefined;
function envUrl(env: Env, name: string, options?: EnvUrlOptions): string | undefined;
function envList(env: Env, name: string, options?: EnvReadOptions<string[]>): string[] | undefined; // comma-separated
function envJson(env: Env, name: string, options?: EnvJsonOptions): unknown;
function envOneOf<T extends string>(env: Env, name: string, values: readonly T[], options?: EnvReadOptions<T>): T | undefined;
```

With `required: true` or a `default` the overloads return a defined value.

<<< ../../../app/src/env/types.ts{ts}

## HTTP intake and execution ceilings

`httpModule({ channelRateLimits, trustProxy })` forwards the [channel request policies](/reference/http#channel-http-request-limits) to `createHttpApp()`. Configure a mounted channel by its exact name, with `{ max, windowMs? }` for a separate per-client bucket or `false` to disable only that channel's intake limiter. No environment variable is added for this setting. Trust only known proxy sources.

`CHAMVI_MAX_CONCURRENT_RUNS` is the local engine ceiling. Agent and subscription `concurrencyMaxRuns?: number | false` add nested shared-store ceilings; see [Concurrency](/guide/concurrency#shared-agent-and-subscription-ceilings).

## Built-in modules

```ts
function configModule(options?: ConfigModuleOptions): IModule;            // 'chamvi:config'
function storeModule(options?: StoreModuleOptions): IModule;              // 'chamvi:store'
function staticTokensModule(options?: StaticTokensModuleOptions): IModule; // 'chamvi:static-tokens'
function engineModule(options?: EngineModuleOptions): IModule;            // 'chamvi:engine'
function agentsModule(): IModule;                                         // 'chamvi:agents'
function schedulerModule(options?: SchedulerModuleOptions): IModule;      // 'chamvi:scheduler', the cron channel
function httpModule(options?: HttpModuleOptions): IModule;                // 'chamvi:http', the http, mcp and webhook channels
function consoleChannelModule(options?: ConsoleChannelModuleOptions): IModule; // 'chamvi:console' ('chamvi:console:<name>' with a name)
```

Listing one of them in `createApp({ modules })` replaces the default instance. `engineModule()` reads the [model settings](/guide/models) in `setup` (`start` and `job` mode: env over the config file over `createApp({ model, providers })`, `models` over all for its ids), refusing every settings issue at once (`The model settings have <n> issue(s):` and one line each), imports the provider packages the settings need and passes the default model and the resolver to the `Engine` as `model` and `models`, which checks every agent when it is registered; it never reads or sets the AI SDK's global default provider. `agentsModule()` (no options) reads `CHAMVI_AGENTS_DIR`, else takes `./agents` when it is a directory: in `start` and `job` mode its `onReady` loads every folder into the engine before any start step (a dir that is no directory is `InvalidAgentDefinitionError`), and in `start` mode a lifecycle hook polls the dir from `started` until `stopping`; it registers `AppToken.AGENT_ISSUES`, which the http module passes on as `agentIssues`. A folder agent passes every `AppToken.AGENT_CHECKS` contribution (the scheduler module's `assertSchedulable`, the http module's `assertMcpRunTool` unless `mcp: false`) and the engine's registration checks in `putAgent` (every subscription names a registered channel, the model resolves through the app's providers) before it is registered; a refusal is a load issue, never a failed boot. Only `start` mode removes an agent whose marker has no folder; a job never does. Without a dir it only refuses an app without agents.

<<< ../../../app/src/modules/config/types.ts{ts}

`StoreModuleOptions` (`store` is used as is and never closed; `dataSource` must be initialized, is migrated like a built one and never destroyed; `url` wins over `DATABASE_URL`; a data source built from a URL waits at most 10 s for Postgres to accept the first connection):

<<< ../../../app/src/modules/repository/types.ts{ts}

<<< ../../../app/src/modules/static-tokens/types.ts{ts}

<<< ../../../app/src/modules/engine/types.ts{ts}

<<< ../../../app/src/modules/scheduler/types.ts{ts}

<<< ../../../app/src/modules/http/types.ts{ts}

## Optional modules

```ts
// @chamvi/github/module
function githubModule(options?: GithubModuleOptions): GithubModule;        // .app: IGithubApp and the github channel, 'chamvi:github'

// @chamvi/sandbox/module
function sandboxModule(options?: SandboxModuleOptions): SandboxModule;     // .manager: IWorkspaceManager, 'chamvi:sandbox'

// @chamvi/channel-openclaw/module
function openclawModule(options?: OpenclawModuleOptions): IModule;         // 'chamvi:channel:<name>', default name 'openclaw'

// @chamvi/ui/module
function uiModule(options?: UiModuleOptions): IModule;                     // 'chamvi:ui'

// @chamvi/app/authup
function authupModule(options?: AuthupModuleOptions): IModule;             // 'chamvi:authup'
function oidcModule(options: OidcOptions): IModule;                        // 'chamvi:oidc', no env form
```

Each factory reads `options.env ?? process.env` when it is called and throws `InvalidAgentDefinitionError` naming a missing or malformed variable. Options win over env, except `CHAMVI_SANDBOX_PROVIDER`, `CHAMVI_SANDBOX_NAMESPACE`, `CHAMVI_SANDBOX_IMAGE`, `CHAMVI_SANDBOX_IMAGES` (over `allowImage`) and `CHAMVI_DEPLOYMENT`, which win over the sandbox options. The GitHub and OpenClaw modules contribute their channel to `AppToken.CHANNELS`, defaulting `approvalUrl` to the dashboard link built from `CHAMVI_PUBLIC_URL` and using the app's clock; tools reach a channel with `ctx.channels.findOne(name)`. `githubModule` and `sandboxModule` provide their instance on the engine in the `engineCreated` hook; tools reach it through the package's context pair ([github](/reference/github#context), [sandbox](/reference/sandbox#context)).

<<< ../../../github/src/module/types.ts{ts}

<<< ../../../sandbox/src/module/types.ts#public{ts}

<<< ../../../channel-openclaw/src/module/types.ts{ts}

<<< ../../../ui/src/module/types.ts{ts}

<<< ../../../app/src/authup/types.ts{ts}

## Tokens and hooks

`AppToken` holds the container keys, `ModuleName` the built-in names, `AUTHENTICATOR_ORDER` the chain order (static tokens `0`, authup `10`, oidc `20`, lowest first):

<<< ../../../app/src/module/constants.ts{ts}

`AppContext`, `ILifecycleHook`, `AuthenticatorEntry`, `Server`, `AppTokens` (each token's value type) and the re-exported orkos `IModule` and eldin `IContainer` types:

<<< ../../../app/src/module/types.ts{ts}

```ts
function runHooks(container: IContainer, phase: LifecyclePhase, ...args: unknown[]): Promise<void>; // every LIFECYCLE_HOOKS entry, in order
function throwIfStopped(context: AppContext): void; // throws the app_stopped error once stop() was called
```

## Testing modules

```ts
// @chamvi/app/testing
function buildModuleHarness(options?: ModuleHarnessOptions): ModuleHarness;          // not set up yet
async function createModuleHarness(options?: ModuleHarnessOptions): Promise<ModuleHarness>; // set up
```

The real module lifecycle without `start()` and a port, over exactly `options.modules` (list the built-ins a module needs, e.g. `configModule()`, `storeModule()`, `engineModule()`) on a container holding `AppToken.CONTEXT` (and `CLOCK` with `clock`): `setup()` runs every `setup`, every `onReady` and the start steps like the app and tears down and rethrows when one fails, `reported` collects every `context.report()` call (a throwing lifecycle hook lands there), `stop()` aborts the context signal and tears down.

<<< ../../../app/src/testing/types.ts{ts}

## Agent folders

```ts
function loadAgent(dir: string, options?: LoadAgentOptions): Promise<LoadedAgent>;
function loadAgents(root: string, options?: LoadAgentOptions): Promise<LoadAgentsResult>;
function listAgentFolders(root: string): Promise<string[]>;
function hashAgentFolder(dir: string): Promise<string>;
```

`loadAgent` builds one folder's agent from its `agent.ts` (see [the rule](/guide/agent-folders#the-folder)) and its content hash, and throws `InvalidAgentDefinitionError` naming the file relative to the agents dir. `loadAgents` loads every folder `listAgentFolders` names (the direct subfolders not starting with `.` or `_`, `node_modules` left out, in code-point order) and returns the failures as `issues` instead of throwing. `hashAgentFolder` is sha256 (hex) over every file below the folder, dot-entries skipped, by relative POSIX path. `loadAgent` also refuses a folder that changed while it was read (`<agent>: changed while loading; load it again.`), a `node_modules` folder in the agent folder or the agents dir, and a JavaScript file (`.js`, `.mjs` or `.cjs`) anywhere in the folder. The default reader transpiles `agent.ts` and every `.ts`/`.mts` file it imports on every load and resolves `@chamvi/*`, `ai` and `@ai-sdk/*` to the copies `@chamvi/app` resolves. The loader holds the only `jiti` and `locter` imports of chamvi.

<<< ../../../app/src/loader/types.ts{ts}

## Models

```ts
const BUILTIN_PROVIDERS: readonly BuiltinProvider[]; // anthropic, openai, google, mistral, xai: the implicit providers
```

See [Pick a Model](/guide/models) for the whole picture. `createApp({ model, providers, models })` sets the default model, the named providers and AI SDK provider objects by id; `CHAMVI_MODEL`, `CHAMVI_CONFIG_FILE` (else `./chamvi.json`) and `CHAMVI_PROVIDER_<NAME>_*` set the same from the deployment. Sources, highest first: env, the config file, code; providers merge per name and field, a higher source with another `type` replaces the provider, a `CHAMVI_PROVIDER_<NAME>_*` variable without `_TYPE` needs another source to declare `<name>`, and a declared provider replaces the implicit one of its name. `models` wins over everything for its ids (no package imported), the test seam.

Model strings are split at the first `/`. Every provider gets an explicit key and base URL (the type's public URL when none is set), read from the app's `env` only, never from `process.env` behind its back; `{ file }` secrets are read relative to the working directory with one trailing newline trimmed. The config file refuses a literal `apiKey` and literal credential headers. Errors name the variable or file field and never echo a value: `Agent "<a>" uses provider "<p>", which is not configured. Set CHAMVI_PROVIDER_<P>_TYPE and CHAMVI_PROVIDER_<P>_API_KEY, or declare it in chamvi.json.`, `Provider "<p>" (<type>) needs CHAMVI_PROVIDER_<P>_API_KEY.`, `Provider type "<type>" needs package <pkg>.` Nothing reads or sets the AI SDK's global default provider, so two apps in one process keep their own providers.

<<< ../../../app/src/models/types.ts#public{ts}

`app.check({ env? })` (`chamvi start --check`) runs the same settings through the real start path without starting anything or writing to the store; see [Check before you deploy](/guide/models#check-before-you-deploy).

## Logger

```ts
function createLogger(options?: LoggerOptions): ILogger;
```

One JSON line per entry (`{ level, time, msg, ...fields, error? }`, the error as `{ name, code, message, stack }` only, never its `cause`) on stderr, or through `write`. The engine's, the cron channel's and the HTTP app's `onError` all go through it.

<<< ../../../app/src/logger/types.ts{ts}
