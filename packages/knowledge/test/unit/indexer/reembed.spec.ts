/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { mockEmbeddingModel } from '@chamvi/test-kit';
import type { EmbeddingModel } from 'ai';
import { 
    afterEach, 
    describe, 
    expect, 
    it, 
} from 'vitest';
import type { IKnowledge } from '@chamvi/knowledge';
import { CHUNKER_VERSION, createKnowledge, knowledgeCollection } from '@chamvi/knowledge';
import type { IndexerSetup } from '../../utils/indexer.ts';
import {
    createIndexerSetup,
    embeddingResolver,
    gatedModel,
    mapSource,
    waitForCollection,
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

function start(setup: IndexerSetup, ref: string, models: Record<string, EmbeddingModel>): IKnowledge {
    const knowledge = createKnowledge(setup.options({
        models: embeddingResolver(models),
        collections: [knowledgeCollection('docs', { model: ref, sources: [mapSource(docs)] })],
    }));

    started.push(knowledge);
    knowledge.start();

    return knowledge;
}

async function queryVector(text: string): Promise<number[]> {
    const [vector] = (await mockEmbeddingModel().doEmbed({ values: [text] })).embeddings;

    return vector!;
}

/** Generation 1 ready at `mock/a`, its indexer stopped. */
async function indexed(setup: IndexerSetup): Promise<void> {
    const knowledge = start(setup, 'mock/a', { 'mock/a': mockEmbeddingModel() });

    await waitForReady(setup.repository, 'docs');
    await knowledge.stop();
}

describe('re-embedding a collection', () => {
    it('writes the next generation while serving the current one, then switches', async () => {
        const setup = createIndexerSetup();

        await indexed(setup);

        const model = gatedModel();

        start(setup, 'mock/b', { 'mock/b': model });

        await expect.poll(() => model.started.length).toBe(1);

        const during = await setup.repository.findOneCollection('docs');

        expect(during).toMatchObject({
            generation: 1,
            model: 'mock/a',
            status: 'stale',
            pending: {
                generation: 2, 
                model: 'mock/b', 
                chunker: CHUNKER_VERSION, 
            },
        });

        const query = await queryVector('refund policy');

        expect((await setup.repository.search('docs', 1, query, { topK: 1 }))[0]?.document).toBe('a.md');

        model.open(0);
        model.open(1);
        model.open(2);

        const after = await waitForReady(setup.repository, 'docs', 2);

        expect(after).toMatchObject({
            model: 'mock/b', 
            dimensions: 64, 
            chunker: CHUNKER_VERSION, 
        });
        expect(after.pending).toBeUndefined();
        expect(await setup.repository.search('docs', 1, query, { topK: 10 })).toEqual([]);
        expect((await setup.repository.search('docs', 2, query, { topK: 1 }))[0]?.document).toBe('a.md');
        expect((await setup.repository.findOneDocument('docs', 'c.md'))?.generation).toBe(2);
    });

    it('resumes an interrupted re-embed at the same pending generation', async () => {
        const setup = createIndexerSetup();

        await indexed(setup);

        const gated = gatedModel({ opened: 1 });
        const interrupted = start(setup, 'mock/b', { 'mock/b': gated });

        await expect.poll(() => gated.started.length).toBe(2);
        expect((await setup.repository.findOneDocument('docs', 'a.md'))?.generation).toBe(2);

        await interrupted.stop();

        expect(await setup.repository.findOneCollection('docs')).toMatchObject({
            generation: 1,
            status: 'stale',
            pending: { generation: 2, model: 'mock/b' },
        });

        const model = mockEmbeddingModel();

        start(setup, 'mock/b', { 'mock/b': model });

        await waitForReady(setup.repository, 'docs', 2);

        expect(model.calls.flatMap((call) => call.values)).toEqual([docs.get('b.md'), docs.get('c.md')]);
    });

    it('drops an abandoned pending generation when the served model comes back', async () => {
        const setup = createIndexerSetup();

        await indexed(setup);

        const gated = gatedModel({ opened: 1 });
        const interrupted = start(setup, 'mock/b', { 'mock/b': gated });

        await expect.poll(() => gated.started.length).toBe(2);
        await interrupted.stop();

        const model = mockEmbeddingModel();

        setup.clock.advance(1000);
        start(setup, 'mock/a', { 'mock/a': model });

        const collection = await waitForCollection(
            setup.repository,
            'docs',
            (found) => found.updatedAt.getTime() === setup.clock.now().getTime() && found.pending === undefined,
        );

        expect(collection).toMatchObject({
            generation: 1, 
            model: 'mock/a', 
            status: 'ready', 
        });
        // a.md was written for generation 2 only: it is embedded again
        expect(model.calls.flatMap((call) => call.values)).toEqual([docs.get('a.md')]);
        expect(await setup.repository.search('docs', 2, await queryVector('refund'), { topK: 10 })).toEqual([]);
    });

    it('moves past an abandoned pending generation for a third model', async () => {
        const setup = createIndexerSetup();

        await indexed(setup);

        const gated = gatedModel({ opened: 1 });
        const interrupted = start(setup, 'mock/b', { 'mock/b': gated });

        await expect.poll(() => gated.started.length).toBe(2);
        await interrupted.stop();

        const model = mockEmbeddingModel();

        start(setup, 'mock/c', { 'mock/c': model });

        const collection = await waitForReady(setup.repository, 'docs', 3);

        expect(collection).toMatchObject({ model: 'mock/c' });
        expect(model.calls.flatMap((call) => call.values)).toHaveLength(3);
        expect(await setup.repository.search('docs', 1, await queryVector('refund'), { topK: 10 })).toEqual([]);
        expect(await setup.repository.search('docs', 2, await queryVector('refund'), { topK: 10 })).toEqual([]);
    });

    it('never reuses the number of an abandoned generation, so its documents are embedded again', async () => {
        const setup = createIndexerSetup();

        await indexed(setup);

        // model B embeds a.md into generation 2, then stops before b.md
        const toB = gatedModel({ opened: 1 });
        const first = start(setup, 'mock/b', { 'mock/b': toB });

        await expect.poll(() => toB.started.length).toBe(2);
        await first.stop();
        expect((await setup.repository.findOneDocument('docs', 'a.md'))?.generation).toBe(2);

        // back to model A: generation 2 is abandoned, then the sync stops while re-embedding a.md
        const back = gatedModel({ modelId: 'mock-model-id' });
        const rollback = start(setup, 'mock/a', { 'mock/a': back });

        await expect.poll(() => back.started.length).toBe(1);
        await rollback.stop();
        expect(await setup.repository.findOneCollection('docs')).toMatchObject({ generation: 1, status: 'ready' });
        expect((await setup.repository.findOneDocument('docs', 'a.md'))?.generation).toBe(2);

        // model B again: a fresh generation, every document embedded into it
        const model = mockEmbeddingModel();

        start(setup, 'mock/b', { 'mock/b': model });

        const collection = await waitForCollection(
            setup.repository,
            'docs',
            (found) => found.status === 'ready' && found.model === 'mock/b',
        );

        expect(collection.generation).toBe(3);
        expect(model.calls.flatMap((call) => call.values)).toEqual(docs.values().toArray());
        expect((await setup.repository.search('docs', 3, await queryVector('refund policy'), { topK: 1 }))[0]?.document).toBe('a.md');
    });

    it('deletes a generation a crash left behind after the switch', async () => {
        const setup = createIndexerSetup();

        await indexed(setup);

        const switched = start(setup, 'mock/b', { 'mock/b': mockEmbeddingModel() });

        await waitForReady(setup.repository, 'docs', 2);
        await switched.stop();

        // what the process left when it died between the switch and its cleanup
        await setup.repository.replaceChunks('docs', 'a.md', 1, [{
            index: 0,
            text: 'left over',
            start: 0,
            end: 9,
            vector: await queryVector('refund'),
        }]);

        setup.clock.advance(1000);
        start(setup, 'mock/b', { 'mock/b': mockEmbeddingModel() });

        await waitForCollection(
            setup.repository,
            'docs',
            (found) => found.updatedAt.getTime() === setup.clock.now().getTime() && found.status === 'ready',
        );

        expect(await setup.repository.search('docs', 1, await queryVector('refund'), { topK: 10 })).toEqual([]);
        expect(await setup.repository.search('docs', 2, await queryVector('refund'), { topK: 10 })).toHaveLength(3);
    });

    it('forgets the previous model\'s dimensions when a re-embed switches without writing a chunk', async () => {
        const setup = createIndexerSetup();
        const own = new Map(docs);
        const run = (ref: string, model: EmbeddingModel) => {
            const knowledge = createKnowledge(setup.options({
                models: embeddingResolver({ [ref]: model }),
                collections: [knowledgeCollection('docs', { model: ref, sources: [mapSource(own)] })],
            }));

            started.push(knowledge);
            knowledge.start();

            return knowledge;
        };
        const first = run('mock/a', mockEmbeddingModel());

        await waitForReady(setup.repository, 'docs');
        await first.stop();

        // the sources yield nothing while the model changes to a smaller one
        own.clear();

        const second = run('mock/b', mockEmbeddingModel({ dimensions: 8 }));
        const switched = await waitForReady(setup.repository, 'docs', 2);

        await second.stop();
        expect(switched.dimensions).toBeUndefined();

        own.set('d.md', 'Deployments roll out one replica at a time.');
        setup.clock.advance(1000);
        run('mock/b', mockEmbeddingModel({ dimensions: 8 }));

        const after = await waitForCollection(
            setup.repository,
            'docs',
            (found) => found.updatedAt.getTime() === setup.clock.now().getTime() && found.status === 'ready',
        );

        expect(after).toMatchObject({ generation: 2, dimensions: 8 });
        expect(after.error).toBeUndefined();
        expect((await setup.repository.findOneDocument('docs', 'd.md'))?.generation).toBe(2);
    });
});
