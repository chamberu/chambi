/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { IClock } from '@chamvi/core';
import type { IClient } from 'hapic';

/** One address of a host name. */
export type WebAddress = {
    address: string;
    family: number;
};

/** Resolves a host name to its addresses (default `dns.lookup`, every address). */
export type WebLookup = (hostname: string, signal: AbortSignal) => Promise<WebAddress[]>;

/** true allows a URL (also on a non-public address), false refuses it, undefined applies the address check. */
export type WebUrlPolicy = (url: URL) => boolean | undefined;

export type WebToolsOptions = {
    /**
     * The hapic client the requests go through. Default: a fresh one, whose
     * transport honours `HTTP_PROXY`, `HTTPS_PROXY` and `NO_PROXY`.
     */
    client?: IClient;
    /** Resolves host names for the address check (default `dns.lookup`). */
    lookup?: WebLookup;
    /** Overrides the address check per URL. */
    allowUrl?: WebUrlPolicy;
    /** Bytes `web_fetch` reads of a response (default `WEB_FETCH_MAX_BYTES`, 5 MiB). */
    maxBytes?: number;
    /** Milliseconds one fetch may take, redirects included (default `WEB_TIMEOUT_MS`, 30 s). */
    timeoutMs?: number;
    clock?: IClock;
};

export type WebFetchFormat = 'markdown' | 'text' | 'raw';

export type WebFetchResult = {
    /** The URL after redirects. */
    url: string;
    status: number;
    contentType: string | null;
    format: WebFetchFormat;
    title?: string;
    /** At most `WEB_FETCH_MAX_CHARS` characters from `offset`. */
    content: string;
    offset: number;
    /** Characters of the whole (converted) document. */
    totalChars: number;
    /** The offset of the next page, when the content goes on. */
    nextOffset?: number;
    /** The body was longer than `maxBytes` and was cut. */
    truncated: boolean;
};
