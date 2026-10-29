<p align="center">
    <img src="https://raw.githubusercontent.com/chamvi/chamvi/master/.github/assets/logo.svg" alt="@chamvi/store-typeorm" width="128" height="128" />
</p>

<h1 align="center">@chamvi/store-typeorm</h1>

<p align="center">
    <b>TypeORM store for chamvi (PostgreSQL): durable runs, leases and agent state.</b><br>
    Runs, checkpoints, claims and state survive restarts, and several replicas<br>
    share one database without a leader.
</p>

<p align="center">
    <a href="https://www.npmjs.com/package/@chamvi/store-typeorm"><img src="https://img.shields.io/npm/v/@chamvi/store-typeorm" alt="npm version" /></a>
    <a href="https://github.com/chamvi/chamvi/actions/workflows/ci.yml"><img src="https://github.com/chamvi/chamvi/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
    <a href="https://github.com/chamvi/chamvi/blob/master/packages/store-typeorm/LICENSE"><img src="https://img.shields.io/npm/l/@chamvi/store-typeorm" alt="License" /></a>
</p>

<p align="center">
    <a href="#installation"><b>Installation</b></a>
    ·
    <a href="#usage">Usage</a>
    ·
    <a href="#options">Options</a>
    ·
    <a href="#api">API</a>
    ·
    <a href="#notes">Notes</a>
</p>

---

## Why @chamvi/store-typeorm?

`createMemoryStores()` from `@chamvi/core` loses every queued run, waiting approval and checkpoint with the process, and it cannot be shared between replicas. `createTypeormStores()` provides the same `Stores` capabilities in Postgres and passes the same `describeStoreContract` suite, so the engine behaves the same on both.

| Concern | `createMemoryStores()` | `createTypeormStores()` |
|---|---|---|
| **Restarts** | Everything is gone | Runs, steps, checkpoints, effects and state stay in Postgres; `recover()` picks interrupted runs up |
| **Replicas** | One process only | Claims, idempotency keys and locks are single statements built with TypeORM's query builder, atomic across processes |
| **Schema** | None | Migrations (init plus the artifact table), applied by `migrateStore()` under an advisory lock, so replicas booting at once migrate once |
| **Time** | From the injected `IClock` | From the injected `IClock` too, passed to every query as a parameter (never the database's `now()`) |
| **Housekeeping** | Nothing to clean up | `purgeExpired()` deletes expired idempotency keys and locks |

## Installation

```bash
npm install @chamvi/store-typeorm @chamvi/core typeorm pg
```

- ESM only, Node.js 22 or newer.
- `@chamvi/core`, `typeorm` (`^1.1.2`) and `pg` (`^8`) are peer dependencies.
- Postgres only.

## Usage

Create the data source with the store's entities and migrations, run the migrations, and hand the data source to the store:

```typescript
import type { LanguageModel } from 'ai';
import { Engine, defineAgent } from '@chamvi/core';
import {
    STORE_ENTITIES,
    STORE_MIGRATIONS,
    createTypeormStores,
    migrateStore,
} from '@chamvi/store-typeorm';
import { DataSource } from 'typeorm';

export async function startEngine(model: LanguageModel) {
    const triage = defineAgent({
        name: 'triage',
        model,
        instructions: 'Triage the issue.',
    });

    const dataSource = new DataSource({
        type: 'postgres',
        url: process.env.DATABASE_URL,
        entities: STORE_ENTITIES,
        migrations: STORE_MIGRATIONS,
    });
    await dataSource.initialize();
    await migrateStore(dataSource);

    const stores = createTypeormStores({ dataSource });
    const engine = new Engine({
        stores,
        agents: [triage],
    });
    await engine.start();

    // the store never destroys the data source: drain first, then close it
    const shutdown = async () => {
        await engine.drain();
        await dataSource.destroy();
    };

    return { engine, stores, shutdown };
}
```

- `migrateStore()` runs the pending migrations under the Postgres advisory lock `chamvi:migrations`. Several replicas may call it at once: they wait for each other and the migration is recorded once. Each call uses one pooled connection: it migrates on the connection that holds the lock.
- The store takes the data source as it is and never initializes or destroys it.
- The database must exist. Create it beforehand, for example with `createDatabase()` from `typeorm-extension`.

### Housekeeping

Expired idempotency keys and locks are taken over by the next caller, so they never block anything, but they stay in their tables until purged:

```typescript
// e.g. every hour; clear the interval on shutdown
const purge = setInterval(() => {
    Promise.all([stores.idempotency.purgeExpired(), stores.locks.purgeExpired()])
        .catch((e: unknown) => console.error(e));
}, 60 * 60 * 1000);
purge.unref();
```

Each role's `purgeExpired(now?)` deletes its rows expired at `now` (default: the clock's time) and returns the number removed. Effects have no expiry and are never purged.

## Options

