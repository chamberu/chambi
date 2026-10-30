/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { ConversationSnapshot, IConversations } from '../../conversation/types.ts';
import type { Agent } from '../../agent/types.ts';
import type { ApprovalOption } from '../../approval/types.ts';
import type { IClock } from '../../clock/index.ts';
import type { ContextKey } from '../../context/types.ts';
import type { IModelResolver, ModelRef } from '../../model/types.ts';
import type { Run, Step, Usage } from '../../run/types.ts';
import type { SkillContribution } from '../../skill/types.ts';
import type { IStore } from '../../repository/types.ts';
import type { IEngine, RunDelta } from '../types.ts';

/** A tool call of the checkpoint that has no result yet: suspended by approve(). */
export type PendingToolCall = {
    toolCallId: string;
    toolName: string;
    input: unknown;
};

export type ExecuteContext = {
    /** The executing engine, handed to the execution's ToolContext as `engine`. */
    engine: IEngine;
    conversation?: { capability: IConversations; snapshot: ConversationSnapshot };
    run: Run;
    agent: Agent;
    skills?: SkillContribution;
    /** The model to run: the agent's, else the engine default; undefined fails the run. */
    model: ModelRef | undefined;
    /** Resolves a string model at execution start; without one a string goes to the AI SDK as is. */
    models?: IModelResolver;
    store: Pick<IStore, 'steps' | 'checkpoints' | 'effects' | 'state' | 'artifacts'>;
    clock: IClock;
    /** Aborted by engine.cancel(). */
    signal: AbortSignal;
    /**
     * Settles the run (expects it `running` and claimed by this execution) and
     * emits `run.updated`; resolves undefined without writing once the lease is lost.
     */
    finish: (patch: Partial<Run>) => Promise<Run | undefined>;
    /** Patches the still `running` run and emits `run.updated`. */
    update: (patch: Partial<Run>) => Promise<Run>;
    onStepAppended: (step: Step) => void;
    /** A text or reasoning delta of the model output, while the execution was not abandoned. */
    onDelta: (delta: RunDelta) => void;
    /**
     * Moves the still `running` run to `waiting` on `request` (releasing its
     * claim and slot).
     */
    pause: (request: ApprovalRequest, usage: Usage) => Promise<void>;
    /**
     * False once another owner took the run over (its lease expired and it was
     * recovered); checked before every step and checkpoint write.
     */
    ownsRun?: () => Promise<boolean>;
    /**
     * The engine's provided values (by reference), bound to the execution's
     * ToolContext for inject() before the tools factory runs.
     */
    provided?: ReadonlyMap<ContextKey<unknown>, unknown>;
};

/** What a suspended approve() asks for: the run pauses on it (`Run.waiting`). */
export type ApprovalRequest = {
    /**
     * `<stepIndex>:<toolCallId>:<n>`: the checkpoint step index of the model
     * step that made the call, its call id, n the 0-based ordinal of the
     * approve() within the call.
     */
    approvalId: string;
    toolName: string;
    toolCallId: string;
    title: string;
    body?: string;
    options?: ApprovalOption[];
    /** Set (true) only for a request with options of which several may be selected. */
    multiple?: boolean;
    /** The channel to deliver the request through; none for the inbox and API only. */
    channel?: string;
    address?: string;
    timeoutMs: number;
};
