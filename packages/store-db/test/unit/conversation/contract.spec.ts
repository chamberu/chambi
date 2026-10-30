/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { DataSource } from 'typeorm';
import { afterAll, beforeAll } from 'vitest';
import { describeConversationRepositoryContract } from '@chamvi/test-kit';
import { SeededConversationRepository } from '../../utils/conversation.ts';
import { createTestDataSource, describePostgres, truncateRepository } from '../../utils/database.ts';

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

    describeConversationRepositoryContract(async (clock) => {
        await truncateRepository(dataSource);
        return new SeededConversationRepository({ dataSource, clock });
    });
});
