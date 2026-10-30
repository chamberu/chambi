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

/** Operator-authored classifications, evaluated on the final validated input. */
export type ToolTrust<I = any, S extends StateSchema = StateSchema> = {
    untrustedResult?: boolean | ((input: I, ctx: ToolContext<S>) => boolean | Promise<boolean>);
    outbound?: boolean | ((input: I, ctx: ToolContext<S>) => boolean | Promise<boolean>);
};

export type AgentTrust = {
    onTainted?: 'approve' | 'deny';
    tools?: Record<string, { untrustedResult?: boolean; outbound?: boolean }>;
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
