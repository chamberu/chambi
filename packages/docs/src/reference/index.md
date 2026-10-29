# @chamvi/core

The public API of `@chamvi/core`, taken from `packages/core/src/index.ts`. Contract interfaces carry an `I` prefix (`IRunRepository`, `IClock`, `IChannel`, `IAgentState`); data shapes are unprefixed types.

```ts
import { Engine, defineAgent } from '@chamvi/core';
```

Test helpers live in [`@chamvi/test-kit`](/reference/test-kit).

## Agents

```ts
function defineAgent<S extends StateSchema = StateSchema>(def: AgentDefinition<S>): Agent<S>;

const DEFAULT_MAX_STEPS: 20;
const DEFAULT_TIMEOUT_MS: 900_000; // 15 minutes
```

Throws `InvalidAgentDefinitionError` for an invalid name, duplicate subscription ids, a tool with `needsApproval` or a `toolsContext` entry naming a chamvi tool or no tool of a plain tool set (both in a plain tool set; a tools factory fails the run instead). See [Agents](/guide/agents).

A folder agent's `agent.ts` default-exports `defineAgent()`'s result, named like its folder; `AgentRevision` is the store's revision marker of a folder agent (see [Agent Folders](/guide/agent-folders)):

<<< ../../../core/src/agent/types.ts{ts}

## Permissions

```ts
function matchesPermission(granted: string, wanted: string): boolean;
function hasPermission(permissions: readonly string[], wanted: string): boolean;
function toolPermission(agent: string, tool: string): string; // tool:<agent>:<tool>
function requireToolPermission(opts?: RequireToolPermissionOptions): ToolPolicy;
```

`*` alone grants everything, a `*` segment matches exactly one segment, and segment counts must match. `requireToolPermission()` offers a tool when the run's invoker holds `toolPermission(agent, tool)`; runs without an invoker follow `withoutInvoker` (default `'deny'`). See [Restricting tools per invoker](/guide/tools#restricting-tools-per-invoker).

<<< ../../../core/src/permission/types.ts{ts}

## Channels

```ts
function consoleChannel(options?: ConsoleChannelOptions): IChannel;           // out only, name 'console'
function normalizeEnvelope(raw: Record<string, unknown>): TriggerEnvelope;    // for repositories: legacy source/thread read back as channel/address
function assertTriggerKey(name: string, value: string | undefined): void;     // 255 characters, no NUL
```

`IChannel`, `ChannelRequest`, `ChannelContext`, `ChannelDispatchEnvelope`, `DispatchResult`, `ChannelMessage`, `ChannelSendOptions`, `ChannelSubscription`, `EmitMessage`, `ChannelHandle`, `ToolChannels` (`ToolContext.channels`) and `ConsoleChannelOptions`:

<<< ../../../core/src/channel/types.ts{ts}

`consoleChannel()` writes `[chamvi] <kind>: <title or the body's first line> (agent <agent>, run <runId>, key <key>)`, then the body lines and, for an approval, with options `select one:` (or `select one or more:`) and one `option <id>: <label>` line per option, then `approval <approvalId> waits until <ISO>`, one `write` call per line. It never throws; an invalid `name` throws `InvalidAgentDefinitionError`.

The envelope (`TriggerEnvelope`, `Invoker`):

<<< ../../../core/src/trigger/types.ts{ts}

Subscription builders live in the channel packages: `http.on()` and `webhook.on()` in [`@chamvi/http`](/reference/http), `cron.on()` in [`@chamvi/channel-cron`](/reference/channel-cron), `github.on()` in [`@chamvi/github`](/reference/github). See [Channels & the Envelope](/guide/channels).

## Engine

```ts
class Engine {
    constructor(opts: EngineOptions);

    readonly repositories: Repositories;
    readonly clock: IClock;
    getAgent(name: string): Agent | undefined;
    listAgents(): Agent[];
    getChannel(name: string): IChannel | undefined;
    listChannels(): IChannel[];
    putAgent(agent: Agent, options?: { revision?: string; formerRevision?: string; reload?: boolean }): Promise<'added' | 'replaced' | 'unchanged'>;
    checkAgent(agent: Agent): void;
    removeAgent(name: string): Promise<boolean>;
    agentRevision(name: string): string | undefined;
    provide<T>(key: ContextKey<T>, value: T): void; // IContextProvider, see Context

    dispatch(envelope: DispatchEnvelope): Promise<{ runId: string; deduplicated: boolean }>;
    getRun(id: string): Promise<Run | undefined>;
    on<T extends EngineEvent['type']>(event: T, listener: (e: Extract<EngineEvent, { type: T }>) => void): () => void;

    start(options?: { channels?: boolean }): Promise<void>;
    stop(): void;
    drain(opts?: { timeoutMs?: number }): Promise<void>;
    idle(): Promise<void>;
    readonly isDraining: boolean;

    cancel(runId: string): Promise<void>;
    approve(runId: string, answer: ApprovalAnswer): Promise<void>;
    tick(): Promise<void>;
    recover(): Promise<number>;
}
```

