/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { DocEntry } from '../api/types.ts';

/** One line of JSON for a table cell. */
export function inlineJson(value: unknown): string {
    try {
        return JSON.stringify(value) ?? String(value);
    } catch {
        return String(value);
    }
}

/** `id` plus the first top-level fields of the documents, in first-seen order. */
export function docColumns(docs: readonly DocEntry[], max = 6): string[] {
    const fields: string[] = [];

    for (const doc of docs) {
        for (const key of Object.keys(doc)) {
            if (key !== 'id' && !fields.includes(key)) {
                fields.push(key);
            }
        }
    }

    return ['id', ...fields.slice(0, max)];
}
