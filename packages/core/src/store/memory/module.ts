/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { MemoryConversationStore } from '../../conversation/memory.ts';
import type { IConversationStore } from '../../conversation/types.ts';
import type { Stores } from '../types.ts';
import { MemoryAgentRevisionStore } from './agent-revision.ts';
import { MemoryArtifactStore } from './artifact.ts';
import { MemoryCheckpointStore } from './checkpoint.ts';
import { MemoryEffectStore } from './effect.ts';
import { MemoryIdempotencyStore } from './idempotency.ts';
import { MemoryLockStore } from './lock.ts';
import { MemoryRunStore } from './run.ts';
import { MemoryStateStore } from './state.ts';
import { MemoryStepStore } from './step.ts';
import type { MemoryStoresOptions } from './types.ts';

/** Independent in-memory capabilities; each call creates fresh storage. */
export function createMemoryStores(options: MemoryStoresOptions = {}): Stores & { conversations: IConversationStore } {
    return {
        runs: new MemoryRunStore(options),
        steps: new MemoryStepStore(),
        checkpoints: new MemoryCheckpointStore(),
        idempotency: new MemoryIdempotencyStore(options),
        locks: new MemoryLockStore(options),
        effects: new MemoryEffectStore(),
        state: new MemoryStateStore(),
        artifacts: new MemoryArtifactStore(),
        agentRevisions: new MemoryAgentRevisionStore(),
        conversations: new MemoryConversationStore(options),
    };
}
