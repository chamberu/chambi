/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import Docker from 'dockerode';
import type { ToolSet } from 'ai';
import {
    afterAll,
    beforeAll,
    expect,
    it,
    vi,
} from 'vitest';
import { codingTools } from '@chamvi/coding';
import type {
    BashJobResult,
    BashOutputResult,
    BashResult,
    GrepResult,
} from '@chamvi/coding';
import { MemoryStore, SandboxError, createAgentState } from '@chamvi/core';
import type { ToolContext } from '@chamvi/core';
import { createWorkspaceManager } from '@chamvi/sandbox';
import type { IWorkspaceManager } from '@chamvi/sandbox';
import { createDockerSandbox } from '@chamvi/sandbox-docker';
import { buildFixtureImage, describeDocker, dockerOptions } from '../utils/docker.ts';

const offline = Boolean(process.env.CHAMVI_OFFLINE);

/** Alpine with git: BusyBox sh, grep and cut, no bash and no ripgrep. */
const ALPINE_IMAGE = 'chamvi/sandbox-alpine-git:test';

/** A 1x1 PNG. */
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');

/** A ToolContext of run `runId`, as the engine builds it (the coding tools read `run` only). */
function toolContext(runId: string): ToolContext {
    return {
        channels: {} as ToolContext['channels'],
        run: {
            runId,
            agent: 'coder',
            trigger: {
                id: `env-${runId}`,
                agent: 'coder',
                trigger: 'http',
                channel: 'http',
                payload: {},
                receivedAt: new Date(0),
            },
            signal: new AbortController().signal,
        },
        state: createAgentState('coder', undefined, new MemoryStore()),
        artifacts: {
            put: async () => { throw new TypeError('unused'); },
            get: async () => undefined,
            list: async () => [],
        },
    };
}

/** Calls a coding tool of `tools()` as run `runId`, as the AI SDK does. */
function caller(tools: () => ToolSet, runId: string) {
    return async <T>(name: string, input: unknown): Promise<T> => {
        const execute = tools()[name]?.execute as (i: unknown, o: unknown) => Promise<unknown>;
        return await execute(input, {
            toolCallId: 'call-1',
            messages: [],
            context: toolContext(runId),
        }) as T;
    };
}

/**
 * Leaves a torn env file, as two parallel saves could: written by a
 * background job, since a foreground call saves a whole one when it ends.
 */
async function tearEnv(call: ReturnType<typeof caller>): Promise<void> {
    const job = await call<BashJobResult>('bash', { command: 'printf \'export TORN="ab\' > "$HOME/.chamvi/shell/env"', background: true });
    await vi.waitFor(async () => {
        await expect(call('bash_output', { job: job.job })).resolves.toMatchObject({ status: 'exited', exitCode: 0 });
    }, { timeout: 5_000 });
}

/** A command counting the processes whose command line matches the regex `pattern` (no ps in a slim image). */
function countProcesses(pattern: string): string {
    return `for p in /proc/[0-9]*; do tr '\\0' ' ' < "$p/cmdline" 2>/dev/null; echo; done | grep -c '${pattern}'`;
}

/**
 * Starts a call that leaves a loop writing to its stdout log and expects the
 * log to stop growing at the 1 MiB cap of `call`'s tools.
 */
async function expectLeaverCapped(call: ReturnType<typeof caller>): Promise<void> {
    const line = 'x'.repeat(64);
    const result = await call<BashResult>('bash', { command: `echo started; (while :; do echo ${line}; done) &` });
    const log = result.stdoutLog.replace('~', '"$HOME"');
    await vi.waitFor(async () => {
        const sizes = await call<BashResult>('bash', { command: `a=$(wc -c < ${log}); sleep 1.5; b=$(wc -c < ${log}); echo $a $b` });
        const [before, after] = sizes.stdout.trim().split(' ').map(Number);
        expect(after).toBe(before);
        expect(after).toBeLessThanOrEqual(1_048_576);
    }, { timeout: 15_000, interval: 500 });
}

/** Expects a timeout to kill the whole command (nothing it started runs on) and to read as one. */
async function expectTimeoutKills(call: ReturnType<typeof caller>): Promise<void> {
    await expect(call('bash', { command: 'echo before; sleep 0.1; sleep 17; echo after > /tmp/after', timeoutMs: 1_000 })).resolves.toMatchObject({
        timedOut: true,
        stdout: 'before\n',
    });
    await new Promise((resolve) => { setTimeout(resolve, 1_000); });
    await expect(call('bash', { command: `${countProcesses('[s]leep 17')}; test -e /tmp/after && echo after` })).resolves.toMatchObject({ stdout: '0\n' });
}

