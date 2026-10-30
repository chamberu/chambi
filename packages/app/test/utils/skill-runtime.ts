/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { defineTool } from '@chamvi/core';
import { jsonSchema } from 'ai';
import { fakeSkillRuntime } from '@chamvi/test-kit';

export function preparationInput(prepare?: (signal: AbortSignal) => Promise<void>) {
    return fakeSkillRuntime({
        prepare,
        contribution: Object.freeze({
            instructions: 'prepared review contribution',
            tools: Object.freeze({ contributed: defineTool({ inputSchema: jsonSchema({ type: 'object' }), execute: async () => 'prepared' }) }),
            checkTools: () => {},
        }),
    }).input;
}
