/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { describe, expect, it } from 'vitest';
import { SandboxError, ValidationError } from '@chamvi/core';
import { FILE_MAX_BYTES, createRemoteWorkspace } from '@chamvi/sandbox';
import { WRITE_FILE_SCRIPT } from '../../../src/remote/constants.ts';
import { ControllableClock } from '../../utils/clock.ts';
import { createFakeTransport } from '../../utils/transport.ts';
import type { FakeTransportHandler } from '../../utils/transport.ts';

const START = 1_000_000;


const encode = (text: string) => new TextEncoder().encode(text);

function setup(handler?: FakeTransportHandler, lifetimeMs = 1_800_000) {
    const clock = new ControllableClock(new Date(START));
    const transport = createFakeTransport(handler);
    const workspace = createRemoteWorkspace({
        id: 'ws-1',
        info: {
            runId: 'run-1',
            provider: 'remote',
            createdAt: new Date(START),
            expiresAt: new Date(START + lifetimeMs),
        },
        transport,
        clock,
    });

    return {
        clock,
        transport,
        workspace,
    };
}

describe('remote workspace: readFile', () => {
    it('cats the file inside the timeout wrapper', async () => {
        const { transport, workspace } = setup(() => ({ stdout: encode('héllo 👋\n') }));

        expect(await workspace.readFile('a/b.txt')).toBe('héllo 👋\n');
        expect(await workspace.readFile('/workspace/a/b.txt')).toBe('héllo 👋\n');

        for (const call of transport.calls) {
            expect(call.argv).toEqual(['timeout', '-k', '5', '300', 'cat', '--', '/workspace/a/b.txt']);
            expect(call.options.cwd).toBe('/workspace');
            expect(call.options.stdin).toBeUndefined();
        }
    });

    it('clamps the read timeout to the expiry', async () => {
        const { transport, workspace } = setup(undefined, 20_000);

        await workspace.readFile('a.txt');
        expect(transport.calls[0]!.argv.slice(0, 4)).toEqual(['timeout', '-k', '5', '20']);
    });

    it('refuses escaping paths without a call', async () => {
        const { transport, workspace } = setup();

        for (const path of ['../x', '', '/etc/passwd', 'a\0b']) {
            await expect(workspace.readFile(path)).rejects.toBeInstanceOf(ValidationError);
        }

        expect(transport.calls).toHaveLength(0);
    });

    it('refuses the workspace root without a call', async () => {
        const { transport, workspace } = setup();

        for (const path of ['.', '/workspace']) {
            await expect(workspace.readFile(path)).rejects.toThrow('/workspace is no file.');
        }

        expect(transport.calls).toHaveLength(0);
    });

    it('throws SandboxError with stderr on a non-zero exit', async () => {
        const { workspace } = setup(() => ({ exitCode: 1, stderr: encode('cat: /workspace/a.txt: Permission denied\n') }));
        const error = await workspace.readFile('a.txt').catch((e: unknown) => e);

        expect(error).toBeInstanceOf(SandboxError);
        expect((error as SandboxError).message).toContain('cat: /workspace/a.txt: Permission denied');
    });

    it('reports a missing file as not found', async () => {
        const { workspace } = setup(() => ({ exitCode: 1, stderr: encode('cat: /workspace/missing.txt: No such file or directory\n') }));

        await expect(workspace.readFile('missing.txt')).rejects.toThrow('file not found: /workspace/missing.txt');
    });

    it('refuses a file larger than the limit', async () => {
        for (const size of [FILE_MAX_BYTES + 1, FILE_MAX_BYTES + 100]) {
            const { workspace } = setup(() => ({ stdout: new Uint8Array(size).fill(0x61) }));
            const error = await workspace.readFile('big').catch((e: unknown) => e);

            expect(error).toBeInstanceOf(SandboxError);
            expect((error as SandboxError).message).toMatch(/larger than/);
        }
    });

    it('accepts a file of exactly the limit', async () => {
        const { workspace } = setup(() => ({ stdout: new Uint8Array(FILE_MAX_BYTES).fill(0x61) }));

        expect(await workspace.readFile('max')).toHaveLength(FILE_MAX_BYTES);
    });

    it('throws SandboxError when the read times out', async () => {
        const slow = setup(() => {
            slow.clock.advance(300_000);

            return { exitCode: 124 };
        });

        await expect(slow.workspace.readFile('a.txt')).rejects.toThrow(/timed out/);
    });
});

