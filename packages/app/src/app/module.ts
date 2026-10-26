/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { InvalidAgentDefinitionError } from '@chamvi/core';
import type { Agent, ModelRef } from '@chamvi/core';
import { runJob } from '@chamvi/channel-cron';
import { Container } from 'eldin';
import type { IContainer } from 'eldin';
import { Application } from 'orkos';
import type { IModule } from 'orkos';
import { isObject } from 'smob';
import type { Env } from '../env/types.ts';
import type { ModelProviders, ProviderConfig } from '../models/types.ts';
import { AppToken } from '../module/constants.ts';
import {
    createStoppedError,
    reportingModule,
    runHooks,
} from '../module/helpers.ts';
import { runStartSteps } from '../module/start.ts';
import type { AppContext, AppMode } from '../module/types.ts';
import { APP_BRAND } from './constants.ts';
import {
    buildModules,
    createInUseError,
    createStopFailedError,
    isModelRef,
    logReported,
    toSetupError,
} from './helpers.ts';
import type {
    AppCheckOptions,
    AppCheckResult,
    AppLifecycleOptions,
    AppOptions,
    AppRunJobOptions,
    AppRunJobResult,
    AppStartOptions,
    IApp,
} from './types.ts';

/** One lifecycle: an orkos Application over a fresh container. */
type Lifecycle = {
    controller: AbortController;
    container: IContainer;
    application: Application;
    /** Every error reported during the lifecycle, in order. */
    errors: unknown[];
    /** The lifecycle call in flight (start: the setup; job and migrate: the whole call). */
    done: Promise<unknown>;
    /** The app ran the `started` hooks itself (a start without the http module), so it runs `stopping` too. */
    hooksStarted?: boolean;
};

/**
 * The App createApp returns. Each lifecycle call builds one orkos
 * `Application` over a fresh eldin `Container` with `AppToken.CONTEXT`
 * registered first; an App runs one lifecycle.
 */
export class App implements IApp {
    readonly [APP_BRAND] = true as const;

    readonly agents: readonly Agent[];

    protected modules: IModule[];

    protected models: ModelProviders | undefined;

    protected model: ModelRef | undefined;

    protected providers: Record<string, ProviderConfig> | undefined;

    protected used = false;

    protected lifecycle: Lifecycle | undefined;

    protected stopping: Promise<void> | undefined;

    constructor(options: AppOptions) {
        // no agents at all is refused by start and runJob, once CHAMVI_AGENTS_DIR is read
        if (!isObject(options) || (options.agents !== undefined && !Array.isArray(options.agents))) {
            throw new InvalidAgentDefinitionError('createApp needs an options object whose agents is an array.');
        }

        if (options.model !== undefined && !isModelRef(options.model)) {
            throw new InvalidAgentDefinitionError('createApp\'s model must be a "<provider>/<model>" string or a LanguageModel object.');
        }
        if (options.providers !== undefined && !isObject(options.providers)) {
            throw new InvalidAgentDefinitionError('createApp\'s providers must be an object of provider configs by name.');
        }

        this.agents = Object.freeze([...options.agents ?? []]);
        this.modules = buildModules(options.modules);
        this.models = options.models;
        this.model = options.model;
        this.providers = options.providers;
    }

    async start(options: AppStartOptions = {}): Promise<void> {
        const lifecycle = this.begin('start', options, options.dev ?? false);
        lifecycle.done = this.setup(lifecycle);
        await lifecycle.done;
    }

    async check(options: AppCheckOptions = {}): Promise<AppCheckResult> {
        const lifecycle = this.begin('start', options, options.dev ?? false, { check: true });
        const checked = this.checkOnce(lifecycle);
        lifecycle.done = checked;
        return checked;
    }

    async runJob(options: AppRunJobOptions): Promise<AppRunJobResult> {
        const lifecycle = this.begin('job', options, false, { job: { agent: options.agent } });
        const job = this.job(lifecycle, options);
        lifecycle.done = job;
        return job;
    }

    async migrate(options: AppLifecycleOptions = {}): Promise<void> {
        const lifecycle = this.begin('migrate', options, false);
        lifecycle.done = this.migrateOnce(lifecycle);
        await lifecycle.done;
    }

    stop(): Promise<void> {
        this.stopping ??= this.shutdown();
        return this.stopping;
    }

    protected begin(
        mode: AppMode,
        options: AppLifecycleOptions,
        dev: boolean,
        extra: Pick<AppContext, 'check' | 'job'> = {},
    ): Lifecycle {
        if (this.used || this.stopping) {
            throw createInUseError();
        }
        this.used = true;

        const env: Env = options.env ?? process.env;
        const controller = new AbortController();
        const container = new Container();
        const errors: unknown[] = [];
        const report: AppContext['report'] = (error, context) => {
            errors.push(error);
            logReported(container, error, context);
        };

        const context: AppContext = {
            mode,
            dev,
            env,
            signal: controller.signal,
            report,
            models: this.models,
            ...(this.model !== undefined && { model: this.model }),
            ...(this.providers !== undefined && { providers: this.providers }),
            agents: this.agents,
            ...extra,
        };
        container.register(AppToken.CONTEXT, { useValue: context });

        const application = new Application({
            container,
            modules: this.modules.map((module) => reportingModule(module, report)),
        });

        const lifecycle: Lifecycle = {
            controller,
            container,
            application,
            errors,
            done: Promise.resolve(),
        };
        this.lifecycle = lifecycle;
        return lifecycle;
    }

