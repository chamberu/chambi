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
import { hashSkillBundle } from '@chamvi/skills';
import { createGitFixture } from '@chamvi/test-kit';
import type { GitFixture } from '@chamvi/test-kit';
import * as skills from '@chamvi/skills';
import * as sdk from 'skills';
import {
    afterEach,
    expect,
    it,
    vi,
} from 'vitest';

vi.mock('skills', async (original) => {
    const actual = await original<typeof sdk>();

    return {
        ...actual,
        cloneRepo: vi.fn(actual.cloneRepo),
        installSkillForAgent: vi.fn(actual.installSkillForAgent),
    };
});

const fixtures: GitFixture[] = [];
const roots: string[] = [];
async function setup(files: Record<string, string> = {}) {
    const fixture = await createGitFixture({
        'skills/audit/SKILL.md': '---\nname: audit\ndescription: Review\n---\nAUDIT\n',
        'skills/design/SKILL.md': '---\nname: design\ndescription: Design\n---\nDESIGN\n',
        ...files,
    });

    fixtures.push(fixture);

    const root = await fs.mkdtemp(join(tmpdir(), 'chamvi-source-'));

    roots.push(root);

    const approved = ['audit', 'design'].map((name) => ({
        name,
        version: '1.0.0',
        hash: hashSkillBundle(join(fixture.path, 'skills', name)),
    }));

    return {
        root,
        fixture,
        options: {
            source: fixture.path,
            revision: fixture.commit,
            directory: join(root, 'corpus'),
            approved,
        },
    };
}
afterEach(async () => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    await Promise.all(fixtures.map((fixture) => fixture.cleanup()));
    await Promise.all(roots.map((root) => fs.rm(root, { recursive: true, force: true })));
    fixtures.length = 0;
    roots.length = 0;
});
it('constructs without I/O and snapshots configuration and approved headers before load', async () => {
    const { root, options } = await setup();
    const mkdir = vi.spyOn(fs, 'mkdir');
    const source = skills.gitSkills(options);

    expect(mkdir).not.toHaveBeenCalled();
    expect(sdk.cloneRepo).not.toHaveBeenCalled();

    const expected = structuredClone(options.approved);

    options.source = 'ext::sh -c wrong';
    options.revision = 'main';
    options.directory = join(root, 'wrong');
    options.approved[0]!.hash = '0'.repeat(64);
    options.approved.splice(1, 1);
    expect(source.skills).toEqual(expected);
    expect(Object.isFrozen(source.skills)).toBe(true);
    expect(Object.isFrozen(source.skills[0])).toBe(true);

    const result = await source.load({ signal: new AbortController().signal });

    expect(result.map(({
        name,
        version,
        hash,
    }) => ({
        name,
        version,
        hash,
    }))).toEqual(expected);
    expect(result.map((skill) => skill.body)).toEqual(['AUDIT\n', 'DESIGN\n']);
    expect(sdk.cloneRepo).toHaveBeenCalledTimes(1);
    expect(await fs.readdir(root)).toEqual(['corpus']);
});
it('prepares arbitrary UTF-8 source files as verified passive references', async () => {
    const references = {
        'scripts/check.sh': '#!/bin/sh\nexit 99\n',
        'src/audit.ts': 'export const instruction = "review";\n',
        'assets/diagram.svg': '<svg><text>Review</text></svg>\n',
        Dockerfile: 'FROM scratch\n',
    };
    const { options } = await setup(Object.fromEntries(Object.entries(references).map(([path, content]) => [`skills/audit/${path}`, content])));
    const source = skills.gitSkills(options);
    const result = await source.load({ signal: new AbortController().signal });

    expect(result[0]?.references).toEqual(references);
    expect(result[0]?.hash).toBe(options.approved[0]?.hash);
});
it.each([
    { source: '' },
    { source: 'ext::sh -c bad' },
    { source: 'https://github.com/owner/repo/tree/main' },
    { revision: 'main' },
    { directory: '/' },
    { approved: [] },
    {
        approved: [{
            name: 'audit',
            version: 'main',
            hash: '0'.repeat(64),
        }],
    },
    {
        approved: [{
            name: '../audit',
            version: '1',
            hash: '0'.repeat(64),
        }],
    },
])('rejects invalid factory configuration synchronously: %j', async (invalid) => {
    const { options } = await setup();

    expect(() => skills.gitSkills({ ...options, ...invalid } as never)).toThrow(InvalidAgentDefinitionError);
    expect(sdk.cloneRepo).not.toHaveBeenCalled();
});
it('rejects duplicate approved names synchronously', async () => {
    const { options } = await setup();

    expect(() => skills.gitSkills({ ...options, approved: [options.approved[0]!, options.approved[0]!] })).toThrow(InvalidAgentDefinitionError);
});
it('retains staged verified snapshots and publishes only after cleanup succeeds', async () => {
    const { root, options } = await setup();
    const cleanup = fs.rmdir.bind(fs);
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();

    vi.spyOn(fs, 'rmdir').mockImplementation(async (...args) => {
        entered.resolve();
        await release.promise;
        await fs.writeFile(join(options.directory, 'audit/SKILL.md'), 'CHANGED AFTER VERIFICATION');

        return cleanup(...args);
    });

    let settled = false;
    const pending = skills.gitSkills(options).load({ signal: new AbortController().signal }).finally(() => {
        settled = true;
    });

    await entered.promise;
    expect(settled).toBe(false);
    release.resolve();

    const result = await pending;

    expect(result[0]!.body).toBe('AUDIT\n');
    expect(Object.isFrozen(result)).toBe(true);
    expect(await fs.readdir(root)).toEqual(['corpus']);
});
it('preserves an existing corpus when one grouped pin fails', async () => {
    const { root, options } = await setup();

    await skills.gitSkills(options).load({ signal: new AbortController().signal });
    options.approved[1]!.hash = '0'.repeat(64);
    await expect(skills.gitSkills(options).load({ signal: new AbortController().signal })).rejects.toThrow(InvalidAgentDefinitionError);
    expect(await fs.readFile(join(options.directory, 'audit/SKILL.md'), 'utf8')).toContain('AUDIT');
    expect(await fs.readdir(root)).toEqual(['corpus']);
});
it('does not publish retained snapshots when cleanup fails', async () => {
    const { options } = await setup();

    vi.spyOn(fs, 'rmdir').mockRejectedValueOnce(new Error('cleanup failed'));
    await expect(skills.gitSkills(options).load({ signal: new AbortController().signal })).rejects.toThrow(InvalidAgentDefinitionError);
});
it('cancels before clone without creating output', async () => {
    const { root, options } = await setup();
    const controller = new AbortController();

    controller.abort();
    await expect(skills.gitSkills(options).load({ signal: controller.signal })).rejects.toBe(controller.signal.reason);
    expect(sdk.cloneRepo).not.toHaveBeenCalled();
    expect(await fs.readdir(root)).toEqual([]);
});
it('joins a noncancelable clone before cleanup and skips copying after cancellation', async () => {
    const { root, options } = await setup();
    const clone = vi.mocked(sdk.cloneRepo).getMockImplementation()!;
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    let checkout = '';

    vi.mocked(sdk.cloneRepo).mockImplementationOnce(async (...args) => {
        checkout = await clone(...args);
        entered.resolve();
        await release.promise;

        return checkout;
    });

    const controller = new AbortController();
    const reason = new Error('cancel source');
    let settled = false;
    const pending = skills.gitSkills(options).load({ signal: controller.signal }).finally(() => {
        settled = true;
    });
    const rejected = expect(pending).rejects.toBe(reason);

    await entered.promise;
    controller.abort(reason);
    expect(settled).toBe(false);
    expect(await fs.stat(checkout)).toBeDefined();
    release.resolve();
    await rejected;
    expect(sdk.installSkillForAgent).not.toHaveBeenCalled();
    await expect(fs.stat(checkout)).rejects.toMatchObject({ code: 'ENOENT' });
    expect(await fs.readdir(root)).toEqual([]);
});
