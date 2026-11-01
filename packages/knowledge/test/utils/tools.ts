/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { EmbeddingModel, ToolSet  } from 'ai';
import { embedMany } from 'ai';
import { createAgentState, createMemoryStore } from '@chamvi/core';
import type { IRunArtifacts, ToolContext } from '@chamvi/core';
import type { IKnowledge, KnowledgeCollection, MemoryKnowledgeRepository } from '@chamvi/knowledge';
import { bindProvided } from '../../../core/src/context/helpers.ts';
import { KNOWLEDGE_CONTEXT } from '../../src/context/constants.ts';

const NO_ARTIFACTS: IRunArtifacts = {
    put: async () => {
        throw new TypeError('artifacts are not used by the knowledge tools');
    },
    get: async () => undefined,
    list: async () => [],
};

/** A ToolContext of a run, with `knowledge` provided as the engine would (none without it). */
export function toolContext(knowledge?: IKnowledge, signal?: AbortSignal): ToolContext {
    const ctx: ToolContext = {
        // the knowledge tools reach no channel
        channels: {} as ToolContext['channels'],
        run: {
            runId: 'run-1',
            agent: 'reader',
            trigger: {
                id: 'env-1',
                agent: 'reader',
                trigger: 'http',
                channel: 'http',
                payload: {},
                receivedAt: new Date('2026-11-01T00:00:00Z'),
            },
            signal: signal ?? new AbortController().signal,
        },
        state: createAgentState('reader', undefined, createMemoryStore().state),
        artifacts: NO_ARTIFACTS,
    };

    if (knowledge) {
        bindProvided(ctx, new Map([[KNOWLEDGE_CONTEXT, knowledge]]));
    }

    return ctx;
}

/** Calls `tools[name].execute` as the AI SDK does, with the context. */
export async function callTool<T = unknown>(tools: ToolSet, name: string, input: unknown, ctx: ToolContext): Promise<T> {
    const execute = tools[name]?.execute as ((i: unknown, o: unknown) => Promise<unknown>) | undefined;

    if (!execute) {
        throw new TypeError(`no tool ${name}`);
    }

    return await execute(input, {
        toolCallId: 'call-1',
        messages: [],
        context: ctx,
    }) as T;
}

export type SeedInput = {
    kind?: KnowledgeCollection['kind'];
    status?: KnowledgeCollection['status'];
    trusted?: boolean;
    generation?: number;
    /** The stored model identity. */
    model: string;
    /** Chunks per document id; each chunk's vector is `vector` or the model's of its text. */
    documents: Record<string, Array<{ text: string; vector?: number[] }>>;
};

/** Writes a collection with its documents and chunks straight into the repository. */
export async function seedCollection(
    repository: MemoryKnowledgeRepository,
    name: string,
    embedding: EmbeddingModel,
    input: SeedInput,
): Promise<void> {
    const at = new Date('2026-11-01T00:00:00Z');
    const generation = input.generation ?? 1;

    await repository.saveCollection({
        name,
        kind: input.kind ?? 'managed',
        trusted: input.trusted ?? false,
        generation,
        model: input.model,
        chunker: 'text-v1',
        status: input.status ?? 'ready',
        createdAt: at,
        updatedAt: at,
    });

    for (const [id, chunks] of Object.entries(input.documents)) {
        const missing = chunks.filter((chunk) => !chunk.vector).map((chunk) => chunk.text);
        const { embeddings } = missing.length > 0 ?
            await embedMany({ model: embedding, values: missing }) :
            { embeddings: [] };
        let next = 0;

        await repository.replaceChunks(name, id, generation, chunks.map((chunk, index) => ({
            index,
            text: chunk.text,
            start: 0,
            end: chunk.text.length,
            vector: chunk.vector ?? embeddings[next++]!,
        })));
        await repository.saveDocument({
            collection: name,
            id,
            content: chunks.map((chunk) => chunk.text).join('\n\n'),
            hash: `sha256:${id}`,
            title: `Title ${id}`,
            source: `${name}/${id}.md`,
            generation,
            updatedAt: at,
        });
    }
}