describeDocker('coding tools in a container', () => {
    const runId = `test-coding-${randomUUID()}`;
    let manager: IWorkspaceManager;
    let tools: ToolSet;
    const call = caller(() => tools, runId);

    beforeAll(async () => {
        manager = createWorkspaceManager({ provider: createDockerSandbox(dockerOptions), gcIntervalMs: 0 });
        await manager.acquire(runId, {});
        tools = codingTools(manager);
    });

    afterAll(async () => {
        await manager?.close();
    });

    it('runs with HOME on the home volume, outside the workspace', async () => {
        await expect(call('bash', { command: 'echo "$HOME"; pwd' })).resolves.toMatchObject({ stdout: '/home/sandbox\n/workspace\n', cwd: '/workspace' });
    });

    it('keeps the working directory and exports, also through an exit', async () => {
        await call('bash', { command: 'mkdir -p sub/dir && cd sub && export ANSWER=42; exit 5' });
        await expect(call('bash', { command: 'pwd; echo "$ANSWER"' })).resolves.toMatchObject({
            stdout: '/workspace/sub\n42\n',
            cwd: '/workspace/sub',
        });
        await call('bash', { command: 'cd /workspace' });
    });

    it('keeps the state with dash as the inner shell too', async () => {
        // a bash shim that is dash: command -v bash finds /usr/local/bin first
        await call('bash', { command: 'ln -sf /bin/sh /usr/local/bin/bash' });
        try {
            await call('bash', { command: 'cd sub/dir && export SHELL_KIND=dash; false' });
            await expect(call('bash', { command: 'echo "$SHELL_KIND"; readlink -f /proc/$$/exe' })).resolves.toMatchObject({
                stdout: 'dash\n/usr/bin/dash\n',
                cwd: '/workspace/sub/dir',
            });
            // a torn env file (two parallel saves) must not end every later call
            await tearEnv(call);
            await expect(call('bash', { command: 'echo alive; export SHELL_KIND=again' })).resolves.toMatchObject({ exitCode: 0, stdout: 'alive\n' });
            await expect(call('bash', { command: 'echo "$SHELL_KIND"' })).resolves.toMatchObject({ stdout: 'again\n' });
        } finally {
            await call('bash', { command: 'rm -f /usr/local/bin/bash; cd /workspace' });
        }
    });

    it('returns the output so far after a timeout', async () => {
        await expect(call('bash', { command: 'echo before; sleep 30', timeoutMs: 1_000 })).resolves.toMatchObject({
            timedOut: true,
            stdout: 'before\n',
        });
    });

    it('returns promptly when the command leaves a job running, and keeps it', async () => {
        const started = Date.now();
        await expect(call('bash', { command: 'sleep 31 & echo started' })).resolves.toMatchObject({ stdout: 'started\n' });
        expect(Date.now() - started).toBeLessThan(2_000);
        await new Promise((resolve) => { setTimeout(resolve, 1_500); });
        const left = await call<BashResult>('bash', { command: countProcesses('[s]leep 31') });
        expect(Number(left.stdout)).toBeGreaterThan(0);
    });

    it('kills the whole command after its timeout', async () => {
        await expectTimeoutKills(call);
    });

    it('stops a process the command leaves writing once its log passes the cap', async () => {
        const capped = codingTools(manager, { outputLogMaxBytes: 1_048_576 });
        await expectLeaverCapped(caller(() => capped, runId));
    });

    it('spills long output to a log read_file and grep can read', async () => {
        const result = await call<BashResult>('bash', { command: 'seq 1 20000; echo done >&2' });
        expect(result).toMatchObject({ stdoutTruncated: true, stderr: 'done\n' });
        expect(result.stdout.endsWith('20000\n')).toBe(true);
        await expect(call('read_file', {
            path: result.stdoutLog, 
            offset: 10_000, 
            limit: 1, 
        })).resolves.toMatchObject({
            content: '10000',
            totalLines: 20_000,
        });
        await expect(call('grep', { pattern: '^1999[0-9]$', path: result.stdoutLog })).resolves.toMatchObject({
            matches: expect.arrayContaining([{
                path: result.stdoutLog, 
                line: 19_995, 
                text: '19995', 
            }]),
            engine: 'ripgrep',
        });
    });

    it('runs, reads and kills a background job with its children', async () => {
        const job = await call<BashJobResult>('bash', {
            command: 'sh -c \'echo $$ > /tmp/child.pid; exec sleep 60\' & echo up; wait',
            background: true,
        });
        await vi.waitFor(async () => {
            await expect(call('bash_output', { job: job.job })).resolves.toMatchObject({ status: 'running', output: 'up\n' });
        }, { timeout: 5_000 });
        const pid = await vi.waitFor(async () => {
            const read = await call<BashResult>('bash', { command: 'cat /tmp/child.pid' });
            expect(read.stdout).toMatch(/^\d+\n$/);
            return read.stdout.trim();
        }, { timeout: 5_000 });

        await expect(call('bash_kill', { job: job.job })).resolves.toMatchObject({ status: 'killed' });
        await expect(call('bash', { command: `kill -0 ${pid}` })).resolves.toMatchObject({ exitCode: 1 });
        await expect(call<BashOutputResult>('bash_output', { job: job.job })).resolves.toMatchObject({ status: 'killed' });

        const quick = await call<BashJobResult>('bash', { command: 'exit 4', background: true });
        await vi.waitFor(async () => {
            await expect(call('bash_output', { job: quick.job })).resolves.toMatchObject({ status: 'exited', exitCode: 4 });
        }, { timeout: 5_000 });
    });

    it('searches with ripgrep, hidden files always, ignored ones on request', async () => {
        await call('bash', {
            command: 'git init -q . 2>/dev/null; printf "node_modules\\n" > .gitignore; mkdir -p node_modules/x .github src; ' +
                'echo "needle dep" > node_modules/x/i.js; echo "needle ci" > .github/ci.yml; echo "needle src" > src/a.ts; ' +
                'printf "needle%05000d\\n" 0 > src/min.js',
        });
        const plain = await call<GrepResult>('grep', { pattern: 'needle [a-z]+' });
        expect(plain.engine).toBe('ripgrep');
        expect(plain.matches.map((match) => match.path).sort()).toEqual(['.github/ci.yml', 'src/a.ts']);
        const all = await call<GrepResult>('grep', { pattern: 'needle', includeIgnored: true });
        expect(all.matches.map((match) => match.path).sort()).toEqual(['.github/ci.yml', 'node_modules/x/i.js', 'src/a.ts', 'src/min.js']);
        expect(all.matches.find((match) => match.path === 'src/min.js')?.text).toHaveLength(500);
        await expect(call('glob', { pattern: '**/*.js', includeIgnored: true })).resolves.toEqual({
            files: ['node_modules/x/i.js', 'src/min.js'],
            truncated: false,
        });
        await expect(call('grep', { pattern: '(' })).rejects.toThrow(/grep failed/);
    });

    it('reads images and binary files and writes bytes', async () => {
        await call('write_file', {
            path: 'img/logo.png', 
            content: PNG.toString('base64'), 
            encoding: 'base64', 
        });
        await expect(call('read_file', { path: 'img/logo.png' })).resolves.toMatchObject({
            type: 'image', 
            mediaType: 'image/png', 
            bytes: PNG.length, 
        });

        const bytes = new Uint8Array(512 * 1024).map((_, index) => (index * 7) % 256);
        await call('write_file', {
            path: 'bin/data.bin', 
            content: Buffer.from(bytes).toString('base64'), 
            encoding: 'base64', 
        });
        await expect(call('read_file', { path: 'bin/data.bin', encoding: 'base64' })).resolves.toMatchObject({
            content: Buffer.from(bytes).toString('base64'),
            bytes: bytes.length,
        });
    });
});

