/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { IClock } from '@chamvi/core';
import type { SandboxLimits, WorkspaceInfo } from '@chamvi/sandbox';
import type Dockerode from 'dockerode';

export type DockerSandboxOptions = {
    /** The Docker client; default `new Docker()` (`DOCKER_HOST` or `/var/run/docker.sock`). */
    docker?: Dockerode;
    /** Default `DEFAULT_SANDBOX_IMAGE`; pin a digest in production. */
    image?: string;
    /**
     * Default `DEFAULT_NETWORK` (`'bridge'`); `'none'` (repo-less workspaces only,
     * the clone runs inside) or any user-created network name, passed through.
     */
    network?: string;
    /**
     * `'missing'` (default) pulls once when the image is not present, `'always'`
     * before every create (a mutable tag then follows its rebuilds), `'never'`
     * never. It covers the provider's `image` and the manager's; an image a
     * run asked for (`create_workspace({ image })`) is pulled when missing.
     */
    pull?: 'missing' | 'always' | 'never';
    /** Added to every workspace's environment, after `SANDBOX_ENV` and `CACHE_ENV`. */
    env?: Record<string, string>;
    limits?: SandboxLimits;
    /**
     * The container user and the user of every command; default `DEFAULT_USER`
     * (`'0:0'`, root with the `ROOT_CAPABILITIES`). `'1000:1000'` with
     * `readOnlyRoot: true` is the hardened mode (no capability at all).
     */
    user?: string;
    /** A read-only root filesystem (only `/workspace`, `/cache` and `/tmp` writable). Default false. */
    readOnlyRoot?: boolean;
    /**
     * The `/cache` mount. Default: an anonymous volume per workspace,
     * removed with it. `{ volume }` mounts that named volume in every
     * workspace instead: a trust boundary shared by every run and agent on
     * the host (a package one run fetched can be used by another). Never
     * point a non-root `user` at a volume a root workspace wrote to.
     */
    cache?: { volume: string };
    /** Size of the `/tmp` tmpfs; default `TMP_SIZE` (`'1Gi'`). */
    tmpSize?: string;
    clock?: IClock;
};

export type ContainerOptionsInput = {
    id: string;
    deployment: string;
    /** Run, image, repo, ref and times: labels a provider's `find` rebuilds the info from. */
    info: WorkspaceInfo & { image: string };
    network: string;
    user: string;
    readOnlyRoot: boolean;
    /** The shared cache volume (`cache.volume`); undefined mounts an anonymous one per workspace. */
    cacheVolume?: string;
    tmpSize: string;
    env: Record<string, string>;
    limits: Required<SandboxLimits>;
};
