/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { KeyObject } from 'node:crypto';
import { ChamviError } from '@chamvi/core';
import type { IClock } from '@chamvi/core';
import { PaginatedOctokit } from '../app/helpers.ts';
import type { GithubOctokit, GithubPermissions } from '../app/types.ts';
import { GITHUB_REQUEST_ERROR_CODE } from '../tools/constants.ts';
import { APP_REQUEST_TIMEOUT_MS, GITHUB_USER_AGENT, TOKEN_REFRESH_MARGIN_MS } from './constants.ts';
import { createAppJwt } from './helpers.ts';

type CachedToken = { token: string; expiresAt: number };

type InstallationTokensInput = {
    appId: string;
    key: KeyObject;
    clock: IClock;
    baseUrl: string;
    fetch?: typeof globalThis.fetch;
};

/**
 * Aborts each request of `octokit` after APP_REQUEST_TIMEOUT_MS on the
 * clock (beside any signal of its own): App requests are shared by every
 * caller, so no run's signal bounds them.
 */
export function withAppTimeout(octokit: GithubOctokit, clock: IClock): GithubOctokit {
    octokit.hook.wrap('request', async (send, options) => {
        const controller = new AbortController();
        const timer = clock.setTimeout(() => controller.abort(new ChamviError({
            message: `The GitHub App request did not answer within ${APP_REQUEST_TIMEOUT_MS}ms.`,
            code: GITHUB_REQUEST_ERROR_CODE,
        })), APP_REQUEST_TIMEOUT_MS);
        const own = options.request?.signal;
        const signal = own ? AbortSignal.any([own, controller.signal]) : controller.signal;
        // in place: before-after-hook hands every hook the same options object
        options.request = { ...options.request, signal };
        try {
            return await send(options);
        } finally {
            timer.clear();
        }
    });
    return octokit;
}

/**
 * Installation tokens per installation, cached until TOKEN_REFRESH_MARGIN_MS
 * before they expire (on the `IClock`). Concurrent callers share one
 * exchange; a failed exchange is not cached.
 */
export function createInstallationTokens(input: InstallationTokensInput): {
    get(installationId: number): Promise<string>;
    /**
     * A token of `installationId` limited to the one repository and
     * `permissions`, cached per installation, repository (lower case) and
     * permissions like the installation tokens.
     */
    repository(installationId: number, repo: string, permissions: GithubPermissions): Promise<CachedToken>;
    app(): Promise<GithubOctokit>;
} {
    const cache = new Map<number, CachedToken>();
    const pending = new Map<number, Promise<string>>();
    const scoped = new Map<string, CachedToken>();
    const scopedPending = new Map<string, Promise<CachedToken>>();
    const isFresh = (cached: CachedToken | undefined): cached is CachedToken => cached !== undefined &&
        input.clock.now().getTime() < cached.expiresAt - TOKEN_REFRESH_MARGIN_MS;
    const request = input.fetch ? { fetch: input.fetch } : {};

    /**
     * An Octokit authenticated as the App (a fresh JWT). Each request is
     * aborted after APP_REQUEST_TIMEOUT_MS on the clock (beside any signal
     * of its own): the exchange and `GET /app` are shared by every caller.
     */
    async function app(): Promise<GithubOctokit> {
        const octokit = new PaginatedOctokit({
            auth: createAppJwt(input.appId, input.key, input.clock.now()),
            baseUrl: input.baseUrl,
            userAgent: GITHUB_USER_AGENT,
            request,
        });
        return withAppTimeout(octokit, input.clock);
    }

    async function exchange(installationId: number): Promise<string> {
        const octokit = await app();
        const { data } = await octokit.request('POST /app/installations/{installation_id}/access_tokens', { installation_id: installationId });
        cache.set(installationId, { token: data.token, expiresAt: Date.parse(data.expires_at) });
        return data.token;
    }

    async function exchangeScoped(key: string, installationId: number, repo: string, permissions: GithubPermissions): Promise<CachedToken> {
        const octokit = await app();
        const { data } = await octokit.request('POST /app/installations/{installation_id}/access_tokens', {
            installation_id: installationId,
            repositories: [repo],
            permissions,
        });
        const token = { token: data.token, expiresAt: Date.parse(data.expires_at) };
        scoped.set(key, token);
        return token;
    }

    return {
        app,
        repository(installationId, repo, permissions) {
            const sorted = Object.fromEntries(Object.entries(permissions).sort(([a], [b]) => a.localeCompare(b)));
            const key = `${installationId}:${repo.toLowerCase()}:${JSON.stringify(sorted)}`;
            const cached = scoped.get(key);
            if (isFresh(cached)) return Promise.resolve(cached);
            let inflight = scopedPending.get(key);
            if (!inflight) {
                inflight = exchangeScoped(key, installationId, repo, sorted).finally(() => scopedPending.delete(key));
                scopedPending.set(key, inflight);
            }
            return inflight;
        },
        get(installationId: number): Promise<string> {
            const cached = cache.get(installationId);
            if (cached && input.clock.now().getTime() < cached.expiresAt - TOKEN_REFRESH_MARGIN_MS) {
                return Promise.resolve(cached.token);
            }
            let inflight = pending.get(installationId);
            if (!inflight) {
                inflight = exchange(installationId).finally(() => pending.delete(installationId));
                pending.set(installationId, inflight);
            }
            return inflight;
        },
    };
}
