/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { SandboxLimits } from './types.ts';

export const DEFAULT_LIMITS: Readonly<Required<SandboxLimits>> = Object.freeze({
    cpu: '1',
    memory: '2Gi',
    storage: '4Gi',
    pids: 512,
    maxLifetimeMs: 604_800_000,
});

export const DEFAULT_SANDBOX_IMAGE = 'ghcr.io/chamvi/sandbox-node:24';

/** Size of the `/tmp` tmpfs of a container or pod workspace. */
export const TMP_SIZE = '512Mi';

/** Labels every container or pod workspace carries. */
export const SANDBOX_LABELS: Readonly<Record<string, string>> = Object.freeze({
    'app.kubernetes.io/managed-by': 'chamvi',
    'app.kubernetes.io/component': 'sandbox',
});

/** `SANDBOX_LABELS` as `key=value` selectors: a Docker label filter, joined by `,` a Kubernetes label selector. */
export const SANDBOX_LABEL_SELECTORS: readonly string[] = Object.freeze(Object.entries(SANDBOX_LABELS).map(([key, value]) => `${key}=${value}`));

export const RUN_LABEL = 'chamvi.dev/run';

export const WORKSPACE_LABEL = 'chamvi.dev/workspace';

/** The deployment a workspace belongs to (`find` and garbage collection see only their own). */
export const DEPLOYMENT_LABEL = 'chamvi.dev/deployment';

/** The deployment of a manager or provider call without one. */
export const DEFAULT_DEPLOYMENT = 'default';

/** `repoKey()` of the workspace's repository (a label value; the URL itself may be longer). */
export const REPO_KEY_LABEL = 'chamvi.dev/repo-key';

/** Expiry in epoch milliseconds: a Docker label, a Kubernetes annotation. */
export const EXPIRES_AT_KEY = 'chamvi.dev/expires-at';

/** Creation in epoch milliseconds: a Docker label, a Kubernetes annotation. */
export const CREATED_AT_KEY = 'chamvi.dev/created-at';

/** The normalized repository URL: a Docker label, a Kubernetes annotation. */
export const REPO_URL_KEY = 'chamvi.dev/repo';

/** The requested ref: a Docker label, a Kubernetes annotation. */
export const REF_KEY = 'chamvi.dev/ref';

/** The image: a Docker label, a Kubernetes annotation. */
export const IMAGE_KEY = 'chamvi.dev/image';
