/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { Duplex } from 'node:stream';
import type { IClock } from '@chamvi/core';
import { createSinkStream, delay } from '@chamvi/sandbox';
import type { IExecTransport, TransportExecOptions, TransportExecResult } from '@chamvi/sandbox';
import type Dockerode from 'dockerode';
import { isStatus, removeContainer } from '../provider/helpers.ts';
import { INSPECT_POLL_INITIAL_MS, INSPECT_POLL_MAX_MS } from './constants.ts';
import { abortError, streamEnded } from './helpers.ts';

/**
 * Runs argv in a started workspace container through the Docker exec API,
 * as `user` (the container's):
 * stdout and stderr demultiplexed into the workspace's sinks, stdin written
 * and half-closed, then the exit code read from the exec
 * once it stopped (polled on the clock with backoff). The signal detaches:
 * the HTTP stream is dropped and the process runs on until its `timeout`
 * wrapper fires or the container is removed. `alive` is false for a
 * container that stopped or is missing.
 */
export function createDockerTransport(
    docker: Dockerode,
    container: Dockerode.Container,
    clock: IClock,
    user: string,
): IExecTransport {
    return {
        async exec(argv: readonly string[], options: TransportExecOptions): Promise<TransportExecResult> {
            const { signal, stdin } = options;
            if (signal.aborted) throw abortError(signal);

            const exec = await container.exec({
                Cmd: [...argv],
                AttachStdout: true,
                AttachStderr: true,
                AttachStdin: stdin !== undefined,
                Tty: false,
                User: user,
                abortSignal: signal,
            });
            const stream = await exec.start({
                hijack: true,
                stdin: stdin !== undefined,
                abortSignal: signal,
            }) as Duplex;

            // for the socket's whole life: stdin the command never read stays
            // queued and fails (EPIPE) once the daemon closes the connection
            stream.on('error', () => undefined);
            const ended = streamEnded(stream, signal);
            docker.modem.demuxStream(stream, createSinkStream(options.stdout), createSinkStream(options.stderr));
            if (stdin !== undefined) {
                // after the demux listeners, so no output is lost; end() half-closes the socket (stdin EOF)
                stream.end(stdin);
            }
            let end: 'ended' | 'closed';
            try {
                end = await ended;
            } finally {
                // drops stdin still queued instead of flushing it into a closed connection
                stream.destroy();
            }

            let wait = INSPECT_POLL_INITIAL_MS;
            let info = await exec.inspect({ abortSignal: signal });
            while (info.Running) {
                await delay(clock, wait, signal, () => abortError(signal));
                wait = Math.min(wait * 2, INSPECT_POLL_MAX_MS);
                info = await exec.inspect({ abortSignal: signal });
            }

            // a process that could not start reports no exit code
            return {
                exitCode: typeof info.ExitCode === 'number' ? info.ExitCode : 127,
                ...(end === 'closed' && { closed: true }),
            };
        },

        async alive(signal: AbortSignal): Promise<boolean> {
            try {
                const info = await container.inspect({ abortSignal: signal });
                return info.State.Running;
            } catch (error) {
                if (isStatus(error, 404)) return false;
                throw error;
            }
        },

        remove: () => removeContainer(container),
    };
}
