/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { Repositories } from '@chamvi/core';
import { DatabaseRunRepository } from '../run/index.ts';
import { DatabaseStepRepository } from '../step/index.ts';
import { DatabaseCheckpointRepository } from '../checkpoint/index.ts';
import { DatabaseIdempotencyRepository } from '../idempotency/index.ts';
import { DatabaseLockRepository } from '../lock/index.ts';
import { DatabaseEffectRepository } from '../effect/index.ts';
import { DatabaseStateRepository } from '../state/index.ts';
import { DatabaseArtifactRepository } from '../artifact/index.ts';
import { DatabaseAgentRevisionRepository } from '../agent-revision/index.ts';
import { DatabaseConversationRepository } from '../conversation/index.ts';
import type { DatabaseRepositoriesOptions } from './types.ts';

/** Assemble capability repositories over one initialized PostgreSQL data source. */
export function createDatabaseRepositories(opts: DatabaseRepositoriesOptions) {
    return {
        runs: new DatabaseRunRepository(opts),
        steps: new DatabaseStepRepository(opts),
        checkpoints: new DatabaseCheckpointRepository(opts),
        idempotency: new DatabaseIdempotencyRepository(opts),
        locks: new DatabaseLockRepository(opts),
        effects: new DatabaseEffectRepository(opts),
        state: new DatabaseStateRepository(opts),
        artifacts: new DatabaseArtifactRepository(opts),
        agentRevisions: new DatabaseAgentRevisionRepository(opts),
        conversations: new DatabaseConversationRepository(opts),
    } satisfies Repositories;
}
