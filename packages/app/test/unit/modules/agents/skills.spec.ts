/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { join } from 'node:path';
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
} from 'vitest';
import { agentFile, buildAgentsDirHarness, queueRun } from '../../../utils/agents-dir.ts';
import { createTempDir, writeTree } from '../../../utils/folder.ts';
import type { Harness } from '../../../utils/harness.ts';

let root: Awaited<ReturnType<typeof createTempDir>>;
const harnesses: Harness[] = [];
beforeEach(async () => {
    root = await createTempDir();
});
afterEach(async () => {
    await Promise.all(harnesses.map((harness) => harness.stop()));
    harnesses.length = 0;
    await root.remove();
});

function sourceAgent(instructions = 'v1', channel = '') {
    return `export default { name: 'greeter', definition: { model: 'test/model', instructions: '${instructions}',
        ${channel}
        skills: [{ skills: [{ name: 'review', version: '1', sha256: '${'a'.repeat(64)}' }],
            async load() { return []; } }],
    } };`;
}

function build(check = false) {
    const setup = buildAgentsDirHarness({ root: root.path, check });
    harnesses.push(setup.harness);
    return setup;
}

describe('folder skill verification', () => {
    it('aborts boot on required verification failure before a revision or registration', async () => {
        await writeTree(root.path, { 'greeter/agent.ts': sourceAgent() });
        const setup = build();
        await expect(setup.harness.setup()).rejects.toThrow(/skill/i);
        expect(setup.engine().getAgent('greeter')).toBeUndefined();
        expect(await setup.store.getAgentRevision('greeter')).toBeUndefined();
    });

    it('keeps static definition failures tolerant and never loads their source', async () => {
        await writeTree(root.path, { 'greeter/agent.ts': sourceAgent('v1', "channels: [{ channel: 'unknown', id: 'unknown', options: {} }],") });
        const setup = build();
        await setup.harness.setup();
        expect(setup.issues()[0]?.message).toContain('unknown channel');
        expect(setup.engine().getAgent('greeter')).toBeUndefined();
    });

    it('check validates folder headers without loading the source or writing revisions', async () => {
        await writeTree(root.path, { 'greeter/agent.ts': sourceAgent() });
        const setup = build(true);
        await setup.harness.setup();
        expect(setup.issues()).toEqual([]);
        expect(await setup.store.getAgentRevision('greeter')).toBeUndefined();
    });

    it('hot reload retains the old agent, marker and queued run when verification fails', async () => {
        await writeTree(root.path, { 'greeter/agent.ts': agentFile('v1') });
        const setup = build();
        await setup.harness.setup();
        await setup.watch();
        const previous = setup.engine().getAgent('greeter');
        const marker = await setup.store.getAgentRevision('greeter');
        const runId = await queueRun(setup.store, setup.clock, 'greeter');
        await writeTree(join(root.path, 'greeter'), { 'agent.ts': sourceAgent('v2') });
        await setup.poll();
        await setup.poll();
        expect(setup.engine().getAgent('greeter')).toBe(previous);
        expect(await setup.store.getAgentRevision('greeter')).toEqual(marker);
        expect((await setup.store.getRun(runId))?.status).toBe('queued');
        expect(setup.logger.entries.some((entry) => entry.msg === 'agent reload failed')).toBe(true);
    });
});
