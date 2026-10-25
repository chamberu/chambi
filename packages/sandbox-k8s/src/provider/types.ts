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

export type PodUser = {
    uid: number;
    gid: number;
};

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
    /**
     * Pull policy of the provider's own image: default `'IfNotPresent'`,
     * `'Always'` for a mutable tag. Any other image (the manager's or the
     * model's) is pulled if not present.
     */
    imagePullPolicy?: ImagePullPolicy;
    /**
     * uid and gid of the pod; default `{ uid: 0, gid: 0 }` (root with the
     * `ROOT_CAPABILITIES`, which needs a namespace whose Pod Security admits
     * root pods, i.e. `baseline`). `{ uid: 1000, gid: 1000 }` with
     * `readOnlyRoot: true` is the hardened mode, which `restricted` admits.
     */
    user?: PodUser;
    /** A read-only root filesystem (only `/workspace`, `/cache` and `/tmp` writable). Default false. */
    readOnlyRoot?: boolean;
    /**
     * A ReadWriteMany claim every workspace mounts at `/cache`, shared by every
     * run and agent of the namespace (a package one run fetched can be used by
     * another). Without it each pod gets an emptyDir `/cache` of its own.
     */
    cache?: { claimName: string };
    /** Size of the in-memory `/tmp`; default `TMP_SIZE` (`'1Gi'`). */
    tmpSize?: string;
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
    user: PodUser;
    readOnlyRoot: boolean;
    /** The shared cache claim; undefined mounts an emptyDir. */
    cacheClaim?: string;
    tmpSize: string;
};
