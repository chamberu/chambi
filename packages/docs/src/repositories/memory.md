# Memory repositories

`createMemoryStore()` assembles independent in-memory capability repositories, including conversations. It ships with `@chamvi/core` for development and tests.

```ts
import { createMemoryStore } from '@chamvi/core';

const store = createMemoryStore();
```

| Option | Type | Default | Description |
|---|---|---|---|
| `clock` | `IClock` | `systemClock` | Time source for every expiry decision |

Each role is also exported as a class: `MemoryRunRepository`, `MemoryStepRepository`, `MemoryCheckpointRepository`, `MemoryIdempotencyRepository`, `MemoryLockRepository`, `MemoryEffectRepository`, `MemoryStateRepository`, `MemoryArtifactRepository`, `MemoryAgentRevisionRepository` and `MemoryConversationRepository`. Only runs, idempotency, locks and conversations need a clock. `MemoryStepRepository`, `MemoryCheckpointRepository` and `MemoryConversationRepository` take an optional `hasRun(runId)` lookup (`MemoryRunReferenceOptions`); `createMemoryStore()` wires its run repository in, so a step, checkpoint or conversation turn of an unknown run throws `RunNotFoundError`, as the database's foreign keys refuse it. A class built without `hasRun` accepts any run id. Replacing `runs` in a spread store (`{ ...createMemoryStore(), runs: custom }`) leaves the other roles checking the original run repository: build them with `hasRun` over the replacement.

## How it keeps the contract

- **Copies:** every value is stored and returned as a `structuredClone`.
- **Atomicity:** its methods never await between a check and the matching write, so in a single Node process each atomic operation is atomic.
- **Expiry:** claims, keys and locks compare against `clock.now()` with the shared rule (expired at exactly `T + ttlMs`).

It passes the same contract suite every other store must pass.

## When to use it

- Tests, with a `ControllableClock` from [`@chamvi/test-kit`](/reference/test-kit) passed to both the store and the engine.
- Local development and scripts.
- A single process where losing queued and waiting runs on restart is acceptable.

::: warning Not durable
Everything is gone with the process: queued runs, waiting approvals, checkpoints, recorded effects, agent state and artifacts. It also cannot be shared between replicas. Use a durable store to survive restarts or to run more than one replica.
:::

## In tests

<<< @/snippets/testing.ts#clock
