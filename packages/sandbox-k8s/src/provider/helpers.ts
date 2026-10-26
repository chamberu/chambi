/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { KubeConfig } from '@kubernetes/client-node';
import type { V1Pod, V1Volume } from '@kubernetes/client-node';
import { ChamviError, InvalidAgentDefinitionError, SandboxError } from '@chamvi/core';
import {
    CACHE_DIR,
    CACHE_ENV,
    DEPLOYMENT_LABEL,
    EXPIRES_AT_KEY,
    REPO_KEY_LABEL,
    ROOT_CAPABILITIES,
    RUN_LABEL,
    SANDBOX_ENV,
    SANDBOX_LABELS,
    SLEEP_UNTIL_SCRIPT,
    WORKSPACE_HOME,
    WORKSPACE_LABEL,
    WORKSPACE_ROOT,
    assertClockOption,
    assertImageOption,
    assertSandboxEnv,
    assertTmpSizeOption,
    isExpiredAt,
    lifetimeSeconds,
    resolveLimits,
    workspaceLabels,
    workspaceMetadata,
} from '@chamvi/sandbox';
import { isObject } from 'smob';
import {
    CONTAINER_NAME,
    FATAL_WAITING_REASONS,
    POD_NAME_PREFIX,
} from './constants.ts';
import type { KubernetesSandboxOptions, PodInput } from './types.ts';

const PULL_POLICIES = ['Always', 'IfNotPresent'];

const MANAGED_LABELS = [...Object.keys(SANDBOX_LABELS), RUN_LABEL, WORKSPACE_LABEL, DEPLOYMENT_LABEL, REPO_KEY_LABEL];

const CLIENT_METHODS = ['create', 'read', 'delete', 'list', 'exec'];

/** A DNS-1123 label (namespaces), at most 63 characters. */
const DNS_LABEL = /^[a-z0-9]([-a-z0-9]{0,61}[a-z0-9])?$/;

/** A DNS-1123 subdomain (label key prefixes), at most 253 characters. */
const DNS_SUBDOMAIN = /^[a-z0-9]([-a-z0-9]*[a-z0-9])?(\.[a-z0-9]([-a-z0-9]*[a-z0-9])?)*$/;

/** A label name or value: alphanumeric ends, `-`, `_` and `.` inside, at most 63 characters. */
const LABEL_NAME = /^[A-Za-z0-9]([-A-Za-z0-9_.]{0,61}[A-Za-z0-9])?$/;

/** True for a Kubernetes label key: `[prefix/]name`. */
function isLabelKey(key: string): boolean {
    const slash = key.lastIndexOf('/');
    if (slash === -1) return LABEL_NAME.test(key);
    const prefix = key.slice(0, slash);
    return prefix.length <= 253 &&
        DNS_SUBDOMAIN.test(prefix) &&
        LABEL_NAME.test(key.slice(slash + 1));
}

/** True for a Kubernetes label value: empty or a label name. */
export function isLabelValue(value: unknown): boolean {
    return typeof value === 'string' && (value === '' || LABEL_NAME.test(value));
}

/** A uid or gid: an integer of at least 0. */
function isId(value: unknown): boolean {
    return Number.isSafeInteger(value) && (value as number) >= 0;
}

function assertPositiveInteger(name: string, value: unknown): void {
    if (value !== undefined && (!Number.isSafeInteger(value) || (value as number) < 1)) {
        throw new InvalidAgentDefinitionError(`${name} must be a positive integer, got ${JSON.stringify(value)}.`);
    }
}

