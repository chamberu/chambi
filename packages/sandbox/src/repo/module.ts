/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { SandboxError, ValidationError, systemClock } from '@chamvi/core';
import type { IClock } from '@chamvi/core';
import { delay } from '../clock/module.ts';
import { EXEC_TIMEOUT_MS } from '../workspace/constants.ts';
import type { IWorkspace } from '../workspace/types.ts';
import {
    CHECKOUT_DEFAULT_BRANCH_KEY,
    CHECKOUT_KEY,
    CHECKOUT_READ_ATTEMPTS,
    CHECKOUT_READ_RETRY_MS,
    CHECKOUT_READ_TIMEOUT_MS,
    CHECKOUT_STDERR_MAX_LENGTH,
    COMMIT_PATTERN,
    GITHUB_SHORTHAND_PATTERN,
    GITHUB_URL,
    NO_REPO_CHECKOUT,
    REPO_RULE,
} from './constants.ts';
import { REDACTED, REDACT_MIN_LENGTH } from '../credentials/constants.ts';
import { decodeRepoPath } from '../credentials/helpers.ts';
import { CREDENTIAL_HELPER_SCRIPT, INSTALL_CREDENTIALS_SCRIPT } from '../git/constants.ts';
import { credentialKey, credentialsFileContent } from '../git/helpers.ts';
import {
    hasUnsafeCharacter,
    isGitRef,
    isNormalizedRepo,
    parseDefaultBranch,
    parseUrl,
} from './helpers.ts';
import type { CheckoutOptions, NormalizeRepoOptions } from './types.ts';

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

        if (name === '.' || name === '..') {
            throw new ValidationError(REPO_RULE);
        }

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

            // credential lookups decode the path: a malformed escape is refused here
            decodeRepoPath(url.pathname);
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
    if (!isGitRef(ref)) {
        throw new ValidationError('ref must be a branch, tag or commit name (letters, digits and . _ / + -, starting with a letter or digit, at most 255 characters).');
    }
}

/**
 * Runs the checkout inside `workspace` through its own exec: `git init`,
 * the remote `origin`, the default branch from the remote's HEAD
 * (`ls-remote --symref`), one fetch of `ref` (default: the default branch)
 * and the default branch, with full history unless `depth` is given; a
 * branch is checked out as a local branch tracking `origin/<ref>`, a tag or
 * commit detached. With a `credential` for an https repository, the
 * workspace credential helper is installed first (`INSTALL_CREDENTIALS_SCRIPT`,
 * the credential over stdin only), so `ls-remote`, the fetch and every later
 * git call of the workspace authenticate through it; without one (or for a
 * `file://` repository) every credential helper is reset for the remote
 * calls. Hooks are off for the remote calls either way. Records the default branch, then, as the last
 * step, the end of the checkout as `git config chamvi.checkout` (the commit,
 * `none` for a repo-less workspace; `readCheckout`). Returns HEAD and the
 * default branch.
 * ValidationError before any exec for a bad ref (or a ref without a repo)
 * or depth; SandboxError with git's stderr when a step fails. The caller
 * disposes the workspace on failure.
 */
