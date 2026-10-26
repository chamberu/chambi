/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { isHttpResponseError } from 'hapic';
import type { WebToolsOptionsNormalized } from '../options/types.ts';
import { checkUrl, parseWebUrl } from '../url/module.ts';
import { messageOf, readCapped, requestError } from './asserts.ts';
import { WEB_MAX_REDIRECTS } from './constants.ts';
import type { WebResponse } from './types.ts';

/**
 * GETs `input` through the hapic client, checking the URL and every
 * redirect target (at most `WEB_MAX_REDIRECTS`) before the request, and
 * reads at most `maxBytes` of the body. A 4xx or 5xx status, a network
 * failure and the timeout are `web_request` tool errors.
 */
export async function getPage(input: string, options: WebToolsOptionsNormalized, signal: AbortSignal): Promise<WebResponse> {
    const timeout = new AbortController();
    const timer = options.clock.setTimeout(() => {
        timeout.abort(requestError(`The request did not finish within ${options.timeoutMs}ms.`));
    }, options.timeoutMs);
    const combined = AbortSignal.any([signal, timeout.signal]);
    try {
        let url = parseWebUrl(input);
        for (let hop = 0; ; hop++) {
            await checkUrl(url, options, combined);
            let response: Response & { data?: ReadableStream<Uint8Array> };
            try {
                response = await options.client.get(url.href, {
                    redirect: 'manual',
                    responseType: 'stream',
                    signal: combined,
                });
            } catch (error) {
                if (timeout.signal.aborted) throw timeout.signal.reason;
                if (signal.aborted) throw error;
                if (isHttpResponseError(error)) {
                    await error.response?.body?.cancel().catch(() => undefined);
                    throw requestError(`${url.href} answered ${error.status ?? error.response?.status}.`);
                }
                throw requestError(`Fetching ${url.href} failed: ${messageOf(error)}`);
            }
            const location = response.headers.get('location');
            if (response.status >= 300 && response.status < 400 && location) {
                await response.body?.cancel().catch(() => undefined);
                if (hop >= WEB_MAX_REDIRECTS) {
                    throw requestError(`${input} redirected more than ${WEB_MAX_REDIRECTS} times.`);
                }
                let target: URL;
                try {
                    target = new URL(location, url);
                } catch {
                    throw requestError(`${url.href} redirected to an invalid location.`);
                }
                url = parseWebUrl(target);
                continue;
            }
            const { bytes, truncated } = await readCapped(response.data ?? response.body, options.maxBytes);
            return {
                url,
                status: response.status,
                contentType: response.headers.get('content-type'),
                bytes,
                truncated,
            };
        }
    } catch (error) {
        if (timeout.signal.aborted && !signal.aborted) throw timeout.signal.reason;
        throw error;
    } finally {
        timer.clear();
    }
}
