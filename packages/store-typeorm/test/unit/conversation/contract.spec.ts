/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { DataSource } from 'typeorm';
import { afterAll, beforeAll } from 'vitest';
import { describeConversationStoreContract } from '@chamvi/test-kit';
import { TypeormConversationStore } from '@chamvi/store-typeorm';
import { createTestDataSource, describePostgres, truncateStore } from '../../utils/database.ts';

// The shared contract catches persistence, copying, expiry and replay divergence
// between PostgreSQL and the in-memory implementation.
describePostgres('postgres conversations', () => {
    let dataSource: DataSource;

    beforeAll(async () => {
        dataSource = await createTestDataSource();
    });

    afterAll(async () => {
        await dataSource.destroy();
    });

    describeConversationStoreContract(async (clock) => {
        await truncateStore(dataSource);
        return new TypeormConversationStore({ dataSource, clock });
    });
});