| Method | Description | Guide |
|---|---|---|
| `repositories`, `clock` | The store and clock the engine was built with (`clock` defaults to `systemClock`) | |
| `getAgent`, `listAgents` | One registered agent by name; all of them in registration order (a new array), read at call time | |
| `getChannel`, `listChannels` | One registered channel by name; all of them in registration order | [Channels](/guide/channels) |
| `putAgent` | Registers an agent or replaces the one of the same name in place (a new one goes last); refuses a subscription to an unknown channel like the constructor. Replacing cancels the agent's unsettled runs created before now. With a `revision` (a folder's content hash) the store's marker is brought to it under the lock `agents:<name>` instead, cancelling once across replicas and only when a marker existed (swept before and again after the marker write; no run of the agent starts on this engine meanwhile). Each cancelled run stores `agent_replaced` as its `error` ([Errors](/guide/errors#run-errors)), and the sweep emits `agents.cancelled`. With `reload: false` (a process that never reloads, a job) nothing is cancelled: a missing marker is written, a different one moved only while the agent has no unsettled run, else `InvalidRunStateError` and the agent stays unregistered. A marker at `formerRevision` (the same content hashed by an earlier algorithm) counts as equal and is moved to `revision` without a cancel. Resolves `unchanged` (no event) for the same agent object at the same revision | [Agent Folders](/guide/agent-folders) |
| `checkAgent` | What `putAgent` refuses before any store access (a model that does not resolve, a subscription to an unknown channel), as `InvalidAgentDefinitionError`; registers and writes nothing | [Agent Folders](/guide/agent-folders) |
| `removeAgent` | Unregisters the agent here first (no further dispatch), then under the same lock cancels its unsettled runs and deletes its marker (when it has one, unless this engine had it at another revision: a newer one registered elsewhere stays), or without a marker cancels the runs of an agent registered here; each cancelled run stores `agent_removed` ([Errors](/guide/errors#run-errors)) and the sweep emits `agents.cancelled`; resolves whether it was registered here | [Agent Folders](/guide/agent-folders) |
| `agentRevision` | The revision an agent was registered at; `undefined` for a code agent | |
| `dispatch` | Repositories a `queued` run (and its attachments as artifacts); deduplicates by `idempotencyKey` under `<agent>:<channel>[:<kind>:<id>]` | [Channels](/guide/channels#idempotency-keys) |
| `getRun` | Reads a run from the store | [Run Lifecycle](/guide/run-lifecycle) |
| `on` | Subscribes to `run.updated`, `step.appended`, `run.delta`, `agents.changed` or `agents.cancelled` (`AgentRunsCancelled { name, reason: 'agent_replaced' \| 'agent_removed', revision?, runIds }`, the runs whose cancel went through: a run on another replica only gets a cancel request and may still complete); returns an unsubscribe function | [Run Lifecycle](/guide/run-lifecycle#watching-runs) |
| `start` | Recovers, starts every channel (unless `{ channels: false }`; a throwing `start` stops those already started and rejects), starts polling and starts queued runs: only runs of an agent it holds, a folder agent only at the stored revision (the others stay `queued`) | [Recovery](/guide/recovery) |
| `stop` | Stops every channel, then polling only | [Recovery](/guide/recovery) |
| `drain` | Stops every channel first (a throwing `stop` goes to `onError`), waits for in-flight runs (default 30 s), then marks the rest `interrupted` | [Recovery](/guide/recovery#drain) |
| `idle` | Resolves when nothing runs and nothing more can start | |
| `cancel` | Cancels locally, in the store, or requests it from the owning replica | [Recovery](/guide/recovery#cancel) |
| `approve` | Answers the current wait point by `approvalId`, once | [Approvals](/guide/approvals#answering) |
| `tick` | Denies expired approvals and re-sends approval messages a channel has not delivered; runs every poll | [Approvals](/guide/approvals#asking-through-a-channel) |
| `recover` | Requeues abandoned runs; runs on start and every poll | [Recovery](/guide/recovery#recovery) |

<<< ../../../core/src/engine/types.ts{ts}

| Option | Default |
|---|---|
| `channels` | `[]` |
| `owner` | `` `${hostname}-${pid}` `` |
| `concurrencyMaxRuns` | `4` |
| `claimTtlMs` | `60_000`, renewed and polled every `claimTtlMs / 3` |
| `clock` | `systemClock` |
| `onError` | logs to `console.error` |


## Runs

`Run`, `RunStatusLiteral`, `RunContext`, `Step`, `Checkpoint`, `WaitPoint`, `Budget` and `Usage`:

<<< ../../../core/src/run/types.ts{ts}

The `RunStatus` enum, whose values `RunStatusLiteral` is built from:

<<< ../../../core/src/run/constants.ts{ts}

## Repositories

```ts
function createMemoryRepositories(options?: MemoryRepositoriesOptions): Repositories & { conversations: IConversationRepository };
```

The `Repositories` aggregate and its capability interfaces (`IRunRepository`, `IStepRepository`, `ICheckpointRepository`, `IIdempotencyRepository`, `ILockRepository`, `IEffectRepository`, `IStateRepository`, `IArtifactRepository`, `IAgentRevisionRepository`) are listed on the [Repository Contract](/repositories/) page.

## Artifacts

`Artifact` (metadata), `ArtifactInput` (a file to store) and `IRunArtifacts` (the tool context's `artifacts`):

<<< ../../../core/src/artifact/types.ts{ts}

`isArtifactMediaType(value: unknown): value is string` is the media type rule `dispatch` and `artifacts.put()` apply: `type/subtype` (RFC 6838 restricted names) without parameters. An intake layer can check attachments with it before dispatching (`@chamvi/http` does).

`artifactFilePart(artifact)` is the file item a tool's `toModelOutput` returns to show an artifact of the run to the model (an image it stored with `artifacts.put()`): its data is the artifact's marker, so the tool step and the checkpoints keep the id while the engine hands the model the bytes before each model call.

See [Files](/guide/agents#files) and [Attachments](/guide/channels#attachments).

## Tools

```ts
function defineTool<I, O, S extends StateSchema = StateSchema>(
    def: Tool<I, O, ToolContext<S>> & {
        execute: ToolExecuteFunction<I, O, ToolContext<S>>;
        contextSchema?: never;
    },
): Tool<I, O, ToolContext<S>>;

const toolContextSchema: StandardSchemaV1<ToolContext, ToolContext>; // vendor 'chamvi'
```

`defineTool()` is `tool()` with `contextSchema: toolContextSchema`; the engine hands the run's `ToolContext` to every tool carrying that schema (by reference, so a copy of the tool keeps it). Its `validate` returns the context unchanged and rejects a missing one, which fails the run (`validation_error`) with `Type validation failed for tool context (<tool>): No chamvi tool context: the tool was built by another copy of @chamvi/core, or runs outside a chamvi agent.` (the marker is the schema object itself, so a tool from a second copy of `@chamvi/core` gets no context).

<<< ../../../core/src/tool/types.ts{ts}

See [Tools and their context](/guide/agents#tools-and-their-context).

## Context

```ts
function defineContextKey<T>(name: string): ContextKey<T>;                      // a new frozen key per call; empty name -> InvalidAgentDefinitionError
function inject<T>(ctx: ToolContext, key: ContextKey<T>): T;                    // else ContextNotProvidedError ('context_not_provided')
function tryInject<T>(ctx: ToolContext, key: ContextKey<T>): T | undefined;
```

`engine.provide(key, value)` (`Engine` implements `IContextProvider`) keeps the value by reference and refuses a foreign key, `undefined` and a second value for one key (`InvalidAgentDefinitionError` naming the key). `inject` reads the engine's values for the `ToolContext` the engine built for the execution (tool `execute`, the tools factory, `alreadyApplied`, `effectKey`); `ToolContext` (`{ run, state, artifacts, channels }`) gains no field for a provided value, and nothing provided is stored or serialized. A missing value is a tool error in `execute` and the effect hooks and fails the run in the factory. See [Context](/guide/tools#context-shared-instances-for-tools).

<<< ../../../core/src/context/types.ts{ts}

## Models

```ts
function resolveModel<S extends StateSchema = StateSchema>(ctx: ToolContext<S>, ref?: ModelRef): LanguageModel;
function checkAgentModel(agent: Agent, options: ModelCheckOptions): void;      // InvalidAgentDefinitionError
```

A `ModelRef` is a `'<provider>/<model id>'` string or an AI SDK `LanguageModel` object (used as is). An agent's `model` falls back to `EngineOptions.model`; the engine refuses an agent with neither, a ref of another shape, a string without `EngineOptions.models` (`IModelResolver`; pass a `LanguageModel` object then) and a string the resolver refuses, at construction and in `putAgent` (`checkAgentModel` is that check; a string default without a resolver is refused at construction too). Strings resolve through `models.resolve()` when an execution starts; the engine never hands the AI SDK a string. `@chamvi/app` passes both from its [model settings](/guide/models) (`CHAMVI_MODEL`, `chamvi.json`, `createApp({ model, providers })`).

`resolveModel(ctx, ref?)` gives tool code (`execute`, the tools factory, the effect hooks) a model: `ref`, else the run's agent model from the live registry, else the default. An object is returned as is; a string needs `models` (`resolveModel(): the model string "<ref>" needs a model resolver (EngineOptions.models).`) and a ref it cannot resolve is an `InvalidAgentDefinitionError` too, a tool error in `execute`. It reads the engine's models through the context mechanism, so `ToolContext` keeps its shape and a hand-built context throws `ContextNotProvidedError`.

<<< ../../../core/src/model/types.ts#public{ts}

## Effect tools

```ts
function defineEffectTool<I, O, S extends StateSchema = StateSchema>(def: Tool<I, O, ToolContext<S>> & {
    execute: ToolExecuteFunction<I, O, ToolContext<S>>;
    contextSchema?: never;
    effectKey?: (input: I, ctx: ToolContext<S>, options: ToolExecutionOptions<ToolContext<S>>) => string;
    alreadyApplied?: (effectKey: string, input: I, ctx: ToolContext<S>) => Promise<O | undefined>;
}): EffectTool<I, O, S>;

function effectMarker(effectKey: string): string; // '<!-- chamvi:effect=<key> -->'

function wrapToolsForRun(
    tools: ToolSet,
    ctx: ToolContext,
    store: IEffectRepository,
    options?: { allow?: (toolName: string) => boolean; hooks?: AgentHooks },
): ToolSet;

const EFFECT: unique symbol; // marks a tool as an effect tool
```

See [Effect Tools & Reconciliation](/guide/effect-tools).

## Approvals

```ts
function approve(ctx: ToolContext, request: ApprovalRequestInput): Promise<ApprovalDecision>; // inside a tool call only

const DEFAULT_APPROVAL_TIMEOUT_MS: 86_400_000; // 24 hours
const APPROVAL_TIMEOUT_MAX_MS: 2_147_483_647;
const APPROVAL_OPTIONS_MAX: 20;
const APPROVAL_OPTION_ID_PATTERN: RegExp; // /^[A-Za-z0-9@][\w.:/@+-]{0,127}$/
const APPROVAL_OPTION_LABEL_MAX_LENGTH: 200;
const APPROVAL_OPTION_DETAIL_MAX_LENGTH: 20_000;
const APPROVAL_OPTIONS_DETAIL_MAX_LENGTH: 100_000; // all details of one request
```

<<< ../../../core/src/approval/types.ts{ts}

`approve()` outside a tool call, or in a streaming tool's body, throws `InvalidRunStateError`; a `timeoutMs` that is no positive integer up to `APPROVAL_TIMEOUT_MAX_MS` is a `ValidationError`, as are options outside the limits above (see [Offering options](/guide/approvals#offering-options)). `ChannelHandle.approve()` is the same with the request delivered through the channel. The agent hooks (`AgentHooks`, `ToolCallInfo`) are on `AgentDefinition` above. See [Approvals & Hooks](/guide/approvals).

## State

```ts
function createAgentState<S extends StateSchema = StateSchema>(
    agent: string,
    schema: S | undefined,
    store: IStateRepository,
): IAgentState<S>;

function createStateTools<S extends StateSchema>(schema: S): ToolSet; // the tools read context.state
```

<<< ../../../core/src/state/types.ts{ts}

See [Agent State](/guide/state).

## Clock

```ts
const systemClock: IClock;
```

<<< ../../../core/src/clock/types.ts{ts}

`systemClock` timers never keep the process alive unless `keepAlive` is set; only the drain deadline sets it.

## Errors

`ChamviError`, `InvalidAgentDefinitionError`, `AgentNotFoundError`, `ChannelNotFoundError`, `ContextNotProvidedError`, `InvalidRunStateError`, `RunNotFoundError`, `ArtifactNotFoundError`, `BudgetExceededError`, `TimeoutError`, `FatalToolError`, `IncompleteResponseError`, `ToolNotAllowedError`, `ToolDeniedError`, `LeaseLostError`, `SandboxError`, `ValidationError` and `ErrorCode`:

<<< ../../../core/src/errors/constants.ts{ts}

See [Errors](/guide/errors) for when each is thrown.
