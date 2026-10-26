/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { SandboxError, ValidationError, systemClock } from '@chamvi/core';
import type { IClock } from '@chamvi/core';
import { isObject } from 'smob';
import { REDACTED, REDACT_GRACE_MS, REDACT_MIN_LENGTH } from './constants.ts';
import type {
    GitAccess,
    GitCredential,
    GitCredentialRequest,
    IGitCredentials,
    RedactedSpan,
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

/**
 * A redactor over the secrets added to it (each at least `REDACT_MIN_LENGTH`
 * characters); one added with an `expiresAt` is forgotten `REDACT_GRACE_MS`
 * after it on `clock`, checked on every call.
 */
export function createRedactor(options: { clock?: IClock } = {}): Redactor {
    const clock = options.clock ?? systemClock;
    /** Longest first, so a secret containing another is replaced whole. */
    let secrets: string[] = [];
    const encoded = new Map<string, Buffer>();
    /** Epoch ms after which a secret is dropped; undefined keeps it. */
    const dropAt = new Map<string, number | undefined>();
    const replacement = Buffer.from(REDACTED);

    const prune = (): void => {
        const now = clock.now().getTime();
        let dropped = false;
        for (const [secret, at] of dropAt) {
            if (at !== undefined && now >= at) {
                dropAt.delete(secret);
                encoded.delete(secret);
                dropped = true;
            }
        }
        if (dropped) secrets = secrets.filter((secret) => encoded.has(secret));
    };

    const redactedSpans = (text: string): RedactedSpan[] => {
        prune();
        const spans: RedactedSpan[] = [];
        // longest first: a secret inside a longer one is covered by it
        for (const secret of secrets) {
            for (let at = text.indexOf(secret); at !== -1; at = text.indexOf(secret, at + 1)) {
                const end = at + secret.length;
                if (spans.some((span) => at < span.end && span.start < end)) continue;
                spans.push({ start: at, end });
                at = end - 1;
            }
        }
        return spans.sort((a, b) => a.start - b.start);
    };

    const redact = (text: string): string => {
        const spans = redactedSpans(text);
        if (spans.length === 0) return text;
        let result = '';
        let from = 0;
        for (const span of spans) {
            result += `${text.slice(from, span.start)}${REDACTED}`;
            from = span.end;
        }
        return result + text.slice(from);
    };

    return {
        add(secret, expiresAt) {
            prune();
            if (typeof secret !== 'string' || secret.length < REDACT_MIN_LENGTH) return;
            const at = expiresAt instanceof Date ? expiresAt.getTime() + REDACT_GRACE_MS : undefined;
            if (encoded.has(secret)) {
                const current = dropAt.get(secret);
                // no expiry wins, else the later one
                if (current !== undefined) dropAt.set(secret, at === undefined ? undefined : Math.max(current, at));
                return;
            }
            encoded.set(secret, Buffer.from(secret));
            dropAt.set(secret, at);
            secrets = [...secrets, secret].sort((a, b) => b.length - a.length);
        },
        redact,
        redactedSpans,
        redactBytes(bytes) {
            prune();
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
