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
    DEPLOYMENT_LABEL,
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
    delay,
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
 * One pod per workspace (see `buildPod`: root with a writable root and a few
 * capabilities by default, the hardened mode through `user` and
 * `readOnlyRoot`), commands run through the pod exec API inside GNU
 * `timeout`. `create` waits for the pod to run (polling its status on the
 * clock, failing fast on image and config errors), probes the image
 * (`probeImage`), then checks out. `find` lists a run's running pods by label and rebuilds
 * the info from their labels and annotations; a pod that failed, finished
 * or is being deleted is gone. Creating the provider contacts nothing.
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
    const user = options.user ?? { uid: 0, gid: 0 };
    const readOnlyRoot = options.readOnlyRoot ?? false;
    const tmpSize = options.tmpSize ?? TMP_SIZE;
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

    /** The workspace of pod `chamvi-ws-<id>`, registered as live until disposed. */
    function open(id: string, info: WorkspaceInfo, transport: IExecTransport = createPodTransport(client, `${POD_NAME_PREFIX}${id}`)): IWorkspace {
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
            writeFile: remote.writeFile,
            async dispose() {
                await remote.dispose();
                live.delete(id);
            },
        };
        live.set(id, workspace);
        return workspace;
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
            const deployment = assertDeployment(input.deployment);
            const limits = resolveLimits(options.limits, input.limits);

            const id = randomUUID();
            const name = `${POD_NAME_PREFIX}${id}`;
            const info = {
                ...buildWorkspaceInfo(input, PROVIDER_NAME, clock.now(), limits.maxLifetimeMs),
                image: input.image ?? image,
            };
            const transport = createPodTransport(client, name);
            const workspace = open(id, info, transport);

            try {
                await client.create(buildPod({
                    id,
                    deployment,
                    namespace,
                    info,
                    env: { ...options.env, ...input.env },
                    limits,
                    labels: options.podLabels ?? {},
                    // the provider's own image follows the option; any other one is pulled if not present
                    imagePullPolicy: info.image === image ? imagePullPolicy : 'IfNotPresent',
                    user,
                    readOnlyRoot,
                    ...(options.cache && { cacheClaim: options.cache.claimName }),
                    tmpSize,
                }));
                await waitForRunning(name, input.signal);
                await probeImage(transport, {
                    image: info.image, 
                    clock, 
                    signal: input.signal, 
                });
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

        async find(runId, findOptions = {}) {
            const deployment = assertDeployment(findOptions.deployment);
            // no pod can carry a run label that is no label value
            if (!isLabelValue(runId)) return [];
            const pods = await guard(
                'list the workspace pods',
                () => client.list(`${MANAGED_SELECTOR},${DEPLOYMENT_LABEL}=${deployment},${RUN_LABEL}=${runId}`),
            );
            const now = clock.now().getTime();
            const found: IWorkspace[] = [];
            for (const pod of pods) {
                const labels = pod.metadata?.labels ?? {};
                const id = labels[WORKSPACE_LABEL] ?? '';
                const held = live.get(id);
                if (held) {
                    if (!held.disposed) found.push(held);
                    continue;
                }
                if (pod.metadata?.deletionTimestamp || podState(pod).state !== 'running') continue;
                const info = readWorkspaceInfo({ ...pod.metadata?.annotations, ...labels }, PROVIDER_NAME);
                if (!info || info.runId !== runId || info.expiresAt.getTime() <= now) continue;
                const workspace = open(id, info);
                const checkout = await readCheckout(workspace, findOptions.signal);
                if (!checkout) {
                    // a create that died before its checkout finished: left to the collection
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
            const pods = await guard('list the workspace pods', () => client.list(`${MANAGED_SELECTOR},${DEPLOYMENT_LABEL}=${deployment}`));
            const now = clock.now().getTime();
            let count = 0;
            // one pod that cannot go never keeps the others
            const failures: unknown[] = [];
            const isSettled = createSettledCheck(gcOptions.isSettled);
            for (const pod of pods) {
                const name = pod.metadata?.name;
                if (!name) continue;
                const phase = pod.status?.phase;
                if (!isExpired(pod, now) && phase !== 'Failed' && phase !== 'Succeeded') {
                    const answer = await isSettled(pod.metadata?.labels?.[RUN_LABEL] ?? '');
                    if (answer instanceof SandboxError) failures.push(answer);
                    if (answer !== true) continue;
                }

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
