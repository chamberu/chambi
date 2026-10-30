/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { EventEmitter } from 'node:events';
import type { Readable } from 'node:stream';
import { Writable } from 'node:stream';
import { ApiException, KubeConfig } from '@kubernetes/client-node';
import type { V1Pod, V1Status } from '@kubernetes/client-node';
import { describe, expect, it } from 'vitest';
import { SandboxError } from '@chamvi/core';
import { createPodClient } from '@chamvi/sandbox-k8s';
import { createPodClientFrom } from '../../../src/client/helpers.ts';
import { flush } from '../../utils/drive.ts';

class FakeSocket extends EventEmitter {
    closed = 0;

    constructor(public protocol: string) {
        super();
    }

    close() {
        this.closed++;
        this.emit('close');
    }
}

type ExecCall = {
    namespace: string;
    pod: string;
    container: string;
    command: string[];
    stdin: Readable | null;
    tty: boolean;
};

type ExecScript = (io: {
    stdout: Writable;
    stderr: Writable;
    status: (status: V1Status) => void;
    socket: FakeSocket;
}) => void;

function setup(script: ExecScript = ({ status }) => status({ status: 'Success' }), protocol = 'v5.channel.k8s.io') {
    const calls: Record<string, unknown[]> = {
        create: [],
        read: [],
        delete: [],
        list: [],
    };
    const execs: ExecCall[] = [];
    const sockets: FakeSocket[] = [];
    let deleteError: unknown;
    let connectError: unknown;

    const core = {
        async createNamespacedPod(param: unknown) {
            calls.create!.push(param);

            return { metadata: { name: 'p' } } as V1Pod;
        },
        async readNamespacedPod(param: unknown) {
            calls.read!.push(param);

            return { metadata: { name: 'p' }, status: { phase: 'Running' } } as V1Pod;
        },
        async deleteNamespacedPod(param: unknown) {
            calls.delete!.push(param);

            if (deleteError) {
                throw deleteError;
            }

            return {} as V1Pod;
        },
        async listNamespacedPod(param: unknown) {
            calls.list!.push(param);

            return { items: [{ metadata: { name: 'a' } }, { metadata: { name: 'b' } }] };
        },
    };
    const exec = {
        async exec(
            namespace: string,
            pod: string,
            container: string,
            command: string | string[],
            stdout: Writable | null,
            stderr: Writable | null,
            stdin: Readable | null,
            tty: boolean,
            statusCallback?: (status: V1Status) => void,
        ) {
            execs.push({
                namespace,
                pod,
                container,
                command: [command].flat(),
                stdin,
                tty,
            });

            if (connectError) {
                throw connectError;
            }

            const socket = new FakeSocket(protocol);

            sockets.push(socket);
            setImmediate(() => script({
                stdout: stdout!,
                stderr: stderr!,
                status: (status) => {
                    statusCallback?.(status);
                    socket.close();
                },
                socket,
            }));

            return socket;
        },
    };

    const client = createPodClientFrom({
        core: core as never,
        exec: exec as never,
        namespace: 'agents',
    });

    return {
        calls,
        client,
        execs,
        sockets,
        failDelete(error: unknown) {
            deleteError = error;
        },
        failConnect(error: unknown) {
            connectError = error;
        },
    };
}

function sink() {
    const chunks: Buffer[] = [];
    const writable = new Writable({
        write(chunk: Buffer, _encoding, callback) {
            chunks.push(Buffer.from(chunk));
            callback();
        },
    });

    return { writable, text: () => Buffer.concat(chunks).toString('utf8') };
}

function execInput(stdin?: string, signal: AbortSignal = new AbortController().signal) {
    const stdout = sink();
    const stderr = sink();

    return {
        stdout,
        stderr,
        input: {
            argv: ['echo', 'hi'],
            stdout: stdout.writable,
            stderr: stderr.writable,
            signal,
            ...(stdin === undefined ? {} : { stdin: new TextEncoder().encode(stdin) }),
        },
    };
}

