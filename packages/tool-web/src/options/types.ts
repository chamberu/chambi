/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { IClock } from '@chamvi/core';
import type { IClient } from 'hapic';
import type { WebLookup, WebUrlPolicy } from '../url/types.ts';

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

/** The options checked, with their defaults. */
export type WebToolsOptionsNormalized = {
    client: IClient;
    lookup: WebLookup;
    allowUrl?: WebUrlPolicy;
    maxBytes: number;
    timeoutMs: number;
    clock: IClock;
};
