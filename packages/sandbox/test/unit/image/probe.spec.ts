/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { describe, expect, it } from 'vitest';
import { SandboxError } from '@chamvi/core';
import { IMAGE_PROBE_TIMEOUT_MS, probeImage } from '@chamvi/sandbox';
import type { IExecTransport, TransportExecOptions } from '@chamvi/sandbox';
import { ControllableClock } from '../../utils/clock.ts';

type Answer = { exitCode: number; stdout?: string } | Error | 'hang';

function transportAnswering(answer: Answer) {
    const calls: Array<{ argv: string[]; options: TransportExecOptions }> = [];
    const transport: IExecTransport = {
        async exec(argv, options) {
            calls.push({ argv: [...argv], options });
            if (answer === 'hang') {
                return new Promise((_resolve, reject) => {
                    options.signal.addEventListener('abort', () => reject(new Error('detached')), { once: true });
                });
            }
            if (answer instanceof Error) throw answer;
            if (answer.stdout) options.stdout.write(new TextEncoder().encode(answer.stdout));
            return { exitCode: answer.exitCode };
        },
        remove: async () => undefined,
    };
    return { transport, calls };
}

describe('probeImage', () => {
    it('runs one sh script outside the timeout wrapper and resolves on exit 0', async () => {
        const { transport, calls } = transportAnswering({ exitCode: 0 });
        await expect(probeImage(transport, { image: 'img' })).resolves.toBeUndefined();
        expect(calls).toHaveLength(1);
        expect(calls[0]!.argv).toEqual(['sh', '-c', expect.stringContaining('command -v git')]);
        expect(calls[0]!.argv[2]).toContain('timeout -k');
    });

    it('names what the image lacks', async () => {
        const { transport } = transportAnswering({ exitCode: 3, stdout: 'git timeout-k\n' });
        const error = await probeImage(transport, { image: 'alpine:3' }).catch((e: unknown) => e);
        expect(error).toBeInstanceOf(SandboxError);
        expect((error as Error).message).toBe('image alpine:3 lacks what a workspace needs: git, a timeout that supports -k (GNU coreutils). ' +
            'Pick an image with sh, git and coreutils, or install them in it.');
    });

    it('names a missing timeout', async () => {
        const { transport } = transportAnswering({ exitCode: 3, stdout: 'timeout' });
        await expect(probeImage(transport, { image: 'img' })).rejects.toThrow('lacks what a workspace needs: timeout.');
    });

    it('names sh when the script cannot start', async () => {
        const { transport } = transportAnswering({ exitCode: 127 });
        await expect(probeImage(transport, { image: 'scratch-tool' })).rejects.toThrow('image scratch-tool lacks what a workspace needs: sh.');
    });

    it('reports any other exit', async () => {
        const { transport } = transportAnswering({ exitCode: 1 });
        await expect(probeImage(transport, { image: 'img' })).rejects.toThrow('cannot probe image img: the probe exited with 1.');
    });

    it('wraps a transport failure', async () => {
        const { transport } = transportAnswering(new Error('connection reset'));
        const error = await probeImage(transport, { image: 'img' }).catch((e: unknown) => e);
        expect(error).toBeInstanceOf(SandboxError);
        expect((error as Error).message).toBe('cannot probe image img: connection reset');
    });

    it('gives up after IMAGE_PROBE_TIMEOUT_MS on the clock', async () => {
        const clock = new ControllableClock();
        const { transport, calls } = transportAnswering('hang');
        const probing = probeImage(transport, { image: 'img', clock });
        await Promise.resolve();
        clock.advance(IMAGE_PROBE_TIMEOUT_MS);
        await expect(probing).rejects.toThrow(`cannot probe image img: no answer within ${IMAGE_PROBE_TIMEOUT_MS} ms.`);
        expect(calls[0]!.options.signal.aborted).toBe(true);
    });

    it('stops with the create when its signal fires', async () => {
        const clock = new ControllableClock();
        const controller = new AbortController();
        const { transport } = transportAnswering('hang');
        const probing = probeImage(transport, {
            image: 'img', 
            clock, 
            signal: controller.signal, 
        });
        await Promise.resolve();
        controller.abort();
        await expect(probing).rejects.toThrow('workspace creation aborted');
    });

    it('runs nothing for an aborted signal', async () => {
        const { transport, calls } = transportAnswering({ exitCode: 0 });
        await expect(probeImage(transport, { image: 'img', signal: AbortSignal.abort() })).rejects.toThrow('workspace creation aborted');
        expect(calls).toHaveLength(0);
    });
});
