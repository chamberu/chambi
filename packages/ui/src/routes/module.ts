/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { InvalidAgentDefinitionError } from '@chamvi/core';
import type { IClock } from '@chamvi/core';
import type { HttpRoute, HttpRouteResult } from '@chamvi/http';
import type { UiAuthupConfig, UiConfig } from '../config/types.ts';
import {
    ASSET_CACHE_CONTROL,
    BUILD_RETRY_MS,
    DEFAULT_UI_BASE_PATH,
    DOCUMENT_CACHE_CONTROL,
    SECURITY_HEADERS,
    UI_BASE_PATH_PATTERN,
} from './constants.ts';
import {
    buildCsp,
    defaultRoot,
    isFileLike,
    loadBuild,
    renderIndex,
    resolveBuildPath,
} from './helpers.ts';
import type { BuildFile, UiRoutesOptions } from './types.ts';

function assertAuthup(authup: UiAuthupConfig): void {
    let url: URL;

    try {
        url = new URL(authup.url);
    } catch {
        throw new InvalidAgentDefinitionError('uiRoutes: auth.authup.url must be an absolute http(s) URL.');
    }

    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
        throw new InvalidAgentDefinitionError('uiRoutes: auth.authup.url must be an absolute http(s) URL.');
    }

    if (typeof authup.clientId !== 'string' || authup.clientId.length === 0) {
        throw new InvalidAgentDefinitionError('uiRoutes: auth.authup.clientId must be a non-empty string.');
    }

    if (authup.realmId !== undefined && (typeof authup.realmId !== 'string' || authup.realmId.length === 0)) {
        throw new InvalidAgentDefinitionError('uiRoutes: auth.authup.realmId must be a non-empty string.');
    }
}

/**
 * The dashboard as one extra route of `createHttpApp({ routes })`: every
 * `GET` below `basePath` answers a file of the build (hashed `assets/`
 * cached for a year, the rest `no-cache`), `index.html` with the config
 * injected for any other path without an extension (client routes), else
 * 404. Unauthenticated (the SPA holds no secret) and not rate limited;
 * every answer carries the CSP and `referrer-policy: no-referrer`.
 */
export function uiRoutes(options: UiRoutesOptions = {}): HttpRoute[] {
    const basePath = options.basePath ?? DEFAULT_UI_BASE_PATH;

    if (typeof basePath !== 'string' || !UI_BASE_PATH_PATTERN.test(basePath)) {
        throw new InvalidAgentDefinitionError('uiRoutes: basePath must be a lower-case path like /ui, without a trailing slash.');
    }

    const tokens = options.auth?.tokens ?? true;
    const authup = options.auth?.authup;

    if (authup) {
        assertAuthup(authup);
    }

    if (!tokens && !authup) {
        throw new InvalidAgentDefinitionError('uiRoutes: auth.tokens false needs auth.authup, else nobody can sign in.');
    }

    if (options.root !== undefined && (typeof options.root !== 'string' || options.root.length === 0)) {
        throw new InvalidAgentDefinitionError('uiRoutes: root must be a non-empty path.');
    }

    const root = options.root ?? defaultRoot();

    // a missing build is read again at most every BUILD_RETRY_MS (the
    // route is unauthenticated and not rate limited): in between, requests
    // answer 500 without reading the folder or reporting again
    let build: Promise<Map<string, BuildFile>> | undefined;
    let failedAt: number | undefined;
    const load = (clock: IClock): Promise<Map<string, BuildFile>> | undefined => {
        if (failedAt !== undefined && clock.now().getTime() - failedAt < BUILD_RETRY_MS) {
            return undefined;
        }

        build ??= loadBuild(root).then((files) => {
            if (!files.has('index.html')) {
                throw new Error('index.html missing');
            }

            failedAt = undefined;

            return files;
        }).catch(() => {
            // not memoized for good: the build may land later (e.g. a volume mounted after start)
            build = undefined;
            failedAt = clock.now().getTime();

            throw new InvalidAgentDefinitionError(`uiRoutes: no dashboard build in ${root}; build @chamvi/ui first.`);
        });

        return build;
    };

    // one config, CSP and index per app basePath (the route context's)
    const rendered = new Map<string, {
        config: UiConfig;
        headers: Record<string, string>;
        index?: Uint8Array
    }>();
    const view = (apiBase: string) => {
        let entry = rendered.get(apiBase);

        if (!entry) {
            const config: UiConfig = {
                apiBase,
                uiBase: `${apiBase}${basePath}`,
                auth: { tokens, ...(authup ? { authup: { ...authup } } : {}) },
            };

            entry = { config, headers: { ...SECURITY_HEADERS, 'content-security-policy': buildCsp(config) } };
            rendered.set(apiBase, entry);
        }

        return entry;
    };

    return [{
        method: 'GET',
        path: basePath,
        prefix: true,
        rateLimit: false,
        handler: async ({ subpath }, ctx): Promise<HttpRouteResult> => {
            const entry = view(ctx.basePath);
            const key = resolveBuildPath(subpath);
            const notFound = (): HttpRouteResult => ({
                status: 404,
                headers: entry.headers,
                body: {
                    status: 404,
                    code: 'not_found',
                    message: 'Not Found',
                },
            });

            if (key === undefined) {
                return notFound();
            }

            const loading = load(ctx.clock);

            if (!loading) {
                return {
                    status: 500,
                    headers: entry.headers,
                    body: {
                        status: 500,
                        code: 'internal_error',
                        message: 'Internal Server Error',
                    },
                };
            }

            const files = await loading;

            if (key === '' || key === 'index.html' || (!files.has(key) && !isFileLike(key))) {
                entry.index ??= new TextEncoder().encode(renderIndex(new TextDecoder().decode(files.get('index.html')!.bytes), entry.config));

                return {
                    status: 200,
                    headers: {
                        ...entry.headers,
                        'content-type': 'text/html; charset=utf-8',
                        'cache-control': DOCUMENT_CACHE_CONTROL,
                    },
                    body: entry.index,
                };
            }

            const file = files.get(key);

            if (!file) {
                return notFound();
            }

            return {
                status: 200,
                headers: {
                    ...entry.headers,
                    'content-type': file.type,
                    'cache-control': file.immutable ? ASSET_CACHE_CONTROL : DOCUMENT_CACHE_CONTROL,
                },
                body: file.bytes,
            };
        },
    }];
}
