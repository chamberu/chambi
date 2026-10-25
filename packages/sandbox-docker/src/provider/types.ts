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
     * before every create (a mutable tag then follows its rebuilds), `'never'` never.
     */
    pull?: 'missing' | 'always' | 'never';
    /** Added to every workspace's environment, after `SANDBOX_ENV`. */
    env?: Record<string, string>;
    limits?: SandboxLimits;
    clock?: IClock;
};

export type ContainerOptionsInput = {
    id: string;
    deployment: string;
    /** Run, image, repo, ref and times: labels a provider's `find` rebuilds the info from. */
    info: WorkspaceInfo & { image: string };
    network: string;
    env: Record<string, string>;
    limits: Required<SandboxLimits>;
};
