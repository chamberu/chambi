/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { ToolSet } from 'ai';
import type { IClock } from '@chamvi/core';
import type { PaginatedOctokit } from './helpers.ts';

export type GithubAppOptions = {
    appId: string | number;
    /** PEM (PKCS#1 or PKCS#8); literal "\n" sequences become newlines. */
    privateKey: string;
    /** Several during a secret rotation; a delivery verifies under any. */
    webhookSecret: string | readonly string[];
    /** For runs not started by a delivery (cron, http, mcp) and comments on their behalf. */
    installationId?: number;
    /** The App's slug; skips `GET /app` for the bot login. */
    slug?: string;
    /** Default DEFAULT_GITHUB_API_URL ('https://api.github.com'). */
    baseUrl?: string;
    clock?: IClock;
    fetch?: typeof globalThis.fetch;
    /** Opt in to file proposals, limited to these repositories and repository-relative globs. */
    proposals?: GithubProposalsOptions;
};

/** The allowlist for `github_propose_change`; `.github/**` is always forbidden. */
export type GithubProposalsOptions = {
    repos: Record<string, { paths: readonly string[] }>;
};

/** An Octokit (`@octokit/core` with `paginate`). */
export type GithubOctokit = InstanceType<typeof PaginatedOctokit>;

/** GitHub App permissions of a token, e.g. `{ contents: 'write', workflows: 'write' }`. */
export type GithubPermissions = Record<string, 'read' | 'write'>;

/** A short-lived token of one repository (`IGithubApp.repositoryToken`). */
export type GithubRepositoryToken = {
    token: string;
    expiresAt: Date;
};

/** The App's bot as a git commit identity. */
export type GithubBotIdentity = {
    /** `<slug>[bot]`. */
    name: string;
    /** `<bot user id>+<slug>[bot]@users.noreply.github.com`, which GitHub links to the bot. */
    email: string;
};

/** An installation of the App (`IGithubApp.installations()`). */
export type GithubInstallation = {
    id: number;
    /** The account login, e.g. `tada5hi` or an org. */
    account: string;
    /** `User` or `Organization`. */
    accountType: string;
    repositorySelection: 'all' | 'selected';
    permissions: GithubPermissions;
    /** Whether the account suspended the App (`suspended_at` set): its token exchange answers 403. */
    suspended: boolean;
};

/** A merge method of `github_merge_pull_request`. */
export type GithubMergeMethod = 'merge' | 'squash' | 'rebase';

/** Options of `IGithubApp.writeTools()`. */
export type GithubWriteToolsOptions = {
    /** The merge method when a call names none (default DEFAULT_MERGE_METHOD, `squash`). */
    mergeMethod?: GithubMergeMethod;
};

export interface IGithubApp {
    readonly appId: string;
    readonly installationId?: number;
    /** An Octokit authenticated as the installation (cached token). */
    octokit(installationId: number): Promise<GithubOctokit>;
    /** `<slug>[bot]`, from `slug` or one `GET /app`; cached, single-flight. */
    botLogin(): Promise<string>;
    /**
     * The bot as a commit identity (`GET /users/<login>` for its user id,
     * once; a failure is not cached), e.g. the workspace manager's `author`.
     */
    botIdentity(): Promise<GithubBotIdentity>;
    /**
     * A token limited to one repository and `permissions` (the deferred
     * scoped token of plan 014): the App's installation on the repository
     * (`GET /repos/{owner}/{repo}/installation`), then an exchange with
     * `repositories: [repo]`. Cached per repository and permissions until 5
     * minutes before it expires, concurrent callers share one exchange, a
     * failure is not cached. Undefined when the App is not installed there.
     */
    repositoryToken(target: { owner: string; repo: string }, options: { permissions: GithubPermissions }): Promise<GithubRepositoryToken | undefined>;
    /**
     * The App's installation on the repository (App JWT `GET
     * /repos/{owner}/{repo}/installation`), cached per lower-cased
     * `owner/repo` for INSTALLATION_CACHE_TTL_MS on the clock; concurrent
     * callers share one lookup. Undefined (not cached) when the App is not
     * installed there; a failure is a `github_request` ChamviError and not
     * cached.
     */
    installationFor(target: { owner: string; repo: string }): Promise<number | undefined>;
    /**
     * The whole installation `installationFor()` looked up (account,
     * permissions), from the same cache; undefined where the App is not
     * installed.
     */
    repositoryInstallation(target: { owner: string; repo: string }): Promise<GithubInstallation | undefined>;
    /** Every installation of the App (`GET /app/installations`, paginated), not cached. */
    installations(): Promise<GithubInstallation[]>;
    /** `sha256=<hex>` of the raw body under any webhook secret, compared in constant time. */
    verifySignature(body: Uint8Array, signature: string | null): boolean;
    /**
     * The read-only tools (`github_get_issue`, `github_search_issues`,
     * `github_list_pull_requests`, ...), each acting as the installation of
     * the repository it names.
     */
    readTools(): ToolSet;
    /**
     * The write tools (`github_add_labels`, `github_create_comment`,
     * `github_close_issue`, `github_create_issue`,
     * `github_create_pull_request`, `github_merge_pull_request`), effect
     * tools applied at most once per run. An unknown `mergeMethod` is an
     * InvalidAgentDefinitionError.
     */
    writeTools(options?: GithubWriteToolsOptions): ToolSet;
}
