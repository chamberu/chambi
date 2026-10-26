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
} from './helpers.ts';
import { toolError } from '../tools/helpers.ts';
import { createReadTools } from '../tools/read.ts';
import { GITHUB_REQUEST_ERROR_CODE } from '../tools/constants.ts';
import { createWriteTools } from '../tools/write.ts';
import { verifySignature } from '../webhook/helpers.ts';
import type {
    GithubAppOptions,
    GithubBotIdentity,
    GithubOctokit,
    GithubRepositoryToken,
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

    /** The installation id per lower-cased `owner/repo`, so a cached scoped token needs no lookup. */
    const installations = new Map<string, number>();
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
        async repositoryToken(target, tokenOptions): Promise<GithubRepositoryToken | undefined> {
            const { owner, repo } = target;
            const key = `${owner}/${repo}`.toLowerCase();
            let installation = installations.get(key);
            if (installation === undefined) {
                installation = await tokens.app().then((octokit) => octokit.request('GET /repos/{owner}/{repo}/installation', { owner, repo }))
                    .then(({ data }) => data.id, (error: unknown) => {
                        if ((error as { status?: number })?.status === 404) return undefined;
                        throw toolError(error);
                    });
                if (installation === undefined) return undefined;
                installations.set(key, installation);
            }
            const scoped = await tokens.repository(installation, repo, tokenOptions.permissions).catch((error: unknown) => {
                // the App may have been removed from the repository: look it up again next time
                installations.delete(key);
                throw toolError(error);
            });
            return { token: scoped.token, expiresAt: new Date(scoped.expiresAt) };
        },
        verifySignature(body: Uint8Array, signature: string | null): boolean {
            return verifySignature(secrets, body, signature);
        },
        readTools(): ToolSet {
            return createReadTools(app);
        },
        writeTools(): ToolSet {
            return createWriteTools(app);
        },
    };
    return app;
}
