/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { InvalidAgentDefinitionError } from '@chamvi/core';
import { mockEmbeddingModel } from '@chamvi/test-kit';
import { MockEmbeddingModelV4 } from 'ai/test';
import { 
    afterEach, 
    describe, 
    expect, 
    it, 
    vi,
} from 'vitest';
import type { IKnowledge } from '@chamvi/knowledge';
import {
    KNOWLEDGE_EMBED_TIMEOUT_MS,
    KNOWLEDGE_REQUEST_ERROR_CODE,
    KNOWLEDGE_RETRY_MAX_MS,
    KNOWLEDGE_RETRY_MS,
    createKnowledge,
    defineKnowledgeSource,
    knowledgeCollection,
} from '@chamvi/knowledge';
import type { IndexerSetup } from '../../utils/indexer.ts';
import { createIndexerSetup, mapSource, waitForReady } from '../../utils/indexer.ts';

const started: IKnowledge[] = [];

afterEach(async () => {
    await Promise.all(started.splice(0).map((knowledge) => knowledge.stop()));
});

/** Fails its first `failures` calls with "provider unavailable", then embeds. */
function flakyModel(failures: number) {
    const inner = mockEmbeddingModel();
    let calls = 0;

    return new MockEmbeddingModelV4({
        maxEmbeddingsPerCall: null,
        supportsParallelCalls: true,
        doEmbed: async (options) => {
            calls++;

            if (calls <= failures) {
                throw new Error('provider unavailable');
            }

            return inner.doEmbed(options);
        },
    });
}

function start(setup: IndexerSetup, failures: number): IKnowledge {
    const knowledge = createKnowledge(setup.options({
        collections: [knowledgeCollection('docs', {
            model: flakyModel(failures),
            sources: [mapSource(new Map([['a.md', 'Refunds within thirty days.']]))],
        })],
    }));

    started.push(knowledge);
    knowledge.start();

    return knowledge;
}

