/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { IClock } from '../../clock/index.ts';
import type { Run } from '../../run/types.ts';
import type { Repositories } from '../../repository/types.ts';

/** What a registry cancel stores on the run (`Run.error`). */
export type CancelReason = { code: string; message: string };

/** What the registry operations need from the engine. */
export type RegistryContext = {
    repositories: Pick<Repositories, 'runs' | 'locks' | 'agentRevisions'>;
    clock: IClock;
    /** The lock is retried every claimTtlMs / 3. */
    claimTtlMs: number;
    cancel: (runId: string, reason: CancelReason) => Promise<void>;
    onError: (error: unknown, run?: Run) => void;
};

export type DropRevisionOptions = {
    /** The agent was registered on this engine (no replica may run it any more once its marker is gone). */
    registered: boolean;
    /** The revision this engine had it at (undefined for a code agent or one not registered here). */
    revision?: string;
};
