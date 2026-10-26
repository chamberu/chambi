/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { InvalidAgentDefinitionError, SandboxError } from '@chamvi/core';
import {
    CACHE_DIR,
    CACHE_ENV,
    ROOT_CAPABILITIES,
    SANDBOX_ENV,
    WORKSPACE_HOME,
    WORKSPACE_ROOT,
    abortedCreate,
    assertClockOption,
    assertImageOption,
    assertSandboxEnv,
    assertTmpSizeOption,
    isRootUser,
    parseCpu,
    parseMemory,
    resolveLimits,
    workspaceLabels,
    workspaceMetadata,
} from '@chamvi/sandbox';
import type Dockerode from 'dockerode';
import { isObject } from 'smob';
import { CONTAINER_NAME_PREFIX } from './constants.ts';
import type { ContainerOptionsInput, DockerSandboxOptions } from './types.ts';

const PULL_POLICIES = ['missing', 'always', 'never'];

/** A Docker volume name. */
const VOLUME_NAME = /^[A-Za-z0-9][A-Za-z0-9_.-]+$/;

function isName(value: unknown): boolean {
    return typeof value === 'string' && value.length > 0 && !value.includes('\0');
}

/** Checks the provider options; InvalidAgentDefinitionError for a misconfiguration. */
export function assertDockerOptions(options: DockerSandboxOptions): void {
    if (!isObject(options)) {
        throw new InvalidAgentDefinitionError('createDockerSandbox() options must be an object.');
    }
    const { docker, clock } = options;
    if (
        docker !== undefined &&
        (!isObject(docker) ||
            typeof docker.createContainer !== 'function' ||
            typeof docker.getContainer !== 'function' ||
            typeof docker.listContainers !== 'function' ||
            typeof docker.pull !== 'function' ||
            !isObject(docker.modem) ||
            typeof docker.modem.demuxStream !== 'function' ||
            typeof docker.modem.followProgress !== 'function')
    ) {
        throw new InvalidAgentDefinitionError('docker must be a dockerode client.');
    }
    assertImageOption(options.image);
    if (options.network !== undefined && !isName(options.network)) {
        throw new InvalidAgentDefinitionError('network must be a non-empty string.');
    }
    if (options.pull !== undefined && !PULL_POLICIES.includes(options.pull)) {
        throw new InvalidAgentDefinitionError(`pull must be one of ${PULL_POLICIES.join(', ')}, got ${JSON.stringify(options.pull)}.`);
    }
    if (options.user !== undefined && !isName(options.user)) {
        throw new InvalidAgentDefinitionError('user must be a non-empty string like "0:0" or "1000:1000".');
    }
    if (options.readOnlyRoot !== undefined && typeof options.readOnlyRoot !== 'boolean') {
        throw new InvalidAgentDefinitionError('readOnlyRoot must be a boolean.');
    }
    const { cache } = options;
    if (
        cache !== undefined &&
        (!isObject(cache) || typeof cache.volume !== 'string' || !VOLUME_NAME.test(cache.volume))
    ) {
        throw new InvalidAgentDefinitionError(
            'cache must be { volume } naming a Docker volume (letters, digits, _ . -); ' +
            'without it every workspace gets an anonymous /cache.',
        );
    }
    assertTmpSizeOption(options.tmpSize);
    assertClockOption(clock);
    assertSandboxEnv(options.env);
    resolveLimits(options.limits);
}

/** True when a create failed because the image is not present (a 404 also answers a missing network). */
export function isMissingImage(error: unknown): boolean {
    return isStatus(error, 404) && /no such image/i.test(dockerMessage(error));
}

/** True when a dockerode error carries this HTTP status. */
export function isStatus(error: unknown, status: number): boolean {
    return isObject(error) && error.statusCode === status;
}

/** The daemon's own message when it sent one, else the error's. */
export function dockerMessage(error: unknown): string {
    if (isObject(error)) {
        const { json } = error;
        if (isObject(json) && typeof json.message === 'string') return json.message;
        if (typeof error.message === 'string') return error.message;
    }
    return String(error);
}

/** Removes a container and its anonymous volumes; a missing one, or one already being removed, is fine. */
export async function removeContainer(container: Dockerode.Container): Promise<void> {
    try {
        await container.remove({ force: true, v: true });
    } catch (error) {
        if (isStatus(error, 404) || (isStatus(error, 409) && /already in progress/i.test(dockerMessage(error)))) {
            return;
        }
        throw error;
    }
}

