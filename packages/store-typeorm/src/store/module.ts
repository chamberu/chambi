/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { Stores } from '@chamvi/core';
import { TypeormRunStore } from '../run/index.ts';
import { TypeormStepStore } from '../step/index.ts';
import { TypeormCheckpointStore } from '../checkpoint/index.ts';
import { TypeormIdempotencyStore } from '../idempotency/index.ts';
import { TypeormLockStore } from '../lock/index.ts';
import { TypeormEffectStore } from '../effect/index.ts';
import { TypeormStateStore } from '../state/index.ts';
import { TypeormArtifactStore } from '../artifact/index.ts';
import { TypeormAgentRevisionStore } from '../agent-revision/index.ts';
import { TypeormConversationStore } from '../conversation/index.ts';
import type { TypeormStoresOptions } from './types.ts';

/** Assemble capability stores over one initialized PostgreSQL data source. */
export function createTypeormStores(opts: TypeormStoresOptions) {
    return {
        runs: new TypeormRunStore(opts),
        steps: new TypeormStepStore(opts),
        checkpoints: new TypeormCheckpointStore(opts),
        idempotency: new TypeormIdempotencyStore(opts),
        locks: new TypeormLockStore(opts),
        effects: new TypeormEffectStore(opts),
        state: new TypeormStateStore(opts),
        artifacts: new TypeormArtifactStore(opts),
        agentRevisions: new TypeormAgentRevisionStore(opts),
        conversations: new TypeormConversationStore(opts),
    } satisfies Stores;
}
