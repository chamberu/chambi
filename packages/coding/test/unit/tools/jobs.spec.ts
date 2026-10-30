/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
    afterAll,
    afterEach,
    beforeAll,
    beforeEach,
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import { ValidationError } from '@chamvi/core';
import type {
    BashJobResult,
    BashKillResult,
    BashOutputResult,
    BashResult,
} from '@chamvi/coding';
import type { GitFixture } from '@chamvi/test-kit';
import { createFixture, setupCoding } from '../../utils/setup.ts';
import type { CodingSetup } from '../../utils/setup.ts';

let fixture: GitFixture;
let s: CodingSetup;

beforeAll(async () => {
    fixture = await createFixture();
});
afterAll(async () => {
    await fixture.cleanup();
});
beforeEach(async () => {
    s = await setupCoding(fixture);
});
afterEach(async () => {
    await s.cleanup();
});

/** Whether the process `pid` still runs (signal 0). */
function alive(pid: number): boolean {
    try {
        process.kill(pid, 0);

        return true;
    } catch {
        return false;
    }
}

describe('background jobs', () => {
    it('starts a job and returns at once', async () => {
        const started = Date.now();
        const job = await s.call<BashJobResult>('bash', { command: 'echo up; sleep 30', background: true });

        expect(Date.now() - started).toBeLessThan(5_000);
        expect(job.job).toMatch(/^[0-9a-f]{12}$/);
        expect(job).toMatchObject({ status: 'running', outputLog: `~/.chamvi/jobs/${job.job}/output` });

        await vi.waitFor(async () => {
            const output = await s.call<BashOutputResult>('bash_output', { job: job.job });

            expect(output).toMatchObject({
                job: job.job,
                status: 'running',
                output: 'up\n',
                offset: 0,
                nextOffset: 3,
                size: 3,
                truncated: false,
            });
        }, { timeout: 5_000 });
    });

    it('reads only newer output from an offset and reports the exit', async () => {
        const job = await s.call<BashJobResult>('bash', {
            command: 'echo one; sleep 0.5; echo two >&2; exit 7',
            background: true,
        });

        await vi.waitFor(async () => {
            const done = await s.call<BashOutputResult>('bash_output', { job: job.job });

            expect(done.status).toBe('exited');
        }, { timeout: 5_000 });
        await expect(s.call('bash_output', { job: job.job, offset: 4 })).resolves.toEqual({
            job: job.job,
            status: 'exited',
            exitCode: 7,
            output: 'two\n',
            offset: 4,
            nextOffset: 8,
            size: 8,
            truncated: false,
            outputCapped: false,
        });

        const log = await s.call<{ content: string }>('read_file', { path: job.outputLog });

        expect(log.content).toBe('one\ntwo');
    });

    it('kills a job whose output passes the log cap and keeps the output at the cap', async () => {
        const capped = await setupCoding(fixture, { outputLogMaxBytes: 1_048_576 });

        try {
            const job = await capped.call<BashJobResult>('bash', { command: 'echo $$ > job.pid; echo start; yes', background: true });
            const pid = await vi.waitFor(async () => Number((await readFile(join(capped.root, capped.workspace.id, 'repo', 'job.pid'), 'utf8')).trim()), { timeout: 5_000 });

            await vi.waitFor(async () => {
                await expect(capped.call('bash_output', { job: job.job, offset: 1_048_576 })).resolves.toMatchObject({
                    status: 'killed',
                    size: 1_048_576,
                    outputCapped: true,
                    output: '',
                });
            }, { timeout: 15_000 });
            await vi.waitFor(() => expect(alive(pid)).toBe(false), { timeout: 5_000 });
            await expect(capped.call('bash_output', { job: job.job })).resolves.toMatchObject({ output: expect.stringMatching(/^start\ny\n/) });

            const quiet = await capped.call<BashJobResult>('bash', { command: 'echo done', background: true });

            await vi.waitFor(async () => {
                await expect(capped.call('bash_output', { job: quiet.job })).resolves.toMatchObject({ status: 'exited', outputCapped: false });
            }, { timeout: 5_000 });
        } finally {
            await capped.cleanup();
        }
    });

    it('starts in the kept working directory with the kept variables', async () => {
        await s.call<BashResult>('bash', { command: 'cd src && export WHO=job' });

        const job = await s.call<BashJobResult>('bash', { command: 'echo "$WHO"; ls', background: true });

        await vi.waitFor(async () => {
            await expect(s.call('bash_output', { job: job.job })).resolves.toMatchObject({ status: 'exited', output: 'job\na.ts\n' });
        }, { timeout: 5_000 });
    });

    it('kills a job with every process it started', async () => {
        const job = await s.call<BashJobResult>('bash', {
            command: 'sh -c \'echo $$ > child.pid; sleep 60\' & wait',
            background: true,
        });
        const pidFile = join(s.root, s.workspace.id, 'repo', 'child.pid');
        const child = await vi.waitFor(async () => Number((await readFile(pidFile, 'utf8')).trim()), { timeout: 5_000 });

        expect(alive(child)).toBe(true);

        const killed = await s.call<BashKillResult>('bash_kill', { job: job.job });

        expect(killed).toMatchObject({ job: job.job, status: 'killed' });
        await vi.waitFor(() => expect(alive(child)).toBe(false), { timeout: 5_000 });
        await expect(s.call('bash_output', { job: job.job })).resolves.toMatchObject({ status: 'killed' });
    });

    it('reports an exited job instead of killing it', async () => {
        const job = await s.call<BashJobResult>('bash', { command: 'exit 0', background: true });

        await vi.waitFor(async () => {
            await expect(s.call('bash_output', { job: job.job })).resolves.toMatchObject({ status: 'exited' });
        }, { timeout: 5_000 });
        await expect(s.call('bash_kill', { job: job.job })).resolves.toEqual({
            job: job.job,
            status: 'exited',
            exitCode: 0,
        });
    });

    it('kills the jobs when the workspace is disposed', async () => {
        const job = await s.call<BashJobResult>('bash', { command: 'echo $$ > job.pid; sleep 60', background: true });
        const pidFile = join(s.root, s.workspace.id, 'repo', 'job.pid');
        const pid = await vi.waitFor(async () => Number((await readFile(pidFile, 'utf8')).trim()), { timeout: 5_000 });

        expect(job.status).toBe('running');
        await s.workspace.dispose();
        await vi.waitFor(() => expect(alive(pid)).toBe(false), { timeout: 5_000 });
    });

    it('refuses an unknown or malformed job id', async () => {
        await expect(s.call('bash_output', { job: '0123456789ab' })).rejects.toThrow(ValidationError);
        await expect(s.call('bash_output', { job: '../x' })).rejects.toThrow(ValidationError);
        await expect(s.call('bash_kill', { job: '0123456789ab' })).rejects.toThrow(ValidationError);
        await expect(s.call('bash_output', { job: '0123456789ab', offset: -1 })).rejects.toThrow(ValidationError);
    });
});
