/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { IAppEvent } from 'routup';
import type { HttpRoute } from '../app/types.ts';

/**
 * `event.path` without the `basePath` prefix and trailing slashes,
 * lower-cased: routup matches paths case-insensitively, so every check
 * against a route path must too.
 */
export function routePath(event: IAppEvent, basePath: string): string {
    const path = event.path.toLowerCase();
    const base = basePath.toLowerCase();
    const relative = base && (path === base || path.startsWith(`${base}/`)) ?
        path.slice(base.length) :
        path;
    return relative.replace(/\/+$/, '') || '/';
}

/** `GET <basePath>/runs/:id/stream`: minute-long SSE connections skew request timings. */
export function isStreamRequest(event: IAppEvent, basePath: string): boolean {
    return event.method === 'GET' && /^\/runs\/[^/]+\/stream$/.test(routePath(event, basePath));
}

/** `/healthz`, `/readyz` and the metrics path (under `basePath`): never rate limited. */
export function isOperationalPath(event: IAppEvent, basePath: string, metricsPath: string): boolean {
    const path = routePath(event, basePath);
    return path === '/healthz' || path === '/readyz' || path === metricsPath.toLowerCase();
}

/** The route's path, or with `prefix` also anything below `path/` (both lower-cased). */
function matchesRoute(route: HttpRoute, path: string): boolean {
    const own = route.path.toLowerCase();
    return path === own || (route.prefix === true && path.startsWith(`${own}/`));
}

/** A request to one of the extra routes declared `rateLimit: false` (method and path, under `basePath`). */
export function isUnlimitedRoute(event: IAppEvent, basePath: string, routes: readonly HttpRoute[]): boolean {
    const path = routePath(event, basePath);
    return routes.some((route) => route.rateLimit === false && route.method === event.method && matchesRoute(route, path));
}

/** The routes of the app as metric labels, matched against the path without `basePath`; keep in step with the route modules. */
const ROUTE_TEMPLATES: Array<[RegExp, string]> = [
    [/^\/(?:healthz|readyz|agents|schedules|runs|mcp|me)$/, ''],
    [/^\/runs\/[^/]+$/, '/runs/:id'],
    [/^\/runs\/[^/]+\/stream$/, '/runs/:id/stream'],
    [/^\/runs\/[^/]+\/cancel$/, '/runs/:id/cancel'],
    [/^\/runs\/[^/]+\/approve$/, '/runs/:id/approve'],
    [/^\/runs\/[^/]+\/artifacts$/, '/runs/:id/artifacts'],
    [/^\/runs\/[^/]+\/artifacts\/[^/]+$/, '/runs/:id/artifacts/:artifactId'],
    [/^\/agents\/[^/]+\/runs$/, '/agents/:name/runs'],
    [/^\/agents\/[^/]+\/state\/kv$/, '/agents/:name/state/kv'],
    [/^\/agents\/[^/]+\/state\/kv\/[^/]+$/, '/agents/:name/state/kv/:key'],
    [/^\/agents\/[^/]+\/state\/collections\/[^/]+$/, '/agents/:name/state/collections/:collection'],
    [/^\/channels\/[^/]+(?:\/.*)?$/, '/channels/:name/*'],
];

/** Every request that matches no route shares this label. */
const UNMATCHED_ROUTE_LABEL = '/_unmatched';

/**
 * The `path` label of a request: its route template (`/runs/:id`), so ids,
 * keys and unknown paths cannot mint a series each.
 */
export function routeLabel(
    event: IAppEvent,
    basePath: string,
    metricsPath: string,
    extraRoutes: readonly HttpRoute[] = [],
): string {
    const path = routePath(event, basePath);
    if (path === metricsPath.toLowerCase()) return metricsPath;
    const extra = extraRoutes.find((route) => matchesRoute(route, path));
    if (extra !== undefined) return extra.prefix ? `${extra.path}/*` : extra.path;
    for (const [pattern, template] of ROUTE_TEMPLATES) {
        if (pattern.test(path)) return template || path;
    }
    return UNMATCHED_ROUTE_LABEL;
}
