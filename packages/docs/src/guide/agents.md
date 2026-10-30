# Agents

An agent is a typed config object passed to `defineAgent()`. It names a model, its instructions, the channels that may start it, its tools and tool hooks, a budget and typed state.

<<< @/snippets/agents.ts#define

## What `defineAgent()` checks

`defineAgent()` validates the definition and returns `{ name, definition }` with defaults applied. It throws `InvalidAgentDefinitionError` when:

- the name does not match `^[a-z0-9]+(-[a-z0-9]+)*$` (lowercase words joined by single hyphens), or is longer than 64 characters,
- instructions are neither a string nor an array of native system/user/assistant messages (tool roles are refused),
- two subscriptions of the agent share an id,
- the agent's or a subscription's `concurrencyMaxRuns` is neither `undefined`, `false` nor a positive safe integer,
- `trust.onTainted` is neither `'approve'` nor `'deny'`, or a `trust.tools` override has invalid flags or names no available tool (names are checked at execution when a tools factory, state or non-empty skills are declared; flags are always checked at definition),
- a tool of a plain tool set declares the AI SDK's `needsApproval` (use [`approve()`](/guide/approvals) instead),
- a `toolsContext` entry names a chamvi tool or no tool of a plain tool set (see [Third-party tools with their own context](/guide/tools#third-party-tools-with-their-own-context)).

The engine checks the rest when you construct it: agent names must be unique within one `Engine`, and every subscription must name a channel registered on the engine.

<<< @/snippets/agents.ts#defaults

## Fields

| Field | Type | Default | Description |
|---|---|---|---|
| `name` | `string` | required | Unique per engine, lowercase words joined by `-`, at most 64 characters |
| `model` | `ModelRef` | `EngineOptions.model` | A `'<provider>/<model id>'` string resolved through `EngineOptions.models`, or any AI SDK `LanguageModel` |
| `instructions` | `AgentInstructions` | required | A string or an ordered readonly array of native system/user/assistant messages |
| `concurrencyMaxRuns` | `number \| false` | none | Shared-store ceiling for this agent's running runs; positive safe integer, or `false` for no additional ceiling |
| `channels` | `ChannelSubscription[]` | none | From `http.on()`, `webhook.on()`, `cron.on()`, `github.on()`. See [Channels](/guide/channels) |
| `tools` | `ToolSet \| (ctx) => ToolSet` | none | A plain tool set, or a factory called for each execution. See [Tools and their context](#tools-and-their-context) |
| `trust` | `AgentTrust` | `{ onTainted: 'approve' }` | Untrusted-run outbound policy and boolean tool-name classifications. See [Untrusted content](/guide/tools#untrusted-content-and-outbound-tools) |
| `toolsContext` | `Record<string, unknown>` | none | Per tool name, the context of a third-party tool. See [Tools](/guide/tools#third-party-tools-with-their-own-context) |
| `toolPolicy` | `(toolName, { run }) => boolean` | none | Tools the run may use, e.g. `requireToolPermission()`. See [Restricting tools per invoker](/guide/tools#restricting-tools-per-invoker) |
| `state` | `Record<string, StandardSchemaV1>` | none | Typed state collections. See [Agent State](/guide/state) |
| `budget` | `Partial<Budget>` | `{ maxSteps: 20, timeoutMs: 900_000 }` | See [Budgets & Timeouts](/guide/budgets) |
| `hooks` | `{ beforeToolExecution?, afterToolExecution? }` | none | Run around every tool call: rewrite input or output, gate a tool with `approve()`. See [Approvals & Hooks](/guide/approvals#gating-tools-you-did-not-write) |
| `output` | `Output` | none | AI SDK structured output, e.g. `Output.object({ schema })`. See [Structured output](#structured-output) |

The budget you pass is merged over the defaults, so `budget: { maxSteps: 5 }` keeps the 15 minute timeout.

## Instructions

A string remains shorthand for one system message. For structured instructions, import `AgentInstructions`, `SystemModelMessage`, `UserModelMessage` and `AssistantModelMessage` from `@chamvi/core` (also re-exported by `@chamvi/app`):

<<< @/snippets/instructions.ts#instructions

These message types are the native AI SDK types. System content is a string; user and assistant content retain their respective SDK multipart unions, including file data, URLs and provider options. Core also exports native `ModelMessage`, `UserContent`, `AssistantContent`, `TextPart`, `ImagePart` and `FilePart`. Provider support and SDK content validation still apply. The installed AI SDK deprecates `image` content parts in favor of `file` parts with an image media type; native `ImagePart` remains available for compatibility.

The engine sends the longest leading system prefix through SDK `instructions`. It keeps the rest, including any later system messages, in authored order before the run transcript. First-class [skills](/guide/skills) append a separate metadata-only system block after the configured instructions. For example, a string role plus skills produces two system blocks; an example conversation followed by skills keeps the catalog after those examples.

Configured messages are trusted operator inputs. They are rebuilt once for each execution and appear once per model prompt, including after an approval pause. They are never stored in checkpoints or conversation history, or replayed as pending tool calls. Recalled conversation messages follow this configured prefix; approval resume uses the captured conversation snapshot. Artifact file markers in examples hydrate for model and tool context without changing configuration or checkpoints. A restored run transcript containing a system role is rejected before replay or model work; role-like text in a trigger payload stays user content.

## Tools and their context

`tools` is usually a plain AI SDK `ToolSet`, defined once at module scope (see the example above). Tools built with `defineTool()` (or [`defineEffectTool()`](/guide/effect-tools)) get the run context as `context`, the second argument of `execute`:

| Field | Type | Description |
|---|---|---|
| `state` | `AgentState` | The agent's [state](/guide/state) |
| `run.runId` | `string` | Id of the run being executed |
| `run.agent` | `string` | Agent name |
| `run.trigger` | `TriggerEnvelope` | The envelope that started the run; `run.trigger.invoker` is who started it, if an authenticator knew |
| `run.signal` | `AbortSignal` | Aborts on cancel, drain, a lost lease or the run timeout, and once the execution has ended |
| `artifacts` | `IRunArtifacts` | The run's files: `put()`, `get(id)`, `list()`. See [Files](#files) |

The engine builds one `ToolContext` per execution and hands it, through the AI SDK's `toolsContext`, to every tool whose `contextSchema` is chamvi's `toolContextSchema`, which is what `defineTool()` sets. Other tools (a plain `tool()`, a third-party tool) get no chamvi context. Every call of an execution gets the same object: treat it as immutable. It holds `run`, `state`, `artifacts` and `channels`, the run-bound handles a tool sends through (see [Outbound from tools](/guide/channels#outbound-from-tools)). Pass `context.run.signal` on to `fetch` and other cancellable work.

For typed state, name the schema: `defineTool<Input, Output, typeof schema>({ ... })` types `context.state` by the agent's collections. The agent does not check that schema against its own `state`: a tool typed for other collections still compiles, and at run time reads of an undeclared collection are empty and writes fail as tool errors.

`tools` can also be a factory `(ctx) => ToolSet`, called once per execution with the same `ToolContext`. Use it for dynamic sets: tools from an MCP client, or descriptions built from async state (a tool's `description` function runs synchronously, so it cannot read the store itself).

The tools stay plain AI SDK tools. When the agent declares `state`, the engine adds generated state tools; your tools win on a name clash. Every [effect tool](/guide/effect-tools) is then wrapped so it applies at most once per effect key.

## Structured output

By default a completed run's `output` is the text of the model's last answer. With `output`, an AI SDK `Output`, `output` is the parsed value instead:

<<< @/snippets/agents.ts#output

The model may call tools first; only the final answer is parsed. A final answer that is no valid JSON or fails the schema fails the run with `ValidationError` (`run.error.code` `validation_error`, the message from the AI SDK's cause, its quoted text cut to 500 characters; the whole answer stays in the `llm` step). Two loop ends have no answer to parse and fail the run with `IncompleteResponseError` (`incomplete_response`) instead: an answer cut off at the output token limit (finish reason `length`), and a loop that ended on a tool call nothing executed (a tool without `execute`, outside a budget stop). A run whose step budget an earlier execution used up parses the last answer in its checkpoint the same way. An agent without `output` keeps completing with the text it got in both cases.

The `ToolLoopAgent` gets your `Output` with one change: its `parsePartialOutput` is not called while the answer streams (chamvi reads no partial output, and re-parsing the growing answer on every delta costs time). `run.delta` events arrive per model delta, as without `output`.

## Files

A run can start with files ([attachments](/guide/channels#attachments)) and tools can store files of their own. Both are artifacts of the run: metadata (`id`, `runId`, `agent`, `mediaType`, `filename?`, `size`, `createdAt`) plus the bytes, kept in the store's `IArtifactRepository`. The `artifacts` of the tool context is scoped to the run: `put({ mediaType, filename?, data })` stores a `Uint8Array` and returns the `Artifact`, `get(id)` returns `{ artifact, data }` (or `undefined`, also for another run's artifact) and `list()` returns the run's artifacts by `createdAt` (attachments in the order they were given, ids `<runId>.0000`, ...; tool files get random UUIDs).

<<< @/snippets/agents.ts#artifacts

`put()` is not an effect by itself: a recovered run repeats the step in progress, so call it inside a [`defineEffectTool`](/guide/effect-tools) to store a file exactly once. Over HTTP, `GET /runs/:id/artifacts` lists them and `GET /runs/:id/artifacts/:artifactId` downloads one (see [HTTP API](/guide/http#files)).

## Many agents per engine

One engine runs any number of agents. They share the store, the engine's local concurrency limit and the channels. Optional agent and subscription ceilings also apply across replicas sharing the store; see [Concurrency](/guide/concurrency):

<<< @/snippets/engine.ts#many

`dispatch()` names the agent per run. An agent the engine does not hold throws `AgentNotFoundError` (`agent_not_found`, 404 over HTTP).

The set can change while the engine runs: `engine.putAgent(agent)` adds an agent or replaces the one of the same name, `engine.removeAgent(name)` removes it, and both emit `agents.changed` (`{ name, kind: 'added' | 'replaced' | 'removed' }`), which the cron channel and `@chamvi/http` follow. Replacing or removing an agent first cancels its unsettled runs. An app loads such agents from a folder: see [Agent Folders](/guide/agent-folders).

Pass `engine.putAgent(agent, { signal })` to cancel candidate preparation before registry changes. Cancellation leaves the previous registration, revision marker and unsettled runs intact. Once a registry operation starts, it finishes with local publication even if the caller or engine stops, keeping the registration and durable state consistent. Folder loading forwards the app shutdown signal through preparation and publication.
