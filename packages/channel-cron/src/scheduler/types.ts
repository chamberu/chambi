/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { ChannelContext, IEngine } from '@chamvi/core';
import type { CronChannelErrorContext } from '../channel/types.ts';

export type SchedulerOptions = {
    /** Its agents' subscriptions of `channel` are scheduled; its store holds the tick locks. */
    engine: IEngine;
    /** The cron channel's name: only subscriptions naming it are scheduled. */
    channel: string;
    /** The channel's dispatch; default engine.dispatch with the subscription's channel. */
    dispatch?: ChannelContext['dispatch'];
    /** Lock owner. Default `${hostname()}-${pid}`. */
    owner?: string;
    /** How long a tick's lock key is held. Default SCHEDULE_LOCK_TTL_MS. */
    lockTtlMs?: number;
    /** Receives failing ticks. Default console.error('[chamvi]', error, ctx). */
    onError?: (error: unknown, ctx: CronChannelErrorContext) => void;
};

export interface IScheduler {
    /** Schedules every subscription; never fires on start. Idempotent; does nothing after stop(). */
    start(): Promise<void>;
    /**
     * Stops following agent changes, unschedules every subscription, then
     * waits for ticks in flight (also of replaced and removed agents). Idempotent.
     */
    stop(): Promise<void>;
}
