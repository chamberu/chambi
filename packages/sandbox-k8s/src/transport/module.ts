/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { createSinkStream } from '@chamvi/sandbox';
import type { IExecTransport, TransportExecOptions, TransportExecResult } from '@chamvi/sandbox';
import type { V1Pod } from '@kubernetes/client-node';
import { isObject } from 'smob';
import { isApiStatus } from '../client/helpers.ts';
import type { IPodClient } from '../client/types.ts';
import { podState } from '../provider/helpers.ts';

/**
 * Runs argv in a workspace pod's container through the pod client, stdout
 * and stderr into the workspace's sinks. The signal
 * closes the socket and detaches: the process runs on until its `timeout`
 * wrapper fires or the pod is deleted. `alive` is false for a pod that is
 * missing, being deleted, or failed or finished.
 */
export function createPodTransport(client: IPodClient, name: string): IExecTransport {
    return {
        async exec(argv: readonly string[], options: TransportExecOptions): Promise<TransportExecResult> {
            const { exitCode } = await client.exec(name, {
                argv,
                ...(options.stdin === undefined ? {} : { stdin: options.stdin }),
                stdout: createSinkStream(options.stdout),
                stderr: createSinkStream(options.stderr),
                signal: options.signal,
            });

            return { exitCode };
        },

        async alive(): Promise<boolean> {
            let pod: V1Pod;

            try {
                pod = await client.read(name);
            } catch (error) {
                // the client wraps the ApiException as the cause
                if (isObject(error) && isApiStatus(error.cause, 404)) {
                    return false;
                }

                throw error;
            }

            return !pod.metadata?.deletionTimestamp && podState(pod).state !== 'failed';
        },

        remove: () => client.delete(name),
    };
}
