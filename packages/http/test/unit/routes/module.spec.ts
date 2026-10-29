/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { UnauthorizedError } from '@ebec/http';
import { describe, expect, it } from 'vitest';
import { InvalidAgentDefinitionError, defineAgent } from '@chamvi/core';
import { http } from '@chamvi/http';
import type { HttpRoute, HttpRouteContext, HttpRouteRequest } from '@chamvi/http';
import type { App } from 'routup';
import { createTestApp } from '../../utils/app.ts';
import { textModel } from '../../utils/model.ts';

type SendOptions = {
    method?: string;
    body?: string;
    contentType?: string;
};

/** A request with a socket address (the rate limiter keys by it). */
function send(app: App, path: string, options: SendOptions = {}): Promise<Response> {
    const headers = new Headers();
    if (options.body !== undefined) headers.set('content-type', options.contentType ?? 'application/json');
    const request = new Request(`http://test${path}`, {
        method: options.method ?? 'POST',
        headers,
        body: options.body,
    });
    (request as Request & { ip?: string }).ip = '10.0.0.1';
    return app.fetch(request);
}

function route(overrides: Partial<HttpRoute> = {}): HttpRoute {
    return {
        method: 'POST',
        path: '/extra',
        handler: async () => ({ status: 202, body: { ok: true } }),
        ...overrides,
    };
}

