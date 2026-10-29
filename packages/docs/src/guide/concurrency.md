# Concurrency, Leases & Multi-Replica

Several engines can share one store. They coordinate through the store alone: run claims are leases, concurrency keys are checked under store locks, and idempotency keys are claimed atomically. There is no leader and no extra service.

::: warning Durable store required
`createMemoryStores()` lives in one process, so replicas cannot share it. Running several replicas needs a durable, shared store such as the [TypeORM store](/stores/typeorm).
:::

## Local slots

`concurrencyMaxRuns` (default `4`) caps the runs one engine executes at once. A scheduling pass lists `queued` runs in FIFO order (by `createdAt`, then `id`) and starts them until the slots are full. Passes run after a dispatch, after a run settles, after a resume and on every poll.

A `waiting` run holds no slot. A long approval wait does not block other work.

::: warning TypeScript option rename
The engine option is now `concurrencyMaxRuns`, replacing `maxConcurrentRuns` (a breaking TypeScript API change). Update engine configuration objects when upgrading. The deployment environment variable remains `CHAMVI_MAX_CONCURRENT_RUNS`; its name, default and local-engine scope are unchanged.
:::

## Shared agent and subscription ceilings

Set `concurrencyMaxRuns` on an agent and, optionally, on each `channel.on(...)` subscription:

<<< @/snippets/concurrency.ts#caps

These are **nested ceilings**, coordinated across engines sharing a store. A run starts only when it fits the engine's local slots, its agent's ceiling, its subscription's ceiling and its concurrency key. A subscription cannot raise or disable its agent's ceiling. `undefined` or `false` means no additional numerical cap at that level; a number must be a positive safe integer. `0` is invalid, not a pause switch.

Only `running` runs count against these numerical ceilings. A `waiting` approval or an `interrupted` run releases numerical capacity but still blocks its concurrency key. A resumed approval competes for capacity again. Subscription counts follow the subscription id (`run.trigger.trigger`), not the transport: REST and MCP runs of `http.on()` share its `http` cap. A direct dispatch without a matching subscription has only the agent ceiling.

The scheduler checks queued work in FIFO order, skipping blocked runs so eligible work of another subscription or agent can progress. This is not weighted fairness or a guarantee against starvation. Excess work remains durably `queued`, without a separate broker; the backlog has no storage bound, so monitor queue age, run count and store capacity. A `202` intake response acknowledges stored acceptance, not that execution has started or completed.

Numerical admission uses the store lock `admission:<agent>` around the count, claim and transition to `running`, also for uncapped sibling subscriptions. All replicas must use compatible agent definitions; ceilings are read from live definitions, not saved onto each run. Like the concurrency-key lock, the admission guarantee assumes its store operations finish inside the lock TTL (`claimTtlMs`), not an arbitrarily stalled database operation.

`EngineOptions.concurrencyMaxRuns` and the app's `CHAMVI_MAX_CONCURRENT_RUNS` remain **per engine**, not fleet-wide. For example, two engines with four local slots can execute eight runs in total, but an agent ceiling of three permits at most three running runs of that agent across their shared store.

GitHub's default per-issue concurrency key and cron's `overlap` policy are separate controls: keys serialize related work, overlap decides whether a cron tick dispatches, and numerical caps bound execution capacity.

## Concurrency keys

A run with a `concurrencyKey` starts only when no other run of the same agent and key is `running`, `waiting` or `interrupted`. The check, the claim and the move to `running` happen under the store lock `concurrency:<agent>:<key>`, so two replicas cannot both start a run for the same key. A blocked run stays `queued` and later runs with other keys start past it.

Note what blocks a key:

- `waiting`: a run paused on an approval keeps its key, so the next run for the same issue does not start while the owner decides.
- `interrupted`: a drained run keeps its key until it is recovered and finished.

## Claims are leases

A run is executed by the engine that holds its claim. `claimRun(id, owner, claimTtlMs)` takes the lease (default 60 s) and the engine renews it every `claimTtlMs / 3` while the run executes.

- **Owner:** `owner` identifies the replica, by default `<hostname>-<pid>`. Give each replica a distinct owner.
- **Conditional writes:** every write of a running run checks the status and that this owner still holds the claim.
- **Lost lease:** when a renewal is refused, or another owner took the run over after the lease expired, the engine aborts its execution, writes nothing more and reports a `LeaseLostError` to `onError`. The new owner continues from the latest checkpoint.

## The poll

Every `claimTtlMs / 3` each started engine:

1. runs `tick()`: denies expired approvals and re-sends approval messages a channel has not delivered yet,
2. runs `recover()`: requeues `running` or `interrupted` runs whose claim expired or was released, and aborts local runs another replica asked to cancel,
3. runs a scheduling pass.

So a crashed replica's runs are picked up by another replica within about one lease plus one poll interval.

## Tuning `claimTtlMs`

A shorter lease recovers crashed runs sooner and polls more often. A longer lease tolerates longer pauses (a slow store, a stop-the-world GC) before another replica takes a run over. The default of 60 s polls every 20 s.

## Cron across replicas

Firing a cron subscription once across replicas needs a per-tick lock. The cron channel ([`@chamvi/channel-cron`](/guide/scheduler)) takes the store lock `cron:<agent>:<subscriptionId>:<scheduledAt>` per tick (never released, held for 10 minutes by default) and dispatches with the idempotency key `<subscriptionId>@<scheduledAt>`, so a second firing is harmless even if the lock failed. See [Cron Scheduling](/guide/scheduler) and [Multiple Replicas](/deployment/replicas).
