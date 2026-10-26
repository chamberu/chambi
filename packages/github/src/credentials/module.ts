/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { InvalidAgentDefinitionError } from '@chamvi/core';
import { isObject } from 'smob';
import type { GithubPermissions, IGithubApp } from '../app/types.ts';
import { DEFAULT_GITHUB_GIT_HOST, GITHUB_TOKEN_USERNAME } from './constants.ts';
import type { GithubAppCredentialsOptions, IGithubGitCredentials } from './types.ts';

const HOST_PATTERN = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:\d{1,5})?$/;
const PERMISSION_PATTERN = /^[a-z][a-z_]*$/;

function assertPermissions(permissions: unknown): GithubPermissions {
    if (permissions === undefined) return {};
    if (!isObject(permissions) || Object.entries(permissions).some(([name, level]) => !PERMISSION_PATTERN.test(name) || (level !== 'read' && level !== 'write'))) {
        throw new InvalidAgentDefinitionError('githubAppCredentials() permissions must map permission names to "read" or "write", e.g. { workflows: "write" }.');
    }
    return permissions as GithubPermissions;
}

/**
 * Git credentials from the App for the workspace manager (`credentials`):
 * per repository a short-lived installation token scoped to that one
 * repository, `contents: read` for read, `contents: write` plus
 * `permissions` for write, cached by `IGithubApp.repositoryToken`.
 * Answers nothing (the next source, else anonymous) for another host, the
 * host itself, a path that is no `owner/name` and a repository the App is
 * not installed on. Typed structurally, so this package never depends on
 * `@chamvi/sandbox`.
 */
export function githubAppCredentials(app: IGithubApp, options: GithubAppCredentialsOptions = {}): IGithubGitCredentials {
    if (!isObject(app) || typeof app.repositoryToken !== 'function') {
        throw new InvalidAgentDefinitionError('githubAppCredentials() needs a GitHub App (createGithubApp()).');
    }
    if (!isObject(options)) {
        throw new InvalidAgentDefinitionError('githubAppCredentials() options must be an object.');
    }
    const extra = assertPermissions(options.permissions);
    const host = (options.host ?? DEFAULT_GITHUB_GIT_HOST).toLowerCase();
    if (!HOST_PATTERN.test(host)) {
        throw new InvalidAgentDefinitionError('githubAppCredentials() host must be a host name like "github.com".');
    }

    return {
        async get(input) {
            if (input.host !== host) return undefined;
            const segments = input.path.split('/');
            if (segments.length !== 2 || segments.some((segment) => segment.length === 0)) return undefined;
            const [owner, repo] = segments as [string, string];
            const permissions: GithubPermissions = input.access === 'write' ?
                { ...extra, contents: 'write' } :
                { contents: 'read' };
            const token = await app.repositoryToken({ owner, repo }, { permissions });
            if (!token) return undefined;
            return {
                username: GITHUB_TOKEN_USERNAME,
                password: token.token,
                expiresAt: token.expiresAt,
            };
        },
    };
}
