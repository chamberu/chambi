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
import { ControllableClock } from '@chamvi/test-kit';
import { TypeormStore } from '@chamvi/store-typeorm';
import { RunEntity } from '../../../src/entities/index.ts';
import { asValues } from '../../../src/store/helpers.ts';
import { createTestDataSource, describePostgres, truncateStore } from '../../utils/database.ts';

describePostgres('TypeormStore legacy envelopes', () => {
    let dataSource: DataSource;
    let store: TypeormStore;

    beforeAll(async () => {
        dataSource = await createTestDataSource();
    });

    beforeEach(async () => {
        await truncateStore(dataSource);
        store = new TypeormStore({ dataSource, clock: new ControllableClock(new Date(10_000)) });
    });

    afterAll(async () => {
        await dataSource.destroy();
    });

    it('a row with trigger { source: \'github\', thread: \'x\' } and thread column \'x\' reads back channel \'github\', address \'x\'', async () => {
        const createdAt = new Date(1_000);
        await dataSource.getRepository(RunEntity)
            .createQueryBuilder()
            .insert()
            .values(asValues<RunEntity>({
                id: 'legacy',
                agent: 'a',
                status: 'queued',
                trigger: {
                    id: 'e1',
                    agent: 'a',
                    trigger: 'github:issues',
                    source: 'github',
                    thread: 'x',
                    payload: { n: 1 },
                    receivedAt: new Date(1_234_567).toISOString(),
                },
                address: 'x',
                usage: { inputTokens: 0, outputTokens: 0 },
                createdAt,
                updatedAt: createdAt,
            }))
            .execute();

        const columns = await dataSource.query('SELECT "thread" FROM "runs" WHERE "id" = $1', ['legacy']);
        expect(columns).toEqual([{ thread: 'x' }]);

        const run = await store.getRun('legacy');
        expect(run!.address).toBe('x');
        expect(run!.trigger.channel).toBe('github');
        expect(run!.trigger.address).toBe('x');
        expect(run!.trigger.receivedAt).toEqual(new Date(1_234_567));
        expect(run!.trigger).not.toHaveProperty('source');
        expect(run!.trigger).not.toHaveProperty('thread');

        const listed = await store.listRuns({});
        expect(listed.data[0]!.trigger.channel).toBe('github');
        expect(listed.data[0]!.address).toBe('x');
    });
});
