/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InvalidAgentDefinitionError } from '@chamvi/core';
import { prepareSkills } from '@chamvi/skills';
import { createGitFixture } from '@chamvi/test-kit';
import type { GitFixture } from '@chamvi/test-kit';
import { discoverSkills } from 'skills';
import type * as SkillsSDK from 'skills';
import {
    afterEach,
    expect,
    it,
    vi,
} from 'vitest';

vi.mock('skills', async (importOriginal) => {
    const sdk = await importOriginal<typeof SkillsSDK>();

    // Delegate to the real SDK while observing the boundary before it reads source files.
    return { ...sdk, discoverSkills: vi.fn(sdk.discoverSkills) };
});

const fixtures: GitFixture[] = [];
const roots: string[] = [];
const document = (body: string) => `---\nname: audit\ndescription: Fixture\n---\n${body}\n`;

afterEach(async () => {
    await Promise.all(fixtures.map((fixture) => fixture.cleanup()));
    await Promise.all(roots.map((root) => fs.rm(root, { recursive: true, force: true })));
    fixtures.length = 0;
    roots.length = 0;
    vi.clearAllMocks();
});

it.each(['nested alias', 'conventional container', 'unrelated link'] as const)(
    'rejects a committed %s before discovery and retains the previous corpus without a verifier',
    async (route) => {
        const fixture = await createGitFixture({
            'skills/audit/SKILL.md': document('ORIGINAL BODY'),
            'README.md': 'DUMMY SOURCE README\n',
            'notes\n120000 fake-link': 'DUMMY REGULAR FILE\n',
        });

        fixtures.push(fixture);

        const root = await fs.mkdtemp(join(tmpdir(), 'chamvi-confinement-'));

        roots.push(root);

        const options = {
            source: fixture.path,
            revision: fixture.commit,
            names: ['audit'],
            directory: join(root, 'corpus'),
        };
        const [previous] = await prepareSkills(options);
        const outside = join(root, 'outside');

        await fs.mkdir(outside);
        await fs.writeFile(join(outside, 'outside.txt'), 'DUMMY OUTSIDE FILE\n');

        if (route === 'nested alias') {
            const skill = join(fixture.path, 'skills/audit');

            await fs.mkdir(join(skill, 'real'));
            await fs.symlink(join(outside, 'outside.txt'), join(skill, 'real/external.txt'));
            await fs.symlink('real', join(skill, 'alias'));
        } else if (route === 'conventional container') {
            await fs.mkdir(join(outside, 'audit'));
            await fs.writeFile(join(outside, 'audit/SKILL.md'), document('DUMMY OUTSIDE BODY'));
            await fs.rm(join(fixture.path, 'skills'), { recursive: true });
            await fs.symlink(outside, join(fixture.path, 'skills'));
        } else {
            await fs.symlink('README.md', join(fixture.path, 'unselected-link'));
        }

        await fixture.git('add', '--all');
        await fixture.git('commit', '-m', 'source links');

        const revision = (await fixture.git('rev-parse', 'HEAD')).trim();

        vi.mocked(discoverSkills).mockClear();

        await expect(prepareSkills({ ...options, revision })).rejects.toThrow(InvalidAgentDefinitionError);
        expect(discoverSkills).not.toHaveBeenCalled();
        expect(await fs.readFile(join(previous!.path, 'SKILL.md'), 'utf8')).toBe(document('ORIGINAL BODY'));
        expect(await fs.readdir(previous!.path)).toEqual(['SKILL.md']);
        expect((await fs.readdir(root)).sort()).toEqual(['corpus', 'outside']);
    },
);
