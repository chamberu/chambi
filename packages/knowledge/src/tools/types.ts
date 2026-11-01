/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { KnowledgeMatch } from '../repository/types.ts';

export type KnowledgeToolsOptions = {
    /** The collections the agent may search (at least one; the agent-name rule). */
    collections: readonly string[];
    /** Matches per call when the call names none: 1 to KNOWLEDGE_SEARCH_MAX_RESULTS, default KNOWLEDGE_SEARCH_DEFAULT_RESULTS. */
    topK?: number;
    /** Matches scoring below it (cosine similarity, -1 to 1) are dropped. */
    minScore?: number;
};

export type KnowledgeSearchInput = {
    query: string;
    /** One of the options' collections; default all of them. */
    collection?: string;
    topK?: number;
};

export type KnowledgeSearchResult = {
    /** Highest score first, over every searched collection. */
    matches: KnowledgeMatch[];
    /** Whether matches were left out to keep the result within KNOWLEDGE_SEARCH_MAX_CHARS. */
    truncated: boolean;
};

/** The options checked, with their defaults. */
export type KnowledgeToolsOptionsNormalized = {
    collections: readonly string[];
    topK: number;
    minScore?: number;
};