describe('extra routes', () => {
    it('returns 404 for a missing repository record in a custom route', async () => {
        const { app } = createTestApp({
            routes: [route({
                handler: async (_request, ctx) => {
                    const value = await ctx.engine.repositories.state.findOneOrFail('echo', 'missing');
                    return { status: 200, body: { value } };
                },
            })],
        });
        const response = await send(app, '/extra');
        expect(response.status).toBe(404);
        expect(await response.json()).toMatchObject({ code: 'repository_not_found' });
    });

    it('serves an extra route under basePath', async () => {
        const { app } = createTestApp({ basePath: '/api', routes: [route()] });
        const response = await send(app, '/api/extra');
        expect(response.status).toBe(202);
        expect(await response.json()).toEqual({ ok: true });
    });

    it('hands the route context', async () => {
        let seen: HttpRouteContext | undefined;
        const {
            app, 
            engine, 
            clock, 
        } = createTestApp({
            routes: [route({
                handler: async (_request, ctx) => {
                    seen = ctx;
                    return { status: 204 };
                },
            })],
        });
        await send(app, '/extra');
        expect(seen?.engine).toBe(engine);
        expect(seen?.clock).toBe(clock);
        expect(seen?.agents.map((agent) => agent.name)).toEqual(['echo']);
        expect(seen?.onError).toBeTypeOf('function');
    });

    it('hands a request without the body, so readBody() is the only way in', async () => {
        let body: unknown;
        let method: string | undefined;
        let contentType: string | null | undefined;
        const { app } = createTestApp({
            routes: [route({
                handler: async ({ request }) => {
                    body = request.body;
                    method = request.method;
                    contentType = request.headers.get('content-type');
                    return { status: 204 };
                },
            })],
        });
        await send(app, '/extra', { body: '{"a":1}' });
        expect(body).toBeNull();
        expect(method).toBe('POST');
        expect(contentType).toBe('application/json');
    });

    it('returns the same bytes from repeated readBody() calls', async () => {
        const texts: string[] = [];
        const { app } = createTestApp({
            routes: [route({
                handler: async ({ readBody }) => {
                    const decoder = new TextDecoder();
                    texts.push(decoder.decode(await readBody()), decoder.decode(await readBody()));
                    return { status: 204 };
                },
            })],
        });
        const response = await send(app, '/extra', { body: '{"a":1}' });
        expect(response.status).toBe(204);
        expect(texts).toEqual(['{"a":1}', '{"a":1}']);
    });

    it('answers a body-less result', async () => {
        const { app } = createTestApp({ routes: [route({ handler: async () => ({ status: 204 }) })] });
        const response = await send(app, '/extra');
        expect(response.status).toBe(204);
        expect(await response.text()).toBe('');
    });

    it('skips the rate limiter for rateLimit: false', async () => {
        const { app } = createTestApp({
            rateLimit: { max: 1 },
            routes: [
                route({ path: '/open', rateLimit: false }),
                route({ path: '/limited' }),
            ],
        });
        expect((await send(app, '/open')).status).toBe(202);
        expect((await send(app, '/open')).status).toBe(202);
        expect((await send(app, '/limited')).status).toBe(202);
        expect((await send(app, '/limited')).status).toBe(429);
    });

    it('skips the rate limiter whatever the case of the request path (routup matches case-insensitively)', async () => {
        const { app } = createTestApp({
            basePath: '/api',
            rateLimit: { max: 1 },
            routes: [
                route({ path: '/open', rateLimit: false }),
                route({ path: '/Mixed', rateLimit: false }),
            ],
        });
        expect((await send(app, '/API/Open')).status).toBe(202);
        expect((await send(app, '/api/OPEN')).status).toBe(202);
        expect((await send(app, '/api/mixed')).status).toBe(202);
        expect((await send(app, '/Api/MIXED')).status).toBe(202);
    });

    it('hands the raw body bytes', async () => {
        let received: string | undefined;
        const { app } = createTestApp({
            routes: [route({
                handler: async (request: HttpRouteRequest) => {
                    received = new TextDecoder().decode(await request.readBody());
                    return { status: 202 };
                },
            })],
        });
        const body = '{"a":"é", "b" : "\\u00e9"}';
        expect((await send(app, '/extra', { body })).status).toBe(202);
        expect(received).toBe(body);
    });

    it('reads an empty body as zero bytes', async () => {
        let size: number | undefined;
        const { app } = createTestApp({
            routes: [route({
                handler: async (request) => {
                    size = (await request.readBody()).byteLength;
                    return { status: 202 };
                },
            })],
        });
        expect((await send(app, '/extra')).status).toBe(202);
        expect(size).toBe(0);
    });

    it('answers 415 for a form body', async () => {
        const reading = route({
            handler: async (request) => {
                await request.readBody();
                return { status: 202 };
            },
        });
        const { app } = createTestApp({ routes: [reading] });
        const response = await send(app, '/extra', {
            body: 'payload=x',
            contentType: 'application/x-www-form-urlencoded',
        });
        expect(response.status).toBe(415);
        expect(await response.json()).toMatchObject({ status: 415, code: 'unsupported_media_type' });
    });

    it('answers 413 above bodyLimit', async () => {
        const reading = route({
            handler: async (request) => {
                await request.readBody();
                return { status: 202 };
            },
        });
        const { app } = createTestApp({ bodyLimit: 8, routes: [reading] });
        const response = await send(app, '/extra', { body: '{"a":"0123456789"}' });
        expect(response.status).toBe(413);
        const body = await response.json() as Record<string, unknown>;
        expect(body).toMatchObject({ status: 413 });
        expect(Object.keys(body).sort()).toEqual(['code', 'message', 'status']);
    });

    it('renders thrown http errors', async () => {
        const { app } = createTestApp({
            routes: [route({
                handler: async () => {
                    throw new UnauthorizedError({ message: 'bad signature' });
                },
            })],
        });
        const response = await send(app, '/extra');
        expect(response.status).toBe(401);
        expect(await response.json()).toEqual({
            status: 401, 
            code: 'unauthorized', 
            message: 'bad signature', 
        });
    });

    it('renders other errors as 500 and reports them', async () => {
        const errors: unknown[] = [];
        const { app } = createTestApp({
            onError: (error) => { errors.push(error); },
            routes: [route({
                handler: async () => {
                    throw new Error('boom');
                },
            })],
        });
        const response = await send(app, '/extra');
        expect(response.status).toBe(500);
        expect(await response.json()).toMatchObject({ status: 500, message: 'Internal Server Error' });
        expect(errors).toHaveLength(1);
    });

    it.each([
        ['a path without a leading slash', [route({ path: 'extra' })]],
        ['a path with a parameter', [route({ path: '/extra/:id' })]],
        ['a path with a wildcard', [route({ path: '/extra/*' })]],
        ['a path with a brace', [route({ path: '/extra{/x}' })]],
        ['a duplicate method and path', [route(), route()]],
        ...['agents', 'channels', 'runs', 'mcp', 'healthz', 'me', 'readyz', 'schedules']
            .map((segment): [string, HttpRoute[]] => [`the reserved segment ${segment}`, [route({ path: `/${segment}/x` })]]),
        ['the metrics path', [route({ method: 'GET', path: '/metrics' })]],
        ['a reserved segment in another case', [route({ path: '/AGENTS/x' })]],
        ['the metrics path in another case', [route({ method: 'GET', path: '/Metrics' })]],
        ['a duplicate path in another case', [route(), route({ path: '/EXTRA' })]],
    ])('refuses %s at construction', (_name, routes) => {
        expect(() => createTestApp({ metrics: undefined, routes })).toThrow(InvalidAgentDefinitionError);
    });

    it('accepts a path under /hooks, no longer a built-in route', () => {
        expect(() => createTestApp({ routes: [route({ path: '/hooks/x' })] })).not.toThrow();
    });

    it('accepts the same path under two methods', () => {
        expect(() => createTestApp({ routes: [route(), route({ method: 'GET' })] })).not.toThrow();
    });
});

