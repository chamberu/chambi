/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { randomUUID } from 'node:crypto';
import { ChamviError, SandboxError, systemClock } from '@chamvi/core';
import {
    DEFAULT_SANDBOX_IMAGE,
    EXPIRES_AT_KEY,
    SANDBOX_LABEL_SELECTORS,
    WORKSPACE_LABEL,
    abortedCreate,
    assertCreateInput,
    buildWorkspaceInfo,
    collectionError,
    createRemoteWorkspace,
    isExpiredAt,
    prepareWorkspace,
    resolveLimits,
} from '@chamvi/sandbox';
import type { ISandboxProvider, IWorkspace } from '@chamvi/sandbox';
import Docker from 'dockerode';
import { createDockerTransport } from '../transport/module.ts';
import { DEFAULT_NETWORK } from './constants.ts';
import {
    assertDockerOptions,
    buildContainerOptions,
    dockerMessage,
    isMissingImage,
    pullImage,
    removeContainer,
} from './helpers.ts';
import type { DockerSandboxOptions } from './types.ts';

const PROVIDER_NAME = 'docker';

/**
 * One hardened container per workspace (see `buildContainerOptions`), commands
 * run through the Docker exec API inside GNU `timeout`. The client connects
 * lazily, so creating the provider never contacts the daemon.
 */
export function createDockerSandbox(options: DockerSandboxOptions = {}): ISandboxProvider {
    assertDockerOptions(options);

    const docker = options.docker ?? new Docker();
    const image = options.image ?? DEFAULT_SANDBOX_IMAGE;
    const network = options.network ?? DEFAULT_NETWORK;
    const pull = options.pull ?? 'missing';
    const clock = options.clock ?? systemClock;
    const live = new Map<string, IWorkspace>();

    /** Creates the container, pulling its image first as `pull` says; `signal` drops every request. */
    async function createContainer(
        createOptions: Docker.ContainerCreateOptions,
        imageName: string,
        signal: AbortSignal | undefined,
    ): Promise<Docker.Container> {
        const attempt = async (): Promise<Docker.Container> => {
            try {
                return await docker.createContainer(signal ? { ...createOptions, abortSignal: signal } : createOptions);
            } catch (error) {
                if (!signal?.aborted) throw error;
                // the daemon may have made it before the request was dropped
                if (createOptions.name) await removeContainer(docker.getContainer(createOptions.name)).catch(() => undefined);
                throw abortedCreate(error);
            }
        };

        if (pull === 'always') await pullImage(docker, imageName, signal);
        try {
            return await attempt();
        } catch (error) {
            if (error instanceof SandboxError) throw error;
            if (pull !== 'missing' || !isMissingImage(error)) {
                throw new SandboxError(`cannot create a workspace container from ${imageName}: ${dockerMessage(error)}`, { cause: error });
            }
        }

        // the image is not present: pull it once, then try again
        await pullImage(docker, imageName, signal);
        try {
            return await attempt();
        } catch (error) {
            if (error instanceof SandboxError) throw error;
            throw new SandboxError(`cannot create a workspace container from ${imageName}: ${dockerMessage(error)}`, { cause: error });
        }
    }

    return {
        name: PROVIDER_NAME,

        async create(input) {
            assertCreateInput(input, { image: true });
            if (input.signal?.aborted) {
                throw abortedCreate();
            }
            const limits = resolveLimits(options.limits, input.limits);
            const imageName = input.image ?? image;

            const id = randomUUID();
            const info = buildWorkspaceInfo(input, PROVIDER_NAME, clock.now(), limits.maxLifetimeMs);
            const container = await createContainer(buildContainerOptions({
                id,
                runId: input.runId,
                image: imageName,
                network,
                env: { ...options.env, ...input.env },
                limits,
                expiresAt: info.expiresAt,
            }), imageName, input.signal);

            const remote = createRemoteWorkspace({
                id,
                info,
                transport: createDockerTransport(docker, container, clock),
                clock,
            });
            const workspace: IWorkspace = {
                id,
                info,
                get disposed() {
                    return remote.disposed;
                },
                exec: remote.exec,
                readFile: remote.readFile,
                writeFile: remote.writeFile,
                async dispose() {
                    await remote.dispose();
                    live.delete(id);
                },
            };
            live.set(id, workspace);

            try {
                await container.start(input.signal ? { abortSignal: input.signal } : {});
                if (input.signal?.aborted) {
                    throw abortedCreate();
                }
                const { commit } = await prepareWorkspace(workspace, {
                    repo: input.repo,
                    ref: input.ref,
                    signal: input.signal,
                });
                if (commit !== undefined) info.commit = commit;
            } catch (error) {
                await workspace.dispose().catch(() => undefined);
                if (error instanceof ChamviError) throw error;
                if (input.signal?.aborted) throw abortedCreate(error);
                throw new SandboxError(`cannot start workspace container ${id}: ${dockerMessage(error)}`, { cause: error });
            }
            return workspace;
        },

        async collectGarbage() {
            let containers: Docker.ContainerInfo[];
            try {
                containers = await docker.listContainers({
                    all: true,
                    filters: { label: [...SANDBOX_LABEL_SELECTORS] },
                });
            } catch (error) {
                throw new SandboxError(`cannot list the workspace containers: ${dockerMessage(error)}`, { cause: error });
            }

            const now = clock.now().getTime();
            let count = 0;
            // one container that cannot go never keeps the others
            const failures: SandboxError[] = [];
            for (const container of containers) {
                const labels = container.Labels ?? {};
                if (!isExpiredAt(labels[EXPIRES_AT_KEY], now)) continue;

                // one open here is disposed, so its in-flight commands settle too
                const workspace = live.get(labels[WORKSPACE_LABEL] ?? '');
                try {
                    if (workspace) {
                        await workspace.dispose();
                    } else {
                        await removeContainer(docker.getContainer(container.Id));
                    }
                } catch (error) {
                    failures.push(error instanceof SandboxError ?
                        error :
                        new SandboxError(`cannot remove workspace container ${container.Id}: ${dockerMessage(error)}`, { cause: error }));
                    continue;
                }
                count++;
            }
            if (failures.length > 0) throw collectionError(count, failures);
            return count;
        },
    };
}
