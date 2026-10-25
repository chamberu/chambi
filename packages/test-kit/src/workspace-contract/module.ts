/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import {
    afterAll,
    beforeAll,
    describe,
    expect,
    it,
} from 'vitest';
import { SandboxError, ValidationError } from '@chamvi/core';
import type { ContractWorkspace, WorkspaceContractFactory, WorkspaceContractOptions } from './types.ts';

const TEST_TIMEOUT_MS = 30_000;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// The suite runs real processes, so it waits on real time (documented exception to IClock).
const sleep = (ms: number) => new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
});

/**
 * Shared behavioural contract for every `IWorkspace` a sandbox provider
 * creates: argv exec, exit codes, stdin, cwd and path escapes, a missing
 * cwd, a background job holding the output, output caps, process-group
 * kills on timeout, abort, UTF-8 files, size caps and dispose, and with
 * `options.find` a workspace found again after its handle was dropped and
 * never one whose checkout record (`git config chamvi.checkout`, written last
 * by `prepareWorkspace`) is missing. It runs real processes with short real
 * timeouts.
 *
 * @param name     Suite name, e.g. the provider name.
 * @param factory  A fresh, repo-less workspace per call; the suite disposes it.
 * @param options  `find` of a second provider instance (the find section).
 */
export function describeWorkspaceContract(name: string, factory: WorkspaceContractFactory, options: WorkspaceContractOptions = {}): void {
    describe(`workspace contract: ${name}`, () => {
        let workspace: ContractWorkspace;

        beforeAll(async () => {
            workspace = await factory();
        }, TEST_TIMEOUT_MS);

        afterAll(async () => {
            await workspace?.dispose();
        }, TEST_TIMEOUT_MS);

        it('runs argv and reports the exit code', async () => {
            const result = await workspace.exec(['echo', 'hello']);
            expect(result).toMatchObject({
                exitCode: 0,
                stdout: 'hello\n',
                stderr: '',
                stdoutTruncated: false,
                stderrTruncated: false,
                timedOut: false,
            });
            expect(result.durationMs).toBeGreaterThanOrEqual(0);
        }, TEST_TIMEOUT_MS);

        it('separates stdout and stderr', async () => {
            const result = await workspace.exec(['sh', '-c', 'echo out; echo err >&2; exit 3']);
            expect(result.exitCode).toBe(3);
            expect(result.stdout).toBe('out\n');
            expect(result.stderr).toBe('err\n');
        }, TEST_TIMEOUT_MS);

        it('reports a missing command as 127', async () => {
            const result = await workspace.exec(['chamvi-no-such-command']);
            expect(result.exitCode).toBe(127);
        }, TEST_TIMEOUT_MS);

        it('passes stdin', async () => {
            const result = await workspace.exec(['cat'], { stdin: 'piped ✓' });
            expect(result.stdout).toBe('piped ✓');
        }, TEST_TIMEOUT_MS);

        it('has a uuid id', () => {
            expect(workspace.id).toMatch(UUID_PATTERN);
        });

        it('runs in a relative cwd and refuses escapes', async () => {
            await workspace.writeFile('sub/dir/f.txt', 'x');
            const result = await workspace.exec(['pwd'], { cwd: 'sub/dir' });
            expect(result.stdout.endsWith('/sub/dir\n')).toBe(true);

            for (const cwd of ['../..', '/etc', '', 'a\0b']) {
                await expect(workspace.exec(['pwd'], { cwd })).rejects.toBeInstanceOf(ValidationError);
            }
        }, TEST_TIMEOUT_MS);

        it('refuses a cwd that is no directory', async () => {
            await workspace.writeFile('cwd-file.txt', 'x');
            for (const cwd of ['nope', 'cwd-file.txt']) {
                const error = await workspace.exec(['pwd'], { cwd }).catch((e: unknown) => e);
                expect(error).toBeInstanceOf(SandboxError);
                expect((error as SandboxError).message).toBe(`cwd /workspace/${cwd} is no directory in the workspace.`);
            }
        }, TEST_TIMEOUT_MS);

        it('returns when the command exits while a background job holds its output', async () => {
            const started = Date.now();
            const result = await workspace.exec(['sh', '-c', 'echo before >&2; sleep 60 & echo started'], { timeoutMs: 20_000 });
            expect(result).toMatchObject({
                exitCode: 0,
                stdout: 'started\n',
                stderr: 'before\n',
                timedOut: false,
            });
            expect(Date.now() - started).toBeLessThan(10_000);
        }, TEST_TIMEOUT_MS);

        it('caps output per stream', async () => {
            const result = await workspace.exec(['sh', '-c', 'head -c 1000000 /dev/zero | tr "\\0" a']);
            expect(result.exitCode).toBe(0);
            expect(Buffer.byteLength(result.stdout)).toBe(65_536);
            expect(result.stdoutTruncated).toBe(true);
            expect(result.timedOut).toBe(false);
        }, TEST_TIMEOUT_MS);

        it('kills the whole process group on timeout', async () => {
            const result = await workspace.exec(
                ['sh', '-c', '(sleep 2; touch late.txt) & sleep 30'],
                { timeoutMs: 500 },
            );
            expect(result.timedOut).toBe(true);
            expect(result.durationMs).toBeLessThan(10_000);

            await sleep(3_000);
            const listing = await workspace.exec(['ls', '-a']);
            expect(listing.stdout).not.toContain('late.txt');
        }, TEST_TIMEOUT_MS);

        it('rejects an aborted exec', async () => {
            const controller = new AbortController();
            setTimeout(() => controller.abort(), 200);
            const started = Date.now();
            await expect(workspace.exec(['sleep', '30'], { signal: controller.signal }))
                .rejects.toBeInstanceOf(SandboxError);
            expect(Date.now() - started).toBeLessThan(10_000);
        }, TEST_TIMEOUT_MS);

        it('round-trips UTF-8 files and creates directories', async () => {
            const content = 'héllo 👋\n';
            await workspace.writeFile('a/b/ü.txt', content);
            expect(await workspace.readFile('a/b/ü.txt')).toBe(content);
            expect(await workspace.readFile('/workspace/a/b/ü.txt')).toBe(content);
        }, TEST_TIMEOUT_MS);

        it('refuses a file that is not UTF-8 text', async () => {
            const created = await workspace.exec(['sh', '-c', "printf 'a\\377b' > latin1.txt"]);
            expect(created.exitCode).toBe(0);
            await expect(workspace.readFile('latin1.txt')).rejects.toBeInstanceOf(SandboxError);
        }, TEST_TIMEOUT_MS);

        it('writes a file whole, also with a concurrent write, and keeps its mode', async () => {
            const long = 'a'.repeat(1_000_000);
            const short = 'b'.repeat(10);
            for (let round = 0; round < 3; round++) {
                await Promise.all([workspace.writeFile('race.txt', long), workspace.writeFile('race.txt', short)]);
                expect([long, short]).toContain(await workspace.readFile('race.txt'));
            }

            await workspace.writeFile('run.sh', '#!/bin/sh\necho one\n');
            expect((await workspace.exec(['chmod', '755', 'run.sh'])).exitCode).toBe(0);
            await workspace.writeFile('run.sh', '#!/bin/sh\necho two\n');
            expect((await workspace.exec(['./run.sh'])).stdout).toBe('two\n');
            const listing = await workspace.exec(['ls', '-a']);
            expect(listing.stdout).not.toContain('.chamvi-write-');
        }, TEST_TIMEOUT_MS);

        it('refuses escaping, missing and oversized files', async () => {
            await expect(workspace.readFile('../x')).rejects.toBeInstanceOf(ValidationError);
            await expect(workspace.readFile('')).rejects.toBeInstanceOf(ValidationError);
            await expect(workspace.readFile('missing.txt')).rejects.toBeInstanceOf(SandboxError);
            await expect(workspace.writeFile('big', 'a'.repeat(1_048_577))).rejects.toBeInstanceOf(ValidationError);

            const created = await workspace.exec(['sh', '-c', 'head -c 1048577 /dev/zero > big2']);
            expect(created.exitCode).toBe(0);
            await expect(workspace.readFile('big2')).rejects.toBeInstanceOf(SandboxError);
        }, TEST_TIMEOUT_MS);

        it('has a writable HOME', async () => {
            const result = await workspace.exec(['sh', '-c', 'touch "$HOME/.probe" && echo ok']);
            expect(result.stdout).toBe('ok\n');
        }, TEST_TIMEOUT_MS);

        it('is unusable after dispose and disposes idempotently', async () => {
            const own = await factory();
            expect(own.disposed).toBe(false);
            await own.dispose();
            expect(own.disposed).toBe(true);
            await own.dispose();
            await expect(own.exec(['true'])).rejects.toBeInstanceOf(SandboxError);
            await expect(own.readFile('x')).rejects.toBeInstanceOf(SandboxError);
        }, TEST_TIMEOUT_MS);

        it('settles an exec when disposed', async () => {
            const own = await factory();
            const started = Date.now();
            const pending = own.exec(['sleep', '30']);
            const settled = expect(pending).rejects.toThrow(/disposed/);
            await sleep(200);
            await own.dispose();
            await settled;
            await expect(pending).rejects.toBeInstanceOf(SandboxError);
            expect(Date.now() - started).toBeLessThan(10_000);
        }, TEST_TIMEOUT_MS);

        const { find } = options;
        it.runIf(find !== undefined)('finds a workspace again after its handle was dropped', async () => {
            const runId = `contract-${randomUUID()}`;
            const created = await factory({ runId });
            let found: ContractWorkspace[] = [];
            try {
                await created.writeFile('kept/note.txt', 'still here ✓');
                const { id } = created;
                // the handle is dropped: only a second provider instance looks

                found = await find!(runId);
                expect(found).toHaveLength(1);
                const [again] = found;
                expect(again!.id).toBe(id);
                expect(again!.disposed).toBe(false);
                expect(again!.info?.runId).toBe(runId);
                expect(await again!.readFile('kept/note.txt')).toBe('still here ✓');
                expect((await again!.exec(['cat', 'kept/note.txt'])).stdout).toBe('still here ✓');

                expect(await find!(`contract-${randomUUID()}`)).toEqual([]);

                await again!.dispose();
                expect(await find!(runId)).toEqual([]);
            } finally {
                await Promise.all(found.map((workspace) => workspace.dispose().catch(() => undefined)));
                await created.dispose().catch(() => undefined);
            }
        }, TEST_TIMEOUT_MS);

        it.runIf(find !== undefined)('never finds a workspace whose checkout did not finish', async () => {
            const runId = `contract-${randomUUID()}`;
            const created = await factory({ runId });
            let found: ContractWorkspace[] = [];
            try {
                // the state a create killed before the end of prepareWorkspace leaves:
                // its record (labels, metadata) is there, the end of the checkout is not
                const unset = await created.exec(['git', 'config', '--unset', 'chamvi.checkout']);
                expect(unset.exitCode).toBe(0);

                found = await find!(runId);
                expect(found).toEqual([]);
            } finally {
                await Promise.all(found.map((workspace) => workspace.dispose().catch(() => undefined)));
                await created.dispose().catch(() => undefined);
            }
        }, TEST_TIMEOUT_MS);
    });
}
