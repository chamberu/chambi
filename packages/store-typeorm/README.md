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

`MemoryStore` from `@chamvi/core` loses every queued run, waiting approval and checkpoint with the process, and it cannot be shared between replicas. `TypeormStore` keeps the same `IStore` contract in Postgres and passes the same `describeStoreContract` suite, so the engine behaves the same on both.

| Concern | `MemoryStore` | `TypeormStore` |
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
    TypeormStore,
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

    const store = new TypeormStore({ dataSource });
    const engine = new Engine({
        store,
        agents: [triage],
    });
    await engine.start();

    // the store never destroys the data source: drain first, then close it
    const shutdown = async () => {
        await engine.drain();
        await dataSource.destroy();
    };

    return { engine, store, shutdown };
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
    store.purgeExpired().catch((e: unknown) => console.error(e));
}, 60 * 60 * 1000);
purge.unref();
```

`purgeExpired(now?)` deletes keys and locks expired at `now` (default: the clock's time) and returns `{ idempotencyKeys, locks }`, how many rows it removed. Effects have no expiry and are never purged.

## Options

| Option | Type | Default | Description |
|---|---|---|---|
| `dataSource` | `DataSource` | required | An initialized Postgres data source that lists `STORE_ENTITIES` and `STORE_MIGRATIONS` |
| `clock` | `IClock` | `systemClock` | Time source for claims, keys, locks and `updatedAt` |

## API

| Export | Kind | Purpose |
|---|---|---|
| `TypeormStore` | class | `IStore` on Postgres, plus `purgeExpired(now?)` |
| `migrateStore` | function | Runs the migrations under the advisory lock `MIGRATION_LOCK_NAME` |
| `STORE_ENTITIES` | array | The nine entity classes for the data source's `entities` |
| `STORE_MIGRATIONS` | array | The migrations for the data source's `migrations` |
| `MIGRATION_LOCK_NAME` | constant | `'chamvi:migrations'` |

Types: `TypeormStoreOptions`, `PurgeResult`.

## Notes

- **Tables carry no prefix:** `runs`, `steps`, `checkpoints`, `idempotency_keys`, `locks`, `effects`, `kv`, `docs`, `artifacts`, `agent_revisions`. They live in the data source's default schema, so give chamvi a schema of its own (the data source's `schema` option) in a database other applications share.
- **Identifiers have length limits** (`MemoryStore` has none): run and artifact ids 128 characters; `concurrencyKey`, `address`, claim owners, step names, document collections and document ids 255; idempotency, lock, effect and state keys 512; idempotency scopes 1024 (`<agent>:<source>:<kind>:<id>` with the invoker URI-encoded, leaving about 950 characters for the encoded `kind` and `id`). A longer value makes the write fail with the driver's `value too long` error, so validate user-supplied keys before they reach `dispatch` (a rejected run with an `idempotencyKey` keeps its key reserved until the key expires).
- **Artifact bytes are `bytea`** in `artifacts` (indexed by `run_id`), read only by `readArtifact`; `getArtifact` and `listArtifacts` never load them. Postgres caps a `bytea` value at 1 GB, and the whole value travels in one query, so keep artifacts small enough for memory.
- **Only the latest checkpoint is kept** per run; an equal `stepIndex` replaces it.
- **Opaque values are JSON.** A run's `output`, a step's `input`/`output`/`error`, checkpoint messages, effect results and state values are stored as `jsonb`, so a `Date` inside them comes back as a string, `undefined` or `Map` values are lost and a typed array such as `Uint8Array` comes back as an object keyed by index. A `BigInt` or a circular structure makes the write throw a `TypeError` (`MemoryStore` accepts both). The run's own dates, `trigger.receivedAt`, `waiting.expiresAt` and `waiting.notifiedAt` come back as `Date`.
- **NUL characters and lone surrogates become U+FFFD** in opaque values (keys and strings alike), because `jsonb` cannot hold them. A literal backslash sequence such as the text `\u0000` is kept.
- **`null` in an optional property reads back as absent:** a run `output` of `null` and a step `input`, `output` or `error` of `null` are stored as SQL `NULL`. `putEffect(key, undefined)` reads back `{ result: null }` and `docUpsert(..., undefined)` reads back `doc: null`.
- **`docList` `where` uses `jsonb` containment (`@>`).** For primitive values that is top-level equality; a nested object or array matches by containment (`MemoryStore` never matches those). A key whose value is `undefined` matches documents that lack the key. Documents are returned ordered by `id` (`MemoryStore`: insertion order).
- **`listRuns` and `listArtifacts` break `createdAt` ties by byte order of `id`** (`COLLATE "C"`, so `'B' < 'a'`, in both directions of `listRuns`' `order`); `MemoryStore` compares with `localeCompare`. Both agree for lowercase ids and UUIDs.
- **`kvList` orders keys by byte order** (`kv.key` is `COLLATE "C"`, migration `KvKeyCollation1792540800000`), the code-point order the contract asks for.
- **The schema may still change before 1.0.** New versions ship new migrations; run `migrateStore()` on every boot.

## License

Published under [Apache License 2.0](./LICENSE).
