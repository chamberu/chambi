/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { RunStatusLiteral, Step } from '@chamvi/core';
import type {
    AgentIssue,
    AgentSummary,
    MeView,
    RunView,
    ScheduleSummary,
} from '@chamvi/http';

/** A JSON-decoded value: every `Date` arrives as an ISO string. */
export type Wire<T> = T extends Date ? string :
    T extends ReadonlyArray<infer U> ? Wire<U>[] :
        T extends object ? { [K in keyof T]: Wire<T[K]> } :
            T;

export type RunWire = Wire<RunView>;

export type StepWire = Wire<Step>;

export type RunDetail = RunWire & { steps: StepWire[] };

export type RunPage = {
    data: RunWire[];
    meta: {
        total: number;
        limit: number;
        offset: number
    };
};

export type RunListFilter = {
    agent?: string;
    status?: RunStatusLiteral[];
    limit?: number;
    offset?: number;
};

export type AgentWire = AgentSummary;

export type AgentIssueWire = Wire<AgentIssue>;

/** `GET /agents`: the loaded agents and the ones that failed to load. */
export type AgentList = {
    data: AgentWire[];
    issues: AgentIssueWire[];
};

export type ScheduleWire = ScheduleSummary;

export type KvEntry = { key: string; value: unknown };

export type DocEntry = { id: string } & Record<string, unknown>;

export type MeWire = MeView;

export type PageQuery = { limit?: number; offset?: number };

export type ApproveBody = {
    approvalId: string;
    approved: boolean;
    reason?: string;
    selected?: string[]
};

export type StartRunBody = {
    payload: unknown;
    /** Dedupes a retried start (scoped to the agent, the source and the principal). */
    idempotencyKey?: string;
};

export type StartRunResult = { runId: string; deduplicated: boolean };

/** Options of `createApiClient()`. */
export type ApiClientOptions = {
    apiBase: string;
    /** The bearer token of the signed-in principal, if any. */
    token: () => Promise<string | undefined>;
    /** Asked once on a 401; `true` retries the request with the new token. */
    refresh?: () => Promise<boolean>;
    /** Called when a 401 stands after the refresh. */
    onUnauthorized?: () => void;
    fetch?: typeof fetch;
};

export interface IApiClient {
    me(token?: string): Promise<MeWire>;
    listAgents(): Promise<AgentList>;
    listSchedules(): Promise<ScheduleWire[]>;
    listRuns(filter: RunListFilter): Promise<RunPage>;
    getRun(id: string): Promise<RunDetail>;
    cancelRun(id: string): Promise<void>;
    approve(id: string, body: ApproveBody): Promise<void>;
    listKv(agent: string, page?: PageQuery): Promise<KvEntry[]>;
    listDocs(agent: string, collection: string, page?: PageQuery): Promise<DocEntry[]>;
    /** The raw SSE response of `GET /runs/:id/stream` (an ApiError for a non-2xx answer). */
    /** `POST /agents/:name/runs`: a run through the agent's `http.on()` subscription. */
    startRun(agent: string, body: StartRunBody): Promise<StartRunResult>;
    streamRun(id: string, init: { lastEventId?: number; signal: AbortSignal }): Promise<Response>;
}