describe('pod client: api calls', () => {
    it('creates, reads and lists in the namespace', async () => {
        const { calls, client } = setup();
        const body: V1Pod = { metadata: { name: 'p' } };

        await expect(client.create(body)).resolves.toEqual({ metadata: { name: 'p' } });
        expect(calls.create).toEqual([{ namespace: 'agents', body }]);

        await expect(client.read('p')).resolves.toMatchObject({ status: { phase: 'Running' } });
        expect(calls.read).toEqual([{ name: 'p', namespace: 'agents' }]);

        const pods = await client.list('a=b');

        expect(pods.map((pod) => pod.metadata?.name)).toEqual(['a', 'b']);
        expect(calls.list).toEqual([{ namespace: 'agents', labelSelector: 'a=b' }]);
    });

    it('deletes without a grace period and ignores a missing pod', async () => {
        const {
            calls,
            client,
            failDelete,
        } = setup();

        await client.delete('p');
        expect(calls.delete).toEqual([{
            name: 'p',
            namespace: 'agents',
            gracePeriodSeconds: 0,
        }]);

        failDelete(new ApiException(404, 'not found', '{"message":"pods \\"p\\" not found"}', {}));
        await expect(client.delete('p')).resolves.toBeUndefined();
    });

    it('turns other api errors into SandboxError', async () => {
        const { client, failDelete } = setup();
        const error = new ApiException(500, 'boom', '{"kind":"Status","message":"etcd unavailable"}', {});

        failDelete(error);

        const thrown = await client.delete('p').catch((e: unknown) => e);

        expect(thrown).toBeInstanceOf(SandboxError);
        expect((thrown as SandboxError).message).toContain('etcd unavailable');
        expect((thrown as SandboxError).cause).toBe(error);
    });
});

