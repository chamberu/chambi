/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import {
    afterAll,
    afterEach,
    beforeAll,
    beforeEach,
    describe,
    expect,
    it,
} from 'vitest';
import { SandboxError, ValidationError } from '@chamvi/core';
import type { BashResult, ReadFileResult } from '@chamvi/coding';
import type { GitFixture } from '@chamvi/test-kit';
import { createFixture, setupCoding } from '../../utils/setup.ts';
import type { CodingSetup } from '../../utils/setup.ts';

let fixture: GitFixture;
let s: CodingSetup;

beforeAll(async () => { fixture = await createFixture(); });
afterAll(async () => { await fixture.cleanup(); });
beforeEach(async () => { s = await setupCoding(fixture); });
afterEach(async () => { await s.cleanup(); });

describe('bash', () => {
    it('runs a command and reports the exit code', async () => {
        const result = await s.call<BashResult>('bash', { command: 'echo hi && exit 4' });
        expect(result).toMatchObject({
            exitCode: 4,
            stdout: 'hi\n',
            stderr: '',
            stdoutTruncated: false,
            stderrTruncated: false,
            outputCapped: false,
            timedOut: false,
        });
        expect(result.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('runs in a cwd for that call only', async () => {
        await expect(s.call('bash', { command: 'ls', cwd: 'src' })).resolves.toMatchObject({ stdout: 'a.ts\n', cwd: '/workspace' });
        await expect(s.call('bash', { command: 'ls src' })).resolves.toMatchObject({ stdout: 'a.ts\n' });
        await expect(s.call('bash', { command: 'ls', cwd: '../' })).rejects.toThrow(ValidationError);
    });

    it('refuses a cwd that is no directory', async () => {
        await expect(s.call('bash', { command: 'ls', cwd: 'missing' })).rejects.toThrow('cwd /workspace/missing is no directory in the workspace.');
    });

    it('keeps the working directory and exported variables across calls', async () => {
        await expect(s.call('bash', { command: 'cd src && export GREETING=hello && NOT_EXPORTED=1' })).resolves.toMatchObject({
            exitCode: 0,
            cwd: '/workspace/src',
        });
        await expect(s.call('bash', { command: 'ls; echo "$GREETING:$NOT_EXPORTED"' })).resolves.toMatchObject({
            stdout: 'a.ts\nhello:\n',
            cwd: '/workspace/src',
        });
        await expect(s.call('bash', { command: 'cd .. && pwd -P >/dev/null' })).resolves.toMatchObject({ cwd: '/workspace' });
    });

    it('keeps the state consistent after an exit or a failed cd', async () => {
        await expect(s.call('bash', { command: 'cd src; export STEP=1; exit 3' })).resolves.toMatchObject({
            exitCode: 3,
            cwd: '/workspace/src',
        });
        const failed = await s.call<BashResult>('bash', { command: 'cd missing' });
        expect(failed.exitCode).not.toBe(0);
        expect(failed.stderr).toContain('missing');
        expect(failed.cwd).toBe('/workspace/src');
        await expect(s.call('bash', { command: 'echo "$STEP"; set -e; false; echo never' })).resolves.toMatchObject({
            stdout: '1\n',
            exitCode: 1,
        });
    });

    it('does not hand the command its own text as positional parameters', async () => {
        await expect(s.call('bash', { command: 'echo "[$1][$#]"' })).resolves.toMatchObject({ stdout: '[][0]\n' });
    });

    it('keeps the full output in a log file and returns its head and tail', async () => {
        const result = await s.call<BashResult>('bash', { command: 'i=0; while [ $i -lt 5000 ]; do echo "line $i ............"; i=$((i+1)); done; echo oops >&2' });
        expect(result.exitCode).toBe(0);
        expect(result.stdoutTruncated).toBe(true);
        expect(result.stderrTruncated).toBe(false);
        expect(result.stderr).toBe('oops\n');
        expect(result.stdoutBytes).toBeGreaterThan(90_000);
        expect(result.stdoutLog).toMatch(/^~\/\.chamvi\/out\/[0-9a-f]{12}\.stdout\.log$/);
        expect(result.stdout.startsWith('line 0 ')).toBe(true);
        expect(result.stdout.endsWith('line 4999 ............\n')).toBe(true);
        expect(result.stdout).toMatch(new RegExp(`\\[\\.\\.\\. \\d+ bytes cut, full output in ${result.stdoutLog.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\]`));
        expect(Buffer.byteLength(result.stdout)).toBeLessThan(8_192 + 24_576 + 200);

        const middle = await s.call<ReadFileResult>('read_file', {
            path: result.stdoutLog, 
            offset: 2500, 
            limit: 2, 
        });
        expect(middle).toMatchObject({
            content: 'line 2499 ............\nline 2500 ............',
            startLine: 2500,
            endLine: 2501,
            totalLines: 5000,
        });
        const listed = await s.call<BashResult>('bash', { command: `wc -l < ${result.stdoutLog}` });
        expect(listed.stdout.trim()).toBe('5000');
    });

    it('returns promptly when the command leaves a background job running', async () => {
        const started = Date.now();
        const result = await s.call<BashResult>('bash', { command: 'sleep 30 & echo started' });
        expect(result).toMatchObject({
            exitCode: 0, 
            stdout: 'started\n', 
            timedOut: false, 
        });
        expect(Date.now() - started).toBeLessThan(5_000);
    });

    it('kills a command whose output passes the log cap and keeps the log at the cap', async () => {
        const capped = await setupCoding(fixture, { outputLogMaxBytes: 1_048_576 });
        try {
            const started = Date.now();
            const result = await capped.call<BashResult>('bash', { command: 'echo start >&2; yes', timeoutMs: 60_000 });
            expect(result).toMatchObject({
                outputCapped: true,
                timedOut: false,
                stdoutBytes: 1_048_576,
                stdoutTruncated: true,
                stderr: 'start\n',
            });
            expect(result.stdout.startsWith('y\ny\n')).toBe(true);
            expect(Date.now() - started).toBeLessThan(15_000);
            await expect(capped.call('bash', { command: 'yes | head -c 100 >&2; echo ok' })).resolves.toMatchObject({
                stdout: 'ok\n',
                stderrBytes: 100,
                outputCapped: false,
            });
        } finally {
            await capped.cleanup();
        }
    });

    it('refuses timeouts out of range', async () => {
        await expect(s.call('bash', { command: 'true', timeoutMs: 0 })).rejects.toThrow(ValidationError);
        await expect(s.call('bash', { command: 'true', timeoutMs: 1_800_001 })).rejects.toThrow(ValidationError);
        await expect(s.call('bash', { command: '' })).rejects.toThrow(ValidationError);
    });

    it('times out and still returns the output so far', async () => {
        await expect(s.call('bash', { command: 'echo before; sleep 30', timeoutMs: 500 })).resolves.toMatchObject({
            timedOut: true,
            stdout: 'before\n',
        });
    });

    it('stops on abort', async () => {
        const controller = new AbortController();
        const started = Date.now();
        setTimeout(() => controller.abort(), 200);
        await expect(s.call('bash', { command: 'sleep 30' }, 'r1', controller.signal)).rejects.toThrow(SandboxError);
        expect(Date.now() - started).toBeLessThan(10_000);
    });
});
