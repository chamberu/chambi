/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { tool } from 'ai';
import type { Tool, ToolExecuteFunction } from 'ai';
import type { StateSchema } from '../state/types.ts';
import { toolContextSchema } from './constants.ts';
import type { ToolContext, ToolTrust } from './types.ts';

/**
 * An AI SDK `tool()` whose `execute` receives the run's ToolContext
 * (`run`, `state`, `artifacts`) as `options.context`. Returns a plain `Tool`.
 */
export function defineTool<I, O, S extends StateSchema = StateSchema>(
    def: Tool<I, O, ToolContext<S>> & {
        execute: ToolExecuteFunction<I, O, ToolContext<S>>;
        contextSchema?: never;
        trust?: ToolTrust<I, S>;
    },
): Tool<I, O, ToolContext<S>> {
    // tool()'s overloads cannot see the generic S
    return tool({ ...def, contextSchema: toolContextSchema } as never) as Tool<I, O, ToolContext<S>>;
}
