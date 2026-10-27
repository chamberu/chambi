/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { ToolSet } from 'ai';
import { ChamviError, systemClock } from '@chamvi/core';
import { GITHUB_USER_AGENT } from '../auth/constants.ts';
import { normalizePrivateKey } from '../auth/helpers.ts';
import { createInstallationTokens, withAppTimeout } from '../auth/module.ts';
import {
    PaginatedOctokit,
    normalizeAppId,
    normalizeBaseUrl,
    normalizeInstallationId,
    normalizeSecrets,
    normalizeSlug,
    toInstallation,
} from './helpers.ts';
import { resolveMergeMethod, toolError } from '../tools/helpers.ts';
import { createPullRequestWriteTools } from '../tools/merge.ts';
import { createPullRequestTools } from '../tools/pulls.ts';
import { createReadTools } from '../tools/read.ts';
import { createRepositoryTools } from '../tools/repositories.ts';
import { GITHUB_REQUEST_ERROR_CODE } from '../tools/constants.ts';
import { createWriteTools } from '../tools/write.ts';
import { verifySignature } from '../webhook/helpers.ts';
import { INSTALLATION_CACHE_TTL_MS } from './constants.ts';
import type {
    GithubAppOptions,
    GithubBotIdentity,
    GithubInstallation,
    GithubOctokit,
    GithubRepositoryToken,
    GithubWriteToolsOptions,
    IGithubApp,
} from './types.ts';

/**
 * A GitHub App: installation Octokits over an `IClock`-based token cache
 * and the App's bot login. Validates the options eagerly
 * (`InvalidAgentDefinitionError`).
 */
export function createGithubApp(options: GithubAppOptions): IGithubApp {
    const appId = normalizeAppId(options.appId);
    const key = normalizePrivateKey(options.privateKey);
    const secrets = normalizeSecrets(options.webhookSecret);
    const installationId = normalizeInstallationId(options.installationId);
    const slug = normalizeSlug(options.slug);
    const clock = options.clock ?? systemClock;
    const baseUrl = normalizeBaseUrl(options.baseUrl);
    const request = options.fetch ? { fetch: options.fetch } : {};

    const tokens = createInstallationTokens({
        appId,
        key,
        clock,
        baseUrl,
        fetch: options.fetch,
    });

    let login: Promise<string> | undefined = slug ? Promise.resolve(`${slug}[bot]`) : undefined;
    let identity: Promise<GithubBotIdentity> | undefined;

    /** The installation id per lower-cased `owner/repo` until `expiresAt` (INSTALLATION_CACHE_TTL_MS on the clock). */
    const installationCache = new Map<string, { id: number; expiresAt: number }>();
    const pendingLookups = new Map<string, Promise<number | undefined>>();

    function lookupInstallation(owner: string, repo: string): Promise<number | undefined> {
        const key = `${owner}/${repo}`.toLowerCase();
        const cached = installationCache.get(key);
        if (cached && clock.now().getTime() < cached.expiresAt) return Promise.resolve(cached.id);
        let pending = pendingLookups.get(key);
        if (!pending) {
            pending = tokens.app()
                .then((octokit) => octokit.request('GET /repos/{owner}/{repo}/installation', { owner, repo }))
                .then(({ data }) => {
                    installationCache.set(key, { id: data.id, expiresAt: clock.now().getTime() + INSTALLATION_CACHE_TTL_MS });
                    return data.id;
                }, (error: unknown) => {
                    installationCache.delete(key);
                    if ((error as { status?: number })?.status === 404) return undefined;
                    throw toolError(error);
                })
                .finally(() => pendingLookups.delete(key));
            pendingLookups.set(key, pending);
        }
        return pending;
    }

    const app: IGithubApp = {
        appId,
        ...(installationId !== undefined ? { installationId } : {}),
        async octokit(id: number): Promise<GithubOctokit> {
            const token = await tokens.get(id);
            return new PaginatedOctokit({
                auth: token,
                baseUrl,
                userAgent: GITHUB_USER_AGENT,
                request,
            });
        },
        botLogin(): Promise<string> {
            if (!login) {
                login = tokens.app()
                    .then(async (octokit) => {
                        const { data } = await octokit.request('GET /app');
                        if (typeof data?.slug !== 'string' || data.slug.length === 0) {
                            // a login of `[bot]` would never match and disable the self-sender guard
                            throw new ChamviError({ message: 'GET /app answered without the App slug; set slug on createGithubApp().', code: GITHUB_REQUEST_ERROR_CODE });
                        }
                        return `${data.slug}[bot]`;
                    })
                    .catch((error: unknown) => {
                        login = undefined;
                        throw error;
                    });
            }
            return login;
        },
        botIdentity(): Promise<GithubBotIdentity> {
            if (!identity) {
                identity = (async () => {
                    const name = await app.botLogin();
                    // a public endpoint: the App's JWT cannot read users, and no installation is needed
                    const octokit = withAppTimeout(new PaginatedOctokit({
                        baseUrl, 
                        userAgent: GITHUB_USER_AGENT, 
                        request, 
                    }), clock);
                    const { data } = await octokit.request('GET /users/{username}', { username: name });
                    if (typeof data?.id !== 'number') {
                        throw new ChamviError({ message: `GET /users/${name} answered without a user id.`, code: GITHUB_REQUEST_ERROR_CODE });
                    }
                    return { name, email: `${data.id}+${name}@users.noreply.github.com` };
                })().catch((error: unknown) => {
                    identity = undefined;
                    throw toolError(error);
                });
            }
            return identity;
        },
        installationFor(target): Promise<number | undefined> {
            return lookupInstallation(target.owner, target.repo);
        },
        async installations(): Promise<GithubInstallation[]> {
            try {
                const octokit = await tokens.app();
                const items = await octokit.paginate('GET /app/installations', { per_page: 100 });
                return items.map((item) => toInstallation(item));
            } catch (error) {
                throw toolError(error);
            }
        },
        async repositoryToken(target, tokenOptions): Promise<GithubRepositoryToken | undefined> {
            const { owner, repo } = target;
            const installation = await lookupInstallation(owner, repo);
            if (installation === undefined) return undefined;
            const scoped = await tokens.repository(installation, repo, tokenOptions.permissions).catch((error: unknown) => {
                // the App may have been removed from the repository: look it up again next time
                installationCache.delete(`${owner}/${repo}`.toLowerCase());
                throw toolError(error);
            });
            return { token: scoped.token, expiresAt: new Date(scoped.expiresAt) };
        },
        verifySignature(body: Uint8Array, signature: string | null): boolean {
            return verifySignature(secrets, body, signature);
        },
        readTools(): ToolSet {
            return {
                ...createReadTools(app),
                ...createRepositoryTools(app),
                ...createPullRequestTools(app),
            };
        },
        writeTools(toolsOptions?: GithubWriteToolsOptions): ToolSet {
            const mergeMethod = resolveMergeMethod(toolsOptions?.mergeMethod);
            return { ...createWriteTools(app), ...createPullRequestWriteTools(app, { mergeMethod }) };
        },
    };
    return app;
}
