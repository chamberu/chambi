/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { describe, expect, it } from 'vitest';
import type { HttpRoute } from '@chamvi/http';
import type { App, IAppEvent } from 'routup';
import { isOperationalPath, isStreamRequest, routeLabel } from '../../../src/plugins/helpers.ts';
import {
    ADMIN_TOKEN,
    call,
    createRunTestApp,
    createTestApp,
} from '../../utils/app.ts';

type RequestOptions = {
    method?: string;
    ip?: string;
    token?: string;
    headers?: Record<string, string>;
};

/** A request with a socket address (routup reads `request.ip`). */
function send(app: App, path: string, options: RequestOptions = {}): Promise<Response> {
    const headers = new Headers(options.headers);

    if (options.token) {
        headers.set('authorization', `Bearer ${options.token}`);
    }

    const request = new Request(`http://test${path}`, { method: options.method ?? 'GET', headers });

    (request as Request & { ip?: string }).ip = options.ip ?? '10.0.0.1';

    return app.fetch(request);
}

describe('metrics', () => {
    it('serves /metrics by default, one registry per app', async () => {
        const first = createTestApp({ metrics: undefined });
        const second = createTestApp({ metrics: undefined });

        for (const { app } of [first, second]) {
            await send(app, '/healthz');

            const response = await send(app, '/metrics');

            expect(response.status).toBe(200);
            expect(response.headers.get('content-type')).toContain('text/plain');
            expect(await response.text()).toContain('http_request_duration');
        }
    });

    it('is off with metrics: false', async () => {
        const { app } = createTestApp({ metrics: false });

        expect((await send(app, '/metrics')).status).toBe(404);
    });

    it('does not time sse streams', async () => {
        const { app, engine } = createRunTestApp({ metrics: undefined });
        const started = await call(app, 'POST', '/agents/echo/runs', { token: ADMIN_TOKEN });
        const { runId } = await started.json() as { runId: string };

        await engine.start();
        await engine.idle();

        const stream = await send(app, `/runs/${runId}/stream`, { token: ADMIN_TOKEN });

        await stream.text();
        await send(app, '/agents', { token: ADMIN_TOKEN });

        const metrics = await (await send(app, '/metrics')).text();
        const samples = metrics.split('\n').filter((line) => line.startsWith('http_request_duration'));

        expect(samples.some((line) => line.includes('/agents'))).toBe(true);
        expect(samples.some((line) => line.includes('/stream'))).toBe(false);
        await engine.drain();
    });

    function pathLabels(metrics: string): Set<string> {
        const labels = new Set<string>();

        for (const match of metrics.matchAll(/path="([^"]*)"/g)) {
            labels.add(match[1]!);
        }

        return labels;
    }

    it('labels requests by route template, not by raw path', async () => {
        const { app } = createRunTestApp({ metrics: undefined, basePath: '/api' });

        for (let i = 0; i < 5; i++) {
            await send(app, `/api/runs/${crypto.randomUUID()}`, { token: ADMIN_TOKEN });
            await send(app, `/api/runs/${crypto.randomUUID()}/cancel`, { method: 'POST' });
            await send(app, `/api/runs/${crypto.randomUUID()}/approve`, { method: 'POST' });
            await send(app, `/api/nope/${crypto.randomUUID()}`);
            await send(app, `/api/agents/echo/state/kv/k${i}`, { token: ADMIN_TOKEN });
            await send(app, '/api/agents/echo/state/kv', { token: ADMIN_TOKEN });
            await send(app, '/api/me', { token: ADMIN_TOKEN });
            await send(app, `/api/channels/webhook/hooked/x${i}/y`, { method: 'POST' });
            await send(app, `/api/hooks/hooked/x${i}/y`, { method: 'POST' });
            await send(app, `/api/runs/${crypto.randomUUID()}/artifacts`, { token: ADMIN_TOKEN });
            await send(app, `/api/runs/${crypto.randomUUID()}/artifacts/${crypto.randomUUID()}`, { token: ADMIN_TOKEN });
        }

        const labels = pathLabels(await (await send(app, '/api/metrics')).text());

        expect([...labels].sort()).toEqual([
            '/_unmatched',
            '/agents/:name/state/kv',
            '/agents/:name/state/kv/:key',
            '/channels/:name/*',
            '/me',
            '/runs/:id',
            '/runs/:id/approve',
            '/runs/:id/artifacts',
            '/runs/:id/artifacts/:artifactId',
            '/runs/:id/cancel',
        ]);
    });

    it('does not time rate-limited requests', async () => {
        const { app } = createTestApp({ metrics: undefined, rateLimit: { max: 1 } });

        await send(app, '/agents');
        expect((await send(app, '/agents')).status).toBe(429);

        const metrics = await (await send(app, '/metrics')).text();

        expect(metrics).not.toContain('status_code="429"');
    });
});

