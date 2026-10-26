/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type {
    Agent,
    Engine,
    IChannel,
    IClock,
    IStore,
    ModelRef,
} from '@chamvi/core';
import type {
    AgentIssue,
    Authenticator,
    HttpRoute,
    IShutdown,
} from '@chamvi/http';
import type { DataSource } from 'typeorm';
import type { AppConfig } from '../config/types.ts';
import type { Env } from '../env/types.ts';
import type { ILogger } from '../logger/types.ts';
import type { ModelProviders, ProviderConfig } from '../models/types.ts';

/** The container and module contracts a module factory is written against (eldin, orkos). */
export type { IContainer } from 'eldin';
export type { IModule } from 'orkos';

export type AppMode = 'start' | 'job' | 'migrate';

export type AppContext = {
    mode: AppMode;
    dev: boolean;
    env: Env;
    /** Aborts with the app_stopped ChamviError once stop() is called. */
    signal: AbortSignal;
    /** Logs through the app logger; during stop() also counts as a stop failure. */
    report(error: unknown, context?: Record<string, unknown>): void;
    /** createApp's `models`: AI SDK providers by id, winning over every provider setting for their ids. */
    models?: ModelProviders;
    /** createApp's `model`: the default model of agents without one (CHAMVI_MODEL and the config file win). */
    model?: ModelRef;
    /** createApp's `providers` (env and the config file win per field). */
    providers?: Readonly<Record<string, ProviderConfig>>;
    /** createApp's agents (the code agents); the live set is `engine.listAgents()`. */
    agents: readonly Agent[];
};

/**
 * Throws InvalidAgentDefinitionError for an agent a module could not serve
 * (the scheduler: a cron subscription hubwire refuses; http: a `run_<agent>` MCP
 * tool it cannot build). The agents dir runs every check on a folder agent
 * before registering it, so a refusal is a load issue, never a failed boot.
 */
export type AgentCheck = (agent: Agent) => void;

/**
 * A git credential source (structurally `@chamvi/sandbox`'s
 * `IGitCredentials`): modules contribute one to `AppToken.GIT_CREDENTIALS`
 * (`githubModule()` its App's), and `sandboxModule()` asks them after its own.
 */
export type GitCredentialSource = {
    get(input: {
        url: string;
        host: string;
        path: string;
        access: 'read' | 'write';
        runId: string;
        signal?: AbortSignal;
    }): Promise<{
        username: string; 
        password: string; 
        expiresAt?: Date 
    } | undefined>;
};

export interface ILifecycleHook {
    readonly name: string;
    /** After `new Engine(...)`, before `engine.start()` (start and job). */
    engineCreated?(engine: Engine): void | Promise<void>;
    /** start only: after engine.start() (which starts the channels), before serve(). */
    started?(): void | Promise<void>;
    /** start only: the shutdown's first step, before the closers, the server close and the drain (which stops the channels). */
    stopping?(): void | Promise<void>;
    /** After the engine drained (start and job), before the store closes. */
    drained?(): void | Promise<void>;
}

export type LifecyclePhase = 'engineCreated' | 'started' | 'stopping' | 'drained';

export type AuthenticatorEntry = {
    name: string;
    order: number;
    authenticator: Authenticator;
};

/**
 * The part of the HTTP server (srvx, from routup's `serve()`) the app uses,
 * typed structurally so srvx's declarations stay out of the package's types.
 */
export type Server = {
    readonly url?: string;
    ready(): Promise<unknown>;
    close(closeActiveConnections?: boolean): Promise<void>;
};

export type AppTokens = {
    CONTEXT: AppContext;
    CONFIG: AppConfig;
    LOGGER: ILogger;
    CLOCK: IClock;
    STORE: IStore;
    DATA_SOURCE: DataSource;
    ENGINE: Engine;
    SHUTDOWN: IShutdown;
    SERVER: Server;
    HTTP_ROUTES: HttpRoute;
    AUTHENTICATORS: AuthenticatorEntry;
    /** A collection: the channels modules contribute (`registerMany` in `setup`). */
    CHANNELS: IChannel<any, any>;
    LIFECYCLE_HOOKS: ILifecycleHook;
    /** The agents dir's load issues (`chamvi:agents`, when a dir is configured), at the time of the call. */
    AGENT_ISSUES: () => readonly AgentIssue[];
    /** A collection: every module's check of a folder agent before it is registered. */
    AGENT_CHECKS: AgentCheck;
    /** A collection: git credential sources modules contribute for the workspaces (`sandboxModule()` reads them). */
    GIT_CREDENTIALS: GitCredentialSource;
};
