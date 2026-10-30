/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
} from 'vitest';
import { ValidationError } from '@chamvi/core';
import { createWorkspaceManager } from '@chamvi/sandbox';
import { createLocalSandbox } from '@chamvi/sandbox-local';
import { ControllableClock, createGitFixture } from '@chamvi/test-kit';

describe('local find', () => {
    let tmp: string;
    let root: string;

    beforeEach(async () => {
        tmp = await mkdtemp(join(tmpdir(), 'chamvi-local-find-'));
        root = join(tmp, 'workspaces');
    });

    afterEach(async () => {
        await rm(tmp, { recursive: true, force: true });
    });

    it('rebuilds a checked out workspace of another provider instance with its info and env', async () => {
        const fixture = await createGitFixture({ 'README.md': 'hello\n' });

        try {
            const clock = new ControllableClock(new Date(1_000_000));
            const created = await createLocalSandbox({ root, clock }).create({
                runId: 'r1',
                repo: fixture.url,
                ref: 'main',
                env: { FOO: 'bar' },
            });

            const [found, ...rest] = await createLocalSandbox({ root, clock }).find('r1');

            expect(rest).toEqual([]);
            expect(found!.id).toBe(created.id);
            expect(found!.info).toEqual(created.info);
            expect(found!.info.commit).toMatch(/^[0-9a-f]{40}$/);
            expect((await found!.exec(['sh', '-c', 'echo $FOO'])).stdout).toBe('bar\n');
            expect(await found!.readFile('README.md')).toBe('hello\n');
            await found!.dispose();
        } finally {
            await fixture.cleanup();
        }
    });

    it('never finds a repo workspace whose create died during the checkout, so the manager checks out anew', async () => {
        const fixture = await createGitFixture({ 'README.md': 'hello\n' });

        try {
            const clock = new ControllableClock(new Date(1_000_000));
            const half = await createLocalSandbox({ root, clock }).create({ runId: 'r1', repo: fixture.url });
            // back to what create leaves after `git init` when the process is killed:
            // the record and an empty repository, no checkout record
            const reset = await half.exec(['sh', '-c', 'git config --unset chamvi.checkout && rm -rf README.md .git && git init -q .']);

            expect(reset.exitCode).toBe(0);

            const provider = createLocalSandbox({ root, clock });

            expect(await provider.find('r1')).toEqual([]);

            const manager = createWorkspaceManager({
                provider,
                clock,
                allowFileRepos: true,
                gcIntervalMs: 0,
            });
            const { workspace, reused } = await manager.acquire('r1', { repo: fixture.url });

            expect(reused).toBe(false);
            expect(workspace.id).not.toBe(half.id);
            expect(workspace.info.commit).toMatch(/^[0-9a-f]{40}$/);
            expect(await workspace.readFile('README.md')).toBe('hello\n');
            await manager.release('r1');
        } finally {
            await fixture.cleanup();
        }
    });

    it('answers the instance it holds', async () => {
        const provider = createLocalSandbox({ root });
        const workspace = await provider.create({ runId: 'r1' });

        expect(await provider.find('r1')).toEqual([workspace]);
        expect((await provider.find('r1'))[0]).toBe(workspace);
        await workspace.dispose();
        expect(await provider.find('r1')).toEqual([]);
    });

    it('skips other runs, other deployments and expired workspaces', async () => {
        const clock = new ControllableClock(new Date(1_000_000));
        const provider = createLocalSandbox({ root, clock });

        await provider.create({ runId: 'r1', deployment: 'ci' });
        await provider.create({ runId: 'r2' });
        await provider.create({ runId: 'r1', limits: { maxLifetimeMs: 1_000 } });
        clock.advance(1_000);

        const other = createLocalSandbox({ root, clock });

        expect(await other.find('r1')).toEqual([]);
        expect(await other.find('r1', { deployment: 'ci' })).toHaveLength(1);
        expect(await other.find('r2')).toHaveLength(1);
    });

    it('finds nothing without a root directory and refuses a bad deployment', async () => {
        const provider = createLocalSandbox({ root: join(tmp, 'missing') });

        expect(await provider.find('r1')).toEqual([]);
        await expect(provider.find('r1', { deployment: 'a b' })).rejects.toBeInstanceOf(ValidationError);
        await expect(provider.create({ runId: 'r1', deployment: 'a b' })).rejects.toBeInstanceOf(ValidationError);
    });
});
