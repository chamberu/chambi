/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { ModelMessage } from 'ai';
import type { ApprovalOption } from '../approval/types.ts';
import type { ConversationBinding } from '../conversation/types.ts';
import type { TriggerEnvelope } from '../trigger/types.ts';
import type { RunStatus } from './constants.ts';

export type RunStatusLiteral = `${RunStatus}`;

export type Usage = {
    inputTokens: number;
    outputTokens: number;
};

export type Budget = {
    maxSteps: number;
    maxTokens?: number;
    /**
     * Wall-clock limit per execution (not cumulative across resumes): each
     * execution of the run gets the full timeout again.
     */
    timeoutMs?: number;
};

export type RunContext = {
    runId: string;
    agent: string;
    trigger: TriggerEnvelope;
    /** Aborts on cancel, drain, a lost lease or the run timeout, and once the execution has ended. */
    signal: AbortSignal;
};

/** The approval a `waiting` run waits on, as approve() requested it. */
export type WaitPoint = {
    kind: 'approval';
    /** `<stepIndex>:<toolCallId>:<n>` of the stored checkpoint's pending call: never changes after the pause. */
    approvalId: string;
    toolName: string;
    toolCallId: string;
    title: string;
    body?: string;
    /** The choices of the request; absent for a plain yes or no. */
    options?: ApprovalOption[];
    /** Set (true) only when several options may be selected. */
    multiple?: boolean;
    /** The channel the request is delivered through; none for the inbox and API only. */
    channel?: string;
    address?: string;
    expiresAt: Date;
    /** Set once the approval message went out through `channel`; tick() re-sends while it is missing. */
    notifiedAt?: Date;
};

export type Run = {
    id: string;
    agent: string;
    status: RunStatusLiteral;
    trigger: TriggerEnvelope;
    concurrencyKey?: string;
    /** Where the run came from on its channel (`trigger.address`). */
    address?: string;
    output?: unknown;
    /**
     * Why the run failed, or why the registry cancelled it (`agent_replaced`,
     * `agent_removed`); a run cancelled on another replica keeps the reason
     * through the owner's settle, a run that completes anyway loses it.
     */
    error?: { code: string; message: string };
    usage: Usage;
    waiting?: WaitPoint;
    claim?: { owner: string; expiresAt: Date };
    /**
     * Set by cancel() on a replica that does not execute the run: the owner
     * aborts it on its next poll, and a later execution settles it cancelled.
     */
    cancelRequested?: boolean;
    /** The conversation the run belongs to; set by the trusted conversation intake only, never by dispatch(). */
    conversation?: ConversationBinding;
    createdAt: Date;
    updatedAt: Date;
    startedAt?: Date;
    finishedAt?: Date;
};

export type Step = {
    runId: string;
    index: number;
    kind: 'llm' | 'tool' | 'wait';
    name?: string;
    input?: unknown;
    output?: unknown;
    error?: unknown;
    startedAt: Date;
    finishedAt: Date;
};

export type Checkpoint = {
    runId: string;
    stepIndex: number;
    messages: ModelMessage[];
    /** AI SDK finish reason of the step this checkpoint was taken after. */
    finishReason?: string;
    /** Provenance of a conversation run's recalled context (not an authorization). */
    conversation?: {
        scopeId: string;
        generation: number;
        snapshotRunId: string;
    };
    createdAt: Date;
};
