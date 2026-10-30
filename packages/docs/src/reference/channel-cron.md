# @chamvi/channel-cron

The cron channel: fires `cron.on()` subscriptions once per tick across replicas, on hubwire. The public API of `packages/channel-cron/src/index.ts`.

```bash
npm install @chamvi/channel-cron @chamvi/core --save
```

`@chamvi/core` is a peer dependency. See [Cron Scheduling](/guide/scheduler) for the behaviour.

## cronChannel

```ts
function cronChannel(options?: CronChannelOptions): CronChannel; // IChannel with start/stop, plus on() bound to its name

const CRON_CHANNEL_NAME: 'cron';
const SCHEDULE_LOCK_TTL_MS: 600_000;
```

<<< ../../../channel-cron/src/channel/types.ts{ts}

`engine.start()` starts the channel: it schedules the cron subscriptions **of this channel** (`subscription.channel === name`) of `engine.listAgents()` and locks over `engine.store`. A code agent's subscription the scheduler cannot use (expression, timezone) fails `engine.start()` with `InvalidAgentDefinitionError`; a folder agent's (one the engine holds at a revision) goes to `onError` instead and leaves that agent unscheduled. An invalid `name` (the agent-name rule), an empty `owner` or a `lockTtlMs` that is no positive integer throws `InvalidAgentDefinitionError` when `cronChannel()` is called.

It follows the engine's `agents.changed` events: an added agent is scheduled, a replaced one rescheduled, a removed one unscheduled. A replacement whose cron subscription hubwire cannot schedule goes to `onError` and leaves that agent unscheduled. `stop()` (called first by `engine.drain()` and `engine.stop()`) stops following and waits for the ticks in flight, also of replaced and removed agents.

```ts
function assertSchedulable(agent: Agent, channel?: string): void; // channel default 'cron'
```

Throws the same error as the start for an agent's subscriptions of `channel`, without scheduling anything; the app runs it on every folder agent before registering it.

## cron.on

```ts
const cron: CronSubscriber; // cron.on(expression, options?): a subscription of the channel named 'cron'
```

<<< ../../../channel-cron/src/subscription/types.ts{ts}

Throws `InvalidAgentDefinitionError` for an expression cron-parser refuses, an unknown timezone, an unknown `overlap` or an empty `id`. The id defaults to `cron:<expression>`.

## runJob

```ts
function runJob(opts: RunJobOptions): Promise<RunJobResult>;
```

Starts the engine with `start({ channels: false })`. Rejects with `InvalidAgentDefinitionError` when the subscription is missing or ambiguous, or the engine holds no cron channel for it.

<<< ../../../channel-cron/src/run-job/types.ts{ts}

## Building blocks

```ts
function fireCronSubscription(ctx: CronTickContext): Promise<CronTickResult>;
function readCronOptions(agent: Agent, subscription: ChannelSubscription): CronOptions;
function createRepositoryScheduleLock(store: ILockRepository, owner: string): IScheduleLock;
```

`fireCronSubscription` is one tick (overlap check and dispatch) for an explicit `scheduledAt`; the channel and `runJob` both call it. `createRepositoryScheduleLock` adapts core's `ILockRepository` to hubwire's `IScheduleLock`.

<<< ../../../channel-cron/src/tick/types.ts{ts}