    /**
     * Sets every module up; on a failure (setup or onReady) tears the ready
     * modules down and rethrows, the app_stopped error when stop() interrupted it.
     */
    protected async setup(lifecycle: Lifecycle): Promise<void> {
        const {
            application,
            container,
            controller,
        } = lifecycle;
        try {
            await application.setup();
            const context = container.resolve(AppToken.CONTEXT);
            // a check stops before the start steps: nothing starts, nothing runs
            if (!context.check) {
                // every onReady checked its configuration: the engine with its channels, then the http module's serve
                await runStartSteps(container);
                if (context.mode === 'start' && !container.has(AppToken.SERVER)) {
                    // the http module's serve step runs these hooks; without it the app does
                    lifecycle.hooksStarted = true;
                    await runHooks(container, 'started');
                }
            }
        } catch (error) {
            if (controller.signal.aborted && error !== controller.signal.reason) {
                // the stop's reason answers, but the real failure must not vanish
                logReported(container, error, { phase: 'setup' });
            }
            await application.teardown();
            throw controller.signal.aborted ? controller.signal.reason : toSetupError(error);
        }

        if (controller.signal.aborted) {
            // stop() tears down once it saw this lifecycle settle
            throw controller.signal.reason;
        }
    }

    /** Tears every ready module down; throws app_stop_failed when that reported errors. */
    protected async teardown(lifecycle: Lifecycle): Promise<void> {
        const from = lifecycle.errors.length;
        await this.runStoppingHooks(lifecycle);
        await lifecycle.application.teardown();
        const errors = lifecycle.errors.slice(from);
        if (errors.length > 0) {
            throw createStopFailedError(errors);
        }
    }

    protected async job(lifecycle: Lifecycle, options: AppRunJobOptions): Promise<AppRunJobResult> {
        await this.setup(lifecycle);

        let result: AppRunJobResult;
        try {
            const { container } = lifecycle;
            const engine = container.resolve(AppToken.ENGINE);
            const agent = engine.getAgent(options.agent);
            if (!agent) {
                const names = engine.listAgents().map((a) => a.name).join(', ');
                throw new InvalidAgentDefinitionError(`No agent "${options.agent}"; the app has: ${names}.`);
            }

            const {
                runId,
                status,
                exitCode,
            } = await runJob({
                engine,
                agent,
                subscription: options.subscription,
                drainTimeoutMs: container.resolve(AppToken.CONFIG).http.drainTimeoutMs,
                signal: lifecycle.controller.signal,
            });
            result = {
                ...(runId !== undefined && { runId }),
                status,
                exitCode,
            };
        } catch (error) {
            // the teardown's own errors are logged; the job's error is the answer
            await lifecycle.application.teardown();
            throw error;
        }

        await this.teardown(lifecycle);
        return result;
    }

    /** setup() without the start steps, the agent folders' issues, then the teardown. */
    protected async checkOnce(lifecycle: Lifecycle): Promise<AppCheckResult> {
        await this.setup(lifecycle);
        const { container } = lifecycle;
        const issues = container.has(AppToken.AGENT_ISSUES) ? [...container.resolve(AppToken.AGENT_ISSUES)()] : [];
        await this.teardown(lifecycle);
        return { issues };
    }

    protected async migrateOnce(lifecycle: Lifecycle): Promise<void> {
        await this.setup(lifecycle);
        await this.teardown(lifecycle);
    }

    /** The `stopping` hooks, once, when the app ran `started` itself (no http module). */
    protected async runStoppingHooks(lifecycle: Lifecycle): Promise<void> {
        if (!lifecycle.hooksStarted) {
            return;
        }
        lifecycle.hooksStarted = false;
        await runHooks(lifecycle.container, 'stopping');
    }

    protected async shutdown(): Promise<void> {
        const { lifecycle } = this;
        if (!lifecycle) {
            return;
        }

        const from = lifecycle.errors.length;
        if (!lifecycle.controller.signal.aborted) {
            lifecycle.controller.abort(createStoppedError());
        }

        // never tear down while a module sets up, or a job under runJob's feet
        await lifecycle.done.catch(() => {});
        await this.runStoppingHooks(lifecycle);
        // a no-op when the lifecycle already tore down
        await lifecycle.application.teardown();

        const errors = lifecycle.errors.slice(from);
        if (errors.length > 0) {
            throw createStopFailedError(errors);
        }
    }
}

/**
 * Builds an app from agents and modules. Synchronous and side-effect free: no
 * env read, no I/O; everything happens in the returned lifecycle methods.
 */
export function createApp(options: AppOptions): IApp {
    return new App(options);
}

/** Whether `value` is an App, also one of another installed copy of the package. */
export function isApp(value: unknown): value is IApp {
    return isObject(value) && (value as Record<PropertyKey, unknown>)[APP_BRAND] === true;
}
