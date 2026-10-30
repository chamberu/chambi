/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { PassThrough } from 'node:stream';
import type { V1Status } from '@kubernetes/client-node';
import { SandboxError } from '@chamvi/core';
import { isObject } from 'smob';
import { CONTAINER_NAME } from '../provider/constants.ts';
import { API_MESSAGE_MAX_LENGTH, STDIN_CLOSE_PROTOCOL } from './constants.ts';
import type {
    ExecSocket,
    IPodClient,
    PodClientParts,
    PodExecInput,
} from './types.ts';

/**
 * The API server's own message (an `ApiException` body is the raw `Status`
 * JSON), else the error's: also of an object that is no Error, such as the
 * `ws` ErrorEvent a failed exec connect rejects with.
 */
export function apiMessage(error: unknown): string {
    let message = String(error);

    if (isObject(error)) {
        if (typeof error.message === 'string') {
            ({ message } = error);
        }

        let { body } = error;

        if (typeof body === 'string') {
            try {
                body = JSON.parse(body);
            } catch {
                // not JSON: keep the error's message
            }
        }

        if (isObject(body) && typeof body.message === 'string') {
            ({ message } = body);
        }
    }

    return message.slice(0, API_MESSAGE_MAX_LENGTH);
}

/** True for an `ApiException` with this HTTP status. */
export function isApiStatus(error: unknown, code: number): boolean {
    return isObject(error) && error.code === code;
}

/**
 * The exit code of a finished exec: `Success` is 0, `NonZeroExitCode`
 * carries it in the `ExitCode` cause; anything else is a SandboxError.
 */
export function exitCodeOf(status: V1Status): number {
    if (status.status === 'Success') {
        return 0;
    }

    if (status.reason === 'NonZeroExitCode') {
        const cause = status.details?.causes?.find((item) => item.reason === 'ExitCode');
        const text = cause?.message;

        // Number('') is 0: only digits count as an exit code
        if (typeof text === 'string' && /^\d{1,3}$/.test(text)) {
            return Number(text);
        }
    }

    throw new SandboxError(`exec failed: ${status.message ?? status.reason ?? 'unknown status'}`);
}

async function call<T>(action: string, run: () => Promise<T>): Promise<T> {
    try {
        return await run();
    } catch (error) {
        throw new SandboxError(`cannot ${action}: ${apiMessage(error)}`, { cause: error });
    }
}

function execOnce(parts: PodClientParts, name: string, input: PodExecInput): Promise<{ exitCode: number }> {
    const { signal } = input;

    if (signal.aborted) {
        return Promise.reject(new SandboxError('exec aborted'));
    }

    return new Promise((resolve, reject) => {
        let settled = false;
        let socket: ExecSocket | undefined;
        let status: V1Status | undefined;

        const settle = (fn: () => void) => {
            if (settled) {
                return;
            }

            settled = true;
            signal.removeEventListener('abort', onAbort);
            fn();
        };
        function onAbort() {
            settle(() => reject(new SandboxError('exec aborted')));
            socket?.close();
        }
        signal.addEventListener('abort', onAbort, { once: true });

        // buffered until the library attaches its reader after the connect
        const stdin = input.stdin === undefined ? null : new PassThrough();

        if (stdin) {
            stdin.write(input.stdin);
        }

        parts.exec.exec(
            parts.namespace,
            name,
            CONTAINER_NAME,
            [...input.argv],
            input.stdout,
            input.stderr,
            stdin,
            false,
            (received) => {
                status = received;
                settle(() => {
                    try {
                        resolve({ exitCode: exitCodeOf(received) });
                    } catch (error) {
                        reject(error);
                    }
                });
            },
        ).then((opened) => {
            socket = opened as unknown as ExecSocket;

            if (settled) {
                // aborted while connecting, or a status already in: drop the socket
                if (status === undefined) {
                    socket.close();
                }

                return;
            }

            socket.on('close', () => settle(() => reject(new SandboxError('exec connection closed without an exit status'))));
            socket.on('error', (error) => settle(() => reject(new SandboxError(`exec connection failed: ${error.message}`, { cause: error }))));

            // ending stdin closes the whole socket on the older protocols
            if (stdin && socket.protocol === STDIN_CLOSE_PROTOCOL) {
                stdin.end();
            }
        }, (error: unknown) => {
            settle(() => reject(new SandboxError(`cannot exec in pod ${name}: ${apiMessage(error)}`, { cause: error })));
        });
    });
}

/** An `IPodClient` over the given API clients; `createPodClient` builds them from a `KubeConfig`. */
export function createPodClientFrom(parts: PodClientParts): IPodClient {
    const { core, namespace } = parts;

    return {
        create: (pod) => call(
            `create pod ${pod.metadata?.name ?? ''}`.trim(),
            () => core.createNamespacedPod({ namespace, body: pod }),
        ),
        read: (name) => call(`read pod ${name}`, () => core.readNamespacedPod({ name, namespace })),
        async delete(name) {
            try {
                await core.deleteNamespacedPod({
                    name,
                    namespace,
                    gracePeriodSeconds: 0,
                });
            } catch (error) {
                if (isApiStatus(error, 404)) {
                    return;
                }

                throw new SandboxError(`cannot delete pod ${name}: ${apiMessage(error)}`, { cause: error });
            }
        },
        list: (labelSelector) => call(
            'list the workspace pods',
            async () => (await core.listNamespacedPod({ namespace, labelSelector })).items,
        ),
        exec: (name, input) => execOnce(parts, name, input),
    };
}
