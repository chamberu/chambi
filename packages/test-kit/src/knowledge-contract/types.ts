/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

/*
 * Structural copies of `@chamvi/knowledge`'s repository types: an import
 * would make the kit depend on `@chamvi/knowledge`, which depends on the kit
 * for its tests, a cycle in the graph release-please builds. Every
 * `IKnowledgeRepository` is a `ContractKnowledgeRepository`.
 */

export type ContractKnowledgeTarget = {
    generation: number;
    model: string;
    dimensions?: number;
    chunker: string;
};

export type ContractKnowledgeCollection = {
    name: string;
    kind: 'declared' | 'managed';
    trusted: boolean;
    generation: number;
    model: string;
    dimensions?: number;
    chunker: string;
    pending?: ContractKnowledgeTarget;
    lastGeneration?: number;
    status: 'pending' | 'ready' | 'stale' | 'orphaned';
    error?: string;
    failures?: number;
    retryAt?: Date;
    createdAt: Date;
    updatedAt: Date;
};

export type ContractKnowledgeDocument = {
    collection: string;
    id: string;
    content: string;
    hash: string;
    title?: string;
    source?: string;
    metadata?: Record<string, unknown>;
    generation: number;
    updatedAt: Date;
};

export type ContractKnowledgeChunk = {
    index: number;
    text: string;
    start: number;
    end: number;
    vector: number[];
};

export type ContractKnowledgeMatch = {
    collection: string;
    document: string;
    index: number;
    text: string;
    score: number;
    title?: string;
    source?: string;
};

export type ContractKnowledgeRepository = {
    saveCollection(collection: ContractKnowledgeCollection): Promise<void>;
    findOneCollection(name: string): Promise<ContractKnowledgeCollection | undefined>;
    findOneCollectionOrFail(name: string): Promise<ContractKnowledgeCollection>;
    findCollections(): Promise<ContractKnowledgeCollection[]>;
    deleteCollection(name: string): Promise<boolean>;
    saveDocument(document: ContractKnowledgeDocument): Promise<void>;
    findOneDocument(collection: string, id: string): Promise<ContractKnowledgeDocument | undefined>;
    findOneDocumentOrFail(collection: string, id: string): Promise<ContractKnowledgeDocument>;
    findDocumentIds(collection: string): Promise<string[]>;
    deleteDocument(collection: string, id: string): Promise<boolean>;
    replaceChunks(
        collection: string,
        document: string,
        generation: number,
        chunks: ContractKnowledgeChunk[],
    ): Promise<void>;
    deleteGeneration(collection: string, generation: number): Promise<void>;
    deleteGenerationsExcept(collection: string, generation: number): Promise<void>;
    search(
        collection: string,
        generation: number,
        vector: number[],
        options: { topK: number; minScore?: number },
    ): Promise<ContractKnowledgeMatch[]>;
};

/** A fresh, empty repository per call. */
export type KnowledgeRepositoryContractFactory = () => ContractKnowledgeRepository | Promise<ContractKnowledgeRepository>;