describe('remote workspace: readBytes', () => {
    it('returns the raw bytes of a file that is not UTF-8', async () => {
        const bytes = new Uint8Array([0x89, 0x50, 0x4E, 0x47, 0xFF, 0x00]);
        const { transport, workspace } = setup(() => ({ stdout: bytes }));

        expect(await workspace.readBytes('img.png')).toEqual(bytes);
        expect(transport.calls[0]!.argv.slice(4)).toEqual(['cat', '--', '/workspace/img.png']);
        await expect(workspace.readFile('img.png')).rejects.toThrow('/workspace/img.png is not UTF-8 text.');
    });

    it('refuses a file larger than the limit', async () => {
        const { workspace } = setup(() => ({ stdout: new Uint8Array(FILE_MAX_BYTES + 1) }));

        await expect(workspace.readBytes('big')).rejects.toThrow(/larger than/);
    });
});

describe('remote workspace: writeFile', () => {
    it('writes bytes as they are', async () => {
        const { transport, workspace } = setup();
        const bytes = new Uint8Array([0, 255, 10, 13]);

        await workspace.writeFile('a.bin', bytes);
        expect(transport.calls[0]!.argv.slice(-3, -1)).toEqual(['/workspace/a.bin', '4']);
        expect(transport.calls[0]!.options.stdin).toEqual(bytes);
    });

    it('refuses oversized bytes without a call', async () => {
        const { transport, workspace } = setup();

        await expect(workspace.writeFile('big', new Uint8Array(FILE_MAX_BYTES + 1))).rejects.toBeInstanceOf(ValidationError);
        expect(transport.calls).toHaveLength(0);
    });

    it('pipes the bytes into head inside the timeout wrapper', async () => {
        const { transport, workspace } = setup();

        await workspace.writeFile('a/b.txt', 'hé');
        expect(transport.calls).toHaveLength(1);
        expect(transport.calls[0]!.argv).toEqual([
            'timeout',
            '-k',
            '5',
            '300',
            'sh',
            '-c',
            WRITE_FILE_SCRIPT,
            'sh',
            '/workspace/a/b.txt',
            '3',
            expect.stringMatching(/^[0-9a-f]{16}$/),
        ]);

        const { stdin } = transport.calls[0]!.options;

        expect(stdin).toEqual(encode('hé'));
        expect(stdin).toHaveLength(3);
        expect(transport.calls[0]!.options.cwd).toBe('/workspace');
    });

    it('writes an empty file', async () => {
        const { transport, workspace } = setup();

        await workspace.writeFile('/workspace/empty', '');
        expect(transport.calls[0]!.argv.slice(-3, -1)).toEqual(['/workspace/empty', '0']);
        expect(transport.calls[0]!.options.stdin).toHaveLength(0);
    });

    it('refuses oversized content without a call', async () => {
        const { transport, workspace } = setup();

        await expect(workspace.writeFile('big', 'a'.repeat(FILE_MAX_BYTES + 1))).rejects.toBeInstanceOf(ValidationError);
        await expect(workspace.writeFile('big', 'é'.repeat(FILE_MAX_BYTES / 2 + 1))).rejects.toBeInstanceOf(ValidationError);
        expect(transport.calls).toHaveLength(0);
    });

    it('refuses bad paths and content without a call', async () => {
        const { transport, workspace } = setup();

        for (const path of ['../x', '', '/etc/passwd', '.', '/workspace']) {
            await expect(workspace.writeFile(path, 'x')).rejects.toBeInstanceOf(ValidationError);
        }

        await expect(workspace.writeFile('a', 1 as unknown as string)).rejects.toBeInstanceOf(ValidationError);
        expect(transport.calls).toHaveLength(0);
    });

    it('throws SandboxError with stderr on a non-zero exit', async () => {
        const { workspace } = setup(() => ({ exitCode: 1, stderr: encode('sh: can\'t create /workspace/a: Read-only file system\n') }));
        const error = await workspace.writeFile('a', 'x').catch((e: unknown) => e);

        expect(error).toBeInstanceOf(SandboxError);
        expect((error as SandboxError).message).toContain('Read-only file system');
    });
});
