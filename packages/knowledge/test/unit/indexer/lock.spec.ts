/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { mockEmbeddingModel } from '@chamvi/test-kit';
import type { EmbeddingModel } from 'ai';
import { MockEmbeddingModelV4 } from 'ai/test';
import { 
    afterEach, 
    describe, 
    expect, 
    it, 
    vi,
} from 'vitest';
import type { IKnowledge, IKnowledgeSource, KnowledgeCollection } from '@chamvi/knowledge';
import {
    KNOWLEDGE_LOCK_TTL_MS,
    KNOWLEDGE_RETRY_MS,
    createKnowledge,
    defineKnowledgeSource,
    knowledgeCollection,
} from '@chamvi/knowledge';
import type { IndexerSetup } from '../../utils/indexer.ts';
import {
    createIndexerSetup,
    gatedModel,
    mapSource,
    waitForReady,
} from '../../utils/indexer.ts';

const started: IKnowledge[] = [];

afterEach(async () => {
    await Promise.all(started.splice(0).map((knowledge) => knowledge.stop()));
});

const docs = new Map([
    ['a.md', 'Our refund policy allows returns within thirty days.'],
    ['b.md', 'Kubernetes pods are scheduled onto nodes.'],
    ['c.md', 'Invoices are sent on the first day of each month.'],
]);

function start(setup: IndexerSetup, owner: string, model: EmbeddingModel, source: IKnowledgeSource = mapSource(docs)): IKnowledge {
    const knowledge = createKnowledge(setup.options({
        owner,
        collections: [knowledgeCollection('docs', { model, sources: [source] })],
    }));

    started.push(knowledge);
    knowledge.start();

    return knowledge;
}

/**
 * The documents of `docs`, holding after the first one until opened: the
 * clock moves while no embedding call (and so no embedding timeout) is open.
 */
function gatedSource(): {
    source: IKnowledgeSource; 
    open: () => void; 
    held: () => boolean 
} {
    const gate = Promise.withResolvers<void>();
    let held = false;

    return {
        source: defineKnowledgeSource({
            async* documents() {
                const [first, ...rest] = [...docs];

                yield { id: first![0], content: first![1] };
                held = true;
                await gate.promise;

                for (const [id, content] of rest) {
                    yield { id, content };
                }
            },
        }),
        open: () => gate.resolve(),
        held: () => held,
    };
}

function acquiresOf(setup: IndexerSetup, owner: string): boolean[] {
    return setup.locks.acquired.filter((entry) => entry.owner === owner).map((entry) => entry.result);
}

function failingModel(): MockEmbeddingModelV4 {
    return new MockEmbeddingModelV4({
        maxEmbeddingsPerCall: null,
        supportsParallelCalls: true,
        doEmbed: async () => {
            throw new Error('provider unavailable');
        },
    });
}

async function settle(): Promise<void> {
    for (let i = 0; i < 20; i++) {
        await new Promise<void>((resolve) => {
            setImmediate(resolve);
        });
    }
}

