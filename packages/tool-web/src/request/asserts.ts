/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { lookup as dnsLookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { ChamviError, ValidationError } from '@chamvi/core';
import { isBlockedAddress } from '../address/module.ts';
import { WEB_REQUEST_ERROR_CODE } from './constants.ts';
import type { WebAddress, WebLookup, WebUrlPolicy } from './types.ts';

/** A failed request as a tool error (code `web_request`). */
export function requestError(message: string): ChamviError {
    return new ChamviError({ message, code: WEB_REQUEST_ERROR_CODE });
}

/** An absolute http(s) URL without credentials, else a ValidationError. */
export function parseWebUrl(input: string | URL): URL {
    let url: URL;
    try {
        url = new URL(input);
    } catch {
        throw new ValidationError('url must be an absolute http or https URL.');
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        throw new ValidationError(`Only http and https URLs can be fetched, not ${url.protocol}.`);
    }
    if (url.username || url.password) {
        throw new ValidationError('A URL with credentials cannot be fetched.');
    }
    return url;
}

/** The host name without IPv6 brackets. */
export function hostOf(url: URL): string {
    const { hostname } = url;
    return hostname.startsWith('[') ? hostname.slice(1, -1) : hostname;
}

/** `dns.lookup` with every address; the signal ends the wait, not the lookup. */
export const systemLookup: WebLookup = async (hostname, signal) => {
    signal.throwIfAborted();
    const answers = await new Promise<Array<{ address: string; family: number }>>((resolve, reject) => {
        const onAbort = () => reject(signal.reason);
        signal.addEventListener('abort', onAbort, { once: true });
        dnsLookup(hostname, { all: true, verbatim: true })
            .then(resolve, reject)
            .finally(() => signal.removeEventListener('abort', onAbort));
    });
    return answers.map((answer) => ({ address: answer.address, family: answer.family === 6 ? 6 : 4 }));
};

export type CheckInput = {
    url: URL;
    lookup: WebLookup;
    allowUrl?: WebUrlPolicy;
    trusted: readonly string[];
    signal: AbortSignal;
};

/**
 * The addresses to connect to for `url`: an IP literal as is, else every
 * address the host resolves to, the URL refused when one is not public
 * (unless `allowUrl` allows the URL or its origin is trusted).
 */
export async function checkedAddresses(input: CheckInput): Promise<WebAddress[]> {
    const { url } = input;
    const decision = input.trusted.includes(url.origin) ? true : input.allowUrl?.(url);
    if (decision === false) {
        throw new ValidationError(`${url.href} is not allowed.`);
    }
    const host = hostOf(url);
    const family = isIP(host);
    let addresses: WebAddress[];
    if (family !== 0) {
        addresses = [{ address: host, family: family === 6 ? 6 : 4 }];
    } else {
        try {
            addresses = await input.lookup(host, input.signal);
        } catch (error) {
            if (input.signal.aborted) throw error;
            throw requestError(`${host} could not be resolved: ${messageOf(error)}`);
        }
    }
    if (addresses.length === 0) {
        throw requestError(`${host} has no address.`);
    }
    if (decision !== true) {
        for (const { address } of addresses) {
            if (isBlockedAddress(address)) {
                throw new ValidationError(`${host} resolves to the non-public address ${address}; the web tools reach public addresses only.`);
            }
        }
    }
    return addresses;
}

/** An error's message (its `code` for a bare system error). */
export function messageOf(error: unknown): string {
    if (error instanceof Error) {
        return error.message || String((error as { code?: unknown }).code ?? error.name);
    }
    return String(error);
}

/** Reads `body` up to `max` bytes; `truncated` when more followed. */
export async function readCapped(body: ReadableStream<Uint8Array> | null, max: number): Promise<{ bytes: Uint8Array; truncated: boolean }> {
    if (!body) return { bytes: new Uint8Array(0), truncated: false };
    const reader = body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    let truncated = false;
    try {
        for (;;) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
            total += value.byteLength;
            if (total > max) {
                truncated = true;
                break;
            }
        }
    } finally {
        if (truncated) reader.cancel().catch(() => undefined);
        reader.releaseLock();
    }
    const bytes = new Uint8Array(Math.min(total, max));
    let offset = 0;
    for (const chunk of chunks) {
        const part = chunk.subarray(0, bytes.length - offset);
        bytes.set(part, offset);
        offset += part.length;
        if (offset >= bytes.length) break;
    }
    return { bytes, truncated };
}

/** Drops a response body we do not read. */
export function discard(response: Response): void {
    response.body?.cancel().catch(() => undefined);
}
