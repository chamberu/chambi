/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import {
    mkdir,
    mkdtemp,
    readFile,
    readdir,
    rm,
    stat,
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
    vi,
} from 'vitest';
import { InvalidAgentDefinitionError, SandboxError, ValidationError } from '@chamvi/core';
import { createLocalSandbox } from '@chamvi/sandbox-local';
import { ControllableClock, createGitFixture } from '@chamvi/test-kit';
import { KILL_GRACE_MS, LINGER_CHECK_MS } from '../../../src/provider/constants.ts';
import { killLingeringJobs } from '../../../src/provider/exit.ts';

const sleep = (ms: number) => new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
});

async function waitFor<T>(probe: () => Promise<T | undefined>, timeoutMs = 10_000): Promise<T> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const value = await probe();
        if (value !== undefined) return value;
        await sleep(25);
    }
    throw new Error('waitFor timed out');
}

function isAlive(pid: number): boolean {
    try {
        process.kill(pid, 0);
        return true;
    } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ESRCH') return false;
        throw error;
    }
}

describe('local sandbox', () => {
    let tmp: string;
    let root: string;

    beforeEach(async () => {
        tmp = await mkdtemp(join(tmpdir(), 'chamvi-local-spec-'));
        root = join(tmp, 'workspaces');
    });

    afterEach(async () => {
        vi.restoreAllMocks();
        await rm(tmp, { recursive: true, force: true });
    });

    it('checks out a fixture repository', async () => {
        const fixture = await createGitFixture({ 'README.md': '# demo\n' });
        try {
            const workspace = await createLocalSandbox({ root }).create({
                runId: 'r1',
                repo: fixture.url,
                ref: 'v1',
            });
            try {
                expect(await workspace.readFile('README.md')).toBe('# demo\n');
                expect(workspace.info.commit).toBe(fixture.commit);
                expect(workspace.info.repo).toBe(fixture.url);
                expect(workspace.info.ref).toBe('v1');
                expect(workspace.info.provider).toBe('local');
                expect(workspace.info.runId).toBe('r1');
            } finally {
                await workspace.dispose();
            }
        } finally {
            await fixture.cleanup();
        }
    }, 30_000);

    it('does not leak the host environment', async () => {
        process.env.CHAMVI_SECRET_PROBE = 's3cret';
        try {
            const workspace = await createLocalSandbox({ root, env: { FOO: 'bar' } }).create({ runId: 'r1' });
            try {
                const { stdout } = await workspace.exec(['env']);
                expect(stdout).not.toContain('s3cret');
                expect(stdout).toContain('PATH=');
                expect(stdout).toContain('GIT_TERMINAL_PROMPT=0');
                expect(stdout).toContain('GIT_CONFIG_NOSYSTEM=1');
                expect(stdout).toContain('FOO=bar');
            } finally {
                await workspace.dispose();
            }
        } finally {
            delete process.env.CHAMVI_SECRET_PROBE;
        }
    });

    it('ignores the system git config', async () => {
        const config = join(tmp, 'gitconfig');
        await writeFile(config, '[credential]\n\thelper = store\n');
        const workspace = await createLocalSandbox({ root, env: { GIT_CONFIG_SYSTEM: config } }).create({ runId: 'r1' });
        try {
            const ignored = await workspace.exec(['git', 'config', '--get', 'credential.helper']);
            expect(ignored.exitCode).toBe(1);
            expect(ignored.stdout).toBe('');

            // the probe works: without GIT_CONFIG_NOSYSTEM git reads the file
            const probe = await workspace.exec(['env', '-u', 'GIT_CONFIG_NOSYSTEM', 'git', 'config', '--get', 'credential.helper']);
            expect(probe.stdout).toBe('store\n');
        } finally {
            await workspace.dispose();
        }
    });

    it('kills a running exec on dispose', async () => {
        const workspace = await createLocalSandbox({ root }).create({ runId: 'r1' });
        const pidFile = join(tmp, 'pid');
        const pending = workspace.exec(['sh', '-c', 'sleep 30 & echo $! > "$1"; wait', 'sh', pidFile]);
        const settled = expect(pending).rejects.toThrow(/disposed/);

        const pid = await waitFor(async () => {
            const text = await readFile(pidFile, 'utf8').catch(() => '');
            return text.trim() ? Number(text.trim()) : undefined;
        });
        expect(isAlive(pid)).toBe(true);

        await workspace.dispose();
        await settled;
        await waitFor(async () => (isAlive(pid) ? undefined : true), 2_000);
    }, 30_000);

    it('returns once the command exited while a background job holds its output', async () => {
        const workspace = await createLocalSandbox({ root }).create({ runId: 'r1' });
        const pidFile = join(tmp, 'pid');
        try {
            const started = Date.now();
            const result = await workspace.exec(['sh', '-c', 'sleep 60 & echo $! > "$1"; echo started', 'sh', pidFile], { timeoutMs: 20_000 });
            expect(Date.now() - started).toBeLessThan(10_000);
            expect(result).toMatchObject({
                exitCode: 0, 
                stdout: 'started\n', 
                timedOut: false, 
            });

            // the job runs on, like on Docker and Kubernetes, until the dispose
            const pid = Number((await readFile(pidFile, 'utf8')).trim());
            expect(isAlive(pid)).toBe(true);
            await workspace.dispose();
            await waitFor(async () => (isAlive(pid) ? undefined : true), 2_000);
        } finally {
            await workspace.dispose();
        }
    }, 30_000);

    it('kills a background job with redirected output on dispose', async () => {
        const workspace = await createLocalSandbox({ root }).create({ runId: 'r1' });
        const pidFile = join(tmp, 'pid');
        try {
            const result = await workspace.exec(['sh', '-c', 'sleep 60 > /dev/null 2>&1 & echo $! > "$1"', 'sh', pidFile]);
            expect(result.exitCode).toBe(0);

            const pid = Number((await readFile(pidFile, 'utf8')).trim());
            expect(isAlive(pid)).toBe(true);
            await workspace.dispose();
            await waitFor(async () => (isAlive(pid) ? undefined : true), 2_000);
        } finally {
            await workspace.dispose();
        }
    }, 30_000);

    it('forgets the group of a background job once it ended, so a reused id is never killed', async () => {
        const clock = new ControllableClock();
        const workspace = await createLocalSandbox({ root, clock }).create({ runId: 'r1' });
        const pidFile = join(tmp, 'pid');
        try {
            // the job holds the output past the grace: the exec settles on the clock
            const pending = workspace.exec(['sh', '-c', 'echo $$ > "$1"; sleep 1 &', 'sh', pidFile]);
            const group = await waitFor(async () => {
                const text = await readFile(pidFile, 'utf8').catch(() => '');
                return text.trim() ? Number(text.trim()) : undefined;
            });
            await sleep(300);
            clock.advance(KILL_GRACE_MS);
            expect((await pending).exitCode).toBe(0);

            // the job ends, and with it its group
            await waitFor(async () => {
                try {
                    process.kill(-group, 0);
                    return undefined;
                } catch {
                    return true;
                }
            }, 5_000);
            clock.advance(LINGER_CHECK_MS);

            const kill = vi.spyOn(process, 'kill');
            await workspace.dispose();
            expect(kill).not.toHaveBeenCalledWith(-group, 'SIGKILL');
        } finally {
            vi.restoreAllMocks();
            await workspace.dispose();
        }
    }, 30_000);

    it('kills the background jobs of its open workspaces when the process exits, keeping the folders', async () => {
        const workspace = await createLocalSandbox({ root }).create({ runId: 'r1' });
        try {
            const { stdout } = await workspace.exec(['sh', '-c', 'sleep 600 >/dev/null 2>&1 & echo $!']);
            const job = Number(stdout.trim());
            expect(isAlive(job)).toBe(true);
            expect(process.listeners('exit')).toContain(killLingeringJobs);

            killLingeringJobs();
            await waitFor(async () => (isAlive(job) ? undefined : true), 5_000);
            expect(workspace.disposed).toBe(false);
            expect(await readdir(join(root, workspace.id))).toContain('workspace.json');
        } finally {
            await workspace.dispose();
        }
    }, 30_000);

    it('rejects an exec aborted while it checks its cwd', async () => {
        const workspace = await createLocalSandbox({ root }).create({ runId: 'r1' });
        try {
            const controller = new AbortController();
            const started = Date.now();
            const pending = workspace.exec(['sleep', '30'], { signal: controller.signal });
            controller.abort();
            await expect(pending).rejects.toThrow('exec aborted');
            expect(Date.now() - started).toBeLessThan(5_000);
        } finally {
            await workspace.dispose();
        }
    }, 40_000);

    it('refuses symbolic links that lead out of the workspace', async () => {
        const outside = join(tmp, 'outside');
        await mkdir(outside);
        await writeFile(join(outside, 'secret.txt'), 's3cret');
        const workspace = await createLocalSandbox({ root }).create({ runId: 'r1' });
        try {
            await workspace.writeFile('real.txt', 'inside');
            const linked = await workspace.exec(['sh', '-c', [
                'ln -s "$1/secret.txt" leak',
                'ln -s "$1" outdir',
                'ln -s "$1/missing.txt" dangling',
                'ln -s real.txt inner',
            ].join(' && '), 'sh', outside]);
            expect(linked.exitCode).toBe(0);

            await expect(workspace.readFile('leak')).rejects.toBeInstanceOf(ValidationError);
            await expect(workspace.readFile('outdir/secret.txt')).rejects.toBeInstanceOf(ValidationError);
            await expect(workspace.writeFile('leak', 'x')).rejects.toBeInstanceOf(ValidationError);
            await expect(workspace.writeFile('outdir/new.txt', 'x')).rejects.toBeInstanceOf(ValidationError);
            await expect(workspace.writeFile('outdir/a/b/new.txt', 'x')).rejects.toBeInstanceOf(ValidationError);
            await expect(workspace.writeFile('dangling', 'x')).rejects.toBeInstanceOf(ValidationError);
            await expect(workspace.exec(['pwd'], { cwd: 'outdir' })).rejects.toBeInstanceOf(ValidationError);
            expect(await readdir(outside)).toEqual(['secret.txt']);
            expect(await readFile(join(outside, 'secret.txt'), 'utf8')).toBe('s3cret');

            // a link that stays inside works
            expect(await workspace.readFile('inner')).toBe('inside');
            await workspace.writeFile('inner', 'changed');
            expect(await workspace.readFile('real.txt')).toBe('changed');
        } finally {
            await workspace.dispose();
        }
    });

    it('clears the kill timer when the child exits', async () => {
        const clock = new ControllableClock();
        const workspace = await createLocalSandbox({ root, clock }).create({ runId: 'r1' });
        try {
            const result = await workspace.exec(['true'], { timeoutMs: 1_000 });
            expect(result.exitCode).toBe(0);

            const kill = vi.spyOn(process, 'kill');
            clock.advance(1_000);
            expect(kill).not.toHaveBeenCalled();
        } finally {
            vi.restoreAllMocks();
            await workspace.dispose();
        }
    });

    it('disposes a failed checkout', async () => {
        const fixture = await createGitFixture({ 'README.md': '# demo\n' });
        try {
            await expect(createLocalSandbox({ root }).create({
                runId: 'r1',
                repo: fixture.url,
                ref: 'nope',
            })).rejects.toBeInstanceOf(SandboxError);
            expect(await readdir(root)).toEqual([]);
        } finally {
            await fixture.cleanup();
        }
    }, 30_000);

    it('kills on the clock', async () => {
        const clock = new ControllableClock();
        const workspace = await createLocalSandbox({ root, clock }).create({ runId: 'r1' });
        try {
            const pending = workspace.exec(['sleep', '30'], { timeoutMs: 1_000 });
            // let the child start before the timer fires
            await sleep(100);
            clock.advance(1_000);
            const result = await pending;
            expect(result.timedOut).toBe(true);
            expect(result.exitCode).toBe(137);
            expect(result.durationMs).toBe(1_000);
        } finally {
            await workspace.dispose();
        }
    }, 30_000);

    it('refuses exec past expiry', async () => {
        const clock = new ControllableClock();
        const workspace = await createLocalSandbox({
            root,
            clock,
            limits: { maxLifetimeMs: 60_000 },
        }).create({ runId: 'r1' });
        try {
            expect(workspace.info.expiresAt.getTime() - workspace.info.createdAt.getTime()).toBe(60_000);
            clock.advance(60_000);
            await expect(workspace.exec(['true'])).rejects.toThrow(/expired/);
            await expect(workspace.exec(['true'])).rejects.toBeInstanceOf(SandboxError);
            await expect(workspace.readFile('x')).rejects.toThrow(/expired/);
        } finally {
            await workspace.dispose();
        }
    });

    it('caps an exec timeout at the expiry', async () => {
        const clock = new ControllableClock();
        const workspace = await createLocalSandbox({
            root,
            clock,
            limits: { maxLifetimeMs: 2_000 },
        }).create({ runId: 'r1' });
        try {
            const pending = workspace.exec(['sleep', '30'], { timeoutMs: 60_000 });
            await sleep(100);
            clock.advance(2_000);
            expect(await pending).toMatchObject({ timedOut: true, exitCode: 137 });
        } finally {
            await workspace.dispose();
        }
    }, 30_000);

    it('marks itself gone when its directory vanished', async () => {
        const workspace = await createLocalSandbox({ root }).create({ runId: 'r1' });
        expect(workspace.disposed).toBe(false);
        await rm(join(root, workspace.id), { recursive: true, force: true });

        await expect(workspace.exec(['true'])).rejects.toThrow(/is gone.*create_workspace/);
        expect(workspace.disposed).toBe(true);
        await expect(workspace.writeFile('a.txt', 'x')).rejects.toThrow(/gone/);
        await expect(workspace.readFile('a.txt')).rejects.toThrow(/gone/);
        // a write never brings the directory back
        expect(await readdir(root)).toEqual([]);
        await workspace.dispose();
    });

    it('kills its background jobs once it finds its directory gone, since nothing disposes it then', async () => {
        const workspace = await createLocalSandbox({ root }).create({ runId: 'r1' });
        const pidFile = join(tmp, 'pid');
        try {
            await workspace.exec(['sh', '-c', 'sleep 60 > /dev/null 2>&1 & echo $! > "$1"', 'sh', pidFile]);
            const pid = Number((await readFile(pidFile, 'utf8')).trim());
            expect(isAlive(pid)).toBe(true);

            await rm(join(root, workspace.id), { recursive: true, force: true });
            await expect(workspace.exec(['true'])).rejects.toThrow(/is gone/);
            await waitFor(async () => (isAlive(pid) ? undefined : true), 2_000);
        } finally {
            await workspace.dispose();
        }
    }, 30_000);

    it('reads a vanished directory as gone on write and read too', async () => {
        const sandbox = createLocalSandbox({ root });
        const writer = await sandbox.create({ runId: 'r1' });
        await rm(join(root, writer.id), { recursive: true, force: true });
        await expect(writer.writeFile('a.txt', 'x')).rejects.toThrow(/is gone/);
        expect(writer.disposed).toBe(true);
        expect(await readdir(root)).toEqual([]);

        const reader = await sandbox.create({ runId: 'r1' });
        await rm(join(root, reader.id), { recursive: true, force: true });
        await expect(reader.readFile('a.txt')).rejects.toThrow(/is gone/);
        expect(reader.disposed).toBe(true);
    });

    it('is disposed after dispose', async () => {
        const workspace = await createLocalSandbox({ root }).create({ runId: 'r1' });
        await workspace.dispose();
        expect(workspace.disposed).toBe(true);
    });

    it('rejects invalid options', () => {
        expect(() => createLocalSandbox({ env: { 'A-B': 'x' } })).toThrow(InvalidAgentDefinitionError);
        expect(() => createLocalSandbox({ limits: { maxLifetimeMs: 10 } })).toThrow(InvalidAgentDefinitionError);
        expect(() => createLocalSandbox({ root: '' })).toThrow(InvalidAgentDefinitionError);
    });

    it('writes the workspace record and removes the directory on dispose', async () => {
        const workspace = await createLocalSandbox({ root }).create({ runId: 'r1' });
        const record = JSON.parse(await readFile(join(root, workspace.id, 'workspace.json'), 'utf8'));
        expect(record).toEqual({
            runId: 'r1',
            deployment: 'default',
            createdAt: workspace.info.createdAt.toISOString(),
            expiresAt: workspace.info.expiresAt.toISOString(),
        });
        await workspace.dispose();
        expect(await readdir(root)).toEqual([]);
    });

    it('keeps the record, which holds the create env, readable by the owner only', async () => {
        const workspace = await createLocalSandbox({ root }).create({ runId: 'r1', env: { NPM_TOKEN: 'npm_SECRET123' } });
        const dir = join(root, workspace.id);
        expect((await stat(dir)).mode & 0o777).toBe(0o700);
        expect((await stat(join(dir, 'workspace.json'))).mode & 0o777).toBe(0o600);
        await workspace.dispose();
    });
});
