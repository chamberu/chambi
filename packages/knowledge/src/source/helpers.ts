/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { ValidationError } from '@chamvi/core';
import { isObject } from 'smob';
import { KNOWLEDGE_DOCUMENT_ID_MAX_LENGTH } from './constants.ts';
import type { KnowledgeDocumentInput } from './types.ts';

function isDocumentId(value: unknown): value is string {
    return typeof value === 'string' &&
        value.length > 0 &&
        value.length <= KNOWLEDGE_DOCUMENT_ID_MAX_LENGTH &&
        !value.includes('\0');
}

/**
 * The problem of a document a source yielded, or undefined when it is valid.
 * The message names the id (when it is one), never the content.
 */
export function documentProblem(value: unknown): ValidationError | undefined {
    if (!isObject(value)) {
        return new ValidationError('A knowledge source yielded a document that is no object; skipped.');
    }

    const item = value as Partial<KnowledgeDocumentInput>;

    if (!isDocumentId(item.id)) {
        return new ValidationError(
            `A knowledge source yielded a document whose id is not 1 to ${KNOWLEDGE_DOCUMENT_ID_MAX_LENGTH} characters without NUL; skipped.`,
        );
    }

    const name = `Knowledge document "${item.id}"`;

    if (typeof item.content !== 'string') {
        return new ValidationError(`${name}: content must be a string; skipped.`);
    }

    for (const key of ['title', 'source'] as const) {
        if (item[key] !== undefined && typeof item[key] !== 'string') {
            return new ValidationError(`${name}: ${key} must be a string; skipped.`);
        }
    }

    if (item.metadata !== undefined && !isObject(item.metadata)) {
        return new ValidationError(`${name}: metadata must be a plain object; skipped.`);
    }

    if (item.metadata !== undefined) {
        try {
            // the repository stores a copy: a function or a symbol would fail the whole sync
            structuredClone(item.metadata);
        } catch {
            return new ValidationError(`${name}: metadata must be cloneable; skipped.`);
        }
    }

    return undefined;
}
