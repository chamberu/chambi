/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { SerializedError } from './types.ts';

/**
 * Name, code, message and stack only: never `cause` or `issues`,
 * which may hold request bodies or secrets.
 */
export function serializeError(error: unknown): SerializedError {
    if (!(Error.isError(error))) {
        return { message: String(error) };
    }

    const { code } = error as Error & { code?: unknown };

    return {
        name: error.name,
        ...(typeof code === 'string' ? { code } : {}),
        message: error.message,
        ...(typeof error.stack === 'string' ? { stack: error.stack } : {}),
    };
}

function replacer(_key: string, value: unknown): unknown {
    return typeof value === 'bigint' ? value.toString() : value;
}

/**
 * One JSON line `{ ...head, ...fields, error? }`; a field never overrides the head,
 * and fields that cannot be serialized are dropped, never thrown.
 */
export function toLine(
    head: Record<string, unknown>,
    fields: Record<string, unknown>,
    error?: SerializedError,
): string {
    const tail = error ? { error } : {};

    try {
        return JSON.stringify({
            ...head,
            ...fields,
            ...head,
            ...tail,
        }, replacer);
    } catch {
        return JSON.stringify({
            ...head,
            fieldsDropped: true,
            ...tail,
        }, replacer);
    }
}
