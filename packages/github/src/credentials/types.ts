/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { GithubPermissions } from '../app/types.ts';

/**
 * What a git credential source is asked (structurally the
 * `GitCredentialRequest` of `@chamvi/sandbox`, which this package does not
 * depend on).
 */
export type GithubGitCredentialRequest = {
    url: string;
    /** Lower case, with the port when the URL names one. */
    host: string;
    /** `owner/name`; empty for the host itself. */
    path: string;
    access: 'read' | 'write';
    runId: string;
    signal?: AbortSignal;
};

/** Structurally `@chamvi/sandbox`'s `GitCredential`. */
export type GithubGitCredential = {
    username: string;
    password: string;
    expiresAt?: Date;
};

/** Structurally `@chamvi/sandbox`'s `IGitCredentials`: pass it as the workspace manager's `credentials`. */
export interface IGithubGitCredentials {
    get(input: GithubGitCredentialRequest): Promise<GithubGitCredential | undefined>;
}

export type GithubAppCredentialsOptions = {
    /**
     * Added to write tokens (`contents: write` always), e.g.
     * `{ workflows: 'write' }` to push changes under `.github/workflows`.
     */
    permissions?: GithubPermissions;
    /** The git host the App serves; default `github.com` (a GitHub Enterprise Server host otherwise). */
    host?: string;
};