export async function prepareWorkspace(
    workspace: IWorkspace,
    input: CheckoutOptions & {
        repo?: string;
        ref?: string;
        signal?: AbortSignal;
    },
): Promise<{ commit?: string; defaultBranch?: string }> {
    const {
        repo,
        ref,
        depth,
        credential,
        signal,
    } = input;

    if (repo === undefined && ref !== undefined) {
        throw new ValidationError('ref needs a repo.');
    }

    if (repo !== undefined && !isNormalizedRepo(repo)) {
        throw new ValidationError('repo must be a normalized https or file URL (see normalizeRepo).');
    }

    if (ref !== undefined) {
        assertGitRef(ref);
    }

    if (depth !== undefined && (!Number.isSafeInteger(depth) || depth < 1)) {
        throw new ValidationError('depth must be an integer of at least 1.');
    }

    // the credential never reaches a message, also when git or a script echoes it
    const secret = repo !== undefined && repo.startsWith('https://') && credential ? credential.password : undefined;
    const redact = (text: string) => (secret && secret.length >= REDACT_MIN_LENGTH ? text.split(secret).join(REDACTED) : text);
    const fail = (what: string, result: {
        exitCode: number;
        timedOut: boolean;
        stderr: string
    }) => {
        const reason = result.timedOut ? 'timed out' : `exited with ${result.exitCode}`;
        const stderr = redact(result.stderr.trim()).slice(0, CHECKOUT_STDERR_MAX_LENGTH);

        return new SandboxError(`checkout failed: ${what} ${reason}${stderr ? `: ${stderr}` : ''}`);
    };
    const exec = async (argv: string[], stdin?: string) => {
        try {
            return await workspace.exec(argv, {
                stdin,
                timeoutMs: EXEC_TIMEOUT_MS,
                signal,
            });
        } catch (error) {
            const message = Error.isError(error) ? error.message : String(error);

            if (redact(message) !== message) {
                throw new SandboxError(redact(message));
            }

            throw error;
        }
    };
    const step = async (name: string, argv: string[], allowFailure = false) => {
        const result = await exec(argv);

        if ((result.exitCode !== 0 && !allowFailure) || result.timedOut) {
            throw fail(`git ${name}`, result);
        }

        return result;
    };
    // with a credential the installed helper answers, so it is not reset
    const remoteGit = secret ?
        ['git', '-c', 'core.hooksPath=/dev/null'] :
        ['git', '-c', 'credential.helper=', '-c', 'core.hooksPath=/dev/null'];
    const remoteStep = (name: string, args: string[]) => step(name, [...remoteGit, ...args]);

    await step('init', ['git', 'init', '-q', '.']);

    if (repo === undefined) {
        // the last step (see below)
        await step('config', ['git', 'config', CHECKOUT_KEY, NO_REPO_CHECKOUT]);

        return {};
    }

    await step('remote', ['git', 'remote', 'add', 'origin', repo]);

    if (secret) {
        const content = credentialsFileContent([{ key: credentialKey(repo), ...credential! }]);
        const result = await exec(
            ['sh', '-c', INSTALL_CREDENTIALS_SCRIPT, 'sh', CREDENTIAL_HELPER_SCRIPT, String(Buffer.byteLength(content))],
            content,
        );

        if (result.exitCode !== 0 || result.timedOut) {
            throw fail('installing the git credential', result);
        }
    }

    const announced = parseDefaultBranch((await remoteStep('ls-remote', ['ls-remote', '--symref', repo, 'HEAD'])).stdout);
    // a name git would refuse (or read as an option) is no default branch
    const defaultBranch = announced !== undefined && isGitRef(announced) ? announced : undefined;
    const target = ref ?? defaultBranch;
    const refs = target === undefined ? ['HEAD'] : [target];

    if (defaultBranch !== undefined && defaultBranch !== target) {
        refs.push(defaultBranch);
    }

    await remoteStep('fetch', ['fetch', '-q', ...(depth === undefined ? [] : ['--depth', String(depth)]), 'origin', ...refs]);

    const isBranch = target !== undefined &&
        (await step('rev-parse', ['git', 'rev-parse', '-q', '--verify', `refs/remotes/origin/${target}`], true)).exitCode === 0;

    await step('checkout', isBranch ?
        ['git', 'checkout', '-q', '-B', target, '--track', `origin/${target}`] :
        ['git', '-c', 'advice.detachedHead=false', 'checkout', '-q', 'FETCH_HEAD']);

    const commit = (await step('rev-parse', ['git', 'rev-parse', 'HEAD'])).stdout.trim();

    if (!COMMIT_PATTERN.test(commit)) {
        throw new SandboxError('checkout failed: git rev-parse printed no commit.');
    }

    if (defaultBranch !== undefined) {
        await step('config', ['git', 'config', CHECKOUT_DEFAULT_BRANCH_KEY, defaultBranch]);
    }

    // the last step, recorded with the workspace: a provider's find skips a
    // workspace without it (a create that died before here) and rebuilds
    // info.commit and info.defaultBranch from it
    await step('config', ['git', 'config', CHECKOUT_KEY, commit]);

    return defaultBranch === undefined ? { commit } : { commit, defaultBranch };
}

/**
 * The checkout `prepareWorkspace` finished in `workspace`, read back from its
 * git config: `{ commit, defaultBranch? }` for a workspace of a repository
 * (`chamvi.checkout`, `chamvi.defaultBranch`, the latter left out when
 * missing or invalid), `{}` for a repo-less one. Undefined when the record
 * `chamvi.checkout` is missing (a create that died before its checkout
 * finished, e.g. a process killed during the fetch: git exits 1) or does not
 * fit `workspace.info.repo`: such a workspace is not found again. A read that
 * fails otherwise (the exec throws, another exit code, a timeout; a container
 * restarted a moment ago) is retried on `clock` every `CHECKOUT_READ_RETRY_MS`,
 * at most `CHECKOUT_READ_ATTEMPTS` reads, then undefined too.
 */
export async function readCheckout(
    workspace: IWorkspace,
    signal?: AbortSignal,
    clock: IClock = systemClock,
): Promise<{ commit?: string; defaultBranch?: string } | undefined> {
    let stdout: string | undefined;

    for (let attempt = 1; stdout === undefined; attempt++) {
        try {
            const result = await workspace.exec(['git', 'config', '--get-regexp', '^chamvi\\.'], { timeoutMs: CHECKOUT_READ_TIMEOUT_MS, signal });

            // exit 1 without output: no record, a create that died before its checkout finished
            if (result.exitCode === 1 && !result.timedOut && result.stdout.trim() === '') {
                return undefined;
            }

            if (result.exitCode === 0 && !result.timedOut) {
                ({ stdout } = result);
            }
        } catch {
            // the exec itself failed: read again below
        }

        if (stdout !== undefined) {
            break;
        }

        if (attempt >= CHECKOUT_READ_ATTEMPTS || signal?.aborted) {
            return undefined;
        }

        try {
            await delay(clock, CHECKOUT_READ_RETRY_MS, signal, () => new SandboxError('checkout read aborted'));
        } catch {
            return undefined;
        }
    }

    let checkout: string | undefined;
    let defaultBranch: string | undefined;

    for (const line of stdout.split('\n')) {
        const space = line.indexOf(' ');

        if (space < 0) {
            continue;
        }

        // git prints the variable names lower-cased
        const key = line.slice(0, space);
        const value = line.slice(space + 1).trim();

        if (key === CHECKOUT_KEY) {
            checkout = value;
        }

        if (key === CHECKOUT_DEFAULT_BRANCH_KEY.toLowerCase() && isGitRef(value)) {
            defaultBranch = value;
        }
    }

    if (checkout === undefined) {
        return undefined;
    }

    if (workspace.info.repo === undefined) {
        return checkout === NO_REPO_CHECKOUT ? {} : undefined;
    }

    if (!COMMIT_PATTERN.test(checkout)) {
        return undefined;
    }

    return defaultBranch === undefined ? { commit: checkout } : { commit: checkout, defaultBranch };
}
