/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { DataSource } from 'typeorm';
import {
    afterAll,
    beforeAll,
    beforeEach,
    expect,
    it,
} from 'vitest';
import type { Checkpoint } from '@chamvi/core';
import { ControllableClock } from '@chamvi/test-kit';
import { createTypeormStores } from '@chamvi/store-typeorm';
import type { TypeormStores } from '@chamvi/store-typeorm';
import { createTestDataSource, describePostgres, truncateStore } from '../../utils/database.ts';
import { seedRun } from '../../utils/conversation.ts';

describePostgres('createTypeormStores values', () => {
    let dataSource: DataSource;
    let store: TypeormStores;

    beforeAll(async () => {
        dataSource = await createTestDataSource();
    });

    beforeEach(async () => {
        await truncateStore(dataSource);
        store = createTypeormStores({ dataSource, clock: new ControllableClock(new Date(10_000)) });
    });

    afterAll(async () => {
        await dataSource.destroy();
    });

    it('jsonb values round-trip arrays, null and strings', async () => {
        await seedRun(dataSource, 'r1');
        await store.state.kvSet('a', 'arr', [1, 2]);
        await expect(store.state.kvGet('a', 'arr')).resolves.toEqual([1, 2]);
        await store.state.kvSet('a', 'n', null);
        await expect(store.state.kvGet('a', 'n')).resolves.toBeNull();
        await store.state.kvSet('a', 's', 'text');
        await expect(store.state.kvGet('a', 's')).resolves.toBe('text');
        await store.state.kvSet('a', 'arr', undefined);
        await expect(store.state.kvGet('a', 'arr')).resolves.toBeUndefined();

        await store.effects.putEffect('e', [1]);
        await expect(store.effects.getEffect('e')).resolves.toEqual({ result: [1] });
        await store.effects.putEffect('u', undefined);
        await expect(store.effects.getEffect('u')).resolves.toEqual({ result: null });
        await expect(store.effects.getEffect('missing')).resolves.toBeUndefined();

        const step = {
            runId: 'r1',
            index: 0,
            kind: 'tool' as const,
            name: 'lookup',
            input: ['x'],
            output: 'done',
            startedAt: new Date(1_000),
            finishedAt: new Date(2_000),
        };
        await store.steps.appendStep(step);
        const steps = await store.steps.listSteps('r1');
        expect(steps).toEqual([step]);
        expect(Object.keys(steps[0]!)).not.toContain('error');

        await store.state.docUpsert('a', 'c', '1', [1]);
        await expect(store.state.docList('a', 'c')).resolves.toEqual([{ id: '1', doc: [1] }]);
        await store.state.docUpsert('a', 'c', 'n', null);
        await expect(store.state.docList('a', 'c')).resolves.toContainEqual({ id: 'n', doc: null });

        const cp: Checkpoint = {
            runId: 'r1',
            stepIndex: 1,
            messages: [
                {
                    role: 'assistant',
                    content: [{
                        type: 'tool-call',
                        toolCallId: 'c1',
                        toolName: 'lookup',
                        input: { q: 'x' },
                    }],
                },
            ],
            finishReason: 'tool-calls',
            createdAt: new Date(3_000),
        };
        await store.checkpoints.saveCheckpoint(cp);
        await expect(store.checkpoints.latestCheckpoint('r1')).resolves.toEqual(cp);
    });

    it('listSteps orders by index, then insertion', async () => {
        await seedRun(dataSource, 'r1');
        const at = new Date(1_000);
        for (const [index, name] of [[2, 'two'], [0, 'zero'], [1, 'one-a'], [1, 'one-b']] as const) {
            await store.steps.appendStep({
                runId: 'r1',
                index,
                kind: 'llm',
                name,
                startedAt: at,
                finishedAt: at,
            });
        }
        const steps = await store.steps.listSteps('r1');
        expect(steps.map((s) => s.name)).toEqual(['zero', 'one-a', 'one-b', 'two']);
    });

    it('stores NUL characters and lone surrogates as U+FFFD, keeping escaped text and surrogate pairs', async () => {
        const raw = {
            nul: 'a\u0000b',
            'k\u0000': 1,
            lone: 'x\uD800y\uDC00z',
            pair: 'emoji \uD83D\uDE00',
            literal: '\\u0000 and \\\u0000 and \\uD800',
        };
        const clean = {
            nul: 'a\uFFFDb',
            'k\uFFFD': 1,
            lone: 'x\uFFFDy\uFFFDz',
            pair: 'emoji \uD83D\uDE00',
            literal: '\\u0000 and \\\uFFFD and \\uD800',
        };

        await store.state.kvSet('a', 'k', raw);
        await expect(store.state.kvGet('a', 'k')).resolves.toEqual(clean);

        await store.effects.putEffect('e', raw);
        await expect(store.effects.getEffect('e')).resolves.toEqual({ result: clean });

        await store.state.docUpsert('a', 'c', '1', raw);
        await expect(store.state.docList('a', 'c', { where: { nul: 'a\u0000b' } }))
            .resolves.toEqual([{ id: '1', doc: clean }]);

        const at = new Date(1_000);
        await store.runs.createRun({
            id: 'r1',
            agent: 'a',
            status: 'queued',
            trigger: {
                id: 't1',
                agent: 'a',
                trigger: 'http',
                channel: 'http',
                payload: raw,
                receivedAt: at,
            },
            usage: { inputTokens: 0, outputTokens: 0 },
            createdAt: at,
            updatedAt: at,
        });
        await store.steps.appendStep({
            runId: 'r1',
            index: 0,
            kind: 'tool',
            input: raw,
            output: raw,
            error: raw,
            startedAt: at,
            finishedAt: at,
        });
        const [step] = await store.steps.listSteps('r1');
        expect(step).toMatchObject({
            input: clean,
            output: clean,
            error: clean,
        });

        await store.checkpoints.saveCheckpoint({
            runId: 'r1',
            stepIndex: 0,
            messages: [{ role: 'user', content: raw.nul }],
            createdAt: at,
        });
        expect((await store.checkpoints.latestCheckpoint('r1'))?.messages).toEqual([{ role: 'user', content: clean.nul }]);

        await store.runs.updateRun('r1', { output: raw });
        const run = await store.runs.getRun('r1');
        expect(run?.trigger.payload).toEqual(clean);
        expect(run?.output).toEqual(clean);
    });

    it('docList where with an undefined value matches object documents lacking the key, as MemoryStateStore does', async () => {
        await store.state.docUpsert('a', 'c', '1', { a: 1 });
        await store.state.docUpsert('a', 'c', '2', { b: 1 });
        await store.state.docUpsert('a', 'c', '3', [1]);
        await store.state.docUpsert('a', 'c', '4', { a: 2, b: 1 });
        await store.state.docUpsert('a', 'c', '5', null);

        const ids = async (where: Record<string, unknown>) => (await store.state.docList('a', 'c', { where })).map((d) => d.id);
        await expect(ids({ a: undefined })).resolves.toEqual(['2']);
        await expect(ids({ a: undefined, b: 1 })).resolves.toEqual(['2']);
        await expect(ids({ b: 1 })).resolves.toEqual(['2', '4']);
        await expect(ids({ a: undefined, c: undefined })).resolves.toEqual(['2']);
    });

    it('docList where matches nested values by containment, null values and respects limit', async () => {
        await store.state.docUpsert('a', 'c', '1', { nested: { x: [1, 2], y: 1 }, k: null });
        await store.state.docUpsert('a', 'c', '2', { nested: { x: [3] }, k: 1 });
        await store.state.docUpsert('a', 'c', '3', { k: null });

        const ids = async (q: { where?: Record<string, unknown>; limit?: number }) => (await store.state.docList('a', 'c', q)).map((d) => d.id);
        await expect(ids({ where: { nested: { x: [1] } } })).resolves.toEqual(['1']);
        await expect(ids({ where: { k: null } })).resolves.toEqual(['1', '3']);
        await expect(ids({ where: { k: null }, limit: 1 })).resolves.toEqual(['1']);
        await expect(ids({ where: {} })).resolves.toEqual(['1', '2', '3']);
    });

    it('docUpsert with an undefined doc reads back a JSON null', async () => {
        await store.state.docUpsert('a', 'c', 'u', undefined);
        await expect(store.state.docList('a', 'c')).resolves.toEqual([{ id: 'u', doc: null }]);
    });
});
