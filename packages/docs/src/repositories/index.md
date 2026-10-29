# Repository Contract

The engine receives a `Repositories` object with one implementation per persistence capability. Each role has its own small interface and can be built and tested independently.

| Interface | Holds | Key operations |
|---|---|---|
| `IRunRepository` | Runs | `insert` (insert-if-absent), `findOne`, `update` with `expectStatus`/`expectOwner` guards, `find`, `claim`/`renewClaim` leases |
| `IStepRepository` | Append-only steps per run | `insert`, `find` |
| `ICheckpointRepository` | The latest checkpoint per run | `save`, `findOne` |
| `IIdempotencyRepository` | Intake keys | `claim(scope, key, runId, ttlMs)`: the first caller wins |
| `ILockRepository` | Keyed leases | `acquire(key, owner, ttlMs)`, `release(key, owner)` |
| `IEffectRepository` | Recorded effect results | `findOne`, `save` |
| `IStateRepository` | Per-agent state | `findOne`/`set` (`undefined` removes the key), `find` (key code-point order, `limit`/`offset`), `findDocuments`/`upsertDocument`/`deleteDocument` |
| `IArtifactRepository` | Files of a run (attachments, files tools stored) | `insert(artifact, data)` (insert-if-absent), `findOne` (metadata), `read` (bytes), `find(runId)` |
| `IAgentRevisionRepository` | One revision marker per [folder agent](/guide/agent-folders): `{ agent, hash, changedAt }`, no code | `findOne`, `save` (upsert), `delete` (a missing one is a no-op), `find` (agent code-point order) |
| `IConversationRepository` (optional) | Conversation generations, turn ownership, recall, journal and explicit notes | `findOne`, `findItems`, `findNotes`, `findOneNote`; `resolve`, `beginTurn`, `endTurn`, `prepareEmit`, `confirmEmit`, `applyNote`, `reset`, `delete`, `prune` |

`Repositories` has nine required fields: `runs`, `steps`, `checkpoints`, `idempotency`, `locks`, `effects`, `state`, `artifacts` and `agentRevisions`. Its optional `conversations` field implements `IConversationRepository`. Pass the aggregate as `new Engine({ repositories, agents })`; use `repositories.runs.findOne(id)` or `repositories.state.findOne(agent, key)` for direct access. Conversation storage alone does not enable memory: configure `conversations: { authorize, limits? }` on the engine and opt agents in.

## Updating existing callers

This changes the storage API. `IStore`, `MemoryStore` and `TypeormStore` are removed; custom adapters implement the individual interfaces and are supplied in a `Repositories` object.

| Previous API | Separate repositories API |
|---|---|
| `new MemoryStore(options)` | `createMemoryRepositories(options)` |
| `new TypeormStore(options)` | `createDatabaseRepositories(options)` |
| `new Engine({ store, agents })` | `new Engine({ repositories, agents })` |
| `engine.store.getRun(id)` | `engine.repositories.runs.findOne(id)` |
| `storeModule({ store })` | `repositoryModule({ repositories })` |
| `AppToken.STORE` | `AppToken.REPOSITORIES` |
| `conversations: { store, authorize }` | `repositories.conversations` holds storage; `conversations: { authorize }` holds policy |
| `container.resolve(AppToken.CONVERSATIONS)` | `container.resolve(AppToken.REPOSITORIES).conversations` |

The package is now `@chamvi/store-db` (previously `@chamvi/store-typeorm`). Replace package imports and dependencies; database tables and migration history keep their names. The class split itself changes no database schema. Existing TypeORM roles must keep sharing the same DataSource so their relationships remain valid.

## Query methods

`findOne(...)` returns one record or `undefined`. `find(...)` returns the repository's existing collection shape: run queries return `{ data, total }`, while steps, artifacts, state and agent revisions return arrays. Conversation item/note queries return `{ data, total }` through `findItems` and `findNotes`.

The matching `OrFail` method returns the same result when it exists. `findOneOrFail(...)` throws for `undefined`; stored state values such as `null`, `false`, `0` and `''` are valid results. `findOrFail(...)` throws when the selected array or page is empty, including a run query with `limit: 0` or an offset beyond the last result even when `total` is nonzero. Query validation is unchanged: conversation queries require `limit >= 1`, so their `limit: 0` is a validation error. Qualified queries follow the same rule: `findDocumentsOrFail`, `findItemsOrFail`, `findNotesOrFail` and `findOneNoteOrFail`.

A missing single run or artifact uses `RunNotFoundError` or `ArtifactNotFoundError`; other missing repository results use `RepositoryNotFoundError`. Backend failures and validation errors pass through unchanged. Leases and mutations retain their domain operations, such as `claim`, `renewClaim` and `beginTurn`.

```ts
const run = await repositories.runs.findOneOrFail(runId);
const { data, total } = await repositories.runs.find({ agent: run.agent, limit: 20 });
const artifacts = await repositories.artifacts.find(runId);
```

## Rules every repository keeps

1. **One expiry rule.** A claim, key or lock created at time `T` with `ttlMs` is expired at exactly `T + ttlMs` and can be taken over at that instant.
2. **Time comes from the clock.** Expiry decisions use an injected `IClock`, never the database's clock, so tests can drive time and replicas agree on one rule.
3. **No aliasing.** Values are copied in and out. Mutating an object after passing it to the store, or one the store returned, never changes what the store holds.
4. **Atomic means atomic across callers.** `runs.insert`, `idempotency.claim`, `runs.claim`, `runs.renewClaim`, `locks.acquire` and `artifacts.insert` must hold under concurrency, also across processes.
5. **Ordering.** `runs.find` orders by `createdAt` ascending, ties broken by `id` ascending, or both descending with `order: 'desc'` (newest first); `total` ignores `limit` and `offset`. `artifacts.find` orders the same way. `agentRevisions.find` orders by agent name in code-point order.
6. **Guards throw.** `runs.update` throws `InvalidRunStateError` when `expectStatus` does not match, or when `expectOwner` is given and the claim is absent or held by another owner (expiry is not checked there: a lease is lost once taken over). It throws `RunNotFoundError` for an unknown run.
7. **Checkpoints.** `checkpoints.save` keeps the highest `stepIndex`; an equal index replaces.
8. **State filters.** `state.findDocuments` `where` matches top-level fields by equality.
9. **Artifacts.** `artifacts.insert` resolves `false` and keeps the stored artifact when the id exists. Bytes are copied in and out like every other value, and `read` returns a plain `Uint8Array` (no `Buffer` or other subclass). `findOne` and `find` return metadata only.

## The interfaces

<<< ../../../core/src/repository/types.ts{ts}

## Repositories

| Repository | Package | Status |
|---|---|---|
| [`createMemoryRepositories()`](/repositories/memory) | `@chamvi/core` | Shipped. Development and tests |
| [TypeORM](/repositories/typeorm) | `@chamvi/store-db` | Shipped. PostgreSQL, production |

Redis is never required. Any store that passes the [contract suite](/repositories/writing-a-repository) from `@chamvi/test-kit` works with the engine.
