/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { randomUUID } from 'node:crypto';
import {
    ChamviError,
    SandboxError,
    ValidationError,
    systemClock,
} from '@chamvi/core';
import {
    DEFAULT_SANDBOX_IMAGE,
    SANDBOX_LABEL_SELECTORS,
    WORKSPACE_LABEL,
    abortedCreate,
    assertCreateInput,
    buildWorkspaceInfo,
    collectionError,
    createRemoteWorkspace,
    delay,
    prepareWorkspace,
    resolveLimits,
} from '@chamvi/sandbox';
import type { ISandboxProvider, IWorkspace } from '@chamvi/sandbox';
import { createPodClient } from '../client/module.ts';
import { createPodTransport } from '../transport/module.ts';
import {
    POD_NAME_PREFIX,
    POLL_MS,
    START_TIMEOUT_MS,
} from './constants.ts';
import {
    assertKubernetesOptions,
    buildPod,
    guard,
    isExpired,
    isLabelValue,
    loadDefaultKubeConfig,
    podState,
} from './helpers.ts';
import type { KubernetesSandboxOptions } from './types.ts';

const PROVIDER_NAME = 'k8s';

const MANAGED_SELECTOR = SANDBOX_LABEL_SELECTORS.join(',');

/**
 * One hardened pod per workspace (see `buildPod`), commands run through the
 * pod exec API inside GNU `timeout`. `create` waits for the pod to run
 * (polling its status on the clock, failing fast on image and config errors),
 * then checks out. Creating the provider contacts nothing.
 */
export function createKubernetesSandbox(options: KubernetesSandboxOptions): ISandboxProvider {
    assertKubernetesOptions(options);

    const { namespace } = options;
    const client = options.client ?? createPodClient({
        kubeConfig: options.kubeConfig ?? loadDefaultKubeConfig(),
        namespace,
    });
    const image = options.image ?? DEFAULT_SANDBOX_IMAGE;
    const imagePullPolicy = options.imagePullPolicy ?? 'IfNotPresent';
    const startTimeoutMs = options.startTimeoutMs ?? START_TIMEOUT_MS;
    const pollMs = options.pollMs ?? POLL_MS;
    const clock = options.clock ?? systemClock;
    const live = new Map<string, IWorkspace>();

    /** Resolves once the pod runs; SandboxError when it never will, takes too long or the signal fires. */
    async function waitForRunning(name: string, signal?: AbortSignal): Promise<void> {
        const started = clock.now().getTime();
        for (;;) {
            if (signal?.aborted) throw abortedCreate();
            const state = podState(await client.read(name));
            if (state.state === 'running') return;
            if (state.state === 'failed') {
                throw new SandboxError(`workspace pod ${name} cannot start: ${state.reason}`);
            }
            const remaining = started + startTimeoutMs - clock.now().getTime();
            if (remaining <= 0) {
                throw new SandboxError(`workspace pod ${name} did not start within ${startTimeoutMs} ms.`);
            }
            await delay(clock, Math.min(pollMs, remaining), signal, () => abortedCreate());
        }
    }

    return {
        name: PROVIDER_NAME,

        async create(input) {
            assertCreateInput(input, { image: true });
            if (!isLabelValue(input.runId)) {
                throw new ValidationError('runId must be a Kubernetes label value (at most 63 alphanumerics, `-`, `_` or `.`, starting and ending alphanumeric).');
            }
            if (input.signal?.aborted) {
                throw abortedCreate();
            }
            const limits = resolveLimits(options.limits, input.limits);

            const id = randomUUID();
            const name = `${POD_NAME_PREFIX}${id}`;
            const info = buildWorkspaceInfo(input, PROVIDER_NAME, clock.now(), limits.maxLifetimeMs);

            const remote = createRemoteWorkspace({
                id,
                info,
                transport: createPodTransport(client, name),
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

            try {
                live.set(id, workspace);
                await client.create(buildPod({
                    id,
                    runId: input.runId,
                    namespace,
                    image: input.image ?? image,
                    env: { ...options.env, ...input.env },
                    limits,
                    expiresAt: info.expiresAt,
                    labels: options.podLabels ?? {},
                    imagePullPolicy,
                }));
                await waitForRunning(name, input.signal);
                const { commit } = await prepareWorkspace(workspace, {
                    repo: input.repo,
                    ref: input.ref,
                    signal: input.signal,
                });
                if (commit !== undefined) info.commit = commit;
            } catch (error) {
                // deleting a pod that was never created is a 404, which is fine
                await workspace.dispose().catch(() => undefined);
                if (error instanceof ChamviError) throw error;
                throw new SandboxError(`cannot start workspace pod ${name}`, { cause: error });
            }
            return workspace;
        },

        async collectGarbage() {
            const pods = await guard('list the workspace pods', () => client.list(MANAGED_SELECTOR));
            const now = clock.now().getTime();
            let count = 0;
            // one pod that cannot go never keeps the others
            const failures: unknown[] = [];
            for (const pod of pods) {
                const name = pod.metadata?.name;
                if (!name) continue;
                const phase = pod.status?.phase;
                if (!isExpired(pod, now) && phase !== 'Failed' && phase !== 'Succeeded') continue;

                // one open here is disposed, so its in-flight commands settle too
                const workspace = live.get(pod.metadata?.labels?.[WORKSPACE_LABEL] ?? '');
                try {
                    await guard(`delete workspace pod ${name}`, () => (workspace ? workspace.dispose() : client.delete(name)));
                } catch (error) {
                    failures.push(error);
                    continue;
                }
                count++;
            }
            if (failures.length > 0) throw collectionError(count, failures);
            return count;
        },
    };
}
