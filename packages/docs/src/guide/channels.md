# Channels & the Envelope

A channel is anything a run can come from or talk to: a cron schedule, the REST API and MCP, generic webhooks, GitHub, an OpenClaw chat, the console. One contract covers all of them, so starting a run, answering where it came from and asking the owner for an approval work the same way on every transport.

```ts
interface IChannel<TInput = ChannelRequest, TOutput = Response> {
    readonly name: string;
    readonly defaultAddress?: string;            // where emit()/approve() send when no address is given
    start?(ctx: ChannelContext): Promise<void>;  // background intake: cron ticks, sockets, polling
    stop?(): Promise<void>;
    in?(input: TInput, ctx: ChannelContext): Promise<TOutput>;
    out?(message: ChannelMessage, address: string, opts: ChannelSendOptions): Promise<void>; // idempotent on message.key
}

type ChannelRequest = { request: Request; subpath: string };  // the raw request, the raw path below /channels/<name>
type ChannelContext = { engine: Engine; dispatch(envelope: ChannelDispatchEnvelope): Promise<DispatchResult> };

type ChannelMessage = {
    kind: 'message' | 'approval';
    key: string;          // stable per logical message: the transport's dedupe key
    runId: string;
    agent: string;
    title?: string;
    body: string;
    approvalId?: string;  // kind 'approval'
    expiresAt?: Date;     // kind 'approval'
    options?: ApprovalOption[]; // kind 'approval' with options: { id, label, detail? }
    multiple?: boolean;   // kind 'approval', true when several options may be selected
};

type ChannelSendOptions = { signal: AbortSignal; trigger: TriggerEnvelope };
```

The presence of `start`, `in` and `out` is a channel's only capability: `start`/`stop` run background intake (cron ticks, sockets, polling), `in` is the single inbound entry a transport feeds (the HTTP mount, tests), and `out` sends a message to an address the channel defines (`owner/repo#12` on GitHub, a chat recipient on OpenClaw). A channel's `name` follows the agent-name rule (`^[a-z0-9]+(-[a-z0-9]+)*$`) and is unique per engine. An out-only channel that always talks to one recipient sets `defaultAddress` (a non-empty string): `consoleChannel()` uses its name, the OpenClaw channel its `deliver.to`.

## Registering channels

The engine holds the channel instances:

<<< @/snippets/channels.ts#subscriptions

- `new Engine({ channels })` refuses two channels with one name (`InvalidAgentDefinitionError`).
- `engine.start()` recovers runs, then calls every channel's `start(ctx)` in registration order; a throwing `start` stops the channels already started and rejects `engine.start()`. `engine.start({ channels: false })` starts none (a one-shot [cron job](/guide/scheduler#one-shot-jobs) uses it).
- `engine.stop()` stops the poll and calls every `stop()`, resolving once all of them settled (await it before closing the store); `engine.drain()` does the same **first** (no new intake), then drains. A throwing `stop` goes to `onError` and the drain goes on.
- `ctx.dispatch(envelope)` is `engine.dispatch()` with `channel` set to the channel's own name: a channel cannot dispatch as another.
- The name `agent` belongs to `agentChannel()` from `@chamvi/core` (no `in`, no `out`), the channel [hand-offs](/guide/handoffs) come in on. `@chamvi/app` contributes it, so a user channel named `agent` clashes at setup (`The channel "agent" is registered more than once.`).

## Subscriptions

An agent subscribes to channels with `channels: ChannelSubscription[]`. Each channel package exports a builder named after its default channel; its `on()` makes subscriptions, and they are pure data, so an [agent folder](/guide/agent-folders) imports them without an instance:

| Builder | Package | Channel | Id | Options |
|---|---|---|---|---|
| `http.on(opts?)` | `@chamvi/http` | `http` (REST) and `mcp` | `http` | `schema?`: a Standard Schema for the payload. At most one per agent; REST, the UI and MCP start runs through it |
| `webhook.on(path, opts?)` | `@chamvi/http` | `webhook` | `webhook:<path>` | `path` (starts with `/`), `schema?`, `idempotencyKey?`, `concurrencyKey?`. Many per agent |
| `cron.on(expression, opts?)` | `@chamvi/channel-cron` | `cron` | `cron:<expression>` | `timezone?`, `overlap?` (`skip` by default, `queue-one`, `allow`), `payload?`, `id?` |
| `github.on(events, opts?)` | `@chamvi/github` | `github` | `github:<events>` | `events` (`'issues'` or `'issues.opened'`, one or an array), `id?`, `filter?`, `idempotencyKey?` (default the delivery id), `concurrencyKey?` (default `<owner>/<repo>#<number>`). See [GitHub App](/deployment/github-app) |
| `handoff.on(opts?)` | `@chamvi/core` | `agent` | `handoff` | `schema?`, `maxPerRun?` (default 100), `idempotencyKey?`, `concurrencyKey?`. At most one per agent; the opt-in for [`startHandoff()`](/guide/handoffs) |

