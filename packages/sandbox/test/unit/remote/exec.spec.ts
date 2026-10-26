/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { describe, expect, it } from 'vitest';
import { SandboxError, ValidationError } from '@chamvi/core';
import {
    ALIVE_PROBE_TIMEOUT_MS,
    EXEC_GRACE_MS,
    OUTPUT_MAX_BYTES,
    createRemoteWorkspace,
} from '@chamvi/sandbox';
import { EXEC_SCRIPT, EXIT_DRAIN_MS } from '../../../src/remote/constants.ts';
import { ControllableClock } from '../../utils/clock.ts';
import { createFakeTransport } from '../../utils/transport.ts';
import type { FakeExecAnswer, FakeTransportHandler } from '../../utils/transport.ts';

const START = 1_000_000;

/** Lets already-queued callbacks settle; not a sleep. */
const flush = () => new Promise<void>((resolve) => { setImmediate(resolve); });

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

/** A transport exec that never settles. */
const hang = () => new Promise<FakeExecAnswer>(() => {
    // never settles
});

describe('remote workspace: exec', () => {
    it('accepts a closed connection once the exit marker arrived', async () => {
        const { workspace } = setup(() => ({
            exitCode: 3, 
            stdout: encode('all\n'), 
            closed: true, 
        }));
        await expect(workspace.exec(['true'])).resolves.toMatchObject({ exitCode: 3, stdout: 'all\n' });
    });

    it('rejects a closed connection without the exit marker: the output may be cut', async () => {
        const { workspace } = setup(() => ({
            stdout: encode('part'), 
            marker: false, 
            closed: true, 
        }));
        await expect(workspace.exec(['true'])).rejects.toThrow(SandboxError);
        await expect(workspace.exec(['true'])).rejects.toThrow(/connection closed before the command reported its exit/);
    });

    it('wraps argv in timeout', async () => {
        const { transport, workspace } = setup();
        const result = await workspace.exec(['npm', 'test'], { timeoutMs: 1500 });
        expect(transport.calls).toHaveLength(1);
        expect(transport.calls[0]!.argv).toEqual(['timeout', '-k', '5', '1.5', 'npm', 'test']);
        expect(transport.calls[0]!.options.cwd).toBe('/workspace');
        expect(transport.calls[0]!.options.stdin).toBeUndefined();
        expect(result).toEqual({
            exitCode: 0,
            stdout: '',
            stderr: '',
            stdoutTruncated: false,
            stderrTruncated: false,
            timedOut: false,
            durationMs: 0,
        });
    });

    it('defaults to the exec timeout', async () => {
        const { transport, workspace } = setup();
        await workspace.exec(['true']);
        expect(transport.calls[0]!.argv).toEqual(['timeout', '-k', '5', '300', 'true']);
    });

    it('caps the timeout at the exec maximum', async () => {
        const { transport, workspace } = setup(undefined, 3_600_000);
        await workspace.exec(['true'], { timeoutMs: 7_200_000 });
        expect(transport.calls[0]!.argv.slice(0, 4)).toEqual(['timeout', '-k', '5', '1800']);
    });

    it('resolves cwd under the root', async () => {
        const { transport, workspace } = setup();
        await workspace.exec(['pwd'], { cwd: 'pkg' });
        await workspace.exec(['pwd'], { cwd: '/workspace/pkg/sub/' });
        await workspace.exec(['pwd'], { cwd: '/workspace' });
        expect(transport.calls.map((call) => call.options.cwd)).toEqual([
            '/workspace/pkg',
            '/workspace/pkg/sub',
            '/workspace',
        ]);

        for (const cwd of ['../x', '../..', '/etc', '', 'a\0b']) {
            await expect(workspace.exec(['pwd'], { cwd })).rejects.toBeInstanceOf(ValidationError);
        }
        expect(transport.calls).toHaveLength(3);
    });

    it('validates argv, stdin and timeoutMs before any call', async () => {
        const { transport, workspace } = setup();
        await expect(workspace.exec([])).rejects.toBeInstanceOf(ValidationError);
        await expect(workspace.exec([''])).rejects.toBeInstanceOf(ValidationError);
        await expect(workspace.exec(['echo', 'a\0b'])).rejects.toBeInstanceOf(ValidationError);
        await expect(workspace.exec(['echo', 1 as unknown as string])).rejects.toBeInstanceOf(ValidationError);
        await expect(workspace.exec(['cat'], { stdin: 1 as unknown as string })).rejects.toBeInstanceOf(ValidationError);
        await expect(workspace.exec(['true'], { timeoutMs: 0 })).rejects.toBeInstanceOf(ValidationError);
        await expect(workspace.exec(['true'], { timeoutMs: NaN })).rejects.toBeInstanceOf(ValidationError);
        expect(transport.calls).toHaveLength(0);
    });

    it('clamps to the expiry', async () => {
        const { transport, workspace } = setup(undefined, 10_000);
        await workspace.exec(['npm', 'test'], { timeoutMs: 60_000 });
        expect(transport.calls[0]!.argv).toEqual(['timeout', '-k', '5', '10', 'npm', 'test']);
    });

    it('rounds a fractional timeout up to whole milliseconds', async () => {
        const { transport, workspace } = setup();
        await workspace.exec(['true'], { timeoutMs: 1500.2 });
        expect(transport.calls[0]!.argv[3]).toBe('1.501');
    });

    it('reports a timeout', async () => {
        const slow = setup(() => {
            slow.clock.advance(1500);
            return { exitCode: 124 };
        });
        const timedOut = await slow.workspace.exec(['sleep', '30'], { timeoutMs: 1500 });
        expect(timedOut).toMatchObject({
            exitCode: 124,
            timedOut: true,
            durationMs: 1500,
        });

        const killed = setup(() => {
            killed.clock.advance(6500);
            return { exitCode: 137 };
        });
        expect(await killed.workspace.exec(['sleep', '30'], { timeoutMs: 1500 })).toMatchObject({ exitCode: 137, timedOut: true });

        const fast = setup(() => {
            fast.clock.advance(10);
            return { exitCode: 124 };
        });
        const own = await fast.workspace.exec(['sh', '-c', 'exit 124'], { timeoutMs: 1500 });
        expect(own).toMatchObject({
            exitCode: 124,
            timedOut: false,
            durationMs: 10,
        });

        const failed = setup(() => {
            failed.clock.advance(2000);
            return { exitCode: 1 };
        });
        expect(await failed.workspace.exec(['false'], { timeoutMs: 1500 })).toMatchObject({ exitCode: 1, timedOut: false });
    });

    it('reports a timeout of a timeout that signals the command only (BusyBox: exit 143)', async () => {
        const busybox = setup(() => {
            busybox.clock.advance(1500);
            return { exitCode: 143 };
        });
        expect(await busybox.workspace.exec(['sleep', '30'], { timeoutMs: 1500 })).toMatchObject({ exitCode: 143, timedOut: true });

        const own = setup(() => {
            own.clock.advance(10);
            return { exitCode: 143 };
        });
        expect(await own.workspace.exec(['sh', '-c', 'kill $$'], { timeoutMs: 1500 })).toMatchObject({ exitCode: 143, timedOut: false });
    });

    it('guards a hung transport', async () => {
        const {
            clock,
            transport,
            workspace,
        } = setup(hang);
        const pending = workspace.exec(['sleep', '30'], { timeoutMs: 1500 });
        await flush();
        expect(transport.calls).toHaveLength(1);
        const { signal } = transport.calls[0]!.options;
        expect(signal.aborted).toBe(false);

        clock.advance(1500 + EXEC_GRACE_MS - 1);
        await flush();
        expect(signal.aborted).toBe(false);

        clock.advance(1);
        const result = await pending;
        expect(result).toMatchObject({
            exitCode: 137,
            timedOut: true,
            durationMs: 1500 + EXEC_GRACE_MS,
        });
        expect(signal.aborted).toBe(true);
        expect(transport.calls).toHaveLength(1);
    });

    it('clears the guard when the exec settles', async () => {
        const {
            clock,
            transport,
            workspace,
        } = setup();
        await workspace.exec(['true'], { timeoutMs: 1500 });
        clock.advance(1500 + EXEC_GRACE_MS);
        expect(transport.calls[0]!.options.signal.aborted).toBe(false);
    });

    it('decodes and flags output', async () => {
        const { workspace } = setup(() => ({
            exitCode: 2,
            stdout: new Uint8Array(OUTPUT_MAX_BYTES + 1).fill(0x61),
            stderr: encode('boom é\n'),
        }));
        expect(await workspace.exec(['x'])).toMatchObject({
            exitCode: 2,
            stdout: 'a'.repeat(OUTPUT_MAX_BYTES),
            stderr: 'boom é\n',
            stdoutTruncated: true,
            stderrTruncated: false,
        });
    });

    it('drops a multi-byte character the cap cut', async () => {
        const bytes = new Uint8Array(OUTPUT_MAX_BYTES + 1);
        bytes.fill(0x61);
        bytes.set(encode('€'), OUTPUT_MAX_BYTES - 2);
        const { workspace } = setup(() => ({ stdout: bytes }));
        const result = await workspace.exec(['x']);
        expect(result.stdout).toBe('a'.repeat(OUTPUT_MAX_BYTES - 2));
        expect(result.stdoutTruncated).toBe(true);
    });

    it('runs argv inside the exec script with a fresh marker', async () => {
        const { transport, workspace } = setup();
        await workspace.exec(['true'], { cwd: 'pkg' });
        await workspace.exec(['true']);
        const [first, second] = transport.calls;
        expect(first!.raw).toEqual(['sh', '-c', EXEC_SCRIPT, 'sh', first!.options.marker, '/workspace/pkg', 'timeout', '-k', '5', '300', 'true']);
        expect(first!.options.marker).toMatch(/^chamvi-exit-[0-9a-f]{32}:$/);
        expect(second!.options.marker).not.toBe(first!.options.marker);
    });

    it('cuts the exit marker out of stderr, also when it is split across chunks', async () => {
        const { workspace } = setup((_argv, options) => {
            const line = encode(`err\n${options.marker}3\nlate`);
            for (const byte of line) options.stderr.write(new Uint8Array([byte]));
            return { exitCode: 3, marker: false };
        });
        expect(await workspace.exec(['x'])).toMatchObject({ exitCode: 3, stderr: 'err\nlate' });
    });

    it('keeps a marker of another exec in stderr', async () => {
        const other = 'chamvi-exit-00000000000000000000000000000000:0\n';
        const { workspace } = setup(() => ({ stderr: encode(other) }));
        expect((await workspace.exec(['x'])).stderr).toBe(other);
    });

    it('returns after the drain when a background job holds the output', async () => {
        let marker = '';
        const {
            clock,
            transport,
            workspace,
        } = setup((_argv, options) => {
            ({ marker } = options);
            options.stdout.write(encode('started\n'));
            clock.advance(100);
            options.stderr.write(encode(`${marker}0\n`));
            return hang();
        });
        const pending = workspace.exec(['sh', '-c', 'sleep 60 & echo started'], { timeoutMs: 1500 });
        await flush();
        const { options } = transport.calls[0]!;
        clock.advance(EXIT_DRAIN_MS - 1);
        options.stdout.write(encode('job output\n'));
        await flush();
        expect(options.signal.aborted).toBe(false);

        clock.advance(1);
        expect(await pending).toEqual({
            exitCode: 0,
            stdout: 'started\njob output\n',
            stderr: '',
            stdoutTruncated: false,
            stderrTruncated: false,
            timedOut: false,
            durationMs: 100,
        });
        // the transport is detached
        expect(options.signal.aborted).toBe(true);
    });

    it('reports a timeout the drain returns', async () => {
        const { clock, workspace } = setup((_argv, options) => {
            clock.advance(1500);
            options.stderr.write(encode(`${options.marker}124\n`));
            return hang();
        });
        const pending = workspace.exec(['sleep', '30'], { timeoutMs: 1500 });
        await flush();
        clock.advance(EXIT_DRAIN_MS);
        expect(await pending).toMatchObject({
            exitCode: 124,
            timedOut: true,
            durationMs: 1500,
        });
    });

    it('returns the output so far when the guard gives up', async () => {
        const { clock, workspace } = setup((_argv, options) => {
            options.stdout.write(encode('partial'));
            options.stderr.write(encode('warn'));
            return hang();
        });
        const pending = workspace.exec(['x'], { timeoutMs: 1500 });
        await flush();
        clock.advance(1500 + EXEC_GRACE_MS);
        expect(await pending).toMatchObject({
            exitCode: 137,
            timedOut: true,
            stdout: 'partial',
            stderr: 'warn',
        });
    });

    it('rejects a cwd that is no directory, like a local workspace', async () => {
        const { workspace } = setup(() => ({ cwdMissing: true }));
        const error = await workspace.exec(['pwd'], { cwd: 'nope' }).catch((e: unknown) => e);
        expect(error).toBeInstanceOf(SandboxError);
        expect((error as SandboxError).message).toBe('cwd /workspace/nope is no directory in the workspace.');
    });

    it('rejects after dispose and when expired', async () => {
        const { transport, workspace } = setup();
        await workspace.dispose();
        await workspace.dispose();
        expect(transport.removed).toBe(1);
        await expect(workspace.exec(['true'])).rejects.toBeInstanceOf(SandboxError);
        await expect(workspace.exec(['true'])).rejects.toThrow(/disposed/);
        await expect(workspace.readFile('a')).rejects.toBeInstanceOf(SandboxError);
        await expect(workspace.writeFile('a', 'x')).rejects.toBeInstanceOf(SandboxError);

        const expiring = setup(undefined, 10_000);
        expiring.clock.advance(10_000);
        await expect(expiring.workspace.exec(['true'])).rejects.toThrow(/expired/);
        await expect(expiring.workspace.exec(['true'])).rejects.toBeInstanceOf(SandboxError);
        await expect(expiring.workspace.readFile('a')).rejects.toBeInstanceOf(SandboxError);
        await expect(expiring.workspace.writeFile('a', 'x')).rejects.toBeInstanceOf(SandboxError);
        expect(expiring.transport.calls).toHaveLength(0);
    });

    it('turns a failing remove into SandboxError', async () => {
        const { transport, workspace } = setup();
        const cause = new Error('daemon down');
        transport.failNextRemove(cause);
        const error = await workspace.dispose().catch((e: unknown) => e);
        expect(error).toBeInstanceOf(SandboxError);
        expect((error as SandboxError).cause).toBe(cause);
    });

    it('tries a failed remove again on the next dispose', async () => {
        const { transport, workspace } = setup();
        transport.failNextRemove(new Error('daemon down'));
        await expect(workspace.dispose()).rejects.toBeInstanceOf(SandboxError);
        await expect(workspace.exec(['true'])).rejects.toThrow(/disposed/);

        await workspace.dispose();
        await workspace.dispose();
        expect(transport.removed).toBe(2);
        expect(transport.calls).toHaveLength(0);
    });

    it.each([
        ['resolves exit 137', () => ({ exitCode: 137 })],
        ['rejects a 404', () => { throw Object.assign(new Error('no such container'), { statusCode: 404 }); }],
    ])('settles in-flight execs on dispose (the transport then %s)', async (_name, after) => {
        const gate = Promise.withResolvers<void>();
        const { transport, workspace } = setup(async () => {
            await gate.promise;
            return after();
        });
        const pending = workspace.exec(['sleep', '30']);
        const settled = expect(pending).rejects.toThrow(/disposed/);
        await flush();
        const { signal } = transport.calls[0]!.options;

        await workspace.dispose();
        expect(signal.aborted).toBe(true);
        expect(transport.removed).toBe(1);
        gate.resolve();
        await settled;
        await expect(pending).rejects.toBeInstanceOf(SandboxError);
    });

    it('passes stdin as UTF-8 bytes', async () => {
        const { transport, workspace } = setup();
        await workspace.exec(['cat'], { stdin: 'piped ✓' });
        const { stdin } = transport.calls[0]!.options;
        expect(stdin).toBeInstanceOf(Uint8Array);
        expect(new TextDecoder().decode(stdin)).toBe('piped ✓');
        expect(stdin).toHaveLength(9);
    });

    it('turns a transport error into SandboxError', async () => {
        const cause = new Error('connection reset');
        const { workspace } = setup(() => { throw cause; });
        const error = await workspace.exec(['true']).catch((e: unknown) => e);
        expect(error).toBeInstanceOf(SandboxError);
        expect((error as SandboxError).message).toMatch(/connection reset/);
        expect((error as SandboxError).cause).toBe(cause);
    });

    it('marks itself gone when the transport finds its container gone', async () => {
        const cause = new Error('container is not running');
        const { transport, workspace } = setup(() => { throw cause; });
        transport.alive = async () => false;
        expect(workspace.disposed).toBe(false);

        const error = await workspace.exec(['true']).catch((e: unknown) => e);
        expect(error).toBeInstanceOf(SandboxError);
        expect((error as SandboxError).message).toMatch(/ws-1 is gone/);
        expect((error as SandboxError).message).toMatch(/not running/);
        expect((error as SandboxError).message).toMatch(/create_workspace/);
        expect(workspace.disposed).toBe(true);

        await expect(workspace.readFile('a.txt')).rejects.toThrow(/gone/);
        expect(transport.calls).toHaveLength(1);
        // dispose still removes what is left of it
        await workspace.dispose();
        expect(transport.removed).toBe(1);
    });

    it('stays usable when the transport finds its container alive or cannot tell', async () => {
        const cause = new Error('connection reset');
        for (const alive of [async () => true, async () => { throw new Error('daemon down'); }]) {
            const { transport, workspace } = setup(() => { throw cause; });
            transport.alive = alive;
            const error = await workspace.exec(['true']).catch((e: unknown) => e);
            expect((error as SandboxError).message).toBe('exec failed: connection reset');
            expect(workspace.disposed).toBe(false);
        }
    });

    it('stays usable when the liveness probe does not answer', async () => {
        const {
            clock,
            transport,
            workspace,
        } = setup(() => { throw new Error('connection reset'); });
        transport.alive = () => new Promise<boolean>(() => {
            // never answers
        });
        const pending = workspace.exec(['true']).catch((e: unknown) => e);
        await flush();
        clock.advance(ALIVE_PROBE_TIMEOUT_MS);
        const error = await pending;
        expect((error as SandboxError).message).toBe('exec failed: connection reset');
        expect(workspace.disposed).toBe(false);
    });

    it('is disposed after dispose', async () => {
        const { workspace } = setup();
        expect(workspace.disposed).toBe(false);
        await workspace.dispose();
        expect(workspace.disposed).toBe(true);
    });

    it('keeps a SandboxError of the transport', async () => {
        const original = new SandboxError('exec refused');
        const { workspace } = setup(() => { throw original; });
        await expect(workspace.exec(['true'])).rejects.toBe(original);
    });

    it('detaches on abort', async () => {
        const { transport, workspace } = setup(hang);
        const controller = new AbortController();
        const pending = workspace.exec(['sleep', '30'], { signal: controller.signal });
        const settled = expect(pending).rejects.toThrow(/aborted/);
        await flush();
        const { signal } = transport.calls[0]!.options;
        expect(signal.aborted).toBe(false);

        controller.abort();
        await settled;
        await expect(pending).rejects.toBeInstanceOf(SandboxError);
        expect(signal.aborted).toBe(true);
        expect(transport.calls).toHaveLength(1);
        expect(transport.removed).toBe(0);
    });

    it('refuses an already aborted signal without a call', async () => {
        const { transport, workspace } = setup();
        await expect(workspace.exec(['true'], { signal: AbortSignal.abort() })).rejects.toThrow(/aborted/);
        expect(transport.calls).toHaveLength(0);
    });
});
