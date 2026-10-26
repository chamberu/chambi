/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { REF_PATTERN } from './constants.ts';

/** True for a branch, tag or commit name `assertGitRef` accepts. */
export function isGitRef(ref: unknown): ref is string {
    return typeof ref === 'string' &&
        REF_PATTERN.test(ref) &&
        !ref.includes('..') &&
        !ref.includes('//') &&
        !ref.includes('@{') &&
        !ref.includes('/.') &&
        !ref.endsWith('/') &&
        !ref.endsWith('.') &&
        !ref.endsWith('.lock');
}

/** The default branch from `git ls-remote --symref <url> HEAD` output, else undefined. */
export function parseDefaultBranch(output: string): string | undefined {
    return /^ref: refs\/heads\/(\S+)\tHEAD$/m.exec(output)?.[1];
}

export function parseUrl(input: string): URL | undefined {
    try {
        return new URL(input);
    } catch {
        return undefined;
    }
}

/**
 * Whether `repo` has the shape `normalizeRepo` returns: an https or
 * `file:///` URL without credentials, query, fragment or whitespace, so it
 * can neither be read as a git option nor leak a token through git's stderr.
 */
export function isNormalizedRepo(repo: unknown): boolean {
    if (typeof repo !== 'string' || hasUnsafeCharacter(repo)) return false;
    if (!repo.startsWith('https://') && !repo.startsWith('file:///')) return false;
    const url = parseUrl(repo);
    return !!url &&
        url.username === '' &&
        url.password === '' &&
        !repo.includes('?') &&
        !repo.includes('#');
}

/** Whitespace or a control character, which the URL parser would silently strip. */
export function hasUnsafeCharacter(input: string): boolean {
    for (let i = 0; i < input.length; i++) {
        const code = input.charCodeAt(i);
        if (code <= 0x20 || code === 0x7F) return true;
    }
    return false;
}
