/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { IClock } from '@chamvi/core';
import type { WebLookup, WebUrlPolicy } from '../request/types.ts';

export type WebToolsOptions = {
    /** Replaces the default transport (node:http(s) pinned to the checked address); it must pin addresses itself to keep DNS rebinding out. */
    fetch?: typeof globalThis.fetch;
    /** Resolves host names (default `dns.lookup`, every address). */
    lookup?: WebLookup;
    /** true allows a URL (also on a non-public address), false refuses it, undefined applies the address check. */
    allowUrl?: WebUrlPolicy;
    /** Bytes `web_fetch` reads of a response (default WEB_FETCH_MAX_BYTES, 5 MiB). */
    maxBytes?: number;
    /** Timeout of one request, redirects and body included (default WEB_TIMEOUT_MS, 30 s). */
    timeoutMs?: number;
    /** Timers (default systemClock). */
    clock?: IClock;
};

export type WebFetchFormat = 'markdown' | 'text' | 'raw';

/** `web_fetch`. */
export type WebFetchResult = {
    /** The URL after redirects. */
    url: string;
    status: number;
    contentType: string | null;
    format: WebFetchFormat;
    /** The HTML page's title (markdown and text). */
    title?: string;
    /** At most WEB_FETCH_MAX_CHARS characters from `offset`. */
    content: string;
    offset: number;
    /** Characters of the whole converted document. */
    totalChars: number;
    /** The offset of the next page, when more follows. */
    nextOffset?: number;
    /** True when the response was longer than `maxBytes` and only its start was read. */
    truncated: boolean;
};
