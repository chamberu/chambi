<p align="center">
    <img src="https://raw.githubusercontent.com/chamvi/chamvi/master/.github/assets/logo.svg" alt="@chamvi/http" width="128" height="128" />
</p>

<h1 align="center">@chamvi/http</h1>

<p align="center">
    <b>REST, SSE, webhooks and MCP for chamvi agents, on routup.</b><br>
    One routup App per chamvi app: humans start and follow runs over REST and SSE,<br>
    channels take deliveries at <code>/channels/&lt;name&gt;</code>, and agents call runs as MCP tools.
</p>

<p align="center">
    <a href="https://www.npmjs.com/package/@chamvi/http"><img src="https://img.shields.io/npm/v/@chamvi/http" alt="npm version" /></a>
    <a href="https://github.com/chamvi/chamvi/actions/workflows/ci.yml"><img src="https://github.com/chamvi/chamvi/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
    <a href="https://github.com/chamvi/chamvi/blob/master/packages/http/LICENSE"><img src="https://img.shields.io/npm/l/@chamvi/http" alt="License" /></a>
</p>

---

**Table of Contents**
- [Installation](#installation)
- [Usage](#usage)
- [Endpoints](#endpoints)
- [Permissions](#permissions)
- [Authenticators](#authenticators)
- [Channels](#channels)
- [MCP tools](#mcp-tools)
- [Operations](#operations)
- [Shutdown](#shutdown)
- [Options](#options)
- [API](#api)
- [License](#license)

## Installation

```bash
npm install @chamvi/http @chamvi/core --save
```

ESM only, Node.js `>=24.3.0`. `@chamvi/core` is a peer dependency; [routup](https://www.npmjs.com/package/routup) v6, the [MCP TypeScript SDK](https://www.npmjs.com/package/@modelcontextprotocol/server) v2, [vouchly](https://www.npmjs.com/package/vouchly) and the authup server adapter are installed with the package.

## Usage

`createHttpApp()` returns a routup `App`; `app.fetch(request)` answers any WHATWG `Request`, and routup's `serve()` listens on a port:

```typescript
import type { LanguageModel } from 'ai';
import { Engine, createMemoryStore, defineAgent } from '@chamvi/core';
import {
    createHttpApp,
    createShutdown,
    http,
    httpChannel,
    mcpChannel,
    staticTokens,
} from '@chamvi/http';

export async function createAgentServer(model: LanguageModel) {
    const echo = defineAgent({
        name: 'echo',
        model,
        instructions: 'Answer with a short summary of the payload.',
        // http.on() lets REST (POST /agents/echo/runs) and MCP (run_echo) start runs
        channels: [http.on()],
    });

    const engine = new Engine({
        store: createMemoryStore(),
        agents: [echo],
        // REST runs carry channel http, MCP runs channel mcp
        channels: [httpChannel(), mcpChannel()],
    });

    const token = process.env.CHAMVI_TOKEN;

    if (!token) {
        throw new Error('Set CHAMVI_TOKEN (at least 16 characters).');
    }

    const shutdown = createShutdown({ engine });
    const app = createHttpApp({
        // routes read the store, the agents and the clock from the engine
        engine,
        auth: staticTokens({
            tokens: [{
                value: token,
                id: 'ci',
                permissions: ['*'],
            }],
        }),
        shutdown,
    });

    await engine.start();

    // serve it with routup (srvx); let createShutdown own SIGTERM:
    // const server = serve(app, { port: 3000, gracefulShutdown: false });
    // process.once('SIGTERM', () => shutdown.shutdown());
    return {
        app,
        engine,
        shutdown,
    };
}
```

Every route answers JSON. Errors are always `{ status, code, message, issues? }` (for unmatched routes too); a 5xx body says `Internal Server Error` and the cause goes to `onError`. An issue keeps its `received` value only when that is at most 256 characters as JSON, so a 400 never echoes a large body (an oversized `attachments` list, a long `address` or media type) back. Every 401 carries `WWW-Authenticate: Bearer`.

## Endpoints

Paths are relative to `basePath` (default none).

| Method and path | Permission | Answer |
|---|---|---|
| `POST /agents/:name/runs` | `agent:<name>:run` | `202 { runId, deduplicated }`; body `{ payload?, idempotencyKey?, address?, attachments? }`, the key also as an `Idempotency-Key` header; the agent needs an `http.on()` subscription; runs carry channel `http` |
| `GET /runs` | `run:read`, or `agent:<agent>:run` with `filter[agent]=<agent>` | `200 { data, meta: { total, limit, offset } }` |
| `GET /runs/:id` | `run:read` or `agent:<run.agent>:run` | `200` the run plus its `steps` |
| `GET /runs/:id/stream` | as `GET /runs/:id` | SSE: `run.updated`, `step.appended` (`id` = step index), `delta` (live model output, no `id`), `ping`; ends once the run settled. `Last-Event-ID` or `?after=<step index>` resumes; `503` with `Retry-After` over `stream.maxOpen` |
| `GET /runs/:id/artifacts` | as `GET /runs/:id` | `200 { data: Artifact[] }`: the run's attachments and the files its tools stored |
| `GET /runs/:id/artifacts/:artifactId` | as `GET /runs/:id` | `200` the bytes: stored media type, `content-disposition: attachment` (RFC 5987 `filename*` when named), `nosniff`, `private, no-store`; `404 artifact_not_found` for an unknown artifact or one of another run |
| `POST /runs/:id/cancel` | `run:cancel` | `202 { runId, status }` |
| `POST /runs/:id/approve` | `agent:<run.agent>:approve` | `202 { runId, status: 'queued' }`; body `{ approvalId, approved, reason? }`; answers the run's current wait point without a token (409 for another `approvalId`, an expired wait point or a run not waiting) |
| `POST /channels/<name>[/...]` | the channel's own | Whatever the channel's `in` answers; only for the channels in the `channels` option (see [Channels](#channels)) |
| `GET /agents` | `run:read` | `200 { data: AgentSummary[], issues }`: subscriptions `{ channel, id, hook? }` (`hook`: the path of a subscription to a webhook channel this app mounts), budget, state collections; `issues` lists agents that failed to load |
| `GET /schedules` | `run:read` | `200 { data: ScheduleSummary[] }`: every cron subscription (`@chamvi/channel-cron`'s `cron.on()`) with its channel and next fire time (from the definitions, not from a running scheduler) |
| `GET /agents/:name/state/kv` | `state:read` | `200 { data: Array<{ key, value }> }` in key code-point order; `page[limit]` (default 50, at most 100), `page[offset]` |
| `GET /agents/:name/state/kv/:key` | `state:read` | `200 { key, value }` (`null` when unset) |
| `PATCH /agents/:name/state/kv/:key` | `state:write` | `200 { key, value }`; body `{ value }` |
| `GET /agents/:name/state/collections/:collection` | `state:read` | `200 { data }`, each document `{ id, ...fields }` (a non-object document as `{ id, doc }`); top-level equality filters (`filter[status]=open`; rapiq turns `42`, `007`, `true` and `null` into a number, boolean or null, so double-quote a value to match it as a string: `filter[issue]="42"`), `page[limit]`; `id` is the store id, not a document field, so `filter[id]` is 400; a `page[offset]` above 0 is 400 (the store pages by limit only) |
| `GET /me` | authenticated | `200 { id, kind, name?, permissions }`: the caller itself (the name as an invoker records it), with its own permissions only |
| `/mcp` | authenticated | The MCP endpoint (see [MCP tools](#mcp-tools)) |
| `GET /healthz` | none | `200 { status: 'ok' }` |
| `GET /readyz` | none | `200`, or `503 { status: 'unavailable', reason }` with `shutting-down`, `draining` or `store-unreachable` |
| `GET /metrics` | none | Prometheus text format |

`GET /runs` takes the [rapiq](https://www.npmjs.com/package/@rapiq/codec-url) URL syntax: `filter[agent]=triage`, `filter[status]=queued,running`, `page[limit]=20` (default 50, at most 100), `page[offset]=40` and `sort=createdAt` (oldest first, the default) or `sort=-createdAt` (newest first). The expression dialect works too (`filter=eq(agent,'triage')`); only filters joined with `and` are supported. Unknown keys, operators and sorts answer 400.

Bodies are JSON (`application/json` or `*+json`), at most `bodyLimit` bytes (413 above, 415 for another media type). A refused body is drained (at most `bodyLimit` more bytes) so a keep-alive connection serves the next request; a longer one closes the connection. A protected route checks the bearer token before it reads the body, so an unauthenticated client cannot make the server buffer it. Unknown body keys are dropped without an error. A NUL character (U+0000, which Postgres text columns refuse) in the URL, in an `idempotencyKey`, `address` or other string field, or in a key a webhook derives from its payload answers 400.

`attachments` takes at most 16 files `{ mediaType, filename?, data }`: `mediaType` is `type/subtype` without parameters, `filename` 1 to 255 characters, `data` strict base64 (padded, standard alphabet, no whitespace); anything else is 400 `validation_error` with the field's path, and nothing is dispatched. The files are stored as artifacts of the run (see `@chamvi/core`) and handed to the model as file parts. Base64 rides in the JSON body, so `bodyLimit` bounds the files as well.

`GET /runs/:id` answers 404 before 403, so any authenticated principal can tell whether a run id exists; run ids are random UUIDs. Runs on the wire never carry the internal `claim` (owner and lease).

`POST /agents/:name/runs` and MCP `run_<agent>` record the authenticated principal as the run's invoker (`run.trigger.invoker`: `id`, `kind`, `permissions`, and a `name` from the `name` or `preferred_username` claim, never `email`, since every reader of the run sees it; static tokens have none), so tool code and a core `toolPolicy` can tell who started the run. `POST /runs/:id/approve` and MCP `approve_run` record the approver on the `wait` step (`output.approver`). Both come only from the authenticator, never from a body. Webhook runs have no invoker. The invoker and approver leave the package (REST, SSE, MCP) without their `permissions`, so a `run:read` holder never learns another principal's grants.

The SSE stream follows the run through `engine.on` and polls the store every `stream.pollMs` (default 2 s), so it also sees a run executing on another replica. `delta` events (`data: { step, kind: 'text' | 'reasoning', text }`) forward the engine's `run.delta` while the model writes (`step` is the checkpoint step index of the `llm` step being generated (one per model call), not the `step.appended` `id`, which also counts `tool` and `wait` rows); they have no `id` (`Last-Event-ID` stays a step index), are never replayed and come only from the replica executing the run. `Last-Event-ID` resumes after a step index; the query `?after=<step index>` does the same for clients that cannot set the header (a non-negative integer, given once, else 400). When both are present a valid `Last-Event-ID` wins, since it carries the client's progress on a reconnect while the URL stays the one of the first connect; a malformed `Last-Event-ID` reads as absent and `?after` applies.

The stream takes bearer tokens only. Browser `EventSource` cannot send an `Authorization` header, so a browser reads the stream with a fetch-based SSE reader (`fetch` plus an SSE parser over the response body) that sends `Authorization` and, when it reconnects, `Last-Event-ID` with the last `id` it saw (or `?after=`).

Each app caps the open SSE streams plus the MCP `run_<agent>` calls that wait (`waitSeconds` above 0) at `stream.maxOpen` (default 1000, one counter for both). A stream over the cap answers `503 { code: 'service_unavailable' }` with `Retry-After: 5` (not reported to `onError`); an MCP call over the cap does not wait and answers at once with `{ runId, status, deduplicated }`, as with `waitSeconds: 0`, since its run is already dispatched. A slot is freed when the stream ends (settled run, client gone, failure, shutdown) or the wait answers; a client that cancels the body without the request signal aborting frees it at the next write, within `stream.pollMs`.

## Permissions

| Permission | Grants |
|---|---|
| `agent:<name>:run` | Start runs of the agent (REST, `webhookChannel()` deliveries, MCP `run_<name>`) and read them |
| `agent:<name>:approve` | Answer the agent's approvals (`POST /runs/:id/approve`, MCP `approve_run`) |
| `run:read` | Read and list every run, the agents and the schedules |
| `run:cancel` | Cancel runs |
| `state:read`, `state:write` | Read and write agent state |
| `*` | Everything |

A `*` segment matches exactly one segment: `agent:*:run` grants `agent:triage:run` but not `agent:triage:approve`, and `agent:*` grants neither. Matching is case-sensitive. `agentPermission(agent, action)` is exported; to check a principal yourself, use `hasPermission(principal.permissions, permission)` from `@chamvi/core`, the matcher the routes use.

`POST /runs/:id/approve { approvalId, approved, reason? }` answers the current wait point with the approve permission alone; another `approvalId` than the run's current one, an expired wait point, a run that is not waiting and a second answer are 409.

## Authenticators

`auth` takes one authenticator or a chain; the first principal wins. An authenticator resolves `undefined` for a request it does not recognize (the chain continues) and throws a 401 for credentials it rejects. A resolved principal needs a non-empty `id` and `kind` and a `permissions` array of strings; anything else is a server misconfiguration (500, reported to `onError`) and ends the chain.

```ts
const ciToken = process.env.CI_TOKEN;
auth: [
    // static tokens first: authup() in remote mode introspects every non-JWT bearer
    ...(ciToken ?
        [staticTokens({
            tokens: [{
                value: ciToken,
                id: 'ci',
                permissions: ['agent:deploy:run'],
            }],
        })] :
        []),
    // an authup TokenVerifier in remote mode (with a creator), so tokens carry their grants
    authup({ verifier }),
    oidc({ issuers: [githubActions], principal: mapGithubClaims }),
],
```

- **`staticTokens({ tokens: [{ value, id, permissions }] })`**: bearer tokens (`value`) of at least 16 characters, compared by SHA-256 digest. A `value` may appear once; several tokens may share an `id`, so a rotated token can overlap with the old one. Fits CI and service accounts. Put it **before** `authup()` and `oidc()`: `authup()` in remote mode sends every bearer that is not a JWT to the authup server's introspection endpoint, so a static token placed after it leaks to that server on every request.
- **`authup({ verifier })`**: verifies through `@authup/server-adapter-web`. A token grants its permissions only when its `scope` contains `global`; other tokens keep their identity but grant nothing (so they answer 403). Local verification always yields no permissions: grants need remote mode (`creator`, introspection). Permission `policies`, `realm_id` and `client_id` are not evaluated. Caching: a cached result is served until the token's `exp`, so in local mode it outlives a disabled signing key and in remote mode a revoked token (`maxRemoteCacheTTL` bounds remote caching); without `cache`, nothing is cached.
- **`oidc({ issuers, principal })`**: any OIDC issuer through vouchly, e.g. GitHub Actions tokens. Every issuer needs an `audience` (vouchly skips the `aud` check without one, so a public issuer's tokens for any audience would pass; `oidc()` throws otherwise). `principal` is **required** and maps the verified claims to a principal (or `undefined` to refuse it): a public issuer lets anyone mint a token for your audience, so the deployment decides which `sub` or `repository` gets which grants. A token from an issuer that is not configured passes to the next authenticator; an unreachable issuer answers 503.

## Channels

Agents subscribe to channels (`defineAgent({ channels: [...] })`, see `@chamvi/core`); the engine holds the channel instances (`new Engine({ channels })`). This package ships three:

- **`httpChannel()`** (name `http`) and **`mcpChannel()`** (name `mcp`): no `in`, no `out`. **`http.on({ schema? })`** is the control-plane subscription (id `http`, at most one per agent): REST `POST /agents/:name/runs` starts runs through it as channel `http`, and MCP `run_<name>` as channel `mcp`, so the two keep separate idempotency scopes. An agent without it answers 404 on REST and gets no MCP tool. `schema` (any Standard Schema) validates the payload; failures answer 400 with `issues`. The engine refuses an `http.on()` subscription unless it holds `httpChannel()`.
- **`webhookChannel({ auth, name?, bodyLimit? })`** (name `webhook` by default): **`webhook.on(path, { schema?, idempotencyKey?, concurrencyKey? })`** (id `webhook:<path>`, many per agent) is served on its own path under the agent: `webhook.on('/issues')` on agent `intake` is `POST /channels/webhook/intake/issues`, a path of `/` is `/channels/webhook/intake` (`GET /agents` lists each `hook` URL). The match is exact, a trailing slash included. A delivery needs a principal of `auth` (one authenticator or a chain, as the app's `auth`; required, since the app never authenticates channel routes) holding `agent:<agent>:run`, checked before the body is read. The body is any JSON value of at most `bodyLimit` bytes (default 1 MiB; 413 above, 415 for another media type) and is the payload. The idempotency key comes from the `Idempotency-Key` header, else from `idempotencyKey(payload)`; retried deliveries with one key create one run. It answers 202 right away and never runs the agent synchronously; runs carry no invoker. A second instance (`webhookChannel({ name: 'hooks', auth })`) makes its subscriptions with its own `on()`. Signature-verified webhooks (GitHub) are `@chamvi/github`'s channel.

`createHttpApp({ channels })` mounts `POST /channels/<name>` and `POST /channels/<name>/...` for exactly the listed channels (each needs an `in` and must be the object the engine holds under its name; else `InvalidAgentDefinitionError`). These routes are rate-limited but never authenticated by the app: each channel checks its own credentials. `in({ request, subpath }, ctx)` gets the raw request (body unread; read it with this package's `readRequestBody(request, { limit })`, which answers 413 above the limit and closes the connection) and the raw subpath (`''` for the bare path, else starting with `/`, still percent-encoded), and `ctx.dispatch` dispatches as the channel. Its `Response` is sent as is; a thrown error renders like any route's error. Any other `/channels/...` path is 404.

## MCP tools

`/mcp` is a streamable HTTP MCP endpoint (MCP TypeScript SDK v2; 2025-era clients are served statelessly) with the same bearer authentication as REST. The tools a client sees depend on its principal:

| Tool | Input | Answer |
|---|---|---|
| `run_<agent>` | `{ payload?, idempotencyKey?, address?, waitSeconds? }` | `{ runId, status, deduplicated, output?, error?, waiting? }` |
| `get_run` | `{ runId }` | The run (as `GET /runs/:id`, without steps) |
| `list_runs` | `{ agent?, status?, limit?, offset? }` | `{ data: RunSummary[], total }` |
| `approve_run` | `{ runId, approvalId, approved, reason? }` | `{ runId, status: 'queued' }` |

- `run_<agent>` is listed for each agent with an `http.on()` subscription the principal may run (runs carry channel `mcp`); its `payload` carries the subscription schema's JSON Schema (local `$ref`s re-rooted under `payload`). Tool definitions are built once in `createHttpApp`, which throws `InvalidAgentDefinitionError` for a payload schema the MCP validator cannot compile or a tool name above the 64 characters MCP allows (an agent name above 60; set `mcp: false` to keep it). `waitSeconds` (default 0) waits for `completed`, `failed`, `cancelled` or `waiting`, at most `mcp.maxWaitSeconds` (default 60; larger values are clamped). A wait holds one of the app's `stream.maxOpen` slots; with all taken the call answers at once with `{ runId, status, deduplicated }`, like `waitSeconds: 0`, and the run proceeds. The wait polls the store every second, so it sees a run executing on another replica, and stops when the client goes away. A `waiting` answer names the tool and the approval's `title` and `body`.
- Idempotency keys are scoped per agent, channel and principal: an MCP start dedupes under `<agent>:mcp:<kind>:<id>`, a REST start under `<agent>:http:<kind>:<id>` (the principal's `kind` and `id`, URI-encoded), so one key used over both transports, or by two principals, creates two runs. Webhook starts carry no invoker and dedupe under `<agent>:webhook`.
- `get_run` and `list_runs` follow the REST read rule; denied permissions and unknown runs come back as tool errors (`isError`).

## Operations

- **`/metrics`** is unauthenticated (scrapers rarely send bearer tokens): keep it off the public ingress (a NetworkPolicy, or a separate internal listener), or disable it with `metrics: false`. Each app gets its own `prom-client` `Registry`; the `path` label is the route template (`/runs/:id`, `/channels/:name/*`; an unknown path is `/_unmatched`), so ids and probes do not mint series. SSE streams and rate-limited requests are not timed. `metrics.normalizePath` overrides the label.
- **Rate limit**: 300 requests per minute per client address by default, `/healthz`, `/readyz`, `/metrics` and CORS preflights excluded. The key is the socket address unless `trustProxy` is set: behind a reverse proxy, set it (e.g. `'loopback'` or a hop count) or every client shares the proxy's bucket; `X-Forwarded-For` is never trusted otherwise. Without a socket address (in-process `app.fetch`, unix sockets) all clients share one bucket.
- **CORS** is off unless `cors` is given (`@routup/cors` options).
- **Readiness** fails while shutting down, while the engine drains, or when the store does not answer within `readyTimeoutMs`.

## Shutdown

`createShutdown()` runs the shutdown in order: fail readiness, wait `readinessDelayMs`, run the `onShutdown` callbacks in the order added (the http app's own one ends open SSE streams and MCP `run_<agent>` waits (a wait answers with the run as stored), closes MCP; new streams and MCP requests then answer 503), stop accepting connections, `engine.drain()` (which stops every channel first, the cron schedule among them), then wait at most `closeTimeoutMs` for open connections before closing them. Pass `gracefulShutdown: false` to `serve()` so srvx does not install its own signal handler:

```ts
import { serve } from 'routup';

let server: ReturnType<typeof serve> | undefined;
const shutdown = createShutdown({
    engine,
    // the server is created after the app; the helper only calls close() at shutdown
    server: { close: async (force) => { await server?.close(force); } },
});
const app = createHttpApp({ engine, auth, shutdown });
server = serve(app, { port: 3000, gracefulShutdown: false });

process.once('SIGTERM', () => {
    void shutdown.shutdown();
});
```

`shutdown.onShutdown(fn)` adds your own cleanup; it runs after readiness failed and before the server closes.

## Options

`createHttpApp(options)`:

| Option | Type | Default | Description |
|---|---|---|---|
| `engine` | `IEngine` | required | Dispatches, cancels and resumes runs; its `store`, agents and `clock` serve every route (runs, steps and state are read from `engine.store`, polls, waits and timeouts run on `engine.clock`) |
| `agents` | `string[]` | every agent | Names of the engine's agents this app serves (routes, MCP tools, extra routes); the others are unknown to it. A mounted channel serves every agent subscribing to it. A name the engine lacks or given twice throws `InvalidAgentDefinitionError` |
| `auth` | `Authenticator \| Authenticator[]` | required | The authenticator chain |
| `basePath` | `string` | none | Prefix of every route, e.g. `/api` |
| `trustProxy` | routup trust-proxy input | none | Which proxies the client address (and the rate-limit key) trusts |
| `shutdown` | `IShutdown` | none | Fails `/readyz` and ends streams on shutdown |
| `bodyLimit` | `number` | `1_048_576` | Bytes a REST or MCP request body may have |
| `stream.pollMs` | `number` | `2_000` | Repository poll of SSE streams |
| `stream.maxOpen` | `number` | `1_000` | Open SSE streams plus waiting MCP `run_<agent>` calls per app; a positive integer, else `createHttpApp` throws `InvalidAgentDefinitionError` |
| `mcp` | `false \| { name?, version?, maxWaitSeconds? }` | `chamvi`, `0.0.0`, `60` | MCP server info and wait cap; `false` mounts nothing |
| `cors` | `false \| CorsOptions` | off | `@routup/cors` options |
| `rateLimit` | `false \| Partial<RateLimitOptions>` | 300 per minute | `@routup/rate-limit` options |
| `metrics` | `false \| Partial<PrometheusOptions>` | `/metrics` | `@routup/prometheus` options |
| `readyTimeoutMs` | `number` | `2_000` | How long `/readyz` waits for the store |
| `onError` | `(error) => void` | `console.error` | 5xx causes and background failures |
| `channels` | `IChannel[]` | none | Channels served at `POST /channels/<name>` and below (see [Channels](#channels)); each needs an `in` and must be the object the engine holds under its name |
| `routes` | `HttpRoute[]` | none | Extra routes other packages contribute (e.g. `@chamvi/ui`'s dashboard), served under `basePath` without `auth`; static paths, never under a built-in route's first segment or the metrics path (case-insensitive), `rateLimit: false` skips the limiter; `prefix: true` also serves every path below `path/` (the rest as `request.subpath`, raw and case kept; metrics label `<path>/*`; no other route of that method at or under it, never at or above the metrics path); a result may carry `headers` and a `Uint8Array` body (sent as is, `application/octet-stream` by default); the route context has `basePath` |

`createShutdown(options)`:

| Option | Type | Default | Description |
|---|---|---|---|
| `engine` | `IEngine` | required | Drained during the shutdown; its `clock` drives the delays |
| `server` | `{ close(force?): Promise<void> }` | none | The srvx server |
| `readinessDelayMs` | `number` | `0` | Time for load balancers to see the failing readiness |
| `drainTimeoutMs` | `number` | `30_000` | Passed to `engine.drain()` |
| `closeTimeoutMs` | `number` | `5_000` | Wait for open connections, then close them |
| `onError` | `(error) => void` | `console.error` | Failing callbacks and closes |

## API

| Export | Kind | Purpose |
|---|---|---|
| `createHttpApp` | function | Builds the routup App |
| `createShutdown` | function | The graceful shutdown helper |
| `staticTokens`, `authup`, `oidc` | function | Authenticators |
| `httpChannel`, `mcpChannel`, `webhookChannel` | function | The channels REST, MCP and generic webhooks dispatch as |
| `http`, `webhook` | constant | Subscription builders: `http.on({ schema? })`, `webhook.on(path, options?)` |
| `HTTP_CHANNEL_NAME`, `MCP_CHANNEL_NAME`, `WEBHOOK_CHANNEL_NAME` | constant | `http`, `mcp`, `webhook` |
| `agentPermission` | function | `agent:<agent>:<action>` (matching is core's `hasPermission`) |
| `Permission` | constant | `ALL`, `RUN_READ`, `RUN_CANCEL`, `STATE_READ`, `STATE_WRITE` |
| `DEFAULT_SHUTDOWN_DRAIN_TIMEOUT_MS`, `DEFAULT_SHUTDOWN_CLOSE_TIMEOUT_MS` | constant | `30_000`, `5_000` |

Types: `HttpAppOptions`, `McpOptions`, `CorsOptions`, `RateLimitOptions`, `PrometheusOptions`, `TrustProxyInput`, `Principal`, `Authenticator`, `PermissionName`, `AgentAction`, `StaticToken`, `StaticTokensOptions`, `AuthupOptions`, `OidcOptions`, `IShutdown`, `ShutdownOptions`, `RunView`, `InvokerView`, `RunListQuery`, `RunSummary`, `RunToolResult`, `AgentSummary`, `ScheduleSummary`, `ScheduleOverlap`, `WebhookChannel`, `WebhookChannelOptions`, `HttpSubscriber`, `HttpSubscriptionOptions`, `WebhookSubscriber`, `WebhookSubscriptionOptions`.

## License

Published under [Apache License 2.0](./LICENSE).
