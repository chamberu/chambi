/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { ChannelSubscription } from '@chamvi/core';
import { InvalidAgentDefinitionError, assertConcurrencyMaxRuns } from '@chamvi/core';
import { CronExpressionParser } from 'cron-parser';
import { CRON_CHANNEL_NAME } from '../channel/constants.ts';
import { OVERLAP_POLICIES } from './constants.ts';
import type { CronSubscriber, CronSubscriptionOptions } from './types.ts';

/**
 * A subscription of `channel` (a cron channel's name) firing on
 * `expression`. Throws InvalidAgentDefinitionError for an expression or
 * timezone cron-parser refuses, an unknown overlap policy or an empty id.
 */
export function createCronSubscription(
    channel: string,
    expression: string,
    options: CronSubscriptionOptions = {},
): ChannelSubscription {
    assertConcurrencyMaxRuns(options.concurrencyMaxRuns, 'cron.on() concurrencyMaxRuns');
    try {
        CronExpressionParser.parse(expression, options.timezone ? { tz: options.timezone } : {});
    } catch (e) {
        throw new InvalidAgentDefinitionError(
            `Invalid cron expression "${expression}": ${e instanceof Error ? e.message : String(e)}`,
        );
    }
    if (options.timezone !== undefined) {
        try {
            // cron-parser takes any zone name; Intl refuses one it does not know
            Intl.DateTimeFormat('en-US', { timeZone: options.timezone }).resolvedOptions();
        } catch {
            throw new InvalidAgentDefinitionError(`Cron "${expression}" has an invalid timezone "${String(options.timezone)}".`);
        }
    }
    const overlap = options.overlap ?? 'skip';
    if (!OVERLAP_POLICIES.includes(overlap)) {
        throw new InvalidAgentDefinitionError(`Cron "${expression}" has an unknown overlap policy "${String(overlap)}".`);
    }
    if (options.id !== undefined && (typeof options.id !== 'string' || options.id.length === 0)) {
        throw new InvalidAgentDefinitionError(`Cron "${expression}" needs a non-empty id.`);
    }

    return {
        channel,
        id: options.id ?? `cron:${expression}`,
        ...(options.concurrencyMaxRuns !== undefined ? { concurrencyMaxRuns: options.concurrencyMaxRuns } : {}),
        options: {
            expression,
            timezone: options.timezone,
            overlap,
            payload: options.payload,
        },
    };
}

/**
 * Subscriptions for the default cron channel (`cronChannel()`, named
 * `cron`): `cron.on('0 8 * * 1-5', { timezone: 'Europe/Berlin' })`. Pure
 * data, so agent folders use it without a channel instance; a second cron
 * channel makes its subscriptions with its own `on()`.
 */
export const cron: CronSubscriber = { on: (expression, options) => createCronSubscription(CRON_CHANNEL_NAME, expression, options) };
