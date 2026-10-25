/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
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
import { MemoryStore, createAgentState } from '@chamvi/core';
import type { ToolContext } from '@chamvi/core';
import { createWorkspaceManager } from '@chamvi/sandbox';
import type { IWorkspaceManager } from '@chamvi/sandbox';
import { createDockerSandbox } from '@chamvi/sandbox-docker';
import { describeDocker, dockerOptions } from '../utils/docker.ts';

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

describeDocker('coding tools in a container', () => {
    const runId = `test-coding-${randomUUID()}`;
    let manager: IWorkspaceManager;
    let tools: ToolSet;

    const call = async <T>(name: string, input: unknown): Promise<T> => {
        const execute = tools[name]?.execute as (i: unknown, o: unknown) => Promise<unknown>;
        return await execute(input, {
            toolCallId: 'call-1',
            messages: [],
            context: toolContext(runId),
        }) as T;
    };

    beforeAll(async () => {
        manager = createWorkspaceManager({ provider: createDockerSandbox(dockerOptions), gcIntervalMs: 0 });
        await manager.acquire(runId, {});
        tools = codingTools(manager);
    });

    afterAll(async () => {
        await manager?.close();
    });

    it('runs with HOME on /root, outside the workspace', async () => {
        await expect(call('bash', { command: 'echo "$HOME"; pwd' })).resolves.toMatchObject({ stdout: '/root\n/workspace\n', cwd: '/workspace' });
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

    it('returns promptly when the command leaves a job running', async () => {
        const started = Date.now();
        await expect(call('bash', { command: 'sleep 30 & echo started' })).resolves.toMatchObject({ stdout: 'started\n' });
        expect(Date.now() - started).toBeLessThan(2_000);
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
