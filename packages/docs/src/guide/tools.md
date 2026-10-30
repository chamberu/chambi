# Tools & Tool Errors

chamvi tools are AI SDK tools. Build them with `tool()` from `ai`, or with `defineTool()` when a tool needs the run context (`context.run`, `context.state`, `context.artifacts`; see [Tools and their context](/guide/agents#tools-and-their-context)), and pass them to the agent's `tools`. The engine applies policy checks, hooks and declared trust gates around local execution; [effect tools](/guide/effect-tools) also record their results so their side effect applies at most once per effect key.

## Untrusted content and outbound tools

`defineTool()` and `defineEffectTool()` accept `trust` classifications:

```ts
trust: {
    untrustedResult: true,
    outbound: async (input, ctx) => input.destination !== ctx.run.trigger.address,
}
```

Each flag accepts a boolean or `(input, ctx) => boolean | Promise<boolean>`. `untrustedResult` marks content returned by an external reader; `outbound` marks an operation that can send content to another destination. The engine evaluates predicates against the final input after `beforeToolExecution` and input validation. An effect tool is not automatically outbound, and a third-party tool is **trusted by default** until classified.

Classify third-party tools or override a tool's flags by its name in the agent's tool set:

```ts
trust: {
    onTainted: 'approve', // default; use 'deny' to reject outbound calls
    tools: {
        external_search: { untrustedResult: true },
        send_report: { outbound: true },
    },
}
```

Agent overrides accept **booleans only**, including `false` to replace a tool's classification. `IChannel.untrusted: true` opts an input channel into the same boundary; GitHub and the generic webhook channel opt in. The first exposure is persisted as optional `Run.taint: { at: Date, source: string }` before an untrusted result reaches the model. It survives approval replay and recovery, propagates to handoff children, and is conservatively set when conversation messages or notes are recalled. Failed taint persistence fails execution rather than returning unrecorded content.

Once tainted, an outbound call requires a durable approval by default, or becomes a `ToolDeniedError` with `onTainted: 'deny'`. The check runs before effect lookup/execution. Decisions bind the final arguments, so changed arguments need another approval. Full arguments stay in the private inbox/API; source-channel notifications contain only a generic review notice. See [Automatic outbound gates](/guide/approvals#automatic-outbound-gates).

Channel sends to the run's original source destination or a configured `defaultAddress` are exempt. This fixes the **destination**, not the content: it does not sanitize a message or prevent sensitive data from being sent there.

### Quarantined extraction

Use `extract(ctx, { schema, content, instructions?, model? })` from `@chamvi/core` inside an executing tool call to return only validated structured data from a separate, tool-less model call. It uses `resolveModel()` and requires a schema with an output validator. The helper's raw content, model messages and provider error details do not enter the parent transcript; failures become a generic `ValidationError`.

Only a conservative JSON Schema allowlist can avoid adding taint: literal enums/constants, booleans/null, numbers, closed objects, arrays of at most 10 allowed items, and patterned strings of at most 200 characters. References, combinators, unknown keywords and unrestricted strings are outside it and taint the run as `extract`, including on replay. Existing taint is never cleared. SDK schema validation is followed by an independent check of the actual returned value against the allowed structure, including transformed values. The effect cache stores versioned **raw model JSON**, not a transformed result; a cache hit validates that raw value again and repeats the independent check before returning. This cache is private durable storage, not a parent-transcript message or a place to store credentials.

Prefer string model references for durable memoization. Explicit `LanguageModel` object overrides bypass the effect cache: objects with the same provider and model id can still use different endpoints or middleware. With no override, extraction uses a separate configured-default cache namespace and assumes that model configuration stays stable across resumes of the run. String overrides are keyed by their reference and make the same stable-configuration assumption.

Extraction calls, like other model calls made inside tools, do not count toward the parent loop's step/token budgets or `run.usage`. They do receive the run's abort signal, including its execution timeout. See [Budgets & Timeouts](/guide/budgets).

Allowed structure is not a guarantee of truthful or harmless values. Returning raw content alongside the extraction defeats the quarantine. The content still reaches the selected model provider, which is outside this boundary.

### What is not covered

Shell execution is **not gated**, even when its output taints a run; it can read, write or exfiltrate. Shell command policy and classifier work (#88) are separate. Agent state remains trusted pending separate provenance work. Provider-executed tools without local `execute` are not locally gated. GitHub read tools send model-selected queries, paths and refs to the GitHub API without an outbound gate. If its operator or request logs must not receive arbitrary run data without approval, classify those readers as outbound via `trust.tools`. These controls are not a sandbox, DLP system or complete prompt-injection defense.

## Errors go back to the model

When a tool throws, the AI SDK turns the error into a tool error result and the model sees it on its next call. It can retry, try something else or give up. The run does not fail, and the step is recorded as a `tool` step with `error: { code, message }`.

The [step budget](/guide/budgets) caps retry loops: a model that keeps calling a failing tool runs out of steps and the run fails with `BudgetExceeded`.

## FatalToolError fails the run

Throw `FatalToolError` when continuing makes no sense: a missing credential, a forbidden target, a broken invariant.

<<< @/snippets/tools.ts#fatal

The run fails with `error.code` `FatalToolError`, or the code you pass as the second constructor argument (`new FatalToolError(message, 'MissingToken')`). The other tool calls of the same step still complete and are recorded before the run settles.

Infrastructure failures fail the run as well, such as a store write that throws. A run whose agent this engine does not hold (not loaded yet, failed to load, or loaded at an older [folder](/guide/agent-folders) revision) does not fail: it stays `queued` for a replica that has the agent's current code.

## Cancellation inside tools

Every tool built with `defineTool()` gets `context.run.signal` (a factory gets it as `run.signal`). It aborts on cancel, drain, timeout and a lost lease, and once the execution has ended (so work a tool left running does not outlive it). Pass it to `fetch`, child processes and other cancellable work so an aborted run stops quickly.

## Tools with side effects

A recovered run repeats the step that was in progress when the process died. A plain tool that posts a comment would post it again. Use [`defineEffectTool()`](/guide/effect-tools) for every tool that changes something outside the run.

## Web research tools

[`@chamvi/tool-web`](/reference/tool-web) gives an agent `web_fetch`: any public page as markdown (or text, or the raw body), a registry document such as `https://registry.npmjs.org/<name>` as JSON. It runs in the chamvi process through a [hapic](https://github.com/tada5hi/hapic) client that takes the proxy from `HTTP_PROXY`/`HTTPS_PROXY`, and reaches public addresses only: every URL and redirect target is resolved and refused when it points at a loopback, private, link-local or metadata address (`allowUrl` can open an internal host). Release notes between two versions of a GitHub project come from `@chamvi/github`'s `github_list_releases` and `github_compare`.

<<< @/snippets/tool-web.ts#agent

Everything the tool returns is written by strangers, and a page can carry instructions aimed at the model. `web_fetch` declares `trust.untrustedResult: true`, so its results taint the run. Say so in the instructions too, and classify outbound tools or keep side effects behind [approvals](/guide/approvals) when an agent reads the web.

## Restricting tools per invoker

A run started through `@chamvi/http` (REST or MCP) carries its **invoker**, `run.trigger.invoker`: `{ id, kind, name?, permissions }` of the authenticated principal (`kind` is the authenticator's label: `staticTokens()` sets `token` and `authup()` sets `authup`; `oidc()` keeps the kind its `principal` mapper returns, `oidc` in these docs). Cron and webhook runs have none. An agent's `toolPolicy(toolName, { run })` decides per tool whether the run may use it, and a refused tool is not offered to the model at all.

`requireToolPermission()` is the built-in policy: it offers a tool when the invoker holds `tool:<agent>:<tool>` (with the usual matching: `*` alone grants everything, a `*` segment matches one segment). Runs without an invoker get no tools unless you pass `{ withoutInvoker: 'allow' }`. Wrap it for exceptions:

<<< @/snippets/tools.ts#policy

- The policy covers the whole tool set, the generated [state tools](/guide/state) included.
- The invoker is a snapshot taken at dispatch. A run keeps it across approvals and restarts, so its tool set stays the same; revoking a grant later does not reach a run that already holds it.
- A model that calls a refused tool anyway gets the AI SDK's unavailable-tool error as the tool result; the tool step records it with code `tool_not_allowed`. The run goes on.
- The engine re-checks every call when it executes. A pending call that runs after an approval (e.g. a policy tightened before the approval was answered) gets a `ToolNotAllowedError` tool error and the run goes on.
- The invoker only ever comes from an authenticator, never from a request body or payload.
- A tool reads the invoker as `context.run.trigger.invoker`.

## Third-party tools with their own context

A tool from another library may declare its own `contextSchema` and expect its context through the AI SDK. Give it one with the agent's `toolsContext`, keyed by tool name:

<<< @/snippets/tools.ts#third-party

- chamvi passes each entry unchanged, by reference, to the tool of that name: to every call of every run of the agent, so the value must be safe to share. It is never cloned, validated or stored; the tool's own `contextSchema` validates it.
- A tool without any `contextSchema` gets its entry too (the AI SDK hands it over unvalidated).
- An entry naming a chamvi tool (built with `defineTool()`/`defineEffectTool()`, the state tools included) or no tool of the agent is a misconfiguration: with a plain tool set `defineAgent()` throws `InvalidAgentDefinitionError`; with a factory (whose set is only known per execution) the run fails with that error (`invalid_agent_definition`) before any model call. A factory that returns a tool only sometimes must leave its entry out and close over the value instead.
- Without an entry, a tool whose `contextSchema` requires a value fails the run (the AI SDK validates the context outside its tool-error handling); an optional schema gets `undefined`.
- An entry the tool's `contextSchema` rejects fails the run the same way, with `validation_error`. The run error names the tool and the failing paths only, never the entry's value, so a key in it is not stored or served with the run.

## Context: shared instances for tools

A tool that needs a shared instance (an API client, the GitHub App, the workspace manager) does not have to close over it. Define a typed key once, provide the value on the engine, and inject it from the tool's context:

<<< @/snippets/context.ts#define

<<< @/snippets/context.ts#provide

<<< @/snippets/context.ts#inject

- `defineContextKey<T>(name)` returns a new key per call: two keys of one name are independent, the name only appears in messages.
- `engine.provide(key, value)` keeps the value **by reference**. It refuses a key that is not from the `defineContextKey()` of the engine's `@chamvi/core` (also a key of another copy, which a package resolving its own `@chamvi/core` would hold), `undefined` and a second value for one key (`InvalidAgentDefinitionError` naming the key). A value provided after `engine.start()` reaches the next execution.
- `inject(ctx, key)` returns the value or throws `ContextNotProvidedError` (`context_not_provided`, the message names the key, never a value); `tryInject(ctx, key)` returns `undefined` instead.
- It works on the `ToolContext` the engine passed: in a tool's `execute` (`context`), in the [tools factory](/guide/agents#tools-and-their-context) and in the [effect hooks](/guide/effect-tools) (`alreadyApplied`, `effectKey`), which all see the same object. A spread copy (`{ ...ctx }`) or a hand-built context has no values.
- Where it fails decides what fails: in `execute` or an effect hook a missing value is a tool error the model sees, and the run goes on; in the tools factory the run fails before any model call (and the engine's `onError` gets the error). Inject in the factory when the agent cannot work without the value.
- Provided values are never stored or serialized: `ToolContext` keeps exactly `run`, `state`, `artifacts` and `channels`, and no step, checkpoint or run holds a provided value.
- `toolsContext` entries are something else: values the AI SDK hands to third-party tools by tool name. Context is for chamvi tools and factories, keyed by value type.

The optional [app modules](/guide/app#modules) provide their instances this way, each through a pair of its package: `injectGithubContext(ctx)` (`@chamvi/github`) and `injectSandboxContext(ctx)` (`@chamvi/sandbox`). Without the app, call the matching `provide*Context(engine, value)` after `new Engine()`. Channels need no context pair: the engine provides every registered channel, and a tool reaches one with [`ctx.channels.findOne(name)`](/guide/channels#outbound-from-tools).
