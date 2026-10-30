# Pick a Model

An agent names its model as `'<provider>/<model id>'`, or names none and uses the app's default. chamvi resolves the string itself, through providers the app declared: a string never reaches the Vercel AI Gateway or any provider you did not set up, and nothing reads or writes the AI SDK's global default provider. Keys come from env, a `chamvi.json` file or code, and every error names the variable to set.

## The short version

One provider, one model for every agent:

```bash
CHAMVI_MODEL=anthropic/claude-sonnet-5-5
ANTHROPIC_API_KEY=sk-ant-...
```

```bash
npm install @ai-sdk/anthropic   # the provider package: an optional peer of @chamvi/app
npx chamvi start --check        # checks it before you start
```

`ANTHROPIC_API_KEY` creates a provider named `anthropic`; `CHAMVI_MODEL` makes `anthropic/claude-sonnet-5-5` the default of every agent without a `model`.

## Model references

A `ModelRef` is a string or an AI SDK `LanguageModel` object:

- `'anthropic/claude-sonnet-5-5'`: provider `anthropic`, model `claude-sonnet-5-5`. The string is split at the **first** `/`, so `'router/cc/claude-opus-4-6'` is provider `router`, model `cc/claude-opus-4-6` (routers such as 9router and OmniRoute use ids like that).
- `anthropic('claude-sonnet-5-5')` from `@ai-sdk/anthropic`, or any other `LanguageModel`: used as is, no provider settings involved.

An agent's `model` is optional. Without it the agent takes the app default (`CHAMVI_MODEL`, the config file's `model` or `createApp({ model })`). The engine checks every agent when it is registered: an agent with no model and no default, or a string naming a provider that is not configured, fails `start` for a code agent (`chamvi start` exits 2) and becomes a load issue for a [folder agent](/guide/agent-folders), which is then not registered:

```
Agent "triage" has no model and the engine sets no default (EngineOptions.model; CHAMVI_MODEL in @chamvi/app).
Agent "triage" uses provider "team-a", which is not configured. Set CHAMVI_PROVIDER_TEAM_A_TYPE and CHAMVI_PROVIDER_TEAM_A_API_KEY, or declare it in chamvi.json.
```

## Providers

A provider is a name with a `type` and its settings:

| Field | Value |
|---|---|
| `type` | `anthropic`, `openai`, `openai-compatible`, `google`, `mistral`, `xai` or `gateway`: which AI SDK package builds it |
| `apiKey` | A secret (below). Required for every type but `openai-compatible`, which may go without one (no `Authorization` header is sent) |
| `baseURL` | An absolute `http(s)` URL without credentials, query or fragment. Default: the type's public URL; required for `openai-compatible` |
| `headers` | Header name to secret; names are lower-kebab (`x-team`) |

| Type | Package | Default base URL |
|---|---|---|
| `anthropic` | `@ai-sdk/anthropic` | `https://api.anthropic.com/v1` |
| `openai` | `@ai-sdk/openai` | `https://api.openai.com/v1` |
| `openai-compatible` | `@ai-sdk/openai-compatible` | none, set `baseURL` |
| `google` | `@ai-sdk/google` | `https://generativelanguage.googleapis.com/v1beta` |
| `mistral` | `@ai-sdk/mistral` | `https://api.mistral.ai/v1` |
| `xai` | `@ai-sdk/xai` | `https://api.x.ai/v1` |
| `gateway` | `ai` (its `createGateway`) | `https://ai-gateway.vercel.sh/v4/ai`, the Vercel AI Gateway; only when you declare it |

The packages are optional peers of `@chamvi/app` (`ai` is a required one): install the ones your providers use. A missing one is named when the app starts (`Provider type "openai-compatible" needs package @ai-sdk/openai-compatible.`).

