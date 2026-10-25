/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { SandboxError, ValidationError } from '@chamvi/core';
import { EXEC_TIMEOUT_MS } from '../workspace/constants.ts';
import type { IWorkspace } from '../workspace/types.ts';
import {
    CHECKOUT_COMMIT_KEY,
    CHECKOUT_STDERR_MAX_LENGTH,
    COMMIT_PATTERN,
    COMMIT_READ_TIMEOUT_MS,
    GITHUB_SHORTHAND_PATTERN,
    GITHUB_URL,
    REF_PATTERN,
    REPO_RULE,
} from './constants.ts';
import {
    checkoutCommands,
    hasUnsafeCharacter,
    isNormalizedRepo,
    parseUrl,
} from './helpers.ts';
import type { NormalizeRepoOptions } from './types.ts';

/**
 * The clone URL of `input`: `owner/name` becomes
 * `https://github.com/owner/name.git`; an https URL without credentials,
 * query or fragment is kept; `file:///absolute/path` only with
 * `allowFileRepos`. ValidationError otherwise, never echoing the input
 * (it may carry a token).
 */
export function normalizeRepo(input: string, options: NormalizeRepoOptions = {}): string {
    if (typeof input !== 'string' || input.length === 0 || hasUnsafeCharacter(input)) {
        throw new ValidationError(REPO_RULE);
    }

    let normalized: string;
    if (GITHUB_SHORTHAND_PATTERN.test(input)) {
        const name = input.slice(input.indexOf('/') + 1);
        if (name === '.' || name === '..') throw new ValidationError(REPO_RULE);
        normalized = `${GITHUB_URL}/${input}${input.endsWith('.git') ? '' : '.git'}`;
    } else {
        const url = parseUrl(input);
        if (!url || input.includes('?') || input.includes('#') || url.username !== '' || url.password !== '') {
            throw new ValidationError(REPO_RULE);
        }
        if (url.protocol === 'https:') {
            if (url.hostname === '' || url.pathname === '/' || url.pathname === '') {
                throw new ValidationError(REPO_RULE);
            }
        } else if (url.protocol === 'file:' && options.allowFileRepos === true) {
            if (url.host !== '' || !input.startsWith('file:///')) {
                throw new ValidationError('A file repository must be file:///absolute/path.');
            }
        } else {
            throw new ValidationError(REPO_RULE);
        }
        normalized = url.href;
    }

    if (options.allowRepo && !options.allowRepo(normalized)) {
        throw new ValidationError('repository not allowed.');
    }
    return normalized;
}

/**
 * A branch, tag or commit name git cannot read as an option or a revision
 * range: `^[A-Za-z0-9][A-Za-z0-9._/+-]{0,254}$` without `..`, `//`, `@{`, a
 * component starting with `.`, a trailing `/` or `.`, or a `.lock` suffix.
 */
export function assertGitRef(ref: string): void {
    if (
        typeof ref !== 'string' ||
        !REF_PATTERN.test(ref) ||
        ref.includes('..') ||
        ref.includes('//') ||
        ref.includes('@{') ||
        ref.includes('/.') ||
        ref.endsWith('/') ||
        ref.endsWith('.') ||
        ref.endsWith('.lock')
    ) {
        throw new ValidationError('ref must be a branch, tag or commit name (letters, digits and . _ / + -, starting with a letter or digit, at most 255 characters).');
    }
}

/**
 * Runs the checkout inside `workspace` through its own exec: `git init`, and
 * with a repo a shallow fetch of `ref` (default HEAD) and a detached
 * checkout. Returns HEAD. ValidationError before any exec for a bad ref (or
 * a ref without a repo); SandboxError with git's stderr when a step fails.
 * The caller disposes the workspace on failure.
 */
export async function prepareWorkspace(
    workspace: IWorkspace,
    input: {
        repo?: string; 
        ref?: string; 
        signal?: AbortSignal 
    },
): Promise<{ commit?: string }> {
    const {
        repo, 
        ref, 
        signal, 
    } = input;
    if (repo === undefined && ref !== undefined) {
        throw new ValidationError('ref needs a repo.');
    }
    if (repo !== undefined && !isNormalizedRepo(repo)) {
        throw new ValidationError('repo must be a normalized https or file URL (see normalizeRepo).');
    }
    if (ref !== undefined) assertGitRef(ref);

    let stdout = '';
    for (const argv of checkoutCommands(repo, ref)) {
        const result = await workspace.exec(argv, { timeoutMs: EXEC_TIMEOUT_MS, signal });
        if (result.exitCode !== 0 || result.timedOut) {
            const reason = result.timedOut ? 'timed out' : `exited with ${result.exitCode}`;
            const stderr = result.stderr.trim().slice(0, CHECKOUT_STDERR_MAX_LENGTH);
            throw new SandboxError(`checkout failed: git ${argv[argv[1] === '-c' ? 3 : 1]} ${reason}${stderr ? `: ${stderr}` : ''}`);
        }
        ({ stdout } = result);
    }

    if (repo === undefined) return {};
    const commit = stdout.trim();
    if (!COMMIT_PATTERN.test(commit)) {
        throw new SandboxError('checkout failed: git rev-parse printed no commit.');
    }
    // recorded with the workspace, so a provider's find rebuilds info.commit
    const recorded = await workspace.exec(['git', 'config', CHECKOUT_COMMIT_KEY, commit], { timeoutMs: EXEC_TIMEOUT_MS, signal });
    if (recorded.exitCode !== 0 || recorded.timedOut) {
        throw new SandboxError(`checkout failed: git config ${recorded.timedOut ? 'timed out' : `exited with ${recorded.exitCode}`}`);
    }
    return { commit };
}

/**
 * The commit `prepareWorkspace` checked out, read back from the workspace's
 * git config (`chamvi.commit`); undefined for a repo-less workspace, one the
 * record was removed from, or a failed exec.
 */
export async function readCheckoutCommit(workspace: IWorkspace, signal?: AbortSignal): Promise<string | undefined> {
    try {
        const result = await workspace.exec(['git', 'config', '--get', CHECKOUT_COMMIT_KEY], { timeoutMs: COMMIT_READ_TIMEOUT_MS, signal });
        const commit = result.stdout.trim();
        return result.exitCode === 0 && COMMIT_PATTERN.test(commit) ? commit : undefined;
    } catch {
        return undefined;
    }
}
