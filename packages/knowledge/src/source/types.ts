/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

/** A document a source yields; `id` is stable, so a changed document replaces the one before it. */
export type KnowledgeDocumentInput = {
    id: string;
    content: string;
    title?: string;
    /** Where it came from (a path, a URL), shown with search results. */
    source?: string;
    metadata?: Record<string, unknown>;
};

export type KnowledgeSourceContext = {
    /** Aborted when indexing stops. */
    signal: AbortSignal;
    /** Receives a skipped document's problem; the source goes on. */
    onError(error: unknown): void;
    /**
     * Marks this read incomplete (a transient failure: a directory that could
     * not be listed, a file read error): the sync then deletes no stored
     * document the sources did not yield, and a re-embed does not switch.
     * Never for a document that is skipped for good (too large, invalid):
     * those are deleted.
     */
    incomplete(reason: string): void;
};

/** Yields the documents of a declared collection. */
export interface IKnowledgeSource {
    readonly kind: string;
    /** Whether search results from it are trusted (else they taint the run). */
    readonly trusted: boolean;
    /**
     * Checks the source's configuration without reading its documents (a
     * folder: that it is a directory); InvalidAgentDefinitionError for a
     * problem, so the boot and `start --check` refuse it.
     */
    check?(): Promise<void>;
    documents(ctx: KnowledgeSourceContext): AsyncIterable<KnowledgeDocumentInput>;
}

export type KnowledgeSourceInput = {
    /** Default `custom`. */
    kind?: string;
    /** Default true: content written by the agent creator. */
    trusted?: boolean;
    /** See IKnowledgeSource.check. */
    check?: () => Promise<void>;
    documents: IKnowledgeSource['documents'];
};

export type FolderSourceOptions = {
    /** Default FOLDER_EXTENSIONS. */
    extensions?: readonly string[];
    /** Default true: files shipped with the code. */
    trusted?: boolean;
};