describe('prefix routes, headers and byte bodies', () => {
    const get = (app: App, path: string, headers: Record<string, string> = {}) => app.fetch(new Request(`http://test${path}`, { headers }));

    it('a prefix route serves its path and everything below it', async () => {
        const seen: string[] = [];
        const { app } = createTestApp({
            routes: [route({
                method: 'GET',
                path: '/ui',
                prefix: true,
                handler: async ({ subpath }) => {
                    seen.push(subpath);
                    return { status: 200, body: 'ok' };
                },
            })],
        });
        for (const path of ['/ui', '/ui/', '/ui/a/b.js?x=1', '/ui/%252e%252e/x']) {
            expect((await get(app, path)).status).toBe(200);
        }
        expect(seen).toEqual(['', '/', '/a/b.js', '/%252e%252e/x']);
        expect((await get(app, '/uix')).status).toBe(404);
        expect((await app.fetch(new Request('http://test/ui/a', { method: 'POST' }))).status).toBe(404);
    });

    it('keeps the subpath case and strips basePath', async () => {
        let seen: string | undefined;
        const { app } = createTestApp({
            basePath: '/api',
            routes: [route({
                method: 'GET',
                path: '/ui',
                prefix: true,
                handler: async ({ subpath }) => {
                    seen = subpath;
                    return { status: 204 };
                },
            })],
        });
        expect((await get(app, '/api/UI/Assets/App.JS')).status).toBe(204);
        expect(seen).toBe('/Assets/App.JS');
    });

    it('strips a basePath given with a trailing slash', async () => {
        let seen: string | undefined;
        const { app } = createTestApp({
            basePath: '/api/',
            routes: [route({
                method: 'GET',
                path: '/ui',
                prefix: true,
                handler: async ({ subpath }) => {
                    seen = subpath;
                    return { status: 204 };
                },
            })],
        });
        expect((await get(app, '/api/ui/assets/x.js')).status).toBe(204);
        expect(seen).toBe('/assets/x.js');
    });

    it('a plain route has an empty subpath', async () => {
        let seen: string | undefined;
        const { app } = createTestApp({
            routes: [route({
                handler: async ({ subpath }) => {
                    seen = subpath;
                    return { status: 204 };
                },
            })],
        });
        await send(app, '/extra');
        expect(seen).toBe('');
    });

    it('sends route headers and byte bodies', async () => {
        const { app } = createTestApp({
            routes: [route({
                method: 'GET',
                handler: async () => ({
                    status: 200,
                    headers: { 'content-type': 'image/png', 'cache-control': 'no-cache' },
                    body: new Uint8Array([0, 255, 1]),
                }),
            })],
        });
        const response = await get(app, '/extra');
        expect(response.status).toBe(200);
        expect(response.headers.get('content-type')).toBe('image/png');
        expect(response.headers.get('cache-control')).toBe('no-cache');
        expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([0, 255, 1]);
    });

    it('a byte body without content-type is application/octet-stream', async () => {
        const { app } = createTestApp({ routes: [route({ method: 'GET', handler: async () => ({ status: 200, body: new Uint8Array([1, 2]) }) })] });
        const response = await get(app, '/extra');
        expect(response.headers.get('content-type')).toBe('application/octet-stream');
        expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([1, 2]);
    });

    it('a content-type header wins over the default of a string or JSON body', async () => {
        const { app } = createTestApp({
            routes: [
                route({
                    method: 'GET',
                    handler: async () => ({
                        status: 200, 
                        headers: { 'content-type': 'text/html; charset=utf-8' }, 
                        body: '<p>hi</p>', 
                    }),
                }),
                route({
                    method: 'GET',
                    path: '/json',
                    handler: async () => ({
                        status: 200, 
                        headers: { 'x-extra': '1' }, 
                        body: { a: 1 }, 
                    }),
                }),
            ],
        });
        const html = await get(app, '/extra');
        expect(html.headers.get('content-type')).toBe('text/html; charset=utf-8');
        expect(await html.text()).toBe('<p>hi</p>');
        const json = await get(app, '/json');
        expect(json.headers.get('x-extra')).toBe('1');
        expect(await json.json()).toEqual({ a: 1 });
    });

    it('keeps CORS headers on a byte body', async () => {
        const { app } = createTestApp({
            cors: { origin: '*' },
            routes: [route({ method: 'GET', handler: async () => ({ status: 200, body: new Uint8Array([7]) }) })],
        });
        const response = await get(app, '/extra', { origin: 'http://elsewhere' });
        expect(response.headers.get('access-control-allow-origin')).toBe('*');
        expect([...new Uint8Array(await response.arrayBuffer())]).toEqual([7]);
    });

    it('hands the app basePath in the route context', async () => {
        const bases: string[] = [];
        const handler: HttpRoute['handler'] = async (_request, ctx) => {
            bases.push(ctx.basePath);
            return { status: 204 };
        };
        await send(createTestApp({ basePath: '/api', routes: [route({ handler })] }).app, '/api/extra');
        await send(createTestApp({ routes: [route({ handler })] }).app, '/extra');
        expect(bases).toEqual(['/api', '']);
    });

    it.each([
        ['a route under a prefix route of the same method', [route({
            method: 'GET', 
            path: '/ui', 
            prefix: true, 
        }), route({ method: 'GET', path: '/ui/x' })]],
        ['a route at the path of a prefix route', [route({ method: 'GET', path: '/ui' }), route({
            method: 'GET', 
            path: '/ui', 
            prefix: true, 
        })]],
        ['two nested prefix routes', [route({
            method: 'GET', 
            path: '/ui/a', 
            prefix: true, 
        }), route({
            method: 'GET', 
            path: '/UI', 
            prefix: true, 
        })]],
        ['a prefix route at the metrics path', [route({
            method: 'GET', 
            path: '/ops/metrics', 
            prefix: true, 
        })]],
        ['a prefix route above the metrics path', [route({
            method: 'GET', 
            path: '/ops', 
            prefix: true, 
        })]],
    ])('refuses %s', (_name, routes) => {
        expect(() => createTestApp({ metrics: { metricsPath: '/ops/metrics' }, routes: [...routes] }))
            .toThrow(InvalidAgentDefinitionError);
    });

    it('refuses a prefix route at the default metrics path', () => {
        expect(() => createTestApp({
            metrics: undefined,
            routes: [route({
                method: 'GET', 
                path: '/metrics', 
                prefix: true, 
            })], 
        }))
            .toThrow(InvalidAgentDefinitionError);
    });

    it('allows a route under a prefix route for another method', () => {
        expect(() => createTestApp({
            routes: [route({
                method: 'GET', 
                path: '/ui', 
                prefix: true, 
            }), route({ method: 'POST', path: '/ui/x' })], 
        })).not.toThrow();
    });

    it('allows a sibling path that only shares the prefix text', () => {
        expect(() => createTestApp({
            routes: [route({
                method: 'GET', 
                path: '/ui', 
                prefix: true, 
            }), route({ method: 'GET', path: '/uix' })], 
        })).not.toThrow();
    });

    it('lists live agents in the route context', async () => {
        let names: string[] | undefined;
        const { app, engine } = createTestApp({
            routes: [route({
                handler: async (_request, ctx) => {
                    names = ctx.agents.map((agent) => agent.name);
                    return { status: 204 };
                },
            })],
        });
        await engine.putAgent(defineAgent({
            name: 'late',
            model: textModel(),
            instructions: 'Late.',
            channels: [http.on()],
        }));
        await send(app, '/extra');
        expect(names).toEqual(['echo', 'late']);
        await engine.removeAgent('echo');
        await send(app, '/extra');
        expect(names).toEqual(['late']);
    });
});
