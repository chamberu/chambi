/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll } from 'vitest';
import { createLocalSandbox } from '@chamvi/sandbox-local';
import { describeWorkspaceContract } from '@chamvi/test-kit';

let root: string;

beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'chamvi-local-contract-'));
});

afterAll(async () => {
    await rm(root, { recursive: true, force: true });
});

describeWorkspaceContract(
    'local',
    (input) => createLocalSandbox({ root }).create({ runId: input?.runId ?? 'r1' }),
    // a second provider over the same root: a restarted process
    { find: (runId) => createLocalSandbox({ root }).find(runId) },
);
