/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { ChannelSubscription } from '@chamvi/core';

/** What a tick does while a run of the same subscription is active. */
export type OverlapPolicy = 'skip' | 'queue-one' | 'allow';

export type CronSubscriptionOptions = {
    /** Shared-store execution cap within the agent; omitted or false adds no cap. */
    maxConcurrentRuns?: number | false;
    /** IANA zone; default the process's local zone. */
    timezone?: string;
    /** Default `skip`. */
    overlap?: OverlapPolicy;
    /** The run's payload; default `{ scheduledAt: '<ISO>' }`. */
    payload?: unknown;
    /** The subscription id, unique per agent; default `cron:<expression>`. */
    id?: string;
};

/** Makes cron subscriptions for one channel name. */
export type CronSubscriber = {
    on(expression: string, options?: CronSubscriptionOptions): ChannelSubscription;
};
