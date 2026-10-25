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
import { hostOf } from './asserts.ts';
import type { Transport, WebAddress } from './types.ts';

/** Statuses a web Response carries without a body. */
const NULL_BODY_STATUSES = new Set([101, 103, 204, 205, 304]);

/** A lookup that answers the checked address only, so DNS cannot swap it between check and connect. */
function pinnedLookup(address: WebAddress): LookupFunction {
    return ((_hostname: string, options: { all?: boolean }, callback: (...args: unknown[]) => void) => {
        if (options.all) {
            callback(null, [{ address: address.address, family: address.family }]);
            return;
        }
        callback(null, address.address, address.family);
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
    headers.delete('content-encoding');
    headers.delete('content-length');
    return stream;
}

/**
 * The default transport: one GET over `node:http`/`node:https` to the
 * checked address (TLS still verifies the host name), no redirect
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
        lookup: pinnedLookup(init.address),
        ...(url.protocol === 'https:' && isIP(host) === 0 ? { servername: host } : {}),
    };
    const send = url.protocol === 'https:' ? httpsRequest : httpRequest;
    const request = send(options, (message) => {
        const status = message.statusCode ?? 502;
        const headers = toHeaders(message);
        if (NULL_BODY_STATUSES.has(status)) {
            message.resume();
            resolve(new Response(null, { status, headers }));
            return;
        }
        const body = Readable.toWeb(decodedBody(message, headers)) as ReadableStream<Uint8Array>;
        resolve(new Response(body, { status, headers }));
    });
    request.on('error', reject);
    request.end();
});
