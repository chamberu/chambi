/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { isObject } from 'smob';
import type { AgentInstruction, AgentInstructions } from '../agent/types.ts';
import { InvalidAgentDefinitionError, ValidationError } from '../errors/index.ts';
import type { ModelMessage, SystemModelMessage } from './types.ts';

/** Validate the configuration boundary; native SDK validation owns role-specific content. */
export function assertInstructions(value: unknown): asserts value is AgentInstructions {
    if (typeof value === 'string') return;
    if (!Array.isArray(value) || Array.from(value).some((message) => !(isObject(message) &&
        (message.role === 'system' || message.role === 'user' || message.role === 'assistant')))) {
        throw new InvalidAgentDefinitionError('Agent instructions must be a string or an array of system, user or assistant messages.');
    }
}

export function normalizeInstructions(value: AgentInstructions): readonly AgentInstruction[] {
    assertInstructions(value);
    return typeof value === 'string' ? [{ role: 'system', content: value }] : value;
}

/** Only the leading system run can use SDK instructions without reordering examples. */
export function splitInstructions(...values: AgentInstructions[]): { instructions: SystemModelMessage[]; messages: AgentInstruction[] } {
    const instructions: SystemModelMessage[] = [];
    const messages: AgentInstruction[] = [];
    for (const value of values) {
        for (const message of normalizeInstructions(value)) {
            if (message.role === 'system' && messages.length === 0) instructions.push(message);
            else messages.push(message);
        }
    }
    return { instructions, messages };
}

/** SDK system-message opt-in applies only to the trusted configured prefix. */
export function assertTranscriptMessages(messages: ModelMessage[]): void {
    if (messages.some((message) => message.role === 'system')) {
        throw new ValidationError('Run transcript messages must not contain system roles.');
    }
}
