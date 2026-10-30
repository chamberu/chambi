/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

/** A non-empty string without NUL. */
export function isName(value: unknown): boolean {
    return typeof value === 'string' && value.length > 0 && !value.includes('\0');
}

/** A deployment name: a Kubernetes label value that is not empty. */
export const DEPLOYMENT_PATTERN = /^[A-Za-z0-9]([-A-Za-z0-9_.]{0,61}[A-Za-z0-9])?$/;

/** Hex characters of a `repoKey()`. */
export const REPO_KEY_LENGTH = 32;

/** Epoch milliseconds from a label or annotation value; undefined when unreadable. */
export function readEpoch(value: string | undefined): number | undefined {
    if (typeof value !== 'string' || !/^\d+$/.test(value)) {
        return undefined;
    }

    const time = Number(value);

    return Number.isSafeInteger(time) ? time : undefined;
}