A secret (`SecretValue`) is a literal string, `{ env: 'VAR' }` (read from the app's env) or `{ file: 'path' }` (relative to the working directory, one trailing newline trimmed, so a mounted Kubernetes Secret works). chamvi always hands the provider package an explicit key and base URL: a provider never falls back to `process.env` behind the app's back, so two providers of one type keep their keys apart.

Keys, credential headers and credential-bearing URLs never reach a store row, a step, a log line, an error or the `chamvi start --check` output: errors name variables, fields and header names, never values.

### Implicit providers

A bare provider variable in the app's env creates a provider named after its type, so the short version above needs no declaration:

| Variable | Creates |
|---|---|
| `ANTHROPIC_API_KEY` (and `ANTHROPIC_BASE_URL`) | `anthropic` |
| `OPENAI_API_KEY` (and `OPENAI_BASE_URL`) | `openai` |
| `GOOGLE_GENERATIVE_AI_API_KEY` | `google` |
| `MISTRAL_API_KEY` | `mistral` |
| `XAI_API_KEY` | `xai` |

`gateway` is never implicit: `AI_GATEWAY_API_KEY` alone creates nothing. A provider declared by any source replaces the implicit one of its name entirely; bare variables never merge into a declared provider.

### Several keys, several providers

Each named provider has its own credentials, so agents meant to be separated never share a key by accident:

```bash
CHAMVI_PROVIDER_TEAM_A_TYPE=anthropic
CHAMVI_PROVIDER_TEAM_A_API_KEY=sk-ant-...
CHAMVI_PROVIDER_TEAM_B_TYPE=anthropic
CHAMVI_PROVIDER_TEAM_B_API_KEY=sk-ant-...
```

An agent with `model: 'team-a/claude-opus-4-6'` uses the first key, one with `'team-b/claude-opus-4-6'` the second. Provider names follow the agent-name rule (`^[a-z0-9]+(-[a-z0-9]+)*$`); in variables the name is upper snake case (`team-a` is `TEAM_A`, `a1` is `A1`).

## Gateways and routers

Self-hosted routers and servers speak the OpenAI API: declare them as `openai-compatible` with their base URL. That covers 9router and OmniRoute (both serve `http://<host>:20128/v1`), Ollama, vLLM, LiteLLM and OpenRouter.

```bash
CHAMVI_PROVIDER_ROUTER_TYPE=openai-compatible
CHAMVI_PROVIDER_ROUTER_BASE_URL=http://9router:20128/v1
CHAMVI_PROVIDER_ROUTER_API_KEY=...                 # optional for openai-compatible
CHAMVI_PROVIDER_ROUTER_HEADER_X_TEAM=a             # one variable per header: X_TEAM is x-team
CHAMVI_MODEL=router/cc/claude-opus-4-6
```

The Vercel AI Gateway is the type `gateway`, used only when you declare a provider of it (`CHAMVI_PROVIDER_VERCEL_TYPE=gateway`, `CHAMVI_PROVIDER_VERCEL_API_KEY=...`, then `vercel/anthropic/claude-sonnet-5-5`).

## In code

`createApp()` takes the default model and the providers; agents name a provider or inherit the default:

<<< @/snippets/models.ts#app

- `createApp({ models })` still takes AI SDK provider objects by id (`{ anthropic: createAnthropic({ ... }) }`); they win over every provider setting for their ids, which makes them the test seam.
- Tool code gets a model through `resolveModel(ctx, ref?)` (from `@chamvi/core`, re-exported by `@chamvi/app`): `ref` resolved through the app's providers, or without one the run's agent model. Never pass a bare string to the AI SDK in a tool; it would go through the SDK's global provider, which chamvi does not set.

## The config file

`chamvi.json` in the working directory is read when it exists; `CHAMVI_CONFIG_FILE` names another one (then it must exist). JSON only:

```json
{
    "model": "router/cc/claude-opus-4-6",
    "providers": {
        "router": {
            "type": "openai-compatible",
            "baseURL": "http://9router:20128/v1",
            "apiKey": { "env": "ROUTER_KEY" },
            "headers": { "x-team": "a" }
        },
        "team-a": { "type": "anthropic", "apiKey": { "file": "/run/secrets/team-a-key" } }
    }
}
```

The file is meant to be committed, so it refuses a literal `apiKey` and a literal value for a credential header (a name containing `auth`, `token`, `secret` or `api-key`/`apikey`/`api_key`): use `{ "env": "VAR" }` or `{ "file": "path" }` for those. An unknown field, provider type or header name is an error naming the file and the field. `remotes` is reserved for remote agents.

## Precedence

Sources, highest first: **env**, then **the config file**, then **`createApp()` code**. `createApp({ models })` wins over all of them for its ids.

- The default model follows the same order: a code default (`createApp({ model })`) is overridden by the file's `model`, both by `CHAMVI_MODEL`.
- Providers merge **per name and per field**: code or the file declares `router` with its `type` and `baseURL`, the deployment supplies only `CHAMVI_PROVIDER_ROUTER_API_KEY`.
- A higher source that sets another `type` than a lower one replaces that provider wholesale, never a mix of two types.
- A `CHAMVI_PROVIDER_<NAME>_*` variable without `_TYPE` is valid only when another source declares `<name>`; otherwise it is an error naming the missing `_TYPE` (a typo in the name shows up at once).
- A declared provider replaces the implicit one of its name (see [Implicit providers](#implicit-providers)).

| Variable | Value |
|---|---|
| `CHAMVI_MODEL` | The default model, `'<provider>/<model id>'` |
| `CHAMVI_CONFIG_FILE` | The config file, relative to the working directory or absolute; unset, `./chamvi.json` when it exists |
| `CHAMVI_PROVIDER_<NAME>_TYPE` | The provider's type |
| `CHAMVI_PROVIDER_<NAME>_API_KEY` | Its key |
| `CHAMVI_PROVIDER_<NAME>_BASE_URL` | Its base URL |
| `CHAMVI_PROVIDER_<NAME>_HEADER_<HEADER>` | One header (`X_TEAM` is `x-team`) |
| `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, ... | The [implicit providers](#implicit-providers) |

## Check before you deploy

`chamvi start --check` runs the start path of the built entry up to the start itself and exits: it reads the same settings (env, config file, code), builds the providers, connects to the store, sets every module up and loads every [agent folder](/guide/agent-folders) with the checks a start runs (the model, the channels an agent subscribes to, the built-in scheduler's cron subscriptions, the built-in http module's MCP tool unless `mcp: false`). Code agents get the same checks. It starts no engine, channel or server, runs nothing and writes nothing to the store: no migration, no revision marker, no cancel. Skill headers are checked statically; skill sources are never loaded and remote content verification is deferred until startup. Of a module's lifecycle hooks only `engineCreated` and `drained` run (never `started` or `stopping`).

```bash
npx chamvi build && npx chamvi start --check
```

```
chamvi: start check passed
```

It needs what a start needs (`CHAMVI_TOKENS`, the provider keys, `DATABASE_URL`), so run it in CI with the production or staging env. Exit codes:

| Code | Means |
|---|---|
| `0` | Clean: `chamvi: start check passed` on stdout |
| `1` | A runtime failure: the store is unreachable, or it has pending migrations and `CHAMVI_MIGRATE` is off (`store_not_migrated`) |
| `2` | A configuration error (a provider that is not configured, a missing key or authenticator, a code agent on an unknown channel), or an agent folder with a load issue, each on its own stderr line |

Errors name the variable to set, never a value. The same check is `await app.check({ env })` in code ([reference](/reference/app#createapp)), resolving `{ issues }`.
