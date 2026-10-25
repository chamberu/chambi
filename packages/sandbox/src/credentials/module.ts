/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { InvalidAgentDefinitionError } from '@chamvi/core';
import { isCredentialValue, trimRepoPath } from './helpers.ts';
import type {
    GitCredential,
    GitCredentialRequest,
    IGitCredentials,
    StaticGitCredential,
} from './types.ts';

/** A host as `URL.host` spells it: letters, digits, `.`, `-`, an optional port. */
const HOST_PATTERN = /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:\d{1,5})?$/;

/** One path segment: no `.` or `..`, no whitespace or control character. */
const SEGMENT_PATTERN = /^[^\s/\0]+$/;

type Entry = { host: string; segments: string[]; credential: GitCredential };

function defaultUsername(host: string): string {
    return host.includes('gitlab') ? 'oauth2' : 'x-access-token';
}

function toEntry(input: unknown, index: number): Entry {
    const fail = (rule: string) => new InvalidAgentDefinitionError(`staticGitCredentials() entry ${index}: ${rule}`);
    if (typeof input !== 'object' || input === null || Array.isArray(input)) throw fail('must be an object { host, path?, username?, token }.');
    const entry = input as Partial<StaticGitCredential>;
    const host = typeof entry.host === 'string' ? entry.host.toLowerCase() : '';
    if (!HOST_PATTERN.test(host)) throw fail('host must be a host name like "github.com", with an optional port.');
    if (!isCredentialValue(entry.token)) throw fail('token must be a non-empty string without NUL, CR, LF or tab.');
    if (entry.username !== undefined && !isCredentialValue(entry.username)) {
        throw fail('username must be a non-empty string without NUL, CR, LF or tab.');
    }
    let segments: string[] = [];
    if (entry.path !== undefined) {
        const path = typeof entry.path === 'string' ? trimRepoPath(entry.path) : '';
        segments = path === '' ? [] : path.split('/');
        if (segments.length === 0 || segments.some((s) => !SEGMENT_PATTERN.test(s) || s === '.' || s === '..')) {
            throw fail('path must be an owner, group or repository like "octo" or "octo/demo".');
        }
    }
    return {
        host,
        segments,
        credential: { username: entry.username ?? defaultUsername(host), password: entry.token },
    };
}

/**
 * Credentials from tokens the operator hands over: GitHub personal access
 * tokens (`x-access-token`), GitLab personal, project or deploy tokens
 * (`oauth2`), any https host. A request matches an entry of its host
 * (case-insensitive) whose `path` is a prefix of the repository path in
 * whole segments (no `path`: every repository and the host itself); the
 * longest `path` wins. InvalidAgentDefinitionError for a malformed entry,
 * never echoing a token.
 */
export function staticGitCredentials(entries: readonly StaticGitCredential[]): IGitCredentials {
    if (!Array.isArray(entries)) {
        throw new InvalidAgentDefinitionError('staticGitCredentials() needs a list of { host, path?, username?, token }.');
    }
    const list = entries.map(toEntry).sort((a, b) => b.segments.length - a.segments.length);

    return {
        async get(request: GitCredentialRequest) {
            const path = request.path === '' ? [] : request.path.split('/');
            const match = list.find((entry) => entry.host === request.host &&
                entry.segments.length <= path.length &&
                entry.segments.every((segment, i) => segment === path[i]));
            return match ? { ...match.credential } : undefined;
        },
    };
}
