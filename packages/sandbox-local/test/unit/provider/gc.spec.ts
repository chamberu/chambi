/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import {
    chmod,
    mkdir,
    mkdtemp,
    readdir,
    rm,
    writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
    afterEach,
    beforeEach,
    describe,
    expect,
    it,
} from 'vitest';
import { SandboxError } from '@chamvi/core';
import { createLocalSandbox } from '@chamvi/sandbox-local';
import { ControllableClock } from '@chamvi/test-kit';

describe('local garbage collection', () => {
    let root: string;

    beforeEach(async () => {
        root = await mkdtemp(join(tmpdir(), 'chamvi-local-gc-'));
    });

    afterEach(async () => {
        await rm(root, { recursive: true, force: true });
    });

    it('deletes expired workspaces only', async () => {
        const clock = new ControllableClock();
        const provider = createLocalSandbox({ root, clock });
        const first = await provider.create({ runId: 'r1', limits: { maxLifetimeMs: 1_000 } });
        const second = await provider.create({ runId: 'r2', limits: { maxLifetimeMs: 60_000 } });
        const foreign = join(root, 'not-a-workspace');
        await mkdir(foreign);

        clock.advance(1_000);
        expect(await provider.collectGarbage()).toBe(1);

        expect((await readdir(root)).sort()).toEqual([second.id, 'not-a-workspace'].sort());
        await expect(first.exec(['true'])).rejects.toBeInstanceOf(SandboxError);
        expect((await second.exec(['true'])).exitCode).toBe(0);

        await second.dispose();
    });

    it('deletes expired workspaces another process left behind', async () => {
        const clock = new ControllableClock(new Date(10_000));
        const id = '00000000-0000-4000-8000-000000000000';
        await mkdir(join(root, id, 'repo'), { recursive: true });
        await writeFile(join(root, id, 'workspace.json'), JSON.stringify({ runId: 'r0', expiresAt: new Date(5_000).toISOString() }));
        await mkdir(join(root, 'broken'));
        await writeFile(join(root, 'broken', 'workspace.json'), 'not json');

        expect(await createLocalSandbox({ root, clock }).collectGarbage()).toBe(1);
        expect(await readdir(root)).toEqual(['broken']);
    });

    it.skipIf(process.getuid?.() === 0)('keeps collecting past a folder it cannot delete and reports it once', async () => {
        const clock = new ControllableClock(new Date(10_000));
        const ids = ['00000000-0000-4000-8000-000000000001', '00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000003'];
        for (const id of ids) {
            await mkdir(join(root, id, 'repo', 'locked'), { recursive: true });
            await writeFile(join(root, id, 'repo', 'locked', 'file'), 'x');
            await writeFile(join(root, id, 'workspace.json'), JSON.stringify({ runId: 'r0', expiresAt: new Date(5_000).toISOString() }));
        }
        const locked = join(root, ids[1]!, 'repo', 'locked');
        await chmod(locked, 0o500);
        try {
            const error = await createLocalSandbox({ root, clock }).collectGarbage().catch((e: unknown) => e);
            expect(error).toBeInstanceOf(SandboxError);
            expect((error as Error).message).toMatch(/removed 2 .*1 failed/);
            expect((error as Error).message).toContain(ids[1]);
            expect(await readdir(root)).toEqual([ids[1]]);
        } finally {
            await chmod(locked, 0o700);
        }
    });

    it('collects nothing without a root directory', async () => {
        expect(await createLocalSandbox({ root: join(root, 'missing') }).collectGarbage()).toBe(0);
    });
});
