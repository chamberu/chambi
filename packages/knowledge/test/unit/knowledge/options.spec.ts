/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { IModelResolver } from '@chamvi/core';
import { InvalidAgentDefinitionError, createMemoryStore } from '@chamvi/core';
import { mockEmbeddingModel } from '@chamvi/test-kit';
import { describe, expect, it } from 'vitest';
import type { KnowledgeCollection, KnowledgeOptions } from '@chamvi/knowledge';
import {
    createKnowledge,
    createMemoryKnowledgeRepository,
    defineKnowledgeSource,
    folder,
    knowledgeCollection,
} from '@chamvi/knowledge';
import { createIndexerSetup, mapSource } from '../../utils/indexer.ts';

const source = defineKnowledgeSource({
    async* documents() {
        yield* [];
    }, 
});

function base(options: Partial<KnowledgeOptions> = {}): KnowledgeOptions {
    return {
        repository: createMemoryKnowledgeRepository(),
        locks: createMemoryStore().locks,
        ...options,
    };
}

function resolver(embedding?: IModelResolver['embedding']): IModelResolver {
    return {
        check: () => {},
        resolve: () => {
            throw new Error('no language models');
        },
        ...(embedding ? { embedding } : {}),
    };
}

describe('createKnowledge', () => {
    it('works without collections', () => {
        const knowledge = createKnowledge(base());

        expect(knowledge.collection('docs')).toBeUndefined();
    });

    it('resolves an object model to its provider/model id identity', () => {
        const model = mockEmbeddingModel();
        const knowledge = createKnowledge(base({ collections: [knowledgeCollection('docs', { model, sources: [source] })] }));

        const resolved = knowledge.collection('docs');

        expect(resolved).toEqual({
            name: 'docs',
            model: 'mock-provider/mock-model-id',
            embedding: model,
            sources: [source],
            trusted: true,
        });
        expect(knowledge.embedding('mock-provider/mock-model-id')).toBe(model);
    });

    it('resolves a string model through the resolver, keeping the ref as identity', () => {
        const model = mockEmbeddingModel();
        const refs: string[] = [];
        const knowledge = createKnowledge(base({
            models: resolver((ref) => {
                refs.push(ref);

                return model;
            }),
            collections: [knowledgeCollection('docs', {
                model: 'openai/text-embedding-3-small', 
                sources: [source], 
                trusted: false, 
            })],
        }));

        expect(refs).toEqual(['openai/text-embedding-3-small']);
        expect(knowledge.collection('docs')!.model).toBe('openai/text-embedding-3-small');
        expect(knowledge.collection('docs')!.embedding).toBe(model);
        expect(knowledge.collection('docs')!.trusted).toBe(false);
        expect(knowledge.embedding('openai/text-embedding-3-small')).toBe(model);
    });

    it('exposes the repository', () => {
        const repository = createMemoryKnowledgeRepository();

        expect(createKnowledge(base({ repository })).repository).toBe(repository);
    });

    it('refuses a duplicate collection name', () => {
        const model = mockEmbeddingModel();

        expect(() => createKnowledge(base({
            collections: [
                knowledgeCollection('docs', { model, sources: [source] }),
                knowledgeCollection('docs', { model, sources: [source] }),
            ],
        }))).toThrow('Knowledge collection "docs" is declared twice.');
    });

    it('needs a resolver for a string model', () => {
        expect(() => createKnowledge(base({ collections: [knowledgeCollection('docs', { model: 'openai/x', sources: [source] })] }))).toThrow('Knowledge collection "docs": the model string "openai/x" needs a model resolver.');
    });

    it('needs a resolver that hands out embedding models', () => {
        expect(() => createKnowledge(base({
            models: resolver(),
            collections: [knowledgeCollection('docs', { model: 'openai/x', sources: [source] })],
        }))).toThrow(/^Knowledge collection "docs": .*embedding/);
    });

    it('wraps a throwing resolver with the collection name', () => {
        const create = () => createKnowledge(base({
            models: resolver(() => {
                throw new InvalidAgentDefinitionError('Provider "openai" is not configured.');
            }),
            collections: [knowledgeCollection('docs', { model: 'openai/x', sources: [source] })],
        }));

        expect(create).toThrow(InvalidAgentDefinitionError);
        expect(create).toThrow('Knowledge collection "docs": Provider "openai" is not configured.');
    });

    it('refuses a resolver answer that is no model object', () => {
        expect(() => createKnowledge(base({
            models: resolver(() => 'openai/x'),
            collections: [knowledgeCollection('docs', { model: 'openai/x', sources: [source] })],
        }))).toThrow(InvalidAgentDefinitionError);
    });

    it('re-checks a hand-built definition', () => {
        expect(() => createKnowledge(base({
            collections: [{
                name: 'Bad Name', 
                model: mockEmbeddingModel(), 
                sources: [source], 
                trusted: true, 
            }], 
        }))).toThrow(InvalidAgentDefinitionError);
    });

    it('checks every option eagerly', () => {
        const bad: Partial<Record<keyof KnowledgeOptions, unknown>>[] = [
            { repository: undefined },
            { repository: {} },
            { locks: {} },
            { collections: 'docs' },
            { models: 'openai' },
            { clock: {} },
            { owner: '' },
            { onError: 'log' },
        ];

        for (const options of bad) {
            expect(() => createKnowledge(base(options as Partial<KnowledgeOptions>))).toThrow(InvalidAgentDefinitionError);
        }

        expect(() => createKnowledge(undefined as never)).toThrow(InvalidAgentDefinitionError);
    });

    it('refuses an unknown embedding identity', () => {
        expect(() => createKnowledge(base()).embedding('openai/x')).toThrow(InvalidAgentDefinitionError);
    });

    it('resolves an unknown string identity through the resolver', () => {
        const model = mockEmbeddingModel();
        const knowledge = createKnowledge(base({ models: resolver(() => model) }));

        expect(knowledge.embedding('openai/y')).toBe(model);
    });

    it('has lifecycle stubs', async () => {
        const knowledge = createKnowledge(base());

        knowledge.start();
        await expect(knowledge.check()).resolves.toBeUndefined();
        await expect(knowledge.stop()).resolves.toBeUndefined();
    });
});

