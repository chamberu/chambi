/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { expect, it } from 'vitest';
import type { Run } from '@chamvi/core';
import { serializeRun } from '../../../src/runs/helpers.ts';

it('drops private conversation binding at runtime through the shared REST/SSE/MCP serializer', () => {
    const run = {
        id: 'r',
        trigger: {},
        conversation: { scope: { identity: { chat: 'private' } }, text: 'private' },
    } as Run;

    expect(serializeRun(run)).not.toHaveProperty('conversation');
    expect(run).toHaveProperty('conversation');
});