/** Checks the provider options; InvalidAgentDefinitionError for a misconfiguration. */
export function assertKubernetesOptions(options: KubernetesSandboxOptions): void {
    if (!isObject(options)) {
        throw new InvalidAgentDefinitionError('createKubernetesSandbox() options must be an object.');
    }
    if (typeof options.namespace !== 'string' || !DNS_LABEL.test(options.namespace)) {
        throw new InvalidAgentDefinitionError(`namespace must be a DNS-1123 label, got ${JSON.stringify(options.namespace)}.`);
    }
    const {
        client,
        clock,
        podLabels,
    } = options;
    if (client !== undefined && (!isObject(client) || CLIENT_METHODS.some((method) => typeof client[method as keyof typeof client] !== 'function'))) {
        throw new InvalidAgentDefinitionError('client must be an IPodClient.');
    }
    if (options.kubeConfig !== undefined && !isObject(options.kubeConfig)) {
        throw new InvalidAgentDefinitionError('kubeConfig must be a KubeConfig.');
    }
    assertImageOption(options.image);
    if (options.imagePullPolicy !== undefined && !PULL_POLICIES.includes(options.imagePullPolicy)) {
        throw new InvalidAgentDefinitionError(`imagePullPolicy must be one of ${PULL_POLICIES.join(', ')}, got ${JSON.stringify(options.imagePullPolicy)}.`);
    }
    if (podLabels !== undefined) {
        if (!isObject(podLabels)) {
            throw new InvalidAgentDefinitionError('podLabels must be an object of strings.');
        }
        for (const [key, value] of Object.entries(podLabels)) {
            if (MANAGED_LABELS.includes(key)) {
                throw new InvalidAgentDefinitionError(`podLabels may not set the managed label ${key}.`);
            }
            if (!isLabelKey(key)) {
                throw new InvalidAgentDefinitionError(`podLabels key ${JSON.stringify(key)} is no valid label key.`);
            }
            if (!isLabelValue(value)) {
                throw new InvalidAgentDefinitionError(`podLabels ${key} must be a label value (at most 63 characters, alphanumeric ends, - _ . inside).`);
            }
        }
    }
    const { user, cache } = options;
    if (user !== undefined && (!isObject(user) || !isId(user.uid) || !isId(user.gid))) {
        throw new InvalidAgentDefinitionError('user must be { uid, gid } with integers of at least 0.');
    }
    if (options.readOnlyRoot !== undefined && typeof options.readOnlyRoot !== 'boolean') {
        throw new InvalidAgentDefinitionError('readOnlyRoot must be a boolean.');
    }
    if (cache !== undefined && (!isObject(cache) || typeof cache.claimName !== 'string' || !DNS_SUBDOMAIN.test(cache.claimName) || cache.claimName.length > 253)) {
        throw new InvalidAgentDefinitionError('cache must be { claimName } naming a PersistentVolumeClaim (a DNS-1123 subdomain).');
    }
    assertTmpSizeOption(options.tmpSize);
    assertPositiveInteger('startTimeoutMs', options.startTimeoutMs);
    assertPositiveInteger('pollMs', options.pollMs);
    assertClockOption(clock);
    assertSandboxEnv(options.env);
    resolveLimits(options.limits);
}

/**
 * The pod of one workspace: the user (root by default, then with only the
 * `ROOT_CAPABILITIES`; a non-root user gets none, `runAsNonRoot` and its
 * `fsGroup`), a RuntimeDefault seccomp profile, no service account token, no
 * service links, a shared process namespace (the pause container reaps
 * orphans as pid 1), no privilege escalation, a writable root unless
 * `readOnlyRoot`, equal requests and limits, an emptyDir `/workspace`, an
 * in-memory `/tmp`, a disk emptyDir `WORKSPACE_HOME`, the cache at `/cache` (the shared claim, or an emptyDir
 * of its own) and only `SANDBOX_ENV`, `CACHE_ENV` and the configured `env`
 * (never the host's). No host path, no privileged mode. The image's
 * entrypoint is replaced: it sleeps until `expiresAt` (`SLEEP_UNTIL_SCRIPT`,
 * an absolute deadline, so a pod scheduled late stops in time), with its
 * lifetime (`lifetimeSeconds`) as `activeDeadlineSeconds` beside it, so it
 * ends itself at `expiresAt` even when no collection runs; the garbage collection (expiry, settled run)
 * deletes it. Its
 * labels and annotations hold everything `find` rebuilds the info from.
 */
