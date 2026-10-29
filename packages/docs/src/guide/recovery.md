# Cancel, Drain & Recovery

## Starting and stopping

| Method | What it does |
|---|---|
| `start()` | Recovers abandoned runs, starts polling and starts queued runs |
| `stop()` | Stops the poll only. Runs in progress continue, and `dispatch()` still works |
| `drain({ timeoutMs })` | Graceful shutdown, see below |
| `idle()` | Resolves when nothing runs in this process and nothing more can start |
| `isDraining` | `true` from `drain()` until the next `start()` |

## Cancel

`engine.cancel(runId)` depends on where the run is:

| Run | Result |
|---|---|
| Executing in this engine | Aborted; settles `cancelled` and `cancel()` resolves once it settled |
| `queued` or `waiting` | Marked `cancelled` directly |
| `running` on another replica, or `interrupted` | Gets `cancelRequested: true`. The owner aborts it on its next poll (within `claimTtlMs / 3`); an interrupted run is settled `cancelled` on recovery, without a model call |
| Settled | Throws `InvalidRunStateError` |
| Unknown | Throws `RunNotFoundError` |

<<< @/snippets/shutdown.ts#cancel

If the local execution loses its lease while being cancelled, `cancel()` throws `InvalidRunStateError`: the run was not cancelled and may now execute on another replica. A cancel that races a pause cancels the run the pause left waiting, without sending the approval message.

## Drain

`drain({ timeoutMs })` is the shutdown path for a process that receives `SIGTERM`:

1. It stops polling and starting runs. `dispatch()` still stores runs as `queued`, for another replica.
2. It waits up to `timeoutMs` (default 30 s) for in-flight runs to settle.
3. It aborts the rest and marks them `interrupted`, with their claim released. The writes of a step that already completed land first.

<<< @/snippets/shutdown.ts#shutdown

Only the drain deadline keeps the event loop alive; the engine's other timers never do. Pick a `timeoutMs` below your platform's grace period (Kubernetes' `terminationGracePeriodSeconds`).

## Recovery

`recover()` runs on `start()` and on every poll. It looks at every `running` or `interrupted` run:

- A run executing in this engine is left alone (unless another replica requested its cancel).
- A run with a live claim of another owner is left alone.
- Any other run (claim expired or released) is claimed atomically and requeued.

The next execution continues from the latest checkpoint. A step whose checkpoint never landed runs again; [effect tools](/guide/effect-tools) keep its side effects from repeating. `recover()` resolves the number of runs it requeued.

| Cause | Status left behind | Picked up |
|---|---|---|
| `drain()` | `interrupted`, claim released | on the next `recover()` of any engine |
| Crash or kill | `running`, claim expires | after the lease expires, on the next `recover()` |
| Lost network to the store | `running` until the lease expires | as for a crash; the old owner stops writing once it notices |

`createMemoryStores()` loses everything with the process, so recovery across restarts needs a durable store.
