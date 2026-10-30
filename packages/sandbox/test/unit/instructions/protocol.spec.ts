/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { createHash } from 'node:crypto';
import { SandboxError } from '@chamvi/core';
import { describe, expect, it } from 'vitest';
import type { ExecResult } from '@chamvi/sandbox';
import { readRepositoryInstructions } from '@chamvi/sandbox';
import { ControllableClock } from '../../utils/clock.ts';
import { createScriptedWorkspace } from '../../utils/workspace.ts';

const V = 'chamvi-instructions/1';

type Answer = Partial<ExecResult>;

/** The mode (`inspect`/`read`) and the paths of a discovery exec. */
const parse = (argv: readonly string[]) => ({ mode: argv[4] ?? '', paths: argv.slice(5) });

const inspectAll = (paths: string[], status: (path: string) => string): Answer => ({ stdout: `${V} inspect ${paths.length}\n${paths.map((path, index) => `${index} ${status(path)}\n`).join('')}${V} end\n` });

const readFrame = (bytes: Uint8Array): Answer => {
    const data = Buffer.from(bytes).toString('base64');

    return { stdout: `${V} read file\n${data}\n${V} end\n`, stderr: `${V} head 0\n` };
};

/** A workspace whose discovery execs see only `files` (path -> bytes). */
function fakeTree(files: Record<string, string | Uint8Array>, override?: (mode: string, paths: string[]) => Answer | undefined) {
    const encoded = new Map(Object.entries(files).map(([path, content]) => [
        path,
        typeof content === 'string' ? new TextEncoder().encode(content) : content,
    ]));

    return createScriptedWorkspace((argv: readonly string[]) => {
        const { mode, paths } = parse(argv);
        const answer = override?.(mode, paths);

        if (answer) {
            return answer;
        }

        if (mode === 'inspect') {
            return inspectAll(paths, (path) => (encoded.has(path) ? 'file' : 'absent'));
        }

        const bytes = encoded.get(paths[0] ?? '');

        return bytes ? readFrame(bytes) : { stdout: `${V} read absent\n${V} end\n` };
    });
}

