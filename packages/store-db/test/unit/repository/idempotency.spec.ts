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
import { DatabaseIdempotencyRepository } from '@chamvi/store-db';
import { createTestDataSource, describePostgres, truncateRepository } from '../../utils/database.ts';

describePostgres('DatabaseIdempotencyRepository idempotency keys', () => {
    let dataSource: DataSource;
    let store: DatabaseIdempotencyRepository;

    beforeAll(async () => {
        dataSource = await createTestDataSource();
    });

    beforeEach(async () => {
        await truncateRepository(dataSource);
        store = new DatabaseIdempotencyRepository({ dataSource, clock: new ControllableClock(new Date(10_000)) });
    });

    afterAll(async () => {
        await dataSource.destroy();
    });

    it('takes a scope that carries an encoded invoker (up to 1024 characters)', async () => {
        // <agent>:<source>:<kind>:<id> with a 255-character subject, every character encoded
        const scope = `${'a'.repeat(64)}:webhook:user:${encodeURIComponent('é'.repeat(150))}`;

        expect(scope.length).toBeLessThanOrEqual(1024);
        expect(scope.length).toBeGreaterThan(255);

        await expect(store.claim(scope, 'k', 'r1', 1_000)).resolves.toEqual({ created: true, runId: 'r1' });
        await expect(store.claim(scope, 'k', 'r2', 1_000)).resolves.toEqual({ created: false, runId: 'r1' });
    });
});
