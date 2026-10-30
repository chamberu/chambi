/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { TypedToken } from 'eldin';
import type { IContainer } from 'eldin';
import { AppToken } from './constants.ts';
import { throwIfStopped } from './helpers.ts';

/** Something a module starts once every `onReady` checked its configuration. */
type StartStep = {
    readonly name: string;
    /** Runs the step once; later calls return the first call's promise. */
    run(): Promise<void>;
};

/**
 * The start steps (internal, not exported): what the engine and http
 * modules start once every module checked its configuration in `onReady`.
 */
const START_STEPS = new TypedToken<StartStep>('chamvi.start-steps');

/**
 * Registers a start step: `run` is called at most once, by the app once every
 * `onReady` ran (in registration order: the engine with its channels, the http module's
 * serve), so a configuration error any module finds starts nothing.
 */
export function registerStartStep(container: IContainer, name: string, run: () => Promise<void>): void {
    let started: Promise<void> | undefined;

    container.registerMany(START_STEPS, {
        useValue: {
            name,
            run: () => {
                started ??= run();

                return started;
            },
        },
    });
}

/** Runs every registered start step in registration order; throws app_stopped once stop() was called. */
export async function runStartSteps(container: IContainer): Promise<void> {
    const context = container.resolve(AppToken.CONTEXT);

    for (const step of container.resolveAll(START_STEPS)) {
        throwIfStopped(context);
        await step.run();
    }
}
