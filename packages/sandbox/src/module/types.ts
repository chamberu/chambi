/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { Env } from '@chamvi/app';
import type { IWorkspaceManager, WorkspaceManagerOptions } from '../manager/types.ts';
import type { ISandboxProvider } from '../provider/types.ts';

// #region public
export type SandboxProviderName = 'local' | 'docker' | 'kubernetes';

/**
 * `createWorkspaceManager()` options; the manager's `env` is `workspaceEnv`
 * here, since `env` is the process env the factory reads. `deployment`:
 * `CHAMVI_DEPLOYMENT` wins; `isSettled` defaults to the engine's `getRun`
 * (a settled run, and with a named deployment also a missing one).
 * `allowImage`: `CHAMVI_SANDBOX_IMAGES` (a comma list of exact image
 * references) wins; without either, `create_workspace` offers no `image`.
 */
export type SandboxModuleOptions = Omit<WorkspaceManagerOptions, 'provider' | 'env'> & {
    /** A provider name (`CHAMVI_SANDBOX_PROVIDER` wins) or an instance; default `'local'`. */
    provider?: SandboxProviderName | ISandboxProvider;
    /** Used as is; no provider is built then. */
    manager?: IWorkspaceManager;
    /** Kubernetes namespace of the workspace pods; `CHAMVI_SANDBOX_NAMESPACE` wins. */
    namespace?: string;
    /** Docker and Kubernetes image; `CHAMVI_SANDBOX_IMAGE` wins, default `DEFAULT_SANDBOX_IMAGE`. */
    image?: string;
    /** Added to every workspace's environment. */
    workspaceEnv?: Record<string, string>;
    /** Default `process.env`, read when the factory is called. */
    env?: Env;
};
// #endregion public

export type LazyProvider = ISandboxProvider & {
    /** Loads the provider once (concurrent callers share it); a failure is not cached. */
    load(): Promise<void>;
};

/*
 * Structural types of the provider packages: they peer on @chamvi/sandbox, so
 * this package never resolves their types at build time (internal).
 */
export type LocalProviderPackage = { createLocalSandbox(): ISandboxProvider };

export type DockerProviderPackage = { createDockerSandbox(options: { image: string }): ISandboxProvider };

export type KubernetesProviderPackage = {
    createKubernetesSandbox(options: { namespace: string; image: string }): ISandboxProvider;
};
