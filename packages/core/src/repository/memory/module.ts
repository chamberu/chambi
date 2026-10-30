/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { MemoryConversationRepository } from '../../conversation/memory.ts';
import type { IConversationRepository } from '../../conversation/types.ts';
import type { IStore } from '../types.ts';
import { MemoryAgentRevisionRepository } from './agent-revision.ts';
import { MemoryArtifactRepository } from './artifact.ts';
import { MemoryCheckpointRepository } from './checkpoint.ts';
import { MemoryEffectRepository } from './effect.ts';
import { MemoryIdempotencyRepository } from './idempotency.ts';
import { MemoryLockRepository } from './lock.ts';
import { MemoryRunRepository } from './run.ts';
import { MemoryStateRepository } from './state.ts';
import { MemoryStepRepository } from './step.ts';
import type { MemoryStoreOptions } from './types.ts';

/** Independent in-memory capabilities; each call creates fresh storage. */
export function createMemoryStore(options: MemoryStoreOptions = {}): IStore & { conversations: IConversationRepository } {
    return {
        runs: new MemoryRunRepository(options),
        steps: new MemoryStepRepository(),
        checkpoints: new MemoryCheckpointRepository(),
        idempotency: new MemoryIdempotencyRepository(options),
        locks: new MemoryLockRepository(options),
        effects: new MemoryEffectRepository(),
        state: new MemoryStateRepository(),
        artifacts: new MemoryArtifactRepository(),
        agentRevisions: new MemoryAgentRevisionRepository(),
        conversations: new MemoryConversationRepository(options),
    };
}
