/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { CRON_CHANNEL_NAME, assertSchedulable, cronChannel } from '@chamvi/channel-cron';
import type { IChannel } from '@chamvi/core';
import type { IContainer } from 'eldin';
import type { IModule } from 'orkos';
import { AppToken, ModuleName } from '../../module/constants.ts';
import type { SchedulerModuleOptions } from './types.ts';

/**
 * Contributes the cron channel (`cronChannel()` of `@chamvi/channel-cron`)
 * to `CHANNELS` in start and job mode, so `cron.on()` subscriptions
 * validate; `engine.start()` starts it (a job never starts channels, its
 * runJob fires the one subscription itself) and the drain stops it. With
 * `CHAMVI_SCHEDULER` off, start mode contributes a `cron` channel that
 * fires nothing. `setup` also contributes the folder agents' cron check
 * (`AGENT_CHECKS`).
 */
export class SchedulerModule implements IModule {
    readonly name: string = ModuleName.SCHEDULER;

    readonly dependencies = [ModuleName.CONFIG];

    protected options: SchedulerModuleOptions;

    constructor(options: SchedulerModuleOptions = {}) {
        this.options = options;
    }

    async setup(container: IContainer): Promise<void> {
        const context = container.resolve(AppToken.CONTEXT);

        if (context.mode === 'migrate') {
            return;
        }

        // a folder agent with a cron subscription hubwire refuses is a load issue, in every mode, so the modes agree
        container.registerMany(AppToken.AGENT_CHECKS, { useValue: (agent) => assertSchedulable(agent) });

        const enabled = context.mode === 'job' || container.resolve(AppToken.CONFIG).scheduler.enabled;
        const channel: IChannel = enabled ?
            cronChannel({
                ...this.options,
                onError: (error, ctx) => container.resolve(AppToken.LOGGER).error('schedule error', error, ctx),
            }) :
            // subscriptions still validate; nothing is scheduled
            { name: CRON_CHANNEL_NAME };

        container.registerMany(AppToken.CHANNELS, { useValue: channel });
    }
}

export function schedulerModule(options?: SchedulerModuleOptions): IModule {
    return new SchedulerModule(options);
}
