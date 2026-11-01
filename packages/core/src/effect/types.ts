/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { Tool, ToolExecutionOptions } from 'ai';
import type { AgentHooks } from '../agent/types.ts';
import type { ApprovalRequest } from '../engine/execute/types.ts';
import type { IEffectRepository } from '../repository/types.ts';
import type { StateSchema } from '../state/types.ts';
import type { AgentTrust, ToolContext } from '../tool/types.ts';
import type { EFFECT, EFFECT_HOOKS } from './constants.ts';

export type EffectHooks = {
    effectKey?: (input: any, ctx: ToolContext, options: ToolExecutionOptions<any>) => string;
    alreadyApplied?: (effectKey: string, input: any, ctx: ToolContext) => Promise<any>;
};

export type EffectTool<I, O, S extends StateSchema = StateSchema> = Tool<I, O, ToolContext<S>> & {
    [EFFECT]: true;
    [EFFECT_HOOKS]: EffectHooks;
};

/** The tool call an execute runs for (internal): approve() and emit() read it. */
export type ToolCallFrame = {
    runId: string;
    toolCallId: string;
    toolName: string;
    /**
     * The checkpoint step index of the model step that made the call: part of
     * the approval id, so a provider reusing a call id in a later step never
     * reads an earlier step's decision.
     */
    stepIndex: number;
    /** How many approve() calls this tool call made so far. */
    approvals: number;
    /** Automatic bound approvals never consume ordinary approve() ordinals. */
    boundApprovals?: number;
    /** The final-input classification captured before the tool can mutate its input. */
    taint?: boolean;
    /** Set when the outbound gate asked and approved this call: `outboundApproved()` reads it. */
    outboundApproved?: boolean;
    /** Where approve() reads the recorded decisions. */
    effects: IEffectRepository;
    /** Set by the approve() that suspended the call; the wrapper answers it with a placeholder. */
    suspended?: ApprovalRequest;
    /** True while a streaming tool's body runs: approve() is refused there. */
    streaming?: boolean;
};

export type WrapToolsOptions = {
    trust?: AgentTrust;
    /** Re-checks every call: a refused one throws ToolNotAllowedError. */
    allow?: (toolName: string) => boolean;
    /** The agent's tool hooks, run for every call of every tool. */
    hooks?: AgentHooks;
    /**
     * Called when approve() suspended a call (its decision is not recorded
     * yet); the call then resolves with a placeholder that never reaches a
     * checkpoint.
     */
    onSuspend?: (request: ApprovalRequest) => void;
    /** The checkpoint step index of the step whose calls run now (read per call); default 0. */
    stepIndex?: () => number;
};
