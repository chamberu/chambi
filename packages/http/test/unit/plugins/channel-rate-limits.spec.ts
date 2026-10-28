/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import {
    afterEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import { InvalidAgentDefinitionError } from '@chamvi/core';
import type { IChannel } from '@chamvi/core';
import type { ChannelRateLimitOptions, HttpAppOptions } from '@chamvi/http';
import type { App } from 'routup';
import { ADMIN_TOKEN, createTestApp } from '../../utils/app.ts';

type SendOptions = {
    method?: string;
    ip?: string;
    headers?: Record<string, string>;
};

function send(app: App, path: string, options: SendOptions = {}): Promise<Response> {
    const request = new Request(`http://test${path}`, {
        method: options.method ?? 'POST',
        headers: { authorization: `Bearer ${ADMIN_TOKEN}`, ...options.headers },
    });
    (request as Request & { ip?: string }).ip = options.ip ?? '10.0.0.1';
    return app.fetch(request);
}

function createApp(options: Partial<Omit<HttpAppOptions, 'agents'>> = {}) {
    const channels: IChannel[] = ['github', 'events'].map((name) => ({
        name,
        in: async () => new Response(null, { status: 202 }),
    }));
    return createTestApp({
        engineChannels: channels,
        channels,
        rateLimit: { max: 1 },
        ...options,
    }).app;
}

afterEach(() => vi.useRealTimers());

describe('channel rate limits', () => {
    it('disables a channel limit without consuming or disabling the REST bucket', async () => {
        const app = createApp({ channelRateLimits: { github: false } });
        for (let i = 0; i < 3; i++) expect((await send(app, '/channels/github')).status).toBe(202);
        expect((await send(app, '/agents', { method: 'GET' })).status).toBe(200);
        expect((await send(app, '/agents', { method: 'GET' })).status).toBe(429);
        expect((await send(app, '/channels/github')).status).toBe(202);
    });

    it('replaces the general bucket with an independent channel bucket and JSON error', async () => {
        const app = createApp({ channelRateLimits: { github: { max: 2 } } });
        expect((await send(app, '/agents', { method: 'GET' })).status).toBe(200);
        expect((await send(app, '/channels/github')).status).toBe(202);
        expect((await send(app, '/channels/github')).status).toBe(202);
        const response = await send(app, '/channels/github');
        expect(response.status).toBe(429);
        expect(response.headers.get('retry-after')).toBe('60');
        expect(response.headers.get('ratelimit-limit')).toBe('2');
        expect(response.headers.get('ratelimit-remaining')).toBe('0');
        expect(await response.json()).toMatchObject({ status: 429, code: 'too_many_requests' });
        expect((await send(app, '/agents', { method: 'GET' })).status).toBe(429);
    });

    it('gives two configured channels separate buckets', async () => {
        const app = createApp({ channelRateLimits: { github: { max: 1 }, events: { max: 1 } } });
        expect((await send(app, '/channels/github')).status).toBe(202);
        expect((await send(app, '/channels/events')).status).toBe(202);
        expect((await send(app, '/channels/github')).status).toBe(429);
        expect((await send(app, '/channels/events')).status).toBe(429);
    });

    it('enforces an explicit channel policy with the general limiter disabled', async () => {
        const app = createApp({ rateLimit: false, channelRateLimits: { github: { max: 1 } } });
        expect((await send(app, '/channels/github')).status).toBe(202);
        expect((await send(app, '/channels/github')).status).toBe(429);
        for (let i = 0; i < 3; i++) expect((await send(app, '/agents', { method: 'GET' })).status).toBe(200);
    });

    it('keeps the shared general bucket for omitted channel policies', async () => {
        const app = createApp();
        expect((await send(app, '/channels/github')).status).toBe(202);
        expect((await send(app, '/agents', { method: 'GET' })).status).toBe(429);
        expect((await send(app, '/channels/events')).status).toBe(429);
    });

    it('inherits the general bucket for an unconfigured mounted sibling', async () => {
        const app = createApp({ channelRateLimits: { github: false } });
        expect((await send(app, '/channels/events')).status).toBe(202);
        expect((await send(app, '/agents', { method: 'GET' })).status).toBe(429);
        expect((await send(app, '/channels/github')).status).toBe(202);
    });

    it('matches case, trailing slash and nested paths under a normalized basePath', async () => {
        const app = createApp({ basePath: '/api/', channelRateLimits: { github: { max: 2 } } });
        expect((await send(app, '/API/CHANNELS/GITHUB/')).status).toBe(202);
        expect((await send(app, '/api/channels/github/a/b')).status).toBe(202);
        expect((await send(app, '/api/channels/github')).status).toBe(429);
        expect((await send(app, '/api/agents', { method: 'GET' })).status).toBe(200);
    });

    it.each(['/channels/github-extra', '/channels/unknown', '/channels/githubx/nested'])(
        'does not exempt an unknown channel path %s',
        async (path) => {
            const app = createApp({ channelRateLimits: { github: false } });
            expect((await send(app, path)).status).toBe(404);
            expect((await send(app, path)).status).toBe(429);
            expect((await send(app, '/channels/github')).status).toBe(202);
        },
    );

    it('does not give GET the POST exemption', async () => {
        const app = createApp({ channelRateLimits: { github: false } });
        expect((await send(app, '/channels/github', { method: 'GET' })).status).toBe(404);
        expect((await send(app, '/channels/github', { method: 'GET' })).status).toBe(429);
        expect((await send(app, '/channels/github')).status).toBe(202);
    });

    it('separates trusted client IPs and refuses forwarded spoofing from untrusted peers', async () => {
        const app = createApp({
            trustProxy: ['10.0.0.1/32'],
            channelRateLimits: { github: { max: 1 } },
        });
        const first = { headers: { 'x-forwarded-for': '203.0.113.1' } };
        const second = { headers: { 'x-forwarded-for': '203.0.113.2' } };
        expect((await send(app, '/channels/github', first)).status).toBe(202);
        expect((await send(app, '/channels/github', second)).status).toBe(202);
        expect((await send(app, '/channels/github', first)).status).toBe(429);
        expect((await send(app, '/channels/github', { ...first, ip: '10.0.0.2' })).status).toBe(202);
        expect((await send(app, '/channels/github', { ...second, ip: '10.0.0.2' })).status).toBe(429);
    });

    it('does not trust forwarded headers by default', async () => {
        const app = createApp({ channelRateLimits: { github: { max: 1 } } });
        expect((await send(app, '/channels/github', { headers: { 'x-forwarded-for': '203.0.113.1' } })).status).toBe(202);
        expect((await send(app, '/channels/github', { headers: { 'x-forwarded-for': '203.0.113.2' } })).status).toBe(429);
    });

    it('resets the independent bucket at its configured window', async () => {
        vi.useFakeTimers();
        const app = createApp({ channelRateLimits: { github: { max: 1, windowMs: 2_000 } } });
        expect((await send(app, '/channels/github')).status).toBe(202);
        expect((await send(app, '/channels/github')).headers.get('retry-after')).toBe('2');
        await vi.advanceTimersByTimeAsync(1_999);
        expect((await send(app, '/channels/github')).status).toBe(429);
        await vi.advanceTimersByTimeAsync(1);
        expect((await send(app, '/channels/github')).status).toBe(202);
    });

    it('preserves CORS and rate-limit headers on a refused channel request', async () => {
        const app = createApp({
            cors: { origin: 'https://dashboard.test' },
            channelRateLimits: { github: { max: 1 } },
        });
        const options = { headers: { origin: 'https://dashboard.test' } };
        await send(app, '/channels/github', options);
        const response = await send(app, '/channels/github', options);
        expect(response.status).toBe(429);
        expect(response.headers.get('access-control-allow-origin')).toBe('https://dashboard.test');
        expect(response.headers.get('ratelimit-limit')).toBe('1');
        expect(response.headers.get('retry-after')).toBe('60');
    });

    it('preserves operational and extra-route skips alongside channel policies', async () => {
        const app = createApp({
            channelRateLimits: { github: { max: 1 } },
            routes: [{
                method: 'GET',
                path: '/free',
                rateLimit: false,
                handler: async () => ({ status: 200 }),
            }],
        });
        for (let i = 0; i < 3; i++) {
            expect((await send(app, '/healthz', { method: 'GET' })).status).toBe(200);
            expect((await send(app, '/free', { method: 'GET' })).status).toBe(200);
        }
        expect((await send(app, '/channels/github')).status).toBe(202);
        expect((await send(app, '/channels/github')).status).toBe(429);
        expect((await send(app, '/agents', { method: 'GET' })).status).toBe(200);
    });

    it('does not let a custom general skip replace channel-policy selection', async () => {
        const app = createApp({ rateLimit: { max: 1, skip: () => false }, channelRateLimits: { github: false } });
        for (let i = 0; i < 3; i++) expect((await send(app, '/channels/github')).status).toBe(202);
        expect((await send(app, '/agents', { method: 'GET' })).status).toBe(200);
        expect((await send(app, '/agents', { method: 'GET' })).status).toBe(429);
    });

    it('does not mutate frozen channel policies or general limiter options', async () => {
        const policy: ChannelRateLimitOptions = Object.freeze({ max: 1 });
        const channelRateLimits = Object.freeze({ github: policy });
        const rateLimit = Object.freeze({ max: 2 });
        const app = createApp({ channelRateLimits, rateLimit });
        expect((await send(app, '/channels/github')).status).toBe(202);
        expect((await send(app, '/channels/github')).status).toBe(429);
        expect(policy).toEqual({ max: 1 });
        expect(rateLimit).toEqual({ max: 2 });
    });
});

describe('channel rate-limit configuration', () => {
    it.each([
        ['unmounted', { missing: false }],
        ['registered but not mounted', { http: false }],
        ['miscased', { GitHub: false }],
        ['null map', null],
        ['array map', []],
        ['boolean map', false],
        ['null policy', { github: null }],
        ['boolean policy', { github: true }],
        ['array policy', { github: [] }],
        ['missing max', { github: {} }],
        ['zero max', { github: { max: 0 } }],
        ['negative max', { github: { max: -1 } }],
        ['fractional max', { github: { max: 1.5 } }],
        ['infinite max', { github: { max: Infinity } }],
        ['NaN max', { github: { max: NaN } }],
        ['unsafe max', { github: { max: Number.MAX_SAFE_INTEGER + 1 } }],
        ['string max', { github: { max: '1' } }],
        ['null window', { github: { max: 1, windowMs: null } }],
        ['zero window', { github: { max: 1, windowMs: 0 } }],
        ['negative window', { github: { max: 1, windowMs: -1 } }],
        ['fractional window', { github: { max: 1, windowMs: 1.5 } }],
        ['infinite window', { github: { max: 1, windowMs: Infinity } }],
        ['overflow window', { github: { max: 1, windowMs: 2 ** 31 } }],
    ])('rejects %s before serving', (_label, policies) => {
        expect(() => createApp({ channelRateLimits: policies as HttpAppOptions['channelRateLimits'] }))
            .toThrow(InvalidAgentDefinitionError);
    });

    it('accepts positive boundary values', () => {
        const channelRateLimits = { github: { max: Number.MAX_SAFE_INTEGER, windowMs: 2 ** 31 - 1 }, events: false as const };
        expect(() => createApp({ channelRateLimits })).not.toThrow();
    });
});