describe('cors', () => {
    it('answers a preflight when configured', async () => {
        const { app } = createTestApp({ cors: { origin: 'https://ui.test' } });
        const response = await send(app, '/runs', {
            method: 'OPTIONS',
            headers: { origin: 'https://ui.test', 'access-control-request-method': 'GET' },
        });

        expect(response.status).toBe(204);
        expect(response.headers.get('access-control-allow-origin')).toBe('https://ui.test');
    });

    it('is off by default', async () => {
        const { app } = createTestApp();
        const response = await send(app, '/agents', { token: ADMIN_TOKEN, headers: { origin: 'https://ui.test' } });

        expect(response.headers.get('access-control-allow-origin')).toBeNull();
    });

    it('keeps the cors headers on error responses', async () => {
        const { app } = createTestApp({ cors: { origin: 'https://ui.test' } });
        const headers = { origin: 'https://ui.test' };
        const notFound = await send(app, '/runs/nope', { token: ADMIN_TOKEN, headers });

        expect(notFound.status).toBe(404);
        expect(notFound.headers.get('access-control-allow-origin')).toBe('https://ui.test');
        expect(notFound.headers.get('content-type')).toBe('application/json; charset=utf-8');

        const unauthorized = await send(app, '/agents', { headers });

        expect(unauthorized.status).toBe(401);
        expect(unauthorized.headers.get('access-control-allow-origin')).toBe('https://ui.test');
        expect(unauthorized.headers.get('www-authenticate')).toBe('Bearer');
    });

    it('never rate limits a preflight', async () => {
        const { app } = createTestApp({ cors: { origin: 'https://ui.test' }, rateLimit: { max: 1 } });

        for (let i = 0; i < 3; i++) {
            const response = await send(app, '/runs', {
                method: 'OPTIONS',
                headers: { origin: 'https://ui.test', 'access-control-request-method': 'GET' },
            });

            expect(response.status).toBe(204);
        }

        expect((await send(app, '/agents', { token: ADMIN_TOKEN })).status).toBe(200);
    });
});

describe('rate limit', () => {
    it('answers 429 JSON over the limit', async () => {
        const { app } = createTestApp({ rateLimit: { max: 2 } });

        expect((await send(app, '/agents', { token: ADMIN_TOKEN })).status).toBe(200);
        expect((await send(app, '/agents', { token: ADMIN_TOKEN })).status).toBe(200);

        const limited = await send(app, '/agents', { token: ADMIN_TOKEN });

        expect(limited.status).toBe(429);
        expect(await limited.json()).toEqual({
            status: 429,
            code: 'too_many_requests',
            message: 'Too many requests, please try again later.',
        });
        expect(limited.headers.get('retry-after')).not.toBeNull();
        expect(limited.headers.get('ratelimit-limit')).toBe('2');
        expect(limited.headers.get('ratelimit-remaining')).toBe('0');
    });

    it('keys by client address', async () => {
        const { app } = createTestApp({ rateLimit: { max: 1 } });

        expect((await send(app, '/agents', { token: ADMIN_TOKEN, ip: '10.0.0.1' })).status).toBe(200);
        expect((await send(app, '/agents', { token: ADMIN_TOKEN, ip: '10.0.0.2' })).status).toBe(200);
        expect((await send(app, '/agents', { token: ADMIN_TOKEN, ip: '10.0.0.1' })).status).toBe(429);
    });

    it('skips health and metrics', async () => {
        const { app } = createTestApp({ rateLimit: { max: 2 }, metrics: undefined });

        for (let i = 0; i < 5; i++) {
            expect((await send(app, '/healthz')).status).toBe(200);
            expect((await send(app, '/readyz')).status).toBe(200);
            expect((await send(app, '/metrics')).status).toBe(200);
        }
    });

    it('skips health under a basePath', async () => {
        const { app } = createTestApp({ rateLimit: { max: 1 }, basePath: '/api' });

        for (let i = 0; i < 3; i++) {
            expect((await send(app, '/api/healthz')).status).toBe(200);
        }
    });

    it('skips health under a basePath given with a trailing slash', async () => {
        const { app } = createTestApp({ rateLimit: { max: 1 }, basePath: '/api/' });

        for (let i = 0; i < 3; i++) {
            expect((await send(app, '/api/healthz')).status).toBe(200);
        }
    });

    it('skips the limiter for every path of an unlimited prefix route', async () => {
        const { app } = createTestApp({
            rateLimit: { max: 1 },
            basePath: '/api',
            routes: [{
                method: 'GET',
                path: '/ui',
                prefix: true,
                rateLimit: false,
                handler: async () => ({ status: 200, body: 'ok' }),
            }],
        });

        for (let i = 0; i < 3; i++) {
            expect((await send(app, '/api/ui')).status).toBe(200);
            expect((await send(app, `/api/UI/assets/a${i}.js`)).status).toBe(200);
        }

        expect((await send(app, '/api/agents', { token: ADMIN_TOKEN })).status).toBe(200);
        expect((await send(app, '/api/agents', { token: ADMIN_TOKEN })).status).toBe(429);
    });

    it('is off with rateLimit: false', async () => {
        const { app } = createTestApp({ rateLimit: false });

        for (let i = 0; i < 10; i++) {
            expect((await send(app, '/agents', { token: ADMIN_TOKEN })).status).toBe(200);
        }
    });

    it('ignores a rotating X-Forwarded-For unless trustProxy is set', async () => {
        const spoof = async (app: App) => {
            const statuses: number[] = [];

            for (let n = 1; n <= 3; n++) {
                statuses.push((await send(app, '/agents', {
                    token: ADMIN_TOKEN,
                    headers: { 'x-forwarded-for': `1.2.3.${n}` },
                })).status);
            }

            return statuses;
        };

        expect(await spoof(createTestApp({ rateLimit: { max: 2 } }).app)).toEqual([200, 200, 429]);
        expect(await spoof(createTestApp({ rateLimit: { max: 2 }, trustProxy: true }).app)).toEqual([200, 200, 200]);
    });
});