A second instance of a channel (`cronChannel({ name: 'cron-eu' })`) has its own `on()` bound to its name, so its subscriptions reach only it. Subscription ids must be unique per agent. The engine (constructor and `putAgent`) refuses a subscription naming a channel it does not hold, so register `httpChannel()` for `http.on()`, `cronChannel()` for `cron.on()`, and so on. With [`@chamvi/app`](/guide/app) the built-in modules register `agent`, `http`, `mcp`, `webhook` and `cron` for you.

A subscription may carry `concurrencyKey(payload)` and `idempotencyKey(payload)` functions; the channel that dispatches computes the envelope keys from them.

## The envelope

<<< ../../../core/src/trigger/types.ts{ts}

`dispatch()` takes the envelope without `id` and `receivedAt`; it fills in a random UUID and the current time. `trigger` is the subscription id (`'http'`, `'webhook:/issues'`, ...), `channel` the name of the channel the run came from (`'mcp'` for a run started through `http.on()` over MCP). `address` is where the run came from on that channel, as the channel defines it (the issue for GitHub, a chat recipient); it is stored on the run as `run.address` and is where [`ctx.channels.findOne()`](#outbound-from-tools) answers. An `idempotencyKey`, `concurrencyKey` or `address` above 255 characters or with a NUL is refused (`ValidationError`) before anything is written.

The engine renders the channel, subscription id and payload as a JSON block and makes it the run's first user message. The model sees exactly that; put what it needs into the payload.

`invoker` is who started the run. Only a channel sets it, from its authenticated caller (`@chamvi/http` fills it from the principal), never from a payload. It is not part of the rendered block, so the model never sees it. See [Restricting tools per invoker](/guide/tools#restricting-tools-per-invoker).

Runs stored before channels existed (`source` and `thread` in the envelope) read back as `channel` and `address` from both stores.

## Outbound from tools

The engine never sends a message of its own. A tool sends through a channel:

<<< @/snippets/channels.ts#outbound

- `ctx.channels.findOne(name)` returns a handle on a registered channel with `out`, or `undefined` for an unknown name or a channel without `out`. Without a name it is the run's source channel, bound to its source address, so a tool answers where the run came from without knowing the channel (and gets `undefined` for a run from `http`, `mcp` or `cron`).
- `ctx.channels.findOneOrFail(name?)` is the same, but throws `ChannelNotFoundError` (`channel_not_found`) instead of returning `undefined`: use it for a channel the agent cannot work without.
- `ctx.channels.find()` returns a handle on every channel with `out`, in registration order.
- `handle.emit({ title?, body, key? }, address?)` sends through `out`. The address defaults to the source address on the source channel, else to the channel's `defaultAddress`; without either a missing address is a `validation_error` tool error.
- An emit is an [effect](/guide/effect-tools): its key is `<runId>:emit:<channel>:<sha256 of address and message>` (or your `key`), recorded in the effect store, so identical emits of one step and a step redone after a crash send once. `out` gets the key as `message.key`, to dedupe on in the transport. A throwing `out` records nothing and is a tool error, so the next identical emit sends again.
- `emit` outside a tool call (in the tools factory) throws `InvalidRunStateError`: the tool call is the unit of retry.
- `handle.approve({ title, body?, options?, multiple?, timeoutMs?, address? })` asks the owner through the channel; see [Approvals](/guide/approvals).

## Writing a channel

A chat bridge with both directions:

<<< @/snippets/channels.ts#custom

Rules for a channel:

1. **`in` checks its own credentials.** `createHttpApp({ channels })` mounts `POST /channels/<name>` and everything below it for the listed channels, rate-limited but never authenticated by the app's authenticators. Read the body with `readRequestBody(request, { limit })` from `@chamvi/http` (413 above the limit); any thrown error renders through the app's JSON error handler.
2. **`out` throws on failure.** A failed emit records nothing; a failed approval message leaves `waiting.notifiedAt` unset and `tick()` re-sends it on every poll.
3. **`out` is idempotent on `message.key`.** A crash after a successful send but before the record re-sends with the same key; pass it to the transport (an `Idempotency-Key` header, a hidden marker) so the owner gets one message.
4. **Link to the approval.** A message carries the approval id; link to the approval in the [dashboard](/guide/ui#approval-links), where the owner answers signed in.

`ChannelSendOptions` carries the call's `signal` and `trigger`, the run's stored envelope (e.g. to find the run's issue); read it, never write it.

## Shipped channels

| Channel | Package | In | Out |
|---|---|---|---|
| `httpChannel()`, `mcpChannel()` | [`@chamvi/http`](/guide/http) | REST `POST /agents/:name/runs`, MCP `run_<agent>` (served by the app's routes) | none |
| `webhookChannel({ auth })` | [`@chamvi/http`](/guide/http#channels) | `POST /channels/webhook/<agent><path>` | none |
| `cronChannel()` | [`@chamvi/channel-cron`](/guide/scheduler) | ticks from `start()` | none |
| `githubChannel({ app })` | [`@chamvi/github`](/deployment/github-app) | signed deliveries at `POST /channels/github` | a comment on an issue or pull request (`owner/repo#n`), deduplicated by a hidden marker |
| `openclawChannel({ ... })` | [`@chamvi/channel-openclaw`](/deployment/openclaw) | none | an OpenClaw chat through its hooks endpoint, deduplicated by `Idempotency-Key` |
| `consoleChannel({ name?, write? })` | `@chamvi/core` | none | one header line per message, the body lines and, for an approval, until when it waits (default `console.log`); never throws |

## Attachments

`dispatch()` also takes files for the model, `attachments: [{ mediaType, filename?, data }]` with `data` a `Uint8Array`:

<<< @/snippets/channels.ts#attachments

Each attachment is checked before anything is written (`mediaType` of the form `type/subtype` without parameters, `data` a `Uint8Array`; `ValidationError` otherwise), then stored as an [artifact](/guide/agents#files) of the run, after the idempotency check (a deduplicated dispatch stores nothing) and before the run is created. The run's `trigger.attachments` holds their metadata. The first user message then carries the rendered envelope as text followed by one file part per attachment, so a model that reads images or PDFs gets them directly. Attachment ids are derived from the run id and the position (`<runId>.0000`, `<runId>.0001`, ...), so the run's artifacts list in the order they were given. A crash between storing the files and creating the run leaves orphan artifacts; nothing purges them yet. Two dispatches that race to create the run of the same reserved idempotency key (its first run was never created) write to the same ids, so the second write of each file is a no-op and the run names exactly the files that were stored; only a racing dispatch with more files than the winner leaves its extra files listed among the run's artifacts.

Over HTTP, `POST /agents/:name/runs` takes the same list with `data` as base64 (see [HTTP API](/guide/http#files)).

## Idempotency keys

<<< @/snippets/channels.ts#dispatch

With an `idempotencyKey`, `dispatch()` claims the key in the store under the scope `<agent>:<channel>` (for example `triage:webhook`) for 7 days. The first dispatch creates the run. Every later dispatch with the same agent, channel and key returns the existing run id with `deduplicated: true`, and no new run is created.

A dispatch with an [invoker](#the-envelope) claims the key under `<agent>:<channel>:<kind>:<id>` instead (`kind` and `id` URI-encoded). Keys are then per invoker: the same invoker's retry is deduplicated, while another invoker sending the same key gets a run of its own and never learns about the first.

Use a key that is stable across redeliveries: a GitHub delivery id, a cron subscription plus its scheduled time, or a key your client sends.

If the store claimed the key but the run was never created (for example `createRun` failed right after the claim), the next dispatch with that key creates the run under the reserved id. `createRun` is insert-if-absent, so concurrent dispatches create it once.

## Concurrency keys

A run with a `concurrencyKey` starts only when no other run of the same agent with the same key is `running`, `waiting` or `interrupted`. Runs with different keys, and runs without a key, run in parallel up to the engine's `maxConcurrentRuns`. See [Concurrency, Leases & Multi-Replica](/guide/concurrency).

Typical keys: one per repository, issue or pull request (`acme/app#42`), or one per mailbox.
