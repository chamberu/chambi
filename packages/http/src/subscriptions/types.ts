/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { ChannelSubscription } from '@chamvi/core';
import type { StandardSchemaV1 } from '@standard-schema/spec';

export type HttpSubscriptionOptions = {
    /** Shared-store execution cap for REST, UI and MCP starts; omitted or false adds no cap. */
    maxConcurrentRuns?: number | false;
    /** Validates the payload of a REST, UI or MCP start. */
    schema?: StandardSchemaV1;
};

/** Makes the `http` subscription (id `http`, at most one per agent). */
export type HttpSubscriber = {
    on(options?: HttpSubscriptionOptions): ChannelSubscription;
};

export type WebhookSubscriptionOptions = {
    /** Shared-store execution cap within the agent; omitted or false adds no cap. */
    maxConcurrentRuns?: number | false;
    /** Validates the delivered payload. */
    schema?: StandardSchemaV1;
    /** The run's idempotency key when the delivery has no `Idempotency-Key` header. */
    idempotencyKey?: (payload: unknown) => string | undefined;
    concurrencyKey?: (payload: unknown) => string | undefined;
};

/** Makes webhook subscriptions for one channel name. */
export type WebhookSubscriber = {
    /** `path` starts with `/`; the subscription id is `webhook:<path>`. */
    on(path: string, options?: WebhookSubscriptionOptions): ChannelSubscription;
};
