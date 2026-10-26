# TypeORM store

`@chamvi/store-typeorm` keeps everything the engine persists in Postgres through TypeORM. It passes `describeStoreContract` unchanged, so the engine behaves the same on memory and on Postgres, also with several replicas on one database.

```bash
npm install @chamvi/store-typeorm typeorm pg
```

`@chamvi/core`, `typeorm` (`^1.1.2`) and `pg` (`^8`) are peer dependencies.

## Setup

<<< @/snippets/store-typeorm.ts#setup

The store takes an initialized `DataSource` and never initializes or destroys it. The database must exist; create it beforehand, for example with `createDatabase()` from `typeorm-extension`.

On shutdown, drain the engine before destroying the data source:

<<< @/snippets/store-typeorm.ts#shutdown

| Option | Type | Default | Description |
|---|---|---|---|
| `dataSource` | `DataSource` | required | An initialized Postgres data source that lists `STORE_ENTITIES` and `STORE_MIGRATIONS` |
| `clock` | `IClock` | `systemClock` | Time source for claims, keys, locks and `updatedAt` |

## Migrations

`migrateStore(dataSource)` runs the pending migrations under the Postgres advisory lock `chamvi:migrations` (`MIGRATION_LOCK_NAME`). Call it on every boot: replicas that start at once wait for each other, and each migration is applied and recorded once. Each call uses one pooled connection, the one holding the lock, for the migrations as well. chamvi is pre-1.0, so a new version may ship a new migration. The migrations so far: `1792195200000-init.ts`, `1792368000000-artifacts.ts`, `1792454400000-idempotency-scope.ts`, `1792540800000-kv-key-collation.ts` and `1792627200000-agent-revisions.ts` (`AgentRevisions1792627200000`, the table `chamvi_agent_revisions`).

`pendingMigrations(dataSource)` resolves the names of the migrations not run yet, in order, without writing anything (it never creates TypeORM's `migrations` table); `chamvi start --check` uses it to refuse a database a start with `CHAMVI_MIGRATE=false` could not run on (with the default `true` a start migrates, so the check passes).

## Tables

| Table | Holds | Keys and indexes |
|---|---|---|
| `chamvi_runs` | Runs; JSON columns for trigger, output, error, usage and wait point; the run's `address` in the `thread` column; claim owner and expiry | PK `id` (`COLLATE "C"`); `(agent, status, concurrency_key)`; `(status, created_at, id)` |
| `chamvi_steps` | Append-only steps | `(run_id, step_index)` |
| `chamvi_checkpoints` | The latest checkpoint per run | PK `run_id` |
| `chamvi_idempotency_keys` | Intake keys | PK `(scope, key)`; `expires_at` |
| `chamvi_locks` | Keyed leases | PK `key`; `expires_at` |
| `chamvi_effects` | Recorded effect results | PK `key` |
| `chamvi_kv` | Agent key-value state | PK `(agent, key)`, `key` `COLLATE "C"` (migration `1792540800000-kv-key-collation.ts`) |
| `chamvi_docs` | Agent document collections | PK `(agent, collection, id)`; GIN index on `doc` |
| `chamvi_artifacts` | Artifact metadata and bytes (`data` `bytea`) | PK `id`; `run_id` |
| `chamvi_agent_revisions` | One revision marker per folder agent: `hash` varchar(128), `changed_at` | PK `agent` varchar(64) `COLLATE "C"` (migration `1792627200000-agent-revisions.ts`) |

## How it keeps the contract

- **Repositories and query builders.** Every method goes through the entities' TypeORM repositories and query builders; the only hand-written fragment is the `jsonb_exists` key check in `docList`, which TypeORM has no operator for.
- **One statement per atomic operation**, never read-then-write in JavaScript:
  - `createRun`: an insert with `orIgnore()` (`ON CONFLICT DO NOTHING RETURNING id`).
  - `claimKey` and `acquire`: an insert with `orUpdate()` and an overwrite condition (`ON CONFLICT DO UPDATE ... WHERE expires_at <= now RETURNING`), so an expired key or lock is taken over in the same statement.
  - `claimRun` and `renewClaim`: a conditional update (`UPDATE ... WHERE ...`) checked by its affected-row count.
  - The `updateRun` guards: a conditional update with `RETURNING *`; when it matches no row, the store reads the run to throw `RunNotFoundError` or `InvalidRunStateError`.
  - `saveCheckpoint`: an insert with `orUpdate()` and the overwrite condition `step_index <=` the new index.
  - `putArtifact`: an insert with `orIgnore()` returning `id`.
  - `setAgentRevision`: an upsert on `agent`. The marker needs no atomic compare: the engine reads and writes it under the store lock `agents:<name>`.
- **Time from the clock.** The injected `IClock`'s time is passed as a parameter; queries never call the database's `now()`.
- **No aliasing.** Values are serialized into the query and parsed out again; nothing is cached in memory.
- **Dates.** Timestamps are `timestamptz`; `trigger.receivedAt`, `trigger.attachments[].createdAt`, `waiting.expiresAt` and `waiting.notifiedAt` live in JSON and are revived as `Date`.

## Housekeeping

Expired idempotency keys and locks never block anyone, but they stay in their tables until purged:

<<< @/snippets/store-typeorm.ts#purge

`purgeExpired(now?)` deletes keys and locks expired at `now` (default: the clock's time) and returns `{ idempotencyKeys, locks }`, the number of rows removed. Effects have no expiry and are never purged. Nothing runs it automatically yet, so schedule it in your app as above.

## Differences from MemoryStore

- **Opaque values are JSON.** A run's `output`, step `input`/`output`/`error`, checkpoint messages, effect results and state lose `Date`, `undefined` and `Map` fidelity, and a typed array such as `Uint8Array` comes back as an object keyed by index. A `BigInt` or a circular structure makes the write throw a `TypeError`.
- **NUL characters and lone surrogates become U+FFFD** in opaque values, keys and strings alike, because `jsonb` cannot hold them.
- **Artifact bytes are `bytea`**, never selected by `getArtifact` or `listArtifacts`, and come back from `readArtifact` as a plain `Uint8Array`. Postgres caps a `bytea` value at 1 GB and the whole value travels in one query, so keep artifacts small enough for memory. Nothing purges artifacts yet.
- **Identifiers have length limits** (`MemoryStore` has none): run and artifact ids 128 characters; `concurrencyKey`, `address`, claim owners, step names, document collections and document ids 255; idempotency, lock, effect and state keys 512; idempotency scopes 1024 (`<agent>:<source>:<kind>:<id>` with the invoker URI-encoded, leaving about 950 characters for the encoded `kind` and `id`). A longer value makes the write fail with the driver's `value too long` error, so validate user-supplied keys before they reach `dispatch` (a rejected run with an `idempotencyKey` keeps its key reserved until the key expires).
- **`null` in an optional property reads back as absent:** a run `output` of `null`, and a step `input`, `output` or `error` of `null`, are stored as SQL `NULL`. `putEffect(key, undefined)` reads back `{ result: null }` and `docUpsert(..., undefined)` reads back `doc: null`.
- **`docList` `where` uses `jsonb` containment (`@>`).** Primitive values match by top-level equality; a nested object or array matches by containment, where `MemoryStore` never matches. A key whose value is `undefined` matches documents that lack the key, as in `MemoryStore`. Documents come back ordered by `id`, not by insertion.
- **`listRuns` ties** on `createdAt` are broken by the byte order of `id` (`COLLATE "C"`, so `'B' < 'a'`, reversed for `order: 'desc'`); identical to `MemoryStore` for lowercase ids and UUIDs.
