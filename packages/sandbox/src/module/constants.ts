/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { SandboxProviderName } from './types.ts';

export const SANDBOX_MODULE_NAME = 'chamvi:sandbox';

export const SANDBOX_PROVIDER_NAMES: readonly SandboxProviderName[] = ['local', 'docker', 'kubernetes'];

/** The package each provider name needs installed. */
export const SANDBOX_PROVIDER_PACKAGES: Readonly<Record<SandboxProviderName, string>> = {
    local: '@chamvi/sandbox-local',
    docker: '@chamvi/sandbox-docker',
    kubernetes: '@chamvi/sandbox-k8s',
};

/** The `ISandboxProvider.name` of each provider (the lazy provider's name before it loads). */
export const SANDBOX_PROVIDER_IDS: Readonly<Record<SandboxProviderName, string>> = {
    local: 'local',
    docker: 'docker',
    kubernetes: 'k8s',
};