export function buildPod(input: PodInput): V1Pod {
    const lifetime = lifetimeSeconds(input.info);
    const env = {
        ...SANDBOX_ENV, 
        ...CACHE_ENV, 
        ...input.env, 
    };
    const { uid, gid } = input.user;
    const root = uid === 0;
    const cache: V1Volume = input.cacheClaim === undefined ?
        { name: 'cache', emptyDir: {} } :
        { name: 'cache', persistentVolumeClaim: { claimName: input.cacheClaim } };
    const resources = {
        cpu: input.limits.cpu,
        memory: input.limits.memory,
        'ephemeral-storage': input.limits.storage,
    };

    return {
        apiVersion: 'v1',
        kind: 'Pod',
        metadata: {
            name: `${POD_NAME_PREFIX}${input.id}`,
            namespace: input.namespace,
            labels: {
                ...input.labels,
                ...workspaceLabels({
                    id: input.id,
                    runId: input.info.runId,
                    deployment: input.deployment,
                    repo: input.info.repo,
                }),
            },
            annotations: workspaceMetadata(input.info),
        },
        spec: {
            restartPolicy: 'Never',
            activeDeadlineSeconds: lifetime,
            automountServiceAccountToken: false,
            enableServiceLinks: false,
            // the pause container is pid 1 and reaps orphans: an image without
            // an init would make `sleep` pid 1, and the zombies would fill the
            // kubelet's pid limit
            shareProcessNamespace: true,
            terminationGracePeriodSeconds: 5,
            securityContext: {
                ...(!root && { runAsNonRoot: true }),
                runAsUser: uid,
                runAsGroup: gid,
                // a non-root user owns its volumes through the group
                ...(!root && { fsGroup: gid }),
                seccompProfile: { type: 'RuntimeDefault' },
            },
            containers: [{
                name: CONTAINER_NAME,
                image: input.info.image,
                imagePullPolicy: input.imagePullPolicy,
                // the image's entrypoint (sandbox-dev: tini) stays
                // until the absolute expiresAt: a pod scheduled or started late never outlives it
                command: ['sh', '-c', SLEEP_UNTIL_SCRIPT, 'sh', String(Math.ceil(input.info.expiresAt.getTime() / 1000))],
                workingDir: WORKSPACE_ROOT,
                env: Object.entries(env).map(([name, value]) => ({ name, value })),
                securityContext: {
                    allowPrivilegeEscalation: false,
                    readOnlyRootFilesystem: input.readOnlyRoot,
                    privileged: false,
                    ...(!root && { runAsNonRoot: true }),
                    capabilities: root ? { drop: ['ALL'], add: [...ROOT_CAPABILITIES] } : { drop: ['ALL'] },
                },
                resources: {
                    limits: { ...resources },
                    requests: { ...resources },
                },
                volumeMounts: [
                    { name: 'workspace', mountPath: WORKSPACE_ROOT },
                    { name: 'tmp', mountPath: '/tmp' },
                    { name: 'home', mountPath: WORKSPACE_HOME },
                    { name: 'cache', mountPath: CACHE_DIR },
                ],
            }],
            volumes: [
                { name: 'workspace', emptyDir: { sizeLimit: input.limits.storage } },
                { name: 'tmp', emptyDir: { medium: 'Memory', sizeLimit: input.tmpSize } },
                // HOME on the node's disk, counted in the pod's ephemeral-storage, never in memory
                { name: 'home', emptyDir: {} },
                cache,
            ],
        },
    };
}

/** `running`, `pending`, or the reason the pod will never run. */
export function podState(pod: V1Pod): { state: 'running' | 'pending' } | { state: 'failed'; reason: string } {
    const status = pod.status ?? {};
    if (status.phase === 'Failed' || status.phase === 'Succeeded') {
        const detail = [status.reason, status.message].filter(Boolean).join(': ');
        return { state: 'failed', reason: `phase ${status.phase}${detail ? ` (${detail})` : ''}` };
    }
    const container = status.containerStatuses?.find((item) => item.name === CONTAINER_NAME);
    const waiting = container?.state?.waiting;
    if (waiting?.reason && FATAL_WAITING_REASONS.includes(waiting.reason)) {
        return { state: 'failed', reason: `${waiting.reason}${waiting.message ? `: ${waiting.message}` : ''}` };
    }
    if (container?.state?.terminated) {
        const { terminated } = container.state;
        return { state: 'failed', reason: `container terminated (${terminated.reason ?? `exit ${terminated.exitCode}`})` };
    }
    return { state: status.phase === 'Running' ? 'running' : 'pending' };
}

/** True when the pod's expiry annotation is at or before `now`. */
export function isExpired(pod: V1Pod, now: number): boolean {
    return isExpiredAt(pod.metadata?.annotations?.[EXPIRES_AT_KEY], now);
}

/** Runs a client call; an error that is no ChamviError (a custom client's) becomes a SandboxError. */
export async function guard<T>(action: string, run: () => Promise<T>): Promise<T> {
    try {
        return await run();
    } catch (error) {
        if (error instanceof ChamviError) throw error;
        throw new SandboxError(`cannot ${action}`, { cause: error });
    }
}

/** The in-cluster config, else `KUBECONFIG` or `~/.kube/config`. */
export function loadDefaultKubeConfig(): KubeConfig {
    const kubeConfig = new KubeConfig();
    kubeConfig.loadFromDefault();
    return kubeConfig;
}
