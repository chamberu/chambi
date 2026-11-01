/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { IClock, ILockRepository, IModelResolver } from '@chamvi/core';
import type { EmbeddingModel } from 'ai';
import type { KnowledgeCollectionDefinition, ResolvedKnowledgeCollection } from '../collection/types.ts';
import type { IKnowledgeRepository } from '../repository/types.ts';

/** What an error reported through `onError` concerns. */
export type KnowledgeErrorContext = {
    collection?: string;
};

export type KnowledgeOptions = {
    repository: IKnowledgeRepository;
    /** The store's locks: one indexer per collection across replicas. */
    locks: ILockRepository;
    collections?: readonly KnowledgeCollectionDefinition[];
    /** Resolves string model refs (`embedding()`); the app's resolver in an app. */
    models?: IModelResolver;
    /** Default systemClock. */
    clock?: IClock;
    /** The lock owner; default `${hostname}-${pid}`. */
    owner?: string;
    /** Receives indexing errors; default console.error. */
    onError?: (error: unknown, context: KnowledgeErrorContext) => void;
};

/** The declared collections, their repository and their indexing. */
export interface IKnowledge {
    readonly repository: IKnowledgeRepository;
    /** A declared collection, or undefined. */
    collection(name: string): ResolvedKnowledgeCollection | undefined;
    /** The embedding model of a stored model identity; InvalidAgentDefinitionError for an unknown one. */
    embedding(model: string): EmbeddingModel;
    /** Starts indexing the declared collections in the background. */
    start(): void;
    /** Stops indexing and waits for it. */
    stop(): Promise<void>;
    /** Runs every source's check and refuses declared names the store holds as managed collections (read-only). */
    check(): Promise<void>;
}
