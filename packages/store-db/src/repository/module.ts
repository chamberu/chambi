/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { Repositories } from '@chamvi/core';
import { TypeormRunRepository } from '../run/index.ts';
import { TypeormStepRepository } from '../step/index.ts';
import { TypeormCheckpointRepository } from '../checkpoint/index.ts';
import { TypeormIdempotencyRepository } from '../idempotency/index.ts';
import { TypeormLockRepository } from '../lock/index.ts';
import { TypeormEffectRepository } from '../effect/index.ts';
import { TypeormStateRepository } from '../state/index.ts';
import { TypeormArtifactRepository } from '../artifact/index.ts';
import { TypeormAgentRevisionRepository } from '../agent-revision/index.ts';
import { TypeormConversationRepository } from '../conversation/index.ts';
import type { TypeormRepositoriesOptions } from './types.ts';

/** Assemble capability repositories over one initialized PostgreSQL data source. */
export function createTypeormRepositories(opts: TypeormRepositoriesOptions) {
    return {
        runs: new TypeormRunRepository(opts),
        steps: new TypeormStepRepository(opts),
        checkpoints: new TypeormCheckpointRepository(opts),
        idempotency: new TypeormIdempotencyRepository(opts),
        locks: new TypeormLockRepository(opts),
        effects: new TypeormEffectRepository(opts),
        state: new TypeormStateRepository(opts),
        artifacts: new TypeormArtifactRepository(opts),
        agentRevisions: new TypeormAgentRevisionRepository(opts),
        conversations: new TypeormConversationRepository(opts),
    } satisfies Repositories;
}
