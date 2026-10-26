/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { PassThrough } from 'node:stream';
import {
    describe,
    expect,
    it,
    vi,
} from 'vitest';
import { InvalidAgentDefinitionError, SandboxError } from '@chamvi/core';
import { createDockerSandbox } from '@chamvi/sandbox-docker';

describe('docker sandbox options', () => {
    it('is named docker and connects lazily', () => {
        expect(createDockerSandbox().name).toBe('docker');
    });

    it.each([
        ['an empty image', { image: '' }],
        ['an empty network', { network: '' }],
        ['an unknown pull policy', { pull: 'sometimes' }],
        ['a bad env key', { env: { 'A-B': 'x' } }],
        ['bad limits', { limits: { pids: 0 } }],
        ['an empty user', { user: '' }],
        ['a user with NUL', { user: 'a\0' }],
        ['a readOnlyRoot that is no boolean', { readOnlyRoot: 'yes' }],
        ['cache true', { cache: true }],
        ['an empty cache volume', { cache: { volume: '' } }],
        ['a cache volume with a slash', { cache: { volume: '/var/lib/x' } }],
        ['a bad tmpSize', { tmpSize: 'big' }],
        ['a zero tmpSize', { tmpSize: '0' }],
        ['a docker client without the API', { docker: {} }],
        ['a docker client without pull or modem', {
            docker: {
                createContainer() {},
                getContainer() {},
                listContainers() {},
            },
        }],
    ])('refuses %s', (_name, options) => {
        expect(() => createDockerSandbox(options as never)).toThrow(InvalidAgentDefinitionError);
    });
});

function fakeDocker(createError: unknown) {
    return {
        createContainer: vi.fn(async () => { throw createError; }),
        getContainer: vi.fn(),
        listContainers: vi.fn(async () => []),
        pull: vi.fn(async () => { throw new Error('pull must not run'); }),
        modem: {
            demuxStream: vi.fn(),
            followProgress: vi.fn(),
        },
    };
}

type CreateCall = [{ HostConfig: { Mounts: Array<{ Source: string; Target: string }> } }];

/** The `/cache` volume of the fake's first `createContainer` call. */
function cacheMountOf(docker: ReturnType<typeof fakeDocker>): string | undefined {
    const [options] = docker.createContainer.mock.calls[0] as unknown as CreateCall;
    return options.HostConfig.Mounts.find((mount) => mount.Target === '/cache')?.Source;
}

describe('docker sandbox create without a daemon', () => {
    it('does not pull for a 404 that names no missing image', async () => {
        const docker = fakeDocker(Object.assign(new Error('not found'), {
            statusCode: 404,
            json: { message: 'network chamvi-missing not found' },
        }));
        const provider = createDockerSandbox({ docker: docker as never });

        await expect(provider.create({ runId: 'run-1' })).rejects.toThrow(SandboxError);
        expect(docker.pull).not.toHaveBeenCalled();
        expect(docker.createContainer).toHaveBeenCalledTimes(1);
    });

    it.each([
        ['the default root user', {}, 'chamvi-sandbox-cache'],
        ['root by name', { user: 'root:root' }, 'chamvi-sandbox-cache'],
        ['a non-root uid', { user: '1000:1000' }, 'chamvi-sandbox-cache-1000'],
        ['a non-root name', { user: 'node' }, 'chamvi-sandbox-cache-node'],
        ['a non-root user with an explicit volume', { user: '1000:1000', cache: { volume: 'shared' } }, 'shared'],
    ])('mounts the cache volume of %s', async (_name, options, volume) => {
        const docker = fakeDocker(new Error('stop after the create options'));
        const provider = createDockerSandbox({ docker: docker as never, ...options });

        await expect(provider.create({ runId: 'run-1' })).rejects.toThrow(SandboxError);
        expect(cacheMountOf(docker)).toBe(volume);
    });

    it('gives a non-root user name that is no volume name a hashed cache volume', async () => {
        const docker = fakeDocker(new Error('stop after the create options'));
        const provider = createDockerSandbox({ docker: docker as never, user: 'dom\\user' });

        await expect(provider.create({ runId: 'run-1' })).rejects.toThrow(SandboxError);
        expect(cacheMountOf(docker)).toMatch(/^chamvi-sandbox-cache-[0-9a-f]{16}$/);
    });

    it('creates no container for an already aborted signal', async () => {
        const docker = fakeDocker(new Error('create must not run'));
        const provider = createDockerSandbox({ docker: docker as never, pull: 'always' });

        await expect(provider.create({ runId: 'run-1', signal: AbortSignal.abort() }))
            .rejects.toThrow('workspace creation aborted');
        expect(docker.pull).not.toHaveBeenCalled();
        expect(docker.createContainer).not.toHaveBeenCalled();
    });
});

