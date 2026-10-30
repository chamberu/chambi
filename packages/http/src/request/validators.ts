/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { isArtifactMediaType } from '@chamvi/core';
import { IssueCode, prefixIssuePath } from '@ebec/core';
import type { Issue } from '@ebec/core';
import {
    ValidupError,
    createValidupError,
    defineValidator,
    isValidupError,
} from 'validup';
import type { Container, ValidatorDescriptor } from 'validup';
import { boundReceived } from './helpers.ts';

/*
 * Every validator that fails on a value passes `boundReceived(value)` as the issue's received
 * value: a 400 never echoes a large input (up to `bodyLimit`) back.
 */

/** A string of `min` to `max` characters without U+0000 (which Postgres text columns refuse). */
export function isString({ min = 0, max }: { min?: number; max: number }): ValidatorDescriptor {
    return defineValidator({
        run: ({ value }) => {
            if (typeof value !== 'string' || value.length < min || value.length > max) {
                throw createValidupError(boundReceived(value), IssueCode.VALUE_INVALID, `must be a string of ${min} to ${max} characters`);
            }

            if (value.includes('\0')) {
                throw createValidupError(boundReceived(value), IssueCode.VALUE_INVALID, 'must not contain a NUL character');
            }

            return value;
        },
    });
}

export function isBoolean(): ValidatorDescriptor {
    return defineValidator({
        run: ({ value }) => {
            if (typeof value !== 'boolean') {
                throw createValidupError(boundReceived(value), IssueCode.VALUE_INVALID, 'must be a boolean');
            }

            return value;
        },
    });
}

/** Any value except `undefined` (`null` is allowed). */
export function isDefined(): ValidatorDescriptor {
    return defineValidator({
        run: ({ value }) => {
            if (value === undefined) {
                throw createValidupError(value, IssueCode.REQUIRED, 'is required');
            }

            return value;
        },
    });
}

/**
 * An array of at most `max` items, each run through `item`. The length is
 * checked before any item, so an oversized list costs one issue; item
 * issues carry the item's index in their path. Returns the cleaned items.
 */
export function isArrayOf<T extends Record<string, any>>(item: Container<T>, { max }: { max: number }): ValidatorDescriptor {
    return defineValidator({
        run: async ({ value }) => {
            if (!Array.isArray(value) || value.length > max) {
                throw createValidupError(boundReceived(value), IssueCode.VALUE_INVALID, `must be an array of at most ${max} items`);
            }

            const items: T[] = [];
            const issues: Issue[] = [];

            for (const [index, entry] of value.entries()) {
                try {
                    items.push(await item.run(entry));
                } catch (error) {
                    if (!isValidupError(error)) {
                        throw error;
                    }

                    issues.push(...error.issues.map((issue) => prefixIssuePath(issue, [index])));
                }
            }

            if (issues.length > 0) {
                throw new ValidupError(issues);
            }

            return items;
        },
    });
}

/** An array of at most `max` strings, each through `isString(item)`; item issues prefixed with their index. */
export function isStringArray({ max, item }: { max: number; item: { min?: number; max: number } }): ValidatorDescriptor {
    const entry = isString(item);

    return defineValidator({
        run: async (ctx) => {
            const { value } = ctx;

            if (!Array.isArray(value) || value.length > max) {
                throw createValidupError(boundReceived(value), IssueCode.VALUE_INVALID, `must be an array of at most ${max} strings`);
            }

            const items: string[] = [];
            const issues: Issue[] = [];

            for (const [index, element] of value.entries()) {
                try {
                    items.push(await entry.run({ ...ctx, value: element }) as string);
                } catch (error) {
                    if (!isValidupError(error)) {
                        throw error;
                    }

                    issues.push(...error.issues.map((issue) => prefixIssuePath(issue, [index])));
                }
            }

            if (issues.length > 0) {
                throw new ValidupError(issues);
            }

            return items;
        },
    });
}

/** A media type `type/subtype` without parameters (core's `isArtifactMediaType`). */
export function isMediaType(): ValidatorDescriptor {
    return defineValidator({
        run: ({ value }) => {
            if (!isArtifactMediaType(value)) {
                throw createValidupError(boundReceived(value), IssueCode.VALUE_INVALID, 'must be a media type of the form type/subtype');
            }

            return value;
        },
    });
}

const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

/**
 * Strict base64 (RFC 4648 section 4: padded, no whitespace, no url-safe
 * alphabet, zero pad bits), decoded to a plain `Uint8Array`.
 */
export function isBase64(): ValidatorDescriptor {
    return defineValidator({
        run: ({ value }) => {
            if (typeof value === 'string' && BASE64.test(value)) {
                const buffer = Buffer.from(value, 'base64');

                // non-zero pad bits decode too: only the canonical form re-encodes to the input
                if (buffer.toString('base64') === value) {
                    return new Uint8Array(buffer);
                }
            }

            // never echo the (up to bodyLimit) input back in the issue
            throw createValidupError(undefined, IssueCode.VALUE_INVALID, 'must be strict base64');
        },
    });
}
