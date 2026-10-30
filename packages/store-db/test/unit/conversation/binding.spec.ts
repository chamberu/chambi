/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { DataSource } from 'typeorm';
import { afterEach, expect, it } from 'vitest';
import { createDatabaseStore } from '@chamvi/store-db';
import { createTestDataSource, describePostgres } from '../../utils/database.ts';
import { seedRun } from '../../utils/conversation.ts';

describePostgres('conversation audit binding persistence', () => {
    let dataSource: DataSource;

    afterEach(async () => {
        if (dataSource?.isInitialized) {
            await dataSource.destroy();
        }
    });
    it('round trips Run binding and real Checkpoint provenance', async () => {
        dataSource = await createTestDataSource();

        const store = createDatabaseStore({ dataSource });
        const now = new Date();
        const identity = {
            agent: 'helper',
            channel: 'chat',
            account: 'main',
            chat: 'opaque-é',
            audience: 'direct',
        };
        const resolved = await store.conversations.resolve(identity);
        const scope = { ...resolved, generation: 7 };
        const conversation = { scope, text: 'accepted unicode 🐈' };

        await store.runs.insert({
            id: 'run',
            agent: 'helper',
            status: 'queued',
            trigger: {
                id: 'e',
                agent: 'helper',
                trigger: 'message',
                channel: 'chat',
                payload: {},
                receivedAt: now,
            },
            usage: { inputTokens: 0, outputTokens: 0 },
            conversation,
            createdAt: now,
            updatedAt: now,
        });
        expect((await store.runs.findOne('run'))?.conversation).toEqual(conversation);

        const provenance = {
            scopeId: scope.id,
            generation: scope.generation,
        };

        await store.checkpoints.save({
            runId: 'run',
            stepIndex: 0,
            messages: [],
            createdAt: now,
            conversation: provenance,
        });
        expect((await store.checkpoints.findOne('run'))?.conversation).toEqual(provenance);
        await store.runs.update('run', { conversation: undefined });
        expect(await store.runs.findOne('run')).not.toHaveProperty('conversation');
    });

    it('updates and clears checkpoint provenance only when replacing the latest checkpoint', async () => {
        dataSource = await createTestDataSource();

        const store = createDatabaseStore({ dataSource });

        await seedRun(dataSource, 'run');

        const scope = await store.conversations.resolve({
            agent: 'helper',
            channel: 'chat',
            account: 'main',
            chat: 'replacement',
            audience: 'direct',
        });
        const checkpoint = {
            runId: 'run',
            stepIndex: 0,
            messages: [],
            createdAt: new Date(),
        };

        await store.checkpoints.save(checkpoint);

        const conversation = { scopeId: scope.id, generation: 1 };

        await store.checkpoints.save({
            ...checkpoint,
            stepIndex: 1,
            conversation,
        });
        expect((await store.checkpoints.findOne('run'))?.conversation).toEqual(conversation);

        const replaced = { ...conversation, generation: 2 };

        await store.checkpoints.save({
            ...checkpoint,
            stepIndex: 1,
            conversation: replaced,
        });
        expect((await store.checkpoints.findOne('run'))?.conversation).toEqual(replaced);
        await store.checkpoints.save(checkpoint);
        expect((await store.checkpoints.findOne('run'))?.conversation).toEqual(replaced);
        await store.checkpoints.save({ ...checkpoint, stepIndex: 2 });
        expect(await store.checkpoints.findOne('run')).not.toHaveProperty('conversation');
    });
});
