/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { Container } from 'eldin';
import { Application } from 'orkos';
import { AppToken } from '../module/constants.ts';
import { createStoppedError, reportingModule } from '../module/helpers.ts';
import { runStartSteps } from '../module/start.ts';
import type { AppContext } from '../module/types.ts';
import type {
    ModuleHarness,
    ModuleHarnessOptions,
    ModuleHarnessReport,
} from './types.ts';

/**
 * An orkos Application over a fresh eldin Container with `AppToken.CONTEXT`
 * pre-registered, the modules wrapped like the app wraps them (a throwing
 * lifecycle hook is reported, not thrown). Not set up yet; see
 * `createModuleHarness()`.
 */
export function buildModuleHarness(options: ModuleHarnessOptions = {}): ModuleHarness {
    const reported: ModuleHarnessReport[] = [];
    const controller = new AbortController();
    const report: AppContext['report'] = (error, context) => {
        reported.push({ error, context });
    };
    const context: AppContext = {
        mode: options.mode ?? 'start',
        dev: options.dev ?? false,
        env: options.env ?? {},
        signal: controller.signal,
        report,
        models: options.models,
        ...(options.model !== undefined && { model: options.model }),
        ...(options.providers !== undefined && { providers: options.providers }),
        agents: options.agents ?? [],
        ...(options.check !== undefined && { check: options.check }),
        ...(options.job !== undefined && { job: options.job }),
    };

    const container = new Container();

    container.register(AppToken.CONTEXT, { useValue: context });

    if (options.clock) {
        container.register(AppToken.CLOCK, { useValue: options.clock });
    }

    const application = new Application({
        container,
        modules: (options.modules ?? []).map((module) => reportingModule(module, report)),
    });

    return {
        application,
        container,
        context,
        controller,
        reported,
        async setup() {
            try {
                await application.setup();

                // a check stops before the start steps, like IApp.check()
                if (!context.check) {
                    await runStartSteps(container);
                }
            } catch (error) {
                await application.teardown();

                throw error;
            }
        },
        async stop() {
            if (!controller.signal.aborted) {
                controller.abort(createStoppedError());
            }

            await application.teardown();
        },
    };
}

/** `buildModuleHarness()` and `setup()` in one step. */
export async function createModuleHarness(options: ModuleHarnessOptions = {}): Promise<ModuleHarness> {
    const harness = buildModuleHarness(options);

    await harness.setup();

    return harness;
}
