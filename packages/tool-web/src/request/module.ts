/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { ChamviError } from '@chamvi/core';
import {
    checkedAddress,
    discard,
    messageOf,
    parseWebUrl,
    readCapped,
    requestError,
} from './asserts.ts';
import { MAX_REDIRECTS, REDIRECT_STATUSES, USER_AGENT } from './constants.ts';
import type {
    Requester,
    RequesterOptions,
    WebResponse,
} from './types.ts';

/**
 * The one way the web tools reach the network: per hop the URL is checked
 * (http(s), no credentials, `allowUrl`, every resolved address public unless
 * allowed or trusted) and the transport connects to the checked address;
 * redirects are followed by hand (at most MAX_REDIRECTS, each hop checked
 * again), an error status fails, the body is read up to `maxBytes`, and the
 * whole request is bounded by `timeoutMs` on the clock.
 */
export function createRequester(options: RequesterOptions): Requester {
    return async (input, init) => {
        let url = parseWebUrl(input);
        const controller = new AbortController();
        const timeout = requestError(`No answer from ${url.origin} within ${options.timeoutMs}ms.`);
        const timer = options.clock.setTimeout(() => controller.abort(timeout), options.timeoutMs);
        const signal = AbortSignal.any([init.signal, controller.signal]);
        const headers = {
            'user-agent': USER_AGENT,
            accept: init.accept ?? '*/*',
        };

        try {
            for (let hop = 0; ; hop++) {
                const address = await checkedAddress({
                    url,
                    lookup: options.lookup,
                    allowUrl: options.allowUrl,
                    trusted: init.trusted ?? [],
                    signal,
                });
                const response = await options.transport(url, {
                    address, 
                    headers, 
                    signal, 
                });
                const location = response.headers.get('location');
                if (REDIRECT_STATUSES.has(response.status) && location) {
                    discard(response);
                    if (hop >= MAX_REDIRECTS) {
                        throw requestError(`${url.href} took more than ${MAX_REDIRECTS} redirects.`);
                    }
                    url = parseWebUrl(new URL(location, url));
                    continue;
                }
                if (response.status >= 400) {
                    discard(response);
                    throw requestError(`HTTP ${response.status} from ${url.href}`);
                }
                const body = await readCapped(response.body, init.maxBytes ?? options.maxBytes);
                return {
                    url: url.href,
                    status: response.status,
                    headers: response.headers,
                    ...body,
                } satisfies WebResponse;
            }
        } catch (error) {
            if (init.signal.aborted) throw init.signal.reason;
            if (controller.signal.aborted) throw timeout;
            if (error instanceof ChamviError) throw error;
            throw requestError(`Request to ${url.origin} failed: ${messageOf(error)}`);
        } finally {
            timer.clear();
        }
    };
}
