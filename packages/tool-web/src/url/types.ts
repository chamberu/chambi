/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

/** One address of a host name. */
export type WebAddress = {
    address: string;
    family: number;
};

/** Resolves a host name to its addresses (default `dns.lookup`, every address). */
export type WebLookup = (hostname: string, signal: AbortSignal) => Promise<WebAddress[]>;

/** true allows a URL (also on a non-public address), false refuses it, undefined applies the address check. */
export type WebUrlPolicy = (url: URL) => boolean | undefined;
