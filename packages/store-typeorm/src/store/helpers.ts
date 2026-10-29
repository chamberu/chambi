/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { normalizeEnvelope } from '@chamvi/core';
import type {
    AgentRevision,
    Artifact,
    Checkpoint,
    Run,
    Step,
    TriggerEnvelope,
    WaitPoint,
} from '@chamvi/core';
import type {
    DataSource,
    EntityTarget,
    ObjectLiteral,
    QueryDeepPartialEntity,
} from 'typeorm';
import type {
    AgentRevisionEntity,
    ArtifactEntity,
    CheckpointEntity,
    RunEntity,
    StepEntity,
} from '../entities/index.ts';

/** Run properties that map one to one onto a RunEntity property. */
const RUN_PROPERTIES: ReadonlySet<string> = new Set([
    'agent',
    'status',
    'trigger',
    'concurrencyKey',
    'address',
    'output',
    'error',
    'usage',
    'waiting',
    'cancelRequested',
    'createdAt',
    'updatedAt',
    'startedAt',
    'finishedAt',
]);

/**
 * RunEntity values for the keys present in a run patch (id excluded). A key
 * set to undefined clears its column (null), an absent key is not touched.
 */
export function toRunValues(patch: Partial<Run>): QueryDeepPartialEntity<RunEntity> {
    const values: Record<string, unknown> = {};

    for (const key of Object.keys(patch)) {
        const value = patch[key as keyof Run];
        if (key === 'conversation') {
            const { conversation } = patch;
            values.conversationScopeId = conversation?.scope.id ?? null;
            values.conversationGeneration = conversation?.scope.generation ?? null;
            values.conversationAgent = conversation?.scope.identity.agent ?? null;
            values.conversationChannel = conversation?.scope.identity.channel ?? null;
            values.conversationAccount = conversation?.scope.identity.account ?? null;
            values.conversationChat = conversation?.scope.identity.chat ?? null;
            values.conversationAudience = conversation?.scope.identity.audience ?? null;
            values.conversationText = conversation?.text ?? null;
        } else if (key === 'claim') {
            const claim = value as Run['claim'];
            values.claimOwner = claim ? claim.owner : null;
            values.claimExpiresAt = claim ? claim.expiresAt : null;
        } else if (RUN_PROPERTIES.has(key)) {
            values[key] = value ?? null;
        }
    }

    return values as QueryDeepPartialEntity<RunEntity>;
}

/**
 * Entity values for an insert or upsert. QueryDeepPartialEntity recurses into
 * property types, which rejects the unknown of jsonb properties; the values
 * are checked against the entity instead.
 */
export function asValues<T extends ObjectLiteral>(values: Partial<T>): QueryDeepPartialEntity<T> {
    return values as QueryDeepPartialEntity<T>;
}

/** StepEntity values for a new step (seq is generated). */
export function toStepValues(step: Step): QueryDeepPartialEntity<StepEntity> {
    const values: Omit<StepEntity, 'seq'> = {
        runId: step.runId,
        index: step.index,
        kind: step.kind,
        name: step.name ?? null,
        input: step.input,
        output: step.output,
        error: step.error,
        startedAt: step.startedAt,
        finishedAt: step.finishedAt,
    };

    return asValues<StepEntity>(values);
}

/** CheckpointEntity values for a checkpoint. */
export function toCheckpointValues(cp: Checkpoint): QueryDeepPartialEntity<CheckpointEntity> {
    const values: CheckpointEntity = {
        runId: cp.runId,
        stepIndex: cp.stepIndex,
        messages: cp.messages,
        finishReason: cp.finishReason ?? null,
        conversationScopeId: cp.conversation?.scopeId ?? null,
        conversationGeneration: cp.conversation?.generation ?? null,
        conversationSnapshotRunId: cp.conversation?.snapshotRunId ?? null,
        createdAt: cp.createdAt,
    };

    return asValues<CheckpointEntity>(values);
}

/**
 * Hydrate an entity from a row a RETURNING clause produced, the way TypeORM
 * hydrates selected rows (column metadata and the driver's value preparation).
 */
export function toEntity<T extends ObjectLiteral>(
    dataSource: DataSource,
    target: EntityTarget<T>,
    row: ObjectLiteral,
): T {
    const metadata = dataSource.getMetadata(target);
    const entity = metadata.create() as T;
    for (const column of metadata.columns) {
        column.setEntityValue(entity, dataSource.driver.prepareHydratedValue(row[column.databaseName], column));
    }

    return entity;
}

/** Revive a stored envelope's dates; a pre-channel envelope (`source`, `thread`) reads as the current shape. */
function reviveTrigger(trigger: Record<string, unknown>): TriggerEnvelope {
    const output = normalizeEnvelope({
        ...trigger,
        receivedAt: new Date(trigger.receivedAt as string),
    });
    if (Array.isArray(trigger.attachments)) {
        output.attachments = (trigger.attachments as Record<string, unknown>[]).map((attachment) => ({
            ...attachment,
            createdAt: new Date(attachment.createdAt as string),
        }) as Artifact);
    }

    return output;
}

