<p align="center">
    <img src="https://raw.githubusercontent.com/chamvi/chamvi/master/.github/assets/logo.svg" alt="@chamvi/channel-cron" width="128" height="128" />
</p>

<h1 align="center">@chamvi/channel-cron</h1>

<p align="center">
    <b>The chamvi cron channel: fires cron subscriptions once per tick across replicas, on hubwire.</b><br>
    Every replica registers the same channel. A lock in the store elects one per tick,<br>
    and the same package fires a subscription one-shot for a Kubernetes CronJob.
</p>

<p align="center">
    <a href="https://www.npmjs.com/package/@chamvi/channel-cron"><img src="https://img.shields.io/npm/v/@chamvi/channel-cron" alt="npm version" /></a>
    <a href="https://github.com/chamvi/chamvi/actions/workflows/ci.yml"><img src="https://github.com/chamvi/chamvi/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
    <a href="https://github.com/chamvi/chamvi/blob/master/packages/channel-cron/LICENSE"><img src="https://img.shields.io/npm/l/@chamvi/channel-cron" alt="License" /></a>
</p>

---

**Table of Contents**
- [Installation](#installation)
- [Usage](#usage)
- [How a tick works](#how-a-tick-works)
- [Overlap policies](#overlap-policies)
- [Timezones](#timezones)
- [Shutdown](#shutdown)
- [One-shot jobs](#one-shot-jobs)
- [Options](#options)
- [API](#api)
- [License](#license)

## Installation

```bash
npm install @chamvi/channel-cron @chamvi/core --save
```

ESM only, Node.js `>=22`. `@chamvi/core` is a peer dependency; [`hubwire`](https://www.npmjs.com/package/hubwire) (croner inside) and [`cron-parser`](https://www.npmjs.com/package/cron-parser) are installed with the package.

## Usage

`cron.on()` subscribes an agent to the cron channel; `cronChannel()` is the channel the engine starts:

```typescript
import type { LanguageModel } from 'ai';
import {
    Engine,
    createMemoryRepositories,
    defineAgent,
} from '@chamvi/core';
import { cron, cronChannel } from '@chamvi/channel-cron';

export async function startScheduling(model: LanguageModel) {
    const sweep = defineAgent({
        name: 'sweep',
        model,
        instructions: 'Close stale issues older than 30 days.',
        // every 30 minutes, Berlin time; skipped while the previous run is active
        channels: [cron.on('*/30 * * * *', { timezone: 'Europe/Berlin' })],
    });

    // createMemoryRepositories is per process; with several replicas, pass one shared store
    // (e.g. createTypeormRepositories) so its lock fires each tick once across them
    const engine = new Engine({
        repositories: createMemoryRepositories(),
        agents: [sweep],
        // every replica registers the same channel; it reads agents and store from the engine
        channels: [cronChannel()],
    });

    // starts the cron channel after recovering runs
    await engine.start();

    // shutdown: drain() stops the channel first, then lets the runs in flight finish
    // await engine.drain();
    return { engine };
}
```

`cron.on(expression, options?)` validates the expression (cron-parser) and the timezone and throws `InvalidAgentDefinitionError` for one it refuses. `engine.start()` starts the channel after recovering runs: a code agent's subscription the scheduler cannot use (an expression croner refuses) fails `engine.start()` with `InvalidAgentDefinitionError` naming the agent and subscription, an agent folder's goes to `onError` and leaves that agent unscheduled. Subscriptions of other channels are ignored. The channel follows agents registered, replaced and removed at runtime.

A second cron channel (e.g. one per region) needs its own name; its `on()` makes subscriptions only it fires:

```ts
const eu = cronChannel({ name: 'cron-eu' });
defineAgent({ name: 'digest', channels: [eu.on('0 8 * * *', { timezone: 'Europe/Berlin' })] /* ... */ });
new Engine({ channels: [cronChannel(), eu] /* ... */ });
```

## How a tick works

- **One component per subscription.** Each becomes a hubwire scheduled component named `cron:<agent>:<subscriptionId>`.
- **One replica per tick.** Before a tick runs, the replica acquires the store lock `cron:<agent>:<subscriptionId>:<scheduledAt ISO>` (through `ILockRepository`) for `lockTtlMs` (default 10 minutes). The key is never released: a replica that fires the same tick late cannot win it again.
- **Deduplicated dispatch.** The winner dispatches through the channel (envelope `channel` = the channel's name, `trigger` = the subscription id) with payload `options.payload ?? { scheduledAt: '<ISO>' }` and the idempotency key `<subscriptionId>@<scheduledAt ISO>`, so even a second firing of the same tick returns the existing run. A subscription's own `idempotencyKey()` is ignored for cron.
- **Never on start.** Starting or restarting a replica fires nothing; the first dispatch is at the next scheduled tick.
- **No catch-up.** A tick that falls into a restart, or whose timer fires `lockTtlMs` or more late (a suspended process), is not fired later.
- **Failures are reported, not thrown.** A failing lock store, overlap check or dispatch reaches `onError(error, { agent, subscription })`; the next tick runs normally.

## Overlap policies

`cron.on(expression, { overlap })` sets the policy; the channel enforces it before dispatching. "Active" means a run of the same subscription in `queued`, `running`, `waiting` or `interrupted`.

| Policy | Tick is skipped when | Default `concurrencyKey` |
|---|---|---|
| `skip` (default) | any run of the subscription is active | the subscription id |
| `queue-one` | a run of the subscription is still `queued` | the subscription id |
| `allow` | never | none |

A `concurrencyKey()` on the subscription wins over the default. The default key is what makes `queue-one` wait: the engine starts one run per agent and key at a time, so the queued run starts when the active one settles. It also makes a race harmless: a tick that checks while the previous tick's dispatch is still in flight may dispatch a second run, which then waits instead of running alongside.

## Timezones

`cron.on(expression, { timezone: 'Europe/Berlin' })` takes an IANA zone; without one, the process's local zone applies. At DST changes:

- A local time that occurs twice (fall-back) fires once, at its first occurrence.
- A local time the spring-forward change skips fires once, an hour later in local time (`30 2 * * *` fires at 03:30).

## Shutdown

`engine.drain()` (and `engine.stop()`) stop the channel first (no new ticks; ticks in flight finish), then drain the runs:

```ts
await engine.drain(); // stops the cron channel, waits for running runs, then interrupts the rest
```

## One-shot jobs

`runJob()` fires one cron subscription once and waits for its run, for a Kubernetes CronJob instead of a long-lived replica:

```ts
const { exitCode } = await runJob({ engine, agent: sweep });
process.exitCode = exitCode;
```

It dispatches the tick at the current time (the overlap policy applies), starts the engine with `start({ channels: false })` (so a job never starts cron schedules or other channels) and runs one approval tick (also when the tick is skipped), waits until the run is `completed`, `failed`, `cancelled` or `waiting`, or `queued` behind a run of the same subscription that waits for an approval, then calls `engine.drain()`. The engine must hold the subscription's cron channel (it refuses the agent otherwise).

| Outcome | `status` | `exitCode` |
|---|---|---|
| The run completed | `completed` | `0` |
| The run waits for an approval | `waiting` | `0` |
| The run waits behind a run paused for an approval (`queue-one`) | `queued` | `0` |
| The overlap policy skipped the tick | `skipped` | `0` |
| The run failed or was cancelled | `failed`, `cancelled` | `1` |

A run that pauses for an approval does not hold the pod: the job returns, the approval is answered (or times out), and the answered run is executed by a long-lived replica or by the next job pod, which starts the engine even when its own tick is skipped. That pod also recovers a run whose pod was killed and denies approvals past their timeout. Caveats:

- `engine.start()` recovers and executes **every** queued run of **every** agent in the shared store, not only the cron run.
- `drain()` interrupts whatever still runs after `drainTimeoutMs`. `runJob` waits only for the run it dispatched, so a leftover run is finished by a long-lived replica or by a later job pod, within that pod's `drainTimeoutMs`.
- Size `drainTimeoutMs` to the job's runs, and prefer a long-lived deployment with `cronChannel()` when runs are long.

## Options

`cronChannel(options)`:

| Option | Type | Default | Description |
|---|---|---|---|
| `name` | `string` | `'cron'` | The channel name; `on()` subscribes to it |
| `owner` | `string` | `` `${hostname}-${pid}` `` | Lock owner |
| `lockTtlMs` | `number` | `600_000` | How long a tick's lock key is held; a tick firing this late or later is skipped |
| `onError` | `(error, { agent, subscription }) => void` | `console.error` | Failing ticks and an agent folder's unschedulable subscription |

`cron.on(expression, options)`:

| Option | Type | Default | Description |
|---|---|---|---|
| `timezone` | `string` | local zone | IANA zone |
| `overlap` | `'skip' \| 'queue-one' \| 'allow'` | `'skip'` | See [Overlap policies](#overlap-policies) |
| `payload` | `unknown` | `{ scheduledAt }` | The run's payload |
| `id` | `string` | `` `cron:${expression}` `` | Subscription id, unique per agent |

`runJob(options)`:

| Option | Type | Default | Description |
|---|---|---|---|
| `engine` | `Engine` | required | Not started yet; started without channels and drained by the job, also when the tick is skipped. Its clock gives `scheduledAt` and drives the poll |
| `agent` | `Agent` | required | The agent to fire |
| `subscription` | `string` | the only cron subscription | Cron subscription id; required when the agent has several |
| `pollMs` | `number` | `1_000` | Poll of `engine.getRun`, which also sees a run finished by another replica |
| `drainTimeoutMs` | `number` | `30_000` | Passed to `engine.drain()` |
| `signal` | `AbortSignal` | none | Stops the job (see the type's docs) |

## API

| Export | Kind | Purpose |
|---|---|---|
| `cronChannel` | function | The cron channel; `engine.start()` starts it, `drain()` stops it; `.on()` subscribes to it |
| `cron` | object | `cron.on(expression, options?)`: a subscription of the default `cron` channel |
| `runJob` | function | Fires one cron subscription once and waits for its run |
| `fireCronSubscription` | function | One tick: overlap check and dispatch, for a given `scheduledAt` |
| `readCronOptions` | function | Reads and validates the options `cron.on()` stores on a subscription |
| `assertSchedulable` | function | Throws for a subscription of a cron channel (default `cron`) the scheduler cannot use |
| `createRepositoryScheduleLock` | function | A hubwire `IScheduleLock` over core's `ILockRepository` |
| `CRON_CHANNEL_NAME` | constant | `'cron'` |
| `SCHEDULE_LOCK_TTL_MS` | constant | The default lock TTL, `600_000` |

Types: `CronChannel`, `CronChannelOptions`, `CronChannelErrorContext`, `CronSubscriber`, `CronSubscriptionOptions`, `OverlapPolicy`, `RunJobOptions`, `RunJobResult`, `CronOptions`, `CronTickContext`, `CronTickResult`, `CronTickDispatched`, `CronTickSkipped`.

## License

Published under [Apache License 2.0](./LICENSE).
