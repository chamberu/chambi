/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { ChamviError } from '@chamvi/core';
import type { ChannelContext, ChannelRequest } from '@chamvi/core';
import { readRequestBody } from '@chamvi/http';
import { trackIngress } from '../ingress/module.ts';
import { isRetryableIntakeError } from '../intake/module.ts';
import type { ChatIngress } from '../ingress/types.ts';
import {
    CHAT_BODY_LIMIT_BYTES,
    CHAT_INTAKE_FAILED_ERROR_CODE,
    CHAT_WEBHOOK_TIMEOUT_MS,
} from './constants.ts';
import { reportError } from './helpers.ts';
import type { ResolvedChatChannelOptions } from './types.ts';

/** An error answer shaped like the http app's (`{ status, code, message }`). */
function answer(status: number, code: string, message: string): Response {
    return Response.json({
        status,
        code,
        message,
    }, { status });
}

/** The webhook adapter `subpath` (`/<adapter>`, percent-encoded) names, else undefined. */
function webhookAdapterOf(subpath: string, options: ResolvedChatChannelOptions): ChatIngress | undefined {
    if (!subpath.startsWith('/') || subpath.includes('/', 1)) {
        return undefined;
    }

    let name: string;

    try {
        name = decodeURIComponent(subpath.slice(1));
    } catch {
        return undefined;
    }

    if (!options.webhooks.includes(name)) {
        return undefined;
    }

    return options.adapters.find((adapter) => adapter.name === name);
}

/** Settles every task of `tasks`, also those added while it waits; the rejected ones. */
async function settleAll(tasks: Set<Promise<unknown>>): Promise<Map<Promise<unknown>, unknown>> {
    const done = new Set<Promise<unknown>>();
    const rejected = new Map<Promise<unknown>, unknown>();

    for (;;) {
        const pending = [...tasks.difference(done)];

        if (pending.length === 0) {
            return rejected;
        }

        const results = await Promise.allSettled(pending);

        pending.forEach((task, index) => {
            done.add(task);

            const result = results[index];

            if (result?.status === 'rejected') {
                rejected.set(task, result.reason);
            }
        });
    }
}

/**
 * A chat channel's `in`: `POST /channels/<name>/<adapter>` for an adapter
 * of `webhooks` (anything else 404). Reads the body bounded at
 * `CHAT_BODY_LIMIT_BYTES` (413 before the adapter runs) and hands the
 * adapter a Request with the same URL, method, headers, signal and exactly
 * those bytes, so its own signature check sees what the platform signed.
 *
 * The answer waits for every task the call started: the messages the adapter
 * handed to the chat (tracked whether or not it passed `waitUntil` on) and
 * the tasks it gave `waitUntil`. Any of them failing in a way a redelivery
 * may fix (a store failure, the channel not started or stopped, a failed task
 * of the adapter) answers 503, never the adapter's 2xx; so does no settlement
 * within `CHAT_WEBHOOK_TIMEOUT_MS` on the engine's clock (reported). A message
 * only refused (media, no text, invalid ids, no conversation identity, a
 * denial, a throwing filter) gets the adapter's own Response, since a
 * redelivery cannot change it. A failed message is reported by the intake, a
 * failed task of the adapter here. Otherwise the adapter's own Response is the
 * answer (its 401 for a bad signature included). A throwing adapter throws (500).
 */
export async function receiveWebhook(
    { request, subpath }: ChannelRequest,
    ctx: ChannelContext,
    options: ResolvedChatChannelOptions,
): Promise<Response> {
    const adapter = webhookAdapterOf(subpath, options);

    if (!adapter) {
        return answer(404, 'not_found', `Chat channel "${options.name}" takes webhooks of its webhook adapters only, at /<adapter>.`);
    }

    const body = await readRequestBody(request, { limit: CHAT_BODY_LIMIT_BYTES });
    const forwarded = new Request(request.url, {
        method: request.method,
        headers: new Headers(request.headers),
        body: body.byteLength > 0 ? body : null,
        signal: request.signal,
    });

    const messages = new Set<Promise<unknown>>();
    const tasks = new Set<Promise<unknown>>();
    const work = (async () => {
        const response = await trackIngress(
            (task) => {
                messages.add(task);
                tasks.add(task);
            },
            () => adapter.handleWebhook(forwarded, {
                waitUntil: (task) => {
                    tasks.add(Promise.resolve(task));
                },
            }),
        );

        return { response, rejected: await settleAll(tasks) };
    })();

    let timer: { clear(): void } | undefined;
    const timeout = new Promise<undefined>((resolve) => {
        timer = ctx.engine.clock.setTimeout(() => resolve(undefined), CHAT_WEBHOOK_TIMEOUT_MS);
    });

    let outcome: Awaited<typeof work> | undefined;

    try {
        outcome = await Promise.race([work, timeout]);
    } finally {
        timer?.clear();
    }

    if (!outcome) {
        // what is still running settles (and reports) on its own
        work.catch(() => undefined);
        reportError(options, new ChamviError({
            message: `Chat channel "${options.name}" did not accept a webhook of adapter "${adapter.name}" within ${CHAT_WEBHOOK_TIMEOUT_MS}ms.`,
            code: CHAT_INTAKE_FAILED_ERROR_CODE,
        }));

        return answer(503, 'service_unavailable', `Chat channel "${options.name}" could not accept the webhook in time; deliver it again.`);
    }

    if (outcome.rejected.size === 0) {
        return outcome.response;
    }

    let retryable = false;

    for (const [task, error] of outcome.rejected) {
        if (messages.has(task)) {
            // a message's failure was reported by the intake already; a refusal stays one on redelivery
            retryable ||= isRetryableIntakeError(error);
        } else {
            reportError(options, error);
            retryable = true;
        }
    }

    // only refusals: the platform must not redeliver the message forever
    if (!retryable) {
        return outcome.response;
    }

    return answer(503, 'service_unavailable', `Chat channel "${options.name}" could not accept the webhook; deliver it again.`);
}