function record(name: string, kind: KnowledgeCollection['kind']): KnowledgeCollection {
    const at = new Date('2026-11-01T00:00:00Z');

    return {
        name,
        kind,
        trusted: kind === 'declared',
        generation: 0,
        model: 'mock-provider/mock-model-id',
        chunker: 'text-v1',
        status: 'pending',
        createdAt: at,
        updatedAt: at,
    };
}

describe('knowledge.check()', () => {
    it('refuses a declared name the store holds as a managed collection', async () => {
        const indexer = createIndexerSetup();
        const knowledge = createKnowledge(indexer.options({ collections: [knowledgeCollection('docs', { model: mockEmbeddingModel(), sources: [mapSource(new Map())] })] }));

        await indexer.repository.saveCollection(record('docs', 'managed'));

        const error = await knowledge.check().catch((e: unknown) => e);

        expect(error).toBeInstanceOf(InvalidAgentDefinitionError);
        expect((error as Error).message)
            .toBe('Knowledge collection "docs" is managed in the store; a declared collection cannot take its name.');
    });

    it('passes declared, orphaned and unrelated managed records, and writes nothing', async () => {
        const indexer = createIndexerSetup();
        const knowledge = createKnowledge(indexer.options({ collections: [knowledgeCollection('docs', { model: mockEmbeddingModel(), sources: [mapSource(new Map())] })] }));

        await indexer.repository.saveCollection(record('docs', 'declared'));
        await indexer.repository.saveCollection({ ...record('old', 'declared'), status: 'orphaned' });
        await indexer.repository.saveCollection(record('notes', 'managed'));

        const before = await indexer.repository.findCollections();

        await expect(knowledge.check()).resolves.toBeUndefined();
        expect(await indexer.repository.findCollections()).toEqual(before);
    });

    it('runs every source\'s check, so a missing folder fails it', async () => {
        const indexer = createIndexerSetup();
        const knowledge = createKnowledge(indexer.options({ collections: [knowledgeCollection('docs', { model: mockEmbeddingModel(), sources: [mapSource(new Map()), folder('/definitely/not/a/directory')] })] }));

        const error = await knowledge.check().catch((e: unknown) => e);

        expect(error).toBeInstanceOf(InvalidAgentDefinitionError);
        expect((error as Error).message).toBe('Knowledge collection "docs": folder(): "/definitely/not/a/directory" is no directory.');
        expect(await indexer.repository.findCollections()).toEqual([]);
    });

    it('passes on an empty store', async () => {
        const indexer = createIndexerSetup();
        const knowledge = createKnowledge(indexer.options({ collections: [knowledgeCollection('docs', { model: mockEmbeddingModel(), sources: [mapSource(new Map())] })] }));

        await expect(knowledge.check()).resolves.toBeUndefined();
        expect(await indexer.repository.findCollections()).toEqual([]);
    });
});
