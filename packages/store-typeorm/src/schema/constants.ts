/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import {
    AgentRevisionEntity,
    ArtifactEntity,
    CheckpointEntity,
    ConversationEntity,
    ConversationItemEntity,
    ConversationNoteEntity,

    ConversationOperationEntity,
    DocEntity,
    EffectEntity,
    IdempotencyKeyEntity,
    KvEntity,
    LockEntity,
    RunEntity,
    StepEntity,
} from '../entities/index.ts';
import {
    AgentRevisions1792627200000,
    Artifacts1792368000000,
    ConversationBindings1792800000000,
    Conversations1792713600000,
    IdempotencyScope1792454400000,
    Init1792195200000,
    KvKeyCollation1792540800000,
} from '../migrations/index.ts';

export const STORE_ENTITIES = [
    RunEntity,
    StepEntity,
    CheckpointEntity,
    IdempotencyKeyEntity,
    LockEntity,
    EffectEntity,
    KvEntity,
    DocEntity,
    ArtifactEntity,
    AgentRevisionEntity,
    ConversationEntity,
    ConversationItemEntity,
    ConversationNoteEntity,
    ConversationOperationEntity,
];

export const STORE_MIGRATIONS = [
    Init1792195200000,
    Artifacts1792368000000,
    IdempotencyScope1792454400000,
    KvKeyCollation1792540800000,
    AgentRevisions1792627200000,
    Conversations1792713600000,
    ConversationBindings1792800000000,
];

export const MIGRATION_LOCK_NAME = 'chamvi:migrations';
