# Multiple Replicas

Running more than one replica of an agent app relies on the store. Core, the TypeORM store, HTTP intake and `@chamvi/channel-cron` coordinate through that shared store.

## Upgrading to untrusted-content gates

This upgrade requires downtime. **Do not run old and new runtimes against the same store**, even temporarily during a rolling deployment.

1. Stop **all old ingress, workers and approval pollers** across every replica and scheduled job. Wait for the processes to exit; draining executions alone is not sufficient.
2. With all old processes stopped, apply `ConversationsRunTaint1792713600000` (or the equivalent custom-store migration and unfinished-run backfill). Suspend run-job CronJobs too: a pod they start at the old version creates untainted runs after the backfill.
3. Start **only new binaries** against the migrated store. Resumed legacy unfinished runs are conservatively tainted and may require outbound approval.

Old approval pollers do not understand the safe notification field: they can post a new gate's private argument-bearing `waiting.body` to its source channel. Old ingress and workers can create or checkpoint untainted runs after the one-time backfill. Shared claims and notification locks do not prevent either version-compatibility problem. See [Upgrading to 0.4](/guide/upgrading#upgrading-to-0-4) for the full procedure and [Writing a repository](/repositories/writing-a-repository#persist-run-taint) for the persistence requirements.

## What core already guarantees

With a shared, durable store such as the [database store](/repositories/database) (`createMemoryStore()` cannot be shared), several `Engine`s coordinate without a leader:

- **One executor per run.** Run claims are leases (`claimTtlMs`, renewed every third of it). A replica that loses its lease stops writing.
- **One run per concurrency key.** Checked under a store lock, across replicas.
- **Shared numerical ceilings.** Agent and subscription `concurrencyMaxRuns` count running runs under an agent admission lock. Waiting approvals release numerical capacity but keep their keys. All replicas must use compatible definitions and complete admission operations inside the lock TTL. `CHAMVI_MAX_CONCURRENT_RUNS` is still local to each engine, not a fleet cap. See [Concurrency](/guide/concurrency#shared-agent-and-subscription-ceilings).
- **One run per idempotency key.** `dispatch()` claims the key atomically; redeliveries to any replica return the same run.
- **Crash recovery.** Every replica's poll requeues runs whose claim expired, and the next execution continues from the latest checkpoint.
- **Graceful drain.** A terminating pod marks its unfinished runs `interrupted` and another replica picks them up.
- **Cross-replica cancel.** `cancel()` on any replica reaches the run's owner on its next poll.
- **One approval message.** A store lock per approval plus the message key (`<runId>:<approvalId>`) the channel dedupes on; a tool's `emit()` is recorded as an effect, so a redone step sends once.
- **Cron once per tick.** The cron channel ([`@chamvi/channel-cron`](/guide/scheduler)) takes a store lock per subscription and scheduled time (never released, so a late replica cannot fire the same tick again) and dispatches with an idempotency key built from the same pair. `engine.drain()` stops it before draining the runs.

Give each replica a distinct `owner` (the default `<hostname>-<pid>` already is in Kubernetes). See [Concurrency, Leases & Multi-Replica](/guide/concurrency).

## Webhooks and deployment

The HTTP app can accept deliveries on any replica. GitHub uses the delivery id as its default idempotency key, so a redelivery to another replica deduplicates through the shared store. A `202` means durable acceptance, not execution completion. Excess work remains queued, without a storage bound; use [channel HTTP policies](/reference/http#channel-http-request-limits) separately from execution ceilings.

The [Helm chart](https://github.com/chamvi/helm) defaults to one replica with the `Recreate` strategy. Raising the replica count requires a shared store and compatible definitions. Ingress settings do not configure the app's `trustProxy`; see [Ingress client addresses](/deployment/kubernetes#ingress-client-addresses-and-channel-bursts).
