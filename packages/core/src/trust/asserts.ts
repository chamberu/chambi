/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { ToolSet } from 'ai';
import { isObject } from 'smob';
import { InvalidAgentDefinitionError } from '../errors/index.ts';
import type { AgentTrust, ToolTrust } from '../tool/types.ts';

const TOOL_TRUST_FLAGS = ['taint', 'guardWhenTainted'];

/**
 * Refuses a tool-level `trust` that is no object of the known flags, each a
 * boolean or a predicate: a misspelled flag or a string value would otherwise
 * leave the tool silently untainted and ungated.
 */
export function assertToolTrust(trust: unknown, name?: string): asserts trust is ToolTrust | undefined {
    if (trust === undefined) {
        return;
    }

    const label = name === undefined ? 'a tool' : `tool "${name}"`;

    if (!isObject(trust)) {
        throw new InvalidAgentDefinitionError(`The trust of ${label} must be an object of taint and guardWhenTainted flags.`);
    }

    for (const [key, value] of Object.entries(trust)) {
        if (!TOOL_TRUST_FLAGS.includes(key)) {
            throw new InvalidAgentDefinitionError(`The trust of ${label} has an unknown flag "${key}" (taint, guardWhenTainted).`);
        }

        if (value !== undefined && typeof value !== 'boolean' && typeof value !== 'function') {
            throw new InvalidAgentDefinitionError(`The trust flag "${key}" of ${label} must be a boolean or a predicate.`);
        }
    }
}

export function assertAgentTrust(trust: AgentTrust | undefined, tools?: ToolSet): void {
    if (trust === undefined) {
        return;
    }

    if (!isObject(trust) || (trust.onTainted !== undefined && trust.onTainted !== 'approve' && trust.onTainted !== 'deny')) {
        throw new InvalidAgentDefinitionError('trust.onTainted must be "approve" or "deny".');
    }

    if (trust.tools === undefined) {
        return;
    }

    if (!isObject(trust.tools)) {
        throw new InvalidAgentDefinitionError('trust.tools must be a record of tool classifications.');
    }

    for (const [name, flags] of Object.entries(trust.tools)) {
        const invalid = !isObject(flags) || Object.entries(flags).some(([key, value]) => !['taint', 'guardWhenTainted'].includes(key) || typeof value !== 'boolean');

        if ((tools && !Object.hasOwn(tools, name)) || invalid) {
            throw new InvalidAgentDefinitionError(`Invalid trust classification for tool "${name}".`);
        }
    }
}
