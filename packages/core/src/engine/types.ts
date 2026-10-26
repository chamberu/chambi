/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { Agent } from '../agent/types.ts';
import type { ArtifactInput } from '../artifact/types.ts';
import type { IChannel } from '../channel/types.ts';
import type { IClock } from '../clock/index.ts';
import type { IModelResolver, ModelRef } from '../model/types.ts';
import type { Run, Step } from '../run/types.ts';
import type { IStore } from '../store/types.ts';
import type { Invoker, TriggerEnvelope } from '../trigger/types.ts';

/**
 * A piece of model output while it streams; never stored. `step` is the
 * checkpoint step index the step it belongs to is saved under.
 */
export type RunDelta = {
    runId: string;
    step: number;
    kind: 'text' | 'reasoning';
    text: string;
};

export type RunEvent = { type: 'run.updated'; run: Run } |
    { type: 'step.appended'; step: Step } |
    { type: 'run.delta'; delta: RunDelta };

/** An agent was added, replaced or removed on this engine; local like the run events. */
export type AgentChange = {
    type: 'agents.changed';
    name: string;
    kind: 'added' | 'replaced' | 'removed';
};

/** Every event Engine.on() delivers. */
export type EngineEvent = RunEvent | AgentChange;

export type EngineOptions = {
    store: IStore;
    agents: Agent[];
    /**
     * The channels runs come from and talk to; names unique. start() starts
     * them after the first recover, drain() and stop() stop them first.
     */
    channels?: IChannel<any, any>[];
    /**
     * The default model of agents without one; a string default is checked
     * through `models` at construction.
     */
    model?: ModelRef;
    /**
     * Resolves `'<provider>/<model id>'` strings. Registration (constructor,
     * putAgent) checks every string ref through it; without it a string ref is
     * an `InvalidAgentDefinitionError`.
     */
    models?: IModelResolver;
    /** Default `${hostname}-${pid}`. */
    owner?: string;
    /** Default 4. */
    maxConcurrentRuns?: number;
    /** Default 60_000, renewed every ttl/3 while running. */
    claimTtlMs?: number;
    clock?: IClock;
    /** Receives errors that have no caller to throw to. Default console.error. */
    onError?: (error: unknown, run?: Run) => void;
};

export type DispatchEnvelope = Omit<TriggerEnvelope, 'id' | 'receivedAt' | 'attachments'> &
    Partial<Pick<TriggerEnvelope, 'id' | 'receivedAt'>> & {
        /** Files to start the run with; stored as artifacts of the run before it is created. */
        attachments?: ArtifactInput[];
    };

/** An answer to the run's current wait point (`Engine.approve()`). */
export type ApprovalAnswer = {
    /** Must equal `run.waiting.approvalId`, else InvalidRunStateError. */
    approvalId: string;
    approved: boolean;
    reason?: string;
    /** Who answered; recorded on the wait step (\`output.approver\`). */
    approver?: Invoker;
};

export type EngineStartOptions = {
    /** Default true; false starts no channel (a one-shot job never starts schedules or sockets). */
    channels?: boolean;
};
