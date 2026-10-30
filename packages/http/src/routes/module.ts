/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { isObject } from 'smob';
import { defineCoreHandler } from 'routup';
import type { App, IAppEvent } from 'routup';
import type {
    HttpContext,
    HttpRoute,
    HttpRouteContext,
    HttpRouteRequest,
    HttpRouteResult,
} from '../app/types.ts';
import { assertContentLength, isJsonMediaType, readBodyBytes } from '../request/helpers.ts';
import { toBody } from '../runs/helpers.ts';
import { routeSubpath } from './helpers.ts';

/**
 * The route's view of the request: URL, method, headers and signal without
 * the body, so the limited `readBody()` (memoized: every call gets the same
 * bytes) is the only way to it.
 */
function toRouteRequest(event: IAppEvent, ctx: HttpContext, route: HttpRoute): HttpRouteRequest {
    const { request } = event;
    let body: Promise<Uint8Array> | undefined;

    return {
        subpath: route.prefix ? routeSubpath(new URL(request.url).pathname, ctx.basePath, route.path) : '',
        request: new Request(request.url, {
            method: request.method,
            headers: request.headers,
            signal: request.signal,
        }),
        readBody: () => {
            body ??= (async () => {
                assertContentLength(event, ctx.bodyLimit);

                return readBodyBytes(event, ctx.bodyLimit, isJsonMediaType(request.headers.get('content-type')));
            })();

            return body;
        },
    };
}

/**
 * Serves the app's extra routes (`HttpAppOptions.routes`), unauthenticated:
 * each route checks its own credentials. A result without `body` answers
 * an empty body (routup waits forever on a handler returning `undefined`).
 */
export function registerRoutes(app: App, ctx: HttpContext): void {
    const routeCtx: HttpRouteContext = {
        engine: ctx.engine,
        // a getter: the engine's agents change at runtime
        get agents() {
            return ctx.agents.list();
        },
        clock: ctx.clock,
        onError: ctx.onError,
        basePath: ctx.basePath,
    };

    for (const route of ctx.routes) {
        const handler = defineCoreHandler(async (event) => respond(event, await route.handler(toRouteRequest(event, ctx, route), routeCtx)));
        const paths = route.prefix ? [route.path, `${route.path}{/*rest}`] : [route.path];

        for (const path of paths) {
            switch (route.method) {
                case 'GET':
                    app.get(path, handler);

                    break;
                case 'PUT':
                    app.put(path, handler);

                    break;
                case 'PATCH':
                    app.patch(path, handler);

                    break;
                case 'DELETE':
                    app.delete(path, handler);

                    break;
                default:
                    app.post(path, handler);
            }
        }
    }
}

/**
 * The route result as routup's answer: headers on the event's response; a
 * byte body as a Response built from those headers (so CORS and RateLimit-*
 * survive), like the artifact route.
 */
function respond(event: IAppEvent, result: HttpRouteResult): unknown {
    event.response.status = result.status;

    if (isObject(result.headers)) {
        for (const [name, value] of Object.entries(result.headers)) {
            event.response.headers.set(name, value);
        }
    }

    if (result.body instanceof Uint8Array) {
        const headers = new Headers(event.response.headers);

        if (!headers.has('content-type')) {
            headers.set('content-type', 'application/octet-stream');
        }

        return new Response(toBody(result.body), { status: result.status, headers });
    }

    return result.body === undefined ? null : result.body;
}
