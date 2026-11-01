/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { mockEmbeddingModel } from '@chamvi/test-kit';
import { 
    afterEach, 
    describe, 
    expect, 
    it, 
} from 'vitest';
import type { IKnowledge, KnowledgeCollectionKind } from '@chamvi/knowledge';
import {
    CHUNKER_VERSION,
    contentHash,
    createKnowledge,
    knowledgeCollection,
} from '@chamvi/knowledge';
import type { IndexerSetup } from '../../utils/indexer.ts';
import {
    createIndexerSetup,
    mapSource,
    waitForCollection,
    waitForReady,
} from '../../utils/indexer.ts';

const started: IKnowledge[] = [];

afterEach(async () => {
    await Promise.all(started.splice(0).map((knowledge) => knowledge.stop()));
});

async function seed(setup: IndexerSetup, name: string, kind: KnowledgeCollectionKind): Promise<void> {
    const now = setup.clock.now();

    await setup.repository.saveCollection({
        name,
        kind,
        trusted: true,
        generation: 1,
        model: 'mock-provider/mock-model-id',
        dimensions: 2,
        chunker: CHUNKER_VERSION,
        status: 'ready',
        createdAt: now,
        updatedAt: now,
    });
    await setup.repository.replaceChunks(name, 'kept.md', 1, [{
        index: 0,
        text: 'kept',
        start: 0,
        end: 4,
        vector: [1, 0],
    }]);
    await setup.repository.saveDocument({
        collection: name,
        id: 'kept.md',
        content: 'kept',
        hash: contentHash('kept'),
        generation: 1,
        updatedAt: now,
    });
}

describe('orphaned collections', () => {
    it('marks a declared record without a definition orphaned and keeps its documents', async () => {
        const setup = createIndexerSetup();

        await seed(setup, 'old', 'declared');

        const knowledge = createKnowledge(setup.options({ collections: [knowledgeCollection('docs', { model: mockEmbeddingModel(), sources: [mapSource(new Map([['a.md', 'text']]))] })] }));

        started.push(knowledge);
        knowledge.start();

        const orphaned = await waitForCollection(setup.repository, 'old', (found) => found.status === 'orphaned');

        expect(orphaned).toMatchObject({ generation: 1, kind: 'declared' });
        expect(await setup.repository.findDocumentIds('old')).toEqual(['kept.md']);
        expect(await setup.repository.search('old', 1, [1, 0], { topK: 1 })).toHaveLength(1);
        await waitForReady(setup.repository, 'docs');
    });

    it('marks orphans also without any declared collection', async () => {
        const setup = createIndexerSetup();

        await seed(setup, 'old', 'declared');

        const knowledge = createKnowledge(setup.options());

        started.push(knowledge);
        knowledge.start();

        await waitForCollection(setup.repository, 'old', (found) => found.status === 'orphaned');
    });

    it('leaves a managed record alone', async () => {
        const setup = createIndexerSetup();

        await seed(setup, 'managed', 'managed');
        await seed(setup, 'old', 'declared');

        const knowledge = createKnowledge(setup.options());

        started.push(knowledge);
        knowledge.start();

        await waitForCollection(setup.repository, 'old', (found) => found.status === 'orphaned');

        expect((await setup.repository.findOneCollection('managed'))?.status).toBe('ready');
    });

    it('serves an orphaned collection again once it is declared again', async () => {
        const setup = createIndexerSetup();
        const model = mockEmbeddingModel();

        await seed(setup, 'old', 'declared');
        await setup.repository.saveCollection({
            ...(await setup.repository.findOneCollectionOrFail('old')),
            status: 'orphaned',
        });

        const knowledge = createKnowledge(setup.options({ collections: [knowledgeCollection('old', { model, sources: [mapSource(new Map([['kept.md', 'kept']]))] })] }));

        started.push(knowledge);
        knowledge.start();

        const collection = await waitForReady(setup.repository, 'old');

        expect(collection.status).toBe('ready');
        // same content, same generation, same model: nothing to embed
        expect(model.calls).toHaveLength(0);
    });

    it('leaves a record alone while another owner holds its lock', async () => {
        const setup = createIndexerSetup();

        await seed(setup, 'old', 'declared');
        expect(await setup.locks.acquire('knowledge:old', 'syncing-replica', 60_000)).toBe(true);

        const knowledge = createKnowledge(setup.options({ collections: [knowledgeCollection('docs', { model: mockEmbeddingModel(), sources: [mapSource(new Map([['a.md', 'text']]))] })] }));

        started.push(knowledge);
        knowledge.start();
        await waitForReady(setup.repository, 'docs');
        await knowledge.stop();

        expect((await setup.repository.findOneCollection('old'))?.status).toBe('ready');
        expect(setup.errors).toEqual([]);
    });
});
