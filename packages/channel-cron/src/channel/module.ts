/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { createScheduler } from '../scheduler/module.ts';
import type { IScheduler } from '../scheduler/types.ts';
import { createCronSubscription } from '../subscription/module.ts';
import { CRON_CHANNEL_NAME } from './constants.ts';
import { assertCronChannelOptions, markCronChannel } from './helpers.ts';
import type { CronChannel, CronChannelOptions } from './types.ts';

/**
 * The cron channel. `engine.start()` starts it: every subscription of the
 * engine's agents naming this channel becomes one hubwire component, guarded
 * by a per-tick lock in the engine's store, so replicas sharing the store
 * dispatch each tick once (never on start). It follows the engine's
 * `agents.changed` events. A code agent's subscription hubwire cannot
 * schedule fails `engine.start()` (InvalidAgentDefinitionError); a folder
 * agent's goes to `onError` and leaves that agent unscheduled.
 * `engine.drain()`/`stop()` stop it first and wait for ticks in flight.
 * Throws InvalidAgentDefinitionError for an invalid `lockTtlMs` or `owner`.
 */
export function cronChannel(options: CronChannelOptions = {}): CronChannel {
    assertCronChannelOptions(options);

    const name = options.name ?? CRON_CHANNEL_NAME;
    let scheduler: IScheduler | undefined;

    const stop = async () => {
        const current = scheduler;

        scheduler = undefined;
        await current?.stop();
    };

    const channel: CronChannel = {
        name,
        async start(ctx) {
            // a start without a stop in between replaces the schedule, never doubles it
            await stop();

            const next = createScheduler({
                engine: ctx.engine,
                channel: name,
                dispatch: ctx.dispatch,
                owner: options.owner,
                lockTtlMs: options.lockTtlMs,
                onError: options.onError,
            });

            scheduler = next;
            await next.start();
        },
        stop,
        on: (expression, subscriptionOptions) => createCronSubscription(name, expression, subscriptionOptions),
    };

    markCronChannel(channel);

    return channel;
}
