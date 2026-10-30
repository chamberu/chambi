/*
 * Copyright (c) 2026.
 * Author Peter Placzek (tada5hi)
 * For the full copyright and license information,
 * view the LICENSE file that was distributed with this source code.
 */

import type { IContainer } from 'eldin';
import type { IModule } from 'orkos';
import { MockLanguageModelV4 } from 'ai/test';

export const TOKEN = 'a-static-token-of-length';
export const TOKENS = JSON.stringify([{
    value: TOKEN,
    id: 'ops',
    permissions: ['*'],
}]);

export type Deferred<T = void> = {
    promise: Promise<T>;
    resolve(value: T): void;
};

export function deferred<T = void>(): Deferred<T> {
    const { promise, resolve } = Promise.withResolvers<T>();

    return { promise, resolve };
}

/** A model that never answers: its call rejects only when the run aborts. */
export function hangingModel() {
    const hang = (signal?: AbortSignal) => new Promise<never>((_resolve, reject) => {
        signal?.addEventListener('abort', () => reject(signal.reason), { once: true });
    });

    return new MockLanguageModelV4({
        doGenerate: async (options) => hang(options.abortSignal),
        doStream: async (options) => hang(options.abortSignal),
    });
}

/**
 * Delegates to `module` under the same name and records `<label> teardown`
 * (and `<label> setup` when asked) into `events`.
 */
export function recording(module: IModule, events: string[], label = module.name): IModule {
    return {
        name: module.name,
        dependencies: module.dependencies,
        async setup(container: IContainer) {
            events.push(`${label} setup`);
            await module.setup(container);
        },
        ...(module.onReady && {
            onReady: async (container: IContainer) => {
                await module.onReady?.(container);
            },
        }),
        async teardown(container: IContainer) {
            events.push(`${label} teardown`);
            await module.teardown?.(container);
        },
    };
}

export async function rejectionOf(promise: Promise<unknown>): Promise<Error & { code?: string; cause?: unknown }> {
    try {
        await promise;
    } catch (error) {
        return error as Error;
    }

    throw new Error('expected a rejection');
}