describe('pod client: exec', () => {
    it('runs argv in the sandbox container and maps success to 0', async () => {
        const { client, execs } = setup(({
            stdout,
            stderr,
            status,
        }) => {
            stdout.write(Buffer.from('out'));
            stderr.write(Buffer.from('err'));
            status({ status: 'Success' });
        });
        const {
            input,
            stdout,
            stderr,
        } = execInput();

        await expect(client.exec('p', input)).resolves.toEqual({ exitCode: 0 });
        expect(stdout.text()).toBe('out');
        expect(stderr.text()).toBe('err');
        expect(execs).toHaveLength(1);
        expect(execs[0]).toMatchObject({
            namespace: 'agents',
            pod: 'p',
            container: 'sandbox',
            command: ['echo', 'hi'],
            stdin: null,
            tty: false,
        });
    });

    it('maps a non-zero exit code', async () => {
        const { client } = setup(({ status }) => status({
            status: 'Failure',
            reason: 'NonZeroExitCode',
            message: 'command terminated with non-zero exit code',
            details: { causes: [{ reason: 'ExitCode', message: '3' }] },
        }));

        await expect(client.exec('p', execInput().input)).resolves.toEqual({ exitCode: 3 });
    });

    it.each([
        ['an empty', [{ reason: 'ExitCode', message: '' }]],
        ['a missing', [{ reason: 'ExitCode' }]],
        ['a non-numeric', [{ reason: 'ExitCode', message: '1e2' }]],
        ['no', []],
    ])('turns a non-zero exit with %s exit code into SandboxError', async (_name, causes) => {
        const { client } = setup(({ status }) => status({
            status: 'Failure',
            reason: 'NonZeroExitCode',
            message: 'command terminated with non-zero exit code',
            details: { causes },
        }));

        await expect(client.exec('p', execInput().input)).rejects.toBeInstanceOf(SandboxError);
    });

    it('turns any other failure into SandboxError', async () => {
        const { client } = setup(({ status }) => status({ status: 'Failure', message: 'container not found' }));
        const error = await client.exec('p', execInput().input).catch((e: unknown) => e);

        expect(error).toBeInstanceOf(SandboxError);
        expect((error as Error).message).toContain('container not found');
    });

    it('fails a socket closed without a status', async () => {
        const { client } = setup(({ socket }) => socket.close());

        await expect(client.exec('p', execInput().input)).rejects.toBeInstanceOf(SandboxError);
    });

    it('fails a socket error', async () => {
        const { client } = setup(({ socket }) => socket.emit('error', new Error('reset')));

        await expect(client.exec('p', execInput().input)).rejects.toThrow(/reset/);
    });

    it('fails a connection that cannot open', async () => {
        const { client, failConnect } = setup();

        failConnect(new Error('Unexpected server response: 403'));

        const error = await client.exec('p', execInput().input).catch((e: unknown) => e);

        expect(error).toBeInstanceOf(SandboxError);
        expect((error as Error).message).toContain('403');
    });

    it('names the reason of a connection rejected with an event that is no Error', async () => {
        // @kubernetes/client-node rejects with the `ws` ErrorEvent, which is no Error
        const event = Object.create({ type: 'error' }, {
            message: { value: 'Unexpected server response: 403', enumerable: true },
            error: { value: new Error('Unexpected server response: 403') },
        });
        const { client, failConnect } = setup();

        failConnect(event);

        const error = await client.exec('p', execInput().input).catch((e: unknown) => e);

        expect(error).toBeInstanceOf(SandboxError);
        expect((error as Error).message).toBe('cannot exec in pod p: Unexpected server response: 403');
    });

    it('ends stdin on a v5 socket', async () => {
        const { client, execs } = setup(() => {
            // never answers
        });

        client.exec('p', execInput('hé').input).catch(() => undefined);
        await flush();

        const stdin = execs[0]!.stdin!;
        const chunks: Buffer[] = [];
        let ended = false;

        stdin.on('data', (chunk: Buffer) => {
            chunks.push(chunk);
        });
        stdin.on('end', () => {
            ended = true;
        });
        await flush();

        expect(Buffer.concat(chunks).toString('utf8')).toBe('hé');
        expect(ended).toBe(true);
    });

    it('leaves stdin open on a v4 socket', async () => {
        const { client, execs } = setup(() => {
            // never answers
        }, 'v4.channel.k8s.io');

        client.exec('p', execInput('hé').input).catch(() => undefined);
        await flush();

        const stdin = execs[0]!.stdin!;
        const chunks: Buffer[] = [];
        let ended = false;

        stdin.on('data', (chunk: Buffer) => {
            chunks.push(chunk);
        });
        stdin.on('end', () => {
            ended = true;
        });
        await flush();

        expect(Buffer.concat(chunks).toString('utf8')).toBe('hé');
        expect(ended).toBe(false);
    });

    it('closes the socket on abort', async () => {
        const { client, sockets } = setup(() => {
            // never answers
        });
        const controller = new AbortController();
        const running = client.exec('p', execInput(undefined, controller.signal).input);

        await flush();

        controller.abort();
        await expect(running).rejects.toBeInstanceOf(SandboxError);
        expect(sockets[0]!.closed).toBe(1);
    });

    it('does not connect for an aborted signal', async () => {
        const { client, execs } = setup();

        await expect(client.exec('p', execInput(undefined, AbortSignal.abort()).input)).rejects.toThrow(/aborted/);
        expect(execs).toHaveLength(0);
    });
});

describe('createPodClient', () => {
    it('builds the api clients from the kube config', async () => {
        const kubeConfig = new KubeConfig();

        kubeConfig.loadFromOptions({
            clusters: [{
                name: 'c',
                // an unparsable URL: the request fails before any socket opens
                server: 'https://[invalid',
                skipTLSVerify: true,
            }],
            users: [{ name: 'u', token: 't' }],
            contexts: [{
                name: 'x',
                cluster: 'c',
                user: 'u',
            }],
            currentContext: 'x',
        });

        const client = createPodClient({ kubeConfig, namespace: 'agents' });

        expect(Object.keys(client).sort()).toEqual(['create', 'delete', 'exec', 'list', 'read']);
        await expect(client.read('p')).rejects.toBeInstanceOf(SandboxError);
    });
});
