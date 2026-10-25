/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { request as httpRequest } from 'node:http';
import type { IncomingMessage, RequestOptions } from 'node:http';
import { request as httpsRequest } from 'node:https';
import type { LookupFunction } from 'node:net';
import { isIP } from 'node:net';
import { Readable } from 'node:stream';
import { createBrotliDecompress, createGunzip, createInflate } from 'node:zlib';
import { hostOf, requestError } from './asserts.ts';
import type { Transport, WebAddress } from './types.ts';

/** Statuses a web Response carries without a body (101 and 103 never reach the response callback). */
const NULL_BODY_STATUSES = new Set([204, 205, 304]);

/**
 * A lookup that answers the checked addresses only, so DNS cannot swap them
 * between check and connect; with `all` (Node's address family selection)
 * every one is tried in order.
 */
function pinnedLookup(addresses: WebAddress[]): LookupFunction {
    return ((_hostname: string, options: { all?: boolean }, callback: (...args: unknown[]) => void) => {
        if (options.all) {
            callback(null, addresses.map(({ address, family }) => ({ address, family })));
            return;
        }
        callback(null, addresses[0]!.address, addresses[0]!.family);
    }) as LookupFunction;
}

function toHeaders(message: IncomingMessage): Headers {
    const headers = new Headers();
    for (const [name, value] of Object.entries(message.headers)) {
        if (value === undefined) continue;
        for (const item of Array.isArray(value) ? value : [value]) headers.append(name, item);
    }
    return headers;
}

/** The body, decompressed per `content-encoding` (gzip, deflate, br). */
function decodedBody(message: IncomingMessage, headers: Headers): Readable {
    const encoding = headers.get('content-encoding')?.trim().toLowerCase();
    let stream: NodeJS.ReadableStream & Readable;
    switch (encoding) {
        case 'gzip':
        case 'x-gzip':
            stream = message.pipe(createGunzip());
            break;
        case 'deflate':
            stream = message.pipe(createInflate());
            break;
        case 'br':
            stream = message.pipe(createBrotliDecompress());
            break;
        default:
            return message;
    }
    message.on('error', (error) => stream.destroy(error));
    // A cancel or error on the decoder only unpipes the message: destroy it,
    // so its socket does not stay open with the unread rest.
    stream.once('close', () => message.destroy());
    headers.delete('content-encoding');
    headers.delete('content-length');
    return stream;
}

/**
 * The default transport: one GET over `node:http`/`node:https` to the
 * checked addresses (TLS still verifies the host name), no redirect
 * followed, the body decompressed.
 */
export const pinnedTransport: Transport = (url, init) => new Promise<Response>((resolve, reject) => {
    const host = hostOf(url);
    const options: RequestOptions = {
        method: 'GET',
        host,
        port: url.port || undefined,
        path: `${url.pathname}${url.search}`,
        headers: { ...init.headers, 'accept-encoding': 'gzip, deflate, br' },
        signal: init.signal,
        lookup: pinnedLookup(init.addresses),
        ...(url.protocol === 'https:' && isIP(host) === 0 ? { servername: host } : {}),
    };
    const send = url.protocol === 'https:' ? httpsRequest : httpRequest;
    const request = send(options, (message) => {
        // A throw here would escape as an uncaughtException and leave the promise open.
        try {
            const status = message.statusCode ?? 502;
            if (status < 200 || status > 599) {
                // llhttp accepts any three-digit status; a web Response only 200 to 599.
                message.destroy();
                reject(requestError(`HTTP ${status} from ${url.href}`));
                return;
            }
            const headers = toHeaders(message);
            if (NULL_BODY_STATUSES.has(status)) {
                message.resume();
                resolve(new Response(null, { status, headers }));
                return;
            }
            const body = Readable.toWeb(decodedBody(message, headers)) as ReadableStream<Uint8Array>;
            resolve(new Response(body, { status, headers }));
        } catch (error) {
            message.destroy();
            reject(error);
        }
    });
    request.on('error', reject);
    request.end();
});

/** A transport over a `fetch` (webTools({ fetch })): redirects by hand; it connects on its own, so it must pin addresses itself. */
export function fetchTransport(fetch: typeof globalThis.fetch): Transport {
    return (url, init) => fetch(url, {
        method: 'GET',
        headers: init.headers,
        redirect: 'manual',
        signal: init.signal,
    });
}
