/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import { ChamviError } from '@chamvi/core';
import type { IContainer } from 'eldin';
import type { IModule } from 'orkos';
import { APP_ERROR_CODE, AppToken } from './constants.ts';
import type {
    AppContext,
    ILifecycleHook,
    LifecyclePhase,
} from './types.ts';

/** The reason the context signal aborts with once stop() is called (internal). */
export function createStoppedError(): ChamviError {
    return new ChamviError({
        code: APP_ERROR_CODE.STOPPED,
        message: 'The app was stopped.',
    });
}

/** Throws the context signal's reason (the app_stopped ChamviError) once stop() was called. */
export function throwIfStopped(context: AppContext): void {
    if (context.signal.aborted) {
        throw context.signal.reason;
    }
}

/**
 * Runs the given phase of every `AppToken.LIFECYCLE_HOOKS` entry in
 * registration order. A throwing hook is reported (`{ hook, phase }`) and the
 * others still run; it never rejects.
 */
export async function runHooks(container: IContainer, phase: 'engineCreated', ...args: Parameters<NonNullable<ILifecycleHook['engineCreated']>>): Promise<void>;
export async function runHooks(container: IContainer, phase: Exclude<LifecyclePhase, 'engineCreated'>): Promise<void>;
export async function runHooks(container: IContainer, phase: LifecyclePhase, ...args: unknown[]): Promise<void> {
    const context = container.resolve(AppToken.CONTEXT);
    const hooks = container.resolveAll(AppToken.LIFECYCLE_HOOKS);

    for (const hook of hooks) {
        const fn = hook[phase] as ((...input: unknown[]) => void | Promise<void>) | undefined;

        if (!fn) {
            continue;
        }

        try {
            await fn.apply(hook, args);
        } catch (error) {
            context.report(error, { hook: hook.name, phase });
        }
    }
}

/**
 * Wraps a module so a throwing `teardown` is reported (`{ module: name }`)
 * instead of being swallowed by orkos; everything else is delegated (internal).
 */
export function reportingModule(module: IModule, report: AppContext['report']): IModule {
    const {
        teardown,
        onReady,
        onError,
    } = module;

    return {
        name: module.name,
        version: module.version,
        dependencies: module.dependencies,
        setup: (container) => module.setup(container),
        ...(onReady && { onReady: (container: IContainer) => onReady.call(module, container) }),
        ...(onError && { onError: (error: Error, container: IContainer) => onError.call(module, error, container) }),
        ...(teardown && {
            async teardown(container: IContainer) {
                try {
                    await teardown.call(module, container);
                } catch (error) {
                    report(error, { module: module.name });
                }
            },
        }),
    };
}
