/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { IClock } from '@chamvi/core';

// #region public
/** One address a host name resolves to. */
export type WebAddress = {
    address: string;
    family: 4 | 6;
};

/** Resolves a host name to every address it has (the default: `dns.lookup` with `all: true`). */
export type WebLookup = (hostname: string, signal: AbortSignal) => Promise<WebAddress[]>;

/** Decides a URL before the address check: true allows it (also on a non-public address), false refuses it, undefined applies the address check. */
export type WebUrlPolicy = (url: URL) => boolean | undefined;
// #endregion public

/** What a transport gets for one hop: the checked addresses, the only ones it may connect to (in order). */
export type TransportInit = {
    addresses: WebAddress[];
    headers: Record<string, string>;
    signal: AbortSignal;
};

/** Sends one GET without following redirects. */
export type Transport = (url: URL, init: TransportInit) => Promise<Response>;

export type RequesterOptions = {
    transport: Transport;
    lookup: WebLookup;
    allowUrl?: WebUrlPolicy;
    maxBytes: number;
    timeoutMs: number;
    clock: IClock;
};

export type RequestOptions = {
    signal: AbortSignal;
    /** The `accept` header (default any). */
    accept?: string;
    /** Origins whose addresses are not checked (the operator's registries). */
    trusted?: readonly string[];
    /** Error statuses returned like a success instead of failing (e.g. a registry's 404). */
    acceptStatus?: readonly number[];
    /** Overrides the requester's maxBytes for this request. */
    maxBytes?: number;
};

export type WebResponse = {
    /** The URL after redirects. */
    url: string;
    status: number;
    headers: Headers;
    bytes: Uint8Array;
    /** True when the body was longer than maxBytes. */
    truncated: boolean;
};

export type Requester = (url: string | URL, options: RequestOptions) => Promise<WebResponse>;