/** Rejects like dockerode once `signal` aborts; never settles before. */
function untilAborted(signal: AbortSignal | undefined): Promise<never> {
    return new Promise<never>((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(Object.assign(new Error('The operation was aborted'), { name: 'AbortError' })), { once: true });
    });
}

describe('docker sandbox create aborted in flight', () => {
    it('stops an image pull', async () => {
        const stream = new PassThrough();
        const docker = {
            createContainer: vi.fn(async () => { throw new Error('create must not run'); }),
            getContainer: vi.fn(),
            listContainers: vi.fn(async () => []),
            pull: vi.fn<(image: string, options: { abortSignal?: AbortSignal }) => Promise<PassThrough>>(async () => stream),
            modem: {
                demuxStream: vi.fn(),
                // like docker-modem: done once the progress stream ends
                followProgress: vi.fn((progress: PassThrough, done: (error: Error | null, output: unknown[]) => void) => {
                    progress.on('end', () => done(null, []));
                }),
            },
        };
        const controller = new AbortController();
        const provider = createDockerSandbox({ docker: docker as never, pull: 'always' });

        const creating = provider.create({ runId: 'run-1', signal: controller.signal });
        await vi.waitFor(() => expect(docker.modem.followProgress).toHaveBeenCalled());
        controller.abort();
        await expect(creating).rejects.toThrow('workspace creation aborted');
        expect(docker.pull.mock.calls[0]![1].abortSignal).toBeInstanceOf(AbortSignal);
        expect(stream.destroyed).toBe(true);
        expect(docker.createContainer).not.toHaveBeenCalled();
    });

    it('stops a container start and removes the container', async () => {
        const remove = vi.fn(async () => undefined);
        const container = {
            id: 'c1',
            start: vi.fn((options?: { abortSignal?: AbortSignal }) => untilAborted(options?.abortSignal)),
            remove,
        };
        const docker = {
            createContainer: vi.fn<(options: { abortSignal?: AbortSignal }) => Promise<typeof container>>(async () => container),
            getContainer: vi.fn(() => container),
            listContainers: vi.fn(async () => []),
            pull: vi.fn(),
            modem: { demuxStream: vi.fn(), followProgress: vi.fn() },
        };
        const controller = new AbortController();
        const provider = createDockerSandbox({ docker: docker as never, pull: 'never' });

        const creating = provider.create({ runId: 'run-1', signal: controller.signal });
        await vi.waitFor(() => expect(container.start).toHaveBeenCalled());
        controller.abort();
        await expect(creating).rejects.toThrow('workspace creation aborted');
        expect(docker.createContainer.mock.calls[0]![0].abortSignal).toBeInstanceOf(AbortSignal);
        expect(remove).toHaveBeenCalled();
    });

    it('removes a container whose create request was aborted', async () => {
        const remove = vi.fn(async () => undefined);
        const docker = {
            createContainer: vi.fn((options: { abortSignal?: AbortSignal }) => untilAborted(options.abortSignal)),
            getContainer: vi.fn(() => ({ remove })),
            listContainers: vi.fn(async () => []),
            pull: vi.fn(),
            modem: { demuxStream: vi.fn(), followProgress: vi.fn() },
        };
        const controller = new AbortController();
        const provider = createDockerSandbox({ docker: docker as never, pull: 'never' });

        const creating = provider.create({ runId: 'run-1', signal: controller.signal });
        await vi.waitFor(() => expect(docker.createContainer).toHaveBeenCalled());
        controller.abort();
        await expect(creating).rejects.toThrow('workspace creation aborted');
        // the daemon may have made it before the request was dropped
        expect(docker.getContainer).toHaveBeenCalledWith(expect.stringMatching(/^chamvi-ws-/));
        expect(remove).toHaveBeenCalledWith({ force: true, v: true });
    });
});
