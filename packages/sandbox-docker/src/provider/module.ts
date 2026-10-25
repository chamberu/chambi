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
    TMP_SIZE,
    WORKSPACE_LABEL,
    abortedCreate,
    assertCreateInput,
    assertDeployment,
    buildWorkspaceInfo,
    collectionError,
    createRemoteWorkspace,
    createSettledCheck,
    isExpiredAt,
    isRootUser,
    prepareWorkspace,
    probeImage,
    readCheckout,
    readWorkspaceInfo,
    resolveLimits,
} from '@chamvi/sandbox';
import type {
    IExecTransport,
    ISandboxProvider,
    IWorkspace,
    WorkspaceInfo,
} from '@chamvi/sandbox';
import Docker from 'dockerode';
import { createDockerTransport } from '../transport/module.ts';
import { openCache } from './cache.ts';
import {
    CACHE_OPEN_USER,
    DEFAULT_NETWORK,
    DEFAULT_USER,
} from './constants.ts';
import {
    assertDockerOptions,
    buildContainerOptions,
    defaultCacheVolume,
    dockerMessage,
    isMissingImage,
    isStatus,
    pullImage,
    removeContainer,
} from './helpers.ts';
import type { DockerSandboxOptions } from './types.ts';

const PROVIDER_NAME = 'docker';

/**
 * One container per workspace (see `buildContainerOptions`: root with a
 * writable root and a few capabilities by default, the hardened mode through
 * `user` and `readOnlyRoot`), commands run through the Docker exec API inside
 * GNU `timeout`. `create` probes the image (`probeImage`) before the
 * checkout and, for a non-root `user`, opens the cache to it (`openCache`); an image a run asked for (`imageRequested`) is pulled when
 * missing, whatever `pull` says, while the provider's and the operator's
 * follow `pull`. `find` lists a run's
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
    const user = options.user ?? DEFAULT_USER;
    const readOnlyRoot = options.readOnlyRoot ?? false;
    const cacheVolume = options.cache === false ? undefined : (options.cache?.volume ?? defaultCacheVolume(user));
    const tmpSize = options.tmpSize ?? TMP_SIZE;
    const clock = options.clock ?? systemClock;
    const live = new Map<string, IWorkspace>();
    /** The workspaces whose dispose was called: never found again, also while or after a removal fails. */
    const disposing = new WeakSet<IWorkspace>();

    /**
     * Creates the container, pulling its image first as `pull` says (as
     * `'missing'` for an image a run asked for); `signal` drops every request.
     */
    async function createContainer(
        createOptions: Docker.ContainerCreateOptions,
        imageName: string,
        requested: boolean,
        signal: AbortSignal | undefined,
    ): Promise<Docker.Container> {
        const policy = requested && imageName !== image ? 'missing' : pull;
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

        if (policy === 'always') await pullImage(docker, imageName, signal);
        try {
            return await attempt();
        } catch (error) {
            if (error instanceof SandboxError) throw error;
            if (policy !== 'missing' || !isMissingImage(error)) {
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

    /** The workspace of a container (reached through `transport`), registered as live until disposed. */
    function open(id: string, info: WorkspaceInfo, transport: IExecTransport): IWorkspace {
        const remote = createRemoteWorkspace({
            id,
            info,
            transport,
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
            readBytes: remote.readBytes,
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
                user,
                readOnlyRoot,
                cacheVolume,
                tmpSize,
                env: { ...options.env, ...input.env },
                limits,
            }), imageName, input.imageRequested === true, input.signal);

            const transport = createDockerTransport(docker, container, clock, user);
            const workspace = open(id, info, transport);

            try {
                await container.start(input.signal ? { abortSignal: input.signal } : {});
                if (input.signal?.aborted) {
                    throw abortedCreate();
                }
                await probeImage(transport, {
                    image: imageName, 
                    clock, 
                    signal: input.signal, 
                });
                if (!isRootUser(user)) {
                    // never disposed: it removes the container, which the workspace owns
                    const root = createRemoteWorkspace({
                        id,
                        info,
                        transport: createDockerTransport(docker, container, clock, CACHE_OPEN_USER),
                        clock,
                    });
                    await openCache(root, user, input.signal);
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
            /** Starts a container listed as stopped; false when it cannot run. */
            const restart = async (item: Docker.ContainerInfo, container: Docker.Container): Promise<boolean> => {
                if (item.State === 'running') return true;
                // stopped (a host or daemon restart): the volume still holds the work.
                // A container never started is a create that crashed: left to the collection
                if (item.State !== 'exited') return false;
                try {
                    await container.start(findOptions.signal ? { abortSignal: findOptions.signal } : {});
                    return true;
                } catch (error) {
                    // started meanwhile (an operator, live-restore, another replica's find)
                    return isStatus(error, 304);
                }
            };
            for (const item of containers) {
                const labels = item.Labels ?? {};
                const id = labels[WORKSPACE_LABEL] ?? '';
                const held = live.get(id);
                if (held && (!held.disposed || disposing.has(held))) {
                    // a disposed one (also after a failed removal) is never found again
                    if (disposing.has(held)) continue;
                    // not probed yet: its container may have stopped all the same,
                    // and the same container started again serves the held handle
                    if (held.info.expiresAt.getTime() > now && await restart(item, docker.getContainer(item.Id))) found.push(held);
                    continue;
                }
                // gone (its container stopped): a fresh handle, restarted below
                if (held) live.delete(id);
                const info = readWorkspaceInfo(labels, PROVIDER_NAME);
                if (!info || info.runId !== runId || info.expiresAt.getTime() <= now) continue;
                const container = docker.getContainer(item.Id);
                if (!await restart(item, container)) continue;
                const workspace = open(id, info, createDockerTransport(docker, container, clock, user));
                const checkout = await readCheckout(workspace, findOptions.signal, clock);
                if (!checkout) {
                    // a create that died before its checkout finished (restarted above
                    // only to read that): left to the collection
                    live.delete(id);
                    continue;
                }
                if (checkout.commit !== undefined) info.commit = checkout.commit;
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
