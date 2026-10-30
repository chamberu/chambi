/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { TooManyRequestsError } from '@ebec/http';
import { cors } from '@routup/cors';
import { prometheus } from '@routup/prometheus';
import { rateLimit } from '@routup/rate-limit';
import { Registry } from 'prom-client';
import { getRequestIP } from 'routup';
import type { App, IAppEvent } from 'routup';
import {
    DEFAULT_METRICS_PATH,
    DEFAULT_RATE_LIMIT_MAX,
    DEFAULT_RATE_LIMIT_WINDOW_MS,
} from '../app/constants.ts';
import type { HttpAppOptions } from '../app/types.ts';
import {
    isOperationalPath,
    isStreamRequest,
    isUnlimitedRoute,
    routeLabel,
} from './helpers.ts';
import { matchesChannel } from './channels.ts';

/**
 * CORS (only when configured), a rate limit keyed by the client address
 * as the App's `trustProxy` resolves it (never a raw `X-Forwarded-For`),
 * and Prometheus at `/metrics` with a registry of its own, labelled by
 * route template. Installed before any route.
 */
export function installPlugins(app: App, options: HttpAppOptions): void {
    const basePath = options.basePath ?? '';
    const routes = options.routes ?? [];

    if (options.cors) {
        app.use(cors(options.cors));
    }

    const metricsPath = options.metrics === false ?
        undefined :
        options.metrics?.metricsPath ?? DEFAULT_METRICS_PATH;

    const channelPolicies = Object.entries(options.channelRateLimits ?? {});
    const generalLimit = options.rateLimit;

    // before metrics: a refused request is not timed (and mints no series)
    if (generalLimit !== false) {
        const skip = generalLimit?.skip ?? ((event: IAppEvent) => event.method === 'OPTIONS' ||
            isOperationalPath(event, basePath, metricsPath ?? '') ||
            isUnlimitedRoute(event, basePath, routes));

        app.use(rateLimit({
            windowMs: DEFAULT_RATE_LIMIT_WINDOW_MS,
            max: DEFAULT_RATE_LIMIT_MAX,
            // the library default trusts any X-Forwarded-For
            keyGenerator: (event) => getRequestIP(event) ?? 'unknown',
            handler: () => {
                throw new TooManyRequestsError({ message: 'Too many requests, please try again later.' });
            },
            ...generalLimit,
            skip: (event) => channelPolicies.some(([name]) => matchesChannel(event, basePath, name)) || skip(event),
        }));
    }

    for (const [name, policy] of channelPolicies) {
        if (policy === false) {
            continue;
        }

        app.use(rateLimit({
            windowMs: policy.windowMs ?? DEFAULT_RATE_LIMIT_WINDOW_MS,
            max: policy.max,
            keyGenerator: (event) => getRequestIP(event) ?? 'unknown',
            skip: (event) => !matchesChannel(event, basePath, name),
            handler: () => {
                throw new TooManyRequestsError({ message: 'Too many requests, please try again later.' });
            },
        }));
    }

    if (options.metrics !== false) {
        app.use(prometheus({
            metricsPath,
            // the global default registry throws on a second app in one process
            registry: new Registry(),
            skip: (event) => isStreamRequest(event, basePath),
            normalizePath: (_path, event) => routeLabel(event, basePath, metricsPath ?? DEFAULT_METRICS_PATH, routes),
            ...options.metrics,
        }));
    }
}
