/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { Agent, IClock } from '@chamvi/core';
import type { IContainer } from 'eldin';
import type { Application, IModule } from 'orkos';
import type { Env } from '../env/types.ts';
import type { AppContext, AppMode } from '../module/types.ts';

export type ModuleHarnessReport = { error: unknown; context?: Record<string, unknown> };

export type ModuleHarnessOptions = {
    mode?: AppMode;
    dev?: boolean;
    env?: Env;
    modules?: IModule[];
    agents?: Agent[];
    models?: AppContext['models'];
    /** createApp's `model`, copied into the context. */
    model?: AppContext['model'];
    /** createApp's `providers`, copied into the context. */
    providers?: AppContext['providers'];
    /** Copied into the context: `IApp.check()`'s flag (mode stays `start`); `setup()` then runs no start steps. */
    check?: boolean;
    /** Copied into the context: the agent a job runs (`IApp.runJob()`). */
    job?: AppContext['job'];
    /** Registered as `AppToken.CLOCK` before setup (a config module may replace it). */
    clock?: IClock;
};

export type ModuleHarness = {
    application: Application;
    container: IContainer;
    context: AppContext;
    controller: AbortController;
    /** Everything `context.report()` received, in order. */
    reported: ModuleHarnessReport[];
    /** Runs `application.setup()` and the start steps, like the app; tears down and rethrows when it fails. */
    setup(): Promise<void>;
    /** Aborts the context signal (app_stopped) and tears every module down. */
    stop(): Promise<void>;
};
