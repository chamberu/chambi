/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { ChannelSubscription } from '@chamvi/core';
import { InvalidAgentDefinitionError, assertMaxConcurrentRuns } from '@chamvi/core';
import { WEBHOOK_CHANNEL_NAME } from '../channels/constants.ts';
import type { WebhookSubscriber, WebhookSubscriptionOptions } from './types.ts';

/**
 * A subscription of `channel` (a webhook channel's name) on `path`, id
 * `webhook:<path>`; an agent may declare many. Throws
 * InvalidAgentDefinitionError for a path that does not start with `/`.
 */
export function createWebhookSubscription(
    channel: string,
    path: string,
    options: WebhookSubscriptionOptions = {},
): ChannelSubscription {
    assertMaxConcurrentRuns(options.maxConcurrentRuns, 'webhook.on() maxConcurrentRuns');
    if (typeof path !== 'string' || !path.startsWith('/')) {
        throw new InvalidAgentDefinitionError(`Webhook path "${path}" must start with "/".`);
    }

    const subscription: ChannelSubscription = {
        channel,
        id: `webhook:${path}`,
        ...(options.maxConcurrentRuns !== undefined ? { maxConcurrentRuns: options.maxConcurrentRuns } : {}),
        options: { path, schema: options.schema },
    };
    if (options.idempotencyKey) subscription.idempotencyKey = options.idempotencyKey;
    if (options.concurrencyKey) subscription.concurrencyKey = options.concurrencyKey;
    return subscription;
}

/**
 * Subscriptions for the default webhook channel (`webhookChannel()`, named
 * `webhook`): `webhook.on('/issues')` on agent `intake` is served at
 * `POST /channels/webhook/intake/issues`. Pure data; a second webhook
 * channel makes its subscriptions with its own `on()`.
 */
export const webhook: WebhookSubscriber = { on: (path, options) => createWebhookSubscription(WEBHOOK_CHANNEL_NAME, path, options) };
