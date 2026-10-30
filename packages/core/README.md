<p align="center">
    <img src="https://raw.githubusercontent.com/chamvi/chamvi/master/.github/assets/logo.svg" alt="@chamvi/core" width="128" height="128" />
</p>

<h1 align="center">@chamvi/core</h1>

<p align="center">
    <b>Core engine for self-hosted, channel-driven AI agents: agents, channels and durable runs.</b><br>
    You write the agent with the AI SDK. The engine queues its runs, checkpoints every step,<br>
    pauses for approvals and picks interrupted runs up again, in a plain Node process.
</p>

<p align="center">
    <a href="https://www.npmjs.com/package/@chamvi/core"><img src="https://img.shields.io/npm/v/@chamvi/core" alt="npm version" /></a>
    <a href="https://github.com/chamvi/chamvi/actions/workflows/ci.yml"><img src="https://github.com/chamvi/chamvi/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
    <a href="https://github.com/chamvi/chamvi/blob/master/packages/core/LICENSE"><img src="https://img.shields.io/npm/l/@chamvi/core" alt="License" /></a>
</p>

<p align="center">
    <a href="#installation"><b>Installation</b></a>
    ·
    <a href="#usage">Usage</a>
    ·
    <a href="#options">Options</a>
    ·
    <a href="#api">API</a>
    ·
    <a href="#notes">Notes</a>
</p>

---

## Why @chamvi/core?

The AI SDK runs the model and its tool loop, and stops there. An agent that reacts to webhooks and schedules also needs a place to queue the work, a way to survive a pod restart halfway through a run, a guard against posting the same comment twice after a retry, and a way to wait a day for a human to approve a call. That usually means a hosted orchestrator, or a lot of glue code.

`@chamvi/core` is that layer as a library, with no orchestrator server and no Redis:

| Concern | AI SDK on its own | @chamvi/core |
|---|---|---|
| **Intake** | You call `generateText` from your handler | `dispatch()` stores a `queued` run; an `idempotencyKey` turns a redelivery into the existing run |
| **Concurrency** | Two webhooks for the same issue race each other | One run at a time per `concurrencyKey`, enforced through the store across replicas |
| **Durability** | A crash loses the conversation | A checkpoint after every step; a recovered run continues from the latest one |
| **Side effects** | A retried tool call posts again | `defineEffectTool()` records each result per effect key and can check the remote system before acting |
| **Approvals** | You build the pause, the storage and the callback | `await approve(ctx, { title })` in a tool pauses the run in `waiting`, across restarts; `engine.approve()` or `resume(token, decision)` answers and the call replays with the decision |
| **Limits** | `stopWhen` per call | `maxSteps`, `maxTokens` and `timeoutMs` per run, settled as `completed` or `failed` |
| **Shutdown** | Runs die with the process | `drain()` waits for in-flight runs, then marks the rest `interrupted` for another replica |

Models, messages and tools stay AI SDK types: `defineAgent()` takes a `LanguageModel` (or a `'<provider>/<model id>'` string the engine resolves through `EngineOptions.models`) and a plain `ToolSet` (tools built with `tool()`, or `defineTool()` for tools that read the run context), and nothing is wrapped in a chamvi type.

<p align="center">
    <img src="https://raw.githubusercontent.com/chamvi/chamvi/master/.github/assets/run-lifecycle.svg" alt="dispatch() stores a queued run, deduplicated by idempotency key. The engine claims it and runs it: every LLM or tool step is followed by a checkpoint in the store. A run ends completed, failed or cancelled. A tool that awaits approve() pauses the run in waiting; approving or denying it requeues the run, and the call runs again with the decision. drain() or a crashed process leaves a run interrupted or with an expired claim; recover() requeues it, and the next execution continues from the latest checkpoint." width="100%" />
</p>

