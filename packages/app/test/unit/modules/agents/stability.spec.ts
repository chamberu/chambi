/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import { hashAgentFolder } from '@chamvi/app';
import type * as LoaderModule from '../../../../src/loader/module.ts';
import { agentFile, buildAgentsDirHarness, queueRun } from '../../../utils/agents-dir.ts';
import { createTempDir, writeTree } from '../../../utils/folder.ts';
import type { Harness } from '../../../utils/harness.ts';

/** Runs once right after the watcher's next folder hash: an editor starting to save. */
const hooks: { afterHash?: (dir: string) => Promise<void> } = {};

vi.mock('../../../../src/loader/module.ts', async (importOriginal) => {
    const original = await importOriginal<typeof LoaderModule>();
    return {
        ...original,
        hashAgentFolder: async (dir: string) => {
            const hash = await original.hashAgentFolder(dir);
            const hook = hooks.afterHash;
            if (hook) {
                hooks.afterHash = undefined;
                await hook(dir);
            }
            return hash;
        },
    };
});

let root: { path: string; remove: () => Promise<void> };
let harnesses: Harness[] = [];

beforeEach(async () => {
    root = await createTempDir();
});

afterEach(async () => {
    hooks.afterHash = undefined;
    await Promise.all(harnesses.map((h) => h.stop()));
    harnesses = [];
    await root.remove();
});

describe('a folder edited right after its stable poll', () => {
    it('is registered only once a poll saw the new content stable, cancelling once', async () => {
        await writeTree(root.path, { 'greeter/agent.ts': agentFile('v1') });
        const setup = buildAgentsDirHarness({ root: root.path });
        harnesses.push(setup.harness);
        await setup.harness.setup();
        await setup.watch();
        const dir = join(root.path, 'greeter');

        await writeFile(join(dir, 'agent.ts'), agentFile('v2'));
        await setup.poll();
        // the stable poll's hash is v2; right after it, an editor saves a v3 tree
        hooks.afterHash = async () => {
            await writeFile(join(dir, 'agent.ts'), 'import { text } from \'./prompt.ts\';\nexport default { name: \'greeter\', definition: { model: \'test/model\', instructions: text } };\n');
            await writeFile(join(dir, 'prompt.ts'), 'export const text = \'v3\';\n');
        };
        const runId = await queueRun(setup.stores, setup.clock, 'greeter');
        await setup.poll();

        expect(setup.engine().getAgent('greeter')?.definition.instructions).toBe('v1');
        expect(setup.issues()).toEqual([]);
        expect((await setup.stores.runs.getRun(runId))?.status).toBe('queued');

        await setup.poll();
        expect(setup.engine().getAgent('greeter')?.definition.instructions).toBe('v1');
        await setup.poll();
        expect(setup.engine().getAgent('greeter')?.definition.instructions).toBe('v3');
        expect((await setup.stores.agentRevisions.getAgentRevision('greeter'))?.hash).toBe(await hashAgentFolder(dir));
        expect((await setup.stores.runs.getRun(runId))?.status).toBe('cancelled');
    });
});
