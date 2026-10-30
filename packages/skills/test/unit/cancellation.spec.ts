/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepareSkills } from '@chamvi/skills';
import { createGitFixture } from '@chamvi/test-kit';
import type { GitFixture } from '@chamvi/test-kit';
import {
    afterEach,
    expect,
    it,
    vi,
} from 'vitest';

const roots: string[] = [];
const fixtures: GitFixture[] = [];
async function setup() {
    const fixture = await createGitFixture({ 'skills/audit/SKILL.md': '---\nname: audit\ndescription: Review\n---\nBODY\n' });
    fixtures.push(fixture);
    const root = await fs.mkdtemp(join(tmpdir(), 'chamvi-cancel-'));
    roots.push(root);
    const options = {
        source: fixture.path,
        revision: fixture.commit,
        names: ['audit'],
        directory: join(root, 'corpus'),
    };
    await prepareSkills(options);
    return { root, options };
}
afterEach(async () => {
    vi.restoreAllMocks();
    await Promise.all(fixtures.map((fixture) => fixture.cleanup()));
    await Promise.all(roots.map((root) => fs.rm(root, { recursive: true, force: true })));
    fixtures.length = 0;
    roots.length = 0;
});
it('observes cancellation after staged verification and preserves the old corpus', async () => {
    const { root, options } = await setup();
    const controller = new AbortController();
    const reason = new Error('cancel before promotion');
    const rename = vi.spyOn(fs, 'rename');
    await expect(prepareSkills({
        ...options,
        signal: controller.signal,
        verify: () => { controller.abort(reason); },
    })).rejects.toBe(reason);
    expect(rename).not.toHaveBeenCalled();
    expect(await fs.readFile(join(options.directory, 'audit/SKILL.md'), 'utf8')).toContain('BODY');
    expect(await fs.readdir(root)).toEqual(['corpus']);
});
it.each(['promotion', 'rollback'] as const)('finishes %s and cleanup before observing cancellation in the critical section', async (phase) => {
    const { root, options } = await setup();
    const controller = new AbortController();
    const reason = new Error('cancel during promotion');
    const rename = fs.rename.bind(fs);
    vi.spyOn(fs, 'rename').mockImplementation(async (source, destination) => {
        if (String(destination).endsWith('/previous')) {
            await rename(source, destination);
            controller.abort(reason);
            return;
        }
        if (phase === 'rollback' && String(source).endsWith('/.agents/skills')) {
            throw new Error('promotion failed');
        }
        await rename(source, destination);
    });
    if (phase === 'rollback') {
        await expect(prepareSkills({ ...options, signal: controller.signal })).rejects.toMatchObject({ name: 'InvalidAgentDefinitionError' });
    } else {
        await expect(prepareSkills({ ...options, signal: controller.signal })).rejects.toBe(reason);
    }
    expect(await fs.readFile(join(options.directory, 'audit/SKILL.md'), 'utf8')).toContain('BODY');
    expect(await fs.readdir(root)).toEqual(['corpus']);
});

it('preserves an independent verifier failure when the caller also cancels', async () => {
    const { root, options } = await setup();
    const controller = new AbortController();
    await expect(prepareSkills({
        ...options,
        signal: controller.signal,
        verify: () => {
            controller.abort(new Error('caller canceled'));
            throw new Error('PRIVATE verifier failure');
        },
    })).rejects.toMatchObject({ name: 'InvalidAgentDefinitionError' });
    expect(await fs.readdir(root)).toEqual(['corpus']);
});

it('preserves cleanup failure when the caller cancels during cleanup', async () => {
    const { options } = await setup();
    const controller = new AbortController();
    vi.spyOn(fs, 'rmdir').mockImplementationOnce(async () => {
        controller.abort(new Error('caller canceled'));
        throw new Error('PRIVATE cleanup failure');
    });
    await expect(prepareSkills({ ...options, signal: controller.signal })).rejects.toMatchObject({ name: 'InvalidAgentDefinitionError' });
});