describe('route labels', () => {
    const extra = (path: string, prefix?: true): HttpRoute => ({
        method: 'POST',
        path,
        ...(prefix ? { prefix } : {}),
        handler: async () => ({ status: 204 }),
    });

    it('labels an extra route by its path', () => {
        const event = { method: 'POST', path: '/webhooks/github' } as IAppEvent;

        expect(routeLabel(event, '', '/metrics', [extra('/webhooks/github')])).toBe('/webhooks/github');
        expect(routeLabel(event, '', '/metrics', [])).toBe('/_unmatched');
    });

    it('labels an extra route under basePath', () => {
        const event = { method: 'POST', path: '/api/webhooks/github' } as IAppEvent;

        expect(routeLabel(event, '/api', '/metrics', [extra('/webhooks/github')])).toBe('/webhooks/github');
    });

    it('labels a prefix route <path>/*', () => {
        const label = (path: string) => routeLabel({ method: 'GET', path } as IAppEvent, '/api', '/metrics', [extra('/ui', true)]);

        expect(label('/api/ui')).toBe('/ui/*');
        expect(label('/api/ui/')).toBe('/ui/*');
        expect(label('/api/UI/assets/app-1.js')).toBe('/ui/*');
        expect(label('/api/uix')).toBe('/_unmatched');
        // a plain route matches its path only
        expect(routeLabel({ method: 'GET', path: '/api/ui/x' } as IAppEvent, '/api', '/metrics', [extra('/ui')])).toBe('/_unmatched');
    });

    it('labels a path in another case like routup matches it', () => {
        const label = (path: string, basePath = '', routes: HttpRoute[] = []) => routeLabel({ method: 'POST', path } as IAppEvent, basePath, '/metrics', routes);

        expect(label('/Webhooks/GitHub', '', [extra('/webhooks/github')])).toBe('/webhooks/github');
        expect(label('/API/webhooks/github', '/api', [extra('/webhooks/github')])).toBe('/webhooks/github');
        expect(label('/RUNS/abc')).toBe('/runs/:id');
        expect(label('/HEALTHZ')).toBe('/healthz');
    });

    it('treats operational paths and the stream in any case', () => {
        const event = (method: string, path: string) => ({ method, path } as IAppEvent);

        expect(isOperationalPath(event('GET', '/HEALTHZ'), '', '/metrics')).toBe(true);
        expect(isOperationalPath(event('GET', '/Api/Metrics'), '/api', '/metrics')).toBe(true);
        expect(isStreamRequest(event('GET', '/RUNS/abc/Stream'), '')).toBe(true);
    });
});
