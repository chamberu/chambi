/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { isIP } from 'node:net';
import { ValidationError } from '@chamvi/core';
import { isBlockedAddress } from '../address/module.ts';
import type { ResolvedWebOptions } from '../options/types.ts';
import { messageOf, requestError } from '../request/asserts.ts';

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

/**
 * Refuses `url` when `allowUrl` says so, or (unless it allows the URL) when
 * its host is or resolves to an address that is not public (loopback,
 * private, link-local, metadata, ...). The request resolves the name again,
 * so a host answering differently the second time (DNS rebinding) is not
 * covered; `allowUrl` and a network policy are the operator's tools for that.
 */
export async function checkUrl(url: URL, options: ResolvedWebOptions, signal: AbortSignal): Promise<void> {
    const decision = options.allowUrl?.(url);
    if (decision === false) {
        throw new ValidationError(`${url.href} is not allowed.`);
    }
    if (decision === true) return;
    const host = url.hostname.startsWith('[') ? url.hostname.slice(1, -1) : url.hostname;
    let addresses: string[];
    if (isIP(host) !== 0) {
        addresses = [host];
    } else {
        try {
            addresses = (await options.lookup(host, signal)).map((entry) => entry.address);
        } catch (error) {
            if (signal.aborted) throw error;
            throw requestError(`${host} could not be resolved: ${messageOf(error)}`);
        }
        if (addresses.length === 0) throw requestError(`${host} has no address.`);
    }
    if (addresses.some((address) => isBlockedAddress(address))) {
        throw new ValidationError(`${host} is no public address; web_fetch reaches public addresses only.`);
    }
}