/**
 * Pulls an image to the end of its progress stream; SandboxError naming the
 * image on any failure. `signal` drops the request and the progress stream
 * (the daemon may finish the pull on its own).
 */
export async function pullImage(docker: Dockerode, image: string, signal?: AbortSignal): Promise<void> {
    try {
        const stream = await docker.pull(image, signal ? { abortSignal: signal } : {}) as NodeJS.ReadableStream & { destroy?(): void };
        await new Promise<void>((resolve, reject) => {
            const onAbort = () => {
                stream.destroy?.();
                reject(abortedCreate());
            };
            if (signal?.aborted) {
                onAbort();
                return;
            }
            signal?.addEventListener('abort', onAbort, { once: true });
            docker.modem.followProgress(stream, (error: Error | null, output: Array<{ error?: unknown }>) => {
                signal?.removeEventListener('abort', onAbort);
                const failed = (output ?? []).find((event) => typeof event?.error === 'string');
                if (error) {
                    reject(error);
                } else if (failed) {
                    reject(new Error(String(failed.error)));
                } else {
                    resolve();
                }
            });
        });
    } catch (error) {
        if (signal?.aborted) throw abortedCreate(error);
        throw new SandboxError(`cannot pull the image ${image}: ${dockerMessage(error)}`, { cause: error });
    }
}

/**
 * The create options of one workspace container: the user (root by default,
 * then with only the `ROOT_CAPABILITIES`, else none), a writable root unless
 * `readOnlyRoot`, no-new-privileges, docker-init as pid 1 (it reaps the
 * orphans of any image), pid/memory/cpu limits, a `/tmp` tmpfs,
 * anonymous `/workspace` and `WORKSPACE_HOME` volumes, the cache at `/cache` (the shared named
 * volume, or an anonymous one) and only `SANDBOX_ENV`, `CACHE_ENV` and the
 * configured `env` (never the host's). No host mount, no privileged mode. It sleeps forever: its lifetime follows the
 * run, and only the garbage collection (expiry, settled run) removes it.
 * Its labels hold everything `find` rebuilds the info from.
 */
export function buildContainerOptions(input: ContainerOptionsInput): Dockerode.ContainerCreateOptions {
    // Docker takes whole bytes; a quantity like '1.1Gi' is fractional
    const memory = Math.round(parseMemory(input.limits.memory));
    const env = {
        ...SANDBOX_ENV, 
        ...CACHE_ENV, 
        ...input.env, 
    };

    return {
        name: `${CONTAINER_NAME_PREFIX}${input.id}`,
        Image: input.info.image,
        Cmd: ['sleep', 'infinity'],
        User: input.user,
        WorkingDir: WORKSPACE_ROOT,
        Env: Object.entries(env).map(([key, value]) => `${key}=${value}`),
        Labels: {
            ...workspaceLabels({
                id: input.id,
                runId: input.info.runId,
                deployment: input.deployment,
                repo: input.info.repo,
            }),
            ...workspaceMetadata(input.info),
        },
        HostConfig: {
            NetworkMode: input.network,
            ReadonlyRootfs: input.readOnlyRoot,
            CapDrop: ['ALL'],
            ...(isRootUser(input.user) && { CapAdd: [...ROOT_CAPABILITIES] }),
            SecurityOpt: ['no-new-privileges:true'],
            Privileged: false,
            // docker-init (Docker's tini) as pid 1 above the image's entrypoint:
            // an image without an init would make `sleep` pid 1, which reaps no
            // orphan, and the zombies would fill `PidsLimit`
            Init: true,
            PidsLimit: input.limits.pids,
            Memory: memory,
            // equal to Memory: no swap on top
            MemorySwap: memory,
            NanoCpus: Math.round(parseCpu(input.limits.cpu) * 1e9),
            // Docker mounts a tmpfs noexec unless told: npm's global bins and corepack live in /tmp
            Tmpfs: { '/tmp': `rw,exec,nosuid,nodev,size=${Math.round(parseMemory(input.tmpSize))}` },
            // anonymous volume, removed with the container (`remove({ v: true })`)
            Mounts: [{
                Type: 'volume',
                Source: '',
                Target: WORKSPACE_ROOT,
            }, {
                // HOME on disk (never the memory-backed /tmp), anonymous like /workspace
                Type: 'volume',
                Source: '',
                Target: WORKSPACE_HOME,
            }, {
                // a named volume outlives the container; an anonymous one goes with it
                Type: 'volume',
                Source: input.cacheVolume ?? '',
                Target: CACHE_DIR,
            }],
            AutoRemove: false,
        },
    };
}
