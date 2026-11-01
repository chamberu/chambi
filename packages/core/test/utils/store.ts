/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { MemoryConversationRepository } from '../../src/conversation/memory.ts';
import type { IClock } from '../../src/clock/index.ts';
import {
    MemoryCheckpointRepository,
    MemoryStepRepository,
    createMemoryStore,
} from '../../src/repository/index.ts';
import type { MemoryRunRepository } from '../../src/repository/index.ts';

/**
 * createMemoryStore() with another run repository: the run-referencing
 * capabilities check their run ids against it, as the store wires its own.
 */
export function createMemoryStoreWithRuns<T extends MemoryRunRepository>(runs: T, options: { clock?: IClock } = {}) {
    const hasRun = (runId: string) => runs.has(runId);

    return {
        ...createMemoryStore(options),
        runs,
        steps: new MemoryStepRepository({ hasRun }),
        checkpoints: new MemoryCheckpointRepository({ hasRun }),
        conversations: new MemoryConversationRepository({ ...options, hasRun }),
    };
}
