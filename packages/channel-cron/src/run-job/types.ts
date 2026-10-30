/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type {
    Agent,
    IEngine,
    RunStatusLiteral,
} from '@chamvi/core';

export type RunJobOptions = {
    /**
     * Not started yet; runJob starts it without channels and drains it, also
     * when the tick is skipped. It holds the subscription's cron channel. Its store is polled and its clock gives scheduledAt and drives
     * the poll.
     */
    engine: IEngine;
    agent: Agent;
    /**
     * Cron subscription id; optional when the agent has exactly one
     * subscription of a cron channel the engine holds.
     */
    subscription?: string;
    /** Fallback poll of engine.getRun, default 1_000. */
    pollMs?: number;
    /** Passed to engine.drain, default 30_000. */
    drainTimeoutMs?: number;
    /**
     * Stops the job: already aborted, nothing is fired and the engine is never
     * started (`skipped`); aborted while waiting, the wait ends and the engine
     * drains, and the result is the run as stored after the drain. The abort
     * reason is never thrown.
     */
    signal?: AbortSignal;
};

export type RunJobResult = {
    runId?: string;
    /**
     * The run's status when the job returned: `completed`, `failed`,
     * `cancelled`, `waiting`, `queued` (behind a run of its concurrency key
     * that waits for an approval), or 'skipped' (overlap, or a signal
     * aborted before the call). After an abort while waiting: the status the
     * drain left, usually `interrupted`, or `running` when the drain timed out
     * before the run was marked.
     */
    status: RunStatusLiteral | 'skipped';
    /** 1 for failed and cancelled; 0 otherwise (an interrupted run is resumed by a replica). */
    exitCode: 0 | 1;
};
