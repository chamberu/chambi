/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { jsonSchema } from 'ai';
import type { JSONSchema7 } from 'ai';
import { InvalidAgentDefinitionError, ValidationError } from '@chamvi/core';
import type { ToolContext } from '@chamvi/core';
import { isObject } from 'smob';
import { assertCollectionName } from '../collection/helpers.ts';
import { compareCodePoints } from '../repository/helpers.ts';
import type { KnowledgeMatch } from '../repository/types.ts';
import {
    KNOWLEDGE_QUERY_MAX_LENGTH,
    KNOWLEDGE_SEARCH_DEFAULT_RESULTS,
    KNOWLEDGE_SEARCH_MAX_CHARS,
    KNOWLEDGE_SEARCH_MAX_RESULTS,
} from './constants.ts';
import type {
    KnowledgeSearchInput,
    KnowledgeSearchResult,
    KnowledgeToolsOptions,
    KnowledgeToolsOptionsNormalized,
} from './types.ts';

const LABEL = 'knowledgeTools()';

function isCount(value: unknown): value is number {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1 && value <= KNOWLEDGE_SEARCH_MAX_RESULTS;
}

/** The options checked, with their defaults (InvalidAgentDefinitionError). */
export function normalizeOptions(options: KnowledgeToolsOptions): KnowledgeToolsOptionsNormalized {
    if (!isObject(options)) {
        throw new InvalidAgentDefinitionError(`${LABEL} options must be an object.`);
    }

    const {
        collections, 
        topK, 
        minScore, 
    } = options;

    if (!Array.isArray(collections) || collections.length === 0) {
        throw new InvalidAgentDefinitionError(`${LABEL} collections must name at least one collection.`);
    }

    const seen = new Set<string>();

    for (const name of collections) {
        assertCollectionName(name, LABEL);

        if (seen.has(name)) {
            throw new InvalidAgentDefinitionError(`${LABEL} names the collection "${name}" twice.`);
        }

        seen.add(name);
    }

    if (topK !== undefined && !isCount(topK)) {
        throw new InvalidAgentDefinitionError(`${LABEL} topK must be an integer from 1 to ${KNOWLEDGE_SEARCH_MAX_RESULTS}.`);
    }

    if (minScore !== undefined && (typeof minScore !== 'number' || !Number.isFinite(minScore) || minScore < -1 || minScore > 1)) {
        throw new InvalidAgentDefinitionError(`${LABEL} minScore must be a number from -1 to 1.`);
    }

    return {
        collections: [...collections],
        topK: topK ?? KNOWLEDGE_SEARCH_DEFAULT_RESULTS,
        ...(minScore !== undefined && { minScore }),
    };
}

/** The tool input checked (ValidationError, a tool error the model can correct). */
export function readInput(input: unknown): KnowledgeSearchInput {
    if (!isObject(input)) {
        throw new ValidationError('The tool input must be an object.');
    }

    const {
        query, 
        collection, 
        topK, 
    } = input;

    if (typeof query !== 'string' || query.trim().length === 0 || query.length > KNOWLEDGE_QUERY_MAX_LENGTH) {
        throw new ValidationError(`query must be a non-empty string of at most ${KNOWLEDGE_QUERY_MAX_LENGTH} characters.`);
    }

    if (collection !== undefined && typeof collection !== 'string') {
        throw new ValidationError('collection must be a string.');
    }

    if (topK !== undefined && !isCount(topK)) {
        throw new ValidationError(`topK must be an integer from 1 to ${KNOWLEDGE_SEARCH_MAX_RESULTS}.`);
    }

    return {
        query,
        ...(collection !== undefined && { collection }),
        ...(topK !== undefined && { topK }),
    };
}

/**
 * The collections a call searches: the one it names when the options hold
 * it, none for another one (the call is refused), else every option's.
 */
export function searchedCollections(input: unknown, options: KnowledgeToolsOptionsNormalized): readonly string[] {
    const collection = isObject(input) ? input.collection : undefined;

    if (collection === undefined) {
        return options.collections;
    }

    return typeof collection === 'string' && options.collections.includes(collection) ? [collection] : [];
}

/** Highest score first; ties by collection, document (code point), then chunk index. */
export function compareMatches(a: KnowledgeMatch, b: KnowledgeMatch): number {
    return (b.score - a.score) ||
        compareCodePoints(a.collection, b.collection) ||
        compareCodePoints(a.document, b.document) ||
        (a.index - b.index);
}

/** The best `topK` matches, cut at a whole match once their text passes KNOWLEDGE_SEARCH_MAX_CHARS. */
export function toResult(matches: KnowledgeMatch[], topK: number): KnowledgeSearchResult {
    const best = matches.sort(compareMatches).slice(0, topK);
    const kept: KnowledgeMatch[] = [];
    let chars = 0;

    for (const match of best) {
        chars += match.text.length;

        if (chars > KNOWLEDGE_SEARCH_MAX_CHARS) {
            return { matches: kept, truncated: true };
        }

        kept.push(match);
    }

    return { matches: kept, truncated: false };
}

/** The call's abort signal combined with the run's. */
export function signalOf(abortSignal: AbortSignal | undefined, context: ToolContext): AbortSignal {
    const { signal } = context.run;

    if (!abortSignal || abortSignal === signal) {
        return signal;
    }

    return AbortSignal.any([abortSignal, signal]);
}

/** An object schema of `properties`, the `required` ones required. */
export function objectSchema<T>(properties: Record<string, JSONSchema7>, required: string[] = []) {
    return jsonSchema<T>({
        type: 'object',
        properties,
        required,
        additionalProperties: false,
    });
}
