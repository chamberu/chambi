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
    expect,
    it,
} from 'vitest';
import { ControllableClock } from '@chamvi/test-kit';
import { createDatabaseRepositories } from '@chamvi/store-db';
import { createTestDataSource, describePostgres } from '../../utils/database.ts';

describePostgres('createDatabaseRepositories purgeExpired', () => {
    let dataSource: DataSource;

    beforeAll(async () => {
        dataSource = await createTestDataSource();
    });

    afterAll(async () => {
        await dataSource.destroy();
    });

    it('removes expired keys and locks only, never effects', async () => {
        const clock = new ControllableClock(new Date(0));
        const store = createDatabaseRepositories({ dataSource, clock });

        await store.idempotency.claim('s', 'k1', 'r1', 1_000);
        await store.idempotency.claim('s', 'k2', 'r2', 5_000);
        await store.locks.acquire('l1', 'o', 1_000);
        await store.locks.acquire('l2', 'o', 5_000);
        await store.effects.save('e', 1);

        clock.advance(1_000);
        await expect(store.idempotency.purgeExpired()).resolves.toBe(1);
        await expect(store.locks.purgeExpired()).resolves.toBe(1);
        await expect(store.idempotency.claim('s', 'k2', 'other', 1_000)).resolves.toEqual({ created: false, runId: 'r2' });
        await expect(store.locks.acquire('l2', 'x', 1)).resolves.toBe(false);
        await expect(store.effects.findOne('e')).resolves.toEqual({ result: 1 });

        await expect(store.idempotency.purgeExpired(new Date(5_000))).resolves.toBe(1);
        await expect(store.locks.purgeExpired(new Date(5_000))).resolves.toBe(1);
    });
});
