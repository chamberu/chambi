/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { ToolSet } from 'ai';
import { isObject } from 'smob';
import { InvalidAgentDefinitionError } from '../errors/index.ts';
import type { AgentTrust } from '../tool/types.ts';

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
        const invalid = !isObject(flags) || Object.entries(flags).some(([key, value]) => !['untrustedResult', 'outbound'].includes(key) || typeof value !== 'boolean');

        if ((tools && !Object.hasOwn(tools, name)) || invalid) {
            throw new InvalidAgentDefinitionError(`Invalid trust classification for tool "${name}".`);
        }
    }
}
