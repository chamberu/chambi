/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { IRunArtifacts } from '../artifact/types.ts';
import type { ToolChannels } from '../channel/types.ts';
import type { RunContext } from '../run/types.ts';
import type { IAgentState, StateSchema } from '../state/types.ts';

/** Run-level trust flags, evaluated on final validated input; omitted flags are false. */
export type ToolTrust<I = any, S extends StateSchema = StateSchema> = {
    /** Taint the whole run before exposing this call's potentially untrusted result or execution error. */
    taint?: boolean | ((input: I, ctx: ToolContext<S>) => boolean | Promise<boolean>);

    /** Apply the agent's approval-or-deny policy before execution if the run is already tainted. */
    guardWhenTainted?: boolean | ((input: I, ctx: ToolContext<S>) => boolean | Promise<boolean>);
};

export type AgentTrust = {
    /** Policy for guarded calls in tainted runs; defaults to 'approve'. */
    onTainted?: 'approve' | 'deny';
    /** Boolean overrides by tool name; false disables the corresponding tool flag. */
    tools?: Record<string, { taint?: boolean; guardWhenTainted?: boolean }>;
};

/**
 * What a chamvi tool gets as `context`: one object per execution, shared by
 * every call and the tools factory. Treat it as immutable. Engine-provided
 * values are reached with `inject(ctx, key)`, never as a field.
 */
export type ToolContext<S extends StateSchema = StateSchema> = {
    /**
     * Run-bound handles on the engine's channels with `out`: `findOne(name?)`
     * (no name: the channel the run came from), `findOneOrFail(name?)`, `find()`.
     */
    channels: ToolChannels;
    run: RunContext;
    state: IAgentState<S>;
    /**
     * The run's artifacts (its attachments and files tools stored). Not an
     * effect: put `put()` inside a `defineEffectTool` to store a file exactly once.
     */
    artifacts: IRunArtifacts;
};
