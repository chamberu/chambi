# Hand-offs

A tool can start a run of its **own agent**: `startHandoff(ctx, { payload, idempotencyKey?, concurrencyKey?, address? })`. The new run (the child) has its own budget, its own approvals and its own concurrency key, and the calling run (the parent) goes on at once: a hand-off is fire and forget. A daily run that finds ten pull requests needing work hands off one run per pull request instead of fixing them all inline under one budget.

Hand-offs are not delegation: nothing waits for the child, and nothing of its result comes back to the parent. The tool gets `{ runId, deduplicated }` and that is all.

## Opting in

An agent accepts hand-offs only with `handoff.on()` in its channels. The child comes in on the channel `agent` (subscription id `handoff`), which `agentChannel()` registers:

<<< @/snippets/handoffs.ts#agent

<<< @/snippets/handoffs.ts#engine

With [`@chamvi/app`](/guide/app) the engine module contributes `agentChannel()`, so the name `agent` is taken (a user channel of that name clashes at setup). Without `handoff.on()` a call is a `ValidationError` tool error: `Agent "<a>" accepts no hand-offs: add handoff.on() to its channels.`

`handoff.on(options?)` takes:

| Option | Meaning |
|---|---|
| `schema` | A Standard Schema the payload goes through; the child gets the parsed value. A failing payload is a `ValidationError` tool error and starts nothing. Without one the payload passes unchanged |
| `maxPerRun` | How many hand-offs one run may start over all its executions, default `DEFAULT_MAX_HANDOFFS_PER_RUN` (100). A positive integer, else `InvalidAgentDefinitionError` |
| `concurrencyKey(payload)` | The child's concurrency key when the call gives none |
| `idempotencyKey(payload)` | The child's idempotency key when the call gives none |

## Starting a hand-off

<<< @/snippets/handoffs.ts#tool

- `payload` is required; `idempotencyKey`, `concurrencyKey` and `address` are optional non-empty strings without NUL (the concurrency key and the address at most 255 characters). Anything else is a `ValidationError` tool error.
- The child's envelope is `{ agent: <own agent>, trigger: 'handoff', channel: 'agent', payload, idempotencyKey, concurrencyKey?, address?, invoker?, parent }`. The model sees the channel, the subscription id and the payload, like any run.
- `startHandoff()` runs inside a tool call only; in the tools factory it throws `InvalidRunStateError`.

## Keys and dedupe across runs

The claimed idempotency key is `handoff:<key>` (or `sha256:<hex>` of it when it is longer than 255 characters), where `<key>` is the call's `idempotencyKey`, else the subscription's `idempotencyKey(payload)`, else `<parent run id>:<hash of payload, concurrency key and address>`.

A given key is **not** scoped to the parent run: a second run that hands off the same key (the job run again, a replica) gets the first child back with `deduplicated: true`. Key it by what makes the work unique, for example the pull request and the day (`${pr}@${day}`), taking the day from `ctx.run.trigger.receivedAt` so a redo keeps the same key. Without a key, the default is scoped to the parent, so another parent with the same payload starts its own child. The idempotency scope is `<agent>:agent` (plus the invoker, see below), apart from every other channel's.

The concurrency key works as for any run: two children with the same key never run at the same time, so one key per pull request keeps two fixes of one pull request apart.

## The effect record

Each call is recorded under the effect key `<runId>:handoff:<hash of payload, key, concurrency key and address>` with the value `{ runId, deduplicated }`, so a step redone after a crash or after an approval returns the recorded result and starts nothing. Identical calls in one step (parallel tool calls) share one hand-off. Dispatch is idempotent by itself, so a crash between the dispatch and the record still yields one child (the redo reads `deduplicated: true`).

## Limits

- **Per run**: at most `maxPerRun` hand-offs, counted durably across executions (the effect `handoff-count:<runId>`), so a run that paused on an approval keeps its count. The count goes up before the dispatch, also for a deduplicated one; a crash in between burns one slot. Past the limit: `Run <id> reached its <n> hand-offs (handoff.on({ maxPerRun })).`
- **Depth 1** (`MAX_HANDOFF_DEPTH`): a handed-off run cannot hand off again (`A handed-off run cannot hand off again (depth 1).`), so a fan-out never recurses.
- **The invoker** is inherited: the child gets the parent's invoker snapshot (none for a cron parent), so `requireToolPermission()` decides the same in the child as in the parent and a hand-off never widens grants.

## Outbound in a child

The `agent` channel has no `out`, so `ctx.channels.findOne()` without a name is `undefined` in a child. Tools of a child name their channel and address, for example `ctx.channels.findOneOrFail('github').approve({ address: 'o/r#5', title: 'Merge?' })`. The `address` given to `startHandoff()` becomes the child's `trigger.address` and `run.address` (shown in the dashboard), so a tool can read it back from `ctx.run.trigger.address`.

## Lineage

The child's `trigger.parent` is `{ kind: 'handoff', runId, agent, depth: 1 }` (`TriggerParent`). Only `startHandoff()` sets it: `engine.dispatch()` and a channel's `ctx.dispatch()` drop a `parent` a caller passes, so nobody forges lineage. It lives in the stored envelope, so both stores keep it without a migration. The [dashboard](/guide/ui)'s run page shows "handed off from" with a link to the parent run.

## Under `chamvi run-job`

A [one-shot job](/guide/scheduler#one-shot-jobs) starts a whole engine over the shared store, so it may pick up the children its run handed off. The drain at the end of the job interrupts the children still running; they requeue through recovery on the deployment and go on from their latest checkpoint.
