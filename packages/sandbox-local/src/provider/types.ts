/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { IClock } from '@chamvi/core';
import type { SandboxLimits, WorkspaceInfo } from '@chamvi/sandbox';

export type LocalSandboxOptions = {
    /** Directory holding one folder per workspace. Default `join(os.tmpdir(), 'chamvi-workspaces')`. */
    root?: string;
    /** Added to every workspace's environment (after the defaults, so it wins). */
    env?: Record<string, string>;
    /** The only limit local enforces: the workspace lifetime (expiry). */
    limits?: Pick<SandboxLimits, 'maxLifetimeMs'>;
    clock?: IClock;
};

/** What `LocalWorkspace` is built from (internal). */
export type LocalWorkspaceInput = {
    id: string;
    /** The workspace folder `<root>/<id>`. */
    dir: string;
    info: WorkspaceInfo;
    env: Record<string, string>;
    clock: IClock;
    /** Called once when the workspace starts disposing. */
    onDispose: () => void;
};
