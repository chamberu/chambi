/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { Tool, ToolExecuteFunction, ToolExecutionOptions } from 'ai';
import type { StateSchema } from '../state/types.ts';
import { defineTool } from '../tool/define.ts';
import type { ToolContext, ToolTrust } from '../tool/types.ts';
import { EFFECT, EFFECT_HOOKS } from './constants.ts';
import type { EffectHooks, EffectTool } from './types.ts';

/** Hidden marker tools embed in remote artifacts so `alreadyApplied` can find them again. */
export function effectMarker(effectKey: string): string {
    return `<!-- chamvi:effect=${effectKey} -->`;
}

/**
 * A side-effecting tool applied at most once per effect key. Built through
 * `defineTool`, so `execute` and both hooks receive the run's ToolContext.
 */
export function defineEffectTool<I, O, S extends StateSchema = StateSchema>(def: Tool<I, O, ToolContext<S>> & {
    execute: ToolExecuteFunction<I, O, ToolContext<S>>;
    contextSchema?: never;
    trust?: ToolTrust<I, S>;
    /**
     * Default: `${ctx.run.runId}:${toolName}:${stableHash(input)}`.
     * `options` are the AI SDK call options (`toolCallId`, `messages`), e.g. to key by model step.
     */
    effectKey?: (input: I, ctx: ToolContext<S>, options: ToolExecutionOptions<ToolContext<S>>) => string;
    /** Remote reconciliation (e.g. find a comment by its hidden marker). */
    alreadyApplied?: (effectKey: string, input: I, ctx: ToolContext<S>) => Promise<O | undefined>;
}): EffectTool<I, O, S> {
    const {
        effectKey,
        alreadyApplied,
        ...rest
    } = def;
    const defined = defineTool<I, O, S>(rest as typeof def);

    return Object.assign(defined, {
        [EFFECT]: true as const,
        [EFFECT_HOOKS]: {
            effectKey,
            alreadyApplied,
        } as EffectHooks,
    });
}
