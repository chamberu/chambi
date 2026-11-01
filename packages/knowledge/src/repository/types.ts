/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

/** `declared`: defined in code and owned by it; `managed`: created and filled through the API. */
export type KnowledgeCollectionKind = 'declared' | 'managed';

export type KnowledgeCollectionStatus = 'pending' | 'ready' | 'stale' | 'orphaned';

/** The embedding model and chunker a generation of chunks was written with. */
export type KnowledgeTarget = {
    generation: number;
    model: string;
    dimensions?: number;
    chunker: string;
};

export type KnowledgeCollection = {
    name: string;
    kind: KnowledgeCollectionKind;
    trusted: boolean;
    /** The generation searches are served from; 0 = never indexed. */
    generation: number;
    /** Model identity of the served generation. */
    model: string;
    /** Vector length of the served generation, once known. */
    dimensions?: number;
    /** Chunker version of the served generation. */
    chunker: string;
    /** A re-embed in progress: the generation written next, not served yet. */
    pending?: KnowledgeTarget;
    /**
     * The highest generation number ever given to a re-embed, so an abandoned
     * one's number is never reused (its documents still name it).
     */
    lastGeneration?: number;
    status: KnowledgeCollectionStatus;
    /** The last indexing failure, cleared by a successful index. */
    error?: string;
    /** Failed attempts since the last successful index; the backoff doubles per failure. */
    failures?: number;
    /** No replica tries again before it (the backoff shared across replicas). */
    retryAt?: Date;
    createdAt: Date;
    updatedAt: Date;
};

export type KnowledgeDocument = {
    collection: string;
    id: string;
    content: string;
    /** `contentHash(content)`. */
    hash: string;
    title?: string;
    source?: string;
    metadata?: Record<string, unknown>;
    /** The generation its chunks were written for `hash`. */
    generation: number;
    updatedAt: Date;
};

/** A passage with its vector; `start`/`end` are UTF-16 offsets into the document's content. */
export type KnowledgeChunkInput = {
    index: number;
    text: string;
    start: number;
    end: number;
    vector: number[];
};

export type KnowledgeMatch = {
    collection: string;
    /** The document id. */
    document: string;
    /** The chunk index within the document. */
    index: number;
    text: string;
    /** Cosine similarity, 1 for the same direction. */
    score: number;
    title?: string;
    source?: string;
};

export type KnowledgeSearchOptions = {
    topK: number;
    /** Matches scoring below it are dropped. */
    minScore?: number;
};

/**
 * Storage of knowledge collections, their documents and chunk vectors.
 * Values are copied in and out; every method is atomic on its own.
 * Documents and chunks need their collection (`RepositoryNotFoundError`
 * otherwise); chunks may be written before their document's record.
 */
export interface IKnowledgeRepository {
    /** Inserts or replaces the collection of that name. */
    saveCollection(collection: KnowledgeCollection): Promise<void>;
    findOneCollection(name: string): Promise<KnowledgeCollection | undefined>;
    /** As `findOneCollection`, rejecting a missing one with `RepositoryNotFoundError`. */
    findOneCollectionOrFail(name: string): Promise<KnowledgeCollection>;
    /** Every collection, in name code-point order. */
    findCollections(): Promise<KnowledgeCollection[]>;
    /** Deletes the collection with its documents and chunks; whether it existed. */
    deleteCollection(name: string): Promise<boolean>;
    /** Inserts or replaces the document of that collection and id. */
    saveDocument(document: KnowledgeDocument): Promise<void>;
    findOneDocument(collection: string, id: string): Promise<KnowledgeDocument | undefined>;
    /** As `findOneDocument`, rejecting a missing one with `RepositoryNotFoundError`. */
    findOneDocumentOrFail(collection: string, id: string): Promise<KnowledgeDocument>;
    /** The collection's document ids, in code-point order. */
    findDocumentIds(collection: string): Promise<string[]>;
    /** Deletes the document and its chunks of every generation; whether the document existed. */
    deleteDocument(collection: string, id: string): Promise<boolean>;
    /** Atomically replaces the document's chunks of one generation (`[]` removes them). */
    replaceChunks(
        collection: string,
        document: string,
        generation: number,
        chunks: KnowledgeChunkInput[],
    ): Promise<void>;
    /** Deletes every chunk of that generation. */
    deleteGeneration(collection: string, generation: number): Promise<void>;
    /** Deletes every chunk of the collection outside that generation. */
    deleteGenerationsExcept(collection: string, generation: number): Promise<void>;
    /**
     * The `topK` chunks of the generation closest to `vector` by cosine
     * similarity, highest score first, ties by document id (code point),
     * then chunk index; `[]` for an unknown collection.
     */
    search(
        collection: string,
        generation: number,
        vector: number[],
        options: KnowledgeSearchOptions,
    ): Promise<KnowledgeMatch[]>;
}