function reviveWaiting(waiting: Record<string, unknown>): WaitPoint {
    const output = {
        ...waiting,
        expiresAt: new Date(waiting.expiresAt as string),
    } as WaitPoint;
    if (typeof waiting.notifiedAt === 'string') {
        output.notifiedAt = new Date(waiting.notifiedAt);
    }

    return output;
}

/** Map a RunEntity to a Run: null columns become absent properties. */
export function toRun(entity: RunEntity): Run {
    const run: Run = {
        id: entity.id,
        agent: entity.agent,
        status: entity.status,
        trigger: reviveTrigger(entity.trigger),
        usage: entity.usage,
        createdAt: entity.createdAt,
        updatedAt: entity.updatedAt,
    };

    if (entity.conversationScopeId !== null) {
        run.conversation = {
            scope: {
                id: entity.conversationScopeId,
                generation: entity.conversationGeneration!,
                identity: {
                    agent: entity.conversationAgent!,
                    channel: entity.conversationChannel!,
                    account: entity.conversationAccount!,
                    chat: entity.conversationChat!,
                    audience: entity.conversationAudience!,
                },
            },
            text: entity.conversationText!,
        };
    }
    if (entity.concurrencyKey !== null) run.concurrencyKey = entity.concurrencyKey;
    if (entity.address !== null) run.address = entity.address;
    if (entity.output !== null) run.output = entity.output;
    if (entity.error !== null) run.error = entity.error;
    if (entity.waiting !== null) run.waiting = reviveWaiting(entity.waiting);
    if (entity.claimOwner !== null) {
        run.claim = { owner: entity.claimOwner, expiresAt: entity.claimExpiresAt as Date };
    }
    if (entity.cancelRequested !== null) run.cancelRequested = entity.cancelRequested;
    if (entity.startedAt !== null) run.startedAt = entity.startedAt;
    if (entity.finishedAt !== null) run.finishedAt = entity.finishedAt;

    return run;
}

/** Map a StepEntity to a Step: null name/input/output/error become absent. */
export function toStep(entity: StepEntity): Step {
    const step: Step = {
        runId: entity.runId,
        index: entity.index,
        kind: entity.kind,
        startedAt: entity.startedAt,
        finishedAt: entity.finishedAt,
    };
    if (entity.name !== null) step.name = entity.name;
    if (entity.input !== null) step.input = entity.input;
    if (entity.output !== null) step.output = entity.output;
    if (entity.error !== null) step.error = entity.error;

    return step;
}

/** Map a CheckpointEntity to a Checkpoint: a null finish reason becomes absent. */
export function toCheckpoint(entity: CheckpointEntity): Checkpoint {
    const checkpoint: Checkpoint = {
        runId: entity.runId,
        stepIndex: entity.stepIndex,
        messages: entity.messages,
        createdAt: entity.createdAt,
    };
    if (entity.conversationScopeId !== null) {
        checkpoint.conversation = {
            scopeId: entity.conversationScopeId,
            generation: entity.conversationGeneration!,
            snapshotRunId: entity.conversationSnapshotRunId!,
        };
    }
    if (entity.finishReason !== null) checkpoint.finishReason = entity.finishReason;

    return checkpoint;
}

/** ArtifactEntity values for a new artifact: the bytes copied into a Buffer, the bytea parameter the driver expects. */
export function toArtifactValues(artifact: Artifact, data: Uint8Array): QueryDeepPartialEntity<ArtifactEntity> {
    const values: ArtifactEntity = {
        id: artifact.id,
        runId: artifact.runId,
        agent: artifact.agent,
        mediaType: artifact.mediaType,
        filename: artifact.filename ?? null,
        size: artifact.size,
        data: Buffer.from(data),
        createdAt: artifact.createdAt,
    };

    return asValues<ArtifactEntity>(values);
}

/** Map an ArtifactEntity (bytes not selected) to an Artifact: a null filename becomes absent. */
export function toArtifact(entity: ArtifactEntity): Artifact {
    const artifact: Artifact = {
        id: entity.id,
        runId: entity.runId,
        agent: entity.agent,
        mediaType: entity.mediaType,
        size: entity.size,
        createdAt: entity.createdAt,
    };
    if (entity.filename !== null) artifact.filename = entity.filename;

    return artifact;
}

/** Map an AgentRevisionEntity to an AgentRevision. */
export function toAgentRevision(entity: AgentRevisionEntity): AgentRevision {
    return {
        agent: entity.agent,
        hash: entity.hash,
        changedAt: entity.changedAt,
    };
}
