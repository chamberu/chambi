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
    DEPLOYMENT_LABEL,
    EXPIRES_AT_KEY,
    RUN_LABEL,
    SANDBOX_LABEL_SELECTORS,
    WORKSPACE_LABEL,
    abortedCreate,
    assertCreateInput,
    assertDeployment,
    buildWorkspaceInfo,
    collectionError,
    createRemoteWorkspace,
    createSettledCheck,
    isExpiredAt,
    prepareWorkspace,
    readCheckoutCommit,
    readWorkspaceInfo,
    resolveLimits,
} from '@chamvi/sandbox';
import type { ISandboxProvider, IWorkspace, WorkspaceInfo } from '@chamvi/sandbox';
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
 * run through the Docker exec API inside GNU `timeout`. `find` lists a run's
 * containers by label, starts a stopped one again (its volume holds the
 * work) and rebuilds the info from the labels. The client connects lazily,
 * so creating the provider never contacts the daemon.
 */
export function createDockerSandbox(options: DockerSandboxOptions = {}): ISandboxProvider {
    assertDockerOptions(options);

    const docker = options.docker ?? new Docker();
    const image = options.image ?? DEFAULT_SANDBOX_IMAGE;
    const network = options.network ?? DEFAULT_NETWORK;
    const pull = options.pull ?? 'missing';
    const clock = options.clock ?? systemClock;
    const live = new Map<string, IWorkspace>();
    /** The workspaces whose dispose was called: never found again, also while or after a removal fails. */
    const disposing = new WeakSet<IWorkspace>();

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

    /** The workspace of a container, registered as live until disposed. */
    function open(id: string, info: WorkspaceInfo, container: Docker.Container): IWorkspace {
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
                disposing.add(workspace);
                await remote.dispose();
                live.delete(id);
            },
        };
        live.set(id, workspace);
        return workspace;
    }

    /** The managed containers of `deployment` (and of `runId` when given), stopped ones too. */
    async function listWorkspaceContainers(deployment: string, runId?: string): Promise<Docker.ContainerInfo[]> {
        const label = [...SANDBOX_LABEL_SELECTORS, `${DEPLOYMENT_LABEL}=${deployment}`];
        if (runId !== undefined) label.push(`${RUN_LABEL}=${runId}`);
        try {
            return await docker.listContainers({ all: true, filters: { label } });
        } catch (error) {
            throw new SandboxError(`cannot list the workspace containers: ${dockerMessage(error)}`, { cause: error });
        }
    }

    return {
        name: PROVIDER_NAME,

        async create(input) {
            assertCreateInput(input, { image: true });
            if (input.signal?.aborted) {
                throw abortedCreate();
            }
            const deployment = assertDeployment(input.deployment);
            const limits = resolveLimits(options.limits, input.limits);
            const imageName = input.image ?? image;

            const id = randomUUID();
            const info = { ...buildWorkspaceInfo(input, PROVIDER_NAME, clock.now(), limits.maxLifetimeMs), image: imageName };
            const container = await createContainer(buildContainerOptions({
                id,
                deployment,
                info,
                network,
                env: { ...options.env, ...input.env },
                limits,
            }), imageName, input.signal);

            const workspace = open(id, info, container);

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

        async find(runId, findOptions = {}) {
            const deployment = assertDeployment(findOptions.deployment);
            const containers = await listWorkspaceContainers(deployment, runId);
            const now = clock.now().getTime();
            const found: IWorkspace[] = [];
            for (const item of containers) {
                const labels = item.Labels ?? {};
                const id = labels[WORKSPACE_LABEL] ?? '';
                const held = live.get(id);
                if (held && (!held.disposed || disposing.has(held))) {
                    // a disposed one (also after a failed removal) is never found again
                    if (!held.disposed) found.push(held);
                    continue;
                }
                // gone (its container stopped): a fresh handle, restarted below
                if (held) live.delete(id);
                const info = readWorkspaceInfo(labels, PROVIDER_NAME);
                if (!info || info.runId !== runId || info.expiresAt.getTime() <= now) continue;
                const container = docker.getContainer(item.Id);
                if (item.State !== 'running') {
                    // stopped (a host or daemon restart): the volume still holds the work.
                    // A container never started is a create that crashed: left to the collection
                    if (item.State !== 'exited') continue;
                    try {
                        await container.start(findOptions.signal ? { abortSignal: findOptions.signal } : {});
                    } catch {
                        continue;
                    }
                }
                const workspace = open(id, info, container);
                const commit = info.repo === undefined ? undefined : await readCheckoutCommit(workspace, findOptions.signal);
                if (commit !== undefined) info.commit = commit;
                found.push(workspace);
            }
            return found;
        },

        async collectGarbage(gcOptions = {}) {
            const deployment = assertDeployment(gcOptions.deployment);
            const containers = await listWorkspaceContainers(deployment);

            const now = clock.now().getTime();
            let count = 0;
            // one container that cannot go never keeps the others
            const failures: SandboxError[] = [];
            const isSettled = createSettledCheck(gcOptions.isSettled);
            for (const container of containers) {
                const labels = container.Labels ?? {};
                if (!isExpiredAt(labels[EXPIRES_AT_KEY], now)) {
                    const answer = await isSettled(labels[RUN_LABEL] ?? '');
                    if (answer instanceof SandboxError) failures.push(answer);
                    if (answer !== true) continue;
                }

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
