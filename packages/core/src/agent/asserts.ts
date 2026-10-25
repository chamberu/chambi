/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { ToolSet } from 'ai';
import { InvalidAgentDefinitionError } from '../errors/index.ts';
import { hasToolContext } from '../tool/helpers.ts';

/**
 * Every own key of `toolsContext` must name a tool of `tools` that is not a
 * chamvi tool (those get the run context instead); anything else is a
 * misconfiguration, never silently dropped.
 */
export function assertToolsContext(agent: string, tools: ToolSet, toolsContext: Record<string, unknown>): void {
    for (const name of Object.keys(toolsContext)) {
        const tool = Object.hasOwn(tools, name) ? tools[name] : undefined;
        if (!tool) {
            throw new InvalidAgentDefinitionError(
                `Agent "${agent}": toolsContext entry "${name}" names no tool of the agent.`,
            );
        }
        if (hasToolContext(tool)) {
            throw new InvalidAgentDefinitionError(
                `Agent "${agent}": toolsContext entry "${name}" names a chamvi tool, which gets the run context instead.`,
            );
        }
    }
}

/**
 * No tool may declare the AI SDK's own `needsApproval` (`false` aside):
 * nothing answers that request, so a gate belongs in the agent's hooks.
 */
export function assertNoNeedsApproval(agent: string, tools: ToolSet): void {
    for (const [name, tool] of Object.entries(tools)) {
        const { needsApproval } = tool as { needsApproval?: unknown };
        if (needsApproval !== undefined && needsApproval !== false) {
            throw new InvalidAgentDefinitionError(
                `Agent "${agent}": tool "${name}" declares needsApproval, which nothing answers; gate it in the agent's beforeToolExecution hook instead.`,
            );
        }
    }
}
