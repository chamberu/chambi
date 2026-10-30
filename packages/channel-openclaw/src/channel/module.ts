/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { ChannelMessage, ChannelSendOptions, IChannel } from '@chamvi/core';
import { HOOK_NAME } from './constants.ts';
import {
    fetchErrorMessage,
    renderMessage,
    requestError,
    resolveOptions,
    responseError,
    transportKey,
} from './helpers.ts';
import type { OpenclawChannelOptions, OpenclawHookBody } from './types.ts';

/**
 * The OpenClaw channel, out only: `out` posts to OpenClaw's
 * `POST <hooksPath>/agent`, and OpenClaw runs an agent turn on the message
 * and delivers the answer to `deliver.channel`, to the address when it is
 * not empty, else to `deliver.to` (also the channel's `defaultAddress`, so a
 * tool may leave the address out). The `Idempotency-Key` (the message key)
 * and a deterministic message let OpenClaw replay a resend after a lost
 * response. Every failure throws a `openclaw_request` ChamviError (a
 * stalled gateway after `timeoutMs`), an aborted `opts.signal` its reason.
 * Throws InvalidAgentDefinitionError for an invalid option.
 */
export function openclawChannel(options: OpenclawChannelOptions): IChannel {
    const resolved = resolveOptions(options);
    const secrets = [resolved.hooksToken];

    const out = async (message: ChannelMessage, address: string, opts: ChannelSendOptions): Promise<void> => {
        opts.signal?.throwIfAborted();

        const controller = new AbortController();
        const timeout = requestError(`OpenClaw did not answer within ${resolved.timeoutMs}ms.`);
        const timer = resolved.clock.setTimeout(() => controller.abort(timeout), resolved.timeoutMs);
        const signal = opts.signal ? AbortSignal.any([opts.signal, controller.signal]) : controller.signal;
        const aborted = (): unknown => (opts.signal?.aborted ? opts.signal.reason : timeout);

        try {
            const body: OpenclawHookBody = {
                message: renderMessage(message, resolved),
                name: HOOK_NAME,
                ...(resolved.agentId === undefined ? {} : { agentId: resolved.agentId }),
                deliver: true,
                channel: resolved.deliver.channel,
                to: address || resolved.deliver.to,
                ...(resolved.deliver.accountId === undefined ? {} : { accountId: resolved.deliver.accountId }),
            };
            let response: Response;

            try {
                response = await resolved.fetch(resolved.url, {
                    method: 'POST',
                    headers: {
                        'authorization': `Bearer ${resolved.hooksToken}`,
                        'content-type': 'application/json',
                        'idempotency-key': transportKey(message.key),
                    },
                    body: JSON.stringify(body),
                    signal,
                });
            } catch (error) {
                if (signal.aborted) {
                    throw aborted();
                }

                throw requestError(`OpenClaw request failed: ${fetchErrorMessage(error, secrets)}`);
            }

            if (response.ok) {
                // admitted; the answer (`{ ok, runId }`) is not needed
                await response.body?.cancel().catch(() => undefined);

                return;
            }

            let text: string;

            try {
                text = await response.text();
            } catch (error) {
                if (signal.aborted) {
                    throw aborted();
                }

                text = Error.isError(error) ? error.message : String(error);
            }

            throw responseError(response.status, text, response.headers.get('retry-after'), secrets);
        } finally {
            timer.clear();
        }
    };

    return {
        name: resolved.name,
        defaultAddress: resolved.deliver.to,
        out,
    };
}
