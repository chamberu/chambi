/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { Transport, WebAddress, WebLookup } from '../../src/request/types.ts';

export type FakeCall = {
    url: string;
    address: WebAddress;
    headers: Record<string, string>;
};

export type FakeRoute = (url: URL, signal: AbortSignal) => Response | Promise<Response>;

export type FakeWeb = {
    transport: Transport;
    lookup: WebLookup;
    /** A `fetch` over the same routes, for webTools({ fetch }). */
    fetch: typeof globalThis.fetch;
    calls: FakeCall[];
    lookups: string[];
    /** Answers for a URL (exact `href`). */
    routes: Map<string, FakeRoute>;
    /** Addresses per host name; a missing host has none. */
    dns: Map<string, WebAddress[]>;
};

/** One public address for every host unless `dns` says otherwise. */
export const PUBLIC: WebAddress = { address: '93.184.215.14', family: 4 };

export function createFakeWeb(): FakeWeb {
    const routes = new Map<string, FakeRoute>();
    const dns = new Map<string, WebAddress[]>();
    const calls: FakeCall[] = [];
    const lookups: string[] = [];

    const answer = async (url: URL, signal: AbortSignal): Promise<Response> => {
        const route = routes.get(url.href);
        if (!route) return new Response('not found', { status: 404 });
        return route(url, signal);
    };

    return {
        calls,
        lookups,
        routes,
        dns,
        lookup: async (hostname) => {
            lookups.push(hostname);
            return dns.get(hostname) ?? [PUBLIC];
        },
        transport: async (url, init) => {
            calls.push({
                url: url.href, 
                address: init.address, 
                headers: init.headers, 
            });
            return answer(url, init.signal);
        },
        fetch: (async (input: string | URL | Request, init?: RequestInit) => {
            const url = new URL(input instanceof Request ? input.url : input);
            calls.push({
                url: url.href, 
                address: { address: '', family: 4 }, 
                headers: Object.fromEntries(new Headers(init?.headers)), 
            });
            return answer(url, init?.signal ?? new AbortController().signal);
        }) as typeof globalThis.fetch,
    };
}

/** A response that never answers until `signal` aborts. */
export function hang(_url: URL, signal: AbortSignal): Promise<Response> {
    return new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
    });
}

export function redirect(location: string, status = 302): FakeRoute {
    return () => new Response(null, { status, headers: { location } });
}

export function html(body: string, contentType = 'text/html; charset=utf-8'): FakeRoute {
    return () => new Response(body, { status: 200, headers: { 'content-type': contentType } });
}

export function json(body: unknown, status = 200): FakeRoute {
    return () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

export function text(body: string, status = 200): FakeRoute {
    return () => new Response(body, { status, headers: { 'content-type': 'text/plain; charset=utf-8' } });
}
