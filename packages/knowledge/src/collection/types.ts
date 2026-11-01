/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { EmbeddingModel } from 'ai';
import type { IKnowledgeSource } from '../source/types.ts';

/**
 * An embedding model: `'<provider>/<model id>'` (resolved through the app's
 * model resolver) or an AI SDK EmbeddingModel object, used as is.
 */
export type EmbeddingModelRef = string | EmbeddingModel;

/** A collection declared in code, fed by its sources. */
export type KnowledgeCollectionDefinition = {
    name: string;
    model: EmbeddingModelRef;
    sources: readonly IKnowledgeSource[];
    /** Whether search results from it are trusted (else they taint the run). */
    trusted: boolean;
};

export type KnowledgeCollectionOptions = {
    model: EmbeddingModelRef;
    sources: readonly IKnowledgeSource[];
    /** Default: true when every source is trusted. */
    trusted?: boolean;
};

/** A declared collection with its embedding model resolved. */
export type ResolvedKnowledgeCollection = {
    name: string;
    /** The model identity stored with its chunks: the string ref, or `<provider>/<model id>`. */
    model: string;
    embedding: EmbeddingModel;
    sources: readonly IKnowledgeSource[];
    trusted: boolean;
};
