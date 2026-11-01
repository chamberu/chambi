/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import fs from 'node:fs/promises';
import { hostname, tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { InvalidAgentDefinitionError } from '@chamvi/core';
import { createGitFixture } from '@chamvi/test-kit';
import type { GitFixture } from '@chamvi/test-kit';
import * as skills from '@chamvi/skills';
import {
    SKILL_PREPARATION_FAILED_ERROR_CODE,
    SKILL_PREPARATION_LOCKED_ERROR_CODE,
    SKILL_PREPARATION_LOCK_STALE_MS,
} from '@chamvi/skills';
import * as sdk from 'skills';
import {
    afterEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';

vi.mock('skills', async (original) => {
    const actual = await original<typeof sdk>();

    return {
        ...actual,
        cloneRepo: vi.fn(actual.cloneRepo),
    };
});

const fixtures: GitFixture[] = [];
const roots: string[] = [];

async function setup() {
    const fixture = await createGitFixture({ 'skills/audit/SKILL.md': '---\nname: audit\ndescription: Review code\n---\nBODY\n' });

    fixtures.push(fixture);

    const root = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'chamvi-prepare-failures-')));

    roots.push(root);

    const directory = join(root, 'corpus');

    return {
        root,
        guard: join(root, `.${basename(directory)}.chamvi-skills-lock`),
        options: {
            source: fixture.path,
            revision: fixture.commit,
            names: ['audit'],
            directory,
        },
    };
}

async function failureOf(promise: Promise<unknown>): Promise<Error & { code?: unknown }> {
    return promise.then(() => {
        throw new Error('expected a rejection');
    }, (error: Error & { code?: unknown }) => error);
}

async function writeOwner(guard: string, owner: Record<string, unknown>) {
    await fs.mkdir(guard);
    await fs.writeFile(join(guard, 'owner.json'), JSON.stringify(owner));
}

afterEach(async () => {
    await Promise.all(fixtures.map((fixture) => fixture.cleanup()));
    await Promise.all(roots.map((root) => fs.rm(root, { recursive: true, force: true })));
    fixtures.length = 0;
    roots.length = 0;
    vi.mocked(sdk.cloneRepo).mockClear();
});

describe('prepareSkills failures', () => {
    it('refuses a guard a live preparer holds with an error naming the guard path', async () => {
        const { guard, options } = await setup();
        const entered = Promise.withResolvers<void>();
        const release = Promise.withResolvers<void>();
        const first = skills.prepareSkills({
            ...options,
            verify: async () => {
                entered.resolve();
                await release.promise;
            },
        });

        await entered.promise;

        try {
            const error = await failureOf(skills.prepareSkills(options));

            expect(error).not.toBeInstanceOf(InvalidAgentDefinitionError);
            expect(error.code).toBe(SKILL_PREPARATION_LOCKED_ERROR_CODE);
            expect(error.message).toContain(guard);
        } finally {
            release.resolve();
        }

        await first;
        await expect(fs.stat(guard)).rejects.toMatchObject({ code: 'ENOENT' });
    });

    it('recovers a guard whose owner process on this host is gone', async () => {
        const { guard, options } = await setup();

        await writeOwner(guard, {
            host: hostname(),
            pid: 2 ** 22 + 12_345,
            processStart: 0,
            token: 'dead',
            createdAt: Date.now(),
        });

        await expect(skills.prepareSkills(options)).resolves.toHaveLength(1);
        await expect(fs.stat(guard)).rejects.toMatchObject({ code: 'ENOENT' });
    });

    it('recovers a guard of an earlier incarnation of this process id', async () => {
        const { guard, options } = await setup();

        await writeOwner(guard, {
            host: hostname(),
            pid: process.pid,
            processStart: 1,
            token: 'restarted',
            createdAt: Date.now(),
        });

        await expect(skills.prepareSkills(options)).resolves.toHaveLength(1);
    });

    it('keeps a fresh guard of another host and recovers it once older than the bound', async () => {
        const { guard, options } = await setup();
        const owner = {
            host: `${hostname()}-other`,
            pid: 1,
            processStart: 0,
            token: 'remote',
        };

        await writeOwner(guard, { ...owner, createdAt: Date.now() });
        expect((await failureOf(skills.prepareSkills(options))).code).toBe(SKILL_PREPARATION_LOCKED_ERROR_CODE);
        expect(JSON.parse(await fs.readFile(join(guard, 'owner.json'), 'utf8')).token).toBe('remote');

        await fs.writeFile(join(guard, 'owner.json'), JSON.stringify({ ...owner, createdAt: Date.now() - SKILL_PREPARATION_LOCK_STALE_MS - 1 }));
        await expect(skills.prepareSkills(options)).resolves.toHaveLength(1);
    });

    it('recovers a guard without an owner record by its age only', async () => {
        const { guard, options } = await setup();

        await fs.mkdir(guard);
        expect((await failureOf(skills.prepareSkills(options))).code).toBe(SKILL_PREPARATION_LOCKED_ERROR_CODE);

        const old = new Date(Date.now() - SKILL_PREPARATION_LOCK_STALE_MS - 1_000);

        await fs.utimes(guard, old, old);
        await expect(skills.prepareSkills(options)).resolves.toHaveLength(1);
    });

    it('reports a source that could not be fetched as a retryable failure, not a configuration error', async () => {
        const { root, options } = await setup();

        vi.mocked(sdk.cloneRepo).mockRejectedValueOnce(new sdk.GitCloneError('Failed to clone https://token@example.com/x.git: Could not resolve host: example.com', 'https://token@example.com/x.git'));

        const error = await failureOf(skills.prepareSkills(options));

        expect(error).not.toBeInstanceOf(InvalidAgentDefinitionError);
        expect(error.code).toBe(SKILL_PREPARATION_FAILED_ERROR_CODE);
        expect(error.message).not.toContain('token');
        expect(await fs.readdir(root)).toEqual([]);
    });

    it.each([
        new sdk.GitCloneError('Authentication failed for https://example.com/x.git', 'https://example.com/x.git', false, true),
        new sdk.GitCloneError("Failed to clone x: fatal: repository 'https://example.com/x.git/' not found", 'x'),
    ])('reports an authentication or missing repository failure as configuration: %s', async (failure) => {
        const { options } = await setup();

        vi.mocked(sdk.cloneRepo).mockRejectedValueOnce(failure);
        await expect(skills.prepareSkills(options)).rejects.toThrow(InvalidAgentDefinitionError);
    });
});