describe('the indexing lock', () => {
    it('embeds once across two replicas; the loser syncs after the winner, finding nothing to embed', async () => {
        const setup = createIndexerSetup();
        const model = mockEmbeddingModel();

        start(setup, 'replica-a', model);
        start(setup, 'replica-b', model);

        await waitForReady(setup.repository, 'docs');
        await expect.poll(() => setup.locks.acquired.length).toBe(2);

        expect(setup.locks.acquired.every((entry) => entry.key === 'knowledge:docs')).toBe(true);
        expect(acquiresOf(setup, 'replica-a')).toEqual([true]);
        expect(acquiresOf(setup, 'replica-b')).toEqual([false]);
        expect(model.calls.flatMap((call) => call.values)).toHaveLength(3);

        setup.clock.advance(KNOWLEDGE_RETRY_MS);
        await settle();
        setup.clock.advance(KNOWLEDGE_RETRY_MS * 10);
        await settle();

        // the loser took the lock once it was free and synced its own sources: unchanged, nothing embedded
        expect(acquiresOf(setup, 'replica-b')).toEqual([false, true]);
        expect(model.calls.flatMap((call) => call.values)).toHaveLength(3);
        expect(setup.errors).toEqual([]);
    });

    it('lets a replica with changed sources index them once the holder released the lock', async () => {
        const setup = createIndexerSetup();
        const gated = gatedSource();

        start(setup, 'replica-a', mockEmbeddingModel(), gated.source);

        await expect.poll(() => gated.held()).toBe(true);

        const changed = new Map([
            ['a.md', 'Our refund policy allows returns within thirty days.'],
            ['d.md', 'Deployments roll out one replica at a time.'],
        ]);

        start(setup, 'replica-b', mockEmbeddingModel(), mapSource(changed));

        await expect.poll(() => acquiresOf(setup, 'replica-b')).toEqual([false]);

        gated.open();
        await waitForReady(setup.repository, 'docs');

        await vi.waitFor(async () => {
            setup.clock.advance(KNOWLEDGE_RETRY_MS);
            await settle();

            expect(await setup.repository.findOneDocument('docs', 'd.md')).toBeDefined();
        });

        expect(await setup.repository.findDocumentIds('docs')).toEqual(['a.md', 'd.md']);
        expect(setup.errors).toEqual([]);
    });

    it('renews the lock after embedding and writes nothing once it was lost meanwhile', async () => {
        const setup = createIndexerSetup();
        const model = gatedModel({ modelId: 'mock-model-id' });
        // three embedding batches (64 chunks each at most)
        const long = Array.from({ length: 150 }, (_, i) => `Paragraph ${i} ${'x'.repeat(1700)}`).join('\n\n');

        start(setup, 'replica-a', model, mapSource(new Map([['long.md', long]])));

        for (let n = 0; n < 3; n++) {
            await expect.poll(() => model.started.length).toBe(n + 1);
            // below the embedding timeout per call, past half the lease in all
            setup.clock.advance(59_000);

            if (n < 2) {
                model.open(n);
            }
        }

        // the lease is taken over while the last batch is embedded
        await setup.locks.release('knowledge:docs', 'replica-a');
        expect(await setup.locks.acquire('knowledge:docs', 'intruder', KNOWLEDGE_LOCK_TTL_MS)).toBe(true);
        model.open(2);

        await expect.poll(() => acquiresOf(setup, 'replica-a')).toEqual([true, false]);
        await settle();

        expect(await setup.repository.findOneDocument('docs', 'long.md')).toBeUndefined();
        expect(await setup.repository.search('docs', 1, (await mockEmbeddingModel().doEmbed({ values: ['x'] })).embeddings[0]!, { topK: 5 })).toEqual([]);
        expect(setup.errors).toEqual([]);
    });

    it('lets the loser take over when the winner gave up before ready', async () => {
        const setup = createIndexerSetup();
        const gated = gatedModel({ modelId: 'mock-model-id' });
        const winner = start(setup, 'replica-a', gated);
        const model = mockEmbeddingModel();

        start(setup, 'replica-b', model);

        await expect.poll(() => gated.started.length).toBe(1);
        await winner.stop();

        setup.clock.advance(KNOWLEDGE_RETRY_MS);

        await waitForReady(setup.repository, 'docs');

        expect(acquiresOf(setup, 'replica-b')).toEqual([false, true]);
        expect(model.calls.flatMap((call) => call.values)).toHaveLength(3);
    });

    it('renews the lock once half its TTL has passed', async () => {
        const setup = createIndexerSetup();
        const gated = gatedSource();

        start(setup, 'replica-a', mockEmbeddingModel(), gated.source);

        await expect.poll(() => gated.held()).toBe(true);

        setup.clock.advance((KNOWLEDGE_LOCK_TTL_MS / 2) + 1);
        gated.open();

        await waitForReady(setup.repository, 'docs');

        expect(acquiresOf(setup, 'replica-a')).toEqual([true, true]);
    });

    it('abandons the sync without an error when another owner took the lock', async () => {
        const setup = createIndexerSetup();
        const model = mockEmbeddingModel();
        const gated = gatedSource();

        start(setup, 'replica-a', model, gated.source);

        await expect.poll(() => gated.held()).toBe(true);

        setup.clock.advance(KNOWLEDGE_LOCK_TTL_MS + 1);
        expect(await setup.locks.acquire('knowledge:docs', 'intruder', KNOWLEDGE_LOCK_TTL_MS)).toBe(true);

        gated.open();

        await expect.poll(() => acquiresOf(setup, 'replica-a')).toEqual([true, false]);
        await settle();

        expect(model.calls).toHaveLength(1);
        expect(await setup.repository.findOneDocument('docs', 'b.md')).toBeUndefined();
        expect((await setup.repository.findOneCollection('docs'))?.status).toBe('pending');
        expect(setup.errors).toEqual([]);
    });

    it('stores a failure while it holds the lock, so a replica that indexes afterwards keeps its record', async () => {
        const setup = createIndexerSetup();
        const save = setup.repository.saveCollection.bind(setup.repository);
        const gate = Promise.withResolvers<void>();
        let gated: KnowledgeCollection | undefined;

        // hold the first record write carrying an error (replica A's failure)
        setup.repository.saveCollection = async (collection) => {
            if (collection.error !== undefined && !gated) {
                gated = collection;
                await gate.promise;
            }

            return save(collection);
        };

        const replicaA = start(setup, 'replica-a', failingModel());

        await expect.poll(() => gated !== undefined).toBe(true);

        start(setup, 'replica-b', mockEmbeddingModel());

        await expect.poll(() => acquiresOf(setup, 'replica-b')).toHaveLength(1);

        const whileWriting = acquiresOf(setup, 'replica-b');

        gate.resolve();

        // A still held the lock while it wrote its error
        expect(whileWriting).toEqual([false]);

        await expect.poll(() => setup.errors.length).toBe(1);
        // A gives up (its provider stays down): B takes the next attempt
        await replicaA.stop();

        await vi.waitFor(async () => {
            setup.clock.advance(KNOWLEDGE_RETRY_MS);
            await settle();

            expect(await setup.repository.findOneCollection('docs')).toMatchObject({ generation: 1, status: 'ready' });
        });
    });

    it('backs off per collection, not per replica', async () => {
        const setup = createIndexerSetup();
        let calls = 0;
        const model = new MockEmbeddingModelV4({
            maxEmbeddingsPerCall: null,
            supportsParallelCalls: true,
            doEmbed: async () => {
                calls++;

                throw new Error('provider unavailable');
            },
        });

        start(setup, 'replica-a', model);
        start(setup, 'replica-b', model);

        await expect.poll(() => calls).toBe(1);

        const seen: number[] = [];

        for (let step = 1; step <= 7; step++) {
            setup.clock.advance(KNOWLEDGE_RETRY_MS);
            await settle();
            seen.push(calls);
        }

        // attempts at 0, 5, 15 and 35 s, whichever replica takes each
        expect(seen).toEqual([2, 2, 3, 3, 3, 3, 4]);
        expect(await setup.repository.findOneCollection('docs')).toMatchObject({
            failures: 4,
            retryAt: new Date(setup.clock.now().getTime() + (KNOWLEDGE_RETRY_MS * 8)),
        });
    });

    it('reports a failed lock acquire without touching the record', async () => {
        const setup = createIndexerSetup();
        const first = start(setup, 'replica-a', mockEmbeddingModel());

        await waitForReady(setup.repository, 'docs');
        await first.stop();

        const ready = await setup.repository.findOneCollection('docs');
        const acquire = setup.locks.acquire.bind(setup.locks);
        let failures = 1;

        setup.locks.acquire = async (key, owner, ttlMs) => {
            if (failures > 0) {
                failures--;

                throw new Error('lock store down');
            }

            return acquire(key, owner, ttlMs);
        };

        start(setup, 'replica-b', mockEmbeddingModel());

        await expect.poll(() => setup.errors.length).toBe(1);

        expect((setup.errors[0]!.error as Error).message).toBe('lock store down');
        expect(await setup.repository.findOneCollection('docs')).toEqual(ready);
    });
});