| Option | Type | Default | Description |
|---|---|---|---|
| `dataSource` | `DataSource` | required | An initialized Postgres data source that lists `STORE_ENTITIES` and `STORE_MIGRATIONS` |
| `clock` | `IClock` | `systemClock` | Time source for claims, keys, locks and `updatedAt` |

## API

| Export | Kind | Purpose |
|---|---|---|
| `createTypeormStores()` | function | Assembles all `Stores` capabilities over one data source, including conversations |
| `migrateStore` | function | Runs the migrations under the advisory lock `MIGRATION_LOCK_NAME` |
| `STORE_ENTITIES` | array | The entity classes for the data source's `entities` |
| `STORE_MIGRATIONS` | array | The migrations for the data source's `migrations` |
| `MIGRATION_LOCK_NAME` | constant | `'chamvi:migrations'` |

Types: `TypeormStoresOptions`, `TypeormStores`.

Each capability is also available as its own class: `TypeormRunStore`, `TypeormStepStore`, `TypeormCheckpointStore`, `TypeormIdempotencyStore`, `TypeormLockStore`, `TypeormEffectStore`, `TypeormStateStore`, `TypeormArtifactStore`, `TypeormAgentRevisionStore` and `TypeormConversationStore`. Constructors take `{ dataSource }`; runs, idempotency, locks and conversations also accept `clock`. Use the same data source for all roles so their foreign keys share one database.

## Notes

- **Tables are prefixed `chamvi_`:** `chamvi_runs`, `chamvi_steps`, `chamvi_checkpoints`, `chamvi_idempotency_keys`, `chamvi_locks`, `chamvi_effects`, `chamvi_kv`, `chamvi_docs`, `chamvi_artifacts`. They live in the data source's default schema.
- **Identifiers have length limits** (`createMemoryStores()` has none): run and artifact ids 128 characters; `concurrencyKey`, `address`, claim owners, step names, document collections and document ids 255; idempotency, lock, effect and state keys 512; idempotency scopes 1024 (`<agent>:<source>:<kind>:<id>` with the invoker URI-encoded, leaving about 950 characters for the encoded `kind` and `id`). A longer value makes the write fail with the driver's `value too long` error, so validate user-supplied keys before they reach `dispatch` (a rejected run with an `idempotencyKey` keeps its key reserved until the key expires).
- **Artifact bytes are `bytea`** in `chamvi_artifacts` (indexed by `run_id`), read only by `readArtifact`; `getArtifact` and `listArtifacts` never load them. Postgres caps a `bytea` value at 1 GB, and the whole value travels in one query, so keep artifacts small enough for memory.
- **Only the latest checkpoint is kept** per run; an equal `stepIndex` replaces it.
- **Opaque values are JSON.** A run's `output`, a step's `input`/`output`/`error`, checkpoint messages, effect results and state values are stored as `jsonb`, so a `Date` inside them comes back as a string, `undefined` or `Map` values are lost and a typed array such as `Uint8Array` comes back as an object keyed by index. A `BigInt` or a circular structure makes the write throw a `TypeError` (`createMemoryStores()` accepts both). The run's own dates, `trigger.receivedAt`, `waiting.expiresAt` and `waiting.notifiedAt` come back as `Date`.
- **NUL characters and lone surrogates become U+FFFD** in opaque values (keys and strings alike), because `jsonb` cannot hold them. A literal backslash sequence such as the text `\u0000` is kept.
- **`null` in an optional property reads back as absent:** a run `output` of `null` and a step `input`, `output` or `error` of `null` are stored as SQL `NULL`. `putEffect(key, undefined)` reads back `{ result: null }` and `docUpsert(..., undefined)` reads back `doc: null`.
- **`docList` `where` uses `jsonb` containment (`@>`).** For primitive values that is top-level equality; a nested object or array matches by containment (`createMemoryStores()` never matches those). A key whose value is `undefined` matches documents that lack the key. Documents are returned ordered by `id` (`createMemoryStores()`: insertion order).
- **`listRuns` and `listArtifacts` break `createdAt` ties by byte order of `id`** (`COLLATE "C"`, so `'B' < 'a'`, in both directions of `listRuns`' `order`); `createMemoryStores()` compares with `localeCompare`. Both agree for lowercase ids and UUIDs.
- **`kvList` orders keys by byte order** (`chamvi_kv.key` is `COLLATE "C"`, migration `KvKeyCollation1792540800000`), the code-point order the contract asks for.
- **The schema may still change before 1.0.** New versions ship new migrations; run `migrateStore()` on every boot.

## License

Published under [Apache License 2.0](./LICENSE).

Conversation memory uses the same PostgreSQL DataSource as runs. Foreign keys connect its active owner, transcript items, note sources and note-operation receipts to their runs. Run and checkpoint scope bindings reference the local conversation row. Checkpoints and steps require their parent run to exist. Existing orphan rows will block migration validation; migrations do not silently delete them.

Idempotency reservations and staged artifacts can precede their run row. A pending emit can also precede its effect receipt, and an uncertain send may never have one. These reserved identifiers intentionally have no immediate foreign key.
