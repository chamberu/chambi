/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { InvalidAgentDefinitionError, hasPermission } from '@chamvi/core';
import type { ChannelContext, ChannelRequest } from '@chamvi/core';
import {
    BadRequestError,
    ForbiddenError,
    NotFoundError,
    UnsupportedMediaTypeError,
} from '@ebec/http';
import type { StandardSchemaV1 } from '@standard-schema/spec';
import { DEFAULT_BODY_LIMIT } from '../app/constants.ts';
import { resolvePrincipal } from '../auth/helpers.ts';
import { agentPermission } from '../auth/module.ts';
import {
    assertDerivedKey,
    isJsonMediaType,
    readIdempotencyHeader,
    readRequestBody,
    validatePayload,
} from '../request/helpers.ts';
import { createWebhookSubscription } from '../subscriptions/webhook.ts';
import { WEBHOOK_CHANNEL_NAME } from './constants.ts';
import { markWebhookChannel, parseWebhookSubpath } from './helpers.ts';
import type { WebhookChannel, WebhookChannelOptions } from './types.ts';

function assertOptions(options: WebhookChannelOptions): void {
    const auth = Array.isArray(options?.auth) ? options.auth : [options?.auth];

    const hasInvalidAuthenticator = auth.length !== 0 &&
        auth.some((authenticator) => typeof authenticator !== 'function');

    if (auth.length === 0 || hasInvalidAuthenticator) {
        throw new InvalidAgentDefinitionError('webhookChannel: auth needs at least one authenticator.');
    }

    const { bodyLimit } = options;

    if (bodyLimit !== undefined && (!Number.isSafeInteger(bodyLimit) || bodyLimit < 1)) {
        throw new InvalidAgentDefinitionError(`webhookChannel: bodyLimit must be a positive integer, got ${String(bodyLimit)}.`);
    }
}

/**
 * The generic webhook channel, served by the http app at
 * `POST /channels/<name>/<agent><path>` (`webhook.on('/issues')` on agent
 * `intake` is `/channels/webhook/intake/issues`, a path of `/` is
 * `/channels/webhook/intake`; the match is exact). A delivery needs a
 * principal of `auth` holding `agent:<agent>:run` (checked before the body
 * is read) and a JSON body of at most `bodyLimit` bytes, which is the whole
 * payload, validated by the subscription's schema. The idempotency key is
 * the `Idempotency-Key` header, else `idempotencyKey(payload)`. Runs carry
 * no invoker and are answered `202 { runId, deduplicated }` without waiting.
 * Throws InvalidAgentDefinitionError without authenticators or for a
 * `bodyLimit` that is no positive integer.
 */
export function webhookChannel(options: WebhookChannelOptions): WebhookChannel {
    assertOptions(options);

    const name = options.name ?? WEBHOOK_CHANNEL_NAME;
    const authenticators = Array.isArray(options.auth) ? [...options.auth] : [options.auth];
    const limit = options.bodyLimit ?? DEFAULT_BODY_LIMIT;

    const receive = async ({ request, subpath }: ChannelRequest, ctx: ChannelContext): Promise<Response> => {
        const target = parseWebhookSubpath(subpath);
        const principal = await resolvePrincipal(request, authenticators);

        if (!target) {
            throw new NotFoundError({ message: 'The webhook URL names no agent.' });
        }

        const permission = agentPermission(target.agent, 'run');

        if (!hasPermission(principal.permissions, permission)) {
            throw new ForbiddenError({ message: `Missing permission "${permission}".` });
        }

        const subscription = ctx.engine.getAgent(target.agent)?.definition.channels
            ?.find((s) => s.channel === name && s.options.path === target.path);

        if (!subscription) {
            throw new NotFoundError({ message: `No webhook "${target.path}" on agent "${target.agent}".` });
        }

        const bytes = await readRequestBody(request, { limit });

        if (bytes.byteLength === 0) {
            throw new BadRequestError({ message: 'The webhook needs a JSON body.' });
        }

        if (!isJsonMediaType(request.headers.get('content-type'))) {
            throw new UnsupportedMediaTypeError({ message: 'The request body must be application/json.' });
        }

        let body: unknown;

        try {
            body = JSON.parse(new TextDecoder().decode(bytes));
        } catch {
            throw new BadRequestError({ message: 'The request body is not valid JSON.' });
        }

        const payload = await validatePayload(subscription.options.schema as StandardSchemaV1 | undefined, body);

        const idempotencyKey = readIdempotencyHeader(request) ?? subscription.idempotencyKey?.(payload);
        const concurrencyKey = subscription.concurrencyKey?.(payload);

        assertDerivedKey('idempotency key', idempotencyKey);
        assertDerivedKey('concurrency key', concurrencyKey);

        const result = await ctx.dispatch({
            agent: target.agent,
            trigger: subscription.id,
            payload,
            ...(idempotencyKey !== undefined ? { idempotencyKey } : {}),
            ...(concurrencyKey !== undefined ? { concurrencyKey } : {}),
        });

        return Response.json(result, { status: 202 });
    };

    const channel: WebhookChannel = {
        name,
        untrusted: true,
        in: receive,
        on: (path, subscriptionOptions) => createWebhookSubscription(name, path, subscriptionOptions),
    };

    markWebhookChannel(channel);

    return channel;
}
