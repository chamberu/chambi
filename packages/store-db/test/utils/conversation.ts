/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { DataSource } from 'typeorm';
import type { ConversationScope, ResolvedConversationLimits, Run } from '@chamvi/core';
import { DatabaseConversationRepository, DatabaseRunRepository } from '@chamvi/store-db';

export async function seedRun(dataSource: DataSource, id: string, overrides: Partial<Run> = {}): Promise<void> {
    const now = new Date('2026-10-28T00:00:00.000Z');

    await new DatabaseRunRepository({ dataSource }).insert({
        id,
        agent: 'helper',
        status: 'running',
        trigger: {
            id,
            agent: 'helper',
            trigger: 'message',
            channel: 'chat',
            payload: {},
            receivedAt: now,
        },
        usage: { inputTokens: 0, outputTokens: 0 },
        createdAt: now,
        updatedAt: now,
        ...overrides,
    });
}

/** Valid lifecycle fixtures create the run before its conversation turn, as Engine does. */
export class SeededConversationRepository extends DatabaseConversationRepository {
    override async beginTurn(scope: ConversationScope, runId: string, text: string, limits: ResolvedConversationLimits) {
        await seedRun(this.dataSource, runId);

        return super.beginTurn(scope, runId, text, limits);
    }
}
