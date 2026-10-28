/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { DataSource } from 'typeorm';
import { afterEach, expect, it } from 'vitest';
import { TypeormStore } from '@chamvi/store-typeorm';
import { createTestDataSource, describePostgres } from '../../utils/database.ts';

describePostgres('conversation audit binding persistence', () => {
    let dataSource: DataSource;
    afterEach(async () => { if (dataSource?.isInitialized) await dataSource.destroy(); });
    it('round trips Run binding and real Checkpoint provenance', async () => {
        dataSource = await createTestDataSource();
        const store = new TypeormStore({ dataSource });
        const now = new Date();
        const scope = {
            id: 'a'.repeat(64),
            generation: 7,
            identity: {
                agent: 'helper',
                channel: 'chat',
                account: 'main',
                chat: 'opaque-é',
                audience: 'direct',
            },
        };
        const conversation = { scope, text: 'accepted unicode 🐈' };
        await store.createRun({
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
        expect((await store.getRun('run'))?.conversation).toEqual(conversation);
        const provenance = {
            scopeId: scope.id,
            generation: scope.generation,
            snapshotRunId: 'run',
        };
        await store.saveCheckpoint({
            runId: 'run',
            stepIndex: 0,
            messages: [],
            createdAt: now,
            conversation: provenance,
        });
        expect((await store.latestCheckpoint('run'))?.conversation).toEqual(provenance);
        await store.updateRun('run', { conversation: undefined });
        expect(await store.getRun('run')).not.toHaveProperty('conversation');
    });
});