describeDocker('coding tools in a BusyBox image', () => {
    const runId = `test-coding-alpine-${randomUUID()}`;
    let manager: IWorkspaceManager;
    let tools: ToolSet;
    const call = caller(() => tools, runId);

    beforeAll(async () => {
        if (offline) return;
        await buildFixtureImage(new Docker(), 'alpine-git', ALPINE_IMAGE);
        manager = createWorkspaceManager({ provider: createDockerSandbox({ ...dockerOptions, image: ALPINE_IMAGE }), gcIntervalMs: 0 });
        await manager.acquire(runId, {});
        tools = codingTools(manager, { outputLogMaxBytes: 1_048_576 });
    });

    afterAll(async () => {
        await manager?.close();
    });

    it.skipIf(offline)('keeps the shell state under BusyBox sh, also over a torn env file', async () => {
        await expect(call('bash', { command: 'command -v bash rg; mkdir -p a/b && cd a/b && export KIND=ash' })).resolves.toMatchObject({
            stdout: '',
            cwd: '/workspace/a/b',
        });
        await expect(call('bash', { command: 'echo "$KIND"' })).resolves.toMatchObject({ stdout: 'ash\n' });
        await tearEnv(call);
        await expect(call('bash', { command: 'echo alive; export KIND=again; cd /workspace' })).resolves.toMatchObject({ exitCode: 0, stdout: 'alive\n' });
        await expect(call('bash', { command: 'echo "$KIND"' })).resolves.toMatchObject({ stdout: 'again\n', cwd: '/workspace' });
    });

    it.skipIf(offline)('finds matches with git grep and BusyBox grep', async () => {
        await call('bash', {
            command: 'git init -q . 2>/dev/null; mkdir -p src && printf "needle one\\nx\\nneedle two\\n" > src/a.txt && ' +
                'printf "needle%05000d\\n" 0 > src/min.js',
        });
        const found = await call<GrepResult>('grep', { pattern: 'needle [a-z]+' });
        expect(found).toEqual({
            matches: [
                {
                    path: 'src/a.txt',
                    line: 1,
                    text: 'needle one',
                },
                {
                    path: 'src/a.txt',
                    line: 3,
                    text: 'needle two',
                },
            ],
            truncated: false,
            engine: 'git-grep',
        });
        await expect(call<GrepResult>('grep', { pattern: 'needle0' })).resolves.toMatchObject({ matches: [{ path: 'src/min.js', line: 1 }] });

        const run = await call<BashResult>('bash', { command: 'printf "a\\nneedle 1\\nb\\nneedle 2"' });
        await expect(call('grep', {
            pattern: 'NEEDLE', 
            path: run.stdoutLog, 
            ignoreCase: true, 
        })).resolves.toEqual({
            matches: [
                {
                    path: run.stdoutLog,
                    line: 2,
                    text: 'needle 1',
                },
                {
                    path: run.stdoutLog,
                    line: 4,
                    text: 'needle 2',
                },
            ],
            truncated: false,
            engine: 'grep',
        });
        await expect(call('grep', { pattern: '(', path: run.stdoutLog })).rejects.toThrow(/grep failed: .*regex/);
    });

    it.skipIf(offline)('leaves no zombie behind under a PID 1 that is no init', async () => {
        for (let i = 0; i < 10; i++) {
            await expect(call('bash', { command: 'echo hi' })).resolves.toMatchObject({ stdout: 'hi\n' });
        }
        const job = await call<BashJobResult>('bash', { command: 'exit 0', background: true });
        await vi.waitFor(async () => {
            await expect(call('bash_output', { job: job.job })).resolves.toMatchObject({ status: 'exited' });
        }, { timeout: 5_000 });
        // field 3 of /proc/<pid>/stat is the state; the names here hold no space
        const zombies = await call<BashResult>('bash', { command: 'cat /proc/[0-9]*/stat 2>/dev/null | awk \'$3 == "Z" { print $2 }\'' });
        expect(zombies).toMatchObject({ exitCode: 0, stdout: '' });
    });

    it.skipIf(offline)('kills a command whose log passes the cap', async () => {
        await expect(call('bash', { command: 'yes', timeoutMs: 60_000 })).resolves.toMatchObject({
            outputCapped: true,
            timedOut: false,
            stdoutBytes: 1_048_576,
        });
        await expect(call('bash', { command: 'echo ok' })).resolves.toMatchObject({ stdout: 'ok\n', outputCapped: false });
    });

    it.skipIf(offline)('kills the whole command after its timeout under BusyBox timeout', async () => {
        await expectTimeoutKills(call);
    });

    it.skipIf(offline)('stops a process the command leaves writing once its log passes the cap', async () => {
        await expectLeaverCapped(call);
    });
});

describeDocker('coding tools with HOME on a small /tmp', () => {
    const runId = `test-coding-hardened-${randomUUID()}`;
    let manager: IWorkspaceManager;
    let tools: ToolSet;
    const call = caller(() => tools, runId);

    beforeAll(async () => {
        manager = createWorkspaceManager({
            provider: createDockerSandbox({
                ...dockerOptions,
                user: '1000:1000',
                readOnlyRoot: true,
                tmpSize: '16Mi',
            }),
            gcIntervalMs: 0,
        });
        await manager.acquire(runId, {});
        tools = codingTools(manager);
    });

    afterAll(async () => {
        await manager?.close();
    });

    it('says the disk is full instead of answering with a broken report', async () => {
        await expect(call('bash', { command: 'echo "$HOME"' })).resolves.toMatchObject({ stdout: '/tmp\n' });
        await expect(call('bash', { command: 'head -c 33554432 /dev/zero > /tmp/fill; echo filled' })).rejects.toThrow(SandboxError);
        await expect(call('bash', { command: 'echo hello' })).rejects.toThrow(/no space left/);
        await expect(call('bash', { command: 'rm -f /tmp/fill; echo freed' })).resolves.toMatchObject({ exitCode: 0, stdout: 'freed\n' });
    });
});
