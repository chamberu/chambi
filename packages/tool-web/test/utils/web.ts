/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { FetchTransport, createClient } from 'hapic';
import type { IClient } from 'hapic';
import type { WebAddress, WebLookup } from '@chamvi/tool-web';

export type FakeRoute = (url: URL, signal: AbortSignal) => Response | Promise<Response>;

export type FakeWeb = {
    /** A hapic client over the routes (no proxy). */
    client: IClient;
    lookup: WebLookup;
    /** The URLs requested, in order. */
    calls: string[];
    lookups: string[];
    /** Answers per URL (exact `href`); any other URL answers 404. */
    routes: Map<string, FakeRoute>;
    /** Addresses per host name; a missing host gets `PUBLIC`. */
    dns: Map<string, WebAddress[]>;
};

/** One public address for every host unless `dns` says otherwise. */
export const PUBLIC: WebAddress = { address: '93.184.215.14', family: 4 };

export function createFakeWeb(): FakeWeb {
    const routes = new Map<string, FakeRoute>();
    const dns = new Map<string, WebAddress[]>();
    const calls: string[] = [];
    const lookups: string[] = [];
    const fetch = async (input: string, init?: RequestInit): Promise<Response> => {
        const url = new URL(input);
        calls.push(url.href);
        const signal = init?.signal ?? new AbortController().signal;
        signal.throwIfAborted();
        const route = routes.get(url.href);
        if (!route) return new Response('not found', { status: 404 });
        return route(url, signal);
    };
    return {
        client: createClient({ transport: new FetchTransport({ fetch }), proxy: false }),
        lookup: async (hostname) => {
            lookups.push(hostname);
            return dns.get(hostname) ?? [PUBLIC];
        },
        calls,
        lookups,
        routes,
        dns,
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
