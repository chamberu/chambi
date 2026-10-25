/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { SandboxError, ValidationError } from '@chamvi/core';
import { isObject } from 'smob';
import { REDACTED, REDACT_MIN_LENGTH } from './constants.ts';
import type {
    GitAccess,
    GitCredential,
    GitCredentialRequest,
    IGitCredentials,
    Redactor,
} from './types.ts';

/** NUL, CR, LF and tab: git's credential protocol and the credentials file are line and tab based. */
const UNSAFE_CREDENTIAL = /[\0\r\n\t]/;

/** True for a non-empty string git's credential protocol can carry. */
export function isCredentialValue(value: unknown): value is string {
    return typeof value === 'string' && value.length > 0 && !UNSAFE_CREDENTIAL.test(value);
}

/** A repository path without leading or trailing `/` and without `.git`. */
export function trimRepoPath(path: string): string {
    return path.replace(/^\/+/, '').replace(/\/+$/, '').replace(/\.git$/, '');
}

/**
 * A URL pathname decoded as git's credential helpers see it.
 * ValidationError for a malformed percent escape (never echoing it).
 */
export function decodeRepoPath(pathname: string): string {
    try {
        return decodeURIComponent(pathname);
    } catch {
        throw new ValidationError('repo has a malformed percent escape in its path (a % not followed by two hex digits of UTF-8).');
    }
}

/** The request for `url` (a normalized https repository URL, or `https://host/`). */
export function credentialRequest(url: string, access: GitAccess, runId: string, signal?: AbortSignal): GitCredentialRequest {
    const parsed = new URL(url);
    const request: GitCredentialRequest = {
        url: parsed.href,
        host: parsed.host.toLowerCase(),
        path: trimRepoPath(decodeRepoPath(parsed.pathname)),
        access,
        runId,
    };
    if (signal) request.signal = signal;
    return request;
}

/**
 * The first credential the sources answer for `request`, else undefined.
 * SandboxError for a failing source (naming the repository) and for an
 * answer git cannot carry (never echoing it).
 */
export async function resolveGitCredential(
    sources: readonly IGitCredentials[],
    request: GitCredentialRequest,
): Promise<GitCredential | undefined> {
    for (const source of sources) {
        let answer: GitCredential | undefined;
        try {
            answer = await source.get(request);
        } catch (error) {
            if (error instanceof SandboxError) throw error;
            const message = error instanceof Error ? error.message : String(error);
            throw new SandboxError(`git credential lookup for ${request.url} failed: ${message}`, { cause: error });
        }
        if (answer === undefined) continue;
        if (!isObject(answer) || !isCredentialValue(answer.username) || !isCredentialValue(answer.password) ||
            (answer.expiresAt !== undefined && !(answer.expiresAt instanceof Date && Number.isFinite(answer.expiresAt.getTime())))) {
            throw new SandboxError(`a git credential source answered ${request.url} with no usable credential ` +
                '(username and password must be non-empty strings without NUL, CR, LF or tab; expiresAt a Date).');
        }
        const credential: GitCredential = { username: answer.username, password: answer.password };
        if (answer.expiresAt) credential.expiresAt = answer.expiresAt;
        return credential;
    }
    return undefined;
}

/** A redactor over the secrets added to it (each at least `REDACT_MIN_LENGTH` characters). */
export function createRedactor(): Redactor {
    /** Longest first, so a secret containing another is replaced whole. */
    let secrets: string[] = [];
    const encoded = new Map<string, Buffer>();
    const replacement = Buffer.from(REDACTED);

    const redact = (text: string): string => {
        let result = text;
        for (const secret of secrets) {
            if (result.includes(secret)) result = result.replaceAll(secret, REDACTED);
        }
        return result;
    };

    return {
        add(secret) {
            if (typeof secret !== 'string' || secret.length < REDACT_MIN_LENGTH || encoded.has(secret)) return;
            encoded.set(secret, Buffer.from(secret));
            secrets = [...secrets, secret].sort((a, b) => b.length - a.length);
        },
        redact,
        redactBytes(bytes) {
            let buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
            let changed = false;
            for (const secret of secrets) {
                const needle = encoded.get(secret)!;
                let at = buffer.indexOf(needle);
                if (at === -1) continue;
                const parts: Buffer[] = [];
                let from = 0;
                while (at !== -1) {
                    parts.push(buffer.subarray(from, at), replacement);
                    from = at + needle.length;
                    at = buffer.indexOf(needle, from);
                }
                parts.push(buffer.subarray(from));
                buffer = Buffer.concat(parts);
                changed = true;
            }
            return changed ? new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength) : bytes;
        },
        redactError(error) {
            const message = error instanceof Error ? error.message : String(error);
            const redacted = redact(message);
            if (redacted === message && error instanceof Error) return error;
            return new SandboxError(redacted);
        },
    };
}
