# Approvals & Hooks

A tool call can wait for a human. The tool calls `approve()`, the run pauses in `waiting` and frees its slot, and once the owner answers (minutes or days later, on any replica, after any number of restarts) the call runs again and `approve()` returns the decision. Agent hooks put the same gate in front of tools you did not write.

## Automatic outbound gates

A tool classified with `trust.outbound` also pauses automatically when its run has encountered [untrusted content](/guide/tools#untrusted-content-and-outbound-tools). `AgentDefinition.trust.onTainted` defaults to `'approve'`; `'deny'` rejects the operation with `ToolDeniedError` instead. Third-party tools are trusted until explicitly classified. Shell execution and provider-executed tools are outside this local gate.

The gate runs after `beforeToolExecution` and validation of rewritten input, but before effect lookup or execution. Its decision is bound to the operation and final arguments, not just the tool-call id: replay with changed arguments asks again. Ordinary `approve()` calls keep their ordinal identity described below.

The full arguments and taint details are visible in the **private approval inbox and authenticated API**. A source-channel notification contains only a generic request to review the inbox, plus its approval link when configured; it does not copy the argument-bearing approval body. This redaction applies to automatic trust gates, not arbitrary bodies you put into `ChannelHandle.approve()` yourself. Do not include secrets in source-visible approval text.

Channel sends to the run's original source destination or a configured `defaultAddress` are exempt. The destination is fixed, not the content; this exemption does not make sensitive messages safe to publish.

## Asking from a tool

<<< @/snippets/approvals.ts#tool

`approve(ctx, { title, body?, timeoutMs? })` resolves `{ approved, reason?, approver? }`. It works only inside a tool call (its `execute`, or an agent hook); anywhere else it throws `InvalidRunStateError`. `timeoutMs` defaults to 24 hours (`DEFAULT_APPROVAL_TIMEOUT_MS`) and may not exceed `2^31 - 1` ms.

How it survives a restart:

1. The first time, `approve()` has no decision for this call. It records the request and suspends the call; nothing is sent yet.
2. The step ends. The engine saves the checkpoint with the suspended call **pending** (the assistant message keeps every tool call, the tool message keeps the results of the calls that finished), stores the **wait point** (`run.waiting`: `approvalId`, `toolName`, `toolCallId`, `title`, `body?`, `channel?`, `address?`, `expiresAt`) and moves the run `running` to `waiting`, releasing its claim and slot. A run with a concurrency key keeps the key blocked while it waits.
3. An answer records the decision, appends a `wait` step and moves the run to `queued`.
4. The next execution first runs the pending calls (no model call): the tool starts again from the top, and this time `approve()` returns the recorded decision. Their results join the checkpoint, then the model loop goes on and the model sees the tool's result.

The approval id is `<stepIndex>:<toolCallId>:<n>`: the checkpoint index of the model step that made the call (so a provider that reuses a call id in a later step is asked again), the call id, and `n` counting the `approve()` calls of one tool call, so a tool may ask twice (the second question pauses again after the first was answered).

::: warning Code before approve() runs again
On resume the tool runs from the start. Whatever it did before `approve()` happens twice, exactly like a step redone after a crash: keep it idempotent, or move side effects into [effect tools](/guide/effect-tools).
:::

Other rules:

- **One approval per pause.** When several calls of one step suspend, the run waits on the first in call order; the others stay pending and ask again after the resume, before any model call. Calls of the step that finished keep their results and do not run again.
- **Pending calls get the same checks as the model's.** The `toolPolicy`, the tool's input schema, a third-party tool's context schema and the agent hooks apply again when a pending call runs; a tool the policy now refuses answers `ToolNotAllowedError`.
- **Budget.** A resumed approval gets one step beyond `maxSteps`, so an approval on the last step is still answered.
- **Streaming tools** (an `execute` returning an async iterable) cannot call `approve()` in their body (`InvalidRunStateError`); gate them in `beforeToolExecution`.
- AI SDK tools that declare their own `needsApproval` are refused when the agent is defined (`InvalidAgentDefinitionError`; a tools factory fails the run), since nothing answers that request.

## Offering options

An approval can offer choices instead of a plain yes or no:

<<< @/snippets/approvals.ts#choice

`approve(ctx, { title, body?, options?: [{ id, label, detail? }], multiple?, timeoutMs? })` resolves `{ approved, reason?, approver?, selected? }`. The owner picks one option (with `multiple: true` one or more) and approves, or denies; `selected` holds the chosen ids in the order of `options`, only on an approval. "None of them" is a denial with a reason.

- **Limits** (`ValidationError`, a tool error): 1 to `APPROVAL_OPTIONS_MAX` (20) options; ids match `APPROVAL_OPTION_ID_PATTERN` (up to 128 characters without whitespace, such as `unicorn/no-null`, `@typescript-eslint/no-explicit-any`, `1.2.3` or a branch name) and are unique; a label is one non-blank line (no control character, line or paragraph separator) of at most `APPROVAL_OPTION_LABEL_MAX_LENGTH` (200) characters; a `detail` has at most `APPROVAL_OPTION_DETAIL_MAX_LENGTH` (20 000) characters, all details together at most `APPROVAL_OPTIONS_DETAIL_MAX_LENGTH` (100 000); `multiple: true` needs `options` (`multiple: false` without options is a plain request). Other keys of an option are dropped.
- **Where they show**: the wait point (`run.waiting.options`, `multiple` only when true) and the `wait` step's input keep the options; the dashboard renders each as a radio or checkbox with its `detail` as preformatted text (a diff colored by line); channels list `<id>: <label>` and link to the dashboard, never the detail.
- **Replay**: on resume `approve()` returns the recorded decision (the request is still validated first), its `selected` in the order of the options the tool passes now. When those options no longer fit the recorded answer (an id the request does not offer any more, a single choice that was a multiple one, options added to a plain request or removed from one), it returns a denial with the reason `options changed` instead, so a tool never gets an id it did not offer. A recorded denial is returned as is.

## Asking through a channel

`approve()` on its own asks the [dashboard inbox](/guide/ui) and the API only. To ask where the owner is, call it on a [channel](/guide/channels):

<<< @/snippets/approvals.ts#channel

Once the wait point is stored, the engine sends one message of kind `approval` through the channel's `out` (key `<runId>:<approvalId>`, with the title, body, `approvalId` and `expiresAt`) and records `waiting.notifiedAt`. A failed send leaves it unset and `tick()` re-sends on every poll until one succeeds, under a store lock per approval so replicas never send at once; a crash between storing the wait point and the send re-sends under the same key. Channels link to the approval in the UI. On GitHub the request becomes a comment on the run's issue, on OpenClaw a chat message.

## Gating tools you did not write

The coding tools, the GitHub tools and any third-party tool have an `execute` you cannot edit. Agent `hooks` run around **every** tool call of the merged set (yours, chamvi's, state tools, third-party), inside the call, so `approve()` works there and replays on resume:

<<< @/snippets/approvals.ts#hook

- `beforeToolExecution({ toolName, toolCallId, input }, ctx)` returns the input to use (a rewritten one is validated against the tool's input schema again; a failure is a `validation_error` tool error). It runs before the effect lookup, so an effect tool's key comes from the final input. Throw `ToolDeniedError` (`tool_denied`) to refuse: a tool error the model sees, the run goes on. `FatalToolError` still fails the run.
- `afterToolExecution({ toolName, toolCallId, input, output }, ctx)` returns the output the model sees. It runs on a fresh result and on a recorded effect result alike (redaction stays consistent), on a streaming tool's final value, and never for a tool error.
- `ctx` is the execution's `ToolContext`, so `inject()`, `ctx.channels` and `ctx.run.trigger.invoker` work in both. A hook can let some invokers through without asking (see [Restricting tools per invoker](/guide/tools#restricting-tools-per-invoker)).

## Answering

<<< @/snippets/approvals.ts#engine

<<< @/snippets/approvals.ts#answer

`engine.approve(runId, { approvalId, approved, reason?, approver?, selected? })` answers the run's current wait point, for a caller that authorized the approver itself (the `@chamvi/http` endpoint `POST /runs/:id/approve`, which the dashboard uses). An `approvalId` that is not the current one, an expired wait point (the next `tick()` denies it) or a run that is not `waiting` throws `InvalidRunStateError`.

`selected` answers a wait point with options: an approval needs exactly one id (with `multiple` at least one) of the wait point's options; a denial selects nothing (an empty `selected` is dropped). Anything else is a `ValidationError` (400 over HTTP), checked after the state checks above, and the run keeps waiting: `selected` on a plain wait point, an unknown id, several ids for a single choice, an approval without a selection, or a selection that is no array of at most 20 distinct strings (this shape is checked before any store read). The decision and the `wait` step's `output.selected` hold the ids in option order; a timeout and a denial never have a selection.

An answer is single use: a second answer of the same wait point throws `InvalidRunStateError`.

- `decision.approver` (an invoker: `{ id, kind, name?, permissions }`) is recorded on the `wait` step as `output.approver`. `@chamvi/http` sets it from the principal that answered. The model never sees the decision's details: it sees the tool's result, so a denial is the tool's (or hook's) to word.
- If writing the answer fails, the run goes back to `waiting` and the answer can be sent again.

## Timeouts

An approval not answered within its `timeoutMs` is denied with the reason `approval timed out`. The engine checks on every poll (`tick()`); `approve()` then returns `{ approved: false, reason: 'approval timed out' }`.

::: tip Where approvals are answered
In core you call `engine.approve()` (by approval id) yourself. [`@chamvi/http`](/guide/http) adds `POST /runs/:id/approve` and the MCP tool `approve_run` (both need `agent:<name>:approve`; the [`@chamvi/ui`](/guide/ui) inbox and its approval links answer through the endpoint).
:::
