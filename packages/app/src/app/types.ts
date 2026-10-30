/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type {
    Agent,
    ConversationOptions,
    ModelRef,
    SkillInput,
} from '@chamvi/core';
import type { AgentIssue } from '@chamvi/http';
import type { IModule } from 'orkos';
import type { Env } from '../env/types.ts';
import type { ModelProviders, ProviderConfig } from '../models/types.ts';
import type { APP_BRAND } from './constants.ts';

export type AppOptions = {
    /** The code agents; may be omitted or empty when CHAMVI_AGENTS_DIR names an agents folder. */
    agents?: Agent[];
    /** Additive skill defaults for every code and folder agent, verified before serving. */
    skills?: readonly SkillInput[];
    /** Optional conversation recall and notes; the default store follows the app's selected data source. */
    conversations?: ConversationOptions;
    /** Extra modules; one named like a built-in (`ModuleName`) replaces it. */
    modules?: IModule[];
    /** The default model of agents without one; CHAMVI_MODEL and the config file win. */
    model?: ModelRef;
    /** Named providers model strings resolve through; env and the config file win per field. */
    providers?: Record<string, ProviderConfig>;
    /** AI SDK providers by id; they win over every provider setting for their ids. */
    models?: ModelProviders;
};

export type AppLifecycleOptions = {
    /** Default `process.env`. */
    env?: Env;
};

export type AppStartOptions = AppLifecycleOptions & {
    dev?: boolean;
};

export type AppCheckOptions = AppStartOptions;

export type AppCheckResult = {
    /** The agent folders' load issues (`AGENT_ISSUES`), one per folder; empty without an agents dir. */
    issues: AgentIssue[];
};

export type AppRunJobOptions = AppLifecycleOptions & {
    agent: string;
    /** Cron subscription id; optional when the agent has exactly one cron subscription. */
    subscription?: string;
};

export type AppRunJobResult = {
    runId?: string;
    status: string;
    exitCode: 0 | 1;
};

/**
 * An app: built by createApp, run once by one of `start`, `runJob` or
 * `migrate` (a second lifecycle rejects with `app_in_use`).
 */
export interface IApp {
    readonly [APP_BRAND]: true;
    /** The code agents (createApp's `agents`); folder agents are in the engine's live set. */
    readonly agents: readonly Agent[];
    /** Sets every module up; resolves once the HTTP server listens. */
    start(options?: AppStartOptions): Promise<void>;
    /**
     * Memoized: aborts the lifecycle, waits for it, tears every module down;
     * rejects with `app_stop_failed` when anything was reported meanwhile.
     */
    stop(): Promise<void>;
    /** Fires one cron subscription once and waits for its run (no channel started, no HTTP). */
    runJob(options: AppRunJobOptions): Promise<AppRunJobResult>;
    /** Migrates the store (DATABASE_URL required) and closes it. */
    migrate(options?: AppLifecycleOptions): Promise<void>;
    /**
     * The start path up to its start steps (`context.check`, mode `start`):
     * config, store connection, model settings, every module's setup and
     * onReady and the agent folders' load and checks, then the teardown; no
     * engine or channel start, no server, no run, no skill provider calls or
     * content verification, no store write (no
     * migration, marker, cancel or lock). Resolves the agent folders' load
     * issues; the lifecycle hooks `engineCreated` and `drained` run, never
     * `started` or `stopping`. A configuration error rejects (`invalid_agent_definition`), a
     * store failure with its own code (`store_not_migrated`, a connection
     * error). The app's one lifecycle, like start().
     */
    check(options?: AppCheckOptions): Promise<AppCheckResult>;
}
