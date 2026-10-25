/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

export type GitAccess = 'read' | 'write';

/** What a credential source is asked: one repository (or, with an empty `path`, its host) and an access. */
export type GitCredentialRequest = {
    /** The normalized repository URL (`https://host/owner/name.git`), or `https://host/` for the host itself. */
    url: string;
    /** Lower case, with the port when the URL names one. */
    host: string;
    /** Without leading or trailing `/` and without `.git`, e.g. `owner/name`; empty for the host itself. */
    path: string;
    access: GitAccess;
    runId: string;
    signal?: AbortSignal;
};

/** HTTP basic credentials for git; `expiresAt` for a short-lived token (refreshed before it runs out). */
export type GitCredential = {
    username: string;
    password: string;
    expiresAt?: Date;
};

/**
 * A source of git credentials. `get` answers credentials for the
 * repository, or `undefined` to try the next source (none: anonymous).
 */
export interface IGitCredentials {
    get(input: GitCredentialRequest): Promise<GitCredential | undefined>;
}

/** One token of `staticGitCredentials()`. */
export type StaticGitCredential = {
    /** The host, e.g. `github.com` or `gitlab.example.com:8443`. */
    host: string;
    /** An owner, group or repository prefix (whole segments, case-insensitive), e.g. `octo` or `octo/demo`; default the whole host. */
    path?: string;
    /** Default `oauth2` on a host whose name contains `gitlab`, else `x-access-token` (GitHub). */
    username?: string;
    token: string;
};

/**
 * How a token reaches git: `workspace` installs a credential helper and a
 * 0600 credentials file in the workspace, so plain git in `bash` works;
 * `tools` keeps every credential out of the workspace and only chamvi's git
 * tools authenticate.
 */
export type CredentialMode = 'workspace' | 'tools';

/** Replaces issued credentials with `REDACTED`. */
export type Redactor = {
    add(secret: string): void;
    redact(text: string): string;
    /** The same bytes when they hold no secret. */
    redactBytes(bytes: Uint8Array): Uint8Array;
    /** The same error when its message holds no secret, else a SandboxError with the redacted message and no cause. */
    redactError(error: unknown): unknown;
};
