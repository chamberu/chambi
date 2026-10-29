/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { Agent } from '../../agent/types.ts';
import type { IClock } from '../../clock/index.ts';
import type { Run } from '../../run/types.ts';
import type { Stores } from '../../store/types.ts';

export type RunQueueOptions = {
    stores: Pick<Stores, 'runs' | 'locks'>;
    /** Synchronous live registry lookup; no loading, creation or I/O. Missing agents return undefined. */
    getAgent: (name: string) => Agent | undefined;
    clock: IClock;
    owner: string;
    concurrencyMaxRuns: number;
    claimTtlMs: number;
    /** Called once a run is claimed and marked `running`. Must settle the run. */
    execute: (run: Run) => Promise<void>;
    /** Called for every run mutation performed by the queue. */
    onRunUpdated: (run: Run) => void;
    onError: (error: unknown, run?: Run) => void;
    /** Periodic work run before each poll pass (e.g. expiring approvals). */
    onPoll?: () => Promise<void>;
    /**
     * Called once per scheduling pass that found queued runs: resolves the
     * predicate deciding which of them may start; a `false` run is skipped
     * (it stays `queued`) before any claim.
     */
    prepareStart?: () => Promise<(run: Run) => boolean>;
    /** A claim renewal was refused: another owner may hold the run now. */
    onLeaseLost?: (runId: string) => void;
};