describe('readRepositoryInstructions protocol', () => {
    it('runs fixed framework code with paths as data, bounded and cancellable', async () => {
        const workspace = fakeTree({ 'AGENTS.md': 'root\n' });
        const controller = new AbortController();

        await readRepositoryInstructions(workspace, ['src/a.ts'], { signal: controller.signal });

        expect(workspace.calls.length).toBeGreaterThan(0);

        for (const call of workspace.calls) {
            expect(call.argv.slice(0, 2)).toEqual(['/bin/sh', '-c']);
            expect(call.argv[3]).toBe('sh');
            expect(call.options.cwd).toBe('.');
            expect(call.options.timeoutMs).toBeLessThanOrEqual(5_000);
            expect(call.options.signal).toBeDefined();
        }

        expect(new Set(workspace.calls.map((call) => call.argv[2])).size).toBe(1);
        expect(workspace.calls[0]?.argv[2]).not.toContain('src/a.ts');
    });

    it.each([
        ['a non-zero exit', { exitCode: 1 }],
        ['a timeout', { timedOut: true, exitCode: 137 }],
        ['a truncated stdout', { stdoutTruncated: true }],
        ['a truncated stderr', { stderrTruncated: true }],
        ['a missing header', { stdout: 'garbage\n' }],
        ['a missing terminator', { stdout: `${V} inspect 1\n0 absent\n` }],
        ['a wrong record count', { stdout: `${V} inspect 2\n0 absent\n${V} end\n` }],
        ['an unknown status', { stdout: `${V} inspect 1\n0 maybe\n${V} end\n` }],
        ['trailing output', { stdout: `${V} inspect 1\n0 absent\n${V} end\nextra\n` }],
    ])('rejects an inspection with %s', async (_name, answer: Answer) => {
        const workspace = fakeTree({}, (mode) => (mode === 'inspect' ? answer : undefined));

        await expect(readRepositoryInstructions(workspace, ['a.ts'])).rejects.toBeInstanceOf(SandboxError);
    });

    const big = Buffer.alloc(32_770).toString('base64');

    it.each([
        ['invalid base64', `${V} read file\n%%%%\n${V} end\n`, `${V} head 0\n`],
        ['non-canonical base64', `${V} read file\naGl=\n${V} end\n`, `${V} head 0\n`],
        ['a length that is no base64 length', `${V} read file\naGk\n${V} end\n`, `${V} head 0\n`],
        ['a missing head status', `${V} read file\naGk=\n${V} end\n`, ''],
        ['extra stderr', `${V} read file\naGk=\n${V} end\n`, `${V} head 0\nnoise\n`],
        ['a missing data line', `${V} read file\n${V} end\n`, `${V} head 0\n`],
        ['a missing terminator', `${V} read file\naGk=\n`, `${V} head 0\n`],
        ['an unknown status', `${V} read maybe\n${V} end\n`, ''],
        ['more bytes than the read bound', `${V} read file\n${big}\n${V} end\n`, `${V} head 0\n`],
    ])('rejects a read with %s', async (_name, stdout: string, stderr: string) => {
        const workspace = fakeTree({ 'AGENTS.md': 'x' }, (mode) => (mode === 'read' ? { stdout, stderr } : undefined));

        await expect(readRepositoryInstructions(workspace)).rejects.toBeInstanceOf(SandboxError);
    });

    it('reports a read that failed after the open as unreadable', async () => {
        const workspace = fakeTree({ 'AGENTS.md': 'x' }, (mode) => (mode === 'read' ?
            { stdout: `${V} read file\naGk=\n${V} end\n`, stderr: `${V} head 1\n` } :
            undefined));
        const result = await readRepositoryInstructions(workspace);

        expect(result.diagnostics.map(({ path, code }) => ({ path, code }))).toEqual([{ path: 'AGENTS.md', code: 'unreadable' }]);
        expect(result.sources).toEqual([]);
    });

    it('rejects a workspace missing a utility, naming it', async () => {
        const workspace = fakeTree({}, () => ({ exitCode: 3, stdout: `${V} missing base64\n` }));

        await expect(readRepositoryInstructions(workspace)).rejects.toThrow(/base64/);
    });

    it('propagates a rejecting exec', async () => {
        const workspace = fakeTree({});

        workspace.exec = () => Promise.reject(new SandboxError('workspace disposed'));
        await expect(readRepositoryInstructions(workspace)).rejects.toThrow('workspace disposed');
    });

    it('redacts encoded secrets after decoding and hashes the original bytes', async () => {
        const secret = 'ghs_abcdefSECRET';
        const content = `use ${secret}\n`;
        const workspace = fakeTree({ 'AGENTS.md': content });

        workspace.redact = (text) => text.split(secret).join('[redacted]');

        const result = await readRepositoryInstructions(workspace);

        expect(result.sources[0]?.content).toBe('use [redacted]\n');
        expect(result.sources[0]?.sha256).toBe(createHash('sha256').update(content).digest('hex'));
    });

    it('reports an exhausted request deadline instead of starting another exec', async () => {
        const clock = new ControllableClock();
        const workspace = fakeTree({
            'AGENTS.md': '@a.md\n@b.md\n',
            'a.md': 'a\n',
            'b.md': 'b\n',
        });

        workspace.redact = (text) => {
            if (text === 'a\n') {
                clock.advance(30_000);
            }

            return text;
        };

        const result = await readRepositoryInstructions(workspace, undefined, { clock });

        expect(result.sources.map((source) => source.path)).toEqual(['AGENTS.md', 'a.md']);
        expect(result.diagnostics.map(({ code }) => code)).toEqual(['limit']);
        expect(result.complete).toBe(false);
        expect(workspace.calls.every((call) => (call.options.timeoutMs ?? 0) > 0)).toBe(true);
    });

    it('reports deadline exhaustion when the final exec succeeds after the deadline', async () => {
        const clock = new ControllableClock();
        const workspace = fakeTree({ 'AGENTS.md': '@a.md\n', 'a.md': 'a\n' }, (mode, paths) => {
            if (mode === 'read' && paths[0] === 'a.md') {
                clock.advance(3_001);
            }

            return undefined;
        });

        workspace.redact = (text) => {
            if (text === '@a.md\n') {
                clock.advance(27_000);
            }

            return text;
        };

        const result = await readRepositoryInstructions(workspace, undefined, { clock });

        expect(result.sources.map((source) => source.path)).toEqual(['AGENTS.md']);
        expect(result.diagnostics.map(({ code }) => code)).toEqual(['limit']);
        expect(result.complete).toBe(false);
    });

    it('checks the deadline after processing the final source', async () => {
        const clock = new ControllableClock();
        const workspace = fakeTree({ 'AGENTS.md': 'root\n' });

        workspace.redact = (text) => {
            if (text === 'root\n') {
                clock.advance(30_001);
            }

            return text;
        };

        const result = await readRepositoryInstructions(workspace, undefined, { clock });

        expect(result.diagnostics.map(({ code }) => code)).toEqual(['limit']);
        expect(result.complete).toBe(false);
    });

    it('aborts an exec still running when the request time is used up', async () => {
        const clock = new ControllableClock();
        const workspace = fakeTree({ 'AGENTS.md': '@a.md\n', 'a.md': 'a\n' });

        workspace.redact = (text) => {
            if (text === '@a.md\n') {
                clock.advance(27_000);
            }

            return text;
        };

        const { exec } = workspace;

        workspace.exec = (argv, options) => {
            if (parse(argv).mode !== 'read' || parse(argv).paths[0] !== 'a.md') {
                return exec(argv, options);
            }

            return new Promise(() => {
                clock.advance(3_000);
            });
        };

        const result = await readRepositoryInstructions(workspace, undefined, { clock });

        expect(result.diagnostics.map(({ code }) => code)).toEqual(['limit']);
        expect(result.complete).toBe(false);
    });

    it('still rejects a caller abort as an abort', async () => {
        const clock = new ControllableClock();
        const controller = new AbortController();
        const workspace = fakeTree({});

        workspace.exec = (_argv, options = {}) => new Promise((_resolve, reject) => {
            options.signal?.addEventListener('abort', () => reject(new SandboxError('exec aborted')), { once: true });
            controller.abort();
        });

        await expect(readRepositoryInstructions(workspace, ['a.ts'], { clock, signal: controller.signal }))
            .rejects.toThrow(/abort/);
    });

    it('gives an exec no more than the time left of the request', async () => {
        const clock = new ControllableClock();
        const workspace = fakeTree({ 'AGENTS.md': '@a.md\n', 'a.md': 'a\n' });

        workspace.redact = (text) => {
            if (text === '@a.md\n') {
                clock.advance(27_000);
            }

            return text;
        };

        await readRepositoryInstructions(workspace, undefined, { clock });

        expect(workspace.calls.at(-1)?.options.timeoutMs).toBeLessThanOrEqual(3_000);
    });
});
