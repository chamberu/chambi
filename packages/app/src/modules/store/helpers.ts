/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { isObject } from 'smob';
import type { DataSource } from 'typeorm';
import type { ILogger } from '../../logger/types.ts';
import { MASKED_PAIR } from './constants.ts';
import type { PurgingStore } from './types.ts';

function passwordsOf(url: string): string[] {
    let password: string;
    try {
        ({ password } = new URL(url));
    } catch {
        return [];
    }

    if (password.length === 0) {
        return [];
    }

    try {
        return [...new Set([password, decodeURIComponent(password)])];
    } catch {
        return [password];
    }
}

const MASK_DEPTH = 5;

function maskString(value: string, needles: string[]): string {
    let masked = value;
    for (const needle of needles) {
        masked = masked.replaceAll(needle, MASKED_PAIR);
    }

    return masked;
}

function maskFields(value: object, needles: string[], depth: number, seen: Set<object>): void {
    if (depth > MASK_DEPTH || seen.has(value)) {
        return;
    }
    seen.add(value);

    const record = value as Record<string, unknown>;
    for (const key of Object.getOwnPropertyNames(value)) {
        let field: unknown;
        try {
            field = record[key];
        } catch {
            continue;
        }

        if (typeof field === 'string') {
            const masked = maskString(field, needles);
            if (masked !== field) {
                try {
                    record[key] = masked;
                } catch {
                    // a frozen field keeps its value
                }
            }
        } else if (isObject(field) || Array.isArray(field)) {
            maskFields(field, needles, depth + 1, seen);
        }
    }
}

/**
 * Masks the URL's `:<password>@` pair (the password as written in the URL
 * and decoded) as `:***@` in every string the error carries: message, stack,
 * cause chain and fields such as a driverError, in place, so the error keeps
 * its class, name and code. A bare password is never searched for, since a
 * common one ('postgres', 'app') is a substring of a stack or a table name.
 */
export function maskPassword(error: unknown, url: string): unknown {
    const needles = passwordsOf(url).map((password) => `:${password}@`);
    if (needles.length === 0) {
        return error;
    }

    if (typeof error === 'string') {
        return maskString(error, needles);
    }

    if (isObject(error)) {
        maskFields(error, needles, 0, new Set());
    }

    return error;
}

/** Destroys a data source this module opened; a failure is logged at debug, the setup error is the one that matters. */
export async function destroyQuietly(dataSource: DataSource, logger: ILogger, url: string): Promise<void> {
    if (!dataSource.isInitialized) {
        return;
    }

    try {
        await dataSource.destroy();
    } catch (error) {
        logger.debug('Closing the data source after a failed store setup failed.', { error: maskPassword(error, url) });
    }
}

export function isPurgingStore<T>(store: T): store is T & PurgingStore {
    return isObject(store) && 'purgeExpired' in store && typeof store.purgeExpired === 'function';
}
