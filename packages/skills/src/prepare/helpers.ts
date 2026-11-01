/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { dirname, resolve } from 'node:path';
import { ChamviError, InvalidAgentDefinitionError } from '@chamvi/core';
import { GitCloneError, parseSource } from 'skills';
import { SKILL_PREPARATION_FAILED_ERROR_CODE, SKILL_PREPARATION_LOCKED_ERROR_CODE } from './constants.ts';
import type { PrepareSkillsOptions } from './types.ts';

// eslint-disable-next-line no-control-regex
const controls = /[\x00-\x1f\x7f]/u;

export function invalid(): never {
    throw new InvalidAgentDefinitionError('Cannot prepare skills: invalid configuration, source, verification or managed directory.');
}

// git's answers for a repository that is not there (deterministic, unlike a network failure)
const missingSource = /repository .* not found|does not appear to be a git repository|does not exist|returned error: 404|unsupported git transport/iu;

// The SDK clones `--branch <sha>`, which always fails with a missing-ref answer, then fetches the sha
// and swallows that fetch's failure (a network failure as much as a missing commit): never configuration.
const missingRef = /remote branch .* not found in upstream origin|couldn't find remote ref|upload-pack: not our ref/iu;

/** A retryable failure: generic, since SDK and git messages can hold credentials or private content. */
export function unavailable(): never {
    throw new ChamviError({
        code: SKILL_PREPARATION_FAILED_ERROR_CODE,
        message: 'Cannot prepare skills: the source could not be fetched or the managed directory could not be written; the preparation can be retried.',
    });
}

export function locked(guard: string): never {
    throw new ChamviError({
        code: SKILL_PREPARATION_LOCKED_ERROR_CODE,
        message: `Cannot prepare skills: another preparation holds the guard ${guard}. ` +
            'A guard whose process is gone (on this host) or older than the stale bound is recovered on the next attempt.',
    });
}

/**
 * Maps a preparation failure to the configuration error (`invalid()`: a check
 * refused the input, an authentication failure, a missing repository), the
 * lock error, or else a retryable failure (`unavailable()`): a pinned commit
 * the SDK could not fetch is retryable, since its answer hides the cause.
 */
export function toPreparationError(error: unknown): never {
    if (error instanceof ChamviError && error.code === SKILL_PREPARATION_LOCKED_ERROR_CODE) {
        throw error;
    }

    if (error instanceof InvalidAgentDefinitionError) {
        invalid();
    }

    if (error instanceof GitCloneError) {
        const isMissingSource = !error.isTimeout && !missingRef.test(error.message) && missingSource.test(error.message);

        if (error.isAuthError || isMissingSource) {
            invalid();
        }
    }

    return unavailable();
}

export function copyPreparationOptions(options: PrepareSkillsOptions) {
    if (!options) {
        invalid();
    }

    if (typeof options.source !== 'string' || !options.source.trim() || controls.test(options.source)) {
        invalid();
    }

    if (typeof options.revision !== 'string' || !/^[a-f0-9]{40}$/iu.test(options.revision)) {
        invalid();
    }

    if (!Array.isArray(options.names) || !options.names.length) {
        invalid();
    }

    if (typeof options.directory !== 'string' || !options.directory.trim() || controls.test(options.directory)) {
        invalid();
    }

    if (options.verify !== undefined && typeof options.verify !== 'function') {
        invalid();
    }

    const {
        source,
        verify,
        signal,
    } = options;
    const revision = options.revision.toLowerCase();
    const names = [...options.names];

    for (const name of names) {
        if (typeof name !== 'string' || !/^[a-z][a-z0-9-]{0,63}$/u.test(name)) {
            invalid();
        }
    }

    if (new Set(names).size !== names.length) {
        invalid();
    }

    const requestedDirectory = resolve(options.directory);

    if (dirname(requestedDirectory) === requestedDirectory) {
        invalid();
    }

    try {
        const parsed = parseSource(source);

        if (!['local', 'git', 'github', 'gitlab'].includes(parsed.type)) {
            invalid();
        }

        if (parsed.ref || parsed.skillFilter || /^ext::/iu.test(parsed.url)) {
            invalid();
        }

        return {
            source,
            revision,
            names,
            requestedDirectory,
            verify,
            signal,
            parsed,
        };
    } catch {
        return invalid();
    }
}

/** Whether `error` is the caller's own cancellation: its abort reason, or an `ABORT_ERR` caused by it. */
export function isCancellation(error: unknown, signal: AbortSignal | undefined): boolean {
    if (!signal?.aborted) {
        return false;
    }

    if (error === signal.reason) {
        return true;
    }

    return Error.isError(error) && 'code' in error && error.code === 'ABORT_ERR' && error.cause === signal.reason;
}
