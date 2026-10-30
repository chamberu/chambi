/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type {
    Agent,
    ChannelContext,
    ChannelSubscription,
    IEngine,
} from '@chamvi/core';
import type { OverlapPolicy } from '../subscription/types.ts';

/** The options `cron.on()` stores on a subscription, read back and checked. */
export type CronOptions = {
    expression: string;
    timezone?: string;
    overlap: OverlapPolicy;
    payload?: unknown;
};

export type CronTickContext = {
    engine: IEngine;
    agent: Agent;
    subscription: ChannelSubscription;
    /** The tick's planned fire time; forms the idempotency key. */
    scheduledAt: Date;
    /**
     * The channel's dispatch (sets the channel name itself). Default
     * engine.dispatch with `channel` = the subscription's channel.
     */
    dispatch?: ChannelContext['dispatch'];
};

export type CronTickDispatched = {
    dispatched: true;
    runId: string;
    deduplicated: boolean;
};

export type CronTickSkipped = {
    dispatched: false;
    reason: 'overlap';
};

export type CronTickResult = CronTickDispatched | CronTickSkipped;
