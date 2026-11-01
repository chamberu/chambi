/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { IClock, IEngine } from '@chamvi/core';
import type { AgentIssue } from '@chamvi/http';
import type { ILogger } from '../../logger/types.ts';
import type { AgentCheck } from '../../module/types.ts';

export type AgentsWatcherOptions = {
    /** The agents dir, absolute. */
    root: string;
    engine: IEngine;
    /** The code agents' names: a folder of such a name is an issue, never loaded or removed. */
    codeNames: ReadonlySet<string>;
    /**
     * The checks a folder agent passes before it is registered (`AGENT_CHECKS`;
     * `putAgent` then refuses a model that cannot resolve): a throw is a load issue.
     */
    check: AgentCheck;
    clock: IClock;
    logger: ILogger;
    pollMs: number;
    /** Aborts preparation and prevents publication before a registry operation starts. */
    signal?: AbortSignal;
    /**
     * What the watcher may do to the store. `start`: register each folder
     * agent at its revision (a changed one cancels its old runs) and remove
     * the agents with a marker but neither a folder nor a code agent. `job`:
     * register without ever cancelling (`putAgent(..., { reload: false })`):
     * a missing marker is written, a different one moved only while the agent
     * has no unsettled run, else the agent is a conflict (an issue, not
     * registered); no orphan is removed. `check`: only `engine.checkAgent()`,
     * no store read or write, nothing registered.
     */
    role: AgentsWatcherRole;
};

export type AgentsWatcherRole = 'start' | 'job' | 'check';

export interface IAgentsWatcher {
    /**
     * Loads every folder and registers its agent (code agents win a name
     * clash), then (role `start`) removes every agent with a revision
     * marker but neither a folder nor a code agent. Load failures, refused
     * checks and failed skill preparations are issues; store failures throw.
     */
    boot(): Promise<void>;
    /** Polls every `pollMs` until stopped; idempotent, a no-op once stopped. */
    start(): void;
    /** Idempotent: no further poll; resolves once the poll in flight (a reload included) settled. */
    stop(): Promise<void>;
    /** Resolves once the poll in flight, if any, settled. */
    idle(): Promise<void>;
    /**
     * The issue message of a job-role revision conflict of `name` (its stored
     * marker differs while it has unsettled runs), else undefined.
     */
    conflict(name: string): string | undefined;
    /**
     * The error of the last failed skill preparation of `name` (an issue
     * until a later attempt succeeds or the folder changes), else undefined.
     */
    preparationFailure(name: string): unknown;
    /** The current load issues, as a fresh array. */
    issues(): AgentIssue[];
}
