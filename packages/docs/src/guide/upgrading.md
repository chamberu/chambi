# Upgrading

chamvi is pre-1.0: a minor release may break the API. Each section lists what changed and the exact replacement.

## Upgrading to 0.4

### Breaking changes

| Change | Before (0.3) | Replacement (0.4) |
|---|---|---|
| Store package renamed | `@chamvi/store-typeorm` | `@chamvi/store-db`; replace the dependency and every import. Tables and migration history keep their names |
| Store aggregate | `new MemoryStore(options)`, `new TypeormStore(options)`, facade methods such as `engine.store.getRun(id)` | `createMemoryStore(options)`, `createDatabaseStore(options)`, role methods such as `engine.store.runs.findOne(id)`; every method is mapped on [Stores and repositories](/repositories/#updating-existing-callers) |
| Repository interfaces | `IRunStore`, `IStepStore`, `ICheckpointStore`, `IIdempotencyStore`, `ILockStore`, `IEffectStore`, `IStateStore`, `IArtifactStore`, `IAgentRevisionStore`; `IStore` extended them | `IRunRepository`, `IStepRepository`, `ICheckpointRepository`, `IIdempotencyRepository`, `ILockRepository`, `IEffectRepository`, `IStateRepository`, `IArtifactRepository`, `IAgentRevisionRepository`; `IStore` holds one of each (`store.runs`, `store.steps`, ...) |
| Database store options | `TypeormStoreOptions` | `DatabaseStoreOptions`; `createDatabaseStore()` returns `DatabaseStore` |
| Purging expired rows | `store.purgeExpired(now?)` resolving `PurgeResult` | `store.idempotency.purgeExpired(now?)` and `store.locks.purgeExpired(now?)`, each resolving the number of deleted rows (`@chamvi/app` schedules both) |
| Agent instructions | `AgentDefinition.instructions: string` | `instructions: AgentInstructions` (a string or an array of system, user and assistant messages). A string still works; code that reads `agent.definition.instructions` as a string must handle the array form |
| Channel context | `ChannelContext.engine: Engine`; no conversation intake | `ChannelContext.engine: IEngine` (type against the interface, not the class); `ChannelContext.dispatchConversation(envelope, target)` is required: a hand-built context needs one, get both from `engine.channelContext(channel)` |
| Engine typing in apps | `AppTokens.ENGINE: Engine`, `ILifecycleHook.engineCreated(engine: Engine)` | Both typed `IEngine`. Cast to `Engine` only where you need a member outside `IEngine` |
| `Engine.stop()` | Stopped polling and the channels | Also halts the queue and waits for an in-flight `start()` and `prepare()` (skill preparation). A skill provider that ignores cancellation holds `stop()` until it settles |
| Cron schedule lock | `createStoreScheduleLock(store, owner)` | `createRepositoryScheduleLock(store.locks, owner)` (`@chamvi/channel-cron`, takes an `ILockRepository`) |
| Engine concurrency option | `new Engine({ maxConcurrentRuns })` | `new Engine({ concurrencyMaxRuns })`; the variable `CHAMVI_MAX_CONCURRENT_RUNS` is unchanged |
| App config concurrency | `readConfig(env).engine.maxConcurrentRuns` | `readConfig(env).engine.concurrencyMaxRuns` (`AppConfig`); the variable `CHAMVI_MAX_CONCURRENT_RUNS` is unchanged |
| Run references (memory, database and custom stores) | `steps.insert`, `checkpoints.save` and `conversations.beginTurn` accepted any run id on the memory store; Postgres failed with a raw foreign key error | All three throw `RunNotFoundError` for a run the store does not hold and write nothing, on memory and Postgres alike. `describeRepositoryContract()` checks it, so a custom store must implement it to pass ([Run references](/repositories/writing-a-repository#run-references)). Insert the run first; a test that spreads `{ ...createMemoryStore(), runs: custom }` builds `steps`/`checkpoints`/`conversations` with `hasRun` over `custom` (see [Memory repositories](/repositories/memory)) |
| Node | `>=22` | `>=24.3.0` |
| Run taint | No taint column | Database migration `ConversationsRunTaint1792713600000` adds `chamvi_runs.taint` and backfills unfinished runs; it needs downtime (below). Custom stores must persist `Run.taint` ([Persist run taint](/repositories/writing-a-repository#persist-run-taint)) |

### New in 0.4

Conversation memory is opt-in and new, so 0.3 apps have nothing to migrate: storage is `store.conversations` (both built-in stores carry it), policy is `createApp({ conversations: { authorize } })` or `EngineOptions.conversations`. See [Conversations](/guide/conversations) for the setup.

### Database migration

0.4 ships one new migration, `1792713600000-conversations-run-taint.ts` (`ConversationsRunTaint1792713600000`): the conversation tables, the run and checkpoint conversation bindings, the foreign keys (the two on legacy steps and checkpoints `NOT VALID`, see [Validating the legacy constraints](/repositories/database#validating-the-legacy-constraints)), indexes on the new foreign key columns, `chamvi_runs.taint` and the backfill that taints every `queued`, `running`, `waiting` and `interrupted` run with `{ at: <migration time>, source: 'migration:legacy-run' }`.

::: warning Development databases
A database that ran a pre-release build of this branch recorded `Conversations1792713600000` (and maybe `RunTaint1792800000000`). Migrating it fails with "relation already exists". Recreate the disposable database; never reset a production one for this.
:::

### Upgrade procedure (downtime)

Old and new runtimes must never share the store, not even during a rolling update. An old approval poller can post a tainted run's private approval body to its source channel, and an old worker or job can create or checkpoint untainted runs after the one-time backfill. Claims and locks do not prevent this.

1. **Suspend the run-job CronJobs** (`kubectl patch cronjob <name> -p '{"spec":{"suspend":true}}'`, or `suspend: true` on each `cronJobs[]` entry of the `agent-app` chart) and wait for running job pods to finish. A `Recreate` Deployment does not cover CronJobs, and `CHAMVI_MIGRATE` defaults to `true` in job mode too: a 0.3 job pod started during the upgrade writes runs the backfill never sees.
2. **Stop every old process**: scale the Deployment to 0 (ingress, workers, approval pollers) and wait for the pods to exit. Draining executions alone is not enough.
3. **Migrate in a maintenance window**: run `chamvi migrate` once with the new image (`DATABASE_URL` set). Alternatively start the new Deployment with the default `CHAMVI_MIGRATE=true`; with `CHAMVI_MIGRATE=false` everywhere, `chamvi start --check` refuses the unmigrated database.
4. **Start only 0.4 binaries**: scale the Deployment up, then resume the CronJobs with the new image. Resumed legacy runs are tainted, so their guarded tools ask for approval.

See [Multiple replicas](/deployment/replicas#upgrading-to-untrusted-content-gates) for why each step matters.

### Release-time owner actions

These are not code changes; the maintainer does them when 0.4.0 is published:

- After the first `@chamvi/store-db` publish: `npm deprecate @chamvi/store-typeorm "renamed to @chamvi/store-db"`.
- Check that the `NPM_TOKEN` used by `release.yml` (monoship) may create new packages: `@chamvi/skills` and `@chamvi/store-db` publish for the first time.
- `@chamvi/skills` depends on a Git URL (`git+https://github.com/tada5hi/skills-cli.git#<sha>`): registry-only proxies and the agent-template lockfile check refuse it. Publish or vendor the fork before relying on it ([#97](https://github.com/chamvi/chamvi/issues/97)).
- Downstream: bump [chamvi/helm](https://github.com/chamvi/helm) and [chamvi/agent-template](https://github.com/chamvi/agent-template) from `^0.3.x` to `^0.4.0` after publishing (Node 24, the CronJob suspend note in the chart README, no `CHAMVI_GIT_CREDENTIAL_MODE`).