describe('indexing failures', () => {
    it('records the error, reports it and retries with a doubling backoff', async () => {
        const setup = createIndexerSetup();

        start(setup, 2);

        await expect.poll(() => setup.errors.length).toBe(1);

        expect(setup.errors[0]!.collection).toBe('docs');
        expect((setup.errors[0]!.error as Error).message).toContain('provider unavailable');
        expect((await setup.repository.findOneCollection('docs'))?.error).toContain('provider unavailable');

        setup.clock.advance(KNOWLEDGE_RETRY_MS - 1);
        await new Promise<void>((resolve) => {
            setImmediate(resolve);
        });
        expect(setup.errors).toHaveLength(1);

        setup.clock.advance(1);
        await expect.poll(() => setup.errors.length).toBe(2);

        setup.clock.advance(KNOWLEDGE_RETRY_MS * 2);

        const collection = await waitForReady(setup.repository, 'docs');

        expect(collection.error).toBeUndefined();
        expect(setup.errors).toHaveLength(2);
    });

    it('caps the backoff at KNOWLEDGE_RETRY_MAX_MS', async () => {
        const setup = createIndexerSetup();

        start(setup, 8);

        let delay = KNOWLEDGE_RETRY_MS;

        for (let failure = 1; failure <= 8; failure++) {
            await expect.poll(() => setup.errors.length).toBe(failure);

            if (failure < 8) {
                setup.clock.advance(delay);
                delay = Math.min(delay * 2, KNOWLEDGE_RETRY_MAX_MS);
            }
        }

        // 5 s doubling: 5, 10, 20, 40, 80, 160, then capped at 300
        expect(delay).toBe(KNOWLEDGE_RETRY_MAX_MS);

        setup.clock.advance(KNOWLEDGE_RETRY_MAX_MS - 1);
        await new Promise<void>((resolve) => {
            setImmediate(resolve);
        });
        expect((await setup.repository.findOneCollection('docs'))?.status).toBe('pending');

        setup.clock.advance(1);
        await waitForReady(setup.repository, 'docs');
    });

    it('resolves stop() during the backoff', async () => {
        const setup = createIndexerSetup();
        const knowledge = start(setup, 5);

        await expect.poll(() => setup.errors.length).toBe(1);
        await expect(knowledge.stop()).resolves.toBeUndefined();

        setup.clock.advance(KNOWLEDGE_RETRY_MAX_MS * 10);
        await new Promise<void>((resolve) => {
            setImmediate(resolve);
        });

        expect(setup.errors).toHaveLength(1);
    });

    it('reports a source that throws and keeps the stored documents', async () => {
        const setup = createIndexerSetup();
        const docs = new Map([['a.md', 'Refunds within thirty days.']]);
        let fail = false;
        const source = mapSource(docs);
        const knowledge = createKnowledge(setup.options({
            collections: [knowledgeCollection('docs', {
                model: mockEmbeddingModel(),
                sources: [{
                    kind: 'custom',
                    trusted: true,
                    async* documents(ctx) {
                        if (fail) {
                            throw new Error('source unreachable');
                        }

                        yield* source.documents(ctx);
                    },
                }],
            })],
        }));

        started.push(knowledge);
        knowledge.start();
        await waitForReady(setup.repository, 'docs');
        await knowledge.stop();

        fail = true;
        knowledge.start();

        await expect.poll(() => setup.errors.length).toBe(1);

        expect(await setup.repository.findDocumentIds('docs')).toEqual(['a.md']);
        expect((await setup.repository.findOneCollection('docs'))?.error).toBe('source unreachable');
    });

    it('stores and reports a configuration error once and never retries it', async () => {
        const setup = createIndexerSetup();
        const knowledge = createKnowledge(setup.options({
            collections: [knowledgeCollection('docs', {
                model: mockEmbeddingModel(),
                sources: [defineKnowledgeSource({
                    // eslint-disable-next-line require-yield
                    async* documents() {
                        throw new InvalidAgentDefinitionError('folder(): "docs" is no directory.');
                    },
                })],
            })],
        }));

        started.push(knowledge);
        knowledge.start();

        await expect.poll(() => setup.errors.length).toBe(1);

        expect(setup.errors[0]!.error).toBeInstanceOf(InvalidAgentDefinitionError);
        expect((await setup.repository.findOneCollection('docs'))?.error).toBe('folder(): "docs" is no directory.');

        for (let step = 0; step < 5; step++) {
            setup.clock.advance(KNOWLEDGE_RETRY_MAX_MS);
            await new Promise<void>((resolve) => {
                setImmediate(resolve);
            });
        }

        expect(setup.errors).toHaveLength(1);
    });

    it('gives up an embedding call that never answers and retries it', async () => {
        const setup = createIndexerSetup();
        const calls: AbortSignal[] = [];
        // ignores its abort signal: only the indexer's own timeout ends the wait
        const model = new MockEmbeddingModelV4({
            maxEmbeddingsPerCall: null,
            supportsParallelCalls: true,
            doEmbed: async (options) => {
                calls.push(options.abortSignal!);

                return new Promise(() => {});
            },
        });
        const knowledge = createKnowledge(setup.options({
            collections: [knowledgeCollection('docs', {
                model, 
                sources: [mapSource(new Map([['a.md', 'Refunds within thirty days.']]))], 
            })],
        }));

        started.push(knowledge);
        knowledge.start();

        await expect.poll(() => calls.length).toBe(1);

        setup.clock.advance(KNOWLEDGE_EMBED_TIMEOUT_MS - 1);
        await new Promise<void>((resolve) => {
            setImmediate(resolve);
        });
        expect(setup.errors).toHaveLength(0);

        setup.clock.advance(1);
        await expect.poll(() => setup.errors.length).toBe(1);

        expect(setup.errors[0]!.error).toMatchObject({
            code: KNOWLEDGE_REQUEST_ERROR_CODE,
            message: `The embedding model did not answer within ${KNOWLEDGE_EMBED_TIMEOUT_MS}ms.`,
        });
        expect(calls[0]!.aborted).toBe(true);
        expect((await setup.repository.findOneCollection('docs'))?.error).toContain('did not answer');

        setup.clock.advance(KNOWLEDGE_RETRY_MS);
        await expect.poll(() => calls.length).toBe(2);
    });

    it('contains an onError that throws', async () => {
        const setup = createIndexerSetup();
        const logged = vi.spyOn(console, 'error').mockImplementation(() => {});
        const docs = new Map([['a.md', 'Refunds within thirty days.']]);
        const knowledge = createKnowledge(setup.options({
            collections: [knowledgeCollection('docs', {
                model: mockEmbeddingModel(),
                // both yield a.md: the second is reported
                sources: [mapSource(docs), mapSource(docs)],
            })],
            onError: () => {
                throw new Error('onError threw');
            },
        }));

        try {
            started.push(knowledge);
            knowledge.start();

            await waitForReady(setup.repository, 'docs');

            expect(logged).toHaveBeenCalledWith('[chamvi]', expect.objectContaining({ message: 'onError threw' }), { collection: 'docs' });
        } finally {
            logged.mockRestore();
        }
    });
});
