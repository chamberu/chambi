/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { 
    afterEach, 
    describe, 
    expect, 
    it, 
} from 'vitest';
import { mockEmbeddingModel, mockModel } from '@chamvi/test-kit';
import type { KnowledgeSearchResult } from '@chamvi/knowledge';
import { createSupport } from '../fixtures/readme-example.ts';
import { waitForReady } from '../utils/indexer.ts';

const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const dirs: string[] = [];
const stops: Array<() => Promise<unknown>> = [];

afterEach(async () => {
    await Promise.all(stops.splice(0).map((stop) => stop()));
    await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('README example', () => {
    it('is the code of test/fixtures/readme-example.ts', () => {
        const readme = read('../../README.md');
        const blocks = readme.matchAll(/```typescript\n([\s\S]*?)```/g).map((m) => m[1]).toArray();

        expect(blocks).toContain(read('../fixtures/readme-example.ts'));
    });

    it('indexes the folder and answers knowledge_search through the engine', async () => {
        const handbook = await mkdtemp(join(tmpdir(), 'chamvi-knowledge-readme-'));

        dirs.push(handbook);
        await writeFile(join(handbook, 'refunds.md'), '# Refunds\n\nOur refund policy: a refund is paid within 30 days.\n');
        await writeFile(join(handbook, 'shipping.md'), '# Shipping\n\nParcels ship within two working days.\n');

        const embedding = mockEmbeddingModel();
        const { engine, knowledge } = createSupport({
            handbook,
            embedding,
            model: mockModel([
                {
                    parts: [{
                        type: 'tool-call',
                        toolName: 'knowledge_search',
                        toolCallId: 'c1',
                        input: { query: 'refund policy' },
                    }],
                },
                { parts: [{ type: 'text', text: 'A refund is paid within 30 days.' }] },
            ]),
        });

        stops.push(() => knowledge.stop(), () => engine.stop());
        knowledge.start();
        await engine.start();

        const ready = await waitForReady(knowledge.repository, 'handbook');

        expect(ready.trusted).toBe(true);

        const { runId } = await engine.dispatch({
            agent: 'support',
            trigger: 'http',
            channel: 'http',
            payload: { question: 'How long does a refund take?' },
        });

        await engine.idle();

        const run = await engine.getRun(runId);

        expect(run?.status).toBe('completed');
        expect(run?.taint).toBeUndefined();

        const search = (await engine.store.steps.find(runId))
            .find((step) => step.kind === 'tool' && step.name === 'knowledge_search');
        const output = search?.output as KnowledgeSearchResult;

        expect(output.matches[0]).toMatchObject({
            collection: 'handbook',
            document: 'refunds.md',
            title: 'Refunds',
            source: 'refunds.md',
        });
        expect(output.truncated).toBe(false);
    });
});
