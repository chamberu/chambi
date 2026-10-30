/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { InvalidAgentDefinitionError } from '@chamvi/core';
import type { CronChannelOptions } from './types.ts';

const CRON_CHANNELS = new WeakSet<object>();

/** Records `channel` as made by cronChannel(), so runJob can tell cron subscriptions apart. */
export function markCronChannel(channel: object): void {
    CRON_CHANNELS.add(channel);
}

/** Whether `channel` was made by this package's cronChannel(). */
export function isCronChannel(channel: unknown): boolean {
    // WeakSet.has answers false for a non-object
    return CRON_CHANNELS.has(channel as object);
}

/** Refuses options hubwire would refuse later, so a bad channel fails when built. */
export function assertCronChannelOptions(options: CronChannelOptions): void {
    const { lockTtlMs, owner } = options;

    if (lockTtlMs !== undefined && (!Number.isSafeInteger(lockTtlMs) || lockTtlMs <= 0)) {
        throw new InvalidAgentDefinitionError(`cronChannel: lockTtlMs must be a positive integer, got ${String(lockTtlMs)}.`);
    }

    if (owner !== undefined && (typeof owner !== 'string' || owner.length === 0)) {
        throw new InvalidAgentDefinitionError('cronChannel: owner must be a non-empty string.');
    }
}