**Table of Contents**
- [Installation](#installation)
- [Usage](#usage)
  - [Agents and channels](#agents-and-channels)
  - [Effect tools](#effect-tools)
  - [Approvals](#approvals)
  - [Agent state](#agent-state)
  - [Stores and repositories](#stores-and-repositories)
- [Options](#options)
- [API](#api)
- [Notes](#notes)
- [License](#license)

## Installation

```bash
npm install @chamvi/core ai --save
```

ESM only, Node.js `>=24.3.0`. `ai@^7` (the Vercel AI SDK) is a peer dependency; add the provider package of your model as well, for example `@ai-sdk/anthropic`.

## Usage

One agent, an in-memory store, the development console channel and one manually dispatched run that answers where it came from:

```typescript
import type { LanguageModel } from 'ai';
import { z } from 'zod';
import {
    Engine,
    consoleChannel,
    createMemoryStore,
    defineAgent,
    defineEffectTool,
} from '@chamvi/core';

export async function triageIssue(model: LanguageModel) {
    const labels: string[] = [];
    const lines: string[] = [];

    const triage = defineAgent({
        name: 'triage',
        model,
        instructions: 'Label the issue in the trigger payload as bug, feature or question.',
        budget: { maxSteps: 5 },
        tools: {
            // the result is recorded per (run, tool, input): a resumed run reuses it
            addLabel: defineEffectTool({
                description: 'Adds a label to the issue.',
                inputSchema: z.object({ label: z.enum(['bug', 'feature', 'question']) }),
                execute: async ({ label }, { context }) => {
                    labels.push(label);
                    // answers where the run came from, at most once per message
                    await context.channels.findOne()?.emit({ body: `Labelled as ${label}.` });

                    return { added: label };
                },
            }),
        },
    });

    const engine = new Engine({
        store: createMemoryStore(),
        agents: [triage],
        channels: [consoleChannel({
            write: (line) => {
                lines.push(line);
            },
        })],
    });

    await engine.start();

    const { runId } = await engine.dispatch({
        agent: 'triage',
        trigger: 'manual',
        channel: 'console',
        address: 'issue-1',
        payload: { title: 'App crashes on start' },
    });

    await engine.idle();
    await engine.stop();

    return {
        run: await engine.getRun(runId),
        labels,
        lines,
    };
}
```

The run settles `completed`, and its `output` is the text of the model's last answer (with structured `output`, the parsed value); the console channel wrote `Labelled as bug.` once. This is the code of [`test/fixtures/readme-example.ts`](./test/fixtures/readme-example.ts), which the test suite runs against a scripted model.

### Agents and channels

- `defineAgent()` checks the name (`^[a-z0-9]+(-[a-z0-9]+)*$`, at most 64 characters) and that subscription ids are unique, and fills in the default budget (`maxSteps: 20`, `timeoutMs: 900_000`).
- `tools` is a plain AI SDK `ToolSet`, defined once at module scope, or a factory `(ctx) => ToolSet` for dynamic sets (called once per execution). Tools built with `defineTool()` (or `defineEffectTool()`) read the run context as `context` in `execute`: `run` (`runId`, `agent`, `trigger`, `signal`), the agent's `state` and the run's `artifacts`. One context per execution, shared by every call and by the factory; treat it as immutable.

```typescript
const lookup = defineTool({
    inputSchema: z.object({ issue: z.number() }),
    execute: async ({ issue }, { context }) => fetchIssue(issue, { signal: context.run.signal }),
});
```

- Only tools whose `contextSchema` is chamvi's `toolContextSchema` get that context. A third-party tool with its own `contextSchema` gets its entry of the agent's `toolsContext`, passed through by reference. An entry the tool's schema rejects fails the run with `validation_error`, without recording the value. An entry naming a chamvi tool or no tool is an `InvalidAgentDefinitionError` (thrown by `defineAgent()` for a plain set, a failed run for a factory).

```typescript
tools: { search: searchTool },
toolsContext: { search: { apiKey: process.env.SEARCH_KEY } },
```

- A channel (`IChannel`: `name`, optional `defaultAddress`, `start`, `stop`, `in`, `out`) is anything a run comes from or talks to; `new Engine({ channels })` registers them (names follow the agent-name rule, unique per engine). `start()` starts every channel after the first recovery (`start({ channels: false })` starts none), `drain()` and `stop()` stop them first. An agent subscribes through `channels: ChannelSubscription[]`, each naming a registered channel (an unknown one is refused). A channel dispatches through its `ChannelContext`, which sets `channel` to its own name.
- Outbound is tool-driven: the engine never sends a message of its own. Inside a tool, `ctx.channels.findOne(name)` returns a handle on a registered channel with `out`, or `undefined`; without a name it is the run's source channel, bound to its source address. `ctx.channels.findOneOrFail(name?)` throws `ChannelNotFoundError` (`channel_not_found`) instead of `undefined`, and `ctx.channels.find()` returns every channel with `out`. `handle.emit({ title?, body, key? }, address?)` sends through the channel's `out`; the address defaults to the source address on the source channel, else to the channel's `defaultAddress` (`consoleChannel()` has its name, the OpenClaw channel its `deliver.to`); without either it is a `validation_error` tool error. An emit is an effect: its key (`<runId>:emit:<channel>:<sha256 of address and message>`, or your `key`) is recorded in the effect store, so identical emits of one step and a step redone after a crash send once, and `out` gets it as `message.key` to dedupe on; a throwing `out` records nothing and is a tool error. `emit` outside a tool call (in the tools factory) throws `InvalidRunStateError`.
- `consoleChannel({ name?, write? })` is the development channel (out only, default name `console`, default `write` `console.log`): one header line per message, the body lines and, for an approval, until when it waits; it never throws.
- The trigger envelope (channel, subscription id, payload; `address` is where the run came from on the channel) becomes the run's first user message, as a JSON block.
- `dispatch({ ..., attachments: [{ mediaType, filename?, data }] })` starts a run with files: each is stored as an artifact of the run before the run is created (a deduplicated dispatch stores nothing), its metadata lands on `run.trigger.attachments` (ids `<runId>.0000`, `<runId>.0001`, ..., so a listing keeps the input order), and the model gets the bytes as file parts of the first message. Checkpoints keep a reference, never the bytes; a missing artifact fails the run with code `artifact_not_found`.
- The tool context (also the factory's argument) carries `artifacts`, scoped to the run: `put({ mediaType, filename?, data })`, `get(id)` and `list()`. `put()` is no effect by itself; call it inside a `defineEffectTool` to store a file exactly once.
- `output` takes an AI SDK `Output` (e.g. `Output.object({ schema })`): a completed run's `output` is then the parsed value instead of the text, and a final answer that does not parse fails the run with `validation_error` (the quoted cause cut to 500 characters; the whole answer stays in the `llm` step). An answer cut off at the output token limit, or a loop that ended on a tool call nothing executed, fails it with `incomplete_response`.
- The engine streams every model call: `engine.on('run.delta', ({ delta }) => ...)` gets `{ runId, step, kind: 'text' | 'reasoning', text }` while the model writes. Deltas are never stored and reach only listeners in the process executing the run.
- A model call that fails mid-stream still ends its step: the `llm` step (text so far, finish reason `error`) and a checkpoint are written, then the run fails with the model's error. A stream that closes without the provider's finish part fails the run with `incomplete_response` and never runs that step's tool calls.

### Effect tools

```typescript
const comment = defineEffectTool({
    inputSchema: z.object({ issue: z.number(), body: z.string() }),
    effectKey: ({ issue }, ctx) => `${ctx.run.runId}:comment:${issue}`,
    // finds a comment an earlier, crashed attempt already posted
    alreadyApplied: async (key, { issue }) => findComment(issue, effectMarker(key)),
    execute: async ({ issue, body }, { context }) => postComment(
        issue,
        `${body}\n${effectMarker(`${context.run.runId}:comment:${issue}`)}`,
    ),
});

const agent = defineAgent({
    name: 'responder',
    model,
    instructions: 'Answer new issues.',
    tools: { comment },
});
```

- The effect key defaults to `${ctx.run.runId}:${toolName}:${sha256(input)}`; `effectKey(input, ctx)` replaces it. `effectKey` and `alreadyApplied` get the same tool context as `execute` (`ctx.run`, `ctx.state`, `ctx.artifacts`); in core 0.1 they got the run context, so `ctx.runId` is now `ctx.run.runId`.
- On every call the engine tries the recorded result first, then `alreadyApplied`, then `execute`. The result is recorded after `execute` returns. A throwing `execute` records nothing, so a retry may apply it.
- `effectMarker(key)` is a hidden HTML comment to embed in what the tool creates, so that `alreadyApplied` can find it again.

### Approvals

```typescript
const deploy = defineTool({
    description: 'Deploy a version.',
    inputSchema: z.object({ version: z.string() }),
    execute: async ({ version }, { context }) => {
        // pauses the run until the owner answers; the call then runs again and gets the decision
        const decision = await approve(context, { title: `Deploy ${version}?`, timeoutMs: 60 * 60 * 1000 });
        if (!decision.approved) return `Not deployed: ${decision.reason ?? 'denied'}`;
        return deployVersion(version);
    },
});

const deployer = defineAgent({
    name: 'deployer',
    model,
    instructions: 'Deploy the requested version.',
    tools: { deploy },
});

const engine = new Engine({
    store,
    agents: [deployer],
});

// later, from the owner's answer to run.waiting
await engine.approve(runId, { approvalId, approved: true });
```

- `approve(ctx, { title, body?, timeoutMs? })` runs inside a tool call (its `execute` or the agent's `hooks`). It puts the run in `waiting` (`run.waiting` names the approval, `<stepIndex>:<toolCallId>:<n>`) and frees its slot; the approval survives restarts. Once answered, the call runs again from the start and `approve()` returns `{ approved, reason?, approver? }`, so code before it must be idempotent. Other calls of the same step that finished keep their results.
- `ctx.channels.findOneOrFail(name).approve({ title, address? })` is the same, with the request delivered through that channel.
- To gate a tool you did not write, call `approve()` in the agent's `beforeToolExecution` hook and throw `ToolDeniedError` for a denial.
- `engine.approve(runId, { approvalId, approved, reason?, approver? })` answers the current wait point, for a caller that authorized the approver itself. An answer is single use.
- An approval not answered within its `timeoutMs` (default 24 hours) is denied with the reason `approval timed out`.

### Invokers and tool access

A run can carry its invoker: who started it, as an authenticator resolved it (`@chamvi/http` sets it from the request's principal). `toolPolicy` decides per tool whether the run may use it; a refused tool is not offered to the model.

```typescript
const ops = defineAgent({
    name: 'ops',
    model,
    instructions: 'Operate the service.',
    tools: { deploy, rollback },
    // offers a tool only when the invoker holds tool:ops:<tool>; cron and webhook runs get none
    toolPolicy: requireToolPermission(),
    hooks: {
        // release managers deploy without asking
        async beforeToolExecution({ toolName, input }, ctx) {
            const { invoker } = ctx.run.trigger;
            if (toolName !== 'deploy' || (invoker && hasPermission(invoker.permissions, 'release:manage'))) return input;
            const decision = await approve(ctx, { title: 'Deploy?' });
            if (!decision.approved) throw new ToolDeniedError('Deploy denied.');
            return input;
        },
    },
});

const { runId } = await engine.dispatch({
    agent: 'ops',
    trigger: 'http',
    channel: 'http',
    payload: {},
    invoker: { id: 'u-42', kind: 'user', permissions: ['tool:ops:deploy'] },
});

// later, once the run waits: the approver is recorded on the run's wait step
const { approvalId } = (await engine.getRun(runId))!.waiting!;
await engine.approve(runId, { approvalId, approved: true, approver: { id: 'u-7', kind: 'user', permissions: [] } });
```

- The invoker (`{ id, kind, name?, permissions }`) is a snapshot taken at dispatch. A run keeps it across approvals and restarts; revoking a grant later does not reach a run that already holds it.
- With an invoker, the `idempotencyKey` is scoped to it (`<agent>:<channel>:<kind>:<id>`): only the same invoker's retry is deduplicated, another invoker with the same key gets its own run.
- Tool code sees it as `context.run.trigger.invoker` in tools and the factory and `ctx.run.trigger.invoker` in effect hooks and the agent hooks.
- The policy covers state tools too. A call to a refused tool that still arrives fails as a tool error and the run goes on: the step records it as `tool_not_allowed` (`ToolNotAllowedError`), whether the model called it anyway (the model sees the AI SDK's unavailable-tool error) or an approved call from an older history reached the engine's re-check.
- Permissions are `:`-separated: `*` alone grants everything, a `*` segment matches one segment, and segment counts must match. `requireToolPermission({ withoutInvoker: 'allow' })` lets runs without an invoker use every tool.

### Agent state

```typescript
const digest = defineAgent({
    name: 'digest',
    model,
    instructions: 'Track open loops across days.',
    state: { loops: z.object({ title: z.string(), due: z.string().optional() }) },
    tools: ({ state }) => ({
        countLoops: tool({
            inputSchema: z.object({}),
            execute: async () => (await state.collection('loops').list()).length,
        }),
    }),
});
```

- `state.get` and `state.set` are a key-value store per agent. Each declared collection holds documents, validated by its Standard Schema on upsert.
- The model also gets each collection as `state_<collection>_list`, `state_<collection>_upsert` and `state_<collection>_remove` tools; upsert and remove are effect tools.

### Stores and repositories

`createMemoryStore()` keeps everything in process memory, for development and tests. The factory assembles separate capability repositories (runs, steps, checkpoints, idempotency keys, locks, effects, state, artifacts, agent revisions and optional conversations) into a plain `IStore` aggregate, not a facade with forwarding methods, and proves their contracts with the shared contract suite from [`@chamvi/test-kit`](../test-kit):

```typescript
import { describeRepositoryContract } from '@chamvi/test-kit';

describeRepositoryContract((clock) => createMemoryStore({ clock }));
```

The factory receives a `ControllableClock` and must use it for every expiry decision. The suite runs on Vitest.

Repository queries use `findOne` and `find`, with matching `findOneOrFail` and `findOrFail` methods when absence should throw. Collection results keep their existing shape: `runs.find` returns `{ data, total }`, while `artifacts.find` returns an array. `OrFail` checks the selected result, so an empty page throws even when its total is nonzero. State values such as `null`, `false` and `0` are present. Domain mutations keep their specific names, such as `claim` and `beginTurn`.

### Context

A tool reaches a shared instance (an API client, the GitHub App, a workspace manager) through a typed key instead of a closure. The engine keeps the value by reference; `inject(ctx, key)` reads it in a tool's `execute`, in the tools factory and in the effect hooks, and nothing provided is ever stored or serialized (`ToolContext` is `{ run, state, artifacts, channels }` and gains no field for a provided value).

```ts
import { defineContextKey, defineTool, inject } from '@chamvi/core';

const DEPLOY = defineContextKey<IDeployClient>('deploy');

const deploy = defineTool({
    description: 'Deploys a version.',
    inputSchema: z.object({ version: z.string() }),
    execute: async ({ version }, { context }) => inject(context, DEPLOY).deploy(version),
});

engine.provide(DEPLOY, client); // once per key, after new Engine()
```

A missing value throws `ContextNotProvidedError` (`context_not_provided`, naming the key only): a tool error in `execute` and the effect hooks, a failed run (before any model call) in the tools factory. `tryInject(ctx, key)` returns `undefined` instead. `provide` refuses `undefined`, a key not from `defineContextKey()` and a second value for one key.

## Options

`new Engine(options)`:

| Option | Type | Default | Description |
|---|---|---|---|
| `store` | `IStore` | required | Where runs, steps, checkpoints and state live |
| `agents` | `Agent[]` | required | The agents this engine runs |
| `channels` | `IChannel[]` | `[]` | Channels by unique name, started by `start()` and stopped first by `drain()`/`stop()`; tools reach them through `ctx.channels` |
| `concurrencyMaxRuns` | `number` | `4` | Runs executing at once in this process |
| `model` | `ModelRef` | none | The model of agents without one; a string is checked through `models` at construction |
| `models` | `IModelResolver` | none | Resolves `'<provider>/<model id>'` strings; registration checks every string ref through it; without it a string ref is an `InvalidAgentDefinitionError` (pass a `LanguageModel` object) |
| `claimTtlMs` | `number` | `60_000` | Lease on a running run, renewed every `claimTtlMs / 3`; the poll for new work, expired approvals and abandoned runs uses the same interval |
| `owner` | `string` | `` `${hostname}-${pid}` `` | Identity of this replica in claims |
| `clock` | `IClock` | `systemClock` | Time source, replaceable in tests |
| `onError` | `(error, run?) => void` | `console.error` | Errors with no caller to throw to, such as a lost lease |

`defineAgent(definition)`:

| Field | Type | Default | Description |
|---|---|---|---|
| `name` | `string` | required | Unique per app, lowercase words joined by `-` |
| `model` | `ModelRef` | `EngineOptions.model` | A `'<provider>/<model id>'` string resolved through `EngineOptions.models`, or any AI SDK `LanguageModel` |
| `instructions` | `AgentInstructions` | required | A string or an ordered readonly array of native system/user/assistant messages |
| `channels` | `ChannelSubscription[]` | none | Subscriptions to channels registered on the engine |
| `tools` | `ToolSet \| (ctx) => ToolSet` | none | A plain tool set, or a factory called for each execution |
| `toolsContext` | `Record<string, unknown>` | none | Per tool name, the context of a tool that is not chamvi's, passed through by reference |
| `state` | `Record<string, StandardSchemaV1>` | none | Typed state collections |
| `toolPolicy` | `(toolName, { run }) => boolean` | none | Tools the run may use, e.g. `requireToolPermission()` |
| `budget` | `{ maxSteps, maxTokens?, timeoutMs? }` | `{ maxSteps: 20, timeoutMs: 900_000 }` | Per run; the timeout applies to each execution |
| `hooks` | `AgentHooks` | none | `beforeToolExecution` / `afterToolExecution` around every tool call: rewrite input or output, gate a tool with `approve()` |
| `output` | `Output` | none | AI SDK structured output; a completed run's `output` is the parsed value |

## Structured instructions

Strings remain shorthand for one system message. Native message types are available directly from core:

```ts
import { defineAgent } from '@chamvi/core';
import type { AgentInstructions, SystemModelMessage, UserModelMessage } from '@chamvi/core';

const policy: SystemModelMessage = { role: 'system', content: 'Summarize the report.' };
const example: UserModelMessage = { role: 'user', content: [{ type: 'text', text: 'All checks passed.' }] };
const instructions: AgentInstructions = [policy, example, { role: 'assistant', content: 'Ready to release.' }];
const agent = defineAgent({ name: 'reporter', instructions });
```

System content is a string; user/assistant content and `providerOptions` use their native SDK types. Leading system blocks go through SDK `instructions`; the remaining messages stay in order before the run transcript, including any later system blocks. First-class skills append a separate metadata system block. These configured messages are transient: they hydrate artifact markers for model/tool context, stay out of checkpoints and conversation history, and never become pending replay calls. Recalled conversation messages follow this configured prefix, and approval resume uses the captured conversation snapshot. Resumed executions rebuild them from the current definition. Stored transcript system roles are rejected before replay/model work. Manual `SkillCatalog.instructions` remains a string for explicit composition.

See the [instructions guide](https://chamvi.dev/guide/agents#instructions) for the typed example and role-specific content limits.

## API

| Export | Kind | Purpose |
|---|---|---|
| `AgentInstruction`, `AgentInstructions` | type | Native system/user/assistant message union and string-or-readonly-array configuration |
| `SystemModelMessage`, `UserModelMessage`, `AssistantModelMessage`, `ModelMessage` | type | Identity-preserving native SDK message types |
| `UserContent`, `AssistantContent`, `TextPart`, `ImagePart`, `FilePart` | type | Native SDK content and part types |
| `defineAgent` | function | Validates an agent definition and applies defaults |
| `DEFAULT_MAX_STEPS`, `DEFAULT_TIMEOUT_MS` | constant | The default budget: `20` steps, `900_000` ms |
| `Engine` | class | `store`, `clock`, `getAgent`, `listAgents`, `putAgent`, `removeAgent`, `getChannel`, `listChannels`, `provide`, `start`, `dispatch`, `getRun`, `on`, `approve`, `cancel`, `recover`, `tick`, `idle`, `stop`, `drain` |
| `createMemoryStore()` | function | Assembles independent in-memory repositories, including conversations |
| `defineTool` | function | An AI SDK `tool()` whose `execute` gets the run's `ToolContext` as `context` |
| `defineContextKey`, `inject`, `tryInject` | function | Typed context keys, and reading a value provided on the engine from a `ToolContext` |
| `toolContextSchema` | object | The `contextSchema` that marks a chamvi tool |
| `defineEffectTool`, `effectMarker` | function | Recorded side-effecting tools and their hidden marker |
| `EFFECT` | symbol | Marks a tool created by `defineEffectTool()` |
| `wrapToolsForRun` | function | `wrapToolsForRun(tools, ctx, store, { allow?, hooks? })`: applies effect recording and the agent hooks to a `ToolSet` outside the engine, with a `ToolContext`; an optional `allow(toolName)` re-checks each call (a refused call throws `ToolNotAllowedError`) |
| `approve` | function | `approve(ctx, { title, body?, timeoutMs? })`: a durable approval from inside a tool call |
| `DEFAULT_APPROVAL_TIMEOUT_MS`, `APPROVAL_TIMEOUT_MAX_MS` | constant | `86_400_000` (24 h), `2_147_483_647` |
| `createAgentState`, `createStateTools` | function | State API over a store, and `createStateTools(schema)`, the generated state tools (they read `context.state`) |
| `hasPermission`, `matchesPermission`, `toolPermission` | function | Permission matching and the `tool:<agent>:<tool>` permission |
| `requireToolPermission` | function | A `toolPolicy` that checks the invoker's permissions |
| `consoleChannel` | function | `consoleChannel({ name?, write? })`: a development channel, out only, logging each message (default name `console`, default `write` `console.log`) |
| `assertTriggerKey`, `normalizeEnvelope` | function | The 255-character, no-NUL rule for envelope keys and addresses; the read-back of envelopes stored before channels (`source`, `thread`) for store implementations |
| `isArtifactMediaType` | function | The media type rule for attachments and artifacts (`type/subtype`, no parameters) |
| `artifactFilePart` | function | The file item a tool's `toModelOutput` returns for an artifact: the marker in steps and checkpoints, the bytes for the model |
| `ChamviError` | class | Base class of every error below |
| `InvalidAgentDefinitionError`, `InvalidRunStateError`, `RunNotFoundError`, `ArtifactNotFoundError` | class | Rejections of definitions and engine calls |
| `BudgetExceededError`, `FatalToolError`, `IncompleteResponseError`, `LeaseLostError`, `TimeoutError`, `ValidationError` | class | Run failures and reported conditions; `ValidationError.issues` holds the validup issues |
| `ContextNotProvidedError` | class | `inject()` found no value for the key (`context_not_provided`) |
| `ChannelNotFoundError` | class | `ctx.channels.findOneOrFail()` named a channel the engine does not have or one without `out` (`channel_not_found`) |
| `ToolNotAllowedError` | class | The tool error recorded for a call to a tool the `toolPolicy` refuses |
| `ToolDeniedError` | class | A gate (e.g. a `beforeToolExecution` hook) refused a tool call (`tool_denied`); a tool error, never fatal |
| `SandboxError` | class | A sandbox workspace or provider failed (`@chamvi/sandbox` and its providers); a tool error, never a failed run |
| `ErrorCode` | object | The `code` of every error above |
| `systemClock` | object | The default `IClock` |

Types: `Agent`, `AgentDefinition`, `ToolContext`, `ContextKey`, `IContextProvider`, `ToolPolicy`, `AgentHooks`, `ToolCallInfo`, `TriggerEnvelope`, `Invoker`, `Run`, `RunStatus`, `Step`, `Checkpoint`, `WaitPoint`, `Budget`, `Usage`, `ApprovalRequestInput`, `ApprovalDecision`, `ApprovalAnswer`, `IStore` and its capability interfaces, `MemoryStoreOptions`, `Artifact`, `ArtifactInput`, `IRunArtifacts`, `IChannel`, `ChannelSubscription`, `ChannelContext`, `ChannelMessage`, `ChannelSendOptions`, `ChannelHandle`, `EmitMessage`, `ConsoleChannelOptions`, `IAgentState`, `RunEvent`, `EngineOptions`, `ModelRef`, `IModelResolver`, `IClock`.

Test helpers (`ControllableClock`, `describeRepositoryContract`) live in [`@chamvi/test-kit`](../test-kit).

## Notes

`EngineOptions.skills` supplies defaults for every agent; `AgentDefinition.skills` adds scoped extras. Both accept the generic `SkillInput` protocol from core. Import skill data types, `gitSkills`, `loadSkillBundle`, custom adapters (`defineSkill`, `defineSkillSource`) and catalogs from optional [`@chamvi/skills`](../skills/README.md). Its factory values carry the runtime automatically, with no module registration. Core coordinates preparation, cancellation and ordinary contributed-tool execution; the optional package owns validation, contents, catalogs and caches. Core works without skills installed.

- **A tool error does not fail the run.** It goes back to the model as a tool error result. Throw `FatalToolError` to fail the run; the step budget caps retry loops.
- **Budgets settle runs.** A run stopped by `maxSteps` or `maxTokens` while the model still wanted to call tools fails with code `BudgetExceeded`; a run that hits its timeout fails with code `Timeout`.
- **Effects are recorded after they happen.** A crash between a tool's side effect and the store write repeats the effect on resume, unless `alreadyApplied` finds it.
- **Several approvals in one step are handled one at a time.** The run waits on the first in call order; the other suspended calls stay pending and ask again after the resume, before any further model call.
- **`createMemoryStore()` is not durable.** Everything is gone with the process; use a persistent store to survive restarts or to run replicas.
- **`stop()` stops polling and the channels.** It resolves once every channel stopped; runs in progress continue, so use `drain()` to shut down.

## License

Published under [Apache License 2.0](./LICENSE).
