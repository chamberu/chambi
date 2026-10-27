/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type {
    ChannelContext,
    ChannelDispatchEnvelope,
    ChannelRequest,
    ChannelSubscription,
} from '@chamvi/core';
import { readRequestBody } from '@chamvi/http';
import { NotFoundError, UnauthorizedError, UnsupportedMediaTypeError } from '@ebec/http';
import { isSameLogin } from '../app/helpers.ts';
import type { IGithubApp } from '../app/types.ts';
import type { ResolvedGithubChannelOptions } from '../channel/types.ts';
import { acceptsSelfSent, eventAddress, matchesGithubSubscription } from '../subscription/helpers.ts';
import type { GithubEvent } from '../subscription/types.ts';
import {
    isJsonMediaType,
    readHeaders,
    toGithubEvent,
} from './helpers.ts';
import type { GithubWebhookResult } from './types.ts';

/** The answer to a delivery some agent could not be dispatched for (shaped like the http app's errors). */
function dispatchFailed(): Response {
    return Response.json({
        status: 500,
        code: 'internal_error',
        message: 'Internal Server Error',
    }, { status: 500 });
}

/** True when the App itself sent the delivery (its comment, label, ...). */
async function isSelfSent(app: IGithubApp, event: GithubEvent): Promise<boolean> {
    const { sender } = event.payload;
    if (sender?.type !== 'Bot') return false;
    return isSameLogin(sender.login, await app.botLogin());
}

/**
 * The GitHub channel's `in`: a delivery to the bare channel path (else
 * 404). Checks, in order: the signature header (401), the event and
 * delivery headers (400), the body size (413) and media type (415), the
 * signature over the raw bytes under every webhook secret (401) and the
 * body being a JSON object (400). Then every agent's first subscription of
 * this channel matching the event gets one run, keyed by
 * `idempotencyKey(event) ?? delivery`, with the address of the event's
 * issue or pull request; all keys are computed before any dispatch. A
 * delivery the App sent itself goes to each agent's first matching
 * subscription whose `selfEvents` name its event (none: no run). A failing agent (filter,
 * key function, refused key, dispatch) goes to `onError`, the others are
 * still dispatched, and the answer is then 500.
 */
export async function receiveDelivery(
    { request, subpath }: ChannelRequest,
    ctx: ChannelContext,
    options: ResolvedGithubChannelOptions,
): Promise<Response> {
    if (subpath !== '') throw new NotFoundError({ message: 'The GitHub channel takes deliveries at its own path only.' });
    const signature = request.headers.get('x-hub-signature-256');
    if (signature === null) {
        throw new UnauthorizedError({ message: 'The X-Hub-Signature-256 header is missing.' });
    }
    const { name, delivery } = readHeaders(request);
    const body = await readRequestBody(request, { limit: options.bodyLimit });
    if (body.byteLength > 0 && !isJsonMediaType(request.headers.get('content-type'))) {
        throw new UnsupportedMediaTypeError({ message: 'The delivery must be application/json; set the App\'s webhook content type to JSON.' });
    }
    if (!options.app.verifySignature(body, signature)) {
        throw new UnauthorizedError({ message: 'The delivery signature does not match.' });
    }
    const event = toGithubEvent(body, name, delivery);
    const address = eventAddress(event);

    // a failing agent (a throwing filter or key function, a key dispatch
    // refuses) goes to onError and does not stop the others
    let failed = false;
    const fail = (error: unknown) => {
        failed = true;
        options.onError(error);
    };
    // per agent its first matching subscription, and the first one that
    // also takes the bot's own delivery (a later subscription may opt in)
    const matches: Array<{
        agent: string; 
        first: ChannelSubscription; 
        self?: ChannelSubscription 
    }> = [];
    for (const agent of ctx.engine.listAgents()) {
        try {
            const subscriptions = agent.definition.channels ?? [];
            const first = subscriptions.find((s) => matchesGithubSubscription(s, options.name, event));
            if (!first) continue;
            const self = subscriptions.find((s) => acceptsSelfSent(s, event) && matchesGithubSubscription(s, options.name, event));
            matches.push({
                agent: agent.name, 
                first, 
                ...(self ? { self } : {}), 
            });
        } catch (error) {
            fail(error);
        }
    }

    // the loop guard: a delivery the App sent itself starts only subscriptions that opted in
    const selfSent = matches.length > 0 && await isSelfSent(options.app, event);
    const envelopes: ChannelDispatchEnvelope[] = [];
    for (const match of matches) {
        const subscription = selfSent ? match.self : match.first;
        if (!subscription) continue;
        try {
            const concurrencyKey = subscription.concurrencyKey?.(event);
            envelopes.push({
                agent: match.agent,
                trigger: subscription.id,
                payload: event,
                idempotencyKey: subscription.idempotencyKey?.(event) ?? delivery,
                ...(concurrencyKey !== undefined ? { concurrencyKey } : {}),
                ...(address !== undefined ? { address } : {}),
            });
        } catch (error) {
            fail(error);
        }
    }

    const result: GithubWebhookResult = { delivery, runs: [] };
    for (const envelope of envelopes) {
        try {
            const { runId, deduplicated } = await ctx.dispatch(envelope);
            result.runs.push({
                agent: envelope.agent,
                runId,
                deduplicated,
            });
        } catch (error) {
            fail(error);
        }
    }
    return failed ? dispatchFailed() : Response.json(result, { status: 202 });
}
