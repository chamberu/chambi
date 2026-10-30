/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { ToolSet } from 'ai';
import { isObject } from 'smob';
import { CONVERSATION_FIELD_MAX_LENGTH } from '../conversation/constants.ts';
import type { AgentDefinition } from './types.ts';
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

/** The configured storage namespace, validated before registration or any store write. */
export function conversationKey(def: Pick<AgentDefinition, 'name' | 'conversation'>): string | undefined {
    const value = def.conversation;
    if (value === undefined || value === false) return undefined;
    if (value === true) return def.name;
    if (!isObject(value) || typeof value.key !== 'string' || value.key.trim().length === 0 ||
        value.key.length > CONVERSATION_FIELD_MAX_LENGTH || /[\p{Cc}\p{Cs}]/u.test(value.key)) {
        throw new InvalidAgentDefinitionError(`Agent "${def.name}" needs a boolean conversation option or an object with a valid key.`);
    }
    return value.key;
}
