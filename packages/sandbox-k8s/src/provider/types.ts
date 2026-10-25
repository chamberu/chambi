/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { KubeConfig } from '@kubernetes/client-node';
import type { IClock } from '@chamvi/core';
import type { SandboxLimits, WorkspaceInfo } from '@chamvi/sandbox';
import type { IPodClient } from '../client/types.ts';

export type ImagePullPolicy = 'Always' | 'IfNotPresent';

export type KubernetesSandboxOptions = {
    /** Namespace of the workspace pods (required). */
    namespace: string;
    /** Default `new KubeConfig()` with `loadFromDefault()` (in-cluster or `KUBECONFIG`). */
    kubeConfig?: KubeConfig;
    /** Default `DEFAULT_SANDBOX_IMAGE`; pin a digest in production. */
    image?: string;
    /** Added to every workspace's environment, after `SANDBOX_ENV`. */
    env?: Record<string, string>;
    limits?: SandboxLimits;
    /** Extra pod labels (e.g. for a NetworkPolicy); may not name a managed label. */
    podLabels?: Record<string, string>;
    /** Default `'IfNotPresent'`; `'Always'` for a mutable tag. */
    imagePullPolicy?: ImagePullPolicy;
    /** Default `START_TIMEOUT_MS`. */
    startTimeoutMs?: number;
    /** Default `POLL_MS`. */
    pollMs?: number;
    clock?: IClock;
    /** Test seam; default `createPodClient({ kubeConfig, namespace })`. */
    client?: IPodClient;
};

export type PodInput = {
    id: string;
    deployment: string;
    namespace: string;
    /** Run, image, repo, ref and times: labels and annotations a provider's `find` rebuilds the info from. */
    info: WorkspaceInfo & { image: string };
    env: Record<string, string>;
    limits: Required<SandboxLimits>;
    /** The `podLabels`; the managed labels win. */
    labels: Record<string, string>;
    imagePullPolicy: ImagePullPolicy;
};
