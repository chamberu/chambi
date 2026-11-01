/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { describe, expect, it } from 'vitest';
import type {
    ContractKnowledgeChunk,
    ContractKnowledgeCollection,
    ContractKnowledgeDocument,
    KnowledgeRepositoryContractFactory,
} from './types.ts';

const AT = new Date(1_000);

function collectionOf(
    name: string,
    patch: Partial<ContractKnowledgeCollection> = {},
): ContractKnowledgeCollection {
    return {
        name,
        kind: 'declared',
        trusted: true,
        generation: 1,
        model: 'mock-provider/mock-model-id',
        dimensions: 2,
        chunker: 'text-v1',
        status: 'ready',
        createdAt: AT,
        updatedAt: AT,
        ...patch,
    };
}

function documentOf(
    collection: string,
    id: string,
    patch: Partial<ContractKnowledgeDocument> = {},
): ContractKnowledgeDocument {
    return {
        collection,
        id,
        content: `content of ${id}`,
        hash: `sha256:${id}`,
        generation: 1,
        updatedAt: AT,
        ...patch,
    };
}

function chunkOf(index: number, vector: number[], text = `chunk ${index}`): ContractKnowledgeChunk {
    return {
        index,
        text,
        start: index * 10,
        end: (index * 10) + text.length,
        vector,
    };
}

/**
 * Shared behavioural contract for every knowledge repository
 * (`@chamvi/knowledge`'s `IKnowledgeRepository`).
 *
 * @param name    Label of the suite, e.g. the backend.
 * @param create  Factory for a fresh, empty repository per test.
 */
export function describeKnowledgeRepositoryContract(
    name: string,
    create: KnowledgeRepositoryContractFactory,
): void {
    describe(`knowledge repository contract: ${name}`, () => {
        describe('collections', () => {
            it('reads a missing collection as undefined and OrFail rejects', async () => {
                const repository = await create();

                expect(await repository.findOneCollection('missing')).toBeUndefined();
                await expect(repository.findOneCollectionOrFail('missing'))
                    .rejects.toMatchObject({ code: 'repository_not_found' });
                expect(await repository.findCollections()).toEqual([]);
            });

            it('saves, reads and upserts a collection by name', async () => {
                const repository = await create();

                await repository.saveCollection(collectionOf('docs', { status: 'pending', generation: 0 }));
                await repository.saveCollection(collectionOf('docs', {
                    pending: {
                        generation: 2, 
                        model: 'p/m', 
                        dimensions: 4, 
                        chunker: 'text-v1',
                    },
                    lastGeneration: 3,
                    error: 'failed once',
                    failures: 2,
                    retryAt: new Date(5_000),
                }));

                const stored = await repository.findOneCollectionOrFail('docs');

                expect(stored).toEqual(collectionOf('docs', {
                    pending: {
                        generation: 2, 
                        model: 'p/m', 
                        dimensions: 4, 
                        chunker: 'text-v1',
                    },
                    lastGeneration: 3,
                    error: 'failed once',
                    failures: 2,
                    retryAt: new Date(5_000),
                }));
                expect(stored.createdAt).toBeInstanceOf(Date);
                expect(stored.retryAt).toBeInstanceOf(Date);
                expect(stored.updatedAt.getTime()).toBe(AT.getTime());
                expect(await repository.findCollections()).toHaveLength(1);
            });

            it('copies collections in and out', async () => {
                const repository = await create();
                const input = collectionOf('docs', {
                    pending: {
                        generation: 2, 
                        model: 'p/m', 
                        chunker: 'text-v1',
                    },
                });

                await repository.saveCollection(input);
                input.status = 'orphaned';
                input.pending!.generation = 9;

                const read = await repository.findOneCollectionOrFail('docs');

                read.status = 'stale';
                read.pending!.generation = 7;
                read.updatedAt.setTime(0);

                const [listed] = await repository.findCollections();

                listed!.trusted = false;

                const again = await repository.findOneCollectionOrFail('docs');

                expect(again.status).toBe('ready');
                expect(again.trusted).toBe(true);
                expect(again.pending?.generation).toBe(2);
                expect(again.updatedAt.getTime()).toBe(AT.getTime());
            });

            it('lists collections in code point order', async () => {
                const repository = await create();

                for (const name of ['b', '\u{1F600}', 'a', '�', 'B']) {
                    await repository.saveCollection(collectionOf(name));
                }

                const names = (await repository.findCollections()).map((collection) => collection.name);

                expect(names).toEqual(['B', 'a', 'b', '�', '\u{1F600}']);
            });

            it('deletes a collection with its documents and chunks', async () => {
                const repository = await create();

                await repository.saveCollection(collectionOf('docs'));
                await repository.saveCollection(collectionOf('other'));
                await repository.saveDocument(documentOf('docs', 'a'));
                await repository.replaceChunks('docs', 'a', 1, [chunkOf(0, [1, 0])]);
                await repository.replaceChunks('docs', 'loose', 1, [chunkOf(0, [1, 0])]);
                await repository.saveDocument(documentOf('other', 'a'));
                await repository.replaceChunks('other', 'a', 1, [chunkOf(0, [1, 0])]);

                expect(await repository.deleteCollection('docs')).toBe(true);
                expect(await repository.deleteCollection('docs')).toBe(false);
                expect(await repository.findOneCollection('docs')).toBeUndefined();
                expect(await repository.findDocumentIds('docs')).toEqual([]);
                expect(await repository.findOneDocument('docs', 'a')).toBeUndefined();
                expect(await repository.search('docs', 1, [1, 0], { topK: 10 })).toEqual([]);

                await repository.saveCollection(collectionOf('docs'));

                expect(await repository.search('docs', 1, [1, 0], { topK: 10 })).toEqual([]);
                expect(await repository.findDocumentIds('other')).toEqual(['a']);
                expect(await repository.search('other', 1, [1, 0], { topK: 10 })).toHaveLength(1);
            });

            it('deletes every generation but one, of that collection only', async () => {
                const repository = await create();

                await repository.saveCollection(collectionOf('docs'));
                await repository.saveCollection(collectionOf('other'));
                await repository.replaceChunks('docs', 'a', 1, [chunkOf(0, [1, 0])]);
                await repository.replaceChunks('docs', 'a', 2, [chunkOf(0, [1, 0])]);
                await repository.replaceChunks('docs', 'b', 3, [chunkOf(0, [1, 0])]);
                await repository.replaceChunks('other', 'a', 1, [chunkOf(0, [1, 0])]);

                await repository.deleteGenerationsExcept('docs', 2);
                await repository.deleteGenerationsExcept('missing', 1);

                expect(await repository.search('docs', 1, [1, 0], { topK: 10 })).toEqual([]);
                expect(await repository.search('docs', 2, [1, 0], { topK: 10 })).toHaveLength(1);
                expect(await repository.search('docs', 3, [1, 0], { topK: 10 })).toEqual([]);
                expect(await repository.search('other', 1, [1, 0], { topK: 10 })).toHaveLength(1);
            });
        });

        describe('documents', () => {
            it('reads a missing document as undefined and OrFail rejects', async () => {
                const repository = await create();

                await repository.saveCollection(collectionOf('docs'));

                expect(await repository.findOneDocument('docs', 'missing')).toBeUndefined();
                expect(await repository.findOneDocument('missing', 'missing')).toBeUndefined();
                await expect(repository.findOneDocumentOrFail('docs', 'missing'))
                    .rejects.toMatchObject({ code: 'repository_not_found' });
                expect(await repository.findDocumentIds('docs')).toEqual([]);
                expect(await repository.findDocumentIds('missing')).toEqual([]);
            });

            it('refuses a document or chunks of a collection that does not exist', async () => {
                const repository = await create();

                await expect(repository.saveDocument(documentOf('missing', 'a')))
                    .rejects.toMatchObject({ code: 'repository_not_found' });
                await expect(repository.replaceChunks('missing', 'a', 1, [chunkOf(0, [1, 0])]))
                    .rejects.toMatchObject({ code: 'repository_not_found' });
                expect(await repository.findOneCollection('missing')).toBeUndefined();
            });

            it('saves, replaces and copies documents in and out', async () => {
                const repository = await create();
                const input = documentOf('docs', 'a', {
                    title: 'A',
                    source: 'a.md',
                    metadata: { tags: ['x'], nested: { n: 1 } },
                });

                await repository.saveCollection(collectionOf('docs'));
                await repository.saveDocument(input);
                (input.metadata!.tags as string[]).push('y');

                const read = await repository.findOneDocumentOrFail('docs', 'a');

                expect(read).toEqual(documentOf('docs', 'a', {
                    title: 'A',
                    source: 'a.md',
                    metadata: { tags: ['x'], nested: { n: 1 } },
                }));
                expect(read.updatedAt).toBeInstanceOf(Date);

                (read.metadata!.nested as { n: number }).n = 2;

                expect((await repository.findOneDocumentOrFail('docs', 'a')).metadata).toEqual({
                    tags: ['x'],
                    nested: { n: 1 },
                });

                await repository.saveDocument(documentOf('docs', 'a', {
                    content: 'new', 
                    hash: 'sha256:new', 
                    generation: 2, 
                }));

                const replaced = await repository.findOneDocumentOrFail('docs', 'a');

                expect(replaced.content).toBe('new');
                expect(replaced.hash).toBe('sha256:new');
                expect(replaced.generation).toBe(2);
                expect(replaced.title).toBeUndefined();
                expect(await repository.findDocumentIds('docs')).toEqual(['a']);
            });

            it('lists document ids in code point order, per collection', async () => {
                const repository = await create();

                await repository.saveCollection(collectionOf('docs'));
                await repository.saveCollection(collectionOf('other'));

                for (const id of ['sub/b.md', '\u{1F600}', 'a.md', '�', 'A.md']) {
                    await repository.saveDocument(documentOf('docs', id));
                }

                await repository.saveDocument(documentOf('other', 'z.md'));

                expect(await repository.findDocumentIds('docs')).toEqual(['A.md', 'a.md', 'sub/b.md', '�', '\u{1F600}']);
                expect(await repository.findDocumentIds('other')).toEqual(['z.md']);
            });

            it('deletes a document with its chunks of every generation', async () => {
                const repository = await create();

                await repository.saveCollection(collectionOf('docs'));
                await repository.saveDocument(documentOf('docs', 'a'));
                await repository.saveDocument(documentOf('docs', 'b'));
                await repository.replaceChunks('docs', 'a', 1, [chunkOf(0, [1, 0])]);
                await repository.replaceChunks('docs', 'a', 2, [chunkOf(0, [1, 0])]);
                await repository.replaceChunks('docs', 'b', 1, [chunkOf(0, [1, 0])]);

                expect(await repository.deleteDocument('docs', 'a')).toBe(true);
                expect(await repository.deleteDocument('docs', 'a')).toBe(false);
                expect(await repository.findOneDocument('docs', 'a')).toBeUndefined();
                expect(await repository.findDocumentIds('docs')).toEqual(['b']);
                expect((await repository.search('docs', 1, [1, 0], { topK: 10 })).map((match) => match.document))
                    .toEqual(['b']);
                expect(await repository.search('docs', 2, [1, 0], { topK: 10 })).toEqual([]);
            });

            it('deletes the chunks of a document whose record was never saved', async () => {
                const repository = await create();

                await repository.saveCollection(collectionOf('docs'));
                await repository.replaceChunks('docs', 'a', 1, [chunkOf(0, [1, 0])]);

                expect(await repository.deleteDocument('docs', 'a')).toBe(false);
                expect(await repository.search('docs', 1, [1, 0], { topK: 10 })).toEqual([]);
            });
        });

        describe('chunks', () => {
            it('replaces only the given document and generation', async () => {
                const repository = await create();

                await repository.saveCollection(collectionOf('docs'));
                await repository.saveDocument(documentOf('docs', 'a'));
                await repository.saveDocument(documentOf('docs', 'b'));
                await repository.replaceChunks('docs', 'a', 1, [chunkOf(0, [1, 0], 'old a0'), chunkOf(1, [1, 0], 'old a1')]);
                await repository.replaceChunks('docs', 'a', 2, [chunkOf(0, [1, 0], 'next a0')]);
                await repository.replaceChunks('docs', 'b', 1, [chunkOf(0, [1, 0], 'b0')]);

                await repository.replaceChunks('docs', 'a', 1, [chunkOf(0, [1, 0], 'new a0')]);

                const first = await repository.search('docs', 1, [1, 0], { topK: 10 });

                expect(first.map((match) => [match.document, match.index, match.text])).toEqual([
                    ['a', 0, 'new a0'],
                    ['b', 0, 'b0'],
                ]);
                expect((await repository.search('docs', 2, [1, 0], { topK: 10 })).map((match) => match.text))
                    .toEqual(['next a0']);

                await repository.replaceChunks('docs', 'a', 1, []);

                expect((await repository.search('docs', 1, [1, 0], { topK: 10 })).map((match) => match.document))
                    .toEqual(['b']);
            });

            it('copies chunk vectors in', async () => {
                const repository = await create();
                const vector = [1, 0];

                await repository.saveCollection(collectionOf('docs'));
                await repository.replaceChunks('docs', 'a', 1, [chunkOf(0, vector)]);
                vector[0] = 0;
                vector[1] = 1;

                const [match] = await repository.search('docs', 1, [1, 0], { topK: 1 });

                expect(match?.score).toBeCloseTo(1, 6);
            });

            it('deletes one generation and keeps the others', async () => {
                const repository = await create();

                await repository.saveCollection(collectionOf('docs'));
                await repository.saveCollection(collectionOf('other'));
                await repository.replaceChunks('docs', 'a', 1, [chunkOf(0, [1, 0])]);
                await repository.replaceChunks('docs', 'b', 1, [chunkOf(0, [1, 0])]);
                await repository.replaceChunks('docs', 'a', 2, [chunkOf(0, [1, 0])]);
                await repository.replaceChunks('other', 'a', 1, [chunkOf(0, [1, 0])]);

                await repository.deleteGeneration('docs', 1);
                await repository.deleteGeneration('docs', 5);
                await repository.deleteGeneration('missing', 1);

                expect(await repository.search('docs', 1, [1, 0], { topK: 10 })).toEqual([]);
                expect(await repository.search('docs', 2, [1, 0], { topK: 10 })).toHaveLength(1);
                expect(await repository.search('other', 1, [1, 0], { topK: 10 })).toHaveLength(1);
            });
        });

        describe('search', () => {
            const seed = async () => {
                const repository = await create();

                await repository.saveCollection(collectionOf('docs'));
                await repository.saveDocument(documentOf('docs', 'near', { title: 'Near', source: 'near.md' }));
                await repository.saveDocument(documentOf('docs', 'far'));
                await repository.saveDocument(documentOf('docs', 'next'));
                await repository.replaceChunks('docs', 'near', 1, [chunkOf(0, [1, 0], 'exact')]);
                await repository.replaceChunks('docs', 'far', 1, [chunkOf(0, [0.6, 0.8], 'partial')]);
                await repository.replaceChunks('docs', 'next', 2, [chunkOf(0, [1, 0], 'next generation')]);

                return repository;
            };

            it('ranks by cosine similarity and joins the origin', async () => {
                const repository = await seed();

                const matches = await repository.search('docs', 1, [1, 0], { topK: 10 });

                expect(matches).toHaveLength(2);
                expect(matches[0]).toMatchObject({
                    collection: 'docs',
                    document: 'near',
                    index: 0,
                    text: 'exact',
                    title: 'Near',
                    source: 'near.md',
                });
                expect(matches[0]!.score).toBeCloseTo(1, 6);
                expect(matches[1]).toMatchObject({ document: 'far', text: 'partial' });
                expect(matches[1]!.score).toBeCloseTo(0.6, 6);
                expect(matches[1]!.title).toBeUndefined();
                expect(matches[1]!.source).toBeUndefined();
            });

            it('compares by direction, not by length', async () => {
                const repository = await seed();

                const [match] = await repository.search('docs', 1, [3, 0], { topK: 1 });

                expect(match?.document).toBe('near');
                expect(match?.score).toBeCloseTo(1, 6);
            });

            it('honours topK and minScore', async () => {
                const repository = await seed();

                expect((await repository.search('docs', 1, [1, 0], { topK: 1 })).map((match) => match.document))
                    .toEqual(['near']);
                expect((await repository.search('docs', 1, [1, 0], { topK: 10, minScore: 0.7 })).map((match) => match.document))
                    .toEqual(['near']);
                expect(await repository.search('docs', 1, [1, 0], { topK: 10, minScore: 1.5 })).toEqual([]);
            });

            it('searches only the given generation', async () => {
                const repository = await seed();

                expect((await repository.search('docs', 2, [1, 0], { topK: 10 })).map((match) => match.text))
                    .toEqual(['next generation']);
                expect(await repository.search('docs', 3, [1, 0], { topK: 10 })).toEqual([]);
            });

            it('answers an unknown collection with no matches', async () => {
                const repository = await seed();

                expect(await repository.search('missing', 1, [1, 0], { topK: 10 })).toEqual([]);
            });

            it('orders equal scores by document, then index', async () => {
                const repository = await create();

                await repository.saveCollection(collectionOf('docs'));
                await repository.replaceChunks('docs', 'b', 1, [chunkOf(0, [1, 0])]);
                await repository.replaceChunks('docs', 'a', 1, [chunkOf(1, [1, 0]), chunkOf(0, [1, 0])]);

                const matches = await repository.search('docs', 1, [1, 0], { topK: 10 });

                expect(matches.map((match) => [match.document, match.index])).toEqual([
                    ['a', 0],
                    ['a', 1],
                    ['b', 0],
                ]);
            });
        });
    });
}
